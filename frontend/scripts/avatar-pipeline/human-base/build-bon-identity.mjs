// build-bon-identity.mjs — BON, the first modular employee: identity head, hair and glasses DECOMPOSED from his
// approved, locked v3 mesh. ZERO CREDITS, NO GENERATION, the source is never rewritten.
//
//   node scripts/avatar-pipeline/human-base/build-bon-identity.mjs        (from frontend/; after build-human-base)
//
// INPUT (read-only): public/avatars/bon-v3-hq-idle9/bon-v3-lod0.glb — Bon's head, hair and glasses are ONE fused,
// welded shell with ~12k UV fragments; the black hair, black brows and black frames are even one connected dark
// surface (the temples run into the hair). They are separated here by measurement, in Bon's own bind space:
//   · GLASSES — dark AND standing proud of the face: the rims (z > 0.30 between y 0.94 and 1.166, |x| < 0.345,
//     ~0.03 in front of the face, which sits at z ≤ 0.29 there) and the temples (|x| > 0.27, y 1.07–1.165, in front
//     of the hair line at z 0.17). The painted irises are flush (z ≤ 0.29) and stay with the face.
//   · BROWS — dark, flush, directly above the top rim (y 1.15–1.215): part of the face, never of the hair.
//   · HAIR — every other dark vertex on the head above the collar.
// The face UNDER the frames never existed (Meshy fused the rims into it), so it is REBUILT: the frame vertices are
// faired harmonically onto a smooth surface spanning the face around them, and their colour is painted the same
// way from the surrounding skin (a per-vertex `_PAINT` layer the head shader mixes over the texture). The frames
// themselves become the glasses ACCESSORY, exactly as Bon's mesh had them. A SCALP is grown under the hair (the
// hair region faired smooth and pulled inward), so the head is closed whether or not hair is worn.
//
// OUTPUT (public/avatars/human-base-v1/):
//   identity/bon/head.glb        head + neck stub (rigid on Head, neck-blended below the chin), scalp, face shells
//   hair/bon-short.glb           Bon's own hair, unchanged geometry
//   accessories/bon-glasses.glb  Bon's own frames
import * as THREE from "three";
import sharp from "sharp";
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { adjacency, BASE_OUT, computeNormals, harmonic, io, loadBase, simplifyGeo, smooth, subset, taubin, weldGeo, weldNormals, writeModule } from "./lib.mjs";

const SRC = "public/avatars/bon-v3-hq-idle9/bon-v3-lod0.glb";
const base = await loadBase();
const doc = await io.read(SRC);
const root = doc.getRoot();
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute("POSITION").getArray(), N0 = prim.getAttribute("NORMAL").getArray();
const UV = prim.getAttribute("TEXCOORD_0").getArray(), JB = prim.getAttribute("JOINTS_0").getArray(), WB = prim.getAttribute("WEIGHTS_0").getArray();
const I = prim.getIndices().getArray();
const nv = P.length / 3;
const bonJoints = root.listSkins()[0].listJoints();
const bonRest = Object.fromEntries(bonJoints.map((j) => { const m = j.getWorldMatrix(); return [j.getName(), new THREE.Vector3(m[12], m[13], m[14])]; }));
const texImg = root.listTextures()[0].getImage();
const { data: TX, info: TI } = await sharp(Buffer.from(texImg)).raw().toBuffer({ resolveWithObject: true });
const texel = (i) => {
  const x = Math.min(TI.width - 1, Math.max(0, Math.floor(UV[i * 2] * TI.width))), y = Math.min(TI.height - 1, Math.max(0, Math.floor(UV[i * 2 + 1] * TI.height)));
  const o = (y * TI.width + x) * TI.channels; return [TX[o] / 255, TX[o + 1] / 255, TX[o + 2] / 255];
};
const COL = new Float32Array(nv * 3); const LUM = new Float32Array(nv);
for (let i = 0; i < nv; i++) { const c = texel(i); COL.set(c, i * 3); LUM[i] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
const dom = (i) => { let b = 0; for (let k = 1; k < 4; k++) if (WB[i * 4 + k] > WB[i * 4 + b]) b = k; return bonJoints[JB[i * 4 + b]].getName(); };
const X = (i) => P[i * 3], Y = (i) => P[i * 3 + 1], Z = (i) => P[i * 3 + 2];

// ---- 1. the head, cut at the collar ---------------------------------------------------------------------
const NECK_AXIS_Z = bonRest.neck.z, COLLAR_Y = 0.735, CHIN_Y = 0.81, NECK_CUT_Y = 0.772;
const isHead = (i) => {
  const x = X(i), y = Y(i), z = Z(i);
  if (y < COLLAR_Y) return false;
  if (y < CHIN_Y) return Math.hypot(x, z - NECK_AXIS_Z) < 0.13;
  if (/Arm|Hand|Shoulder/.test(dom(i)) && y < 0.86) return false;
  return !(y < 0.86 && Math.abs(x) > 0.25);
};
const DARK = 0.14;
const dark = (i) => LUM[i] < DARK;
const { rep, nb } = adjacency(P, I);

// small dark islands (pupils, lash lines) are face; the one big dark surface is hair + brows + frames
const comp = new Int32Array(nv).fill(-1); {
  let id = 0;
  for (let s = 0; s < nv; s++) {
    const r = rep[s]; if (comp[r] >= 0 || !dark(r) || !isHead(r)) continue;
    const stack = [r]; comp[r] = id;
    while (stack.length) { const v = stack.pop(); for (const w of nb[v]) if (comp[w] < 0 && dark(w) && isHead(w)) { comp[w] = id; stack.push(w); } }
    id++;
  }
  for (let i = 0; i < nv; i++) comp[i] = comp[rep[i]];
}
const sizes = new Map(); for (let i = 0; i < nv; i++) if (comp[i] >= 0) sizes.set(comp[i], (sizes.get(comp[i]) ?? 0) + 1);
const mainComp = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];

const L = { FACE: 0, HAIR: 1, GLASSES: 2, DROP: 3 };
const label = new Uint8Array(nv);
for (let i = 0; i < nv; i++) {
  if (!isHead(i)) { label[i] = L.DROP; continue; }
  const x = X(i), y = Y(i), z = Z(i), ax = Math.abs(x);
  if (!dark(i)) { label[i] = L.FACE; continue; }
  if (y < 0.82) { label[i] = L.DROP; continue; }                       // the shirt collar inside the neck cut
  if (comp[i] !== mainComp) { label[i] = L.FACE; continue; }           // pupils, lash lines
  const rim = y > 0.94 && y < 1.166 && z > 0.3 && ax < 0.345;
  const temple = y > 1.07 && y < 1.165 && ax > 0.27 && z > 0.17;
  if (rim || temple) { label[i] = L.GLASSES; continue; }
  if (y > 1.15 && y < 1.215 && z > 0.24 && ax < 0.31) { label[i] = L.FACE; continue; } // brows
  label[i] = L.HAIR;
}
// tidy: a light texel inside the hair (a painted highlight) is hair, a dark speck on the face is face
for (let pass = 0; pass < 3; pass++) {
  const next = new Uint8Array(label);
  for (let i = 0; i < nv; i++) {
    if (rep[i] !== i || label[i] === L.DROP || label[i] === L.GLASSES) continue;
    const c = [0, 0, 0, 0]; for (const w of nb[i]) c[label[w]]++;
    const n = nb[i].length; if (!n) continue;
    if (label[i] === L.FACE && !dark(i) && c[L.HAIR] >= 0.6 * n) next[i] = L.HAIR;
    else if (label[i] === L.HAIR && c[L.FACE] >= 0.75 * n) next[i] = L.FACE;
  }
  label.set(next);
}
for (let i = 0; i < nv; i++) label[i] = label[rep[i]];
// one owner per triangle: the majority (ties → face)
const triOwner = new Uint8Array(I.length / 3);
for (let t = 0; t < I.length; t += 3) {
  const c = [0, 0, 0, 0]; for (let k = 0; k < 3; k++) c[label[I[t + k]]]++;
  triOwner[t / 3] = c[L.DROP] > 0 ? L.DROP : c[L.HAIR] >= 2 ? L.HAIR : c[L.GLASSES] >= 2 ? L.GLASSES : L.FACE;
}
// face islands stranded inside the hair (painted highlights the label filter missed) belong to the hair
{
  const triOf = Array.from({ length: nv }, () => []);
  for (let t = 0; t < I.length / 3; t++) if (triOwner[t] === L.FACE) for (let k = 0; k < 3; k++) triOf[rep[I[t * 3 + k]]].push(t);
  const seenT = new Uint8Array(I.length / 3); let moved = 0;
  for (let t0 = 0; t0 < I.length / 3; t0++) {
    if (triOwner[t0] !== L.FACE || seenT[t0]) continue;
    const island = [t0]; seenT[t0] = 1;
    for (let h = 0; h < island.length; h++) { const t = island[h]; for (let k = 0; k < 3; k++) for (const u of triOf[rep[I[t * 3 + k]]]) if (!seenT[u]) { seenT[u] = 1; island.push(u); } }
    let my = 0, mz = 0; for (const t of island) { const i = I[t * 3]; my += Y(i) / island.length; mz += Z(i) / island.length; }
    const inHairZone = my > 1.15 || (mz < -0.05 && my > 0.95);
    if (island.length < 2000 && inHairZone) { for (const t of island) triOwner[t] = L.HAIR; moved += island.length; }
  }
  console.log(`face islands moved to hair: ${moved} tris`);
}
const count = (o) => triOwner.reduce((a, x) => a + (x === o ? 1 : 0), 0);
console.log(`tris: face ${count(L.FACE)} · hair ${count(L.HAIR)} · glasses ${count(L.GLASSES)}`);

// ---- 2. re-seat on the base: Bon's shoulder line onto the base's ---------------------------------------
const OFF = new THREE.Vector3(0, base.rest.LeftArm.y - bonRest.LeftArm.y, base.rest.neck.z - bonRest.neck.z);
console.log(`re-seat offset ${OFF.toArray().map((v) => v.toFixed(3))}`);
const HJ = base.JI.Head, NJ = base.JI.neck;

// ---- 3. the face under the frames: fair the frame vertices, paint them from the skin around them ----------
const POS = new Float32Array(P);
const isG = new Uint8Array(nv).map((_, i) => (label[rep[i]] === L.GLASSES ? 1 : 0));
// The rims' side walls carry SKIN texels and some of their dark edges fall outside the colour zones, so colour
// alone leaves a ghost frame behind. The frame set is therefore grown by GEOMETRY: a height map of the real face
// (front-facing face vertices that are not frame; cells hidden behind the frames filled from their neighbours),
// and every vertex near the frames that stands > 5 mm in front of it. The FRONT of the frames is then PROJECTED
// straight back onto that face surface (a membrane would be pinned up by any stray boundary vertex); the temples,
// thin bars lying on the side of the head, are faired; a light relaxation evens the rebuilt patch.
// the face as a RADIUS map around the head's vertical axis — the face wraps round toward the ears, which a flat
// front-on height map cannot describe (it threw the outer rim corners forward as shards)
const AX_Z = 0.0, TH0 = -1.75, TH1 = 1.75, CTH = 0.02, Y0 = 0.88, CY = 0.006;
const NTh = Math.ceil((TH1 - TH0) / CTH), NYc = Math.ceil(0.36 / CY);
const theta = (x, z) => Math.atan2(x, z - AX_Z), radius = (x, z) => Math.hypot(x, z - AX_Z);
function faceRadiusMap() {
  const bins = Array.from({ length: NTh * NYc }, () => []);
  const cell = (x, y, z) => { const ct = Math.floor((theta(x, z) - TH0) / CTH), cy = Math.floor((y - Y0) / CY); return ct < 0 || cy < 0 || ct >= NTh || cy >= NYc ? -1 : cy * NTh + ct; };
  for (let i = 0; i < nv; i++) {
    if (label[i] !== L.FACE || isG[i]) continue;
    if (dark(i) && Y(i) > 1.15) continue; // brows stand proud of the skin themselves
    const c = cell(X(i), Y(i), Z(i)); if (c >= 0) bins[c].push(radius(X(i), Z(i)));
  }
  const H = new Float32Array(NTh * NYc).fill(-9);
  for (let k = 0; k < bins.length; k++) if (bins[k].length) { const a = bins[k].sort((x, y) => x - y); H[k] = a[Math.floor(a.length * 0.5)]; }
  for (let pass = 0; pass < 80; pass++) { const H2 = new Float32Array(H); let filled = 0;
    for (let cy = 0; cy < NYc; cy++) for (let ct = 0; ct < NTh; ct++) { const k = cy * NTh + ct; if (H[k] > -9) continue;
      let a = 0, n = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x2 = ct + dx, y2 = cy + dy; if (x2 < 0 || y2 < 0 || x2 >= NTh || y2 >= NYc) continue; const v = H[y2 * NTh + x2]; if (v > -9) { a += v; n++; } }
      if (n) { H2[k] = a / n; filled++; } }
    H.set(H2); if (!filled) break; }
  // smooth once (3×3) so a single stray sample cannot dent the rebuilt surface
  const S = new Float32Array(H);
  for (let cy = 1; cy < NYc - 1; cy++) for (let ct = 1; ct < NTh - 1; ct++) { let a = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += H[(cy + dy) * NTh + ct + dx]; S[cy * NTh + ct] = a / 9; }
  return (x, y, z) => {
    const ft = (theta(x, z) - TH0) / CTH - 0.5, fy = (y - Y0) / CY - 0.5;
    const t0 = Math.max(0, Math.min(NTh - 2, Math.floor(ft))), y0 = Math.max(0, Math.min(NYc - 2, Math.floor(fy)));
    const u = Math.min(1, Math.max(0, ft - t0)), v = Math.min(1, Math.max(0, fy - y0));
    const h = (ct, cy) => S[cy * NTh + ct];
    return (h(t0, y0) * (1 - u) + h(t0 + 1, y0) * u) * (1 - v) + (h(t0, y0 + 1) * (1 - u) + h(t0 + 1, y0 + 1) * u) * v;
  };
}
{
  const faceR = faceRadiusMap();
  const growable = (v) => {
    const ax = Math.abs(X(v)), y = Y(v);
    if (y < 0.9 || y > 1.2 || ax > 0.4) return false;
    if (label[v] === L.FACE) return comp[v] < 0 && !(dark(v) && y > 1.15);
    return label[v] === L.HAIR && ax < 0.33 && y < 1.17;   // dark rim edges that fell outside the colour zones
  };
  const seen = new Uint8Array(nv); const st = []; let grown = 0;
  for (let i = 0; i < nv; i++) if (rep[i] === i && isG[i]) { seen[i] = 1; st.push(i); }
  while (st.length) { const v = st.pop(); for (const w of nb[v]) if (!seen[w] && growable(w) && radius(X(w), Z(w)) > faceR(X(w), Y(w), Z(w)) + 0.003) { seen[w] = 1; isG[w] = 1; grown++; st.push(w); } }
  for (let i = 0; i < nv; i++) isG[i] = isG[rep[i]];
  console.log(`frame set grown by ${grown} wall vertices (in front of the face height map)`);
}
// the temples continue back past the hairline ON THE SKIN (z < 0.17): those dark strips were classed as hair and
// showed as black streaks along the side of the face. Anything in the temple band hugging the face surface
// (within 1.2 cm of the face radius map) is frame, not hair.
{
  const faceR = faceRadiusMap(); let moved = 0;
  globalThis.__reclaimed = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) {
    if (rep[i] !== i || label[i] !== L.HAIR) continue;
    const ax = Math.abs(X(i)), y = Y(i), z = Z(i);
    if (y < 1.06 || y > 1.175 || ax < 0.26 || z < -0.06 || z > 0.2) continue;
    if (radius(X(i), z) < faceR(X(i), y, z) + 0.012) { label[i] = L.GLASSES; isG[i] = 1; globalThis.__reclaimed[i] = 1; moved++; }
  }
  for (let i = 0; i < nv; i++) { label[i] = label[rep[i]]; isG[i] = isG[rep[i]]; }
  for (let t = 0; t < I.length; t += 3) { const c = [0, 0, 0, 0]; for (let k = 0; k < 3; k++) c[label[I[t + k]]]++; if (triOwner[t / 3] === L.HAIR && c[L.GLASSES] >= 1) triOwner[t / 3] = L.GLASSES; }
  console.log(`temple remnants reclaimed from the hair: ${moved}`);
}
// skin reference: the median face colour on the cheeks
const cheeks = []; for (let i = 0; i < nv; i++) if (label[i] === L.FACE && Math.abs(X(i)) > 0.12 && Math.abs(X(i)) < 0.25 && Y(i) > 0.88 && Y(i) < 0.98 && Z(i) > 0.2) cheeks.push(i);
const med = (k) => { const a = cheeks.map((i) => COL[i * 3 + k]).sort((x, y) => x - y); return a[a.length >> 1]; };
const SKIN = [med(0), med(1), med(2)];
const skinLike = (i) => !dark(i) && LUM[i] > 0.3 && COL[i * 3] > COL[i * 3 + 2] * 1.1;
{
  const faceR = faceRadiusMap(); // rebuilt without the grown walls
  const temple = new Uint8Array(nv).map((_, i) => (isG[i] && Math.abs(theta(X(i), Z(i))) > 1.2 ? 1 : 0));
  for (let i = 0; i < nv; i++) if (isG[i] && !temple[i]) {
    const r = Math.min(radius(X(i), Z(i)), faceR(X(i), Y(i), Z(i)) - 0.0005), th = theta(X(i), Z(i));
    POS[i * 3] = Math.sin(th) * r; POS[i * 3 + 2] = AX_Z + Math.cos(th) * r;
  }
  harmonic(POS, 3, nb, rep, temple, 400);
  harmonic(POS, 3, nb, rep, isG, 6);
}
const PAINT = new Float32Array(nv * 4);
{
  // FREE = the rebuilt frame surface + every non-skin texel within 8 rings of it (rim shadows, dark specks) that
  // is not a brow and not under an eye shell. Their colour is solved harmonically from the REAL skin around them,
  // so the repaint takes the local tone (around the eyes the face is warmer and darker than the cheeks).
  const ringG = new Int32Array(nv).fill(99); const q = [];
  for (let i = 0; i < nv; i++) if (rep[i] === i && isG[i]) { ringG[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) { const v = q[h]; if (ringG[v] >= 8) continue; for (const w of nb[v]) if (ringG[w] > ringG[v] + 1 && label[w] === L.FACE) { ringG[w] = ringG[v] + 1; q.push(w); } }
  const inEyeShell = (i) => { const ax = Math.abs(X(i)), y = Y(i); return Math.hypot((ax - 0.151) / 0.0686, (y - 1.0595) / 0.049) < 1.15; };
  const brow = (i) => dark(i) && Y(i) > 1.15;
  const free = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) { const r = ringG[rep[i]]; if (isG[i] || (r <= 8 && !skinLike(i) && !brow(i) && !inEyeShell(i))) free[i] = 1; }
  for (let i = 0; i < nv; i++) free[i] = free[rep[i]];
  const field = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) field.set(free[i] ? SKIN : COL.subarray(i * 3, i * 3 + 3), i * 3);
  harmonic(field, 3, nb, rep, free, 500);
  // full paint on the free set, feathered two rings onto the untouched skin around it
  for (let i = 0; i < nv; i++) {
    if (free[i]) { PAINT.set([field[i * 3], field[i * 3 + 1], field[i * 3 + 2], 1], i * 4); continue; }
    const r = ringG[rep[i]];
    if (r <= 2 && skinLike(i)) PAINT.set([field[i * 3], field[i * 3 + 1], field[i * 3 + 2], r === 1 ? 0.6 : 0.3], i * 4);
  }
}
// the neck below the chin is painted plain skin: its texels carry the old shirt collar's dark fringe
for (let i = 0; i < nv; i++) {
  const y = Y(i); if (y > CHIN_Y + 0.005 || Math.hypot(X(i), Z(i) - NECK_AXIS_Z) > 0.14) continue;
  const w = 1 - smooth(CHIN_Y - 0.03, CHIN_Y + 0.005, y);
  if (w > PAINT[i * 4 + 3]) PAINT.set([SKIN[0] * 0.94, SKIN[1] * 0.92, SKIN[2] * 0.9, w], i * 4);
}

const EYE_SKIN = [0, 0, 0];
// ---- 3b. a SMOOTH, COHESIVE FACE ----------------------------------------------------------------------
// Root cause of the "cracked" look (diagnosed with a plain white material, then the texture alone): Meshy's
// image-to-3D surface is lumpy at close range (sculpt noise the remesh kept), its per-vertex normals expose it as
// facets and creases, and the texture's baked lighting jumps at its ~12k UV fragment borders. So:
//   1. the face is Taubin-smoothed (volume-preserving; the hairline and the neck cut stay welded to their
//      neighbours) and every normal is rebuilt from the smoothed surface;
//   2. the SKIN colour is re-baked into the paint layer: Bon's own texture colour per vertex, diffused across skin
//      only, so fragment-border jumps disappear while the dark features (brows, mouth line, nostrils, lashes) keep
//      the texture untouched.
{
  const onHairTri = new Uint8Array(nv);
  for (let t = 0; t < I.length / 3; t++) if (triOwner[t] !== L.FACE && triOwner[t] !== L.GLASSES) for (let k = 0; k < 3; k++) onHairTri[rep[I[t * 3 + k]]] = 1;
  const free = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) { const r = rep[i]; if ((label[r] === L.FACE || isG[r]) && !onHairTri[r] && Y(r) > NECK_CUT_Y + 0.006) free[r] = 1; }
  for (let i = 0; i < nv; i++) free[i] = free[rep[i]];
  taubin(POS, nb, rep, free, 14);
  // the painted eyes sat in SCULPTED sockets (a ridge folds over at the upper lid). The shells draw the eyes now,
  // so the sockets are smoothed out: the face under each eye becomes one clean, fold-free surface.
  {
    const sp = []; for (let i = 0; i < nv; i++) { if (label[i] !== L.FACE || isG[i]) continue; const c = COL.subarray(i * 3, i * 3 + 3);
      if (Y(i) > 0.99 && Y(i) < 1.145 && Z(i) > 0.2 && Math.abs(X(i)) > 0.06 && Math.abs(X(i)) < 0.27 && LUM[i] > 0.8 && Math.abs(c[0] - c[2]) < 0.1) sp.push([Math.abs(X(i)), Y(i)]); }
    const q2 = (k, f) => { const v = sp.map((p) => p[k]).sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(v.length * f))]; };
    const ex = (q2(0, 0.04) + q2(0, 0.96)) / 2, ey = (q2(1, 0.05) + q2(1, 0.95)) / 2, ew = (q2(0, 0.96) - q2(0, 0.04)) / 2, eh = 1.2 * (q2(1, 0.95) - q2(1, 0.05)) / 2;
    const eyeFree = new Uint8Array(nv).map((_, i) => (free[i] && Math.hypot((Math.abs(X(i)) - ex) / ew, (Y(i) - ey) / eh) < 2.2 ? 1 : 0));
    taubin(POS, nb, rep, eyeFree, 60, 0.6, -0.62);
  }
  // skin re-bake
  const C2 = new Float32Array(COL), T2 = new Float32Array(COL.length);
  const sk = new Uint8Array(nv).map((_, i) => (label[rep[i]] === L.FACE && skinLike(rep[i]) ? 1 : 0));
  for (let it = 0; it < 30; it++) {
    T2.set(C2);
    for (let i = 0; i < nv; i++) { if (rep[i] !== i || !sk[i]) continue; let n = 1, a0 = C2[i * 3], a1 = C2[i * 3 + 1], a2 = C2[i * 3 + 2];
      for (const j of nb[i]) if (sk[j]) { a0 += C2[j * 3]; a1 += C2[j * 3 + 1]; a2 += C2[j * 3 + 2]; n++; }
      T2[i * 3] = a0 / n; T2[i * 3 + 1] = a1 / n; T2[i * 3 + 2] = a2 / n; }
    C2.set(T2);
  }
  let baked = 0;
  for (let i = 0; i < nv; i++) {
    const r = rep[i]; if (!sk[r]) continue;
    if (PAINT[i * 4 + 3] >= 0.999) continue; // the rebuilt frame band already has its solved paint
    PAINT.set([C2[r * 3], C2[r * 3 + 1], C2[r * 3 + 2], Math.max(PAINT[i * 4 + 3], 0.88)], i * 4); baked++;
  }
  console.log(`face smoothed (${free.reduce((a, b) => a + b, 0)} vertices) · skin re-baked on ${baked} vertices`);
  // the painted EYES (whites, iris, painted lash line) become skin: the face shells draw the eyes now, so a blink
  // never leaves a painted lash behind; and isolated dark texture specks on the skin go too. Nose, nostrils, mouth
  // and brows are kept from the texture.
  const sclP = { l: [], r: [] };
  for (let i = 0; i < nv; i++) { if (label[i] !== L.FACE || isG[i]) continue; const x = X(i), y = Y(i), z = Z(i), ax = Math.abs(x); const c = COL.subarray(i * 3, i * 3 + 3);
    if (y < 0.99 || y > 1.145 || z < 0.2 || ax < 0.06 || ax > 0.27) continue; if (LUM[i] > 0.8 && Math.abs(c[0] - c[2]) < 0.1) sclP[x > 0 ? "l" : "r"].push([ax, y]); }
  const qq = (a, k, f) => { const v = a.map((p) => p[k]).sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(v.length * f))]; };
  const all = [...sclP.l, ...sclP.r];
  const EX = (qq(all, 0, 0.04) + qq(all, 0, 0.96)) / 2, EY = (qq(all, 1, 0.05) + qq(all, 1, 0.95)) / 2;
  const EW = (qq(all, 0, 0.96) - qq(all, 0, 0.04)) / 2, EH = 1.2 * (qq(all, 1, 0.95) - qq(all, 1, 0.05)) / 2;
  const eyeR = (i) => Math.hypot((Math.abs(X(i)) - EX) / EW, (Y(i) - EY) / EH);
  // keep only the real features: the nostrils and the mouth line (larger islands survive anyway)
  const protect = (i) => (Math.abs(X(i)) < 0.055 && Y(i) > 0.935 && Y(i) < 0.99) || (Math.abs(X(i)) < 0.09 && Y(i) > 0.86 && Y(i) < 0.93 && LUM[i] < 0.35);
  const brow = (i) => dark(i) && Y(i) > 1.15;
  // dark specks: small non-skin islands on the face
  const isl = new Int32Array(nv).fill(-1); const sizes = [];
  for (let s0 = 0; s0 < nv; s0++) { const r0 = rep[s0]; if (isl[r0] >= 0 || label[r0] !== L.FACE || sk[r0] || isG[r0]) continue;
    const id = sizes.length, st = [r0]; isl[r0] = id; let n = 0;
    while (st.length) { const v = st.pop(); n++; for (const w of nb[v]) if (isl[w] < 0 && label[w] === L.FACE && !sk[w] && !isG[w]) { isl[w] = id; st.push(w); } }
    sizes.push(n); }
  const fix = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) { const r = rep[i]; if (label[r] !== L.FACE || sk[r] || isG[r] || brow(r)) continue;
    const underChin = Y(r) < CHIN_Y + 0.045 && !protect(r); // the chin's underside and the neck show above a collar
    if (eyeR(r) < 1.95 || underChin || (sizes[isl[r]] < 40 && !protect(r))) fix[i] = 1; }
  for (let i = 0; i < nv; i++) fix[i] = fix[rep[i]];
  const F = new Float32Array(nv * 3); for (let i = 0; i < nv; i++) F.set(fix[i] ? SKIN : C2.subarray(rep[i] * 3, rep[i] * 3 + 3), i * 3);
  harmonic(F, 3, nb, rep, fix, 300);
  let fixed = 0; for (let i = 0; i < nv; i++) if (fix[i]) { PAINT.set([F[i * 3], F[i * 3 + 1], F[i * 3 + 2], 1], i * 4); fixed++; }
  // the face shells' lid skin = the re-baked skin around the eyes (so a closing lid matches the face exactly)
  const ring = []; for (let i = 0; i < nv; i++) { const r = rep[i]; if (sk[r] && eyeR(r) > 1.9 && eyeR(r) < 2.6) ring.push(r); }
  for (let k = 0; k < 3; k++) { const a = ring.map((r) => C2[r * 3 + k]).sort((x, y) => x - y); EYE_SKIN[k] = a[a.length >> 1]; }
  console.log(`eye area + ${sizes.filter((n) => n < 40).length} specks repainted (${fixed} vertices)`);
  // the old temples ran over the sideburn hair: where they lay among hair the rebuilt surface takes the hair colour
  { const hd = []; for (let i = 0; i < nv; i++) if (label[i] === L.HAIR && dark(i)) hd.push(i);
    const HC = [0, 1, 2].map((k) => { const a = hd.map((i) => COL[i * 3 + k]).sort((x, y) => x - y); return a[a.length >> 1]; });
    const rc = globalThis.__reclaimed; for (let i = 0; i < nv; i++) if (rc[rep[i]]) PAINT.set([...HC, 1], i * 4); }
}
const NS = weldNormals(POS, computeNormals(POS, I));

// ---- 4. the scalp under the hair: the hair region faired smooth and pulled inward ------------------------
// the hair triangles are copied (their own vertices), the copy's border stays welded to the face's hairline
const hairTri = (t) => triOwner[t] === L.HAIR;
// the neck stub ends on a clean line (Meshy's shirt-collar boundary is ragged); it lives inside the top's collar
// below the chin only the neck itself survives (r < 0.112 around the neck axis): Bon's old shirt collar left lighter
// texels around it that are not dark enough to drop by colour
const neckOk = (t) => {
  let y = 0, r = 0; for (let k = 0; k < 3; k++) { const i = I[t * 3 + k]; y += Y(i) / 3; r = Math.max(r, Math.hypot(X(i), Z(i) - NECK_AXIS_Z)); }
  return y > NECK_CUT_Y && (y > CHIN_Y - 0.004 || r < 0.112);
};
const faceTri = (t) => (triOwner[t] === L.FACE || triOwner[t] === L.GLASSES) && neckOk(t);
const onFace = new Uint8Array(nv); for (let t = 0; t < I.length; t += 3) if (faceTri(t / 3)) for (let k = 0; k < 3; k++) onFace[rep[I[t + k]]] = 1;
const inHair = new Uint8Array(nv); for (let t = 0; t < I.length; t += 3) if (hairTri(t / 3)) for (let k = 0; k < 3; k++) inHair[rep[I[t + k]]] = 1;
const scalpFree = new Uint8Array(nv).map((_, i) => (inHair[rep[i]] && !onFace[rep[i]] ? 1 : 0));
const SCALP = new Float32Array(POS);
harmonic(SCALP, 3, nb, rep, scalpFree, 900);
// distance (in edges) from the hairline, to fade the inward pull to zero where the scalp meets the face
const ring = new Int32Array(nv).fill(1e6); {
  const q = []; for (let i = 0; i < nv; i++) if (rep[i] === i && inHair[i] && onFace[i]) { ring[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) { const v = q[h]; for (const w of nb[v]) if (inHair[w] && ring[w] > ring[v] + 1) { ring[w] = ring[v] + 1; q.push(w); } }
}
const scalpN = computeNormals(SCALP, I);
const HEAD_C = new THREE.Vector3(0, 1.22, 0);
for (let i = 0; i < nv; i++) {
  const r = rep[i]; if (!scalpFree[r]) continue;
  const pull = 0.035 * smooth(0, 14, ring[r]);
  // inward: toward the head centre, blended with the smoothed normal
  const d = new THREE.Vector3(SCALP[i * 3] - HEAD_C.x, SCALP[i * 3 + 1] - HEAD_C.y, SCALP[i * 3 + 2] - HEAD_C.z).normalize();
  const n = new THREE.Vector3(scalpN[r * 3], scalpN[r * 3 + 1], scalpN[r * 3 + 2]);
  const dir = d.add(n).normalize();
  SCALP[i * 3] -= dir.x * pull; SCALP[i * 3 + 1] -= dir.y * pull; SCALP[i * 3 + 2] -= dir.z * pull;
}
// does the hair still cover the scalp? sample: every scalp vertex must be inside the hair along its outward ray
let poke = 0; for (let i = 0; i < nv; i++) if (rep[i] === i && scalpFree[i]) {
  const sx = SCALP[i * 3] - HEAD_C.x, sy = SCALP[i * 3 + 1] - HEAD_C.y, sz = SCALP[i * 3 + 2] - HEAD_C.z;
  const hx = P[i * 3] - HEAD_C.x, hy = P[i * 3 + 1] - HEAD_C.y, hz = P[i * 3 + 2] - HEAD_C.z;
  if (Math.hypot(sx, sy, sz) > Math.hypot(hx, hy, hz) - 0.004) poke++;
}
console.log(`scalp: ${scalpFree.reduce((a, b) => a + b, 0)} free vertices, ${poke} closer than 4 mm under the hair`);

// ---- 5. landmarks + face shells -----------------------------------------------------------------------
const eyePts = { l: [], r: [] };
for (let i = 0; i < nv; i++) {
  if (label[i] !== L.FACE || isG[i]) continue;
  const x = X(i), y = Y(i), z = Z(i); const ax = Math.abs(x);
  if (y < 0.99 || y > 1.145 || z < 0.2 || ax < 0.06 || ax > 0.27) continue;
  const c = COL.subarray(i * 3, i * 3 + 3);
  const sclera = LUM[i] > 0.72 && Math.abs(c[0] - c[2]) < 0.12;
  if (dark(i) || sclera) eyePts[x > 0 ? "l" : "r"].push([x, y, z]);
}
const bbox = (pts) => pts.reduce((b, p) => ({ min: b.min.map((v, k) => Math.min(v, p[k])), max: b.max.map((v, k) => Math.max(v, p[k])) }), { min: [9, 9, 9], max: [-9, -9, -9] });
// the eye OPENING is the white of the eye (the dark extents include the painted lash line, which the shell redraws)
const scleraPts = { l: [], r: [] };
for (let i = 0; i < nv; i++) {
  if (label[i] !== L.FACE || isG[i]) continue;
  const x = X(i), y = Y(i), z = Z(i), ax = Math.abs(x); const c = COL.subarray(i * 3, i * 3 + 3);
  if (y < 0.99 || y > 1.145 || z < 0.2 || ax < 0.06 || ax > 0.27) continue;
  if (LUM[i] > 0.8 && Math.abs(c[0] - c[2]) < 0.1) scleraPts[x > 0 ? "l" : "r"].push([x, y, z]);
}
// robust box (5th–95th percentile: the iris highlights are white too), then one symmetric pair of eyes
const pbox = (pts) => { const q = (k, f) => { const a = pts.map((p) => p[k]).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * f))]; };
  return { min: [q(0, 0.04), q(1, 0.05), q(2, 0.05)], max: [q(0, 0.96), q(1, 0.95), q(2, 0.98)] }; };
const ebRaw = { l: pbox(scleraPts.l), r: pbox(scleraPts.r) };
const symX = ((ebRaw.l.min[0] + ebRaw.l.max[0]) / 2 - (ebRaw.r.min[0] + ebRaw.r.max[0]) / 2) / 2;
const symY = ((ebRaw.l.min[1] + ebRaw.l.max[1]) / 2 + (ebRaw.r.min[1] + ebRaw.r.max[1]) / 2) / 2;
const symW = ((ebRaw.l.max[0] - ebRaw.l.min[0]) + (ebRaw.r.max[0] - ebRaw.r.min[0])) / 4;
// the white is cut by the iris top and bottom; the opening is ~20% taller than the white's own box
const symH = 1.2 * ((ebRaw.l.max[1] - ebRaw.l.min[1]) + (ebRaw.r.max[1] - ebRaw.r.min[1])) / 4;
const symZ = Math.max(ebRaw.l.max[2], ebRaw.r.max[2]);
const eb = { l: { min: [symX - symW, symY - symH, 0], max: [symX + symW, symY + symH, symZ] }, r: { min: [-symX - symW, symY - symH, 0], max: [-symX + symW, symY + symH, symZ] } };
const lashBox = { l: bbox(eyePts.l), r: bbox(eyePts.r) };
const eyeC = (b) => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]];
const halfW = Math.max(eb.l.max[0] - eb.l.min[0], eb.r.max[0] - eb.r.min[0]) / 2;
const halfH = Math.max(eb.l.max[1] - eb.l.min[1], eb.r.max[1] - eb.r.min[1]) / 2;
// iris colour: the median of the eyes' dark texels that are not pure black
const irisPts = []; for (let i = 0; i < nv; i++) if (label[i] === L.FACE && dark(i) && Y(i) > 0.99 && Y(i) < 1.145 && Z(i) > 0.2 && Math.abs(X(i)) > 0.06 && Math.abs(X(i)) < 0.27) irisPts.push(i);
const irisMed = [0, 1, 2].map((k) => { const a = irisPts.map((i) => COL[i * 3 + k]).sort((x, y) => x - y); return a[Math.floor(a.length * 0.7)]; });
// mouth: the darker, redder line on the lower face
const mouthPts = []; for (let i = 0; i < nv; i++) {
  if (label[i] !== L.FACE) continue; const x = X(i), y = Y(i), z = Z(i);
  if (Math.abs(x) > 0.11 || y < 0.83 || y > 0.95 || z < 0.22) continue;
  const c = COL.subarray(i * 3, i * 3 + 3);
  if (LUM[i] < 0.8 * (0.2126 * SKIN[0] + 0.7152 * SKIN[1] + 0.0722 * SKIN[2]) && c[0] > c[2] * 1.15) mouthPts.push([x, y, z]);
}
const mb = bbox(mouthPts);
const mouthC = [(mb.min[0] + mb.max[0]) / 2, (mb.min[1] + mb.max[1]) / 2, mb.max[2]];
const mouthHalfW = (mb.max[0] - mb.min[0]) / 2;
const bridgeG = []; for (let i = 0; i < nv; i++) if (isG[i] && Math.abs(X(i)) < 0.04) bridgeG.push([X(i), Y(i), Z(i)]);
const bridge = bridgeG.length ? bbox(bridgeG) : { min: [0, 1.1, 0.33], max: [0, 1.1, 0.33] };
const off = (p) => [p[0] + OFF.x, p[1] + OFF.y, p[2] + OFF.z];
const hex = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
const landmarks = {
  eyes: { l: off(eyeC(eb.l)), r: off(eyeC(eb.r)), halfW: +halfW.toFixed(4), halfH: +halfH.toFixed(4),
    lashTop: +(((lashBox.l.max[1] + lashBox.r.max[1]) / 2 - (eb.l.min[1] + eb.l.max[1]) / 2) / halfH).toFixed(3) },
  mouth: { c: off(mouthC), halfW: +mouthHalfW.toFixed(4) },
  bridge: off([0, (bridge.min[1] + bridge.max[1]) / 2, bridge.max[2]]),
  forward: off([0, (eb.l.min[1] + eb.l.max[1]) / 2, 2]),
  skin: hex(EYE_SKIN), iris: hex(irisMed),
};
console.log("landmarks", JSON.stringify(landmarks));
const E = C.HEAD_ENVELOPE;
for (const s of ["l", "r"]) { const e = landmarks.eyes[s];
  if (e[1] < E.eyeY[0] || e[1] > E.eyeY[1] || e[2] < E.eyeFrontZ[0] || e[2] > E.eyeFrontZ[1]) throw new Error(`eye ${s} ${e} outside the head envelope`); }

// ---- 6. assemble the modules ----------------------------------------------------------------------------
const finalPos = new Float32Array(POS);
for (let i = 0; i < nv; i++) { finalPos[i * 3] += OFF.x; finalPos[i * 3 + 1] += OFF.y; finalPos[i * 3 + 2] += OFF.z; }
const headWeights = (y) => { const wn = 1 - smooth(COLLAR_Y + 0.012, CHIN_Y - 0.008, y); return [wn, 1 - wn]; };
function skinRigid(n) { const J = new Uint8Array(n * 4), W = new Float32Array(n * 4); for (let i = 0; i < n; i++) { J[i * 4] = HJ; W[i * 4] = 1; } return { J, W }; }

// HEAD: face + faired frames (+ paint) and the scalp copy of the hair triangles
const arrays = { P: finalPos, N: N0, UV, PAINT, SRC_Y: new Float32Array(nv).map((_, i) => P[i * 3 + 1]) };
const face = subset(arrays, I, (t) => faceTri(t));
// scalp: the hair triangles on SCALP positions, painted with the hair's root colour; its hairline border
// vertices are positioned on the face's own (shared) border so there is no crack
const scalpArr = { P: new Float32Array(nv * 3).map((_, k) => SCALP[k] + [OFF.x, OFF.y, OFF.z][k % 3]), N: N0, UV, PAINT: new Float32Array(nv * 4), SRC_Y: arrays.SRC_Y };
const HAIR_ROOT = [0.07, 0.055, 0.05];
for (let i = 0; i < nv; i++) scalpArr.PAINT.set([...HAIR_ROOT, 1], i * 4);
const scalp = simplifyGeo(weldGeo(subset(scalpArr, I, (t) => hairTri(t))), 9000, 0.02); // hidden under hair: coarse is fine
const headGeo = { P: [...face.P, ...scalp.P], UV: [...face.UV, ...scalp.UV], PAINT: [...face.PAINT, ...scalp.PAINT], SRC_Y: [...face.SRC_Y, ...scalp.SRC_Y], I: [...face.I, ...scalp.I.map((i) => i + face.P.length / 3)] };
const headN = computeNormals(headGeo.P, headGeo.I);
// the face takes the normals rebuilt from the smoothed surface (welded across UV seams), never Meshy's own
for (let k = 0; k < face.src.length; k++) { const s = face.src[k]; headN[k * 3] = NS[s * 3]; headN[k * 3 + 1] = NS[s * 3 + 1]; headN[k * 3 + 2] = NS[s * 3 + 2]; }
// the rebuilt patch must SHADE continuous with the face around it: average normals across it and a band of rings
// around it (without this the frames' outline survives as a faint crease when the glasses are off)
{
  const { rep: hr, nb: hn } = adjacency(headGeo.P, headGeo.I);
  const nH = headGeo.P.length / 3;
  const isRe = new Uint8Array(nH); for (let k = 0; k < face.src.length; k++) if (isG[face.src[k]]) isRe[k] = 1;
  const ringN = new Int32Array(nH).fill(99); const q = [];
  for (let i = 0; i < nH; i++) if (hr[i] === i && isRe[i]) { ringN[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) { const v = q[h]; if (ringN[v] >= 5) continue; for (const w of hn[v]) if (ringN[w] > ringN[v] + 1) { ringN[w] = ringN[v] + 1; q.push(w); } }
  const free = new Uint8Array(nH).map((_, i) => (ringN[hr[i]] <= 5 ? 1 : 0));
  harmonic(headN, 3, hn, hr, free, 25);
  for (let i = 0; i < nH; i++) { const l = Math.hypot(headN[i * 3], headN[i * 3 + 1], headN[i * 3 + 2]) || 1; headN[i * 3] /= l; headN[i * 3 + 1] /= l; headN[i * 3 + 2] /= l; }
}
const nHead = headGeo.P.length / 3;
const hJ = new Uint8Array(nHead * 4), hW = new Float32Array(nHead * 4);
for (let i = 0; i < nHead; i++) { const [wn, wh] = headWeights(headGeo.SRC_Y[i]); hJ[i * 4] = HJ; hW[i * 4] = wh; hJ[i * 4 + 1] = NJ; hW[i * 4 + 1] = wn; }

// FACE SHELLS: clean, FOLD-FREE grids laid onto the smoothed face just in front of it (a copy of the face surface
// carried the sculpted sockets' folds into the eye-local uv, which made the drawn eye jagged). uv is exactly planar.
function shell(centre, hw, hh, maxR, side) {
  const cx = centre[0] - OFF.x, cy = centre[1] - OFF.y;
  // a height map of the smoothed face around the patch (max z per cell, dilated, blurred)
  const CELL = 0.003, x0 = cx - hw * maxR - 0.01, y0 = cy - hh * maxR - 0.01;
  const NX = Math.ceil((2 * hw * maxR + 0.02) / CELL), NY = Math.ceil((2 * hh * maxR + 0.02) / CELL);
  let H = new Float32Array(NX * NY).fill(-9);
  for (let i = 0; i < nv; i++) {
    if (label[i] !== L.FACE && !isG[i]) continue;
    const x = POS[i * 3], y = POS[i * 3 + 1], z = POS[i * 3 + 2];
    const gx = Math.floor((x - x0) / CELL), gy = Math.floor((y - y0) / CELL);
    if (gx < 0 || gy < 0 || gx >= NX || gy >= NY || z < 0.15) continue;
    H[gy * NX + gx] = Math.max(H[gy * NX + gx], z);
  }
  for (let pass = 0; pass < 30; pass++) { const H2 = new Float32Array(H); let n = 0;
    for (let gy = 0; gy < NY; gy++) for (let gx = 0; gx < NX; gx++) { const k = gy * NX + gx; if (H[k] > -9) continue; let a = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x2 = gx + dx, y2 = gy + dy; if (x2 < 0 || y2 < 0 || x2 >= NX || y2 >= NY || H[y2 * NX + x2] <= -9) continue; a += H[y2 * NX + x2]; c++; }
      if (c) { H2[k] = a / c; n++; } }
    H = H2; if (!n) break; }
  for (let pass = 0; pass < 2; pass++) { const H2 = new Float32Array(H);   // dilate: never behind a local bump
    for (let gy = 1; gy < NY - 1; gy++) for (let gx = 1; gx < NX - 1; gx++) { let m = -9; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, H[(gy + dy) * NX + gx + dx]); H2[gy * NX + gx] = m; }
    H = H2; }
  for (let pass = 0; pass < 3; pass++) { const H2 = new Float32Array(H);   // blur
    for (let gy = 1; gy < NY - 1; gy++) for (let gx = 1; gx < NX - 1; gx++) { let a = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += H[(gy + dy) * NX + gx + dx]; H2[gy * NX + gx] = a / 9; }
    H = H2; }
  const zAt = (x, y) => { const fx = (x - x0) / CELL - 0.5, fy = (y - y0) / CELL - 0.5; const gx = Math.max(0, Math.min(NX - 2, Math.floor(fx))), gy = Math.max(0, Math.min(NY - 2, Math.floor(fy)));
    const u = Math.min(1, Math.max(0, fx - gx)), v = Math.min(1, Math.max(0, fy - gy)); const h = (a, b) => H[b * NX + a];
    return (h(gx, gy) * (1 - u) + h(gx + 1, gy) * u) * (1 - v) + (h(gx, gy + 1) * (1 - u) + h(gx + 1, gy + 1) * u) * v; };
  const G = 56, Pg = [], UVg = [], Ig = [], SIDE = [], idx = new Int32Array((G + 1) * (G + 1)).fill(-1);
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
    const u = (i / G * 2 - 1) * maxR, v = (j / G * 2 - 1) * maxR;
    if (Math.hypot(u, v) > maxR * 1.02) continue;
    const x = cx + u * hw, y = cy + v * hh;
    idx[j * (G + 1) + i] = Pg.length / 3;
    Pg.push(x + OFF.x, y + OFF.y, zAt(x, y) + 0.0018 + OFF.z); UVg.push(u, v); SIDE.push(side);
  }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const a = idx[j * (G + 1) + i], b = idx[j * (G + 1) + i + 1], c = idx[(j + 1) * (G + 1) + i], d = idx[(j + 1) * (G + 1) + i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    Ig.push(a, b, c, b, d, c);
  }
  return { P: Pg, N: Array.from(computeNormals(Pg, Ig)), UV: UVg, SIDE, I: Ig };
}
// the shell reaches past the opening far enough to repaint the painted lash line around it
const eyeL = shell(landmarks.eyes.l, halfW, halfH, 1.75, 1), eyeR = shell(landmarks.eyes.r, halfW, halfH, 1.75, -1);
const eyes = { P: [...eyeL.P, ...eyeR.P], N: [...eyeL.N, ...eyeR.N], UV: [...eyeL.UV, ...eyeR.UV], SIDE: [...eyeL.SIDE, ...eyeR.SIDE], I: [...eyeL.I, ...eyeR.I.map((i) => i + eyeL.P.length / 3)] };
const mouth = shell(landmarks.mouth.c, mouthHalfW * 1.25, mouthHalfW * 1.25, 1.35, 0);

const texWebp = await sharp(Buffer.from(texImg)).webp({ quality: 92 }).toBuffer();
const headBytes = await writeModule(`${BASE_OUT}/identity/bon/head.glb`, base, [
  { name: "identity_head", P: headGeo.P, N: headN, UV: headGeo.UV, I: headGeo.I, J: hJ, W: hW,
    extraAttrs: { _PAINT: { type: "VEC4", array: new Float32Array(headGeo.PAINT) } },
    material: { name: "identity_skin", texture: new Uint8Array(texWebp), roughness: 0.9 } },
  { name: "face_eyes", P: eyes.P, N: eyes.N, UV: eyes.UV, I: eyes.I, ...skinRigid(eyes.P.length / 3),
    extraAttrs: { _SIDE: { type: "SCALAR", array: new Float32Array(eyes.SIDE) } }, material: { name: "face_eyes", roughness: 0.4 } },
  { name: "face_mouth", P: mouth.P, N: mouth.N, UV: mouth.UV, I: mouth.I, ...skinRigid(mouth.P.length / 3), material: { name: "face_mouth", roughness: 0.7 } },
], { humanIdentity: { id: "bon", base: C.HUMAN_BASE_VERSION, landmarks, hides: ["NECK"], source: SRC } });

// HAIR: Bon's own hair, its own geometry, vertex-coloured from his texture (no second copy of the atlas)
// the texture carries a few light texels inside the hair (bake noise): the hair colour is his own near-black,
// keeping only the dark end of the texture's variation
const hairDark = []; for (let i = 0; i < nv; i++) if (label[i] === L.HAIR && dark(i)) hairDark.push(i);
const HAIR_C = [0, 1, 2].map((k) => { const a = hairDark.map((i) => COL[i * 3 + k]).sort((x, y) => x - y); return a[a.length >> 1]; });
const HCOL = new Float32Array(COL);
for (let i = 0; i < nv; i++) { const l = Math.min(LUM[i], 0.1) / 0.1; for (let k = 0; k < 3; k++) HCOL[i * 3 + k] = HAIR_C[k] * (0.85 + 0.3 * l); }
const hair = simplifyGeo(weldGeo(subset({ P: finalPos, N: N0, C: HCOL }, I, (t) => hairTri(t))), C.HUMAN_BUDGETS.hair, 0.004);
const hairBytes = await writeModule(`${BASE_OUT}/hair/bon-short.glb`, base, [
  { name: "hair_bon_short", P: hair.P, N: hair.N, COLOR: hair.C, I: hair.I, ...skinRigid(hair.P.length / 3), material: { name: "hair", roughness: 0.62 } },
], { humanHair: { id: "bon-short", base: C.HUMAN_BASE_VERSION } });

// GLASSES: CLEAN FRAMES IN BON'S DESIGN. The extracted original frames carried ragged inner edges and spiky temple
// fragments (fused geometry has no clean border), so the accessory is rebuilt from MEASUREMENTS of his frames:
// the rims' front outline (percentile box of the frame-front vertices), the front plane, his rim width; temples
// run back along his own head surface into the hair. Thick, rounded, glossy black — the same read, clean edges.
const rimPts = []; for (let i = 0; i < nv; i++) if (isG[i] && X(i) > 0.02 && N0[i * 3 + 2] > 0.55 && Z(i) > 0.28 && Y(i) > 0.93 && Y(i) < 1.18) rimPts.push([X(i), Y(i), Z(i)]);
const pq = (k, f) => { const a = rimPts.map((p) => p[k]).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * f))]; };
// the outer bar of each rim turns toward the side, so its edge is measured without the front-facing filter
const outerX = (() => { const a = []; for (let i = 0; i < nv; i++) if (isG[i] && X(i) > 0.2 && Z(i) > 0.24 && Y(i) > 0.97 && Y(i) < 1.16) a.push(X(i)); a.sort((x, y) => x - y); return a[Math.floor(a.length * 0.97)]; })();
const RIM = { x0: pq(0, 0.02), x1: outerX, y0: pq(1, 0.015), y1: pq(1, 0.985), zf: pq(2, 0.9) + 0.003, w: 0.031, depth: 0.026 };
console.log("frame outline (Bon space)", JSON.stringify(Object.fromEntries(Object.entries(RIM).map(([k, v]) => [k, +v.toFixed(3)]))));
const GP = [], GI = [];
const addV = (x, y, z) => { GP.push(x + OFF.x, y + OFF.y, z + OFF.z); return GP.length / 3 - 1; };
function roundedRect(cx, cy, hw, hh, r, phi) {
  // the point where the ray at angle phi from the centre meets a rounded rectangle (star-shaped: one hit)
  const dx = Math.cos(phi), dy = Math.sin(phi);
  let lo = 0, hi = Math.max(hw, hh) * 2;
  const inside = (t) => { const x = Math.abs(dx * t), y = Math.abs(dy * t); const qx = Math.max(0, x - (hw - r)), qy = Math.max(0, y - (hh - r)); return x <= hw && y <= hh && Math.hypot(qx, qy) <= r; };
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; }
  return [cx + dx * lo, cy + dy * lo];
}
for (const sx of [1, -1]) {
  const cx = sx * (RIM.x0 + RIM.x1) / 2, cy = (RIM.y0 + RIM.y1) / 2, hw = (RIM.x1 - RIM.x0) / 2, hh = (RIM.y1 - RIM.y0) / 2;
  const N = 120;
  // four contours: outer front, inner front, inner back, outer back — a small bevel (0.004) at the front edges
  const C4 = [[0.004, 0.045, RIM.zf], [RIM.w - 0.004, 0.022, RIM.zf], [RIM.w, 0.022, RIM.zf - RIM.depth], [0, 0.045, RIM.zf - RIM.depth], [0, 0.045, RIM.zf - 0.004], [RIM.w, 0.022, RIM.zf - 0.004]];
  const pts = C4.map(([inset, r, z]) => Array.from({ length: N }, (_, k) => { const [x, y] = roundedRect(cx, cy, hw - inset, hh - inset, r, (k / N) * Math.PI * 2);
    const wrap = 1.3 * Math.max(0, Math.abs(x) - 0.2) ** 2; return [x, y, z - wrap]; }));
  // each band gets its OWN vertices so the flat front, the walls and the bevels shade crisply (not like tubing)
  const band = (a, b) => { const A = pts[a].map((p) => addV(...p)), B = pts[b].map((p) => addV(...p));
    for (let k = 0; k < N; k++) { const k1 = (k + 1) % N; if (sx > 0) GI.push(A[k], B[k], A[k1], A[k1], B[k], B[k1]); else GI.push(A[k], A[k1], B[k], A[k1], B[k1], B[k]); } };
  band(0, 1);            // flat front
  band(1, 5);            // inner bevel
  band(5, 2);            // inner wall
  band(2, 3);            // back
  band(3, 4);            // outer wall
  band(4, 0);            // outer bevel
}
// the bridge: a short bar between the rims' inner top corners
{
  const y0 = RIM.y1 - 0.075, y1 = RIM.y1 - 0.035, xa = RIM.x0 + 0.012;
  const zf = RIM.zf - 0.004, zb = RIM.zf - RIM.depth + 0.004;
  const c = [[-xa, y0, zf], [xa, y0, zf], [xa, y1, zf], [-xa, y1, zf], [-xa, y0, zb], [xa, y0, zb], [xa, y1, zb], [-xa, y1, zb]].map(([x, y, z]) => addV(x, y, z));
  for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [3, 2, 6, 7], [4, 5, 1, 0]]) GI.push(c[a], c[b], c[cc], c[a], c[cc], c[d]);
}
// temples: from each rim's outer edge straight back along the side of Bon's own head, into the hair
{
  const yT = RIM.y1 - 0.05;
  const sideAt = (z) => { let m = 0; for (let i = 0; i < nv; i++) { if (label[i] !== L.FACE || Math.abs(Y(i) - yT) > 0.014 || Math.abs(Z(i) - z) > 0.012) continue; m = Math.max(m, Math.abs(X(i))); } return m; };
  for (const sx of [1, -1]) {
    const path = [];
    for (let z = RIM.zf - RIM.depth * 0.5; z > -0.03; z -= 0.025) path.push([sx * Math.max(RIM.x1 - 0.01, sideAt(z) + 0.01), yT, z]);
    const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
    const n = 40, seg = 10, base0 = GP.length / 3;
    const frames = curve.computeFrenetFrames(n, false);
    for (let k = 0; k <= n; k++) { const c = curve.getPointAt(k / n); const taper = k / n > 0.85 ? 0.8 : 1;
      for (let q = 0; q < seg; q++) { const a = (q / seg) * Math.PI * 2; const d = new THREE.Vector3(0, 1, 0).multiplyScalar(Math.sin(a) * 0.0085 * taper).add(new THREE.Vector3(1, 0, 0).multiplyScalar(Math.cos(a) * 0.0042));
        void frames; addV(c.x + d.x, c.y + d.y, c.z + d.z); } }
    for (let k = 0; k < n; k++) for (let q = 0; q < seg; q++) { const a = base0 + k * seg + q, b = base0 + k * seg + (q + 1) % seg; if (sx > 0) GI.push(a, a + seg, b, b, a + seg, b + seg); else GI.push(a, b, a + seg, b, b + seg, a + seg); }
  }
}
const GN = computeNormals(GP, GI);
const GC = new Float32Array(GP.length).fill(0.07);
const glassesBytes = await writeModule(`${BASE_OUT}/accessories/bon-glasses.glb`, base, [
  { name: "glasses_bon", P: GP, N: GN, COLOR: GC, I: GI, ...skinRigid(GP.length / 3), material: { name: "glasses_frame", roughness: 0.28, doubleSided: true } },
], { humanAccessory: { id: "bon-glasses", slot: "glasses", base: C.HUMAN_BASE_VERSION, design: "rebuilt from measurements of Bon's frames", outline: RIM } });
const gl = { I: GI };

// work copy for the long-hair build: hair + scalp positions in base space
fs.mkdirSync("scripts/avatar-pipeline/output/human-base", { recursive: true });
fs.writeFileSync("scripts/avatar-pipeline/output/human-base/bon-hair-work.json", JSON.stringify({
  hair: { P: Array.from(hair.P), I: hair.I, C: Array.from(hair.C) },
  scalp: { P: scalp.P, I: scalp.I }, landmarks, hairColor: HAIR_C,
}));
console.log(`head ${(headBytes / 1e6).toFixed(2)} MB (${headGeo.I.length / 3} tris + eyes ${eyes.I.length / 3} + mouth ${mouth.I.length / 3}) · hair ${(hairBytes / 1e6).toFixed(2)} MB (${hair.I.length / 3}) · glasses ${(glassesBytes / 1e3).toFixed(0)} KB (${gl.I.length / 3})`);
