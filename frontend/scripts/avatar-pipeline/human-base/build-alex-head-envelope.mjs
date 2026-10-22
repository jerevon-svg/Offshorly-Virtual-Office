// build-alex-head-envelope.mjs — THE NEUTRAL HUMANBASE HEAD, TAKEN FROM PRODUCTION ALEX'S REAL HEAD. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-alex-head-envelope.mjs
//
// Alex is the canonical HumanBase body; his approved production head is also the canonical SKULL. This build takes
// exactly the head build-human-base.mjs cut away (same donor file, same left-half mirror, same isHead rule — so the
// head's open edge is the base's neck-stub edge) and removes only Alex's IDENTITY:
//   · glasses: the fused black frame (the one large black connected surface spanning the face) is filled flush with
//     the surrounding skin (harmonic fill of positions) — the skull under it is untouched;
//   · face features (brows, eyes, nose, mouth, beard relief) inside the front face oval are relaxed by many Taubin
//     passes (no shrinking), so the face keeps Alex's facial PLANE, jaw/chin extent and cheek volume but no features;
//   · texture: none — one flat skin material (beard/brow/eye paint gone).
// The cranium, crown, occiput, ears, jaw outline and neck are Alex's own geometry, vertex for vertex.
//
// Output: public/avatars/human-base-v1/identity/alex-neutral-head-v1.glb (identity slot, landmarks = Alex's)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import * as THREE from "three";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, adjacency, computeNormals, harmonic, loadBase, simplifyGeo, subset, taubin, weldGeo, weldNormals, writeModule } from "./lib.mjs";

const SRC = "public/avatars/alex-v2-hq-idle9/alex-v2-lod0.glb";
const TRIS = Number(process.env.HEAD_TRIS ?? 40_000);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
await MeshoptSimplifier.ready;

const doc = await io.read(SRC), root = doc.getRoot(), prim = root.listMeshes()[0].listPrimitives()[0];
const skin = root.listSkins()[0], jointNames = skin.listJoints().map((j) => j.getName());
if (jointNames.join() !== C.HUMAN_CORE_JOINTS.join()) throw new Error("donor joints are not the contract core");
const JI = Object.fromEntries(jointNames.map((n, i) => [n, i]));
const ibm = skin.getInverseBindMatrices().getArray();
const jointPos = (n) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(ibm, JI[n] * 16).invert());
const neckZ = jointPos("neck").z, HEAD = jointPos("Head").setX(0);

// ---- 1. the same left-half mirror as build-human-base.mjs ------------------------------------------------------
const P0 = prim.getAttribute("POSITION").getArray(), UV0 = prim.getAttribute("TEXCOORD_0").getArray();
const J0 = prim.getAttribute("JOINTS_0").getArray(), W0 = prim.getAttribute("WEIGHTS_0").getArray(), I0 = prim.getIndices().getArray();
const nv0 = P0.length / 3, mirrorIdx = jointNames.map((n) => JI[C.mirrorJoint(n)]);
const posKey = (x, y, z) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
const keepTri = []; for (let t = 0; t < I0.length; t += 3) if ((P0[I0[t] * 3] + P0[I0[t + 1] * 3] + P0[I0[t + 2] * 3]) / 3 >= 0) keepTri.push(t);
const wid = new Int32Array(nv0); { const m = new Map(); for (let i = 0; i < nv0; i++) { const k = posKey(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]); if (!m.has(k)) m.set(k, i); wid[i] = m.get(k); } }
const edgeUse = new Map();
for (const t of keepTri) for (let k = 0; k < 3; k++) { let a = wid[I0[t + k]], b = wid[I0[t + (k + 1) % 3]]; if (a > b) [a, b] = [b, a]; const key = a * nv0 + b; edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1); }
const onSeam = new Uint8Array(nv0);
for (const [key, c] of edgeUse) { if (c !== 1) continue; const a = Math.floor(key / nv0), b = key % nv0; if (Math.abs(P0[a * 3]) < 0.02 && Math.abs(P0[b * 3]) < 0.02) { onSeam[a] = 1; onSeam[b] = 1; } }
for (let i = 0; i < nv0; i++) if (onSeam[wid[i]]) onSeam[i] = 1;
const used = new Uint8Array(nv0); for (const t of keepTri) for (let k = 0; k < 3; k++) used[I0[t + k]] = 1;
const P = [], UV = [], J = [], W = [], newOf = new Int32Array(nv0).fill(-1), mirOf = new Int32Array(nv0).fill(-1);
const pushV = (i, mirror) => {
  const x = onSeam[i] ? 0 : P0[i * 3]; P.push(mirror ? -x : x, P0[i * 3 + 1], P0[i * 3 + 2]); UV.push(UV0[i * 2], UV0[i * 2 + 1]);
  const w = {};
  for (let k = 0; k < 4; k++) { const wt = W0[i * 4 + k]; if (wt <= 0) continue; const j = J0[i * 4 + k];
    if (onSeam[i]) { w[j] = (w[j] ?? 0) + wt / 2; w[mirrorIdx[j]] = (w[mirrorIdx[j]] ?? 0) + wt / 2; } else { const jj = mirror ? mirrorIdx[j] : j; w[jj] = (w[jj] ?? 0) + wt; } }
  const top = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4), s = top.reduce((a, [, v]) => a + v, 0);
  for (let k = 0; k < 4; k++) { J.push(top[k] ? +top[k][0] : 0); W.push(top[k] ? top[k][1] / s : 0); }
  return P.length / 3 - 1;
};
for (let i = 0; i < nv0; i++) if (used[i]) newOf[i] = pushV(i, false);
for (let i = 0; i < nv0; i++) if (used[i]) mirOf[i] = onSeam[i] ? newOf[i] : pushV(i, true);
const I = [];
for (const t of keepTri) I.push(newOf[I0[t]], newOf[I0[t + 1]], newOf[I0[t + 2]]);
for (const t of keepTri) I.push(mirOf[I0[t]], mirOf[I0[t + 2]], mirOf[I0[t + 1]]);

// ---- 2. the head = exactly what the base removed ------------------------------------------------------------------
const HJ = new Set(["Head", "head_end", "headfront"].map((n) => JI[n]));
const isHead = (i) => {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (y > 0.9) return true;
  let w = 0; for (let k = 0; k < 4; k++) if (HJ.has(J[i * 4 + k])) w += W[i * 4 + k];
  return w > 0.5 && !(Math.hypot(x, z - neckZ) < 0.085 && y < 0.86);
};
const head = new Uint8Array(P.length / 3).map((_, i) => (isHead(i) ? 1 : 0));
// texture colour per vertex: only to FIND the glasses (the output carries no texture)
const { data: tex, info: ti } = await sharp(Buffer.from(root.listTextures()[0].getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const COL = []; for (let i = 0; i < UV.length / 2; i++) { const u = Math.min(ti.width - 1, Math.max(0, Math.round((UV[i * 2] % 1) * (ti.width - 1)))), v = Math.min(ti.height - 1, Math.max(0, Math.round((UV[i * 2 + 1] % 1) * (ti.height - 1)))); const o = (v * ti.width + u) * 3; COL.push(tex[o] / 255, tex[o + 1] / 255, tex[o + 2] / 255); }
let g = subset({ P, J, W, COL }, I, (t) => head[I[t * 3]] || head[I[t * 3 + 1]] || head[I[t * 3 + 2]]);
delete g.src;
g = weldGeo(g);
g = simplifyGeo(g, TRIS, 0.002);
const n = g.P.length / 3, GP = Float32Array.from(g.P);
const topo = (P2, I2) => { const key = (i) => `${Math.round(P2[i * 3] * 2e4)},${Math.round(P2[i * 3 + 1] * 2e4)},${Math.round(P2[i * 3 + 2] * 2e4)}`; const m = new Map(), u = new Map();
  const w = (i) => { const k = key(i); if (!m.has(k)) m.set(k, i); return m.get(k); };
  for (let t = 0; t < I2.length; t += 3) for (let q = 0; q < 3; q++) { const a = w(I2[t + q]), b = w(I2[t + (q + 1) % 3]); const k = a < b ? `${a}_${b}` : `${b}_${a}`; u.set(k, (u.get(k) ?? 0) + 1); }
  let b1 = 0, nm = 0; for (const c of u.values()) { if (c === 1) b1++; if (c > 2) nm++; } return `boundary ${b1}, non-manifold ${nm}`; };
if (process.env.TOPO) console.log("after simplify:", topo(GP, g.I));
console.log(`Alex head: ${n} verts, ${g.I.length / 3} tris`);

// islands of the welded head (a fused accessory is often its own floating shell)
const isl = new Int32Array(n).fill(-1), islands = [];
{ const { nb: nb0 } = adjacency(GP, g.I); for (let s0 = 0; s0 < n; s0++) { if (isl[s0] >= 0) continue; const id = islands.length, st = [s0]; let cnt = 0, dk = 0, x0 = 9, x1 = -9, y0 = 9, y1 = -9, z1 = -9; isl[s0] = id;
  while (st.length) { const v = st.pop(); cnt++; const L = 0.3 * g.COL[v * 3] + 0.59 * g.COL[v * 3 + 1] + 0.11 * g.COL[v * 3 + 2]; if (L < 0.1) dk++; x0 = Math.min(x0, GP[v * 3]); x1 = Math.max(x1, GP[v * 3]); y0 = Math.min(y0, GP[v * 3 + 1]); y1 = Math.max(y1, GP[v * 3 + 1]); z1 = Math.max(z1, GP[v * 3 + 2]); for (const w of nb0[v]) if (isl[w] < 0) { isl[w] = id; st.push(w); } }
  islands.push({ id, cnt, dark: +(dk / cnt).toFixed(2), x: [+x0.toFixed(2), +x1.toFixed(2)], y: [+y0.toFixed(2), +y1.toFixed(2)], z1: +z1.toFixed(2) }); } }
islands.sort((a, b) => b.cnt - a.cnt);
if (process.env.ISLANDS) console.log("islands", JSON.stringify(islands.slice(0, 12)));
// ---- 3. find the glasses: the largest dark connected surface across the face -------------------------------------
const { nb, rep } = adjacency(GP, g.I);
const lum = (i) => 0.3 * g.COL[i * 3] + 0.59 * g.COL[i * 3 + 1] + 0.11 * g.COL[i * 3 + 2];
const dark = new Uint8Array(n).map((_, i) => (lum(i) < 0.1 && GP[i * 3 + 1] > 0.95 && GP[i * 3 + 1] < 1.2 ? 1 : 0));
const comp = new Int32Array(n).fill(-1), comps = [];
for (let s = 0; s < n; s++) { if (!dark[s] || comp[s] >= 0) continue; const id = comps.length, st = [s]; let cnt = 0, x0 = 9, x1 = -9, zMax = -9;
  comp[s] = id; while (st.length) { const v = st.pop(); cnt++; x0 = Math.min(x0, GP[v * 3]); x1 = Math.max(x1, GP[v * 3]); zMax = Math.max(zMax, GP[v * 3 + 2]); for (const w of nb[v]) if (dark[w] && comp[w] < 0) { comp[w] = id; st.push(w); } }
  comps.push({ id, cnt, span: x1 - x0, zMax }); }
comps.sort((a, b) => b.cnt - a.cnt);
console.log("dark components", comps.slice(0, 6).map((c) => `#${c.id} n${c.cnt} span${c.span.toFixed(2)} z${c.zMax.toFixed(2)}`).join(" | "));
const glassesIds = new Set(comps.filter((c) => c.span > 0.35).map((c) => c.id));
// the frame plus a 3-ring band around it (its anti-aliased edge and the relief skirt)
let glasses = new Uint8Array(n).map((_, i) => (glassesIds.has(comp[i]) ? 1 : 0));
for (let r = 0; r < 3; r++) { const nx = glasses.slice(); for (let i = 0; i < n; i++) if (glasses[i]) for (const w of nb[i]) nx[w] = 1; glasses = nx; }
console.log(`glasses: ${glasses.reduce((a, b) => a + b, 0)} verts`);

// ---- 4. landmarks from Alex's own eyes (the dark iris blobs inside the frame) --------------------------------------
const irisIds = new Set(comps.filter((c) => !glassesIds.has(c.id) && c.span < 0.25 && c.cnt > 100).map((c) => c.id));
const eyeAcc = { l: [0, 0, 0, 0], r: [0, 0, 0, 0] };
for (let i = 0; i < n; i++) if (irisIds.has(comp[i])) { const a = GP[i * 3] < 0 ? eyeAcc.l : eyeAcc.r; a[0] += GP[i * 3]; a[1] += GP[i * 3 + 1]; a[2] += GP[i * 3 + 2]; a[3]++; }
const eye = (a) => a.slice(0, 3).map((v) => v / Math.max(1, a[3]));
const eL = eye(eyeAcc.l), eR = eye(eyeAcc.r), ex = (Math.abs(eL[0]) + Math.abs(eR[0])) / 2, ey = (eL[1] + eR[1]) / 2, ez = (eL[2] + eR[2]) / 2;
console.log(`eyes: ±${ex.toFixed(3)} y${ey.toFixed(3)} z${ez.toFixed(3)} (iris blobs ${irisIds.size})`);

// ---- 5. neutralise: DELETE the face-feature + frame region and REFILL it as one fresh, even sheet ---------------
// Alex's frames, lids and eyes are folded layers, so no smoothing can flatten them without creases. The region is cut
// out, re-triangulated in the head's angular chart (azimuth/elevation about the head centre), and its radius solved
// harmonically from the hole's rim — so the new face surface continues Alex's own forehead, cheeks and jaw.
let chin = 9; for (let i = 0; i < n; i++) if (Math.abs(GP[i * 3]) < 0.03 && GP[i * 3 + 2] > neckZ + 0.09) chin = Math.min(chin, GP[i * 3 + 1]);
const N0 = computeNormals(GP, g.I);
const CEN = new THREE.Vector3(0, 1.2, -0.02);
const OY0 = chin + 0.06, OY1 = ey + 0.21, OX = 0.335, OC = (OY0 + OY1) / 2, OR = (OY1 - OY0) / 2;
const oval = (i) => (Math.abs(GP[i * 3]) / OX) ** 4 + (Math.abs(GP[i * 3 + 1] - OC) / OR) ** 4;
let band = glasses.slice(); for (let r = 0; r < 2; r++) { const nx = band.slice(); for (let i = 0; i < n; i++) if (band[i]) for (const w of nb[i]) nx[w] = 1; band = nx; }
// a fold left by the frame's side arms faces INTO the head (against the radial direction) — cut it with the band
const foldIn = (i) => { const dx = GP[i * 3] - CEN.x, dy = GP[i * 3 + 1] - CEN.y, dz = GP[i * 3 + 2] - CEN.z, l = Math.hypot(dx, dy, dz) || 1;
  return (N0[i * 3] * dx + N0[i * 3 + 1] * dy + N0[i * 3 + 2] * dz) / l < 0.25 && GP[i * 3 + 1] > 1.0 && GP[i * 3 + 1] < 1.4 && GP[i * 3 + 2] > 0.0 && Math.abs(GP[i * 3]) < 0.37; };
let fold = new Uint8Array(n).map((_, i) => (foldIn(i) ? 1 : 0));
for (let r = 0; r < 2; r++) { const nx = fold.slice(); for (let i = 0; i < n; i++) if (fold[i]) for (const w of nb[i]) nx[w] = 1; fold = nx; }
const cut = new Uint8Array(n).map((_, i) => ((GP[i * 3 + 2] > 0.06 && oval(i) < 1) || band[i] || fold[i] ? 1 : 0));
// anything the cut leaves stranded (folded lid/nose undersides inside the hole) goes too: keep only the main shell
{ const seen = new Int32Array(n).fill(-1); let bestId = -1, bestN = 0;
  for (let s0 = 0; s0 < n; s0++) { if (cut[s0] || seen[s0] >= 0) continue; const st = [s0]; let c0 = 0; seen[s0] = s0;
    while (st.length) { const v = st.pop(); c0++; for (const w of nb[v]) if (!cut[w] && seen[w] < 0) { seen[w] = s0; st.push(w); } }
    if (c0 > bestN) { bestN = c0; bestId = s0; } }
  for (let i = 0; i < n; i++) if (!cut[i] && seen[i] !== bestId) cut[i] = 1; }
const uvOf = (x, y, z) => { const dx = x - CEN.x, dy = y - CEN.y, dz = z - CEN.z; return [Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))]; };
const UVc = new Float32Array(n * 2); for (let i = 0; i < n; i++) UVc.set(uvOf(GP[i * 3], GP[i * 3 + 1], GP[i * 3 + 2]), i * 2);
const keptTri = [], rim = new Uint8Array(n);
for (let t = 0; t < g.I.length; t += 3) { const [a0, b0, c0] = [g.I[t], g.I[t + 1], g.I[t + 2]];
  if (cut[a0] || cut[b0] || cut[c0]) { for (const v of [a0, b0, c0]) if (!cut[v]) rim[v] = 1; } else keptTri.push(a0, b0, c0); }
// fresh interior points on an even angular grid inside the hole (nearest original vertex is a cut one, away from the rim)
const rimE = []; for (let t = 0; t < keptTri.length; t += 3) { const a0 = keptTri[t], b0 = keptTri[t + 1]; if (rim[a0] && rim[b0]) rimE.push(Math.hypot(UVc[a0 * 2] - UVc[b0 * 2], UVc[a0 * 2 + 1] - UVc[b0 * 2 + 1])); }
rimE.sort((x, y) => x - y); const step = rimE[rimE.length >> 1] * 1.2;
const near = (u, v) => { let best = 1e9, bi = -1; for (let i = 0; i < n; i++) { const d = (UVc[i * 2] - u) ** 2 + (UVc[i * 2 + 1] - v) ** 2; if (d < best) { best = d; bi = i; } } return [bi, Math.sqrt(best)]; };
let u0 = 9, u1 = -9, v0 = 9, v1 = -9; for (let i = 0; i < n; i++) if (cut[i]) { u0 = Math.min(u0, UVc[i * 2]); u1 = Math.max(u1, UVc[i * 2]); v0 = Math.min(v0, UVc[i * 2 + 1]); v1 = Math.max(v1, UVc[i * 2 + 1]); }
const rimIdx = []; for (let i = 0; i < n; i++) if (rim[i]) rimIdx.push(i);
// coverage raster of the KEPT surface in the chart: a patch triangle may only lie where nothing is kept
const RG = 900, ru0 = u0 - 0.3, rv0 = v0 - 0.3, rsU = (u1 - u0 + 0.6) / RG, rsV = (v1 - v0 + 0.6) / RG, cover = new Uint8Array(RG * RG);
for (let t = 0; t < keptTri.length; t += 3) {
  const q = [0, 1, 2].map((k) => [(UVc[keptTri[t + k] * 2] - ru0) / rsU, (UVc[keptTri[t + k] * 2 + 1] - rv0) / rsV]);
  const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))), x1 = Math.min(RG - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])));
  const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))), y1 = Math.min(RG - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])));
  if (x1 - x0 > RG / 3 || y1 - y0 > RG / 3) continue;          // a triangle wrapping the chart seam (back of head)
  const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((q[1][0] - px) * (q[2][1] - py) - (q[2][0] - px) * (q[1][1] - py)) / ar, w1 = ((q[2][0] - px) * (q[0][1] - py) - (q[0][0] - px) * (q[2][1] - py)) / ar;
    if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) cover[y * RG + x] = 1; } }
const covered = (u, v) => { const x = Math.floor((u - ru0) / rsU), y = Math.floor((v - rv0) / rsV); return x < 0 || y < 0 || x >= RG || y >= RG ? true : cover[y * RG + x] === 1; };
const pts = rimIdx.map((i) => [UVc[i * 2], UVc[i * 2 + 1]]), fresh = [];
for (let v = v0; v <= v1; v += step * 0.866) for (let u = u0 + ((Math.round((v - v0) / (step * 0.866)) % 2) * step) / 2; u <= u1; u += step) {
  if (covered(u, v)) continue;
  let dRim = 1e9; for (const r of rimIdx) dRim = Math.min(dRim, Math.hypot(UVc[r * 2] - u, UVc[r * 2 + 1] - v)); if (dRim < step * 0.6) continue;
  fresh.push([u, v]); pts.push([u, v]);
}
const { default: Delaunator } = await import("delaunator");
const del = Delaunator.from(pts);
const nR = rimIdx.length, base0 = n, patchTri = [];
const idxOf = (k) => (k < nR ? rimIdx[k] : base0 + (k - nR));
for (let t = 0; t < del.triangles.length; t += 3) {
  const k = [del.triangles[t], del.triangles[t + 1], del.triangles[t + 2]];
  const cu = (pts[k[0]][0] + pts[k[1]][0] + pts[k[2]][0]) / 3, cv = (pts[k[0]][1] + pts[k[1]][1] + pts[k[2]][1]) / 3;
  if (covered(cu, cv)) continue;                                         // only triangles over the hole
  const maxE = Math.max(...[0, 1, 2].map((q) => Math.hypot(pts[k[q]][0] - pts[k[(q + 1) % 3]][0], pts[k[q]][1] - pts[k[(q + 1) % 3]][1])));
  if (maxE > step * 3) continue;
  patchTri.push(idxOf(k[0]), idxOf(k[1]), idxOf(k[2]));
}
// radii: rim fixed, interior harmonic over the patch
const nF = fresh.length, TOT = n + nF, rad = new Float32Array(TOT), DIR = new Float32Array(TOT * 3);
for (let i = 0; i < n; i++) { const v = new THREE.Vector3(GP[i * 3], GP[i * 3 + 1], GP[i * 3 + 2]).sub(CEN); rad[i] = v.length(); }
const dirOf = (u, v) => [Math.sin(u) * Math.cos(v), Math.sin(v), Math.cos(u) * Math.cos(v)];
for (let f = 0; f < nF; f++) { DIR.set(dirOf(fresh[f][0], fresh[f][1]), (n + f) * 3); const [bi] = near(fresh[f][0], fresh[f][1]); rad[n + f] = rad[bi]; }
const pnb = Array.from({ length: TOT }, () => new Set());
for (let t = 0; t < patchTri.length; t += 3) for (let q = 0; q < 3; q++) { const a0 = patchTri[t + q], b0 = patchTri[t + (q + 1) % 3]; pnb[a0].add(b0); pnb[b0].add(a0); }
// data: Alex's own skin radius along each fresh direction (nearest non-frame original vertex), then a strong
// smoothness prior — features (sockets, nose, lips, brows) average out, Alex's facial PLANE stays where it was
const nearSkin = (u, v) => { let best = 1e9, bi = -1; for (let i = 0; i < n; i++) { if (glasses[i]) continue; const d = (UVc[i * 2] - u) ** 2 + (UVc[i * 2 + 1] - v) ** 2; if (d < best) { best = d; bi = i; } } return bi; };
const r0 = new Float32Array(TOT); for (let i = 0; i < n; i++) r0[i] = rad[i];
for (let f = 0; f < nF; f++) r0[n + f] = rad[nearSkin(fresh[f][0], fresh[f][1])];
for (let f = n; f < TOT; f++) rad[f] = r0[f];
const LAM = 40;
for (let it = 0; it < 5000; it++) for (let f = n; f < TOT; f++) { let s2 = 0, c2 = 0; for (const w of pnb[f]) { s2 += rad[w]; c2++; } if (c2) rad[f] = (r0[f] + LAM * s2) / (1 + LAM * c2); }
// assemble: kept original triangles + the patch (oriented outward)
const NP = new Float32Array(TOT * 3); NP.set(GP.subarray(0, n * 3));
for (let f = n; f < TOT; f++) for (let q = 0; q < 3; q++) NP[f * 3 + q] = CEN.getComponent(q) + DIR[f * 3 + q] * rad[f];
const fixTri = [];
for (let t = 0; t < patchTri.length; t += 3) { const [a0, b0, c0] = [patchTri[t], patchTri[t + 1], patchTri[t + 2]];
  const A = new THREE.Vector3().fromArray(NP, a0 * 3), B = new THREE.Vector3().fromArray(NP, b0 * 3), Cc = new THREE.Vector3().fromArray(NP, c0 * 3);
  const nrm = B.clone().sub(A).cross(Cc.clone().sub(A)), out = A.clone().add(B).add(Cc).divideScalar(3).sub(CEN);
  if (nrm.dot(out) < 0) fixTri.push(a0, c0, b0); else fixTri.push(a0, b0, c0); }
const allI = [...keptTri, ...fixTri];
// weights: a fresh vertex takes the weights of the nearest original vertex (the face is Head-rigid there)
const J2 = Array.from(g.J), W2 = Array.from(g.W);
for (let f = 0; f < nF; f++) { const [bi] = near(fresh[f][0], fresh[f][1]); for (let k = 0; k < 4; k++) { J2.push(g.J[bi * 4 + k]); W2.push(g.W[bi * 4 + k]); } }
// compact (drop the cut vertices), then relax the patch and a 3-ring around its rim so the join is invisible
const keepV = new Int32Array(TOT).fill(-1); let m2 = 0; for (const v of allI) if (keepV[v] < 0) keepV[v] = m2++;
const FP = new Float32Array(m2 * 3), FJ = new Array(m2 * 4), FW = new Array(m2 * 4), isPatch = new Uint8Array(m2);
for (let v = 0; v < TOT; v++) { const k = keepV[v]; if (k < 0) continue; FP.set(NP.subarray(v * 3, v * 3 + 3), k * 3); for (let q = 0; q < 4; q++) { FJ[k * 4 + q] = J2[v * 4 + q]; FW[k * 4 + q] = W2[v * 4 + q]; } if (v >= n || rim[v]) isPatch[k] = 1; }
const FI = allI.map((v) => keepV[v]);
// close every small open loop the chart could not cover (temple/jaw slivers); the neck opening — the base's seam — stays open
const FPx = Array.from(FP), FJx = FJ, FWx = FW; let isPatchX = Array.from(isPatch), filled = 0;
{
  const key = (i) => `${Math.round(FPx[i * 3] * 2e4)},${Math.round(FPx[i * 3 + 1] * 2e4)},${Math.round(FPx[i * 3 + 2] * 2e4)}`;
  const wmap = new Map(), wid2 = new Int32Array(m2); for (let i = 0; i < m2; i++) { const k = key(i); if (!wmap.has(k)) wmap.set(k, i); wid2[i] = wmap.get(k); }
  // boundary edges (used by one triangle) as an undirected graph; small cycles are walked even across non-manifold rims
  const und = new Map();
  for (let t = 0; t < FI.length; t += 3) for (let q = 0; q < 3; q++) { const a0 = wid2[FI[t + q]], b0 = wid2[FI[t + (q + 1) % 3]]; if (a0 === b0) continue; const k = a0 < b0 ? `${a0}_${b0}` : `${b0}_${a0}`; und.set(k, (und.get(k) ?? 0) + 1); }
  const bAdj = new Map(), used = new Set();
  for (const [k, c] of und) { if (c !== 1) continue; const [a0, b0] = k.split("_").map(Number); (bAdj.get(a0) ?? bAdj.set(a0, []).get(a0)).push(b0); (bAdj.get(b0) ?? bAdj.set(b0, []).get(b0)).push(a0); }
  const ek = (a0, b0) => (a0 < b0 ? `${a0}_${b0}` : `${b0}_${a0}`);
  for (const [start, nbs] of bAdj) for (const first of nbs) {
    if (used.has(ek(start, first))) continue;
    const loop = [start]; let prev = start, cur = first, ok = false; const local = new Set([ek(start, first)]);
    for (let step2 = 0; step2 < 80; step2++) {
      if (cur === start) { ok = true; break; }
      loop.push(cur);
      const nxt = (bAdj.get(cur) ?? []).filter((x) => x !== prev && !used.has(ek(cur, x)) && !local.has(ek(cur, x)));
      if (!nxt.length) break;
      // prefer closing the loop, else the nearest unused continuation
      const go = nxt.includes(start) && loop.length > 2 ? start : nxt.sort((x, y) => Math.hypot(FPx[x * 3] - FPx[cur * 3], FPx[x * 3 + 1] - FPx[cur * 3 + 1], FPx[x * 3 + 2] - FPx[cur * 3 + 2]) - Math.hypot(FPx[y * 3] - FPx[cur * 3], FPx[y * 3 + 1] - FPx[cur * 3 + 1], FPx[y * 3 + 2] - FPx[cur * 3 + 2]))[0];
      local.add(ek(cur, go)); prev = cur; cur = go;
    }
    if (!ok || loop.length < 3) continue;
    const meanY = loop.reduce((a0, i) => a0 + FPx[i * 3 + 1], 0) / loop.length;
    if (meanY < 0.9) continue;                                            // the neck seam stays open
    for (const k of local) used.add(k);
    const c = [0, 1, 2].map((q) => loop.reduce((a0, i) => a0 + FPx[i * 3 + q], 0) / loop.length), ci = FPx.length / 3;
    FPx.push(...c); for (let q = 0; q < 4; q++) { FJx.push(FJx[loop[0] * 4 + q]); FWx.push(FWx[loop[0] * 4 + q]); } isPatchX.push(1);
    for (let k = 0; k < loop.length; k++) {           // each fan triangle faces outward (radially from the head centre)
      const a0 = loop[k], b0 = loop[(k + 1) % loop.length];
      const A = new THREE.Vector3(FPx[a0 * 3], FPx[a0 * 3 + 1], FPx[a0 * 3 + 2]), B = new THREE.Vector3(FPx[b0 * 3], FPx[b0 * 3 + 1], FPx[b0 * 3 + 2]), Cc = new THREE.Vector3(...c);
      const nrm = B.clone().sub(A).cross(Cc.clone().sub(A)), out = A.clone().add(B).add(Cc).divideScalar(3).sub(CEN);
      if (nrm.dot(out) < 0) FI.push(a0, ci, b0); else FI.push(a0, b0, ci); }
    for (const i of loop) isPatchX[i] = 1; filled++;
  }
}
console.log(`closed ${filled} small open loops`);
const FP2 = Float32Array.from(FPx), m3 = FP2.length / 3; const isPatch2 = Uint8Array.from(isPatchX);
const adj2 = adjacency(FP2, FI);
let relax = isPatch2.slice(); for (let r = 0; r < 3; r++) { const nx = relax.slice(); for (let i = 0; i < m3; i++) if (relax[i]) for (const w of adj2.nb[i]) nx[w] = 1; relax = nx; }
taubin(FP2, adj2.nb, adj2.rep, relax, 25, 0.5, -0.505);
console.log(`refill: cut ${cut.reduce((x, y) => x + y, 0)} verts, rim ${nR}, fresh ${nF}, patch tris ${fixTri.length / 3} → head ${m2} verts ${FI.length / 3} tris`);
const GPn = FP2, nOut = m3;
const N = weldNormals(GPn, computeNormals(GPn, FI));
if (process.env.TOPO) console.log("final:", topo(GPn, FI));
const wF = new Float32Array(nOut); for (let i = 0; i < nOut; i++) wF[i] = isPatch2[i];

// ---- 6. write the identity module ----------------------------------------------------------------------------------
const base = await loadBase();
// Alex's own skin: the mean texture colour of his bare cranium (sRGB) — flat, no paint detail
const sk = [0, 0, 0, 0]; for (let i = 0; i < n; i++) if (GP[i * 3 + 1] > 1.4) { for (let q = 0; q < 3; q++) sk[q] += g.COL[i * 3 + q]; sk[3]++; }
const skinRGB = sk.slice(0, 3).map((v) => v / sk[3]);
const skinHex = "#" + skinRGB.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
console.log(`skin ${skinHex}`);
const PAINT = new Float32Array(nOut * 4); for (let i = 0; i < nOut; i++) PAINT.set([...skinRGB, 1], i * 4);
if (process.env.DEBUG) for (let i = 0; i < nOut; i++) PAINT.set([1 - wF[i], 1, 1 - wF[i], 1], i * 4);
const landmarks = {
  eyes: { l: [-ex, ey, ez], r: [ex, ey, ez], halfW: 0.06, halfH: 0.045 },
  mouth: { c: [0, chin + 0.12, 0.36], halfW: 0.06 },
  bridge: [0, ey + 0.01, ez + 0.03], forward: [0, ey, ez + 1], skin: skinHex, iris: "#2a1d18",
};
const bytes = await writeModule(`${BASE_OUT}/identity/alex-neutral-head-v1.glb`, base, [
  { name: "identity_head", P: GPn, N, I: FI, J: FJ, W: FW, extraAttrs: { _PAINT: { type: "VEC4", array: PAINT } }, material: { name: "identity_skin", roughness: 0.85, doubleSided: true } },   // Alex's source mesh has a few single flipped triangles at the temples
], { humanIdentity: { id: "alex-neutral-head-v1", base: C.HUMAN_BASE_VERSION, neutralEnvelope: true, donor: "alex-v2", landmarks, hides: [] } });
console.log(`alex-neutral-head-v1.glb ${(bytes / 1024).toFixed(0)} KB · chin ${chin.toFixed(3)}`);
