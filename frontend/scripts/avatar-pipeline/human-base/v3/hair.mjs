// v3/hair.mjs — HumanBase V3 proof: MODULAR HAIR as a separate closed solid built ON the canonical head. ZERO CREDITS.
//
// The smallest credible hair method for the proof (not the final hair generator): a hair THICKNESS MAP over the sphere of
// directions around the head centre (from 3D hair evidence, or from a 2D silhouette + prior), turned into a signed
// distance field and meshed. The hair/head relationship is a CONSTRUCTION RULE, never a cut:
//   · hair = { points outside the head by ≥ ε } ∩ { inside the hair outer surface }  → hair can never enter the skull,
//     the ears or the face, and the head under it stays complete (nothing is removed from the head, ever);
//   · ears: when the hair is not thick enough to cover an ear, it keeps a clearance around it (a clean tuck line) —
//     decided by measuring coverage, not by who the employee is;
//   · neck/body: hair keeps a clearance from the neck column and never goes below the shoulder line;
//   · the lower hair edge is a level set of a smoothed field → a smooth edge, never a triangle staircase.
// Output: one closed manifold mesh (or a few closed pieces), Head-rigid in the proof.
import { TriIndex, compact, extendSDF, sdfGrid, surfaceNetsGrid, topo, vertexNormals } from "./geom.mjs";

export const NT = 128, NP = 256;
export const dirBin = (dx, dy, dz) => { const r = Math.hypot(dx, dy, dz) || 1e-9; const th = Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NT - 0.5, ph = (Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NP - 0.5; return [th, ph, r]; };
export function sampleMap(M, th, ph) {
  const t0 = Math.max(0, Math.min(NT - 1, Math.floor(th))), t1 = Math.min(NT - 1, t0 + 1), ft = Math.max(0, Math.min(1, th - t0));
  const p0 = ((Math.floor(ph) % NP) + NP) % NP, p1 = (p0 + 1) % NP, fp = ph - Math.floor(ph);
  return (M[t0 * NP + p0] * (1 - fp) + M[t0 * NP + p1] * fp) * (1 - ft) + (M[t1 * NP + p0] * (1 - fp) + M[t1 * NP + p1] * fp) * ft;
}
/** majority canonical region per direction bin */
export function regionBins(P, centre, region) {
  const votes = new Map(), out = new Uint8Array(NT * NP);
  for (let i = 0; i < P.length / 3; i++) { const [th, ph] = dirBin(P[i * 3] - centre[0], P[i * 3 + 1] - centre[1], P[i * 3 + 2] - centre[2]); const k = Math.round(Math.min(NT - 1, Math.max(0, th))) * NP + ((Math.round(ph) % NP) + NP) % NP; const m = votes.get(k) ?? new Map(); m.set(region[i], (m.get(region[i]) ?? 0) + 1); votes.set(k, m); }
  for (const [k, m] of votes) out[k] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (let pass = 0; pass < 8; pass++) for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (out[k]) continue; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt >= 0 && tt < NT && out[tt * NP + ((p + dp + NP) % NP)]) { out[k] = out[tt * NP + ((p + dp + NP) % NP)]; break; } } }
  return out;
}
/** direction bins whose head surface belongs to the canonical FACE (face, eyes, nose, mouth, jaw regions) */
export function faceBinsOf(P, centre, region, isFace) {
  const votes = new Float32Array(NT * NP), cnt = new Float32Array(NT * NP);
  for (let i = 0; i < P.length / 3; i++) { const [th, ph] = dirBin(P[i * 3] - centre[0], P[i * 3 + 1] - centre[1], P[i * 3 + 2] - centre[2]); const k = Math.round(Math.min(NT - 1, Math.max(0, th))) * NP + ((Math.round(ph) % NP) + NP) % NP; cnt[k]++; if (isFace(region[i])) votes[k]++; }
  const out = new Uint8Array(NT * NP); for (let k = 0; k < NT * NP; k++) out[k] = cnt[k] && votes[k] / cnt[k] > 0.5 ? 1 : 0;
  // fill empty bins from neighbours, then grow by one bin (the face edge belongs to the face)
  for (let pass = 0; pass < 6; pass++) for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (cnt[k]) continue; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt >= 0 && tt < NT && out[tt * NP + ((p + dp + NP) % NP)]) { out[k] = 1; break; } } }
  return out;
}
/** radius of the head surface per direction bin (max radius of head vertices in the bin, holes filled from neighbours) */
export function headRadiusMap(P, centre) {
  const R = new Float32Array(NT * NP).fill(-1);
  for (let i = 0; i < P.length / 3; i++) { const [th, ph, r] = dirBin(P[i * 3] - centre[0], P[i * 3 + 1] - centre[1], P[i * 3 + 2] - centre[2]); const k = Math.round(Math.min(NT - 1, Math.max(0, th))) * NP + ((Math.round(ph) % NP) + NP) % NP; if (r > R[k]) R[k] = r; }
  for (let pass = 0; pass < 20; pass++) { let missing = 0; const T = Float32Array.from(R);
    for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (R[k] >= 0) continue; missing++; let s = 0, c = 0; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const v = R[tt * NP + ((p + dp + NP) % NP)]; if (v >= 0) { s += v; c++; } } if (c) T[k] = s / c; }
    R.set(T); if (!missing) break; }
  return R;
}
/** blur over the sphere grid (wraps in azimuth) */
export function blurMap(M, passes = 1, mask = null) {
  for (let it = 0; it < passes; it++) { const T = Float32Array.from(M);
    for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (mask && !mask[k]) continue; let s = M[k] * 2, c = 2;
      for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const kk = tt * NP + ((p + dp + NP) % NP); if (mask && !mask[kk]) continue; s += M[kk]; c++; } T[k] = s / c; }
    M.set(T); }
  return M;
}
/** morphological cleanup of a presence mask: close small holes, drop small islands */
export function cleanMask(mask, { close = 2, minIsland = 40 } = {}) {
  const at = (t, p) => mask[t * NP + ((p + NP) % NP)];
  const dil = (m) => { const o = Uint8Array.from(m); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) if (!m[t * NP + p]) for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt >= 0 && tt < NT && m[tt * NP + ((p + dp + NP) % NP)]) { o[t * NP + p] = 1; break; } } return o; };
  const ero = (m) => { const o = Uint8Array.from(m); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) if (m[t * NP + p]) for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt >= 0 && tt < NT && !m[tt * NP + ((p + dp + NP) % NP)]) { o[t * NP + p] = 0; break; } } return o; };
  void at; let m = Uint8Array.from(mask); for (let i = 0; i < close; i++) m = dil(m); for (let i = 0; i < close; i++) m = ero(m);
  const comp = new Int32Array(NT * NP).fill(-1); let c = 0;
  for (let k = 0; k < NT * NP; k++) { if (!m[k] || comp[k] >= 0) continue; const st = [k], mem = [k]; comp[k] = c;
    while (st.length) { const q = st.pop(), t = Math.floor(q / NP), p = q % NP; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const kk = tt * NP + ((p + dp + NP) % NP); if (m[kk] && comp[kk] < 0) { comp[kk] = c; st.push(kk); mem.push(kk); } } }
    if (mem.length < minIsland) for (const q of mem) m[q] = 0; c++; }
  return m;
}

/** HOLES ARE NEVER SHIPPED: every hair-free region on the sphere that is not large (face, under the neck, a genuine
 *  bald/shaved area) is enclosed by hair and is filled — the head under hair can never show through a gap */
export function fillEnclosed(mask, keepOpen = 0.03) {
  const out = Uint8Array.from(mask), comp = new Int32Array(NT * NP).fill(-1); let c = 0;
  for (let k = 0; k < NT * NP; k++) { if (mask[k] || comp[k] >= 0) continue; const st = [k], mem = [k]; comp[k] = c;
    while (st.length) { const q = st.pop(), t = Math.floor(q / NP), p = q % NP; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const kk = tt * NP + ((p + dp + NP) % NP); if (!mask[kk] && comp[kk] < 0) { comp[kk] = c; st.push(kk); mem.push(kk); } } }
    if (mem.length < keepOpen * NT * NP) for (const q of mem) out[q] = 1; c++; }
  return out;
}

/** thickness map from 3D hair evidence: per direction, hair outer radius − head radius (−edge where no hair) */
export function thicknessFrom3D(hairP, headR, centre, { tMin = 0.026, near = 0.06, faceBins = null, faceStand = 0.012, underBins = null, hangStand = 0.08, keepOpen = 0.03, backBins = null } = {}) {
  // PRESENCE comes from the evidence (is there hair in this direction, near or outside the head surface?); SHAPE is the
  // evidence's outer radius, but never thinner than tMin over the CANONICAL skull — where the canonical skull is fuller
  // than the generated head (nape, occiput), the hair hugs the canonical skull instead of exposing it
  const Rout = new Float32Array(NT * NP).fill(-1);
  for (let i = 0; i < hairP.length / 3; i++) { const [th, ph, r] = dirBin(hairP[i * 3] - centre[0], hairP[i * 3 + 1] - centre[1], hairP[i * 3 + 2] - centre[2]); const k = Math.round(Math.min(NT - 1, Math.max(0, th))) * NP + ((Math.round(ph) % NP) + NP) % NP; if (r > Rout[k]) Rout[k] = r; }
  // over the FACE (canonical face regions) hair only counts where it genuinely stands off the face — hair-coloured brow,
  // liner and lash geometry lying on the face is paint, not hair (it reaches the head through the texture bake)
  // under the head (canonical underside) hair only exists where it genuinely HANGS clear of the head (bob, long hair):
  // short hair never wraps under the skull into a collar round the neck
  let mask = new Uint8Array(NT * NP); for (let k = 0; k < NT * NP; k++) mask[k] = Rout[k] > 0 && Rout[k] > headR[k] + (faceBins?.[k] ? faceStand : underBins?.[k] ? hangStand : -near) ? 1 : 0;
  mask = cleanMask(mask);
  // DESIGNED NAPE HAIRLINE: when the evidence puts hair on the back of the head (≥ 50 % of it), the hair covers the whole
  // back of the CANONICAL head down to the canonical nape line (the start of the underside) — a ragged or notched
  // generated hair edge never exposes the skull behind
  let backCover = null;
  if (backBins) { let b = 0, h = 0; for (let k = 0; k < NT * NP; k++) if (backBins[k]) { b++; if (mask[k]) h++; } backCover = b ? h / b : 0;
    if (backCover >= 0.5) for (let k = 0; k < NT * NP; k++) if (backBins[k]) mask[k] = 1; }
  mask = fillEnclosed(mask, keepOpen);
  const T = new Float32Array(NT * NP), has = new Uint8Array(NT * NP);
  for (let k = 0; k < NT * NP; k++) if (mask[k] && Rout[k] > 0) { T[k] = Math.max(tMin, Rout[k] - headR[k]); has[k] = 1; }
  for (let pass = 0; pass < 40; pass++) { let todo = 0; const add = [];
    for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (!mask[k] || has[k]) continue; todo++; let s = 0, c = 0; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const kk = tt * NP + ((p + dp + NP) % NP); if (has[kk]) { s += T[kk]; c++; } } if (c) add.push(k, s / c); }
    for (let q = 0; q < add.length; q += 2) { T[add[q]] = add[q + 1]; has[add[q]] = 1; } if (!todo) break; }
  blurMap(T, 1, mask);
  return { ...finishMaps(T, mask, tMin), backCover };
}
/** presence edge as a smooth field (level 0.5 = the hair line); thickness never below tMin inside → no thin wedges */
export function finishMaps(T, mask, tMin) {
  for (let k = 0; k < NT * NP; k++) T[k] = mask[k] ? Math.max(tMin, T[k]) : tMin;
  blurMap(T, 1);
  const Ms = Float32Array.from(mask, (m) => (m ? 1 : 0)); blurMap(Ms, 4);
  return { T, mask, Ms };
}

/** build the hair solid around a CLOSED head mesh. opts: centre, headR map, T map, ears {index: TriIndex over ear tris,
 *  verts: [indices]}, neck {cx, cz, r, y0, y1}, floorY, cell, eps */
export function buildHairSolid(head, opts) {
  const { centre, headR, T, Ms, ears, neck, floorY, cell = 0.007, eps = 0.003, earClear = 0.016 } = opts;
  // decide per ear: covered (hair thicker than the ear stands off) or exposed (hair keeps a clearance round it)
  const earMode = {};
  for (const [side, verts] of Object.entries(ears.verts)) { let cov = 0;
    for (const i of verts) { const [th, ph, r] = dirBin(head.P[i * 3] - centre[0], head.P[i * 3 + 1] - centre[1], head.P[i * 3 + 2] - centre[2]); if (sampleMap(Ms, th, ph) > 0.5 && sampleMap(headR, th, ph) + sampleMap(T, th, ph) > r + 0.01) cov++; }
    earMode[side] = cov / Math.max(1, verts.length) >= 0.8 ? "covered" : "exposed"; }
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < head.P.length; i += 3) for (let q = 0; q < 3; q++) { mn[q] = Math.min(mn[q], head.P[i + q]); mx[q] = Math.max(mx[q], head.P[i + q]); }
  let tmax = 0; for (const v of T) tmax = Math.max(tmax, v);
  const pad = tmax + 3 * cell, min = [mn[0] - pad, Math.min(mn[1] - 3 * cell, Math.max(floorY - 2 * cell, mn[1] - pad)), mn[2] - pad], dims = [0, 1, 2].map((q) => Math.ceil((mx[q] + pad - min[q]) / cell) + 1);   // the grid ALWAYS encloses the whole head (a slice through it would leak the sign flood fill into the skull)
  const H = sdfGrid(head.P, head.I, min, cell, dims, 3);   // head signed distance (closed canonical head → exact sign)
  H.S = extendSDF(H.S, dims, cell, 2.5 * cell);            // true distance everywhere (the hair is an OFFSET of the head)
  const [nx, ny, nz] = dims, V = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = min[0] + i * cell, y = min[1] + j * cell, z = min[2] + k * cell, g = H.id(i, j, k);
    const [th, ph, r] = dirBin(x - centre[0], y - centre[1], z - centre[2]);
    void r; let s = H.S[g] - sampleMap(T, th, ph);                            // within the hair thickness of the head surface
    s = Math.max(s, (0.5 - sampleMap(Ms, th, ph)) * 0.04);                   // inside the hair line (smooth level set, full thickness to the edge)
    s = Math.max(s, eps - H.S[g]);                                           // never inside the head (+ε)
    const dn = Math.hypot(x - neck.cx, z - neck.cz) - neck.r; if (y < neck.y1) s = Math.max(s, 0.012 - dn);   // neck column clearance
    s = Math.max(s, floorY - y);                                             // never below the shoulder line
    V[g] = s;
  }
  // ear clearance (exposed ears only): hair keeps `earClear` from the ear surface — a clean tuck line round the ear
  for (const [side, mode] of Object.entries(earMode)) { if (mode !== "exposed") continue;
    const verts = ears.verts[side]; let a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity]; for (const i of verts) for (let q = 0; q < 3; q++) { a[q] = Math.min(a[q], head.P[i * 3 + q]); b[q] = Math.max(b[q], head.P[i * 3 + q]); }
    const lo = [0, 1, 2].map((q) => Math.max(0, Math.floor((a[q] - earClear * 2 - min[q]) / cell))), hi = [0, 1, 2].map((q) => Math.min(dims[q] - 1, Math.ceil((b[q] + earClear * 2 - min[q]) / cell)));
    for (let k = lo[2]; k <= hi[2]; k++) for (let j = lo[1]; j <= hi[1]; j++) for (let i = lo[0]; i <= hi[0]; i++) { const x = min[0] + i * cell, y = min[1] + j * cell, z = min[2] + k * cell, q = ears.index.closest(x, y, z, earClear * 2, (t) => ears.side[t] === side);
      if (q) { const g = H.id(i, j, k); V[g] = Math.max(V[g], earClear - q.d); } } }
  // light separable blur: the field is a max() of several terms with creases where they meet (hairline wall, ear tuck,
  // offset shell); creases make ambiguous voxels that surface nets cannot mesh as a 2-manifold
  for (let rep = 0; rep < 2; rep++) for (let ax = 0; ax < 3; ax++) { const Tm = Float32Array.from(V), st = ax === 0 ? 1 : ax === 1 ? nx : nx * ny, len = dims[ax];
    for (let g = 0; g < V.length; g++) { const c = Math.floor(g / st) % len; if (c === 0 || c === len - 1) continue; V[g] = 0.25 * Tm[g - st] + 0.5 * Tm[g] + 0.25 * Tm[g + st]; } }
  const net = surfaceNetsGrid(V, dims, min, cell);
  let { P, I } = compact(net.P, net.I);
  // keep closed pieces of meaningful size
  { const n = P.length / 3, par = Int32Array.from({ length: n }, (_, i) => i), f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    for (let t = 0; t < I.length; t += 3) { const a = f(I[t]); par[f(I[t + 1])] = a; par[f(I[t + 2])] = a; }
    const cnt = new Map(); for (let t = 0; t < I.length; t += 3) cnt.set(f(I[t]), (cnt.get(f(I[t])) ?? 0) + 1);
    // a separate piece is kept only if it is substantial (≥ 3 % of the main mass) or rests on the head (a lock); a small
    // piece floating off the head is a FRAGMENT and is never shipped
    const big = Math.max(...cnt.values()), touch = new Map();
    for (let v = 0; v < n; v++) { const r = f(v); if (touch.get(r)) continue; const gi = Math.round((P[v * 3] - min[0]) / cell), gj = Math.round((P[v * 3 + 1] - min[1]) / cell), gk = Math.round((P[v * 3 + 2] - min[2]) / cell);
      if (gi >= 0 && gj >= 0 && gk >= 0 && gi < nx && gj < ny && gk < nz && H.S[H.id(gi, gj, gk)] < eps + 0.01) touch.set(r, true); }
    const J = []; for (let t = 0; t < I.length; t += 3) { const r = f(I[t]); if (cnt.get(r) >= 0.08 * big) J.push(I[t], I[t + 1], I[t + 2]); } ({ P, I } = compact(P, Uint32Array.from(J))); }
  return { P, I, earMode, grid: { min, dims, cell }, headSDF: H, field: V };
}
export { TriIndex, topo, vertexNormals };
