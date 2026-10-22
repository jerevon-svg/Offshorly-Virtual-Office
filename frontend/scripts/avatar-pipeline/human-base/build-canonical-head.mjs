// build-canonical-head.mjs — CanonicalHumanHead_V1: ONE shared, identity-neutral chibi head for every employee.
// ZERO CREDITS, NO GENERATION.
//
//   node scripts/avatar-pipeline/human-base/build-canonical-head.mjs     (from frontend/; after build-bon-identity)
//
// SOURCE: the cleaned Phase 2 head (identity/bon/head.glb — its smoothed skull, ears, closed scalp and fold-free eye
// areas are the family's head shape). Everything that made it ONE PERSON is removed:
//   · symmetric — the +x half mirrored;
//   · the nose, mouth and philtrum are erased (a harmonic membrane over the feature zone) and replaced by a NEUTRAL
//     canonical chibi nose and lips, built analytically so their size is a parameter, not a sculpt;
//   · no texture: the skin is a tone, the features are painted by the identity shader from parameters.
// IDENTITY = PARAMETERS. Bounded shape controls are glTF MORPH TARGETS on this one topology (each −1…+1, sized so
// every value stays inside the HumanBase head envelope): faceWidth, jawWidth, chinLength, cheekFull, noseSize,
// noseWidth, forehead, earSize, lipFull. The face shells and the canonical glasses carry the same morphs
// (transferred from the head), so eyes and frames follow any face. A baked `_ao` (concavity) gives the soft 3D read.
//
// OUTPUT public/avatars/human-base-v1/:
//   identity/canonical-head-v1.glb   head + eye/mouth shells, 9 morphs, landmarks
//   accessories/glasses-classic.glb  rectangular black frames fitted to the canonical landmarks (+ morphs)
//   scripts/avatar-pipeline/output/human-base/canonical-head-work.json (positions + morphs for the hair build)
import * as THREE from "three";
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { adjacency, BASE_OUT, computeNormals, io, loadBase, simplifyGeo, smooth, subset, symmetrize, taubin, transferMorphs, weldGeo, weldNormals, writeModule } from "./lib.mjs";

const base = await loadBase();
const src = await io.read(`${BASE_OUT}/identity/bon/head.glb`);
const headNode = src.getRoot().listNodes().find((n) => n.getName() === "identity_head");
const prim0 = headNode.getMesh().listPrimitives()[0];
const lm0 = src.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks;

// ---- 1. one clean welded symmetric surface ------------------------------------------------------------------
// WELD WITH A TOLERANCE: the Phase 2 source still carries near-duplicate vertices along its old UV fragment borders
// (positions a few µm apart). Left split they keep separate normals, which shade as faint creases.
function weldTol(g0, tol) {
  const n = g0.P.length / 3, cell = new Map(), map = new Int32Array(n), P = [];
  for (let i = 0; i < n; i++) {
    const x = g0.P[i * 3], y = g0.P[i * 3 + 1], z = g0.P[i * 3 + 2];
    const kx = Math.floor(x / tol), ky = Math.floor(y / tol), kz = Math.floor(z / tol);
    let hit = -1;
    for (let dx = -1; dx <= 1 && hit < 0; dx++) for (let dy = -1; dy <= 1 && hit < 0; dy++) for (let dz = -1; dz <= 1 && hit < 0; dz++) {
      const c = cell.get(`${kx + dx},${ky + dy},${kz + dz}`); if (!c) continue;
      for (const j of c) if (Math.hypot(P[j * 3] - x, P[j * 3 + 1] - y, P[j * 3 + 2] - z) < tol) { hit = j; break; }
    }
    if (hit < 0) { hit = P.length / 3; P.push(x, y, z); const k = `${kx},${ky},${kz}`; (cell.get(k) ?? cell.set(k, []).get(k)).push(hit); }
    map[i] = hit;
  }
  const I = []; for (let t = 0; t < g0.I.length; t += 3) { const a = map[g0.I[t]], b = map[g0.I[t + 1]], c = map[g0.I[t + 2]]; if (a !== b && b !== c && a !== c) I.push(a, b, c); }
  return { P, I };
}
let g = weldTol({ P: Array.from(prim0.getAttribute("POSITION").getArray()), I: Array.from(prim0.getIndices().getArray()) }, 2.5e-4);
g = symmetrize(g.P, g.I);
g = weldTol(g, 2.5e-4);
g = simplifyGeo(g, 42000, 0.0008);
// ---- 2. A CLEAN NEW TOPOLOGY. The source's triangulation is damaged (slivers and folds along its old feature edges
// shade as creases however it is smoothed), so it is used only as a SHAPE: its radius from the head centre in every
// direction (inner surface — the ears do not count, nor the neck stub) is low-passed over the sphere (≈ 12°: no crease
// of the fused frames or the old fringe survives), and a fresh, evenly triangulated sphere is projected onto it. The
// head is CLOSED underneath; the body's own neck rises into it (no neck-stub seam). The EARS are the only source
// geometry kept: their triangles, seated into the new skull.
const SP = Float32Array.from(g.P), SI = g.I, snv = SP.length / 3;
const CEN = [0, 1.18, -0.01], AZ = 180, EL = 90;
const dirOfP = (x, y, z) => { const dx = x - CEN[0], dy = y - CEN[1], dz = z - CEN[2], r = Math.hypot(dx, dy, dz);
  const az = Math.atan2(dx, dz), el = Math.asin(Math.max(-1, Math.min(1, dy / r))); return { r, az, el, a: Math.min(AZ - 1, Math.floor(((az + Math.PI) / (2 * Math.PI)) * AZ)), e: Math.min(EL - 1, Math.floor(((el + Math.PI / 2) / Math.PI) * EL)) }; };
const Rmin = new Float32Array(AZ * EL).fill(9);
for (let i = 0; i < snv; i++) { if (SP[i * 3 + 1] < 0.81) continue; const d = dirOfP(SP[i * 3], SP[i * 3 + 1], SP[i * 3 + 2]); const k = d.e * AZ + d.a; Rmin[k] = Math.min(Rmin[k], d.r); }
for (let pass = 0; pass < 40; pass++) for (let e = 0; e < EL; e++) for (let a = 0; a < AZ; a++) { const k = e * AZ + a; if (Rmin[k] < 9) continue;
  let s2 = 0, n = 0; for (const [da, de] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const e2 = e + de; if (e2 < 0 || e2 >= EL) continue; const v = Rmin[e2 * AZ + (a + da + AZ) % AZ]; if (v < 9) { s2 += v; n++; } } if (n) Rmin[k] = s2 / n; }
const blur = (G, sig) => { const R = Math.ceil(sig * 2.5), ker = Array.from({ length: 2 * R + 1 }, (_, k) => Math.exp(-(((k - R) / sig) ** 2) / 2));
  const T = new Float32Array(G.length);
  for (let e = 0; e < EL; e++) { const cosE = Math.max(0.15, Math.cos(((e + 0.5) / EL - 0.5) * Math.PI)); const Ra = Math.min(AZ / 2 - 1, Math.ceil(R / cosE));
    for (let a = 0; a < AZ; a++) { let s2 = 0, w = 0; for (let k = -Ra; k <= Ra; k++) { const kw = Math.exp(-(((k * cosE) / sig) ** 2) / 2); s2 += G[e * AZ + (a + k + AZ) % AZ] * kw; w += kw; } T[e * AZ + a] = s2 / w; } }
  const U = new Float32Array(G.length);
  for (let e = 0; e < EL; e++) for (let a = 0; a < AZ; a++) { let s2 = 0, w = 0; for (let k = -R; k <= R; k++) { const e2 = e + k; if (e2 < 0 || e2 >= EL) continue; s2 += T[e2 * AZ + a] * ker[k + R]; w += ker[k + R]; } U[e * AZ + a] = s2 / w; }
  return U; };
const Rs0 = blur(Rmin, 6);
// ---- THE OFFSHORLY FACE: the mean face of the approved production family -------------------------------------------
// Every clean production face (no fused glasses / beard) is measured the same way — its inner (skin) radius per
// direction from the head centre, the centre placed relative to each rig's own Head joint — and averaged. Inside the
// face cone that mean REPLACES the skull's own face, so the canonical face silhouette (cheeks, jaw, chin, forehead) is
// the family's, not one person's and not an invented one.
const FAMILY = ["gelo-v1-hq-idle9/gelo-v1-lod1.glb", "jan-v1-hq-idle9/jan-v1-lod1.glb", "kael-v1-fix-hq-idle9/kael-v1-fix-lod1.glb", "micah-v5-hq/micah-v5-lod1.glb",
  "france-v1-hq/france-v1-lod1.glb", "nicole-v1-fix-hq/nicole-v1-fix-lod1.glb", "jona-v1-fix-hq/jona-v1-fix-lod1.glb"];
const baseHead = base.rest.Head, OFFC = [CEN[0] - baseHead.x, CEN[1] - baseHead.y, CEN[2] - baseHead.z];
const famSum = new Float32Array(AZ * EL), famN = new Float32Array(AZ * EL);
for (const f of FAMILY) {
  const d = await io.read(`public/avatars/${f}`), R = d.getRoot(), pr = R.listMeshes()[0].listPrimitives()[0];
  const hb = R.listSkins()[0].listJoints().find((j) => j.getName() === "Head").getWorldMatrix();
  const c = [hb[12] + OFFC[0], hb[13] + OFFC[1], hb[14] + OFFC[2]];
  const FP = pr.getAttribute("POSITION").getArray(), Rr = new Float32Array(AZ * EL).fill(9);
  for (let i = 0; i < FP.length / 3; i++) { const dx = FP[i * 3] - c[0], dy = FP[i * 3 + 1] - c[1], dz = FP[i * 3 + 2] - c[2], r = Math.hypot(dx, dy, dz);
    const az = Math.atan2(dx, dz), el = Math.asin(dy / r); if (Math.abs(az) > 1.5 || el > 0.4 || el < -1.3) continue;
    const k = Math.min(EL - 1, Math.floor(((el + Math.PI / 2) / Math.PI) * EL)) * AZ + Math.min(AZ - 1, Math.floor(((az + Math.PI) / (2 * Math.PI)) * AZ)); Rr[k] = Math.min(Rr[k], r); }
  for (let k = 0; k < Rr.length; k++) if (Rr[k] < 9) { famSum[k] += Rr[k]; famN[k]++; }
}
const famR = new Float32Array(AZ * EL); for (let k = 0; k < famR.length; k++) famR[k] = famN[k] >= 4 ? famSum[k] / famN[k] : Rs0[k];
// symmetric, low-passed like the skull
for (let e = 0; e < EL; e++) for (let a = 0; a < AZ / 2; a++) { const k1 = e * AZ + a, k2 = e * AZ + (AZ - 1 - a); const m = (famR[k1] + famR[k2]) / 2; famR[k1] = famR[k2] = m; }
const famB = blur(famR, 3);
const Rs = new Float32Array(Rs0.length);
let famDelta = 0, famCount = 0;
for (let e = 0; e < EL; e++) for (let a = 0; a < AZ; a++) {
  const k = e * AZ + a, az = ((a + 0.5) / AZ) * 2 * Math.PI - Math.PI, el = ((e + 0.5) / EL) * Math.PI - Math.PI / 2;
  // the face cone: front ±62°, from under the chin up to the brows, soft edges
  // wide soft edges: the family face blends into the skull with no visible step (a narrow band left a forehead ridge)
  const w = (1 - smooth(0.7, 1.25, Math.abs(az))) * (1 - smooth(0.0, 0.5, el)) * smooth(-1.3, -0.95, el);
  Rs[k] = Rs0[k] * (1 - w) + famB[k] * w; if (w > 0.9) { famDelta += famB[k] - Rs0[k]; famCount++; }
}
console.log(`family face: ${FAMILY.length} production faces averaged · mean change in the face cone ${(famDelta / famCount * 100).toFixed(1)} cm (native)`);
const sample = (az, el) => { const fa = ((az + Math.PI) / (2 * Math.PI)) * AZ - 0.5, fe = ((el + Math.PI / 2) / Math.PI) * EL - 0.5;
  const a0 = Math.floor(fa), e0 = Math.max(0, Math.min(EL - 2, Math.floor(fe))), u = fa - a0, v = Math.min(1, Math.max(0, fe - e0));
  const gg = (a, e) => Rs[e * AZ + ((a % AZ) + AZ) % AZ]; return (gg(a0, e0) * (1 - u) + gg(a0 + 1, e0) * u) * (1 - v) + (gg(a0, e0 + 1) * (1 - u) + gg(a0 + 1, e0 + 1) * u) * v; };
// the fresh sphere: an icosahedron subdivided six times (≈ 82k even triangles), projected onto the low-passed radius
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2; let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) { const mid = new Map(); const m = (a, b) => { const k = a < b ? `${a}_${b}` : `${b}_${a}`; if (!mid.has(k)) { const p = V[a].map((c, q) => c + V[b][q]); const n = Math.hypot(...p); mid.set(k, V.length); V.push(p.map((c) => c / n)); } return mid.get(k); };
    const F2 = []; for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); } F = F2; }
  return { V, F };
}
const ico = icosphere(6);
const skullP = [], skullI = [];
for (const d of ico.V) { const az = Math.atan2(d[0], d[2]), el = Math.asin(d[1]), r = sample(az, el); skullP.push(CEN[0] + d[0] * r, CEN[1] + d[1] * r, CEN[2] + d[2] * r); }
for (const [a, b, c] of ico.F) skullI.push(a, b, c);   // the standard icosahedron winds outward
// ears: the source triangles standing proud of the inner surface at the sides, their root seated into the skull
const earW = new Float32Array(snv);
for (let i = 0; i < snv; i++) { const x = SP[i * 3], y = SP[i * 3 + 1], z = SP[i * 3 + 2], d = dirOfP(x, y, z), proud = d.r - sample(d.az, d.el);
  const side = smooth(0.3, 0.36, Math.abs(x)) * (1 - smooth(1.18, 1.24, y)) * smooth(0.86, 0.92, y) * (1 - smooth(0.06, 0.12, z));
  earW[i] = side * smooth(0.002, 0.014, proud); }
const earG = weldGeo(subset({ P: SP, W: earW }, SI, (t) => earW[SI[t * 3]] > 0.05 && earW[SI[t * 3 + 1]] > 0.05 && earW[SI[t * 3 + 2]] > 0.05));
for (let i = 0; i < earG.P.length / 3; i++) {                          // root vertices sink 1 cm inside the skull
  const x = earG.P[i * 3], y = earG.P[i * 3 + 1], z = earG.P[i * 3 + 2], d = dirOfP(x, y, z), w = earG.W[i];
  if (w < 0.6) { const r = d.r - 0.01 * (1 - w / 0.6), k = r / d.r; earG.P[i * 3] = CEN[0] + (x - CEN[0]) * k; earG.P[i * 3 + 1] = CEN[1] + (y - CEN[1]) * k; earG.P[i * 3 + 2] = CEN[2] + (z - CEN[2]) * k; }
}
{ const EP = Float32Array.from(earG.P); const { rep: er, nb: en } = adjacency(EP, earG.I); taubin(EP, en, er, new Uint8Array(EP.length / 3).fill(1), 6); earG.P = Array.from(EP); }
const nSkull = skullP.length / 3;
let merged = { P: skullP, I: skullI };                                 // the full even sphere: the face stays clean at any distance
const nSk = merged.P.length / 3;
merged = { P: [...merged.P, ...earG.P], I: [...merged.I, ...earG.I.map((i) => i + nSk)] };
const P = Float32Array.from(merged.P), I = merged.I, nv = P.length / 3;
const isEar = new Uint8Array(nv).map((_, i) => (i >= nSk ? 1 : 0));
const { rep, nb } = adjacency(P, I);
const X = (i) => P[i * 3], Y = (i) => P[i * 3 + 1], Z = (i) => P[i * 3 + 2];
// ear tuck: where each ear vertex goes when a hairstyle covers the ears (pressed onto the skull)
const EARTUCK = new Float32Array(nv * 3);
for (let i = nSk; i < nv; i++) { const d = dirOfP(X(i), Y(i), Z(i)), r = sample(d.az, d.el) - 0.002, k = r / d.r - 1;
  EARTUCK[i * 3] = (X(i) - CEN[0]) * k; EARTUCK[i * 3 + 1] = (Y(i) - CEN[1]) * k; EARTUCK[i * 3 + 2] = (Z(i) - CEN[2]) * k; }
console.log(`clean topology: skull ${nSk} verts (from a ${nSkull}-vertex icosphere) + ears ${nv - nSk} verts · ${I.length / 3} tris`);
void isEar;

// ---- 3. landmarks of the neutral face ---------------------------------------------------------------------------
const frontZ = (x, y, r = 0.012) => { let z = -9; for (let i = 0; i < nv; i++) if (Math.abs(X(i) - x) < r && Math.abs(Y(i) - y) < r) z = Math.max(z, Z(i)); return z; };
// FAMILY LAYOUT: the mean of the approved production faces (gelo, jan, kael, micah, france, nicole, jona), measured
// relative to each rig's Head joint and re-seated on the base's Head joint (y 0.786): eyes ±0.171 at +0.302,
// opening ≈ 0.08 × 0.05; brows +0.365; mouth +0.128 (the nose sits between, small)
const EYE = { x: 0.168, y: 1.086, hw: 0.08, hh: 0.05 };
const NOSE = { y: 0.975, z: frontZ(0, 0.975) };
const MOUTH = { y: 0.912, z: frontZ(0, 0.912) };
console.log(`nose base z ${NOSE.z.toFixed(3)} · mouth z ${MOUTH.z.toFixed(3)}`);

// ---- 4. the canonical nose and lips (displacement fields along the surface normal) -----------------------------
const N1 = weldNormals(P, computeNormals(P, I));
const g2 = (dx, dy, sx, sy) => Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2));
/** THE NOSE (locked family construction): a projecting rounded tip, a defined bridge rising to the brow line, soft
 *  alar wings with a crease, a short columella under the tip. Identity scales projection / width / length. */
function noseField(x, y, size = 1, width = 1, length = 0) {
  const ty = NOSE.y - 0.012 * length;                           // a longer nose: the tip lower
  // family: a small soft rounded nub (the production faces barely model the nose), a faint bridge
  const tip = 0.017 * size * g2(x, y - ty, 0.026 * width, 0.022);
  const bridge = 0.004 * size * g2(x, 0, 0.015 * width, 1) * smooth(ty - 0.005, ty + 0.03, y) * (1 - smooth(ty + 0.07, ty + 0.115, y));
  const wing = (s) => 0.005 * size * g2(x - s * 0.032 * width, y - (ty - 0.012), 0.017 * width, 0.015);
  const crease = -0.004 * size * (g2(Math.abs(x) - 0.048 * width, y - (ty - 0.008), 0.006, 0.014));
  const under = -0.006 * size * g2(x, y - (ty - 0.03), 0.03 * width, 0.006);   // the shadowed underside of the tip
  return tip + bridge + wing(1) + wing(-1) + crease + under;
}
/** BROW RIDGE + UPPER-LID FOLD (shared construction): the brows sit on real form, the eyes in a lidded socket */
function browLidField(x, y) {
  const ax = Math.abs(x), ex = EYE.x, ey = EYE.y;
  // broad and gentle: the forms are felt, never seen as bumps (the lid line itself is drawn by the face layer)
  const ridge = 0.005 * g2(ax - (ex + 0.01), y - (ey + 0.1), 0.1, 0.035);
  const lid = 0.0025 * g2(ax - ex, y - (ey + 0.05), 0.08, 0.02);
  const socket = -0.0025 * g2(ax - ex, y - ey, 0.085, 0.055);
  return ridge + lid + socket;
}
/** the lips: a soft upper and a fuller lower volume, a faint parting line between */
function lipField(x, y, full = 1) {
  // soft volumes only (the parting line is painted): sharper fields alias against the mesh density as ridges
  const up = 0.004 * full * g2(x, y - (MOUTH.y + 0.011), 0.05, 0.013);
  const lo = 0.0058 * full * g2(x, y - (MOUTH.y - 0.014), 0.044, 0.015);
  return up + lo;
}
const front = (i) => smooth(0.15, 0.45, N1[i * 3 + 2]);
const BASEP = new Float32Array(P);
for (let i = 0; i < nv; i++) {
  const d = (noseField(X(i), Y(i)) + lipField(X(i), Y(i)) + browLidField(X(i), Y(i))) * front(i);
  for (let k = 0; k < 3; k++) BASEP[i * 3 + k] += N1[i * 3 + k] * d;
}

// ---- 5. the bounded identity controls (morph targets) -------------------------------------------------------
const M = {};
const delta = (fn) => { const D = new Float32Array(nv * 3); for (let i = 0; i < nv; i++) { const d = fn(i, BASEP[i * 3], BASEP[i * 3 + 1], BASEP[i * 3 + 2]); D[i * 3] = d[0]; D[i * 3 + 1] = d[1]; D[i * 3 + 2] = d[2]; } return D; };
const neckFix = (y) => smooth(0.775, 0.81, y);                  // the neck stub never moves (it meets the body)
// face width: the lower face and cheeks widen; the skull above the temples keeps its size
M.faceWidth = delta((i, x, y) => [x * 0.07 * neckFix(y) * (1 - smooth(1.06, 1.26, y)), 0, 0]);
// jaw width: the jaw line below the mouth
M.jawWidth = delta((i, x, y) => [x * 0.09 * neckFix(y) * (1 - smooth(0.88, 0.98, y)), 0, 0]);
// chin length: the chin front moves down (or up)
M.chinLength = delta((i, x, y, z) => [0, -0.024 * neckFix(y) * (1 - smooth(0.86, 0.93, y)) * smooth(-0.05, 0.2, z) * (1 - smooth(0.14, 0.26, Math.abs(x))), 0]);
// cheek fullness: a soft bulge over each cheek
M.cheekFull = delta((i, x, y) => { const d = 0.022 * (g2(Math.abs(x) - 0.235, y - 0.93, 0.085, 0.07)) * smooth(-0.1, 0.3, N1[i * 3 + 2]) * neckFix(y); return [N1[i * 3] * d, N1[i * 3 + 1] * d, N1[i * 3 + 2] * d]; });
// nose size / width: the nose field re-evaluated, minus the canonical one
M.noseSize = delta((i, x, y) => { const d = (noseField(x, y, 1.75, 1) - noseField(x, y)) * front(i); return [N1[i * 3] * d, N1[i * 3 + 1] * d, N1[i * 3 + 2] * d]; });
M.noseLength = delta((i, x, y) => { const d = (noseField(x, y, 1, 1, 1) - noseField(x, y)) * front(i); return [N1[i * 3] * d, N1[i * 3 + 1] * d, N1[i * 3 + 2] * d]; });
M.noseWidth = delta((i, x, y) => { const d = (noseField(x, y, 1, 1.45) - noseField(x, y)) * front(i); return [N1[i * 3] * d, N1[i * 3 + 1] * d, N1[i * 3 + 2] * d]; });
// forehead: the eyes and brows sit lower (a taller forehead) — the mid-face compresses, the jaw stays
M.forehead = delta((i, x, y, z) => [0, -0.02 * smooth(0.9, 1.02, y) * (1 - smooth(1.2, 1.34, y)) * smooth(0.0, 0.2, z), 0]);
// ear size: each ear scaled about its own centre
const EAR = (() => { let s = [0, 0, 0], n = 0; for (let i = 0; i < nv; i++) if (X(i) > 0.37 && Y(i) > 0.95 && Y(i) < 1.12 && Math.abs(Z(i)) < 0.14) { s[0] += X(i); s[1] += Y(i); s[2] += Z(i); n++; } return s.map((v) => v / Math.max(1, n)); })();
M.earSize = delta((i, x, y, z) => { const sx = Math.sign(x) || 1, dx = x - sx * EAR[0], dy = y - EAR[1], dz = z - EAR[2]; const r = Math.hypot(dx, dy, dz);
  const w = (1 - smooth(0.06, 0.1, r)) * smooth(0.33, 0.37, Math.abs(x)); return [dx * 0.2 * w, dy * 0.2 * w, dz * 0.2 * w]; });
// ear tuck (not an identity control): a hairstyle that covers the ears requests it
M.earTuck = EARTUCK;
// lip fullness
M.lipFull = delta((i, x, y) => { const d = lipField(x, y, 1.0) * front(i); return [N1[i * 3] * d, N1[i * 3 + 1] * d, N1[i * 3 + 2] * d]; });
console.log(`ear centre ${EAR.map((v) => v.toFixed(3))} · morphs ${Object.keys(M).join(", ")}`);

// ---- 6. baked soft depth (concavity), normals, weights -------------------------------------------------------------
const NB = weldNormals(BASEP, computeNormals(BASEP, I));
const AO = new Float32Array(nv);
{
  const cav = new Float32Array(nv);
  for (let i = 0; i < nv; i++) { const r = rep[i]; if (r !== i || !nb[i].length) continue; let ax = 0, ay = 0, az = 0; for (const j of nb[i]) { ax += BASEP[j * 3]; ay += BASEP[j * 3 + 1]; az += BASEP[j * 3 + 2]; }
    const n = nb[i].length; cav[i] = (ax / n - BASEP[i * 3]) * NB[i * 3] + (ay / n - BASEP[i * 3 + 1]) * NB[i * 3 + 1] + (az / n - BASEP[i * 3 + 2]) * NB[i * 3 + 2]; }
  for (let it = 0; it < 6; it++) { const c2 = new Float32Array(cav); for (let i = 0; i < nv; i++) { if (rep[i] !== i || !nb[i].length) continue; let a = cav[i]; for (const j of nb[i]) a += cav[j]; c2[i] = a / (nb[i].length + 1); } cav.set(c2); }
  // only real concavities (ears, under the jaw, the nose wings) — mesh-scale noise must not read as streaks
  for (let it = 0; it < 14; it++) { const c2 = new Float32Array(cav); for (let i = 0; i < nv; i++) { if (rep[i] !== i || !nb[i].length) continue; let a = cav[i]; for (const j of nb[i]) a += cav[j]; c2[i] = a / (nb[i].length + 1); } cav.set(c2); }
  for (let i = 0; i < nv; i++) { const c = cav[rep[i]]; AO[i] = Math.max(0.6, Math.min(1, 1 - Math.max(0, c - 0.0004) * 220)); }
}
const HJ = base.JI.Head, NJ = base.JI.neck;
const J = new Uint8Array(nv * 4), W = new Float32Array(nv * 4);
for (let i = 0; i < nv; i++) { const wn = 0.5 * (1 - smooth(0.78, 0.84, BASEP[i * 3 + 1])); J[i * 4] = HJ; W[i * 4] = 1 - wn; J[i * 4 + 1] = NJ; W[i * 4 + 1] = wn; }

// ---- 7. face shells: fold-free grids just in front of the neutral face -------------------------------------------
function shell(cx, cy, hw, hh, maxR, side) {
  const CELL = 0.003, x0 = cx - hw * maxR - 0.01, y0 = cy - hh * maxR - 0.01;
  const NX = Math.ceil((2 * hw * maxR + 0.02) / CELL), NY = Math.ceil((2 * hh * maxR + 0.02) / CELL);
  let H = new Float32Array(NX * NY).fill(-9);
  for (let i = 0; i < nv; i++) { if (BASEP[i * 3 + 2] < 0.15) continue; const gx = Math.floor((BASEP[i * 3] - x0) / CELL), gy = Math.floor((BASEP[i * 3 + 1] - y0) / CELL);
    if (gx < 0 || gy < 0 || gx >= NX || gy >= NY) continue; H[gy * NX + gx] = Math.max(H[gy * NX + gx], BASEP[i * 3 + 2]); }
  for (let pass = 0; pass < 30; pass++) { const H2 = new Float32Array(H); let n = 0;
    for (let gy = 0; gy < NY; gy++) for (let gx = 0; gx < NX; gx++) { const k = gy * NX + gx; if (H[k] > -9) continue; let a = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x2 = gx + dx, y2 = gy + dy; if (x2 < 0 || y2 < 0 || x2 >= NX || y2 >= NY || H[y2 * NX + x2] <= -9) continue; a += H[y2 * NX + x2]; c++; }
      if (c) { H2[k] = a / c; n++; } } H = H2; if (!n) break; }
  for (let pass = 0; pass < 2; pass++) { const H2 = new Float32Array(H); for (let gy = 1; gy < NY - 1; gy++) for (let gx = 1; gx < NX - 1; gx++) { let m = -9; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, H[(gy + dy) * NX + gx + dx]); H2[gy * NX + gx] = m; } H = H2; }
  for (let pass = 0; pass < 3; pass++) { const H2 = new Float32Array(H); for (let gy = 1; gy < NY - 1; gy++) for (let gx = 1; gx < NX - 1; gx++) { let a = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += H[(gy + dy) * NX + gx + dx]; H2[gy * NX + gx] = a / 9; } H = H2; }
  const zAt = (x, y) => { const fx = (x - x0) / CELL - 0.5, fy = (y - y0) / CELL - 0.5; const gx = Math.max(0, Math.min(NX - 2, Math.floor(fx))), gy = Math.max(0, Math.min(NY - 2, Math.floor(fy)));
    const u = Math.min(1, Math.max(0, fx - gx)), v = Math.min(1, Math.max(0, fy - gy)); const h = (a, b) => H[b * NX + a];
    return (h(gx, gy) * (1 - u) + h(gx + 1, gy) * u) * (1 - v) + (h(gx, gy + 1) * (1 - u) + h(gx + 1, gy + 1) * u) * v; };
  const G = 60, Pg = [], UVg = [], Ig = [], SIDE = [], idx = new Int32Array((G + 1) * (G + 1)).fill(-1);
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { const u = (i / G * 2 - 1) * maxR, v = (j / G * 2 - 1) * maxR; if (Math.hypot(u, v) > maxR * 1.02) continue;
    const x = cx + u * hw, y = cy + v * hh; idx[j * (G + 1) + i] = Pg.length / 3; Pg.push(x, y, zAt(x, y) + 0.0018); UVg.push(u, v); SIDE.push(side); }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = idx[j * (G + 1) + i], b = idx[j * (G + 1) + i + 1], c = idx[(j + 1) * (G + 1) + i], d = idx[(j + 1) * (G + 1) + i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue; Ig.push(a, b, c, b, d, c); }
  return { P: Pg, N: Array.from(computeNormals(Pg, Ig)), UV: UVg, SIDE, I: Ig };
}
const eL = shell(EYE.x, EYE.y, EYE.hw, EYE.hh, 2.1, 1), eR = shell(-EYE.x, EYE.y, EYE.hw, EYE.hh, 2.1, -1);
const eyes = { P: [...eL.P, ...eR.P], N: [...eL.N, ...eR.N], UV: [...eL.UV, ...eR.UV], SIDE: [...eL.SIDE, ...eR.SIDE], I: [...eL.I, ...eR.I.map((i) => i + eL.P.length / 3)] };
const MW = 0.0708;
const mouth = shell(0, MOUTH.y, MW * 1.25, MW * 1.25, 1.35, 0);
const rigid = (n) => { const j = new Uint8Array(n * 4), w = new Float32Array(n * 4); for (let i = 0; i < n; i++) { j[i * 4] = HJ; w[i * 4] = 1; } return { J: j, W: w }; };

// ---- 8. landmarks + write ---------------------------------------------------------------------------------------
const eyeZ = frontZ(EYE.x, EYE.y);
const landmarks = {
  eyes: { l: [EYE.x, EYE.y, eyeZ], r: [-EYE.x, EYE.y, eyeZ], halfW: EYE.hw, halfH: EYE.hh, lashTop: 1.5 },
  mouth: { c: [0, MOUTH.y, MOUTH.z], halfW: MW },
  nose: { c: [0, NOSE.y, NOSE.z + 0.02] },
  bridge: [0, 1.072, frontZ(0, 1.072) + 0.028],
  ears: { l: EAR, r: [-EAR[0], EAR[1], EAR[2]] },
  forward: [0, EYE.y, 2],
  skin: "#efb38c", iris: "#2c2420",
};
const MORPH_NAMES = Object.keys(M);
const morphsFor = (pts) => transferMorphs(BASEP, M, pts, 6);
const headBytes = await writeModule(`${BASE_OUT}/identity/canonical-head-v1.glb`, base, [
  { name: "identity_head", P: BASEP, N: NB, I, J, W, extraAttrs: { _AO: { type: "SCALAR", array: AO } }, morphs: M, material: { name: "identity_skin", roughness: 0.75 } },
  { name: "face_eyes", P: eyes.P, N: eyes.N, UV: eyes.UV, I: eyes.I, ...rigid(eyes.P.length / 3), morphs: morphsFor(eyes.P),
    extraAttrs: { _SIDE: { type: "SCALAR", array: new Float32Array(eyes.SIDE) } }, material: { name: "face_eyes", roughness: 0.4 } },
  { name: "face_mouth", P: mouth.P, N: mouth.N, UV: mouth.UV, I: mouth.I, ...rigid(mouth.P.length / 3), morphs: morphsFor(mouth.P), material: { name: "face_mouth", roughness: 0.7 } },
], { humanIdentity: { id: "canonical-head-v1", base: C.HUMAN_BASE_VERSION, canonical: true, landmarks, hides: [], morphs: MORPH_NAMES } }, { compress: "quantize" });

// ---- 9. the canonical glasses: classic rectangular black frames around the canonical eyes ------------------------
{
  // sized to the face, not over it: just round the eye openings, slim rims
  const RIM = { x0: 0.058, x1: 0.262, y0: 0.995, y1: 1.128, w: 0.016, depth: 0.016 };
  RIM.zf = Math.max(frontZ(0.17, 1.06, 0.03), frontZ(0.04, 1.06, 0.02)) + 0.03;
  const GP = [], GI = [];
  const addV = (x, y, z) => { GP.push(x, y, z); return GP.length / 3 - 1; };
  const rr = (cx, cy, hw, hh, r, phi) => { const dx = Math.cos(phi), dy = Math.sin(phi); let lo = 0, hi = Math.max(hw, hh) * 2;
    const inside = (t) => { const x = Math.abs(dx * t), y = Math.abs(dy * t); const qx = Math.max(0, x - (hw - r)), qy = Math.max(0, y - (hh - r)); return x <= hw && y <= hh && Math.hypot(qx, qy) <= r; };
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; } return [cx + dx * lo, cy + dy * lo]; };
  for (const sx of [1, -1]) {
    const cx = sx * (RIM.x0 + RIM.x1) / 2, cy = (RIM.y0 + RIM.y1) / 2, hw = (RIM.x1 - RIM.x0) / 2, hh = (RIM.y1 - RIM.y0) / 2, N = 120;
    const C4 = [[0.003, 0.045, RIM.zf], [RIM.w - 0.003, 0.03, RIM.zf], [RIM.w, 0.03, RIM.zf - RIM.depth], [0, 0.045, RIM.zf - RIM.depth], [0, 0.045, RIM.zf - 0.003], [RIM.w, 0.03, RIM.zf - 0.003]];
    const pts = C4.map(([inset, r, z]) => Array.from({ length: N }, (_, k) => { const [x, y] = rr(cx, cy, hw - inset, hh - inset, r, (k / N) * Math.PI * 2); return [x, y, z - 1.3 * Math.max(0, Math.abs(x) - 0.2) ** 2]; }));
    const band = (a, b) => { const A = pts[a].map((p) => addV(...p)), B = pts[b].map((p) => addV(...p)); for (let k = 0; k < N; k++) { const k1 = (k + 1) % N; if (sx > 0) GI.push(A[k], B[k], A[k1], A[k1], B[k], B[k1]); else GI.push(A[k], A[k1], B[k], A[k1], B[k1], B[k]); } };
    band(0, 1); band(1, 5); band(5, 2); band(2, 3); band(3, 4); band(4, 0);
  }
  { const y0 = RIM.y1 - 0.05, y1 = RIM.y1 - 0.026, xa = RIM.x0 + 0.008, zf = RIM.zf - 0.004, zb = RIM.zf - RIM.depth + 0.004;
    const c = [[-xa, y0, zf], [xa, y0, zf], [xa, y1, zf], [-xa, y1, zf], [-xa, y0, zb], [xa, y0, zb], [xa, y1, zb], [-xa, y1, zb]].map(([x, y, z]) => addV(x, y, z));
    for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [3, 2, 6, 7], [4, 5, 1, 0]]) GI.push(c[a], c[b], c[cc], c[a], c[cc], c[d]); }
  { const yT = RIM.y1 - 0.045;
    const sideAt = (z) => { let m = 0; for (let i = 0; i < nv; i++) { if (Math.abs(BASEP[i * 3 + 1] - yT) > 0.014 || Math.abs(BASEP[i * 3 + 2] - z) > 0.012) continue; m = Math.max(m, Math.abs(BASEP[i * 3])); } return m; };
    for (const sx of [1, -1]) {
      const path = []; for (let z = RIM.zf - RIM.depth * 0.5; z > -0.03; z -= 0.025) path.push([sx * Math.max(RIM.x1 - 0.01, sideAt(z) + 0.012), yT, z]);
      const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p))); const n = 40, seg = 10, b0 = GP.length / 3;
      for (let k = 0; k <= n; k++) { const c = curve.getPointAt(k / n); for (let q = 0; q < seg; q++) { const a = (q / seg) * Math.PI * 2; addV(c.x + Math.cos(a) * 0.003, c.y + Math.sin(a) * 0.006, c.z); } }
      for (let k = 0; k < n; k++) for (let q = 0; q < seg; q++) { const a = b0 + k * seg + q, b = b0 + k * seg + (q + 1) % seg; if (sx > 0) GI.push(a, a + seg, b, b, a + seg, b + seg); else GI.push(a, b, a + seg, b, b + seg, a + seg); }
    }
  }
  const GN = computeNormals(GP, GI);
  const gBytes = await writeModule(`${BASE_OUT}/accessories/glasses-classic.glb`, base, [
    { name: "glasses_classic", P: GP, N: GN, COLOR: new Float32Array(GP.length).fill(0.07), I: GI, ...rigid(GP.length / 3), morphs: morphsFor(GP), material: { name: "glasses_frame", roughness: 0.28, doubleSided: true } },
  ], { humanAccessory: { id: "glasses-classic", slot: "glasses", base: C.HUMAN_BASE_VERSION, fittedTo: "canonical-head-v1" } }, { compress: "quantize" });
  console.log(`glasses-classic ${GI.length / 3} tris ${(gBytes / 1e3).toFixed(0)} KB`);
}
fs.mkdirSync("scripts/avatar-pipeline/output/human-base", { recursive: true });
fs.writeFileSync("scripts/avatar-pipeline/output/human-base/canonical-head-work.json", JSON.stringify({ P: Array.from(BASEP), I, morphs: Object.fromEntries(Object.entries(M).map(([k, v]) => [k, Array.from(v)])), landmarks }));
console.log(`canonical head ${(headBytes / 1e6).toFixed(2)} MB · ${I.length / 3} tris + eyes ${eyes.I.length / 3} + mouth ${mouth.I.length / 3}`);
