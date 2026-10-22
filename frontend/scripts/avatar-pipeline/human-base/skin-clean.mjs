// skin-clean.mjs — PRODUCTION SKIN STAGE for generated identity heads (HumanBase V1.1). ZERO CREDITS. Universal.
//
// Offshorly chibi skin is smooth and evenly painted: LIGHTING makes the shading. Generated heads arrive with baked
// shading in the texture (dark jaw/neck undersides, pale ovals round the eyes, blotchy cheeks) and surface noise in the
// geometry (ridges, faceting, isolated spikes). This stage removes those and nothing else:
//   delightSkin   the texture's LOW-FREQUENCY luminance over skin is flattened toward the face's own median skin (a
//                 per-vertex correction field, smoothed in 3D, rasterised into the texture over skin-coloured texels
//                 only) — brows, lips, eyes, blush hue, freckles and moles (high-frequency paint) are untouched
//   smoothSkin    a gentle Taubin pass on skin AWAY from the identity features (head sides, jaw underside, temples —
//                 never eyes, nose, mouth, ears), and an isolated-spike filter on every head vertex
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** features never touched: eyes, mouth, nose tip (lm space), ears (|x| beyond the cheek band) */
export function featureMask(P, lm, after, { mouthOnly = false } = {}) {
  const n = P.length / 3, F = new Uint8Array(n), ex = Math.abs(lm.eyes.r[0]), ey = lm.eyes.l[1], hw = lm.eyes.halfW, hh = Math.max(lm.eyes.halfH, 0.5 * hw);
  const mc = lm.mouth.c, mw = lm.mouth.halfW;
  for (let v = 0; v < n; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const e = Math.hypot((Math.abs(x) - ex) / (hw * 1.45), (y - ey) / (hh * 1.9)) < 1;
    const m = Math.hypot(x / (mw * 1.6), (y - mc[1]) / (mw * 0.75)) < 1 && z > after.ears.z + 0.1;
    const nose = Math.hypot(x / 0.07, (y - after.nose.y) / 0.07) < 1 && z > after.ears.z + 0.2;
    const ear = Math.abs(x) > after.ears.half * 0.82 && Math.abs(y - ey) < after.eyes.sep * 0.9;
    if (mouthOnly ? m : e || m || nose || ear) F[v] = 1; }
  return F;
}

export function delightSkin(m, rules) {
  const { P, I, UV, COL, isSkin, feature, img, front } = m, R = rules.skin, n = P.length / 3;
  // the low-frequency skin luminance field: a voxel average (skin, non-feature) blurred twice, sampled trilinearly
  const C = R.cell, key = (x, y, z) => `${x},${y},${z}`, acc = new Map();
  let ls = []; for (let v = 0; v < n; v++) { if (!isSkin(v) || feature[v]) continue; const L = lumOf(COL[v * 3], COL[v * 3 + 1], COL[v * 3 + 2]); ls.push(L); void front;
    const k = key(Math.floor(P[v * 3] / C), Math.floor(P[v * 3 + 1] / C), Math.floor(P[v * 3 + 2] / C)), a = acc.get(k) ?? [0, 0]; a[0] += L; a[1]++; acc.set(k, a); }
  ls.sort((a, b) => a - b); const Lt = ls[ls.length >> 1] ?? 180; ls = null;
  let field = new Map([...acc].map(([k, [s, c]]) => [k, [s, c]]));
  for (let pass = 0; pass < R.blur; pass++) { const nx = new Map(); for (const k of field.keys()) { const [x, y, z] = k.split(",").map(Number); let s = 0, c = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const a = field.get(key(x + dx, y + dy, z + dz)); if (a) { s += a[0]; c += a[1]; } } nx.set(k, [s, c]); } field = nx; }
  const low = (x, y, z) => { const fx = x / C - 0.5, fy = y / C - 0.5, fz = z / C - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz); let s = 0, w = 0;
    for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) { const a = field.get(key(x0 + dx, y0 + dy, z0 + dz)); if (!a || !a[1]) continue; const ww = (dx ? fx - x0 : 1 - fx + x0) * (dy ? fy - y0 : 1 - fy + y0) * (dz ? fz - z0 : 1 - fz + z0); s += (a[0] / a[1]) * ww; w += ww; }
    return w > 1e-6 ? s / w : NaN; };
  // per-vertex correction factor (1 on non-skin, features fade in)
  const f = new Float32Array(n).fill(1); let corrected = 0;
  for (let v = 0; v < n; v++) { if (!isSkin(v)) continue; const L = low(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (Number.isNaN(L) || L < 1) continue;
    const k = Math.min(R.fMax, Math.max(R.fMin, (Lt / L) ** R.strength)); f[v] = feature[v] ? 1 + (k - 1) * 0.5 : k; if (Math.abs(f[v] - 1) > 0.02) corrected++; }
  // rasterise into the texture: texels inside triangles touching skin, skin-coloured texels only
  const { rgb, width: TW, height: TH } = img, skinT = (r, g, b) => r > b + 12 && r >= g && lumOf(r, g, b) > 70;
  let texels = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; if (f[a] === 1 && f[b] === 1 && f[c] === 1) continue;
    const q = [a, b, c].map((v) => [UV[v * 2] * TW - 0.5, UV[v * 2 + 1] * TH - 0.5, f[v]]);
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(TH - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(TW - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue; const o = (y * TW + x) * 3; if (!skinT(rgb[o], rgb[o + 1], rgb[o + 2])) continue;
        // hue-preserving: never push a channel past white (a clipped red channel turns skin green-grey)
        let k = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2]; const mx = Math.max(rgb[o], rgb[o + 1], rgb[o + 2]); if (mx * k > 250) k = Math.max(1, 250 / mx);
        for (let ch = 0; ch < 3; ch++) rgb[o + ch] = Math.round(rgb[o + ch] * k); texels++; } }
  return { targetLum: Math.round(Lt), verticesCorrected: corrected, texels };
}

export function smoothSkin(m, rules) {
  const { P, I, isSkin, feature, movable } = m, R = rules.skin, n = P.length / 3;
  const nb = Array.from({ length: n }, () => []); for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; nb[a].push(b); nb[b].push(a); }
  // weld duplicates (UV seams) so smoothing never opens a seam: move a position group as one
  const keyOf = (v) => `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`, grp = new Map();
  for (let v = 0; v < n; v++) { const k = keyOf(v); (grp.get(k) ?? grp.set(k, []).get(k)).push(v); }
  const rep = new Int32Array(n), G2 = new Map(); for (const g of grp.values()) { for (const v of g) rep[v] = g[0]; G2.set(g[0], g); }   // groups by representative (positions move below)
  const nbr = new Map(); for (let v = 0; v < n; v++) { const r = rep[v], s = nbr.get(r) ?? nbr.set(r, new Set()).get(r); for (const u of nb[v]) if (rep[u] !== r) s.add(rep[u]); }
  const reps = [...nbr.keys()], free = new Uint8Array(n);
  for (const r of reps) { const g = G2.get(r); free[r] = g.every((v) => isSkin(v) && !feature[v] && movable[v]) ? 1 : 0; }
  // isolated spikes (any label): a vertex standing far off its neighbours' mean relative to the local edge length
  let spikes = 0;
  for (const r of reps) { if (!g_movable(r)) continue; const s = nbr.get(r); if (s.size < 3) continue; const mean = [0, 0, 0]; let el = 0;
    for (const u of s) { for (let k = 0; k < 3; k++) mean[k] += P[u * 3 + k] / s.size; el += Math.hypot(P[u * 3] - P[r * 3], P[u * 3 + 1] - P[r * 3 + 1], P[u * 3 + 2] - P[r * 3 + 2]) / s.size; }
    const d = Math.hypot(P[r * 3] - mean[0], P[r * 3 + 1] - mean[1], P[r * 3 + 2] - mean[2]); if (d > R.spike * el && d > 0.002) { for (const v of G2.get(r)) for (let k = 0; k < 3; k++) P[v * 3 + k] = mean[k]; spikes++; } }
  function g_movable(r) { return movable[r] && !feature[r]; }
  // Taubin (λ/μ) on free skin
  const step = (lam) => { const D = new Float32Array(n * 3); for (const r of reps) { if (!free[r]) continue; const s = nbr.get(r); if (!s.size) continue; for (const u of s) for (let k = 0; k < 3; k++) D[r * 3 + k] += (P[u * 3 + k] - P[r * 3 + k]) / s.size; }
    for (const r of reps) { if (!free[r]) continue; const g = G2.get(r); const d = [D[r * 3] * lam, D[r * 3 + 1] * lam, D[r * 3 + 2] * lam]; for (const v of g) for (let k = 0; k < 3; k++) P[v * 3 + k] += d[k]; } };
  for (let it = 0; it < R.smoothIters; it++) { step(0.5); step(-0.52); }
  return { spikes, smoothed: reps.filter((r) => free[r]).length };
}

/** HAIR TEXEL REPAINT (universal): generated strands carry the face's colour at TEXEL level (skin stripes between painted
 *  strands) — per-vertex paint cannot reach inside a triangle. Inside every hair triangle's UV footprint, skin-coloured
 *  texels are repainted in the hair's own colour (dark painted strand detail is kept). Mutates img.rgb. */
export function repaintHairTexels(m) {
  const { I, UV, img, hairRGB, isHairTri } = m, { rgb, width: TW, height: TH } = img, skinT = (r, g, b) => r > b + 10 && lumOf(r, g, b) > 60;
  let texels = 0;
  for (let t = 0; t < I.length; t += 3) { if (!isHairTri(t / 3)) continue; const q = [I[t], I[t + 1], I[t + 2]].map((v) => [UV[v * 2] * TW - 0.5, UV[v * 2 + 1] * TH - 0.5]);
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(TH - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(TW - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar; if (w0 < -0.05 || w1 < -0.05 || 1 - w0 - w1 < -0.05) continue;
        const o = (y * TW + x) * 3; if (!skinT(rgb[o], rgb[o + 1], rgb[o + 2])) continue; rgb[o] = hairRGB[0]; rgb[o + 1] = hairRGB[1]; rgb[o + 2] = hairRGB[2]; texels++; } }
  return texels;
}

/**
 * UNDERSIDE RELAXATION (V1.2, universal). The skin under the jaw and round the neck is where the generated neck/bust was
 * cut away: folded, jagged throat skin that reads as a rough, cracked band between jaw and collar (Angelo, Bon). It
 * carries no identity (the jaw CONTOUR seen from the front is kept: the weight fades in only below it), so it is relaxed
 * strongly — Taubin λ/μ (no shrink) on welded positions, faded in from the jawline, hair-shared vertices pinned.
 * Region: downward-facing skin below the mouth, and any skin below chin level.
 */
export function relaxUnderside({ P, I, isHairV, movable, mouthY, chinY, iters = 40 }) {
  const n = P.length / 3, N = new Float32Array(n * 3);
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2], e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; for (const v of [a, b, c]) for (let k = 0; k < 3; k++) N[v * 3 + k] += f[k]; }
  const keyOf = (v) => `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`, grp = new Map();
  for (let v = 0; v < n; v++) { const k = keyOf(v); (grp.get(k) ?? grp.set(k, []).get(k)).push(v); }
  const rep = new Int32Array(n), G2 = new Map(); for (const g of grp.values()) { for (const v of g) rep[v] = g[0]; G2.set(g[0], g); }
  const nbr = new Map(); for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = rep[I[t + k]], b = rep[I[t + (k + 1) % 3]]; if (a === b) continue; (nbr.get(a) ?? nbr.set(a, new Set()).get(a)).add(b); (nbr.get(b) ?? nbr.set(b, new Set()).get(b)).add(a); }
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const w = new Float32Array(n); let region = 0;
  for (const r of nbr.keys()) { const g = G2.get(r); if (!g.every((v) => movable[v] && !isHairV(v))) continue; let ny = 0, l = 0; for (const v of g) { ny += N[v * 3 + 1]; l += Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); } ny /= l || 1;
    const y = P[r * 3 + 1], down = sm(-0.15, -0.45, ny) * sm(mouthY - 0.03, mouthY - 0.08, y), below = sm(chinY + 0.03, chinY - 0.01, y), ww = Math.max(down, below); if (ww > 0.01) { w[r] = ww; region++; } }
  const step = (lam) => { const D = new Map(); for (const r of nbr.keys()) { if (!w[r]) continue; const s = nbr.get(r); const d = [0, 0, 0]; for (const u of s) for (let k = 0; k < 3; k++) d[k] += (P[u * 3 + k] - P[r * 3 + k]) / s.size; D.set(r, d); }
    for (const [r, d] of D) for (const v of G2.get(r)) for (let k = 0; k < 3; k++) P[v * 3 + k] += d[k] * lam * w[r]; };
  for (let it = 0; it < iters; it++) { step(0.6); step(-0.63); }
  return { undersideRelaxed: region };
}
