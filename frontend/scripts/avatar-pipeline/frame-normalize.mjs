/**
 * Shared frame-normalize helper (extracted from gen-server.mjs so it can be
 * reused by one-off batch scripts, not just gen-server's own in-flight job
 * pipeline).
 *
 * Generated frames come back as opaque 1024x1024 RGB PNGs against a fixed
 * solid chroma-key background (pure magenta #FF00FF requested — see
 * generate-production-v2.mjs's OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE), not a
 * transparent one, and not cropped/sized to the app's real sprite frame.
 * normalizeFrame() keys the chroma background to transparent, trims to the
 * character's bounding box, then letterboxes into the 191x240 frame the map
 * actually renders (transparent padding, same as Bon's hand-authored PNGs).
 *
 * BUGFIX (Alex crown crop + Bon/Micah grey shadow-band artifact): the old
 * approach sampled the four image corners at runtime and keyed near that
 * sampled color. Alex's near-white bald head is close enough to a near-white
 * background sample to get keyed away (flat-cropped crown), and the old
 * "clean white/light gray background" prompt also requested a soft ground
 * shadow whose darker gradient core was far enough from the sampled corner
 * color to survive keying and get baked into the trimmed bounding box as a
 * hard-edged artifact. Now that the prompt fixes the background to a
 * saturated magenta/pink chroma color no skin/hair/clothing tone comes close
 * to (and asks for zero shadow), keying against that hue is both more
 * accurate (no per-image sampling ambiguity) and immune to near-white heads.
 *
 * BUGFIX (fixed-RGB-distance keying missed real variance across renders):
 * gpt-image-1 does not render the requested #FF00FF exactly, and its actual
 * output varies MORE than a single fixed reference color + modest tolerance
 * can cover — sampled corners across many real generations range from a
 * hot-pink ~(250, 20, 150) to a more purple-leaning ~(240, 14, 220), and a
 * soft shadow the model sometimes still renders despite the "no shadow"
 * instruction darkens/desaturates the same hue further. A fixed-color
 * distance test either missed the background entirely (left it fully
 * opaque) or, worse, let a large shadowed region fall through to
 * despillCharacterSurface, which then crushed it to near-black (very low
 * green channel -> desaturating red/blue down to green produces a big solid
 * black smudge, not a subtle tint). Fixed by testing for the actual
 * invariant across all observed variance instead of a fixed color: the
 * background/shadow-on-background hue always has a LOW green channel and a
 * red channel MUCH higher than green, a combination none of the 4
 * employees' skin, hair, or clothing colors exhibit (see isBackgroundHue()).
 */

import sharp from "sharp";

// Matches Bon's real hand-authored sprite frame dimensions (see
// src/data/bonWalkFrames.ts assets) so generated frames render at the same
// scale on the map.
export const FRAME_WIDTH = 191;
export const FRAME_HEIGHT = 240;

// Hue-based background/shadow test, not a fixed-RGB-distance test (see file
// header BUGFIX note). True for pure chroma pink, pale chroma-tinted edge
// fringe, and the model's occasional residual shadow-on-chroma (a darker,
// less saturated version of the same hue) alike — all of them keep a low
// green channel with red pulled well above it. Verified against every
// employee's actual master colors (skin: green is their SECOND-highest
// channel, never anywhere near this low relative to red; hair: near-black,
// red is not meaningfully above green; clothing: darkest employee clothing
// is black/navy/gray, none of which pulls red above green by this margin).
// If a future employee's outfit includes real red/pink/magenta, this rule
// (and the per-person master photos) need a one-off override.
function isBackgroundHue(r, g, b) {
  return g <= 60 && r - g >= 80;
}

function keyBackgroundFloodFill(data, width, height, channels) {
  function isBackgroundColor(i) {
    return isBackgroundHue(data[i], data[i + 1], data[i + 2]);
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

// Despill/erosion pass: anti-aliased edge pixels right at the character's
// silhouette often blend partway toward the chroma color without ever
// crossing isBackgroundHue's threshold, so they survive the flood fill as
// opaque pixels with a visible tint. For any still-opaque pixel that (a)
// touches at least one now-transparent neighbor and (b) leans toward the
// background hue even loosely, key it away too. This erodes the boundary by
// one extra ring, trading a hair of silhouette for a clean edge with no
// chroma fringe.
function isNearBackgroundHue(r, g, b) {
  return g <= 90 && r - g >= 40;
}

function despillEdges(data, width, height, channels) {
  const toClear = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const px = idx * channels;
      if (data[px + 3] === 0) continue; // already transparent
      if (!isNearBackgroundHue(data[px], data[px + 1], data[px + 2])) continue;
      let touchesTransparent = false;
      if (x > 0 && data[(idx - 1) * channels + 3] === 0) touchesTransparent = true;
      else if (x < width - 1 && data[(idx + 1) * channels + 3] === 0) touchesTransparent = true;
      else if (y > 0 && data[(idx - width) * channels + 3] === 0) touchesTransparent = true;
      else if (y < height - 1 && data[(idx + width) * channels + 3] === 0) touchesTransparent = true;
      if (touchesTransparent) toClear.push(px);
    }
  }
  for (const px of toClear) data[px + 3] = 0;
}

// Stray chroma-colored specks baked INSIDE the character silhouette (e.g. a
// 1-3px fleck of the chroma hue fully surrounded by opaque non-background
// pixels) are topologically isolated from the border-reachable background
// region, so neither the flood fill above nor despillEdges (which only
// clears pixels touching an already-transparent neighbor) can reach them.
// Global position-independent pass: key away ANY pixel matching the
// background hue, regardless of position/connectivity.
function keyStrayChromaSpecks(data, width, height, channels) {
  const n = width * height;
  for (let idx = 0; idx < n; idx++) {
    const px = idx * channels;
    if (data[px + 3] === 0) continue;
    if (isBackgroundHue(data[px], data[px + 1], data[px + 2])) {
      data[px + 3] = 0;
    }
  }
}

// Isolate the single largest connected component of opaque pixels (the
// character) and key away every other opaque blob. The passes above can
// still leave small disconnected chroma-tinted smudges that don't quite
// cross even the loose thresholds — these are never part of the character's
// own silhouette, so dropping every component except the largest cleans
// them up without risking any pixel that's actually part of the character.
function isolateLargestOpaqueComponent(data, width, height, channels) {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const componentSizes = [];

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1) continue;
    const px = start * channels;
    if (data[px + 3] === 0) continue;
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

  if (componentSizes.length <= 1) return;

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

// Real "color spill" (classic green-screen-keying terminology, here for a
// magenta backdrop): the render's ambient/specular lighting sometimes picks
// up a faint tint of the backdrop color and bakes it into nearby glossy
// surfaces on the subject itself (fully opaque pixels, not background, not
// connected to any transparent region — confirmed via direct pixel
// sampling, e.g. a shoe highlight around (186, 27, 130)). No
// alpha/background-keying pass above can fix this since the pixel really is
// part of the character. Desaturate any opaque pixel that leans toward the
// background hue back to its own green channel. None of the 4 employees'
// skin/hair/clothing colors trigger isNearBackgroundHue (see that
// function's comment), so this only ever touches genuine spill.
function despillCharacterSurface(data, width, height, channels) {
  const n = width * height;
  for (let idx = 0; idx < n; idx++) {
    const px = idx * channels;
    if (data[px + 3] === 0) continue;
    const g = data[px + 1];
    if (isNearBackgroundHue(data[px], g, data[px + 2])) {
      // Fully match R and B to G rather than partially subtracting — a
      // partial reduction left a muddy dark-red cast on some blend pixels
      // (R-high/B-medium/G-low doesn't desaturate to neutral unless both R
      // and B are pulled all the way down to G). Matching fully turns any
      // such pixel into a neutral gray/black tone that blends invisibly
      // with black clothing/shoes instead of reading as a red/black smudge.
      data[px] = g;
      data[px + 2] = g;
    }
  }
}

function zeroColorWhereTransparent(data, width, height, channels) {
  const n = width * height;
  for (let idx = 0; idx < n; idx++) {
    const px = idx * channels;
    if (data[px + 3] === 0) {
      data[px] = 0;
      data[px + 1] = 0;
      data[px + 2] = 0;
    }
  }
}

// Uniform margin around the trimmed character within the 191x240 frame. The
// old behavior scaled the trimmed character to fill 100% of the binding
// (height) axis, leaving 0px margin top/bottom — reads as "cut off" next to
// other scene elements (furniture, plants) in the actual room view. 0.88
// (88%) leaves a small, uniform breathing-room margin on all sides while
// still keeping the character large enough to read clearly at sprite scale.
// Same treatment for every character — no per-character tuning. Adjust this
// single constant to retune margin for everyone at once.
const FRAME_FILL_RATIO = 0.88;

export async function normalizeFrame(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  keyBackgroundFloodFill(data, width, height, channels);
  despillEdges(data, width, height, channels);
  keyStrayChromaSpecks(data, width, height, channels);
  isolateLargestOpaqueComponent(data, width, height, channels);
  // Runs only on what's left opaque (the character) after every
  // background-removal pass above, so it never fights the background-keying
  // tests by desaturating background pixels before they're identified.
  despillCharacterSurface(data, width, height, channels);
  // BUGFIX (faint chroma-colored smudge surviving into the FINAL
  // resized/letterboxed frame even after every keying pass above cleanly
  // zeroed alpha on the raw 1024x1024 image): sharp/libvips's resize()
  // interpolates RGB somewhat independently of alpha for pixels near an
  // alpha=0/alpha>0 boundary, so a fully-transparent pixel that still holds
  // its original chroma RGB value can bleed that color back in once the
  // image is scaled down (the two resize() calls below). Zeroing the RGB of
  // every already-transparent pixel before any resize happens (mimicking a
  // premultiplied-alpha representation) means there is no chroma color left
  // to bleed back in, regardless of how the resize kernel blends neighbors.
  zeroColorWhereTransparent(data, width, height, channels);
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
