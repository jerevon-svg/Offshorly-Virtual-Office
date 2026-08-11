#!/usr/bin/env node
/**
 * One-off fix: app/src/assets/office/characters/lui.png shipped as a raw,
 * un-normalized copy of masters/Lui_Master.png (byte-identical — verified via
 * cmp) — a raw 1024x1024 opaque RGB studio render, never run through any
 * normalize step, unlike bon.png/alex.png/micah.png (transparent-background,
 * trimmed, portrait-scale PNGs).
 *
 * Lui_Master.png predates the chroma-key background prompt fix (it's a
 * locked Stage-1 Master and is never regenerated), so it still has the OLD
 * "clean white/warm-cream studio background" from the pre-fix prompt, not
 * the new fixed magenta (#FF00FF) chroma key. frame-normalize.mjs's shared
 * normalizeFrame() now keys against the fixed magenta color only (see that
 * file's BUGFIX comment), so it cannot correctly key this specific image.
 * This one-off script re-implements the corner-sampled flood-fill keying
 * approach (same algorithm frame-normalize.mjs used before this bugfix pass)
 * for this single legacy image, trims to the character's bounding box, then
 * scales to the same portrait scale bon.png/alex.png/micah.png already use
 * (no fixed-canvas letterbox — those three are each a differently-sized
 * trimmed portrait, not resized to the 191x240 sprite-frame shape).
 *
 * Run: node scripts/avatar-pipeline/normalize-lui-portrait.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MASTER_PATH = path.join(__dirname, "masters", "Lui_Master.png");
const OUT_PATH = path.join(__dirname, "..", "..", "src", "assets", "office", "characters", "lui.png");

// Lui_Master.png's backdrop is a soft vignette/gradient studio background
// with a shadow gradient underneath the character (pre-chroma-key-fix
// prompt era). Sampled pixel values confirm the shadow's darkest core
// (right under the feet) converges toward the same neutral-gray brightness
// range as the character's own gray shirt, so no single global color rule
// can separate 100% of the shadow from 100% of the shirt. Border-seeded
// flood fill (same approach the old pre-chroma-key-fix frame-normalize.mjs
// used) is used instead: it reliably keys the background and the lighter
// outer ring of the shadow, at the cost of leaving a faint shadow remnant
// directly at the feet in some renders — flagged as a known minor
// imperfection for this one legacy asset (the master itself cannot be
// regenerated to remove the shadow at the source).
const BG_COLOR_DIST = 30;

// bon.png/alex.png/micah.png average ~443px tall (465/425/441) at their
// trimmed aspect ratio — match that target height, aspect preserved.
const TARGET_HEIGHT = 443;

function keyBackgroundFloodFillCornerSampled(data, width, height, channels) {
  const inset = 2;
  const corners = [
    [inset, inset],
    [width - 1 - inset, inset],
    [inset, height - 1 - inset],
    [width - 1 - inset, height - 1 - inset],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of corners) {
    const i = (y * width + x) * channels;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  r /= corners.length;
  g /= corners.length;
  b /= corners.length;

  function isBackgroundColor(i) {
    return (
      Math.abs(data[i] - r) <= BG_COLOR_DIST &&
      Math.abs(data[i + 1] - g) <= BG_COLOR_DIST &&
      Math.abs(data[i + 2] - b) <= BG_COLOR_DIST
    );
  }

  const visited = new Uint8Array(width * height);
  const seeds = [];
  for (let x = 0; x < width; x++) seeds.push([x, 0], [x, height - 1]);
  for (let y = 0; y < height; y++) seeds.push([0, y], [width - 1, y]);

  const queue = [];
  for (const [x, y] of seeds) {
    const idx = y * width + x;
    if (visited[idx]) continue;
    const px = idx * channels;
    if (isBackgroundColor(px)) {
      visited[idx] = 1;
      data[px + 3] = 0;
      queue.push(idx);
    }
  }

  while (queue.length) {
    const idx = queue.pop();
    const x = idx % width;
    const y = (idx - x) / width;
    const neighbors = [];
    if (x > 0) neighbors.push(idx - 1);
    if (x < width - 1) neighbors.push(idx + 1);
    if (y > 0) neighbors.push(idx - width);
    if (y < height - 1) neighbors.push(idx + width);
    for (const nIdx of neighbors) {
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      const px = nIdx * channels;
      if (isBackgroundColor(px)) {
        data[px + 3] = 0;
        queue.push(nIdx);
      }
    }
  }
}

// The border-seeded flood fill above reliably keys the background and the
// outer rim of the shadow, but its darkest core (right under the feet)
// converges toward the shirt's own gray and survives keying as a separate,
// disconnected blob of opaque pixels (verified: not 4-connected to the
// character's own opaque silhouette). Isolate the single largest connected
// component of opaque pixels (the character) and key away every other
// opaque blob (the leftover shadow core) — this removes the shadow remnant
// without touching any pixel that's actually part of the character.
function isolateLargestOpaqueComponent(data, width, height, channels) {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const componentSizes = [];

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1) continue;
    const px = start * channels;
    if (data[px + 3] === 0) continue; // transparent, not part of any component
    const label = componentSizes.length;
    let size = 0;
    const stack = [start];
    labels[start] = label;
    while (stack.length) {
      const idx = stack.pop();
      size++;
      const x = idx % width;
      const y = (idx - x) / width;
      const neighbors = [];
      if (x > 0) neighbors.push(idx - 1);
      if (x < width - 1) neighbors.push(idx + 1);
      if (y > 0) neighbors.push(idx - width);
      if (y < height - 1) neighbors.push(idx + width);
      for (const nIdx of neighbors) {
        if (labels[nIdx] !== -1) continue;
        const nPx = nIdx * channels;
        if (data[nPx + 3] === 0) continue;
        labels[nIdx] = label;
        stack.push(nIdx);
      }
    }
    componentSizes.push(size);
  }

  if (componentSizes.length <= 1) return; // nothing to isolate

  let largestLabel = 0;
  for (let i = 1; i < componentSizes.length; i++) {
    if (componentSizes[i] > componentSizes[largestLabel]) largestLabel = i;
  }

  for (let idx = 0; idx < n; idx++) {
    if (labels[idx] !== -1 && labels[idx] !== largestLabel) {
      data[idx * channels + 3] = 0;
    }
  }
}

async function main() {
  const buffer = readFileSync(MASTER_PATH);
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  keyBackgroundFloodFillCornerSampled(data, width, height, channels);
  isolateLargestOpaqueComponent(data, width, height, channels);
  const keyed = sharp(data, { raw: { width, height, channels } }).png();

  let trimmed;
  try {
    trimmed = await keyed.trim({ threshold: 10 }).toBuffer();
  } catch {
    trimmed = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
  }

  const resized = await sharp(trimmed)
    .resize({ height: TARGET_HEIGHT, withoutEnlargement: false })
    .png()
    .toBuffer();

  writeFileSync(OUT_PATH, resized);
  const meta = await sharp(resized).metadata();
  console.log(`Wrote ${OUT_PATH}: ${meta.width}x${meta.height}, alpha=${meta.hasAlpha}`);
}

main().catch((err) => {
  console.error(`normalize-lui-portrait FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
