// eye-catchlight.mjs — MISSING CATCHLIGHT POLISH (2026-10-19). Measured on the eye bake, never on who it shows.
// Some generated heads carry no painted highlight in the iris (Kael, Jona: 0–0.9 ‰ of the iris interior is bright) and the eyes
// read lifeless next to the approved five (29–177 ‰; France's small sparkle is the lowest at 29 ‰). A highlight is MISSING below
// 5 ‰ (~6× under France). Only then, ONE soft near-white disc is painted on the visible iris (alpha code 9 — it travels with the
// iris and is copied bit-exact by the optimiser), at the approved five's own measured highlight position in atlas space
// (+0.45 R across, +0.28 R down from the iris centroid; their left eyes read +0.23…+0.73 / +0.17…+0.48) and France's subtle size.
// An eye that already has a highlight is never touched.
export const CATCHLIGHT = Object.freeze({ missingBelow: 0.005, bright: 170, erodeFrac: 0.12, at: [0.45, 0.28], radius: 0.16, soft: 1.5, rgb: [246, 246, 244] });

const lum = (img, k) => 0.3 * img[k * 4] + 0.59 * img[k * 4 + 1] + 0.11 * img[k * 4 + 2];

/** the iris interior's highlight share: bright pixels inside the visible iris eroded by erodeFrac · R (the rim, grown into the
 *  sclera by the bake, is not a highlight). { area, R, cx, cy, inner, bright, frac } — frac null when there is no iris */
export function irisHighlight(img, NX, NY, P = CATCHLIGHT) {
  let M = new Uint8Array(NX * NY), area = 0, cx = 0, cy = 0;
  for (let k = 0; k < NX * NY; k++) if (img[k * 4 + 3] === 9) { M[k] = 1; area++; cx += k % NX; cy += (k / NX) | 0; }
  if (!area) return { area: 0, R: 0, cx: 0, cy: 0, inner: 0, bright: 0, frac: null };
  cx /= area; cy /= area; const R = Math.sqrt(area / Math.PI), er = Math.max(2, Math.round(R * P.erodeFrac));
  for (let it = 0; it < er; it++) { const n = M.slice(); for (let k = 0; k < NX * NY; k++) if (M[k]) { const x = k % NX;
    for (const j of [x > 0 ? k - 1 : -1, x < NX - 1 ? k + 1 : -1, k - NX, k + NX]) if (j < 0 || j >= NX * NY || !M[j]) { n[k] = 0; break; } } M = n; }
  let inner = 0, bright = 0; for (let k = 0; k < NX * NY; k++) if (M[k]) { inner++; if (lum(img, k) >= P.bright) bright++; }
  return { area, R, cx, cy, inner, bright, frac: inner ? bright / inner : null };
}

/** detect → (only if missing) paint → re-measure. Mutates RGB of iris pixels only; alpha codes never change. */
export function catchlightPolish(img, NX, NY, P = CATCHLIGHT) {
  const m0 = irisHighlight(img, NX, NY, P), before = m0.frac;
  if (before === null || before >= P.missingBelow) return { before, added: false, after: before };
  const px = m0.cx + P.at[0] * m0.R, py = m0.cy + P.at[1] * m0.R, r = P.radius * m0.R; let painted = 0;
  for (let k = 0; k < NX * NY; k++) { if (img[k * 4 + 3] !== 9) continue;
    const d = Math.hypot((k % NX) - px, ((k / NX) | 0) - py), w = Math.max(0, Math.min(1, (r + P.soft - d) / (2 * P.soft))); if (!w) continue;
    for (let q = 0; q < 3; q++) img[k * 4 + q] = Math.round(img[k * 4 + q] * (1 - w) + P.rgb[q] * w); painted++; }
  return { before, added: painted > 0, painted, after: irisHighlight(img, NX, NY, P).frac };
}
