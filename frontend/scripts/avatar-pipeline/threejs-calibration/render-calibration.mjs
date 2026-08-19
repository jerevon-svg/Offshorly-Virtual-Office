// One-off calibration harness: renders a single static front-facing frame of
// Alex's rigged chibi model using three.js, driven by Puppeteer against the
// real installed Chrome (not a downloaded Chromium).
//
// Usage:
//   node scripts/avatar-pipeline/threejs-calibration/render-calibration.mjs [attemptNumber]
//
// Output:
//   scripts/avatar-pipeline/output/meshy-test/threejs-calibration/front-attempt-N.png

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..', '..'); // frontend/
const OUTPUT_DIR = path.join(
  FRONTEND_ROOT,
  'scripts/avatar-pipeline/output/meshy-test/threejs-calibration'
);
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const attempt = process.argv[2] || '1';
const outFile = path.join(OUTPUT_DIR, `front-attempt-${attempt}.png`);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.json': 'application/json',
};

function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(root, urlPath);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found: ' + urlPath);
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const server = await startServer(FRONTEND_ROOT);
  const port = server.address().port;
  const pageUrl = `http://127.0.0.1:${port}/scripts/avatar-pipeline/threejs-calibration/calibration.html`;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => console.log('[page]', msg.text()));
    page.on('pageerror', (err) => console.error('[pageerror]', err));

    await page.setViewport({ width: 600, height: 660 });
    await page.goto(pageUrl, { waitUntil: 'networkidle0' });

    await page.waitForFunction(
      () => window.__renderComplete === true || window.__renderError,
      { timeout: 30000 }
    );

    const renderError = await page.evaluate(() => window.__renderError);
    if (renderError) {
      throw new Error('Render failed in page: ' + renderError);
    }

    const config = await page.evaluate(() => window.__CALIBRATION_CONFIG__);

    const canvasHandle = await page.$('#c');
    await canvasHandle.screenshot({ path: outFile, omitBackground: true });

    console.log('Saved:', outFile);
    console.log('Config used:', JSON.stringify(config, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
