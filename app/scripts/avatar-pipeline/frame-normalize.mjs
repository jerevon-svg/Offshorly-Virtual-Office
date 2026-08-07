/**
 * Shared frame-normalize helper (extracted from gen-server.mjs so it can be
 * reused by one-off batch scripts, not just gen-server's own in-flight job
 * pipeline).
 *
 * Generated frames come back as opaque 1024x1024 RGB PNGs with a "clean
 * white/light gray background" (per the style-bible prompt), not a
 * transparent one, and not cropped/sized to the app's real sprite frame.
 * normalizeFrame() keys near-white/light-gray pixels to transparent, trims to
 * the character's bounding box, then letterboxes into the 191x240 frame the
 * map actually renders (transparent padding, same as Bon's hand-authored
 * PNGs).
 */

import sharp from "sharp";

// Matches Bon's real hand-authored sprite frame dimensions (see
// src/data/bonWalkFrames.ts assets) so generated frames render at the same
// scale on the map.
export const FRAME_WIDTH = 191;
export const FRAME_HEIGHT = 240;

// Background-key threshold (per-channel color distance from the sampled
// corner background color). A flat "near-white" brightness threshold missed
// the warm-cream studio background some renders actually use (e.g. RGB
// ~230,220,210 — blue channel dips well below a naive >232 cutoff), leaving a
// visible halo around the character. Flood-filling from the image border
// instead of testing every pixel globally also protects light-colored
// character details (e.g. white sneakers) that are NOT connected to the
// border, even if their color is close to the background reference.
const BG_COLOR_DIST = 30;

// Uniform margin around the trimmed character within the 191x240 frame. The
// old behavior scaled the trimmed character to fill 100% of the binding
// (height) axis, leaving 0px margin top/bottom — reads as "cut off" next to
// other scene elements (furniture, plants) in the actual room view. 0.88
// (88%) leaves a small, uniform breathing-room margin on all sides while
// still keeping the character large enough to read clearly at sprite scale.
// Same treatment for every character — no per-character tuning. Adjust this
// single constant to retune margin for everyone at once.
const FRAME_FILL_RATIO = 0.88;

function keyBackgroundFloodFill(data, width, height, channels) {
  // Reference background color: average of the four corner pixels (a few px
  // inset to dodge any anti-aliasing at the true edge).
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
  for (let x = 0; x < width; x++) {
    seeds.push([x, 0], [x, height - 1]);
  }
  for (let y = 0; y < height; y++) {
    seeds.push([0, y], [width - 1, y]);
  }

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

export async function normalizeFrame(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  keyBackgroundFloodFill(data, width, height, channels);
  const keyed = sharp(data, { raw: { width, height, channels } }).png();

  let trimmed;
  try {
    trimmed = await keyed.trim({ threshold: 10 }).toBuffer();
  } catch {
    // Fully-transparent/uniform frame can make trim() throw — fall back to
    // the untrimmed keyed image rather than failing the whole job.
    trimmed = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
  }

  // Scale the trimmed character down to fill FRAME_FILL_RATIO of the frame's
  // binding dimension first (leaving a uniform margin on all sides), then
  // center that smaller box within the full FRAME_WIDTH x FRAME_HEIGHT
  // canvas. withoutEnlargement on the second pass ensures it only pads/
  // centers rather than scaling back up to fill the frame.
  const shrunk = await sharp(trimmed)
    .resize(Math.round(FRAME_WIDTH * FRAME_FILL_RATIO), Math.round(FRAME_HEIGHT * FRAME_FILL_RATIO), {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  return sharp(shrunk)
    .resize(FRAME_WIDTH, FRAME_HEIGHT, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}
