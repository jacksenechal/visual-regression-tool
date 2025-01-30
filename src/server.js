import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3003;

// Serve static files from tmp directory
app.use(express.static(path.join(__dirname, '..', 'tmp')));

// Function to get directory listing
async function getDirectoryListing(dir) {
  try {
    const fullPath = path.join(__dirname, '..', 'tmp', dir);
    const files = await fs.readdir(fullPath);
    return files.filter(file => !file.startsWith('.'));
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
    return [];
  }
}

// Add an enhanced index page that dynamically lists available files
app.get('/', async (req, res) => {
  const instanceA = process.env.INSTANCE_A || 'Unknown URL';
  const instanceB = process.env.INSTANCE_B || 'Unknown URL';
  try {
    const screenshotsA = await getDirectoryListing('screenshots-a');
    const screenshotsB = await getDirectoryListing('screenshots-b');
    const diffs = await getDirectoryListing('diffs');
    
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Visual Regression Results</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 2em; }
            h1 { color: #333; }
            .section { margin: 2em 0; }
            .file-list { list-style: none; padding: 0; }
            .file-list li { margin: 0.5em 0; }
            .file-list a { color: #0066cc; text-decoration: none; }
            .file-list a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <h1>Visual Regression Results</h1>
          
          <div class="section">
            <h2>Reports</h2>
            <ul class="file-list">
              <li><a href="/report.xml">JUnit Report (XML)</a></li>
            </ul>
          </div>

          <div class="section">
            <h2>Screenshots Instance A - ${req.query.instanceA || 'Unknown URL'} (${screenshotsA.length} files)</h2>
            <ul class="file-list">
              ${screenshotsA.map(file => `
                <li><a href="/screenshots-a/${file}">${file}</a></li>
              `).join('')}
            </ul>
          </div>

          <div class="section">
            <h2>Screenshots Instance B - ${req.query.instanceB || 'Unknown URL'} (${screenshotsB.length} files)</h2>
            <ul class="file-list">
              ${screenshotsB.map(file => `
                <li><a href="/screenshots-b/${file}">${file}</a></li>
              `).join('')}
            </ul>
          </div>

          <div class="section">
            <h2>Diffs (${diffs.length} files)</h2>
            <ul class="file-list">
              ${diffs.map(file => `
                <li><a href="/diffs/${file}">${file}</a></li>
              `).join('')}
            </ul>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Error generating index:', err);
    res.status(500).send('Error generating directory listing');
  }
});

// Error handling middleware
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
  console.log(`Also available at http://localhost:${port}`);
});
