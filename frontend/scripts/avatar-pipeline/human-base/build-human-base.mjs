// build-human-base.mjs — HUMANBASE_V1, the shared employee body (Phase 2 proof). ZERO CREDITS, NO GENERATION.
//
//   node scripts/avatar-pipeline/human-base/build-human-base.mjs        (from frontend/)
//
// INPUT (read-only): Alex v2's approved shipping LOD0 — the body/skeleton/idle donor, NOT the identity.
//   public/avatars/alex-v2-hq-idle9/alex-v2-lod0.glb        mesh + skeleton + the 7 approved clips
//   scripts/avatar-pipeline/output/meshy-employees/alex-v2/alex-v2-idle-12-armfix-v1.glb   feminine idle (optional)
// OUTPUT:
//   public/avatars/human-base-v1/human-base.glb             the base body + the ONE shared clip library
//   scripts/avatar-pipeline/output/human-base/base-fullres.glb   full-res work file the garment build reads (gitignored)
//
// WHAT HAPPENS (every rule in bind space, native units, contract in src/dev/vo3d/human/humanBaseContract.ts):
//   1. SYMMETRY — the left half (+x) is kept and mirrored; right-side joints are moved onto the mirror of the left
//      ones (rest ROTATIONS kept, so every clip key is untouched). Seam vertices take the averaged weights.
//   2. NO IDENTITY — Alex's head (beard, glasses, face) is cut away above a neck stub. Identity heads replace it.
//   3. CLEAN SHINS — Alex's trouser legs below the thigh line are not skin; they become procedural tapered legs.
//   4. HANDS — thumb / index / fingers, two segments each, appended AFTER the 24 core joints (no clip moves).
//   5. REGIONS — every triangle belongs to exactly one body region (seam vertices split), so garments can hide
//      whole regions by discard.
//   6. ONE CLIP LIBRARY — non-Hips translation and all scale tracks are dropped (measured equal to rest), the
//      approved idle becomes `idle-masculine`, Alex's own arm-fixed Idle_12 becomes `idle-feminine`.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { draco, prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import * as THREE from "three";
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";

const SRC = "public/avatars/alex-v2-hq-idle9/alex-v2-lod0.glb";
const FEM = "scripts/avatar-pipeline/output/meshy-employees/alex-v2/alex-v2-idle-12-armfix-v1.glb";
const WORK = "scripts/avatar-pipeline/output/human-base";
const OUT = "public/avatars/human-base-v1";
const BODY_TRIS = Number(process.env.BODY_TRIS ?? C.HUMAN_BUDGETS.body);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(), "draco3d.encoder": await draco3d.createEncoderModule(),
});
await MeshoptSimplifier.ready;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const R = C.BODY_REGIONS, K = C.REGION_CUTS;

const doc = await io.read(SRC);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const prim = root.listMeshes()[0].listPrimitives()[0];
const meshNode = root.listNodes().find((n) => n.getMesh());
const jointNodes = skin.listJoints();
const jointNames = jointNodes.map((j) => j.getName());
if (jointNames.join() !== C.HUMAN_CORE_JOINTS.join()) throw new Error(`donor joints are not the contract core: ${jointNames}`);
const JI = Object.fromEntries(jointNames.map((n, i) => [n, i]));
const M = (a) => new THREE.Matrix4().fromArray(a);
// glTF skinning ignores the skinned mesh node's own transform: vertices live in SCENE space and every inverse
// bind matrix is exactly jointWorld⁻¹ (checked on the donor: boneWorld · IBM = I). So "mesh space" is the scene.
const meshW = new THREE.Matrix4();
const meshWInv = meshW.clone().invert();
/** joint origin in MESH space (the space the vertices live in) */
const jointPos = (node) => new THREE.Vector3().setFromMatrixPosition(meshWInv.clone().multiply(M(node.getWorldMatrix())));

// ================================ 1. SYMMETRIC SKELETON ===================================================
// parent-first: the contract order already is
const restBefore = Object.fromEntries(jointNodes.map((n) => [n.getName(), jointPos(n)]));
for (const n of jointNodes) {
  const name = n.getName();
  let want;
  if (name.startsWith("Right")) { const l = restBefore[C.mirrorJoint(name)]; want = new THREE.Vector3(-l.x, l.y, l.z); }
  else if (name.startsWith("Left")) want = restBefore[name].clone();
  else want = restBefore[name].clone().setX(0);
  // local translation = parentWorld⁻¹ · (meshWorld · want)
  const parent = n.getParentNode();
  const pw = M(parent.getWorldMatrix()).invert();
  const local = want.clone().applyMatrix4(meshW).applyMatrix4(pw);
  n.setTranslation([local.x, local.y, local.z]);
}
const rest = Object.fromEntries(jointNodes.map((n) => [n.getName(), jointPos(n)]));

// ================================ 2. SOURCE ARRAYS ========================================================
const P0 = prim.getAttribute("POSITION").getArray(), N0 = prim.getAttribute("NORMAL").getArray();
const UV0 = prim.getAttribute("TEXCOORD_0").getArray(), J0 = prim.getAttribute("JOINTS_0").getArray(), W0 = prim.getAttribute("WEIGHTS_0").getArray();
const I0 = prim.getIndices().getArray();
const nv0 = P0.length / 3;
const mirrorIdx = jointNames.map((n) => JI[C.mirrorJoint(n)]);

// ================================ 3. MIRROR THE LEFT HALF =================================================
const posKey = (x, y, z) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
const keepTri = [];
for (let t = 0; t < I0.length; t += 3) {
  const cx = (P0[I0[t] * 3] + P0[I0[t + 1] * 3] + P0[I0[t + 2] * 3]) / 3;
  if (cx >= 0) keepTri.push(t);
}
// welded boundary of the kept set: an edge used once among kept triangles, near the centre plane
const wid = new Int32Array(nv0); { const m = new Map(); for (let i = 0; i < nv0; i++) { const k = posKey(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]); if (!m.has(k)) m.set(k, i); wid[i] = m.get(k); } }
const edgeUse = new Map();
for (const t of keepTri) for (let k = 0; k < 3; k++) {
  let a = wid[I0[t + k]], b = wid[I0[t + (k + 1) % 3]]; if (a > b) [a, b] = [b, a];
  const key = a * nv0 + b; edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
}
const onSeam = new Uint8Array(nv0);
for (const [key, c] of edgeUse) {
  if (c !== 1) continue;
  const a = Math.floor(key / nv0), b = key % nv0;
  if (Math.abs(P0[a * 3]) < 0.02 && Math.abs(P0[b * 3]) < 0.02) { onSeam[a] = 1; onSeam[b] = 1; }
}
for (let i = 0; i < nv0; i++) if (onSeam[wid[i]]) onSeam[i] = 1;
const used = new Uint8Array(nv0); for (const t of keepTri) for (let k = 0; k < 3; k++) used[I0[t + k]] = 1;
const P = [], N = [], UV = [], J = [], W = [];
const newOf = new Int32Array(nv0).fill(-1), mirOf = new Int32Array(nv0).fill(-1);
const pushV = (i, mirror) => {
  const x = onSeam[i] ? 0 : P0[i * 3];
  P.push(mirror ? -x : x, P0[i * 3 + 1], P0[i * 3 + 2]);
  let nx = N0[i * 3]; if (onSeam[i]) nx = 0;
  const nn = Math.hypot(nx, N0[i * 3 + 1], N0[i * 3 + 2]) || 1;
  N.push((mirror ? -nx : nx) / nn, N0[i * 3 + 1] / nn, N0[i * 3 + 2] / nn);
  UV.push(UV0[i * 2], UV0[i * 2 + 1]);
  const w = {};
  for (let k = 0; k < 4; k++) { const wt = W0[i * 4 + k]; if (wt <= 0) continue; const j = J0[i * 4 + k];
    if (onSeam[i]) { w[j] = (w[j] ?? 0) + wt / 2; w[mirrorIdx[j]] = (w[mirrorIdx[j]] ?? 0) + wt / 2; }
    else { const jj = mirror ? mirrorIdx[j] : j; w[jj] = (w[jj] ?? 0) + wt; } }
  const top = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = top.reduce((a, [, v]) => a + v, 0);
  for (let k = 0; k < 4; k++) { J.push(top[k] ? +top[k][0] : 0); W.push(top[k] ? top[k][1] / s : 0); }
  return P.length / 3 - 1;
};
for (let i = 0; i < nv0; i++) if (used[i]) newOf[i] = pushV(i, false);
for (let i = 0; i < nv0; i++) if (used[i]) mirOf[i] = onSeam[i] ? newOf[i] : pushV(i, true);
let I = [];
for (const t of keepTri) I.push(newOf[I0[t]], newOf[I0[t + 1]], newOf[I0[t + 2]]);
for (const t of keepTri) I.push(mirOf[I0[t]], mirOf[I0[t + 2]], mirOf[I0[t + 1]]);
console.log(`symmetric: ${P.length / 3} verts, ${I.length / 3} tris (seam verts ${onSeam.reduce((a, b) => a + b, 0)})`);

// ================================ 4. CUT IDENTITY + TROUSER SHINS =========================================
const nv = () => P.length / 3;
const wOf = (i, names) => { let s = 0; for (let k = 0; k < 4; k++) if (names.includes(jointNames[J[i * 4 + k]] ?? "")) s += W[i * 4 + k]; return s; };
const dom = (i) => { let b = 0; for (let k = 1; k < 4; k++) if (W[i * 4 + k] > W[i * 4 + b]) b = k; return jointNames[J[i * 4 + b]]; };
const headZ = rest.neck.z;
const isHead = (i) => {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  if (y > 0.9) return true;
  if (wOf(i, ["Head", "head_end", "headfront"]) <= 0.5) return false;
  return !(Math.hypot(x, z - headZ) < 0.085 && y < 0.86);
};
const LEG = ["LeftLeg", "RightLeg", "LeftUpLeg", "RightUpLeg"];
const isShin = (i) => P[i * 3 + 1] < K.thighY && LEG.includes(dom(i));
{
  const head = new Uint8Array(nv()).map((_, i) => (isHead(i) ? 1 : 0));
  const shin = new Uint8Array(nv()).map((_, i) => (isShin(i) ? 1 : 0));
  const out = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (head[a] || head[b] || head[c]) continue;
    if (shin[a] && shin[b] && shin[c]) continue;
    // leftover trouser fragments between the ankle and the thigh line (mixed weights kept them) are not skin either
    const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
    if (cy < K.thighY && cy > K.ankleY - 0.005 && ![a, b, c].some((v) => /Foot|Toe/.test(dom(v)))) continue;
    out.push(a, b, c);
  }
  console.log(`identity + trouser-shin cut: ${I.length / 3} → ${out.length / 3} tris`);
  I = out;
}

// skin UV: a texel in the middle of the left forearm's top (Alex's arms are bare skin)
let skinUV = [0, 0]; {
  let best = 1e9;
  for (let i = 0; i < nv(); i++) {
    const d = Math.hypot(P[i * 3] - 0.47, P[i * 3 + 1] - 0.76, P[i * 3 + 2] - 0.0);
    if (d < best && dom(i) === "LeftForeArm") { best = d; skinUV = [UV[i * 2], UV[i * 2 + 1]]; }
  }
}

// the base skin's own luminance (linear), measured on the forearms: the runtime tints by luminance ratio
let SKIN_LUM = 0.56; {
  const { data, info } = await sharp(Buffer.from(root.listTextures()[0].getImage())).raw().toBuffer({ resolveWithObject: true });
  const lin = (c) => Math.pow(c / 255, 2.2);
  const ls = [];
  for (let i = 0; i < nv(); i++) {
    if (!/ForeArm/.test(dom(i))) continue;
    const x = Math.min(info.width - 1, Math.floor(UV[i * 2] * info.width)), y = Math.min(info.height - 1, Math.floor(UV[i * 2 + 1] * info.height));
    const o = (y * info.width + x) * info.channels;
    ls.push(0.2126 * lin(data[o]) + 0.7152 * lin(data[o + 1]) + 0.0722 * lin(data[o + 2]));
  }
  ls.sort((a, b) => a - b); SKIN_LUM = ls[ls.length >> 1];
  console.log(`base skin luminance (linear, forearm median) ${SKIN_LUM.toFixed(3)}`);
}

// ================================ 5. PROCEDURAL SHINS =====================================================
// a tapered, slightly elliptical limb from just inside a shorts hem (y 0.245) down into the shoe (y 0.065): it starts
// low so it can never poke through a slim leg above the knee
const SHIN_RINGS = 26, SHIN_SEG = 32;
const shinRadius = (y) => {
  const knots = [[0.245, 0.08], [0.22, 0.077], [0.15, 0.069], [0.11, 0.061], [0.065, 0.056]];
  for (let k = 0; k < knots.length - 1; k++) {
    const [y0, r0] = knots[k], [y1, r1] = knots[k + 1];
    if (y <= y0 && y >= y1) { const u = (y0 - y) / (y0 - y1); return r0 + (r1 - r0) * (u * u * (3 - 2 * u)); }
  }
  return y > 0.245 ? 0.08 : 0.056;
};
const shinRegionStart = I.length;
for (const side of ["Left", "Right"]) {
  const up = rest[`${side}UpLeg`], knee = rest[`${side}Leg`], ank = rest[`${side}Foot`];
  const ji = { up: JI[`${side}UpLeg`], leg: JI[`${side}Leg`], foot: JI[`${side}Foot`] };
  const centre = (y) => {
    if (y >= knee.y) { const u = (up.y - y) / (up.y - knee.y); return up.clone().lerp(knee, u); }
    const u = (knee.y - y) / (knee.y - ank.y); return knee.clone().lerp(ank, Math.min(1, u));
  };
  const base = nv();
  for (let r = 0; r <= SHIN_RINGS; r++) {
    const y = 0.245 - (0.245 - 0.065) * (r / SHIN_RINGS);
    const c = centre(y);
    for (let s = 0; s < SHIN_SEG; s++) {
      const a = (s / SHIN_SEG) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      // calf at the back, a soft knee at the front
      const calf = dz < 0 ? 0.008 * (-dz) * Math.exp(-(((y - 0.14) / 0.035) ** 2)) : 0;
      const kneeCap = dz > 0 ? 0.004 * dz * dz * Math.exp(-(((y - 0.15) / 0.02) ** 2)) : 0;
      const rad = shinRadius(y) + calf + kneeCap;
      P.push(c.x + dx * rad, y, c.z + dz * rad * 0.94);
      const n = new THREE.Vector3(dx, 0.05, dz * 1.06).normalize();
      N.push(n.x, n.y, n.z);
      UV.push(skinUV[0], skinUV[1]);
      // above the knee band: thigh; through it: blend; below: shin; into the shoe: foot
      const kb = smooth(knee.y - 0.03, knee.y + 0.035, y);
      const fb = 1 - smooth(ank.y + 0.005, ank.y + 0.04, y);
      const wUp = kb, wLeg = (1 - kb) * (1 - fb), wFoot = (1 - kb) * fb;
      J.push(ji.up, ji.leg, ji.foot, 0); W.push(wUp, wLeg, wFoot, 0);
    }
  }
  for (let r = 0; r < SHIN_RINGS; r++) for (let s = 0; s < SHIN_SEG; s++) {
    const a = base + r * SHIN_SEG + s, b = base + r * SHIN_SEG + (s + 1) % SHIN_SEG;
    const c2 = a + SHIN_SEG, d2 = b + SHIN_SEG;
    // outward winding (normals point away from the axis)
    if (side === "Left") I.push(a, c2, b, b, c2, d2); else I.push(a, c2, b, b, c2, d2);
  }
}
const shinTris = new Set(); for (let t = shinRegionStart; t < I.length; t += 3) shinTris.add(t / 3);

// ================================ 6. HAND ARTICULATION ====================================================
// zones measured on Alex's left hand (top view, palm down): the thumb leaves the wrist forward (+z), the index
// is the front finger, middle/ring/little are joined. Positions are averaged from the zone's own vertices.
const HAND = rest.LeftHand;
const zoneOf = (x, z) => {
  if (z > 0.052 && x < 0.668) return "Thumb";
  if (x < 0.612) return null;
  return z > 0.012 ? "Index" : "Fingers";
};
const zoneStats = { Thumb: [], Index: [], Fingers: [] };
for (let i = 0; i < nv(); i++) {
  if (dom(i) !== "LeftHand") continue;
  const x = P[i * 3], z = P[i * 3 + 2];
  const zn = zoneOf(x, z); if (zn) zoneStats[zn].push([x, P[i * 3 + 1], z]);
}
const avg = (pts, f) => pts.filter(f).reduce((a, p, _, arr) => [a[0] + p[0] / arr.length, a[1] + p[1] / arr.length, a[2] + p[2] / arr.length], [0, 0, 0]);
// thumb axis: from its root at the wrist toward its tip
const thumbPts = zoneStats.Thumb;
const thumbTip = thumbPts.reduce((b, p) => (p[2] > b[2] ? p : b), thumbPts[0]);
const thumbRoot = [HAND.x + 0.012, avg(thumbPts, () => true)[1], 0.058];
const tAxis = new THREE.Vector3(thumbTip[0] - thumbRoot[0], 0, thumbTip[2] - thumbRoot[2]); const tLen = tAxis.length(); tAxis.normalize();
const idx = avg(zoneStats.Index, (p) => p[0] > 0.64 && p[0] < 0.7), fin = avg(zoneStats.Fingers, (p) => p[0] > 0.64 && p[0] < 0.7);
const idxTip = zoneStats.Index.reduce((b, p) => (p[0] > b[0] ? p : b), zoneStats.Index[0]);
const finTip = zoneStats.Fingers.reduce((b, p) => (p[0] > b[0] ? p : b), zoneStats.Fingers[0]);
const KNUCKLE_X = 0.632;
const fingerJoints = {
  Thumb1: new THREE.Vector3(thumbRoot[0] + tAxis.x * tLen * 0.18, thumbRoot[1], thumbRoot[2] + tAxis.z * tLen * 0.18),
  Thumb2: new THREE.Vector3(thumbRoot[0] + tAxis.x * tLen * 0.6, thumbRoot[1], thumbRoot[2] + tAxis.z * tLen * 0.6),
  Index1: new THREE.Vector3(KNUCKLE_X, idx[1], idx[2]),
  Index2: new THREE.Vector3(KNUCKLE_X + (idxTip[0] - KNUCKLE_X) * 0.48, idx[1], idx[2]),
  Fingers1: new THREE.Vector3(KNUCKLE_X, fin[1], fin[2]),
  Fingers2: new THREE.Vector3(KNUCKLE_X + (finTip[0] - KNUCKLE_X) * 0.48, fin[1], fin[2]),
};
// nodes: identity local rotation (each digit starts aligned with its hand), parent = the hand
const newJoint = {};
for (const side of ["Left", "Right"]) {
  const hand = jointNodes[JI[`${side}Hand`]];
  for (const d of ["Thumb1", "Thumb2", "Index1", "Index2", "Fingers1", "Fingers2"]) {
    const name = `${side}${d}`;
    const p = fingerJoints[d].clone(); if (side === "Right") p.x = -p.x;
    const parentNode = d.endsWith("2") ? newJoint[`${side}${d.slice(0, -1)}1`] : hand;
    const node = doc.createNode(name);
    parentNode.addChild(node);
    // world rotation = the parent's: local rotation identity; local translation from the parent's world frame
    const local = p.clone().applyMatrix4(meshW).applyMatrix4(M(parentNode.getWorldMatrix()).invert());
    node.setTranslation([local.x, local.y, local.z]);
    // keep scale consistent with the parent chain (identity local scale)
    newJoint[name] = node;
  }
}
for (const name of C.HUMAN_HAND_JOINTS) { skin.addJoint(newJoint[name]); JI[name] = jointNames.length; jointNames.push(name); }
for (const name of C.HUMAN_HAND_JOINTS) rest[name] = jointPos(newJoint[name]);

// re-weight hand vertices: the hand's share is split between the palm and the digit chain it lies on
for (let i = 0; i < nv(); i++) {
  for (const side of ["Left", "Right"]) {
    const hj = JI[`${side}Hand`];
    let k = -1; for (let q = 0; q < 4; q++) if (J[i * 4 + q] === hj && W[i * 4 + q] > 0) k = q;
    if (k < 0) continue;
    const sx = side === "Left" ? 1 : -1;
    const x = P[i * 3] * sx, z = P[i * 3 + 2];
    if (x < 0.55) continue;
    const wH = W[i * 4 + k];
    const share = {}; // joint → fraction of wH
    // thumb membership: forward of the thumb/index valley, near the thumb axis
    const rel = new THREE.Vector3(x - thumbRoot[0], 0, z - thumbRoot[2]);
    const along = rel.dot(tAxis) / tLen;
    const thumbM = smooth(0.044, 0.06, z) * (1 - smooth(0.66, 0.68, x)) * smooth(0.02, 0.2, along);
    const fingerM = (1 - thumbM) * smooth(KNUCKLE_X - 0.018, KNUCKLE_X + 0.012, x);
    const palm = 1 - thumbM - fingerM;
    if (palm > 0) share[hj] = palm;
    if (thumbM > 0) {
      const s2 = smooth(0.48, 0.72, along);
      share[JI[`${side}Thumb1`]] = thumbM * (1 - s2); share[JI[`${side}Thumb2`]] = thumbM * s2;
    }
    if (fingerM > 0) {
      const iM = smooth(0.004, 0.02, z); // index ↔ joined fingers, softened across the valley
      const mid = KNUCKLE_X + (Math.max(idxTip[0], finTip[0]) - KNUCKLE_X) * 0.48;
      const s2 = smooth(mid - 0.012, mid + 0.012, x);
      share[JI[`${side}Index1`]] = fingerM * iM * (1 - s2); share[JI[`${side}Index2`]] = fingerM * iM * s2;
      share[JI[`${side}Fingers1`]] = fingerM * (1 - iM) * (1 - s2); share[JI[`${side}Fingers2`]] = fingerM * (1 - iM) * s2;
    }
    const w = {};
    for (let q = 0; q < 4; q++) if (q !== k && W[i * 4 + q] > 0) w[J[i * 4 + q]] = (w[J[i * 4 + q]] ?? 0) + W[i * 4 + q];
    for (const [j, f] of Object.entries(share)) if (f > 1e-4) w[j] = (w[j] ?? 0) + wH * f;
    const top = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = top.reduce((a, [, v]) => a + v, 0);
    for (let q = 0; q < 4; q++) { J[i * 4 + q] = top[q] ? +top[q][0] : 0; W[i * 4 + q] = top[q] ? top[q][1] / s : 0; }
  }
}

// measured hand frames (left; printed so the contract can be checked against them)
const leftHandVerts = [];
for (let i = 0; i < nv(); i++) if (P[i * 3] > 0.56 && ["LeftHand", "LeftThumb1", "LeftThumb2", "LeftIndex1", "LeftIndex2", "LeftFingers1", "LeftFingers2"].includes(dom(i))) leftHandVerts.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
const palmPts = leftHandVerts.filter((p) => p[0] > 0.6 && p[0] < 0.66 && p[2] > -0.05 && p[2] < 0.04);
const palmY = Math.min(...palmPts.map((p) => p[1]));
const palmC = avg(palmPts, () => true);
const measured = {
  grip: [+palmC[0].toFixed(3), +(palmY - 0.012).toFixed(3), +palmC[2].toFixed(3)],
  palm: [+palmC[0].toFixed(3), +palmY.toFixed(3), +palmC[2].toFixed(3)],
  pinch: [+((idxTip[0] + thumbTip[0]) / 2).toFixed(3), +((idxTip[1] + thumbTip[1]) / 2).toFixed(3), +((idxTip[2] + thumbTip[2]) / 2).toFixed(3)],
  tip: [+idxTip[0].toFixed(3), +idxTip[1].toFixed(3), +idxTip[2].toFixed(3)],
};
console.log("measured hand frames (left):", JSON.stringify(measured));
console.log("digit joints (left):", JSON.stringify(Object.fromEntries(Object.entries(fingerJoints).map(([k, v]) => [k, v.toArray().map((x) => +x.toFixed(3))]))));

// ================================ 7. REGIONS (one per triangle, seams split) =============================
const regionOfTri = (t) => {
  if (shinTris.has(t / 3)) return P[I[t] * 3] > 0 ? R.SHIN_L : R.SHIN_R;
  let cx = 0, cy = 0, cz = 0; const doms = [];
  for (let k = 0; k < 3; k++) { const i = I[t + k]; cx += P[i * 3] / 3; cy += P[i * 3 + 1] / 3; cz += P[i * 3 + 2] / 3; doms.push(dom(i)); }
  const ax = Math.abs(cx), L = cx > 0;
  const d = doms[0];
  if (/Hand|Thumb|Index|Fingers/.test(d) || ax > K.wristX) return L ? R.HAND_L : R.HAND_R;
  if (ax > K.elbowX) return L ? R.FOREARM_L : R.FOREARM_R;
  if (ax > K.shoulderX && cy > 0.55) return L ? R.UPPERARM_L : R.UPPERARM_R;
  if (cy < K.ankleY || /Foot|Toe/.test(d)) return L ? R.FOOT_L : R.FOOT_R;
  if (cy < K.crotchY && ax > 0.02) return L ? R.THIGH_L : R.THIGH_R;
  if (cy < K.waistY) return R.PELVIS;
  if (cy < K.chestY) return R.BELLY;
  if (cy > K.neckY && ax < 0.12 && cz > -0.15) return R.NECK;
  void cz;
  return R.CHEST;
};
const REG = [];
{
  const triReg = []; for (let t = 0; t < I.length; t += 3) triReg.push(regionOfTri(t));
  const copyOf = new Map(); const vReg = new Int16Array(nv()).fill(-1);
  const clone = (i) => { P.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); N.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); UV.push(UV[i * 2], UV[i * 2 + 1]);
    for (let k = 0; k < 4; k++) { J.push(J[i * 4 + k]); W.push(W[i * 4 + k]); } return P.length / 3 - 1; };
  for (let t = 0; t < I.length; t += 3) {
    const r = triReg[t / 3];
    for (let k = 0; k < 3; k++) {
      const i = I[t + k];
      if (vReg[i] === -1 || vReg[i] === r) { vReg[i] = r; continue; }
      const key = `${i}:${r}`;
      let c = copyOf.get(key); if (c === undefined) { c = clone(i); copyOf.set(key, c); }
      I[t + k] = c;
    }
  }
  for (let i = 0; i < nv(); i++) REG.push(i < vReg.length ? vReg[i] : -1);
  for (const [key, c] of copyOf) REG[c] = +key.split(":")[1];
  console.log(`regions: ${copyOf.size} seam vertices split`);
}

// ================================ 8. COMPACT + SIMPLIFY ==================================================
function compact(Iin) {
  const map = new Int32Array(nv()).fill(-1); const o = { P: [], N: [], UV: [], J: [], W: [], REG: [], I: [] };
  for (const i of Iin) {
    if (map[i] < 0) { map[i] = o.P.length / 3; o.P.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); o.N.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); o.UV.push(UV[i * 2], UV[i * 2 + 1]);
      for (let k = 0; k < 4; k++) { o.J.push(J[i * 4 + k]); o.W.push(W[i * 4 + k]); } o.REG.push(REG[i]); }
    o.I.push(map[i]);
  }
  return o;
}
const full = compact(I);
console.log(`full-res base: ${full.P.length / 3} verts, ${full.I.length / 3} tris`);
let lod0 = full;
if (full.I.length / 3 > BODY_TRIS) {
  const pos = new Float32Array(full.P);
  const [sIdx, err] = MeshoptSimplifier.simplify(new Uint32Array(full.I), pos, 3, BODY_TRIS * 3, 0.004, ["LockBorder"]);
  // keep the UV/skin seams honest: simplify only ever keeps original vertices
  const sub = { P: full.P, N: full.N, UV: full.UV, J: full.J, W: full.W, REG: full.REG };
  const map = new Int32Array(full.P.length / 3).fill(-1); const o = { P: [], N: [], UV: [], J: [], W: [], REG: [], I: [] };
  for (const i of sIdx) {
    if (map[i] < 0) { map[i] = o.P.length / 3; o.P.push(sub.P[i * 3], sub.P[i * 3 + 1], sub.P[i * 3 + 2]); o.N.push(sub.N[i * 3], sub.N[i * 3 + 1], sub.N[i * 3 + 2]); o.UV.push(sub.UV[i * 2], sub.UV[i * 2 + 1]);
      for (let k = 0; k < 4; k++) { o.J.push(sub.J[i * 4 + k]); o.W.push(sub.W[i * 4 + k]); } o.REG.push(sub.REG[i]); }
    o.I.push(map[i]);
  }
  lod0 = o;
  console.log(`LOD0 simplified: ${lod0.I.length / 3} tris (error ${err.toFixed(4)})`);
}

// ================================ 9. CLIPS ===============================================================
for (const a of root.listAnimations()) {
  for (const ch of a.listChannels()) {
    const path = ch.getTargetPath(), name = ch.getTargetNode()?.getName();
    if (path === "scale" || (path === "translation" && name !== "Hips")) { const s = ch.getSampler(); ch.dispose(); if (s.listParents().length <= 1) s.dispose(); }
  }
  if (a.getName() === "idle-9") a.setName("idle-masculine");
}
if (fs.existsSync(FEM)) {
  const fdoc = await io.read(FEM);
  const fa = fdoc.getRoot().listAnimations()[0];
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const anim = doc.createAnimation("idle-feminine");
  const buf = root.listBuffers()[0];
  for (const ch of fa.listChannels()) {
    const path = ch.getTargetPath(), name = ch.getTargetNode().getName();
    if (path === "scale" || (path === "translation" && name !== "Hips")) continue;
    const target = byName.get(name); if (!target) continue;
    const s = ch.getSampler();
    const input = doc.createAccessor().setType("SCALAR").setArray(new Float32Array(s.getInput().getArray())).setBuffer(buf);
    const output = doc.createAccessor().setType(path === "rotation" ? "VEC4" : "VEC3").setArray(new Float32Array(s.getOutput().getArray())).setBuffer(buf);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(path).setSampler(sampler));
  }
} else console.warn("feminine idle source missing — idle-feminine will fall back to idle-masculine at runtime");
const clipNames = root.listAnimations().map((a) => a.getName());
for (const c of C.HUMAN_CLIPS) if (!clipNames.includes(c)) console.warn(`clip ${c} missing`);

// ================================ 10. WRITE ==============================================================
// inverse bind matrices for the (moved + new) joints: IBM = jointWorld⁻¹ · meshWorld
const allJoints = skin.listJoints();
const ibm = new Float32Array(allJoints.length * 16);
allJoints.forEach((j, i) => ibm.set(M(j.getWorldMatrix()).invert().multiply(meshW).toArray(), i * 16));
skin.getInverseBindMatrices().setArray(ibm);

function writePrim(target, g) {
  const buf = root.listBuffers()[0];
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  for (const sem of target.listSemantics()) { const a = target.getAttribute(sem); target.setAttribute(sem, null); if (a && a.listParents().length <= 1) a.dispose(); }
  target.setAttribute("POSITION", acc("VEC3", new Float32Array(g.P)));
  target.setAttribute("NORMAL", acc("VEC3", new Float32Array(g.N)));
  target.setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array(g.UV)));
  target.setAttribute("JOINTS_0", acc("VEC4", new Uint8Array(g.J)));
  target.setAttribute("WEIGHTS_0", acc("VEC4", new Float32Array(g.W)));
  target.setAttribute("_REGION", acc("SCALAR", new Float32Array(g.REG)));
  target.setIndices(acc("SCALAR", new Uint32Array(g.I)));
}
fs.mkdirSync(WORK, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const tex = root.listTextures()[0];
const extras = {
  humanBase: {
    version: C.HUMAN_BASE_VERSION, donor: "alex-v2", builtAt: new Date().toISOString().slice(0, 10), skinLum: +SKIN_LUM.toFixed(4),
    handFramesMeasured: measured, joints: jointNames, clips: clipNames,
    rest: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.toArray().map((x) => +x.toFixed(4))])),
  },
};
meshNode.setName("humanbase_body"); meshNode.getMesh().setName("humanbase_body");
root.listMaterials()[0].setName("humanbase_skin");
meshNode.setExtras(extras);

// work file: full resolution, original texture (the garment build reads geometry, regions and weights)
writePrim(prim, full);
await io.write(`${WORK}/base-fullres.glb`, doc);

// shipped base: LOD0, 1024 near-lossless WebP skin texture, Draco
writePrim(prim, lod0);
const png = await sharp(Buffer.from(tex.getImage())).resize(1024, 1024).webp({ quality: 92 }).toBuffer();
tex.setImage(new Uint8Array(png)).setMimeType("image/webp");
doc.createExtension(ALL_EXTENSIONS.find((e) => e.EXTENSION_NAME === "EXT_texture_webp")).setRequired(true);
await doc.transform(prune(), draco({ method: "edgebreaker", quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeGeneric: 12 }));
await io.write(`${OUT}/human-base.glb`, doc);
console.log(`wrote ${OUT}/human-base.glb ${(fs.statSync(`${OUT}/human-base.glb`).size / 1e6).toFixed(2)} MB · joints ${jointNames.length} · clips ${clipNames.join(", ")}`);
