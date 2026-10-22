// v3/template.mjs — HumanBase V3 PROOF: build the CANONICAL HEAD (one topology for every employee). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/v3/template.mjs        (from frontend/)
//
// SOURCE: the approved family skull — alex-neutral-head-v1 (production Alex's own head with identity removed; every
// approved HumanBase head was fitted to this skull, and its open edge IS the HumanBase body's neck stub). It is a
// generated (Meshy) surface with open edges and non-manifold ear seams, so it is used as a SHAPE only:
//   1. neck opening and small holes capped → narrow-band signed distance field → surface nets → ONE closed manifold
//      surface (skull, ears, face, underside in one piece: nothing is ever cut out of it later);
//   2. simplified, then mirrored (+x half → −x): exact left/right vertex pairs;
//   3. SEMANTIC REGIONS per vertex (face, scalp, ears, eye zones, mouth, nose, jaw, underside, nape);
//   4. FIXED UV ATLAS designed for a star-shaped head: face = one planar chart (no seam crosses the face), side band =
//      cylindrical (seam at the front, hidden inside the face chart), crown and underside = azimuthal caps, each ear =
//      lateral + medial charts; packed at a uniform texel density (face ×2);
//   5. LANDMARK VERTEX IDS (eyes, mouth, nose tip, chin, crown, occiput, nape, forehead, temples, ear root/top/lobe/
//      outer/back) — every employee's head carries the same semantic vertices;
//   6. the HumanBase neck stub ring (from the base body) for the neck extension.
// OUTPUT: scripts/avatar-pipeline/output/human-base/v3-proof/template/{canonical-head-v3p.json, canonical-head-v3p.glb}
import fs from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer";
import { io, loadBase, surfaceNets, symmetrize, writeModule } from "../lib.mjs";
import { TriIndex, boundaryLoops, compact, improveQuality, neighbours, sdfGrid, subdivideRegion, surfaceNetsGrid, topo, vertexNormals, weld } from "./geom.mjs";

await MeshoptSimplifier.ready;
const OUT = "scripts/avatar-pipeline/output/human-base/v3-proof/template";
const TARGET_TRIS = Number(process.env.V3_HEAD_TRIS ?? 24000), CELL = 0.006;
fs.mkdirSync(OUT, { recursive: true });

// ---- 1. source shape → closed manifold -------------------------------------------------------------------------
const src = await io.read("public/avatars/human-base-v1/identity/alex-neutral-head-v1.glb");
const srcPrim = src.getRoot().listMeshes()[0].listPrimitives()[0];
const LM = src.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks;
let { P: SP, I: SI } = weld(srcPrim.getAttribute("POSITION").getArray(), srcPrim.getIndices().getArray(), 1e-5);
const loops = boundaryLoops(SI, SP.length / 3);
const capP = Array.from(SP), capI = Array.from(SI);
for (const L of loops) {   // fan-cap every opening (the neck stub + Meshy pinholes) from its centroid
  let cx = 0, cy = 0, cz = 0; for (const v of L) { cx += SP[v * 3]; cy += SP[v * 3 + 1]; cz += SP[v * 3 + 2]; }
  const c = capP.length / 3; capP.push(cx / L.length, cy / L.length, cz / L.length);
  for (let k = 0; k < L.length; k++) capI.push(L[k], L[(k + 1) % L.length], c);
}
const CP = Float32Array.from(capP), CI = Uint32Array.from(capI);
let mn = [9, 9, 9], mx = [-9, -9, -9]; for (let i = 0; i < CP.length; i += 3) for (let q = 0; q < 3; q++) { mn[q] = Math.min(mn[q], CP[i + q]); mx[q] = Math.max(mx[q], CP[i + q]); }
const half = Math.ceil((Math.max(-mn[0], mx[0]) + 0.03) / CELL);
// the template is an AUTHORED asset built once: deterministic grid offsets are tried until surface nets returns a
// closed, manifold, single-piece surface (sub-voxel ambiguities depend on where the grid samples the shape)
let P, I;
for (const off of [0, 0.37, 0.61, 0.83]) {
  const min = [-half * CELL, mn[1] - 0.03 + off * CELL, mn[2] - 0.03 + off * CELL];
  const dims = [2 * half + 1, Math.ceil((mx[1] - mn[1] + 0.06) / CELL) + 1, Math.ceil((mx[2] - mn[2] + 0.06) / CELL) + 1];
  const { S, id } = sdfGrid(CP, CI, min, CELL, dims, 3);
  // light separable blur of the distance field: removes most sub-voxel ambiguities
  for (let ax = 0; ax < 3; ax++) { const T = Float32Array.from(S), st = ax === 0 ? 1 : ax === 1 ? dims[0] : dims[0] * dims[1], len = dims[ax];
    for (let g = 0; g < S.length; g++) { const c = Math.floor(g / st) % len; if (c === 0 || c === len - 1) continue; S[g] = 0.25 * T[g - st] + 0.5 * T[g] + 0.25 * T[g + st]; } }
  ({ P, I } = surfaceNetsGrid(S, dims, min, CELL));
  // keep the largest component only (surface nets can leave sub-voxel specks)
  { const n = P.length / 3, par = Int32Array.from({ length: n }, (_, i) => i), f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    for (let t = 0; t < I.length; t += 3) { const a = f(I[t]); par[f(I[t + 1])] = a; par[f(I[t + 2])] = a; }
    const cnt = new Map(); for (let t = 0; t < I.length; t += 3) cnt.set(f(I[t]), (cnt.get(f(I[t])) ?? 0) + 1);
    const big = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0]; const J = []; for (let t = 0; t < I.length; t += 3) if (f(I[t]) === big) J.push(I[t], I[t + 1], I[t + 2]);
    ({ P, I } = compact(P, Uint32Array.from(J))); }
  const tp = topo(P, I); console.log(`grid offset ${off}: ${dims.join("×")} →`, JSON.stringify((({ bEdges, ...r }) => r)(tp)));
  if (!tp.nonManifoldEdges && !tp.nonManifoldVerts && !tp.boundaryEdges) break;
}
// Taubin smoothing removes voxel terracing without shrinking
{ const nb = neighbours(I, P.length / 3), T = new Float32Array(P.length);
  for (let it = 0; it < 8; it++) for (const k of [0.5, -0.53]) { T.set(P); for (let i = 0; i < nb.length; i++) { const d = nb[i].length; if (!d) continue; for (let q = 0; q < 3; q++) { let s = 0; for (const j of nb[i]) s += P[j * 3 + q]; T[i * 3 + q] = P[i * 3 + q] + k * (s / d - P[i * 3 + q]); } } P.set(T); } }

// ---- 2. simplify + mirror ---------------------------------------------------------------------------------------
const dense = { P: Float32Array.from(P), I: Uint32Array.from(I) };
{ const [idx] = MeshoptSimplifier.simplify(I, P, 3, Math.round(TARGET_TRIS / 2) * 3 * 2, 0.02, ["Regularize"]);
  ({ P, I } = compact(P, idx)); }
// triangle quality (no slivers): Delaunay flips + tangential relaxation projected back onto the dense surface
({ P, I } = improveQuality(P, I, new TriIndex(dense.P, dense.I, 0.02)));
{ const q = []; for (let t = 0; t < I.length / 3; t++) { const v = [0, 1, 2].map((j) => [P[I[t * 3 + j] * 3], P[I[t * 3 + j] * 3 + 1], P[I[t * 3 + j] * 3 + 2]]), e = [0, 1, 2].map((j) => Math.hypot(...[0, 1, 2].map((c) => v[(j + 1) % 3][c] - v[j][c]))), s2 = (e[0] + e[1] + e[2]) / 2, A = Math.sqrt(Math.max(0, s2 * (s2 - e[0]) * (s2 - e[1]) * (s2 - e[2]))); q.push(4 * Math.sqrt(3) * A / (e[0] ** 2 + e[1] ** 2 + e[2] ** 2)); }
  q.sort((a, b) => a - b); console.log(`triangle quality: min ${q[0].toFixed(3)} p1 ${q[Math.floor(q.length * 0.01)].toFixed(3)} p50 ${q[Math.floor(q.length / 2)].toFixed(3)} (<0.2: ${q.filter((x) => x < 0.2).length})`); }
// surface nets can emit a degenerate 'fin' (two triangles over the same edge both ways): remove duplicate faces and
// triangles hanging on an edge used more than twice when their removal leaves that edge manifold
{ const seen = new Map(), keep = new Uint8Array(I.length / 3).fill(1);
  for (let t = 0; t < I.length / 3; t++) { const k = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]].sort((a, b) => a - b).join(","); if (seen.has(k)) { keep[t] = 0; keep[seen.get(k)] = 0; } else seen.set(k, t); }
  const nv = P.length / 3, E = new Map(); for (let t = 0; t < I.length / 3; t++) if (keep[t]) for (let q = 0; q < 3; q++) { const a = I[t * 3 + q], b = I[t * 3 + (q + 1) % 3], key = a < b ? a * nv + b : b * nv + a; (E.get(key) ?? E.set(key, []).get(key)).push(t); }
  for (const ts of E.values()) if (ts.length > 2) console.log("non-manifold edge triangles:", ts.map((t) => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]].join("/")).join("  "));
  const J = []; for (let t = 0; t < I.length / 3; t++) if (keep[t]) J.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]); I = Uint32Array.from(J); }
// IDENTITY LIVES IN THE FACE: the approved style carries lip creases, nose and lid forms in GEOMETRY (the painted texture
// is flat there), so the canonical face is twice as dense as the cranium — the same for every employee
{ const N0 = vertexNormals(P, I), nv = P.length / 3; let cy = 0, cz = 0; { let c = 0; for (let i = 0; i < nv; i++) if (Math.abs(P[i * 3]) > 0.33 && P[i * 3 + 1] > LM.eyes.l[1] - 0.25 && P[i * 3 + 1] < LM.eyes.l[1] + 0.1) { cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; c++; } cy /= c; cz /= c; }
  const faceV = new Uint8Array(nv); for (let i = 0; i < nv; i++) { const dz = P[i * 3 + 2] - cz, r = Math.hypot(P[i * 3], P[i * 3 + 1] - cy, dz); if (dz / r > 0.3 && N0[i * 3 + 2] > 0.1 && P[i * 3 + 1] < LM.eyes.l[1] + 0.2 && Math.abs(P[i * 3]) < 0.3) faceV[i] = 1; }
  const before = I.length / 3; ({ P, I } = subdivideRegion(P, I, (t) => faceV[I[t * 3]] && faceV[I[t * 3 + 1]] && faceV[I[t * 3 + 2]], new TriIndex(dense.P, dense.I, 0.02)));
  console.log(`face subdivision: ${before} → ${I.length / 3} triangles`); }
const T0 = topo(P, I);
console.log("canonical head:", JSON.stringify((({ bEdges, ...r }) => r)(T0)));
if (T0.boundaryEdges || T0.nonManifoldEdges || T0.nonManifoldVerts || T0.components.length !== 1 || T0.misorientedEdges) throw new Error("canonical head is not a single closed oriented manifold");
const n = P.length / 3, N = vertexNormals(P, I);
// mirror pairs (exact after symmetrize)
const posKey = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
const byPos = new Map(); for (let i = 0; i < n; i++) byPos.set(posKey(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), i);
const mirror = Int32Array.from({ length: n }, (_, i) => byPos.get(posKey(-P[i * 3], P[i * 3 + 1], P[i * 3 + 2])) ?? -1);
console.log(`mirror pairs: ${mirror.filter((m) => m >= 0).length}/${n}`);

// ---- 3. semantic regions -----------------------------------------------------------------------------------------
const nb = neighbours(I, n);
const eyeY = LM.eyes.l[1], eyeZ = LM.eyes.l[2], eyeX = Math.abs(LM.eyes.l[0]), mouthY = LM.mouth.c[1];
// ears: the lateral parts of the surface that stand off the cranium — found per vertex as |x| beyond the skull's own
// half-width at that height/depth (the skull half-width measured on the surface away from the ear box)
const EAR_BOX = { y0: eyeY - 0.2, y1: eyeY + 0.12, z0: -0.25, z1: 0.06 };
// ears STAND OFF the cranium: a heavily smoothed copy of the surface (uniform Laplacian, which collapses thin
// protrusions) is the "skull without ears"; an ear vertex lies far from it, outward, inside the ear box
const earMask = new Uint8Array(n), earCore = new Uint8Array(n);
{ const Sm = Float32Array.from(P), T = new Float32Array(P.length);
  for (let it = 0; it < 80; it++) { T.set(Sm); for (let i = 0; i < n; i++) { const d = nb[i].length; for (let q = 0; q < 3; q++) { let s = 0; for (const j of nb[i]) s += Sm[j * 3 + q]; T[i * 3 + q] = Sm[i * 3 + q] + 0.6 * (s / d - Sm[i * 3 + q]); } } Sm.set(T); }
  const off = new Float32Array(n); for (let i = 0; i < n; i++) off[i] = Math.hypot(P[i * 3] - Sm[i * 3], P[i * 3 + 1] - Sm[i * 3 + 1], P[i * 3 + 2] - Sm[i * 3 + 2]);
  for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (y < EAR_BOX.y0 || y > EAR_BOX.y1 || z < EAR_BOX.z0 || z > EAR_BOX.z1 || Math.abs(x) < 0.3) continue;
    if (off[i] > 0.022 && Math.abs(x) > Math.abs(Sm[i * 3])) earMask[i] = x > 0 ? 2 : 1; }
  // keep the big connected piece per side, then grow two rings (the ear root belongs to the ear)
  for (const side of [1, 2]) { const seeds = []; for (let i = 0; i < n; i++) if (earMask[i] === side) seeds.push(i);
    const comp = new Int32Array(n).fill(-1); let best = -1, bestN = 0, c = 0;
    for (const s0 of seeds) { if (comp[s0] >= 0) continue; const st = [s0]; comp[s0] = c; let cnt = 0; while (st.length) { const v = st.pop(); cnt++; for (const u of nb[v]) if (earMask[u] === side && comp[u] < 0) { comp[u] = c; st.push(u); } } if (cnt > bestN) { bestN = cnt; best = c; } c++; }
    for (const s0 of seeds) if (comp[s0] !== best) earMask[s0] = 0; }
  earCore.set(earMask);
  for (let r = 0; r < 2; r++) { const grow = Uint8Array.from(earMask); for (let i = 0; i < n; i++) if (!earMask[i]) for (const u of nb[i]) if (earMask[u]) { grow[i] = earMask[u]; break; } earMask.set(grow); } }
// head centre: between the ear roots
let earC = [0, 0, 0], ec = 0; for (let i = 0; i < n; i++) if (earMask[i]) { earC[1] += P[i * 3 + 1]; earC[2] += P[i * 3 + 2]; ec++; }
const C3 = [0, earC[1] / ec, earC[2] / ec];
const REGION = { scalp: 1, face: 2, earL: 3, earR: 4, eyeL: 5, eyeR: 6, mouth: 7, nose: 8, jaw: 9, under: 10, nape: 11, side: 12 };
const region = new Uint8Array(n);
const eyeHalfW = LM.eyes.halfW ?? 0.06, eyeHalfH = LM.eyes.halfH ?? 0.045;
for (let i = 0; i < n; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], dx = x - C3[0], dy = y - C3[1], dz = z - C3[2], r = Math.hypot(dx, dy, dz);
  const front = dz / r, elev = dy / r;
  if (earMask[i]) { region[i] = earMask[i] === 2 ? REGION.earL : REGION.earR; continue; }   // +x = the avatar's left (base convention: eyes.l has x < 0 → check below)
  if (N[i * 3 + 1] < -0.55 && y < mouthY) { region[i] = REGION.under; continue; }
  if (front > 0.42 && y < eyeY + 0.3) {
    const ex = Math.abs(x) - eyeX, eyd = y - eyeY;
    if ((ex / (eyeHalfW * 1.6)) ** 2 + (eyd / (eyeHalfH * 2.2)) ** 2 < 1) region[i] = x < 0 ? REGION.eyeL : REGION.eyeR;
    else if (Math.abs(x) < 0.06 && y > mouthY + 0.03 && y < eyeY - 0.02) region[i] = REGION.nose;
    else if (Math.abs(x) < 0.1 && Math.abs(y - mouthY) < 0.035) region[i] = REGION.mouth;
    else if (y < mouthY - 0.02) region[i] = REGION.jaw;
    else region[i] = REGION.face;
    continue;
  }
  if (front < -0.35 && elev < 0.05) { region[i] = REGION.nape; continue; }
  if (elev > 0.3 || front < -0.2) { region[i] = REGION.scalp; continue; }
  region[i] = y < mouthY ? REGION.jaw : REGION.side;
}
// fix the L/R ear naming to the base convention (eyes.l has negative x → "L" = −x)
for (let i = 0; i < n; i++) if (region[i] === REGION.earL || region[i] === REGION.earR) region[i] = P[i * 3] < 0 ? REGION.earL : REGION.earR;

// ---- 4. fixed UV atlas -------------------------------------------------------------------------------------------
const CH = { face: 0, band: 1, top: 2, bottom: 3, earLout: 4, earLin: 5, earRout: 6, earRin: 7 };
const nT = I.length / 3, chart = new Uint8Array(nT);
const faceVert = (i) => { const dz = P[i * 3 + 2] - C3[2], r = Math.hypot(P[i * 3] - C3[0], P[i * 3 + 1] - C3[1], dz); return dz / r > 0.36 && N[i * 3 + 2] > 0.2 && P[i * 3 + 1] < eyeY + 0.32; };
for (let t = 0; t < nT; t++) {
  const v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
  const ear = v.every((i) => earMask[i]) ? (P[v[0] * 3] < 0 ? "L" : "R") : null;
  if (ear) { let nx = 0; for (const i of v) nx += N[i * 3]; const out = ear === "L" ? nx < 0 : nx > 0; chart[t] = ear === "L" ? (out ? CH.earLout : CH.earLin) : (out ? CH.earRout : CH.earRin); continue; }
  if (v.every(faceVert)) { chart[t] = CH.face; continue; }
  let cy = 0, cz = 0, cx = 0; for (const i of v) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; } cx /= 3; cy /= 3; cz /= 3;
  const r = Math.hypot(cx - C3[0], cy - C3[1], cz - C3[2]), elev = (cy - C3[1]) / r;
  chart[t] = elev > 0.62 ? CH.top : elev < -0.55 ? CH.bottom : CH.band;
}
// per-corner 2D coordinates in world units (uniform texel density), per chart
const corner = new Float64Array(nT * 6);
for (let t = 0; t < nT; t++) {
  const c = chart[t], us = [];
  for (let k = 0; k < 3; k++) {
    const i = I[t * 3 + k], x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], dx = x - C3[0], dy = y - C3[1], dz = z - C3[2], r = Math.hypot(dx, dy, dz);
    let u, w;
    if (c === CH.face) { u = x; w = y; }
    else if (c >= CH.earLout) { u = (c === CH.earLout || c === CH.earRin ? -1 : 1) * z; w = y; }
    else if (c === CH.top) { const th = Math.acos(Math.min(1, dy / r)), ph = Math.atan2(dx, -dz); u = th * Math.sin(ph) * r; w = -th * Math.cos(ph) * r; }
    else if (c === CH.bottom) { const th = Math.acos(Math.min(1, -dy / r)), ph = Math.atan2(dx, -dz); u = th * Math.sin(ph) * r; w = th * Math.cos(ph) * r; }
    else { u = Math.atan2(dx, -dz); w = y; }
    us.push([u, w]);
  }
  if (c === CH.band) {   // the cylindrical seam (azimuth ±π) runs down the front: unwrap straddling triangles
    const a = us.map((q) => q[0]); if (Math.max(...a) - Math.min(...a) > Math.PI) for (const q of us) if (q[0] < 0) q[0] += 2 * Math.PI;
    const Rb = 0.42; for (const q of us) q[0] *= Rb;   // azimuth → arc length at the skull's mean radius
  }
  for (let k = 0; k < 3; k++) { corner[t * 6 + k * 2] = us[k][0]; corner[t * 6 + k * 2 + 1] = us[k][1]; }
}
// charts may hold several islands (band straddle branch): split per (chart, branch) by connectivity in corner space
// → one UV vertex per (vertex, chart, rounded corner coordinate)
const uvKey = new Map(), uvSrc = [], uvChart = [], uvCoord = [], UI = new Uint32Array(nT * 3);
for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
  const i = I[t * 3 + k], u = corner[t * 6 + k * 2], w = corner[t * 6 + k * 2 + 1], key = `${i}|${chart[t]}|${Math.round(u * 1e4)}|${Math.round(w * 1e4)}`;
  let j = uvKey.get(key); if (j === undefined) { j = uvSrc.length; uvKey.set(key, j); uvSrc.push(i); uvChart.push(chart[t]); uvCoord.push(u, w); } UI[t * 3 + k] = j;
}
// pack: one rectangle per chart (face at 2× density), shelf packing, binary search on the global scale
const DENS = [2, 1, 1, 1, 1.2, 1.2, 1.2, 1.2], PAD = 10 / 2048;
const rect = Object.values(CH).map((c) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let j = 0; j < uvSrc.length; j++) if (uvChart[j] === c) { x0 = Math.min(x0, uvCoord[j * 2]); x1 = Math.max(x1, uvCoord[j * 2]); y0 = Math.min(y0, uvCoord[j * 2 + 1]); y1 = Math.max(y1, uvCoord[j * 2 + 1]); } return { c, x0, y0, w: (x1 - x0) * DENS[c], h: (y1 - y0) * DENS[c] }; });
const tryPack = (s) => { const order = [...rect].sort((a, b) => b.h - a.h); let x = PAD, y = PAD, row = 0; const pos = {};
  for (const r of order) { const W = r.w * s, H = r.h * s; if (x + W + PAD > 1) { x = PAD; y += row + PAD; row = 0; } if (W + 2 * PAD > 1) return null; pos[r.c] = [x, y]; x += W + PAD; row = Math.max(row, H); }
  return y + row + PAD <= 1 ? pos : null; };
let lo = 0.01, hi = 10, packed = null; for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2, p = tryPack(mid); if (p) { lo = mid; packed = p; } else hi = mid; }
const SCALE = lo; packed = tryPack(SCALE);
const UV = new Float32Array(uvSrc.length * 2);
for (let j = 0; j < uvSrc.length; j++) { const r = rect[uvChart[j]], [ox, oy] = packed[r.c];
  UV[j * 2] = ox + (uvCoord[j * 2] - r.x0) * DENS[r.c] * SCALE; }
// v: glTF origin top-left → v = row from the top; place chart y so +y (up) is toward the top of the image
for (let j = 0; j < uvSrc.length; j++) { const r = rect[uvChart[j]], [, oy] = packed[r.c]; const yTop = rect[uvChart[j]].y0 + rect[uvChart[j]].h / DENS[r.c];
  UV[j * 2 + 1] = oy + (yTop - uvCoord[j * 2 + 1]) * DENS[r.c] * SCALE; }
// UV distortion: area ratio per triangle (UV / 3D) normalised by chart density
let flipped = 0; { const dens = []; for (let t = 0; t < nT; t++) { const a = UI[t * 3], b = UI[t * 3 + 1], c = UI[t * 3 + 2];
  const ua = (UV[b * 2] - UV[a * 2]) * (UV[c * 2 + 1] - UV[a * 2 + 1]) - (UV[c * 2] - UV[a * 2]) * (UV[b * 2 + 1] - UV[a * 2 + 1]);
  const p = (q) => [P[I[t * 3 + q] * 3], P[I[t * 3 + q] * 3 + 1], P[I[t * 3 + q] * 3 + 2]], A = p(0), B = p(1), Cc = p(2);
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]], a3 = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
  if (ua > 0) flipped++; dens.push(Math.abs(ua) / 2 / (a3 * (DENS[chart[t]] * SCALE) ** 2)); }
  dens.sort((a, b) => a - b); console.log(`UV: ${uvSrc.length} uv-verts, texel-area ratio p05 ${dens[Math.floor(dens.length * 0.05)].toFixed(2)} p50 ${dens[Math.floor(dens.length / 2)].toFixed(2)} p95 ${dens[Math.floor(dens.length * 0.95)].toFixed(2)}; uv winding mixed: ${flipped}/${nT}`); }

// ---- 5. landmark vertex ids ----------------------------------------------------------------------------------------
const nearest = (q, pred = () => true) => { let b = -1, d = Infinity; for (let i = 0; i < n; i++) { if (!pred(i)) continue; const e = (P[i * 3] - q[0]) ** 2 + (P[i * 3 + 1] - q[1]) ** 2 + (P[i * 3 + 2] - q[2]) ** 2; if (e < d) { d = e; b = i; } } return b; };
const argBy = (score, pred = () => true) => { let b = -1, s = -Infinity; for (let i = 0; i < n; i++) { if (!pred(i)) continue; const v = score(i); if (v > s) { s = v; b = i; } } return b; };
const mid = (i) => Math.abs(P[i * 3]) < 0.004;
const earSide = (s) => (i) => region[i] === (s === "l" ? REGION.earL : REGION.earR);
const front = (i) => P[i * 3 + 2] > C3[2] + 0.15 && N[i * 3 + 2] > 0.3;
const onSurface = (q) => nearest(q, (i) => P[i * 3 + 2] > C3[2]);
const landmarks = {
  eyeL: onSurface(LM.eyes.l), eyeR: onSurface(LM.eyes.r),
  mouth: argBy((i) => -Math.abs(P[i * 3 + 1] - mouthY), (i) => mid(i) && front(i)),
  noseTip: argBy((i) => P[i * 3 + 2], (i) => mid(i) && front(i) && P[i * 3 + 1] > mouthY + 0.02 && P[i * 3 + 1] < eyeY - 0.04),
  chin: argBy((i) => -P[i * 3 + 1] + 0.3 * P[i * 3 + 2], (i) => mid(i) && P[i * 3 + 2] > C3[2] + 0.1), crown: argBy((i) => P[i * 3 + 1], mid),
  forehead: argBy((i) => -Math.abs(P[i * 3 + 1] - (eyeY + 0.22)), (i) => mid(i) && front(i)), occiput: argBy((i) => -P[i * 3 + 2], (i) => mid(i) && Math.abs(P[i * 3 + 1] - eyeY) < 0.05),
  nape: argBy((i) => -P[i * 3 + 2] - 2 * Math.abs(P[i * 3 + 1] - (mouthY - 0.02)), (i) => mid(i) && P[i * 3 + 2] < C3[2]),
  templeL: nearest([-0.4, eyeY + 0.08, 0.15]), templeR: nearest([0.4, eyeY + 0.08, 0.15]),
  cheekL: onSurface([-0.28, (eyeY + mouthY) / 2, 0.4]), cheekR: onSurface([0.28, (eyeY + mouthY) / 2, 0.4]),
  jawL: onSurface([-0.28, mouthY - 0.04, 0.2]), jawR: onSurface([0.28, mouthY - 0.04, 0.2]),
};
for (const s of ["l", "r"]) { const S2 = s.toUpperCase(), e = (i) => earCore[i] === (s === "l" ? 1 : 2);   // core ear (before growth): x<0 → 1
  landmarks[`ear${S2}top`] = argBy((i) => P[i * 3 + 1], e); landmarks[`ear${S2}lobe`] = argBy((i) => -P[i * 3 + 1], e);
  landmarks[`ear${S2}outer`] = argBy((i) => Math.abs(P[i * 3]), e); landmarks[`ear${S2}back`] = argBy((i) => -P[i * 3 + 2], e);
  let cy = 0, cz = 0, c = 0; for (let i = 0; i < n; i++) if (e(i)) { cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; c++; }
  landmarks[`ear${S2}root`] = argBy((i) => -Math.abs(P[i * 3]) * 0.2 - Math.hypot(P[i * 3 + 1] - cy / c, P[i * 3 + 2] - cz / c), e); }
console.log("landmarks:", Object.entries(landmarks).map(([k, v]) => `${k}=${v}`).join(" "));

// ---- 6. the HumanBase neck stub (for the neck extension every identity carries) ------------------------------------
const base = await loadBase();
const bP = base.geo.P, bI = base.geo.I, bLoops = boundaryLoops(weld(bP, bI, 1e-6).I, weld(bP, bI, 1e-6).P.length / 3);
const bw = weld(bP, bI, 1e-6);
let stub = null, stubY = -Infinity; for (const L of bLoops) { let y = 0; for (const v of L) y += bw.P[v * 3 + 1]; y /= L.length; if (y > stubY && L.length > 20) { stubY = y; stub = L; } }
// map welded ids back to an original vertex to read joints/weights
const back = new Int32Array(bw.P.length / 3).fill(-1); for (let i = 0; i < bw.map.length; i++) if (back[bw.map[i]] < 0) back[bw.map[i]] = i;
const neckRing = stub.map((v) => { const o = back[v]; return { p: [bw.P[v * 3], bw.P[v * 3 + 1], bw.P[v * 3 + 2]], n: [base.geo.N[o * 3], base.geo.N[o * 3 + 1], base.geo.N[o * 3 + 2]], uv: [base.geo.UV[o * 2], base.geo.UV[o * 2 + 1]], j: Array.from(base.geo.J.slice(o * 4, o * 4 + 4)), w: Array.from(base.geo.W.slice(o * 4, o * 4 + 4)) }; });
console.log(`neck stub: ${neckRing.length} vertices at y ≈ ${stubY.toFixed(3)}`);

// ---- write ------------------------------------------------------------------------------------------------------------
const tpl = { id: "canonical-head-v3p", version: 1, cell: CELL, source: "alex-neutral-head-v1 (shape only)", centre: C3, REGION, CH,
  P: Array.from(P, (v) => +v.toFixed(6)), I: Array.from(I), mirror: Array.from(mirror), region: Array.from(region),
  uv: { src: uvSrc, I: Array.from(UI), UV: Array.from(UV, (v) => +v.toFixed(6)), chart: uvChart }, landmarks, sourceLandmarks: LM, neckRing, headJoint: base.JI.Head };
fs.writeFileSync(`${OUT}/canonical-head-v3p.json`, JSON.stringify(tpl));
// preview module: regions as vertex colours
const PAL = { 1: [0.35, 0.3, 0.28], 2: [0.95, 0.78, 0.68], 3: [0.3, 0.6, 0.95], 4: [0.95, 0.5, 0.3], 5: [0.2, 0.8, 0.3], 6: [0.8, 0.2, 0.7], 7: [0.9, 0.2, 0.2], 8: [0.95, 0.9, 0.2], 9: [0.7, 0.55, 0.45], 10: [0.4, 0.4, 0.6], 11: [0.5, 0.35, 0.3], 12: [0.85, 0.7, 0.6] };
const NP = [], NN = [], COL = []; for (const i of uvSrc) { NP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); NN.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); COL.push(...PAL[region[i]]); }
const nv = uvSrc.length, J = new Uint8Array(nv * 4), W = new Float32Array(nv * 4); for (let i = 0; i < nv; i++) { J[i * 4] = base.JI.Head; W[i * 4] = 1; }
await writeModule(`${OUT}/canonical-head-v3p.glb`, base, [{ name: "baked_regions", P: NP, N: NN, I: Array.from(UI), UV: Array.from(UV), COLOR: COL, J, W, material: { name: "baked_regions" } }], { humanIdentity: { id: "canonical-head-v3p", base: "human-base-v1", landmarks: LM, hides: [] } }, { compress: false });
console.log(`wrote ${OUT}/canonical-head-v3p.{json,glb}: ${n} verts, ${nT} tris, ${uvSrc.length} uv verts, regions ${JSON.stringify(Object.fromEntries(Object.entries(REGION).map(([k, v]) => [k, region.filter((r) => r === v).length])))}`);
