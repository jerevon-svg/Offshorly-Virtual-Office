// build-hair-medium.mjs — the first `medium-skinned` hairstyle template: MEDIUM CURTAIN, MIDDLE PART (Bon's current
// cut). ZERO CREDITS, NO GENERATION. Designed around the canonical head (its shape is known), never reconstructed.
//
//   node scripts/avatar-pipeline/human-base/build-hair-medium.mjs        (from frontend/; after build-canonical-head)
//
// LOCKED HAIR LANGUAGE (shared by every HumanBase hairstyle): a few BROAD, SMOOTH, SCULPTED LOCKS with a directional
// sweep from the root, layered over each other, merged with soft grooves — never strands, never a uniform helmet.
// Built as a signed distance field: a thin crown base that closes the scalp, plus flattened tapering locks swept along
// designed paths over the (ears-tucked) canonical head, smooth-unioned and meshed (surface nets).
//
// THIS CUT (from the real photo): crown volume → a clear middle part → front curtains sweeping out and away from the
// forehead (the forehead opens through the middle) → layered side sections down to the jaw → a longer tapered nape.
//
// SKINNED, HYBRID: the crown follows Head; the curtains, sides and back hang on 2-joint chains the MODULE owns
// (created on equip under Head — the base skeleton and every shared clip are untouched). human/humanHair.ts gives them
// lag and gravity and keeps them clear of the shoulders. The head's identity morphs are transferred onto the hair.
import * as THREE from "three";
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { adjacency, BASE_OUT, computeNormals, loadBase, simplifyGeo, smooth, surfaceNets, taubin, transferMorphs, weldNormals, writeModule } from "./lib.mjs";

const base = await loadBase();
const head = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/output/human-base/canonical-head-work.json", "utf8"));
// the head as this hairstyle sees it: ears tucked (it covers them)
const HP = head.P.map((v, i) => v + head.morphs.earTuck[i]);
const CEN = [0, 1.18, -0.01];
const deg = Math.PI / 180;

// ---- the head's radius in every direction (from its centre) -----------------------------------------------------
const AZN = 180, ELN = 90, Rmax = new Float32Array(AZN * ELN);
const binOf = (dx, dy, dz) => { const r = Math.hypot(dx, dy, dz); const a = Math.min(AZN - 1, Math.floor(((Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI)) * AZN)), e = Math.min(ELN - 1, Math.floor(((Math.asin(dy / r) + Math.PI / 2) / Math.PI) * ELN)); return [e * AZN + a, r]; };
for (let i = 0; i < HP.length / 3; i++) { const [k, r] = binOf(HP[i * 3] - CEN[0], HP[i * 3 + 1] - CEN[1], HP[i * 3 + 2] - CEN[2]); Rmax[k] = Math.max(Rmax[k], r); }
for (let pass = 0; pass < 20; pass++) for (let k = 0; k < Rmax.length; k++) { if (Rmax[k] > 0) continue; const e = Math.floor(k / AZN), a = k % AZN; let s = 0, n = 0;
  for (const [da, de] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const e2 = e + de; if (e2 < 0 || e2 >= ELN) continue; const v = Rmax[e2 * AZN + (a + da + AZN) % AZN]; if (v > 0) { s += v; n++; } } if (n) Rmax[k] = s / n; }
const radAt = (azd, eld) => { const a = Math.min(AZN - 1, Math.max(0, Math.floor(((azd * deg + Math.PI) / (2 * Math.PI)) * AZN))), e = Math.min(ELN - 1, Math.max(0, Math.floor(((eld * deg + Math.PI / 2) / Math.PI) * ELN))); return Rmax[e * AZN + a]; };
const headSdf = (x, y, z) => { const dx = x - CEN[0], dy = y - CEN[1], dz = z - CEN[2], r = Math.hypot(dx, dy, dz); return r - radAt(Math.atan2(dx, dz) / deg, Math.asin(dy / r) / deg); };
// the hanging radius: the widest the head gets at or above y, by azimuth (hair falls; it never wraps under the jaw)
const RH = new Float32Array(360 * 140);
for (let i = 0; i < HP.length / 3; i++) { const x = HP[i * 3], y = HP[i * 3 + 1], z = HP[i * 3 + 2] - CEN[2]; const a = Math.floor(((Math.atan2(x, z) / deg) + 360) % 360), b = Math.round((y - 0.4) / 0.01); if (b < 0 || b >= 140) continue; RH[b * 360 + a] = Math.max(RH[b * 360 + a], Math.hypot(x, z)); }
for (let a = 0; a < 360; a++) { let m = 0; for (let b = 139; b >= 0; b--) { m = Math.max(m, RH[b * 360 + a]); RH[b * 360 + a] = m; } }
const hangR = (azd, y) => { const a = Math.floor(((azd % 360) + 360) % 360), b = Math.max(0, Math.min(139, Math.round((y - 0.4) / 0.01))); let r = 0; for (let d = -2; d <= 2; d++) r = Math.max(r, RH[b * 360 + (a + d + 360) % 360]); return r; };

// ---- path points --------------------------------------------------------------------------------------------
/** a point lying `off` above the head surface at (azimuth, elevation) */
const onHead = (azd, eld, off) => { const r = radAt(azd, eld) + off, a = azd * deg, e = eld * deg; return [CEN[0] + Math.sin(a) * Math.cos(e) * r, CEN[1] + Math.sin(e) * r, CEN[2] + Math.cos(a) * Math.cos(e) * r]; };
/** a point hanging at height y, `off` outside the head's hanging radius at that azimuth */
const hang = (azd, y, off) => { const r = hangR(azd, y) + off, a = azd * deg; return [Math.sin(a) * r, y, CEN[2] + Math.cos(a) * r]; };

// ---- THE LOCKS (left side; the right mirrors) — points root → tip, width / thickness [root, mid, tip] -------------
// LAYERS of separate tapering locks (left side; the right mirrors). Each lock: a root on the scalp, a path that follows
// the skull then falls, a width/thickness profile ending in a POINTED tip (the illustrated style), lengths jittered so
// the hem is layered, not cut straight. Generated per layer so the cut is a few parameters, not hand-placed points.
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const LOCKS = [];
let lockN = 0;
const lock = (pts, w, t, chain) => { LOCKS.push({ id: `L${lockN++}`, pts, w: [w[0] * 1.2, w[1] * 1.3, w[2]], t, chain }); };
const chainOf = (az) => (az < 46 ? "CurtainL" : az < 116 ? "SideL" : az < 150 ? "BackL" : "BackC");
// 1 CROWN: from the part line, swept outward and back over the skull (stays on the head)
for (let k = 0; k < 6; k++) { const az = 8 + k * 26 + hash(k) * 6, r = 0.016;
  lock([onHead(2 + k * 3, 80 - k * 2, r), onHead(az * 0.6 + 4, 70 - k, r + 0.014), onHead(az, 54 - k * 2, r + 0.022), onHead(az + 10, 38 - k * 3, r + 0.022)], [0.05, 0.075, 0.03], [0.026, 0.036, 0.016], null); }
// 2 FRONT CURTAINS: from the part at the hairline, sweeping out over the temple, falling beside the cheek
for (let k = 0; k < 3; k++) { const az = 26 + k * 10, len = 0.94 - k * 0.025 - hash(k + 10) * 0.02;
  lock([onHead(2 + k * 2, 58 + k * 3, 0.012), onHead(12 + k * 5, 50 + k * 2, 0.026), onHead(az, 36, 0.034), onHead(az + 10, 20, 0.034), hang(az + 18, 1.02, 0.032 + k * 0.004), hang(az + 22, len, 0.036 + k * 0.004)], [0.03, 0.06, 0.012], [0.018, 0.03, 0.008], "CurtainL"); }
// 3 SIDE LAYER, OUTER: over the temple and the (tucked) ear, ending above the jaw, tips flicking out
for (let k = 0; k < 4; k++) { const az = 58 + k * 15, len = 0.97 - hash(k + 20) * 0.04;
  lock([onHead(az * 0.45, 74, 0.02), onHead(az - 6, 54, 0.036), onHead(az, 30, 0.046), hang(az + 2, 1.04, 0.046), hang(az + 4, len, 0.056)], [0.045, 0.07, 0.012], [0.024, 0.042, 0.01], chainOf(az)); }
// 4 SIDE LAYER, INNER (under the outer one): longer, a step further down
for (let k = 0; k < 4; k++) { const az = 64 + k * 14, len = 0.89 - hash(k + 30) * 0.03;
  lock([onHead(az * 0.6, 60, 0.016), onHead(az, 34, 0.03), hang(az + 2, 1.02, 0.032), hang(az + 4, 0.94, 0.034), hang(az + 5, len, 0.042)], [0.04, 0.062, 0.012], [0.02, 0.032, 0.008], chainOf(az)); }
// 5 BACK, UPPER: rounds over the occipital following the skull, ends just below it with an outward flick
for (let k = 0; k < 4; k++) { const az = 122 + k * 18, end = -18 - hash(k + 40) * 10;
  lock([onHead(az * 0.85, 84, 0.018), onHead(az, 52, 0.04), onHead(az, 16, 0.052), onHead(az, -8, 0.054), onHead(az + 2, end, 0.064)], [0.06, 0.085, 0.014], [0.03, 0.05, 0.01], chainOf(az)); }
// 6 BACK, LOWER (under it): tucks in along the nape and tapers to the neck
for (let k = 0; k < 4; k++) { const az = 124 + k * 18, end = -42 - hash(k + 50) * 8;
  lock([onHead(az, 28, 0.02), onHead(az, 0, 0.03), onHead(az, -26, 0.03), onHead(az + 1, end, 0.024)], [0.06, 0.075, 0.014], [0.024, 0.032, 0.008], chainOf(az)); }
const mirror = (p) => [-p[0], p[1], p[2]];
const ALL = [...LOCKS.map((l) => ({ ...l })), ...LOCKS.map((l) => ({ ...l, id: `${l.id}R`, pts: l.pts.map(mirror), chain: l.chain ? l.chain.replace(/L$/, "R") : null }))];

// sample each lock: a smooth curve with a frame (tangent, outward normal, binormal) and its profile per sample
// root → full body by mid-length, FULL until 80%, then a short pointed taper (masses with pointed ends, never spikes)
const prof = (v, u) => (u < 0.4 ? v[0] + (v[1] - v[0]) * smooth(0, 0.4, u) : u < 0.8 ? v[1] : v[1] + (v[2] - v[1]) * smooth(0.8, 1, u));
for (const L of ALL) {
  const curve = new THREE.CatmullRomCurve3(L.pts.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  const n = 48; L.s = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n, c = curve.getPointAt(u), t = curve.getTangentAt(u).normalize();
    const out = new THREE.Vector3(c.x - CEN[0], 0.25 * (c.y - CEN[1]), c.z - CEN[2]).normalize();
    const nn = out.addScaledVector(t, -out.dot(t)).normalize(), b = new THREE.Vector3().crossVectors(t, nn);
    L.s.push({ c, t, n: nn, b, w: prof(L.w, u), h: prof(L.t, u) });
  }
  const pts = L.s.map((q) => q.c); L.min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p.getComponent(k))) - 0.1); L.max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p.getComponent(k))) + 0.1);
}
/** a flattened, tapering lock: an elliptical section (wide across the head, thin off it) swept along its samples */
function lockSdf(L, x, y, z) {
  let best = 1e9, bi = 0, bu = 0;
  for (let k = 0; k < L.s.length - 1; k++) {
    const a = L.s[k].c, b = L.s[k + 1].c;
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, l2 = abx * abx + aby * aby + abz * abz;
    const u = Math.min(1, Math.max(0, ((x - a.x) * abx + (y - a.y) * aby + (z - a.z) * abz) / l2));
    const dx = x - (a.x + abx * u), dy = y - (a.y + aby * u), dz = z - (a.z + abz * u), d = dx * dx + dy * dy + dz * dz;
    if (d < best) { best = d; bi = k; bu = u; }
  }
  const s0 = L.s[bi], s1 = L.s[bi + 1];
  const cx = s0.c.x + (s1.c.x - s0.c.x) * bu, cy = s0.c.y + (s1.c.y - s0.c.y) * bu, cz = s0.c.z + (s1.c.z - s0.c.z) * bu;
  const w = s0.w + (s1.w - s0.w) * bu, h = s0.h + (s1.h - s0.h) * bu;
  const px = x - cx, py = y - cy, pz = z - cz;
  const dn = px * s0.n.x + py * s0.n.y + pz * s0.n.z, db = px * s0.b.x + py * s0.b.y + pz * s0.b.z, da = px * s0.t.x + py * s0.t.y + pz * s0.t.z;
  const kk = Math.hypot(db / w, dn / h, da / Math.max(h, 0.6 * w));
  return (kk - 1) * Math.min(w, h);
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

// ---- the field: crown base + locks ------------------------------------------------------------------------------
const CELL = 0.005, MIN = [-0.6, 0.7, -0.6], MAX = [0.6, 1.8, 0.58];
const NX = Math.ceil((MAX[0] - MIN[0]) / CELL) + 1, NY = Math.ceil((MAX[1] - MIN[1]) / CELL) + 1, NZ = Math.ceil((MAX[2] - MIN[2]) / CELL) + 1;
const id = (i, j, k) => (k * NY + j) * NX + i;
const F = new Float32Array(NX * NY * NZ);
// crown base: a thin shell over the scalp above a hairline that leaves the forehead open in the middle
const capLow = (azd) => { const a = Math.abs(azd); return a < 20 ? 62 : a < 45 ? 62 - (a - 20) * 0.9 : a < 90 ? 39.5 - (a - 45) * 0.9 : a < 130 ? -2 - (a - 90) * 1.1 : -50; };
for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const x = MIN[0] + i * CELL, y = MIN[1] + j * CELL, z = MIN[2] + k * CELL;
  const dx = x - CEN[0], dy = y - CEN[1], dz = z - CEN[2], r = Math.hypot(dx, dy, dz), azd = Math.atan2(dx, dz) / deg, eld = Math.asin(dy / r) / deg;
  const hs = r - radAt(azd, eld);
  // the base mass: 6 mm off the scalp, thicker over the crown and the rounded occipital (the back of the skull)
  const occ = Math.exp(-(((Math.abs(azd) - 160) / 40) ** 2)) * Math.exp(-(((eld - 10) / 30) ** 2));
  const thickB = 0.014 + 0.012 * smooth(40, 80, eld) + 0.022 * occ;
  let d = Math.abs(hs - 0.006 - thickB) - thickB;
  d = smax(d, (capLow(azd) - eld) * deg * 0.4, 0.01);                      // only above the hairline
  if (z > -0.25 && eld > 50) d = smax(d, 0.004 - Math.abs(x), 0.004);     // the middle part: a clean line at x = 0
  F[id(i, j, k)] = d;
}
for (const L of ALL) {
  const i0 = Math.max(0, Math.floor((L.min[0] - MIN[0]) / CELL)), i1 = Math.min(NX - 1, Math.ceil((L.max[0] - MIN[0]) / CELL));
  const j0 = Math.max(0, Math.floor((L.min[1] - MIN[1]) / CELL)), j1 = Math.min(NY - 1, Math.ceil((L.max[1] - MIN[1]) / CELL));
  const k0 = Math.max(0, Math.floor((L.min[2] - MIN[2]) / CELL)), k1 = Math.min(NZ - 1, Math.ceil((L.max[2] - MIN[2]) / CELL));
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const n = id(i, j, k);
    if (F[n] < -0.03) continue;
    const d = lockSdf(L, MIN[0] + i * CELL, MIN[1] + j * CELL, MIN[2] + k * CELL);
    if (d < 0.03) F[n] = smin(F[n], d, 0.004);                             // tight blend: the grooves between locks stay deep
  }
}
// hair never inside the face skin (a lock passing over the cheek stays 3 mm off it)
for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const n = id(i, j, k); if (F[n] > 0.02) continue;
  const x = MIN[0] + i * CELL, y = MIN[1] + j * CELL, z = MIN[2] + k * CELL;
  if (Math.abs(Math.atan2(x, z - CEN[2]) / deg) < 60 && y < 1.3) F[n] = smax(F[n], -(headSdf(x, y, z) - 0.003), 0.004);
}
const mesh = surfaceNets((x, y, z) => F[id(Math.round((x - MIN[0]) / CELL), Math.round((y - MIN[1]) / CELL), Math.round((z - MIN[2]) / CELL))], MIN, MAX, CELL);
let P = Float32Array.from(mesh.P);
{ const { rep, nb } = adjacency(P, mesh.I); taubin(P, nb, rep, new Uint8Array(P.length / 3).fill(1), 24, 0.5, -0.51); }
const g = simplifyGeo({ P: Array.from(P), I: mesh.I }, C.HUMAN_BUDGETS.hair, 0.0008);
P = Float32Array.from(g.P); const I = g.I, nv = P.length / 3;
const N = weldNormals(P, computeNormals(P, I));
// GROOVE SHADING: concavity between the locks, baked as vertex colour (the lock forms read even in black hair)
const AOC = new Float32Array(nv * 3).fill(1);
{
  const { rep, nb } = adjacency(P, I), cav = new Float32Array(nv);
  for (let i = 0; i < nv; i++) { if (rep[i] !== i || !nb[i].length) continue; let ax = 0, ay = 0, az = 0; for (const j of nb[i]) { ax += P[j * 3]; ay += P[j * 3 + 1]; az += P[j * 3 + 2]; }
    const n = nb[i].length; cav[i] = (ax / n - P[i * 3]) * N[i * 3] + (ay / n - P[i * 3 + 1]) * N[i * 3 + 1] + (az / n - P[i * 3 + 2]) * N[i * 3 + 2]; }
  for (let it = 0; it < 5; it++) { const c2 = new Float32Array(cav); for (let i = 0; i < nv; i++) { if (rep[i] !== i || !nb[i].length) continue; let a = cav[i]; for (const j of nb[i]) a += cav[j]; c2[i] = a / (nb[i].length + 1); } cav.set(c2); }
  const sorted = Array.from(cav).sort((a, b) => a - b), hi = sorted[Math.floor(sorted.length * 0.97)];
  for (let i = 0; i < nv; i++) { const k = Math.max(0, Math.min(1, cav[rep[i]] / Math.max(1e-6, hi))); const v = 1 - 0.8 * Math.pow(k, 0.7); AOC[i * 3] = AOC[i * 3 + 1] = AOC[i * 3 + 2] = v; }
}
console.log(`hair mesh ${nv} verts ${I.length / 3} tris · ${ALL.length} locks`);

// ---- chains (module-owned joints) and weights: each lock's hanging part rides its chain ------------------------------
const CHAINS = {};
for (const L of ALL) if (L.chain) (CHAINS[L.chain] ??= []).push(L);
const extraJoints = [], chains = [];
for (const [cid, locks] of Object.entries(CHAINS)) {
  const avg = (f) => { const ps = locks.map((L) => L.s[Math.round(f * (L.s.length - 1))].c); return [0, 1, 2].map((k) => ps.reduce((a, p) => a + p.getComponent(k), 0) / ps.length); };
  const hinge = avg(0.55), mid = avg(0.78), tip = avg(1);
  const j1 = { name: `Hair${cid}1`, parent: "Head", world: new THREE.Matrix4().makeTranslation(...hinge) };
  const j2 = { name: `Hair${cid}2`, parent: j1.name, world: new THREE.Matrix4().makeTranslation(...mid) };
  extraJoints.push(j1, j2);
  chains.push({ id: cid, joints: [j1.name, j2.name], hinge, mid, tip });
}
const JI = { ...base.JI }; extraJoints.forEach((j, k) => { JI[j.name] = base.names.length + k; });
const J = new Uint8Array(nv * 4), W = new Float32Array(nv * 4), LOCKOF = new Int32Array(nv).fill(-1);
for (let i = 0; i < nv; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  let best = 1e9, bl = null, bu = 0;
  for (const L of ALL) for (let k = 0; k < L.s.length; k += 2) { const c = L.s[k].c, d = (c.x - x) ** 2 + (c.y - y) ** 2 + (c.z - z) ** 2; if (d < best) { best = d; bl = L; bu = k / (L.s.length - 1); } }
  J[i * 4] = JI.Head; W[i * 4] = 1;
  LOCKOF[i] = ALL.indexOf(bl);
  const c = bl?.chain ? chains.find((q) => q.id === bl.chain) : null; if (!c) continue;
  const wc = smooth(0.5, 0.72, bu), w2 = smooth(0.72, 0.95, bu);
  W[i * 4] = 1 - wc; J[i * 4 + 1] = JI[c.joints[0]]; W[i * 4 + 1] = wc * (1 - w2); J[i * 4 + 2] = JI[c.joints[1]]; W[i * 4 + 2] = wc * w2;
}
// each lock its own value (±12%): neighbouring locks separate even in black hair
for (let i = 0; i < nv; i++) if (LOCKOF[i] >= 0) { const v = 0.88 + 0.24 * hash(LOCKOF[i] * 7.3); for (let k = 0; k < 3; k++) AOC[i * 3 + k] *= v; }
const morphs = transferMorphs(HP, Object.fromEntries(Object.entries(head.morphs).filter(([k]) => k !== "earTuck").map(([k, v]) => [k, Float32Array.from(v)])), P, 6);
const bytes = await writeModule(`${BASE_OUT}/hair/medium-curtain.glb`, base, [
  { name: "hair_medium_curtain", P, N, I, J, W, COLOR: AOC, morphs, material: { name: "hair", roughness: 0.5, doubleSided: true } },
], { humanHair: { id: "medium-curtain", base: C.HUMAN_BASE_VERSION, class: "medium-skinned", fittedTo: "canonical-head-v1", tucksEars: true, chains,
  attributes: { length: "medium", part: "middle", front: "curtain", texture: "straight" }, construction: "sculpted-locks-v1" } },
{ compress: "quantize", extraJoints });
console.log(`medium-curtain ${(bytes / 1e3).toFixed(0)} KB · ${extraJoints.length} module joints · ${chains.length} chains`);
