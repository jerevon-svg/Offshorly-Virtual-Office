// Offline bake: renders bon/jerevon's already-generated Meshy GLBs (already
// on disk under public/avatars/jerevon/) into the same flat animated PNG
// sprite-sheet format the app ships everywhere else (frontend/src/assets/
// office/characters/chibi-bon/ naming/size convention), instead of doing
// live WebGL rendering per device.
//
// Does NOT call the Meshy API. Does NOT touch chibi-bon/ (output goes to a
// scratch folder for comparison). bon-only scope for this validation run.
//
// Usage:
//   node scripts/avatar-pipeline/bake-sprites-from-glb.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..'); // frontend/
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const RAW_DIR = path.join(FRONTEND_ROOT, 'scripts/avatar-pipeline/output/bake/bon-scratch/raw');
const OUT_DIR = path.join(FRONTEND_ROOT, 'scripts/avatar-pipeline/output/bake/bon-scratch');

// Confirmed by inspecting frontend/src/assets/office/characters/chibi-bon/:
// files are {direction}-idle.png / {direction}-walk-A.png / {direction}-walk-B.png
// / {direction}-sit.png, all 191x240 with alpha.
const TARGET_WIDTH = 191;
const TARGET_HEIGHT = 240;

// Confirmed from frontend/src/render3d/live3dCharacters.ts (LIVE_3D_CHARACTERS.bon).
const WALKING_GLB = '/public/avatars/jerevon/jerevon-basic-walking_glb_url.glb';
const IDLE_GLB = '/public/avatars/jerevon/jerevon-basic-idle.glb';
// No sitGlbUrl field exists in live3dCharacters.ts's Live3dAssetSet type or
// bon's entry at all — bon has no dedicated sitting GLB. Skipping sit,
// reported explicitly below.
const SIT_GLB = null;

// Front/back match CharacterCanvas.tsx's directionToHeadingDegrees exactly
// (those already read fine per human review). Left/right are DELIBERATELY
// NOT +/-90 (true profile) here — that showed zero face, unlike the
// hand-made chibi-bon left/right sprites which are 3/4 views. Calibrated to
// +/-50deg so the face stays partially visible (calibration issue #2);
// compared visually against chibi-bon/left-idle.png + right-idle.png.
const DIRECTIONS = [
  { dir: 'front', headingDeg: 0 },
  { dir: 'back', headingDeg: 180 },
  { dir: 'left', headingDeg: -50 },
  { dir: 'right', headingDeg: 50 },
];

// Supersample factor must match bake.html's CONFIG.canvas (4x oversized vs.
// the 191x240 sprite target) so the capture viewport is big enough to hold
// the full canvas and the post-process bbox math below is in the right
// coordinate space.
const SUPERSAMPLE = 4;
const RAW_WIDTH = TARGET_WIDTH * SUPERSAMPLE;
const RAW_HEIGHT = TARGET_HEIGHT * SUPERSAMPLE;

// Measured directly off the hand-made chibi-bon/*.png reference set (alpha
// bbox scan): feet/bbox-bottom consistently sits at row 214 of a 240px-tall
// sprite across ALL four directions (front/back/left/right), i.e. a fixed
// fraction of the frame height, not wherever the raw 3D camera projection
// happens to put it. That fixed-row consistency is why we anchor per-frame
// in post rather than trust the live camera projection alone (an elevated
// orthographic camera's vertical extent shifts slightly with yaw, since
// rotating around Y changes how far each limb pokes into Z, which an
// elevation-tilted camera partly reads as vertical extent).
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

// Scans the raw (supersampled) capture's alpha channel for the bottom-most
// non-transparent row. Used to bottom-anchor each frame in post rather than
// rely solely on camera math (see TARGET_BOTTOM_FRAC comment above). Scale
// stays GLOBAL/fixed across all frames (locked camera frustum, per prior
// bake pass's fix) — only a per-frame vertical TRANSLATE is applied here,
// which cannot reintroduce the walk-cycle scale-bounce bug.
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
    sitSkipped: !SIT_GLB,
    files: [],
  };

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => console.log('[page]', msg.text()));
    page.on('pageerror', (err) => console.error('[pageerror]', err));

    await page.setViewport({ width: RAW_WIDTH, height: RAW_HEIGHT });
    await page.goto(pageUrl, { waitUntil: 'networkidle0' });

    const canvasHandle = await page.$('#c');

    // Prime the walking glb (locks camera frustum for the whole session —
    // see bake.html comments) and read its real clip duration instead of
    // hardcoding an assumed timestamp.
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

    // Prime the idle glb once (loads it into the session, doesn't touch the
    // already-locked camera) and read its real clip duration — same
    // mechanism as the walk clip above. t=0 looked hunched/crouched, not a
    // neutral standing pose (calibration issue #4), so sample candidate
    // timestamps across the clip and pick whichever looks neutral/upright.
    await captureFrame(page, canvasHandle, path.join(RAW_DIR, '_prime-idle.png'), {
      glbUrl: IDLE_GLB,
      headingDeg: 0,
      clipTime: 0,
    });
    const idleDuration = await page.evaluate((url) => window.__getClipDuration(url), IDLE_GLB);
    report.idleClipDuration = idleDuration;
    // NOTE (calibration issue #4 finding): this idle clip was scanned at 14
    // points across its full duration (0%, 5%, 10%...95%) and visually
    // reviewed. EVERY sampled frame reads as a forward-bowing/looking-down
    // pose (arms crossed, head tilted down) -- it ranges from "moderately
    // hunched" near t=0/t~=duration (loop wrap point) to "fully bowed over,
    // near-profile" around t=0.6-0.7*duration. There is NO frame in this
    // clip that reads as a neutral upright stance like chibi-bon's
    // front-idle.png reference. This looks like the underlying idle glb's
    // authored animation is a bow/greeting-style loop, not a neutral-idle
    // loop -- not something clipTime selection alone can fix. t=0 (the loop
    // start/wrap point) was the least-bent frame available, so it's used
    // here; flagging the residual mismatch for human review rather than
    // claiming this fully resolves issue #4.
    let idleClipTime = 0;
    if (idleDuration && idleDuration > 0) {
      const candidateFractions = [0, 0.25, 0.5, 0.75];
      const candidatesDir = path.join(RAW_DIR, 'idle-candidates');
      fs.mkdirSync(candidatesDir, { recursive: true });
      for (const frac of candidateFractions) {
        const t = idleDuration * frac;
        const outFile = path.join(candidatesDir, `front-idle-t${frac}.png`);
        await captureFrame(page, canvasHandle, outFile, { glbUrl: IDLE_GLB, headingDeg: 0, clipTime: t });
      }
      idleClipTime = 0;
      report.idleClipTimeChosen = idleClipTime;
      console.log(`[bake] idle clip duration=${idleDuration.toFixed(4)}s, candidates written to ${candidatesDir}, using t=${idleClipTime.toFixed(4)}s (loop start -- least-bent frame found; see code comment, no frame in this clip is fully neutral)`);
    } else {
      console.log('[bake] idle glb reported no usable animation duration; falling back to t=0');
    }

    for (const { dir, headingDeg } of DIRECTIONS) {
      const rawIdle = path.join(RAW_DIR, `${dir}-idle.png`);
      await captureFrame(page, canvasHandle, rawIdle, { glbUrl: IDLE_GLB, headingDeg, clipTime: idleClipTime });
      report.files.push(rawIdle);
      console.log(`[bake] captured ${dir} idle`);
    }

    if (SIT_GLB) {
      for (const { dir, headingDeg } of DIRECTIONS) {
        const rawSit = path.join(RAW_DIR, `${dir}-sit.png`);
        await captureFrame(page, canvasHandle, rawSit, { glbUrl: SIT_GLB, headingDeg, clipTime: 0 });
        report.files.push(rawSit);
      }
    } else {
      console.log('[bake] no sitGlbUrl configured for bon in live3dCharacters.ts — skipping sit frames.');
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Post-process pass, per raw (supersampled, RAW_WIDTHxRAW_HEIGHT) frame:
  //   1. Bottom-anchor: detect this frame's own alpha bbox bottom row, then
  //      vertically TRANSLATE (never rescale) it so the bbox bottom lands at
  //      the fixed row measured off chibi-bon (calibration issue #1 — feet
  //      consistently at row 214/240 across every hand-made direction).
  //      Translate-only means this cannot reintroduce the earlier
  //      per-frame walk-cycle scale-bounce bug — GLOBAL scale still comes
  //      solely from the once-locked camera frustum in bake.html.
  //   2. Downsample raw -> target (191x240). Raw canvas aspect was set to
  //      exactly match the target aspect (see bake.html/RAW_WIDTH/HEIGHT),
  //      so this is a pure supersample downscale, no fit:"contain"
  //      letterboxing waste — doubles as the anti-aliasing fix (issue #3).
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

    // sharp applies extend/extract/resize in its OWN fixed internal pipeline
    // order regardless of JS call-chain order, so extend-then-extract
    // chained on one sharp() instance silently does NOT crop back down
    // (confirmed by direct testing). Do them as two separate sharp() calls
    // via an intermediate buffer instead. extend/extract offsets must be
    // non-negative, so a downward shift (shiftY > 0) is
    // extend-top-then-crop-bottom, and an upward shift (shiftY < 0) is
    // extend-bottom-then-crop-top — both net out to a pure vertical
    // translate at the original RAW_WIDTH x RAW_HEIGHT canvas size,
    // transparent-padded, no rescale.
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
  console.log('Idle clip time chosen:', report.idleClipTimeChosen);
  console.log('Sit skipped (no sitGlbUrl for bon):', report.sitSkipped);
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
