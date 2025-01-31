import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import fs from 'fs-extra';
const { writeFile, ensureDir, readFile } = fs;
import { basename } from 'path';

// Helper functions for path-based naming
function sanitizePathComponent(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname + urlObj.hash;
    // Create a short hash of the path
    const hash = Array.from(path).reduce((h, c) => 
      (((h << 5) - h) + c.charCodeAt(0)) | 0, 0
    ).toString(36).slice(-6);
    
    // Get the last part of the path
    const lastPart = path === '/' ? 'home' : 
                    basename(path).replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'page';
    
    return `${lastPart}_${hash}`;
  } catch (err) {
    return `page_${Date.now().toString(36)}`;
  }
}

function isAnchorLink(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hash !== '' && urlObj.pathname === new URL(urlObj.origin).pathname;
  } catch {
    return false;
  }
}

function isSimilarPath(urlA, urlB) {
  try {
    const urlObjA = new URL(urlA);
    const urlObjB = new URL(urlB);
    // For anchor links, compare full URL including hash
    if (isAnchorLink(urlA) || isAnchorLink(urlB)) {
      return urlA === urlB;
    }
    // For regular links, compare just the pathname
    return urlObjA.pathname === urlObjB.pathname;
  } catch {
    return false;
  }
}

async function captureScreenshot(page, dir, filename) {
  if (!page) return null;
  
  try {
    const screenshotPath = path.join(dir, filename);
    await page.screenshot({ 
      path: screenshotPath,
      fullPage: true 
    });
    return screenshotPath;
  } catch (err) {
    console.error(`Error capturing screenshot ${filename}:`, err.message);
    return null;
  }
}

async function getPageLinks(page, baseUrl) {
  if (!page) return [];
  
  try {
    const links = await page.$$eval('a', (anchors) => anchors.map((a) => a.href));
    return links.filter(link => isSameDomain(baseUrl, link));
  } catch (err) {
    console.error('Error getting page links:', err.message);
    return [];
  }
}
import path from 'path';
import PNG from 'pngjs';
import { spawn } from 'child_process';

// Temporary directory for artifacts
const tempDir = path.join(process.cwd(), 'tmp');
const screenshotDirA = path.join(tempDir, 'screenshots-a');
const screenshotDirB = path.join(tempDir, 'screenshots-b');
const diffDir = path.join(tempDir, 'diffs');

import builder from 'junit-report-builder';

// JUnit report builder
const report = builder.newBuilder();

// Helper function to check if URLs are in the same domain
function isTraversableUrl(url) {
  try {
    if (!url || typeof url !== 'string') return false;
    
    // Skip these URL types
    if (url.startsWith('mailto:')) return false;
    if (url.startsWith('tel:')) return false;
    if (url.startsWith('sms:')) return false;
    if (url.startsWith('javascript:')) return false;
    if (url.startsWith('data:')) return false;
    if (url.startsWith('file:')) return false;
    if (url.startsWith('ftp:')) return false;
    if (url.endsWith('.pdf')) return false;
    if (url.endsWith('.zip')) return false;
    if (url.endsWith('.doc')) return false;
    if (url.endsWith('.docx')) return false;
    if (url.endsWith('.xls')) return false;
    if (url.endsWith('.xlsx')) return false;
    
    return true;
  } catch {
    return false;
  }
}

function isSameDomain(baseUrl, targetUrl) {
  try {
    // Skip empty, invalid, or non-traversable URLs
    if (!isTraversableUrl(targetUrl)) {
      return false;
    }
    
    // Handle relative URLs
    if (targetUrl.startsWith('/')) {
      return true;
    }

    // Handle URLs without protocol
    if (!targetUrl.includes('://')) {
      targetUrl = 'http://' + targetUrl;
    }

    const baseHostname = new URL(baseUrl).hostname;
    const targetHostname = new URL(targetUrl).hostname;
    return baseHostname === targetHostname;
  } catch (err) {
    console.error('Invalid URL:', err.message);
    return false;
  }
}

// Depth-first traversal function
async function dfs(pageA, pageB, urlA, urlB, depth = 0, visitedA = new Set(), visitedB = new Set(), screenshots = { a: [], b: [] }) {
  // Limit depth to prevent infinite loops
  const MAX_DEPTH = 10;
  if (depth >= MAX_DEPTH) {
    console.log(`Max depth ${MAX_DEPTH} reached, stopping traversal`);
    return { visitedA, visitedB, screenshots };
  }
  // Normalize URLs before checking visited state
  const normalizedA = urlA ? new URL(urlA).toString() : null;
  const normalizedB = urlB ? new URL(urlB).toString() : null;

  if ((normalizedA && visitedA.has(normalizedA)) || 
      (normalizedB && visitedB.has(normalizedB))) {
    return { visitedA, visitedB, screenshots };
  }
  
  if (pageA && normalizedA) {
    visitedA.add(normalizedA);
    try {
      await pageA.goto(urlA, { waitUntil: 'networkidle' });
      await pageA.waitForLoadState('load');
      await pageA.waitForTimeout(1000);
      await Promise.all([
        pageA.waitForSelector('.loading', { state: 'hidden', timeout: 5000 }).catch(() => {}),
        pageA.waitForSelector('.spinner', { state: 'hidden', timeout: 5000 }).catch(() => {}),
        pageA.waitForSelector('[role="progressbar"]', { state: 'hidden', timeout: 5000 }).catch(() => {})
      ]);
    } catch (err) {
      console.error(`Error navigating to ${urlA}:`, err.message);
    }
  }

  if (pageB && normalizedB) {
    visitedB.add(normalizedB);
    try {
      await pageB.goto(urlB, { waitUntil: 'networkidle' });
      await pageB.waitForLoadState('load');
      await pageB.waitForTimeout(1000);
      await Promise.all([
        pageB.waitForSelector('.loading', { state: 'hidden', timeout: 5000 }).catch(() => {}),
        pageB.waitForSelector('.spinner', { state: 'hidden', timeout: 5000 }).catch(() => {}),
        pageB.waitForSelector('[role="progressbar"]', { state: 'hidden', timeout: 5000 }).catch(() => {})
      ]);
    } catch (err) {
      console.error(`Error navigating to ${urlB}:`, err.message);
    }
  }

  // Take screenshots with matching names
  const screenshotName = `${sanitizePathComponent(urlA || urlB)}.png`;
  const screenshotA = await captureScreenshot(pageA, screenshotDirA, screenshotName);
  const screenshotB = await captureScreenshot(pageB, screenshotDirB, screenshotName);
  
  if (screenshotA) screenshots.a.push(screenshotA);
  if (screenshotB) screenshots.b.push(screenshotB);

  // Get and normalize links from both pages
  const linksA = (await getPageLinks(pageA, urlA)).map(url => {
    try {
      return new URL(url).toString();
    } catch {
      return null;
    }
  }).filter(Boolean);
  
  const linksB = (await getPageLinks(pageB, urlB)).map(url => {
    try {
      return new URL(url).toString();
    } catch {
      return null;
    }
  }).filter(Boolean);

  // If current URL is an anchor link, don't traverse further
  if (urlA && isAnchorLink(urlA) || urlB && isAnchorLink(urlB)) {
    return { visitedA, visitedB, screenshots };
  }

  // Filter out already visited links and find common ones
  const commonLinks = linksA.filter(linkA => 
    !visitedA.has(linkA) && 
    linksB.some(linkB => !visitedB.has(linkB) && isSimilarPath(linkA, linkB))
  );

  // Process common links first to maintain alignment
  for (const linkA of commonLinks) {
    const linkB = linksB.find(b => isSimilarPath(linkA, b));
    await dfs(
      pageA, pageB,
      linkA, linkB,
      depth + 1,
      visitedA, visitedB,
      screenshots
    );
  }

  // Process unique links in A
  for (const linkA of linksA.filter(a => !commonLinks.includes(a))) {
    await dfs(
      pageA, null,
      linkA, null,
      depth + 1,
      visitedA, visitedB,
      screenshots
    );
  }

  // Process unique links in B
  for (const linkB of linksB.filter(b => !commonLinks.some(a => isSimilarPath(a, b)))) {
    await dfs(
      null, pageB,
      null, linkB,
      depth + 1,
      visitedA, visitedB,
      screenshots
    );
  }

  return { visitedA, visitedB, screenshots };
}

// Compare screenshots using pixelmatch
async function compareScreenshots(img1Path, img2Path, diffPath) {
  try {
    // Check if both files exist
    if (!await fs.pathExists(img1Path) || !await fs.pathExists(img2Path)) {
      console.error('Missing screenshot file:', !await fs.pathExists(img1Path) ? img1Path : img2Path);
      return true; // Consider missing files as a difference
    }

    const img1Data = await readFile(img1Path);
    const img2Data = await readFile(img2Path);
    
    if (!img1Data || !img2Data) {
      console.error('Failed to read image data');
      return true;
    }
    
    const img1 = PNG.sync.read(img1Data);
    const img2 = PNG.sync.read(img2Data);

    // Ensure images are the same size
    if (img1.width !== img2.width || img1.height !== img2.height) {
      console.error('Screenshot dimensions do not match');
      return true;
    }

    const { width, height } = img1;
    const diff = new PNG({ width, height });

    const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
    await writeFile(diffPath, PNG.sync.write(diff));

    return numDiffPixels > 0;
  } catch (err) {
    console.error('Error comparing screenshots:', err.message);
    return true; // Consider errors as differences
  }
}

// Main function
async function runVisualRegression(instanceA, instanceB) {
  await ensureDir(tempDir);
  await ensureDir(diffDir);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  // Create screenshot directories
  await ensureDir(screenshotDirA);
  await ensureDir(screenshotDirB);

  // Perform DFS on both instances simultaneously
  const { visitedA, visitedB, screenshots } = await dfs(
    pageA, pageB,
    instanceA, instanceB,
    0 // Initial depth
  );
  
  const screenshotsA = screenshots.a;
  const screenshotsB = screenshots.b;

  // Compare graph structures
  const addedUrls = [...visitedB].filter((url) => !visitedA.has(url));
  const removedUrls = [...visitedA].filter((url) => !visitedB.has(url));

  // Compare screenshots
  const testSuite = report.testSuite()
    .name('Visual Regression Test')
    .time(new Date().toISOString());
  
  console.log(`\nComparing screenshots:\n- Instance A (${screenshotsA.length} screenshots): ${instanceA}\n- Instance B (${screenshotsB.length} screenshots): ${instanceB}`);
  
  const maxScreenshots = Math.max(screenshotsA.length, screenshotsB.length);
  for (let i = 0; i < maxScreenshots; i++) {
    const testCase = testSuite.testCase().name(`Screenshot Comparison ${i + 1}`);
    const diffPath = path.join(diffDir, `diff_${i + 1}.png`);

    if (i >= screenshotsA.length) {
      testCase.failure(`Missing screenshot ${i + 1} in ${instanceA}`);
      console.log(`Screenshot ${i + 1}: Missing in instance A (${instanceA})`);
      continue;
    }

    if (i >= screenshotsB.length) {
      testCase.failure(`Missing screenshot ${i + 1} in ${instanceB}`);
      console.log(`Screenshot ${i + 1}: Missing in instance B (${instanceB})`);
      continue;
    }

    const hasDiff = await compareScreenshots(screenshotsA[i], screenshotsB[i], diffPath);
    if (hasDiff) {
      testCase.failure(`Visual difference detected in screenshot ${i + 1}`);
      console.log(`Screenshot ${i + 1}: Differences detected`);
    } else {
      console.log(`Screenshot ${i + 1}: No differences`);
    }
  }

  // Report graph divergences
  if (addedUrls.length > 0 || removedUrls.length > 0) {
    const testCase = testSuite.testCase().name('Graph Structure Comparison');
    testCase.failure(`Added URLs: ${addedUrls.join(', ')}\nRemoved URLs: ${removedUrls.join(', ')}`);
  }

  // Save JUnit report
  const reportPath = path.join(tempDir, 'report.xml');
  await writeFile(reportPath, report.build());
  console.log(`Report saved to ${reportPath}`);

  await browser.close();
}

// CLI entry point
const [instanceA, instanceB] = process.argv.slice(2);
if (!instanceA || !instanceB) {
  console.error('Usage: node src/index.js <instanceA> <instanceB>');
  process.exit(1);
}

runVisualRegression(instanceA, instanceB).catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
