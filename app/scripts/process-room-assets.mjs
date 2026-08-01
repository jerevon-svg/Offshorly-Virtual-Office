#!/usr/bin/env node
// Fixes the opaque shadow/padding-margin problem on room-kind office assets.
//
// Background: Figma's isolated-node export flattens semi-transparent effects
// (soft drop shadows) against an assumed white canvas, baking the outer
// shadow/padding margin around a room's white-bordered card to fully opaque
// (alpha=255) instead of a true graduated alpha. The result is a visible
// rectangular block of cream/gray color around each room that doesn't blend
// with the floor underneath it. The room's own white border/card look is
// correct and must be preserved untouched — only the margin BEYOND the card
// should become transparent.
//
// Approach: corner-seeded, contiguous (flood-fill) transparency recovery.
// We seed from the 4 corners of the exported PNG (guaranteed to be in the
// outer padding, never room content) and flood-fill through 8-connected
// neighbors whose color is within `tolerance` of the neighbor that reached
// them (not a fixed global reference), so the fill can walk a smooth shadow
// gradient while still stopping hard at a real edge (a big single-step color
// jump, e.g. the white card border, or a dark interior object). A hard
// `edgeCap` (max Chebyshev distance from the nearest image edge) is a
// belt-and-suspenders backstop: some room interiors are light enough in tone
// (e.g. a pale floor plan) that a color-only stop can fail on a weak seam and
// flood the whole interior — capping the fill to a plausible shadow-margin
// depth prevents that regardless of what color-matching alone would do.
// A small feather (box blur of the alpha mask) softens the fill boundary so
// it isn't a hard jagged edge.
//
// Usage:
//   node scripts/process-room-assets.mjs <input.png> <output.png> \
//     --width <targetWidth> --height <targetHeight> \
//     --tolerance <n> --edge-cap <n>
//
// `input.png` should be a fresh Figma export of the room's masked-shape node
// (get_metadata to find the node id, download_assets to export it — see
// notes below for picking scale/tolerance/edge-cap for a new room).
//
// Notes for running this on the next batch of rooms:
// 1. Get the room's exact masked-shape node id via get_metadata on its
//    parent frame — do not reuse/guess a stale id.
// 2. Check the CURRENT production PNG's pixel dimensions (sharp/sips) — this
//    is the resolution to reproduce; do not introduce a new resolution.
// 3. download_assets caps `defaultScale` at 4. Export once at defaultScale=1
//    to compare against the node's frame width/height from get_metadata: the
//    ratio (export size / frame size) tells you the shadow-bleed margin the
//    isolated export adds (this repo's rooms all bled ~10 units at scale 1
//    on every side). Export again at defaultScale=4 (the max) and compute the
//    extra uniform resize factor needed to reach the current production
//    pixel dimensions (do NOT resize non-uniformly / crop / reframe — only a
//    uniform scale-up is safe, since the manifest's x/y/width/height and any
//    independently-positioned characters assume the existing framing).
// 4. Run this script against the scale-4 export with a generous tolerance
//    (start ~20-24) and a conservative edgeCap (start near the scale-4
//    margin estimate from step 3, e.g. margin*1.3 to margin*2 — err tight
//    for rooms whose interior floor/background is a light/neutral tone
//    close to the shadow color, since that's the exact failure mode where
//    color-only flood fill leaks into interior content).
// 5. ALWAYS visually verify (composite over magenta, then over a copy of the
//    real floor.png at the manifest position) before overwriting the real
//    asset. Check all 4 corners' alpha is ~0 and that no interior content
//    (borders, furniture, text) was eaten into.
//
// Requires: sharp (already a devDependency of this app).

import sharp from "sharp";
import path from "node:path";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      flags[key] = val;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [inputPath, outputPath] = positional;

if (!inputPath || !outputPath) {
  console.error(
    "Usage: node scripts/process-room-assets.mjs <input.png> <output.png> " +
      "[--width N --height N] [--tolerance N] [--edge-cap N]"
  );
  process.exit(1);
}

const TOLERANCE = flags.tolerance ? Number(flags.tolerance) : 22;
const EDGE_CAP = flags["edge-cap"] ? Number(flags["edge-cap"]) : Infinity;
const TARGET_WIDTH = flags.width ? Number(flags.width) : null;
const TARGET_HEIGHT = flags.height ? Number(flags.height) : null;
const FEATHER_RADIUS = flags["feather-radius"] ? Number(flags["feather-radius"]) : 1;

async function main() {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info; // channels === 4 (RGBA)

  const filled = new Uint8Array(width * height); // 1 = flooded -> becomes transparent
  const visited = new Uint8Array(width * height);

  function colorAt(x, y) {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  }
  function within(a, b, tol) {
    return (
      Math.abs(a[0] - b[0]) <= tol &&
      Math.abs(a[1] - b[1]) <= tol &&
      Math.abs(a[2] - b[2]) <= tol
    );
  }
  function edgeDistance(x, y) {
    return Math.min(x, width - 1 - x, y, height - 1 - y);
  }

  const seeds = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];

  const queue = [];
  for (const [sx, sy] of seeds) {
    const p = sy * width + sx;
    if (!visited[p]) {
      visited[p] = 1;
      filled[p] = 1;
      queue.push([sx, sy]);
    }
  }

  const neighbors8 = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  let head = 0;
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    const cColor = colorAt(cx, cy);
    for (const [dx, dy] of neighbors8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (visited[np]) continue;
      if (edgeDistance(nx, ny) > EDGE_CAP) {
        visited[np] = 1; // beyond the safety cap; never fill regardless of color
        continue;
      }
      const nColor = colorAt(nx, ny);
      if (within(cColor, nColor, TOLERANCE)) {
        visited[np] = 1;
        filled[np] = 1;
        queue.push([nx, ny]);
      } else {
        visited[np] = 1; // checked-but-rejected; not filled
      }
    }
  }

  const filledCount = filled.reduce((a, b) => a + b, 0);
  console.error(
    `[flood-fill] ${path.basename(inputPath)}: ${filledCount} / ${width * height} px flagged ` +
      `(${((filledCount / (width * height)) * 100).toFixed(1)}%) tol=${TOLERANCE} edgeCap=${EDGE_CAP}`
  );

  // Manual separable box blur (two passes ~ approximates gaussian) on the
  // 0/255 mask. Done in plain JS rather than via an image library's raw
  // single-channel pipeline, which can silently reinterpret band count.
  function boxBlur(src, w, h, radius) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -radius; x <= radius; x++) {
        acc += src[row + Math.min(w - 1, Math.max(0, x))];
      }
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (radius * 2 + 1);
        const addX = Math.min(w - 1, x + radius + 1);
        const subX = Math.max(0, x - radius);
        acc += src[row + addX] - src[row + subX];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++) {
        acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      }
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (radius * 2 + 1);
        const addY = Math.min(h - 1, y + radius + 1);
        const subY = Math.max(0, y - radius);
        acc += tmp[addY * w + x] - tmp[subY * w + x];
      }
    }
    return out;
  }

  const alphaMask = new Float32Array(width * height);
  for (let p = 0; p < width * height; p++) alphaMask[p] = filled[p] ? 0 : 255;

  let feathered = boxBlur(alphaMask, width, height, FEATHER_RADIUS);
  feathered = boxBlur(feathered, width, height, FEATHER_RADIUS);

  const outBuf = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const si = p * channels;
    const di = p * 4;
    outBuf[di] = data[si];
    outBuf[di + 1] = data[si + 1];
    outBuf[di + 2] = data[si + 2];
    outBuf[di + 3] = Math.max(0, Math.min(255, Math.round(feathered[p])));
  }

  let pipeline = sharp(outBuf, { raw: { width, height, channels: 4 } });

  if (TARGET_WIDTH && TARGET_HEIGHT) {
    pipeline = pipeline.resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "fill", kernel: "lanczos3" });
  }

  await pipeline
    .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10, dither: 0.5 })
    .toFile(outputPath);

  const finalMeta = await sharp(outputPath).metadata();
  const { data: finalData, info: finalInfo } = await sharp(outputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fw = finalInfo.width, fh = finalInfo.height, fc = finalInfo.channels;
  const corners = [
    [0, 0], [fw - 1, 0], [0, fh - 1], [fw - 1, fh - 1],
  ];
  console.error(`[output] ${path.basename(outputPath)}: ${fw}x${fh} hasAlpha=${finalMeta.hasAlpha}`);
  for (const [x, y] of corners) {
    const i = (y * fw + x) * fc;
    console.error(`  corner (${x},${y}) = ${finalData[i]},${finalData[i + 1]},${finalData[i + 2]},${finalData[i + 3]}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
