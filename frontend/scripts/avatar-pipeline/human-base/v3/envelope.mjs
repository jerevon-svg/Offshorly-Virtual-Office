// v3/envelope.mjs — HumanBase V3: the FACIAL ENVELOPE as identity. ZERO CREDITS.
// FACE_WIDTH(t): half-width of the face at normalised heights t (0 = eye line, 1 = chin), in units of the eye→chin length.
//   · 2D: measured on the approved Offshorly illustration (the artist's own face outline: skin runs from the face centre,
//     eye line + chin from MediaPipe landmarks);
//   · 3D: measured on a head's skin surface in front of the ear plane (ears excluded).
// STYLE RELATIONSHIP k(t) = 3D envelope / 2D envelope, learned from the APPROVED FIVE (their illustration ↔ their
// approved HumanBase head): how Offshorly's 3D grammar translates a drawn face outline. A new person's 3D target is
// k(t) · their own 2D envelope — their deviations survive, only the shared 2D→3D translation is applied.
import sharp from "sharp";

export const BANDS = [0, 0.15, 0.3, 0.45, 0.6, 0.72, 0.84, 0.93];

const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
/** 2D envelope from an illustration + MediaPipe landmarks (pixel coords): at each band the MediaPipe face-oval contour
 *  gives the approximate edge; the drawn SKIN EDGE nearest to it (within ±0.2 eye→chin) gives the artist's exact outline */
export async function envelope2D(file, L) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), W = info.width, H = info.height;
  const px = (x, y) => { const o = (Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)))) * 4; return [data[o], data[o + 1], data[o + 2], data[o + 3]]; };
  const samp = []; for (const i of [50, 280, 9, 205, 425, 101, 330]) for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) samp.push(px(L[i][0] + dx, L[i][1] + dy));
  const isSkin = (x, y) => { const c = px(x, y); return c[3] > 128 && samp.some((s) => Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]) < 40); };
  // eye line + chin from the landmark model (checked against the drawn chin on the approved eight: within ~3 %; a pixel
  // chin rule overshot into strokes/collars on two of them)
  const eyeY = (L[468][1] + L[473][1]) / 2, cx = (L[1][0] + L[152][0]) / 2, chinY = L[152][1];
  const len = chinY - eyeY;
  const sideA = OVAL.slice(0, 19), sideB = [...OVAL.slice(18), 10];
  const ovalX = (side, y) => { for (let k = 0; k < side.length - 1; k++) { const a = L[side[k]], b = L[side[k + 1]]; if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]); } return null; };
  const edge = (x0, y, dir) => { // nearest skin→non-skin transition (going outward) to x0
    let best = null; const R = 0.2 * len;
    for (let d = 0; d <= R; d++) for (const x of [x0 + d, x0 - d]) { const xin = x - dir, xout = x + dir; if (isSkin(xin, y) && !isSkin(xout, y) && !isSkin(xout + dir, y)) { best = x; break; } if (best !== null) break; }
    return best ?? x0; };
  const out = [];
  const measureRow = (t) => { const y = eyeY + t * len, a = ovalX(sideA, y), b = ovalX(sideB, y);
    if (a === null || b === null) { // below the landmark oval: the face is a plain skin run from the centre
      let l = cx, r = cx; while (l > 0 && isSkin(l - 1, y)) l--; while (r < W - 1 && isSkin(r + 1, y)) r++; return { t, half: (r - l) / 2 / len, oval: 0 }; }
    const [lx, rx] = a < b ? [a, b] : [b, a], l = edge(lx, y, -1), r = edge(rx, y, 1);
    // HAIR-OCCLUDED outline? (the pixels just outside the drawn edge are dark hair, not background/ear) — there the drawn
    // edge is the hair framing, not the face; the 2D→3D style relationship is only learned where it is the face
    const skL = samp.reduce((a, c) => a + 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], 0) / samp.length;
    const dark = (x) => { let n = 0; for (let d = 4; d <= 14; d += 2) { const c = px(x, y); const q = px(x + d * Math.sign(x - cx), y); if (q[3] > 128 && 0.3 * q[0] + 0.59 * q[1] + 0.11 * q[2] < 0.55 * skL) n++; void c; } return n >= 4; };
    return { t, half: (r - l) / 2 / len, oval: (rx - lx) / 2 / len, hairOccluded: dark(l) || dark(r) }; };
  // each band = the MEDIAN of five rows (±2 % of eye→chin): one row's edge can flip between face, ear and hair
  for (const t of BANDS) { const rows = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => measureRow(t + d)).sort((p, q) => p.half - q.half), m = rows[2];
    out.push({ ...m, t, hairOccluded: rows.filter((r) => r.hairOccluded).length >= 3 }); }
  return { len, chinY, bands: out };
}

/** 3D envelope from skin positions: half-width (max |x|) per band, in front of the ear plane */
export function envelope3D(P, { eyeY, chinY, earZ, pick = () => true }) {
  const len = eyeY - chinY, out = [];
  for (const t of BANDS) { const y = eyeY - t * len; let w = 0; for (let i = 0; i < P.length / 3; i++) { if (!pick(i) || Math.abs(P[i * 3 + 1] - y) > 0.01 || P[i * 3 + 2] < earZ + 0.06) continue; w = Math.max(w, Math.abs(P[i * 3])); } out.push({ t, half: w / len }); }
  return { len, bands: out };
}

/** lateral SILHOUETTE CORRECTION of 3D evidence by a per-band ratio: points beyond the feature zone (eyes / mouth stay
 *  where they are) are scaled away from the zone edge; smooth in t, fades out above the brow and toward the ear plane
 *  (the cranium behind the face is not touched). Returns (x, y, z) → x'. */
export function silhouetteRemap(ratio, { eyeY, chinY, earZ, innerAt }) {
  const len = eyeY - chinY;
  const at = (t) => { if (t <= BANDS[0]) return ratio[0]; if (t >= BANDS.at(-1)) return ratio.at(-1); for (let k = 0; k < BANDS.length - 1; k++) if (t <= BANDS[k + 1]) { const f = (t - BANDS[k]) / (BANDS[k + 1] - BANDS[k]); return ratio[k] * (1 - f) + ratio[k + 1] * f; } return 1; };
  const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  return (x, y, z) => { const t = (eyeY - y) / len; let r = at(t);
    const wUp = t < 0 ? 1 - sm(0, 0.45, -t) : t > 1 ? 1 - sm(1, 1.3, t) : 1, wZ = sm(earZ, earZ + 0.12, z); r = 1 + (r - 1) * wUp * wZ;
    const xi = innerAt(Math.max(0, Math.min(1, t))), ax = Math.abs(x); return ax <= xi ? x : Math.sign(x) * (xi + (ax - xi) * r); };
}
