// Offline bake: renders bonv2's newly-generated Meshy GLBs (already on disk
// under scripts/avatar-pipeline/output/meshy-employees/bonv2/) into the same
// flat animated PNG sprite-sheet format used everywhere else (frontend/src/
// assets/office/characters/chibi-bon/ naming/size convention).
//
// Direct copy of bake-sprites-from-glb.mjs's camera/framing/supersample/
// bottom-anchor pipeline (already calibrated/validated — NOT re-derived
// here), only the input GLB paths + output dir + pose set differ:
//   - idle: 4 directions, 1 frame each
//   - walk: 4 directions x 2 frames (A/B), same 25%/75% duration sampling
//   - sit: 4 directions, 1 frame each
//   - shrug/thinking: 4 directions, 1 frame each (see report — gestures are
//     NOT front-only in the live app: CharacterCanvas.tsx applies
//     headingDegrees to the gesture model same as walk/idle, and
//     OfficeStage.tsx drives that heading off the character's current
//     facing direction, independent of gestureActive; a chat can be open
//     while the character/player is facing any direction)
//
// Does NOT call the Meshy API. Does NOT touch chibi-bon/ or any
// live3dCharacters.ts wiring — output goes to a scratch folder only.
//
// Usage:
//   node scripts/avatar-pipeline/bake-sprites-bonv2.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..'); // frontend/
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const GLB_DIR = 'scripts/avatar-pipeline/output/meshy-employees/bonv2';
const RAW_DIR = path.join(FRONTEND_ROOT, 'scripts/avatar-pipeline/output/bake/bonv2-scratch/raw');
const OUT_DIR = path.join(FRONTEND_ROOT, 'scripts/avatar-pipeline/output/bake/bonv2-scratch');

const TARGET_WIDTH = 191;
const TARGET_HEIGHT = 240;

const WALKING_GLB = `/${GLB_DIR}/bonv2-basic-walking_glb_url.glb`;
const IDLE_GLB = `/${GLB_DIR}/bonv2-idle.glb`;
const SIT_GLB = `/${GLB_DIR}/bonv2-sit.glb`;
const SHRUG_GLB = `/${GLB_DIR}/bonv2-shrug.glb`;
const THINKING_GLB = `/${GLB_DIR}/bonv2-thinking.glb`;

// Same +/-50deg 3/4-view convention as the already-calibrated bon-scratch
// bake (see bake-sprites-from-glb.mjs comment) — do not re-derive.
const DIRECTIONS = [
  { dir: 'front', headingDeg: 0 },
  { dir: 'back', headingDeg: 180 },
  { dir: 'left', headingDeg: -50 },
  { dir: 'right', headingDeg: 50 },
];

const SUPERSAMPLE = 4;
const RAW_WIDTH = TARGET_WIDTH * SUPERSAMPLE;
const RAW_HEIGHT = TARGET_HEIGHT * SUPERSAMPLE;

// Same fixed bottom-anchor row measured off chibi-bon (see
// bake-sprites-from-glb.mjs) — reused as-is.
const TARGET_BOTTOM_FRAC = 214 / 240;

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

async function findAlphaBottomRow(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const ALPHA_THRESH = 10;
  for (let y = height - 1; y >= 0; y--) {
    const rowStart = y * width * channels;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x * channels + 3] > ALPHA_THRESH) {
        return { row: y, height };
      }
    }
  }
  return { row: null, height };
}

async function captureFrame(page, canvasHandle, outFile, bakeArgs) {
  await page.evaluate((args) => window.__bake(args), bakeArgs);
  await page.waitForFunction(
    () => window.__renderComplete === true || window.__renderError,
    { timeout: 30000 }
  );
  const renderError = await page.evaluate(() => window.__renderError);
  if (renderError) {
    throw new Error(`bake failed for ${JSON.stringify(bakeArgs)}: ${renderError}`);
  }
  await canvasHandle.screenshot({ path: outFile, omitBackground: true });
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const server = await startServer(FRONTEND_ROOT);
  const port = server.address().port;
  const pageUrl = `http://127.0.0.1:${port}/scripts/avatar-pipeline/threejs-calibration/bake.html`;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const report = {
    walkClipDuration: null,
    walkSampleTimes: null,
    idleClipDuration: null,
    files: [],
  };

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => console.log('[page]', msg.text()));
    page.on('pageerror', (err) => console.error('[pageerror]', err));

    await page.setViewport({ width: RAW_WIDTH, height: RAW_HEIGHT });
    await page.goto(pageUrl, { waitUntil: 'networkidle0' });

    const canvasHandle = await page.$('#c');

    // Prime the walking glb (locks camera frustum for the whole session).
    await captureFrame(page, canvasHandle, path.join(RAW_DIR, '_prime-walk.png'), {
      glbUrl: WALKING_GLB,
      headingDeg: 0,
      clipTime: 0,
    });
    const duration = await page.evaluate((url) => window.__getClipDuration(url), WALKING_GLB);
    if (!duration || duration <= 0) {
      throw new Error(`walking glb reported no usable animation duration: ${duration}`);
    }
    const tA = duration * 0.25;
    const tB = duration * 0.75;
    report.walkClipDuration = duration;
    report.walkSampleTimes = { A: tA, B: tB };
    console.log(`[bake] walking clip duration=${duration.toFixed(4)}s, sampling A=${tA.toFixed(4)}s B=${tB.toFixed(4)}s`);

    for (const { dir, headingDeg } of DIRECTIONS) {
      const rawA = path.join(RAW_DIR, `${dir}-walk-A.png`);
      const rawB = path.join(RAW_DIR, `${dir}-walk-B.png`);
      await captureFrame(page, canvasHandle, rawA, { glbUrl: WALKING_GLB, headingDeg, clipTime: tA });
      await captureFrame(page, canvasHandle, rawB, { glbUrl: WALKING_GLB, headingDeg, clipTime: tB });
      report.files.push(rawA, rawB);
      console.log(`[bake] captured ${dir} walk-A/B`);
    }

    // Idle: sanity-check across sampled timestamps first (report captured
    // separately as bonv2-idle-sanity/*.png, NOT part of the final sprite
    // set) so a human can quickly compare against the old bowing-idle
    // problem, then bake front/back/left/right at t=0 to match the existing
    // bon-scratch/chibi-bon convention.
    await captureFrame(page, canvasHandle, path.join(RAW_DIR, '_prime-idle.png'), {
      glbUrl: IDLE_GLB,
      headingDeg: 0,
      clipTime: 0,
    });
    const idleDuration = await page.evaluate((url) => window.__getClipDuration(url), IDLE_GLB);
    report.idleClipDuration = idleDuration;
    if (idleDuration && idleDuration > 0) {
      const sanityDir = path.join(RAW_DIR, 'idle-sanity');
      fs.mkdirSync(sanityDir, { recursive: true });
      const fractions = [0, 0.25, 0.5, 0.75];
      for (const frac of fractions) {
        const t = idleDuration * frac;
        const outFile = path.join(sanityDir, `front-idle-t${frac}.png`);
        await captureFrame(page, canvasHandle, outFile, { glbUrl: IDLE_GLB, headingDeg: 0, clipTime: t });
      }
      console.log(`[bake] idle clip duration=${idleDuration.toFixed(4)}s, sanity frames written to ${sanityDir}`);
    } else {
      console.log('[bake] idle glb reported no usable animation duration; falling back to t=0');
    }
    const idleClipTime = 0;

    for (const { dir, headingDeg } of DIRECTIONS) {
      const rawIdle = path.join(RAW_DIR, `${dir}-idle.png`);
      await captureFrame(page, canvasHandle, rawIdle, { glbUrl: IDLE_GLB, headingDeg, clipTime: idleClipTime });
      report.files.push(rawIdle);
      console.log(`[bake] captured ${dir} idle`);
    }

    for (const { dir, headingDeg } of DIRECTIONS) {
      const rawSit = path.join(RAW_DIR, `${dir}-sit.png`);
      await captureFrame(page, canvasHandle, rawSit, { glbUrl: SIT_GLB, headingDeg, clipTime: 0 });
      report.files.push(rawSit);
      console.log(`[bake] captured ${dir} sit`);
    }

    // Shrug/thinking: baked for all 4 directions — see file header comment
    // (gestures are driven by the character's live facing direction in
    // CharacterCanvas.tsx/OfficeStage.tsx, not front-locked).
    for (const { dir, headingDeg } of DIRECTIONS) {
      const rawShrug = path.join(RAW_DIR, `${dir}-shrug.png`);
      await captureFrame(page, canvasHandle, rawShrug, { glbUrl: SHRUG_GLB, headingDeg, clipTime: 0 });
      report.files.push(rawShrug);
      console.log(`[bake] captured ${dir} shrug`);
    }
    for (const { dir, headingDeg } of DIRECTIONS) {
      const rawThinking = path.join(RAW_DIR, `${dir}-thinking.png`);
      await captureFrame(page, canvasHandle, rawThinking, { glbUrl: THINKING_GLB, headingDeg, clipTime: 0 });
      report.files.push(rawThinking);
      console.log(`[bake] captured ${dir} thinking`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  const outputList = [];
  const anchorLog = [];
  for (const rawFile of report.files) {
    const base = path.basename(rawFile);
    const outFile = path.join(OUT_DIR, base);

    const { row: bottomRow, height: rawHeight } = await findAlphaBottomRow(rawFile);
    let shiftY = 0;
    if (bottomRow !== null) {
      const desiredBottomRaw = Math.round(TARGET_BOTTOM_FRAC * rawHeight);
      shiftY = desiredBottomRaw - bottomRow;
    }
    anchorLog.push({ file: base, bottomRow, shiftY });

    const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
    let anchoredBuf;
    if (shiftY > 0) {
      const extended = await sharp(rawFile)
        .extend({ top: shiftY, bottom: 0, left: 0, right: 0, background: transparent })
        .png()
        .toBuffer();
      anchoredBuf = await sharp(extended)
        .extract({ left: 0, top: 0, width: RAW_WIDTH, height: RAW_HEIGHT })
        .png()
        .toBuffer();
    } else if (shiftY < 0) {
      const abs = -shiftY;
      const extended = await sharp(rawFile)
        .extend({ top: 0, bottom: abs, left: 0, right: 0, background: transparent })
        .png()
        .toBuffer();
      anchoredBuf = await sharp(extended)
        .extract({ left: 0, top: abs, width: RAW_WIDTH, height: RAW_HEIGHT })
        .png()
        .toBuffer();
    } else {
      anchoredBuf = await sharp(rawFile).png().toBuffer();
    }

    await sharp(anchoredBuf)
      .resize(TARGET_WIDTH, TARGET_HEIGHT)
      .png()
      .toFile(outFile);
    const meta = await sharp(outFile).metadata();
    outputList.push({ file: outFile, width: meta.width, height: meta.height });
  }

  console.log('\n=== Bake report ===');
  console.log('Walk clip duration:', report.walkClipDuration);
  console.log('Walk sample times:', report.walkSampleTimes);
  console.log('Idle clip duration:', report.idleClipDuration);
  console.log('Bottom-anchor shifts (raw px, +down/-up):');
  for (const a of anchorLog) {
    console.log(`  ${a.file}: bottomRow=${a.bottomRow} shiftY=${a.shiftY}`);
  }
  console.log('Output files:');
  for (const o of outputList) {
    console.log(`  ${o.file} (${o.width}x${o.height})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
