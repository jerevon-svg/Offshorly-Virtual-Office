// art-class.mjs — WHAT KIND OF ILLUSTRATION is this? (2026-10-13) Measured from the image, never from who it shows.
// FLAT-colour art (the approved 2D sprites) paints skin in a few exact colours; a SOFT-shaded render (the Offshorly soft-3D
// chibi illustrations — what the automated photo → illustration stage produces) paints it as smooth gradients. Measured on
// every sprite and illustration on disk (2026-10-13): the four commonest exact skin colours cover 0.23–0.98 of a flat
// sprite's skin and 0.009–0.044 of a soft render's. The threshold sits in that gap.
export const SOFT_BELOW = 0.12;
const warmSkin = (r, g, b) => r > b + 25 && 0.3 * r + 0.59 * g + 0.11 * b > 120;   // prep-reference's isWarm

/** { flatness, soft, skinPixels } of RGBA pixels: flatness = the share of opaque warm-skin pixels covered by the 4 commonest
 *  exact colours. No skin at all = not soft (the flat-art path, unchanged). */
export function artClass(rgba) {
  const h = new Map(); let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 200 || !warmSkin(rgba[i], rgba[i + 1], rgba[i + 2])) continue;
    n++; const k = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]; h.set(k, (h.get(k) ?? 0) + 1);
  }
  if (!n) return { flatness: null, soft: false, skinPixels: 0 };
  const flatness = [...h.values()].sort((a, b) => b - a).slice(0, 4).reduce((a, b) => a + b, 0) / n;
  return { flatness: +flatness.toFixed(4), soft: flatness < SOFT_BELOW, skinPixels: n };
}

/** keep only the largest opaque region above row `cut` (the head with its hair and neck); every other island — a T-pose's
 *  arms once the shirt between them is gone — becomes transparent. Returns the number of pixels cleared. */
export function keepLargestRegion(rgba, W, cut, minAlpha = 10) {
  const N = W * cut, comp = new Int32Array(N).fill(-1), sizes = [];
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0 || rgba[s * 4 + 3] <= minAlpha) continue;
    const id = sizes.length, q = [s]; comp[s] = id; let n = 0;
    while (q.length) { const i = q.pop(); n++; const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && comp[j] < 0 && rgba[j * 4 + 3] > minAlpha) { comp[j] = id; q.push(j); } }
    sizes.push(n);
  }
  if (sizes.length < 2) return 0;
  const keep = sizes.indexOf(Math.max(...sizes)); let cleared = 0;
  for (let i = 0; i < N; i++) if (comp[i] >= 0 && comp[i] !== keep) { rgba[i * 4 + 3] = 0; cleared++; }
  return cleared;
}
