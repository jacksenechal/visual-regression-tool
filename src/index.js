import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import fs from 'fs-extra';
const { writeFile, ensureDir, readFile } = fs;
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
function isSameDomain(baseUrl, targetUrl) {
  try {
    // Skip empty or invalid URLs
    if (!targetUrl || typeof targetUrl !== 'string') {
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
async function dfs(page, url, screenshotDir, visited = new Set(), screenshots = []) {
  if (visited.has(url)) return;
  visited.add(url);

  try {
    // Navigate and wait for full page load
    await page.goto(url, { 
      waitUntil: 'networkidle'
    });

    // Wait for animations and dynamic content
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000); // Wait for any animations
    
    // Wait for common loading indicators to disappear
    await Promise.all([
      page.waitForSelector('.loading', { state: 'hidden', timeout: 5000 }).catch(() => {}),
      page.waitForSelector('.spinner', { state: 'hidden', timeout: 5000 }).catch(() => {}),
      page.waitForSelector('[role="progressbar"]', { state: 'hidden', timeout: 5000 }).catch(() => {})
    ]);

    const screenshotPath = path.join(screenshotDir, `${visited.size}.png`);
    await page.screenshot({ 
      path: screenshotPath,
      fullPage: true 
    });
    
    // Verify screenshot was created
    if (await fs.pathExists(screenshotPath)) {
      screenshots.push(screenshotPath);
      console.log(`Screenshot captured: ${screenshotPath}`);
    } else {
      console.error(`Failed to capture screenshot for URL: ${url}`);
    }
  } catch (err) {
    console.error(`Error capturing screenshot for ${url}:`, err.message);
  }

  const links = await page.$$eval('a', (anchors) => anchors.map((a) => a.href));
  
  // Filter links to only include valid HTTP(S) same-domain URLs
  const internalLinks = links.filter(link => {
    try {
      if (!link || typeof link !== 'string') return false;
      
      // Skip non-HTTP protocols
      if (link.startsWith('mailto:') || 
          link.startsWith('tel:') ||
          link.startsWith('javascript:')) {
        return false;
      }

      return isSameDomain(url, link);
    } catch (err) {
      console.error('Error filtering link:', err.message);
      return false;
    }
  });
  
  for (const link of internalLinks) {
    await dfs(page, link, screenshotDir, visited, screenshots);
  }

  return { visited, screenshots };
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

  // Perform DFS on both instances
  const { visited: visitedA, screenshots: screenshotsA } = await dfs(pageA, instanceA, screenshotDirA);
  const { visited: visitedB, screenshots: screenshotsB } = await dfs(pageB, instanceB, screenshotDirB);

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
