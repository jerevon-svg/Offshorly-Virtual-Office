// build-monkey-fullres.mjs — MONKEYAGENT STAGE 1 (P1 proof, now the P2 base input): the repaired full-res derivative.
//
//   node scripts/avatar-pipeline/monkey-agent/build-monkey-fullres.mjs     (from frontend/)
//   then build-monkey-base.mjs (stage 2) makes the shipped LODs.
//
// INPUTS (read-only, never rewritten):
//   public/avatars/monkey-base-v1/monkey-master.glb   the approved master = the locked visual reference
//   public/avatars/bon-v3-hq-idle9/bon-v3-lod2.glb    the employee clip source (the 7 contract clips)
// OUTPUTS (intermediates, not served, uncommitted) in scripts/avatar-pipeline/monkey-agent/work/:
//   monkey-agent-fullres.glb   24-joint contract, repaired weights, seam-exact _REGION, 7 clips
//   garment-<id>.glb           tee / longsleeve / vest / cap, skinned to the same skeleton
//
// Every rule below is in bind space (native units, 1.700 tall, +z face, y up) and is SYMMETRIC by
// construction — the asymmetry the audit measured (left thigh owning 14.4k verts incl. belly and tail)
// cannot survive it. All fitted numbers come from world/monkeyAgentContract.ts.
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";
import { prune } from "@gltf-transform/functions";
import * as THREE from "three";
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/world/monkeyAgentContract.ts";

const MASTER = "public/avatars/monkey-base-v1/monkey-master.glb";
const CLIP_SOURCE = "public/avatars/bon-v3-hq-idle9/bon-v3-lod2.glb";
const OUT_DIR = "scripts/avatar-pipeline/monkey-agent/work";
const R = C.BODY_REGIONS;
const L = C.MONKEY_SURFACE_LANDMARKS;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// =====================================================================================================
// 1. SKELETON: rename to the contract, fold the four end joints into their parents, reorder.
// =====================================================================================================
const doc = await io.read(MASTER);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const oldJoints = skin.listJoints();
const oldNames = oldJoints.map((j) => j.getName());
const ibmOld = skin.getInverseBindMatrices();
const byContract = new Map();
oldJoints.forEach((j, i) => {
  const name = C.MASTER_TO_CONTRACT_JOINT[oldNames[i]];
  if (name) { j.setName(name); byContract.set(name, { node: j, oldIndex: i }); }
});
for (const name of C.MONKEY_SKELETON_JOINTS) if (!byContract.has(name)) throw new Error(`master lacks ${name}`);
// old index -> contract index (dropped end joints fold into their parent)
const oldToNew = oldNames.map((n) => {
  const target = C.MASTER_TO_CONTRACT_JOINT[n] ?? C.MASTER_DROPPED_JOINTS[n];
  if (!target) throw new Error(`unmapped joint ${n}`);
  return C.MONKEY_SKELETON_JOINTS.indexOf(target);
});
for (const j of oldJoints) skin.removeJoint(j);
const ibmArr = new Float32Array(24 * 16);
C.MONKEY_SKELETON_JOINTS.forEach((name, k) => {
  const { node, oldIndex } = byContract.get(name);
  skin.addJoint(node);
  ibmArr.set(ibmOld.getElement(oldIndex, []), k * 16);
});
ibmOld.setArray(ibmArr);
for (const n of Object.keys(C.MASTER_DROPPED_JOINTS)) {
  const node = oldJoints[oldNames.indexOf(n)];
  node.detach?.(); node.dispose();
}
for (const a of root.listAnimations()) a.dispose();
// hierarchy check against the contract
for (const name of C.MONKEY_SKELETON_JOINTS) {
  const node = byContract.get(name).node;
  const parent = node.getParentNode?.() ?? root.listNodes().find((p) => p.listChildren().includes(node));
  const want = C.MONKEY_SKELETON_PARENTS[name];
  const got = parent && C.MONKEY_SKELETON_JOINTS.includes(parent.getName()) ? parent.getName() : null;
  if (got !== want) throw new Error(`hierarchy: ${name} parent ${got}, contract ${want}`);
}

// bind-space joint positions (world * IBM = identity on this file, verified in the audit)
const J = (name) => new THREE.Vector3().fromArray(new THREE.Matrix4().fromArray(byContract.get(name).node.getWorldMatrix()).elements, 12);
const jY = (n) => J(n).y;
const CX = (J("LeftUpLeg").x + J("RightUpLeg").x) / 2;

// =====================================================================================================
// 2. WEIGHT REPAIR + BODY REGIONS
// =====================================================================================================
const prim = root.listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute("POSITION").getArray();
const N = prim.getAttribute("NORMAL").getArray();
const JO = prim.getAttribute("JOINTS_0").getArray();
const WO = prim.getAttribute("WEIGHTS_0").getArray();
const IDX = prim.getIndices().getArray();
const nv = P.length / 3;
const JI = Object.fromEntries(C.MONKEY_SKELETON_JOINTS.map((n, i) => [n, i]));

// welded smooth normals (UV seams split vertices; an offset shell must not crack along them)
const weldKey = (i) => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
const rep = new Int32Array(nv); { const m = new Map(); for (let i = 0; i < nv; i++) { const k = weldKey(i); if (!m.has(k)) m.set(k, i); rep[i] = m.get(k); } }
const sn = new Float32Array(nv * 3);
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) sn[rep[i] * 3 + k] += N[i * 3 + k];
for (let i = 0; i < nv; i++) { const r = rep[i]; if (r !== i) continue; const l = Math.hypot(sn[r * 3], sn[r * 3 + 1], sn[r * 3 + 2]) || 1; for (let k = 0; k < 3; k++) sn[r * 3 + k] /= l; }
const normalOf = (i) => [sn[rep[i] * 3], sn[rep[i] * 3 + 1], sn[rep[i] * 3 + 2]];

const SPINE_STOPS = [[jY("Hips"), "Hips"], [jY("Spine02"), "Spine02"], [jY("Spine01"), "Spine01"], [jY("Spine"), "Spine"]];
const KNEE = (jY("LeftLeg") + jY("RightLeg")) / 2;
const ARM_CHAIN = new Set(["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand"]);
const HEADS = new Set(["Head", "head_end", "headfront"]);

function spineChain(y, w, out) {
  if (y <= SPINE_STOPS[0][0]) { out.Hips = (out.Hips ?? 0) + w; return; }
  for (let k = 1; k < SPINE_STOPS.length; k++) {
    const [y1, b1] = SPINE_STOPS[k], [y0, b0] = SPINE_STOPS[k - 1];
    if (y <= y1) { const t = (y - y0) / (y1 - y0); out[b0] = (out[b0] ?? 0) + w * (1 - t); out[b1] = (out[b1] ?? 0) + w * t; return; }
  }
  out.Spine = (out.Spine ?? 0) + w;
}

const newJ = new Uint8Array(nv * 4), newW = new Float32Array(nv * 4), region = new Float32Array(nv);
const stats = { tail: 0, arm: 0, head: 0, foot: 0, body: 0, neck: 0 };
const eyeR = (x, y, side) => Math.hypot((x - side * L.eye.cx) / L.eye.rx, (y - L.eye.cy) / L.eye.ry);
const RC = C.REGION_CUTS;
const armRegion = (xr, S) => (Math.abs(xr) < RC.upperArmX ? R[`UPPERARM${S}`] : Math.abs(xr) < RC.wristX ? R[`FOREARM${S}`] : R[`HAND${S}`]);
const neckE = (xr, z) => Math.hypot(xr / RC.neck.rx, (z - RC.neck.cz) / RC.neck.rz);
const mouthR = (x, y) => Math.hypot((x - L.mouth.cx) / 0.1, (y - (L.mouth.cy - 0.012)) / 0.065);

for (let i = 0; i < nv; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  const xr = x - CX, side = xr >= 0 ? "Left" : "Right", S = side === "Left" ? "_L" : "_R";
  // original dominant joint, under contract names
  let best = 0; for (let k = 1; k < 4; k++) if (WO[i * 4 + k] > WO[i * 4 + best]) best = k;
  const dom = C.MONKEY_SKELETON_JOINTS[oldToNew[JO[i * 4 + best]]];
  const w = {};
  let reg;
  const inNeckEllipse = (xr / 0.25) ** 2 + ((z + 0.03) / 0.2) ** 2 < 1;

  if (y > 0.18 && y < 0.58 && (z < L.tailZ || xr > L.tailX)) {
    // TAIL — rigid to the pelvis (it used to swing with an average of both thighs)
    w.Hips = 1; reg = R.TAIL; stats.tail++;
  } else if (ARM_CHAIN.has(dom)) {
    // ARMS keep their own (measured-correct) weights, stripped of any head/leg influence
    for (let k = 0; k < 4; k++) {
      const b = C.MONKEY_SKELETON_JOINTS[oldToNew[JO[i * 4 + k]]], ww = WO[i * 4 + k];
      if (ww > 0 && (ARM_CHAIN.has(b) || b === "Spine")) w[b] = (w[b] ?? 0) + ww;
    }
    if (!Object.keys(w).length) w.Spine = 1;
    reg = armRegion(xr, S);
    stats.arm++;
  } else if (HEADS.has(dom) && !(y < 0.785 || (y < 0.8 && inNeckEllipse) || (y < 0.86 && normalOf(i)[1] > 0.1))) {
    // HEAD (incl. ears, eyes, tuft) — rigid to Head
    w.Head = 1; stats.head++;
    reg = R.HEAD;
    if (y > L.tuftY) reg = R.TUFT;
    else if (Math.abs(xr) > L.ears.xMin && y > L.ears.yMin - 0.02 && y < L.ears.yMax + 0.02) reg = R.EARS;
    else if (z > 0.2 && eyeR(x, y, 1) <= 1.0) reg = R.EYE_L;
    else if (z > 0.2 && eyeR(x, y, -1) <= 1.0) reg = R.EYE_R;
    else if (z > 0.3 && mouthR(x, y) <= 1.0) reg = R.MOUTH;
  } else if (y < 0.13) {
    // FEET — ankle blend into the shin, toe hinge by depth
    const foot = 1 - smooth(0.085, 0.13, y), toe = smooth(0.075, 0.135, z);
    w[`${side}Foot`] = foot * (1 - toe); w[`${side}ToeBase`] = foot * toe; w[`${side}Leg`] = 1 - foot;
    reg = R[`FOOT${S}`]; stats.foot++;
  } else {
    // BODY: legs, torso, neck — the part the master had wrong
    const lat = 1 - (1 - smooth(0.01, 0.07, Math.abs(xr))) * smooth(0.22, 0.28, y);
    const legTotal = (1 - smooth(0.25, 0.37, y)) * lat;
    const shin = 1 - smooth(KNEE - 0.03, KNEE + 0.04, y);
    if (legTotal > 0) { w[`${side}Leg`] = legTotal * shin; w[`${side}UpLeg`] = legTotal * (1 - shin); }
    const torso = 1 - legTotal;
    if (y >= 0.735 && neckE(xr, z) >= 1) {
      // shoulder tops beside the neck (the master bound these to Head): chest -> arm
      const a = smooth(0.2, 0.3, Math.abs(xr));
      w.Spine = (w.Spine ?? 0) + torso * (1 - a);
      w[`${side}Arm`] = (w[`${side}Arm`] ?? 0) + torso * a;
      stats.body++;
    } else if (y >= 0.735) {
      // neck band: chest -> neck -> head
      const tN = smooth(0.735, 0.775, y), tH = smooth(0.775, 0.8, y);
      w.Spine = (w.Spine ?? 0) + torso * (1 - tN);
      w.neck = (w.neck ?? 0) + torso * tN * (1 - tH);
      w.Head = (w.Head ?? 0) + torso * tN * tH;
      stats.neck++;
    } else {
      spineChain(y, torso, w);
      stats.body++;
    }
    // REGIONS are geometric (REGION_CUTS), independent of the weights, so their edges are clean lines
    reg = legTotal > 0.5 ? R[`LEG${S}`]
      : y > RC.neck.y && neckE(xr, z) < 1 ? R.NECK
      : y >= RC.chestY && Math.abs(xr) >= RC.upperArmX ? armRegion(xr, S)
      : y >= RC.chestY ? R.CHEST : y >= RC.waistY ? R.BELLY : R.PELVIS;
  }
  // top-4, normalised
  const e = Object.entries(w).filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = e.reduce((s, [, v]) => s + v, 0);
  e.forEach(([b, v], k) => { newJ[i * 4 + k] = JI[b]; newW[i * 4 + k] = v / sum; });
  region[i] = reg;
}
// JUNCTION SMOOTHING — where the master's own arm weights meet the rebuilt torso/neck weights (armpit,
// shoulder tops, the head's underside resting on them) the hand-off is a step, which tears on any arm
// motion. A few Jacobi passes of neighbour-averaging over the welded mesh, in that band only.
const smoothStats = (() => {
  const adj = new Map();
  const link = (a, b) => { (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(b); };
  for (let t = 0; t < IDX.length; t += 3) { const a = rep[IDX[t]], b = rep[IDX[t + 1]], c = rep[IDX[t + 2]]; link(a, b); link(b, a); link(b, c); link(c, b); link(a, c); link(c, a); }
  const FIXED = new Set([R.TUFT, R.EARS, R.EYE_L, R.EYE_R, R.MOUTH, R.TAIL, R.HAND_L, R.HAND_R, R.FOOT_L, R.FOOT_R, R.LEG_L, R.LEG_R]);
  const band = [...adj.keys()].filter((r) => { const y = P[r * 3 + 1]; return y > 0.55 && y < 0.87 && Math.abs(P[r * 3] - CX) < 0.36 && !FIXED.has(region[r]); });
  const get = (r) => { const m = new Map(); for (let k = 0; k < 4; k++) if (newW[r * 4 + k] > 0) m.set(newJ[r * 4 + k], newW[r * 4 + k]); return m; };
  let cur = new Map([...adj.keys()].map((r) => [r, get(r)]));
  for (let it = 0; it < 6; it++) {
    const next = new Map(cur);
    for (const r of band) {
      const acc = new Map(); const nb = adj.get(r);
      for (const [j, w] of cur.get(r)) acc.set(j, w * 0.5);
      for (const q of nb) for (const [j, w] of cur.get(q)) acc.set(j, (acc.get(j) ?? 0) + (w * 0.5) / nb.size);
      next.set(r, acc);
    }
    cur = next;
  }
  const bandSet = new Set(band);
  for (let i = 0; i < nv; i++) {
    const r = rep[i]; if (!bandSet.has(r)) continue;
    const top = [...cur.get(r)].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s2, [, w]) => s2 + w, 0);
    for (let k = 0; k < 4; k++) { newJ[i * 4 + k] = top[k]?.[0] ?? 0; newW[i * 4 + k] = top[k] ? top[k][1] / sum : 0; }
  }
  return { band: band.length };
})();
prim.getAttribute("JOINTS_0").setArray(newJ);
prim.getAttribute("WEIGHTS_0").setArray(newW);
const regionAcc = doc.createAccessor("region").setType("SCALAR").setArray(region).setBuffer(root.listBuffers()[0]);
prim.setAttribute("_REGION", regionAcc);

// =====================================================================================================
// 4. CLIPS — the employee contract clips, retargeted from Bon onto the monkey's OWN bind by world-space
//    rotation deltas (the two binds have different bone axes), hips translation scaled by hip height.
//    One correction: ARM CLEARANCE. The chibi belly is wider than the shoulders, so an employee idle
//    with arms at the sides would bury the hands in it; the whole arm chain is swung out to a minimum
//    abduction, measured per frame from the monkey's own upper-arm direction.
// =====================================================================================================
const src = await io.read(CLIP_SOURCE);
const sNodes = new Map(src.getRoot().listNodes().map((n) => [n.getName(), n]));
const parentOf = (d) => { const m = new Map(); for (const n of d.getRoot().listNodes()) for (const c of n.listChildren()) m.set(c, n); return m; };
const sParent = parentOf(src), tParent = parentOf(doc);
const wq = (node) => { const m = new THREE.Matrix4().fromArray(node.getWorldMatrix()); const q = new THREE.Quaternion(); m.decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q; };
const wp = (node) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
const tNodes = new Map(C.MONKEY_SKELETON_JOINTS.map((n) => [n, byContract.get(n).node]));
const sBindQ = new Map(), tBindQ = new Map();
for (const n of C.MONKEY_SKELETON_JOINTS) { sBindQ.set(n, wq(sNodes.get(n))); tBindQ.set(n, wq(tNodes.get(n))); }
const sRootQ = wq(sParent.get(sNodes.get("Hips"))), tRootQ = wq(tParent.get(tNodes.get("Hips")));
const sHipBind = wp(sNodes.get("Hips")), tHipLocal = new THREE.Vector3().fromArray(tNodes.get("Hips").getTranslation());
const sRootMat = new THREE.Matrix4().fromArray(sParent.get(sNodes.get("Hips")).getWorldMatrix());
const HIP_K = jY("Hips") / sHipBind.y;
const ORDER = [...C.MONKEY_SKELETON_JOINTS].sort((a, b) => depth(a) - depth(b));
function depth(n) { let d = 0; for (let p = C.MONKEY_SKELETON_PARENTS[n]; p; p = C.MONKEY_SKELETON_PARENTS[p]) d++; return d; }
const ARM_MIN_ABDUCTION = (36 * Math.PI) / 180;
const armDirLocal = {
  Left: new THREE.Vector3().fromArray(tNodes.get("LeftForeArm").getTranslation()).normalize(),
  Right: new THREE.Vector3().fromArray(tNodes.get("RightForeArm").getTranslation()).normalize(),
};

function sample(sampler, t, out) {
  const inp = sampler.getInput().getArray(), o = sampler.getOutput().getArray(), sz = sampler.getOutput().getElementSize();
  let k = 0; while (k < inp.length - 2 && inp[k + 1] <= t) k++;
  const t0 = inp[k], t1 = inp[Math.min(k + 1, inp.length - 1)], u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  if (sz === 4) { const a = new THREE.Quaternion().fromArray(o, k * 4), b = new THREE.Quaternion().fromArray(o, Math.min(k + 1, inp.length - 1) * 4); return out.copy(a).slerp(b, sampler.getInterpolation() === "STEP" ? 0 : u); }
  const a = new THREE.Vector3().fromArray(o, k * 3), b = new THREE.Vector3().fromArray(o, Math.min(k + 1, inp.length - 1) * 3);
  return out.copy(a).lerp(b, sampler.getInterpolation() === "STEP" ? 0 : u);
}

const buf = root.listBuffers()[0];
const clipReport = [];
for (const anim of src.getRoot().listAnimations()) {
  const name = anim.getName();
  if (!C.MONKEY_CLIP_CONTRACT.includes(name)) continue;
  const rot = new Map(), tr = new Map();
  let times = null;
  for (const ch of anim.listChannels()) {
    const n = ch.getTargetNode()?.getName(); if (!tNodes.has(n)) continue;
    if (ch.getTargetPath() === "rotation") rot.set(n, ch.getSampler());
    if (ch.getTargetPath() === "translation" && n === "Hips") tr.set(n, ch.getSampler());
    const inp = ch.getSampler().getInput().getArray(); if (!times || inp.length > times.length) times = inp;
  }
  const F = times.length;
  const outQ = new Map(C.MONKEY_SKELETON_JOINTS.map((n) => [n, new Float32Array(F * 4)]));
  const outHip = new Float32Array(F * 3);
  let minAbd = Infinity, corrected = 0;
  for (let f = 0; f < F; f++) {
    const t = times[f];
    const sW = new Map(), tW = new Map();
    for (const n of ORDER) {
      const local = rot.has(n) ? sample(rot.get(n), t, new THREE.Quaternion()) : new THREE.Quaternion().fromArray(sNodes.get(n).getRotation());
      const parent = C.MONKEY_SKELETON_PARENTS[n];
      sW.set(n, (parent ? sW.get(parent).clone() : sRootQ.clone()).multiply(local));
      const delta = sW.get(n).clone().multiply(sBindQ.get(n).clone().invert());
      tW.set(n, delta.multiply(tBindQ.get(n)));
    }
    for (const side of ["Left", "Right"]) {
      const s = side === "Left" ? 1 : -1;
      const d = armDirLocal[side].clone().applyQuaternion(tW.get(`${side}Arm`));
      const abd = Math.atan2(d.x * s, -d.y);
      minAbd = Math.min(minAbd, abd);
      if (abd < ARM_MIN_ABDUCTION) {
        const fix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * (ARM_MIN_ABDUCTION - abd));
        for (const b of ["Arm", "ForeArm", "Hand"]) tW.set(`${side}${b}`, fix.clone().multiply(tW.get(`${side}${b}`)));
        corrected++;
      }
    }
    for (const n of ORDER) {
      const parent = C.MONKEY_SKELETON_PARENTS[n];
      const local = (parent ? tW.get(parent) : tRootQ).clone().invert().multiply(tW.get(n));
      local.toArray(outQ.get(n), f * 4);
    }
    const hp = tr.has("Hips") ? sample(tr.get("Hips"), t, new THREE.Vector3()).applyMatrix4(sRootMat) : sHipBind.clone();
    tHipLocal.clone().addScaledVector(hp.sub(sHipBind), HIP_K).toArray(outHip, f * 3);
  }
  const input = doc.createAccessor(`${name}-t`).setType("SCALAR").setArray(new Float32Array(times)).setBuffer(buf);
  const a = doc.createAnimation(name);
  for (const n of C.MONKEY_SKELETON_JOINTS) {
    const s = doc.createAnimationSampler().setInput(input).setInterpolation("LINEAR")
      .setOutput(doc.createAccessor().setType("VEC4").setArray(outQ.get(n)).setBuffer(buf));
    a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(tNodes.get(n)).setTargetPath("rotation").setSampler(s));
  }
  const hs = doc.createAnimationSampler().setInput(input).setInterpolation("LINEAR")
    .setOutput(doc.createAccessor().setType("VEC3").setArray(outHip).setBuffer(buf));
  a.addSampler(hs).addChannel(doc.createAnimationChannel().setTargetNode(tNodes.get("Hips")).setTargetPath("translation").setSampler(hs));
  clipReport.push(`${name} ${F}f ${times[F - 1].toFixed(2)}s minAbduction ${((minAbd * 180) / Math.PI).toFixed(1)}° armFix ${corrected}`);
}

// =====================================================================================================
// 5. GARMENTS — built against the locked base, each a separate skinned GLB on the same skeleton.
//    BODY GARMENTS: coverage is an ANALYTIC function in bind space (cut lines = REGION_CUTS pushed out
//    by GARMENT_COVER_MARGIN), the body shell is CLIPPED at its zero level (clean hems, not a triangle
//    staircase), offset along smooth normals, weighted by NEAREST-BODY-VERTEX transfer (the generic step
//    any imported garment goes through; Head influence folded into neck), and simplified SKINNING-AWARE
//    with the trim band locked. The cut terms are baked separately (`_COVER` vec3) for per-fragment trim.
//    A garment may only open onto regions it does NOT hide — an opening over a hidden region would be a
//    see-through hole — which is why there is no V-neck here.
//    HEADWEAR (the cap): an offset of the head shell above the brim line with the tuft flattened into the
//    crown, rigid to Head, hiding TUFT.
// =====================================================================================================
const M = C.GARMENT_COVER_MARGIN;
const COLLAR = { rx: RC.neck.rx - M, rz: RC.neck.rz - M };
const TRIM_F = -0.022;
const NEVER = new Set([R.HEAD, R.TUFT, R.EARS, R.EYE_L, R.EYE_R, R.MOUTH, R.TAIL]);
const HEADISH = new Set([R.HEAD, R.TUFT, R.EARS, R.EYE_L, R.EYE_R, R.MOUTH]);
const HEAD_J = new Set([JI.Head, JI.head_end, JI.headfront]);
await MeshoptSimplifier.ready;
// nearest-body-vertex search (uniform grid over the body's non-head bind positions)
const CELL = 0.03, grid = new Map();
for (let i = 0; i < nv; i++) { if (rep[i] !== i || HEADISH.has(region[i])) continue; const k = `${Math.floor(P[i * 3] / CELL)},${Math.floor(P[i * 3 + 1] / CELL)},${Math.floor(P[i * 3 + 2] / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
const nearest = (x, y, z) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL); let best = -1, bd = Infinity;
  for (let r = 0; r < 4 && best < 0; r++) for (let a2 = -r; a2 <= r; a2++) for (let b2 = -r; b2 <= r; b2++) for (let c2 = -r; c2 <= r; c2++) {
    if (Math.max(Math.abs(a2), Math.abs(b2), Math.abs(c2)) !== r) continue;
    for (const q of grid.get(`${cx + a2},${cy + b2},${cz + c2}`) ?? []) { const d = (P[q * 3] - x) ** 2 + (P[q * 3 + 1] - y) ** 2 + (P[q * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = q; } }
  }
  return best;
};
const collarTerm = (xr, y, z) => (y > RC.neck.y - 0.06 ? (1 - Math.hypot(xr / COLLAR.rx, (z - RC.neck.cz) / COLLAR.rz)) * COLLAR.rz : -0.2);
const BODY_GARMENTS = [
  { id: "tee", hides: ["CHEST", "BELLY", "UPPERARM_L", "UPPERARM_R"], sleeveX: RC.upperArmX + M,
    look: { main: "#2f6f8f", trim: "#f2efe6", trimCover: TRIM_F } },
  { id: "longsleeve", hides: ["CHEST", "BELLY", "UPPERARM_L", "UPPERARM_R", "FOREARM_L", "FOREARM_R"], sleeveX: RC.wristX + M,
    look: { main: "#e8735a", trim: "#f6efe4", trimCover: TRIM_F } },
  // a vest over a shirt: the body panel and the sleeve panel are two colours, split on the sleeve term
  { id: "vest", hides: ["CHEST", "BELLY", "UPPERARM_L", "UPPERARM_R"], sleeveX: RC.upperArmX + M,
    look: { main: "#2c3e66", trim: "#f2c14e", trimCover: TRIM_F, panel: "#cfd3da", panelFrom: -0.13 } },
];

function writeGarmentDoc(id, slot, hides, look, geo) {
  const g = new Document(); const gb = g.createBuffer();
  const gNodes = new Map();
  for (const n of C.MONKEY_SKELETON_JOINTS) { const s2 = tNodes.get(n); gNodes.set(n, g.createNode(n).setTranslation(s2.getTranslation()).setRotation(s2.getRotation()).setScale(s2.getScale())); }
  for (const n of C.MONKEY_SKELETON_JOINTS) { const p2 = C.MONKEY_SKELETON_PARENTS[n]; if (p2) gNodes.get(p2).addChild(gNodes.get(n)); }
  const gSkin = g.createSkin("monkey-agent").setInverseBindMatrices(g.createAccessor().setType("MAT4").setArray(ibmArr.slice()).setBuffer(gb));
  for (const n of C.MONKEY_SKELETON_JOINTS) gSkin.addJoint(gNodes.get(n));
  const gGeo = new THREE.BufferGeometry(); gGeo.setAttribute("position", new THREE.BufferAttribute(geo.pos, 3)); gGeo.setIndex(new THREE.BufferAttribute(geo.idx, 1)); gGeo.computeVertexNormals();
  const prim2 = g.createPrimitive()
    .setAttribute("POSITION", g.createAccessor().setType("VEC3").setArray(geo.pos).setBuffer(gb))
    .setAttribute("NORMAL", g.createAccessor().setType("VEC3").setArray(gGeo.getAttribute("normal").array).setBuffer(gb))
    .setAttribute("_COVER", g.createAccessor().setType("VEC3").setArray(geo.cover).setBuffer(gb))
    .setAttribute("JOINTS_0", g.createAccessor().setType("VEC4").setArray(geo.j).setBuffer(gb))
    .setAttribute("WEIGHTS_0", g.createAccessor().setType("VEC4").setArray(geo.w).setBuffer(gb))
    .setIndices(g.createAccessor().setType("SCALAR").setArray(geo.idx).setBuffer(gb))
    .setMaterial(g.createMaterial(`garment-${id}`).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0).setDoubleSided(true));
  const node = g.createNode(`garment_${id}`).setMesh(g.createMesh(`garment_${id}`).addPrimitive(prim2)).setSkin(gSkin)
    .setExtras({ monkeyGarment: { id, slot, hides, look } });
  g.createScene("garment").addChild(gNodes.get("Hips")).addChild(node);
  return g;
}

function buildBodyGarment(spec) {
  const OFF = 0.016;
  const terms = (x, y, z) => { const xr = x - CX; return [RC.waistY - M - y, Math.abs(xr) - spec.sleeveX, collarTerm(xr, y, z)]; };
  const fOf = (i) => Math.max(...terms(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  const pos = [], fval = [], idx = [], byRep = new Map(), byEdge = new Map();
  const push = (p, n) => { const k = pos.length / 3; pos.push(p[0] + n[0] * OFF, p[1] + n[1] * OFF, p[2] + n[2] * OFF); fval.push(...terms(p[0], p[1], p[2])); return k; };
  const corner = (i) => { const r = rep[i]; if (!byRep.has(r)) byRep.set(r, push([P[r * 3], P[r * 3 + 1], P[r * 3 + 2]], normalOf(i))); return byRep.get(r); };
  const cut = (a, b) => {
    const ra = rep[a], rb = rep[b], key = ra < rb ? `${ra},${rb}` : `${rb},${ra}`;
    if (byEdge.has(key)) return byEdge.get(key);
    const fa = fOf(ra), fb = fOf(rb), t = fa / (fa - fb);
    const na = normalOf(a), nb = normalOf(b), n = [0, 1, 2].map((k) => na[k] + (nb[k] - na[k]) * t), l = Math.hypot(...n) || 1;
    const k = push([0, 1, 2].map((c) => P[ra * 3 + c] + (P[rb * 3 + c] - P[ra * 3 + c]) * t), n.map((v) => v / l));
    byEdge.set(key, k); return k;
  };
  for (let t = 0; t < IDX.length; t += 3) {
    const v = [IDX[t], IDX[t + 1], IDX[t + 2]];
    if (v.some((i) => NEVER.has(region[i]))) continue;
    const f = v.map((i) => fOf(rep[i]));
    if (f.every((x) => x > 0)) continue;
    const poly = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3], fa = f[k], fb = f[(k + 1) % 3];
      if (fa <= 0) poly.push(corner(a));
      if ((fa <= 0) !== (fb <= 0)) poly.push(cut(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0], poly[k], poly[k + 1]);
  }
  const tpos = new Float32Array(pos), tf = new Float32Array(fval), tidx = new Uint32Array(idx), tn = tpos.length / 3;
  const tJ = new Uint8Array(tn * 4), tW = new Float32Array(tn * 4);
  for (let v = 0; v < tn; v++) {
    const q = nearest(tpos[v * 3], tpos[v * 3 + 1], tpos[v * 3 + 2]);
    const acc = new Map(); for (let k = 0; k < 4; k++) { const jj = HEAD_J.has(newJ[q * 4 + k]) ? JI.neck : newJ[q * 4 + k]; if (newW[q * 4 + k] > 0) acc.set(jj, (acc.get(jj) ?? 0) + newW[q * 4 + k]); }
    [...acc].sort((a2, b2) => b2[1] - a2[1]).slice(0, 4).forEach(([jj, w2], k) => { tJ[v * 4 + k] = jj; tW[v * 4 + k] = w2; });
  }
  const WJ = ["Hips", "Spine02", "Spine01", "Spine", "neck", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand"].map((n) => JI[n]);
  const tAttr = new Float32Array(tn * WJ.length);
  for (let v = 0; v < tn; v++) for (let k = 0; k < 4; k++) { const c = WJ.indexOf(tJ[v * 4 + k]); if (c >= 0) tAttr[v * WJ.length + c] += tW[v * 4 + k]; }
  // no lock needed for the trim: the hem/sleeve terms are planes, so they interpolate exactly on any
  // triangulation; LockBorder keeps the hem line itself
  const [sIdx] = MeshoptSimplifier.simplifyWithAttributes(tidx, tpos, 3, tAttr, WJ.length, WJ.map(() => 0.5), null,
    C.MONKEY_BUDGETS.garmentPerAgent * 3, 0.006, ["LockBorder"]);
  const remap = new Map(), cpos = [], cf = [], cJ = [], cW = [], cidx = new Uint32Array(sIdx.length);
  sIdx.forEach((v, k) => {
    if (!remap.has(v)) { remap.set(v, cpos.length / 3); cpos.push(tpos[v * 3], tpos[v * 3 + 1], tpos[v * 3 + 2]); cf.push(tf[v * 3], tf[v * 3 + 1], tf[v * 3 + 2]); for (let q = 0; q < 4; q++) { cJ.push(tJ[v * 4 + q]); cW.push(tW[v * 4 + q]); } }
    cidx[k] = remap.get(v);
  });
  return { raw: tidx.length / 3, geo: { pos: new Float32Array(cpos), cover: new Float32Array(cf), j: new Uint8Array(cJ), w: new Float32Array(cW), idx: cidx } };
}

/** THE CAP: offset of the head shell CLIPPED at the brim line (clean edge, like the body garments), the
 *  tuft flattened into the crown, plus a visor. Rigid to Head; hides TUFT. */
function buildCap() {
  const BRIM_Y = 1.3, CROWN_Y = 1.455, OFF = 0.022;
  const capOk = (i) => region[i] === R.HEAD || region[i] === R.TUFT;
  const fOf = (r) => BRIM_Y - P[r * 3 + 1];
  const pos = [], cover = [], idx = [], byRep = new Map(), byEdge = new Map();
  const place = (p, n, f) => { const k = pos.length / 3; pos.push(p[0] + n[0] * OFF, p[1] + n[1] * OFF, p[2] + n[2] * OFF); cover.push(f, -1, -1); return k; };
  const flat = (r, i) => { let p = [P[r * 3], P[r * 3 + 1], P[r * 3 + 2]], n = normalOf(i); if (region[r] === R.TUFT || p[1] > CROWN_Y) { p = [p[0], Math.min(p[1], CROWN_Y), p[2]]; n = [0, 1, 0]; } return { p, n }; };
  const corner = (i) => { const r = rep[i]; if (!byRep.has(r)) { const { p, n } = flat(r, i); byRep.set(r, place(p, n, fOf(r))); } return byRep.get(r); };
  const cut = (a, b) => {
    const ra = rep[a], rb = rep[b], key = ra < rb ? `${ra},${rb}` : `${rb},${ra}`;
    if (byEdge.has(key)) return byEdge.get(key);
    const fa = fOf(ra), fb = fOf(rb), t = fa / (fa - fb), A2 = flat(ra, a), B2 = flat(rb, b);
    const n = [0, 1, 2].map((k) => A2.n[k] + (B2.n[k] - A2.n[k]) * t), l = Math.hypot(...n) || 1;
    const k = place([0, 1, 2].map((c) => A2.p[c] + (B2.p[c] - A2.p[c]) * t), n.map((v) => v / l), 0);
    byEdge.set(key, k); return k;
  };
  for (let t = 0; t < IDX.length; t += 3) {
    const v = [IDX[t], IDX[t + 1], IDX[t + 2]];
    if (!v.every(capOk)) continue;
    const f = v.map((i) => fOf(rep[i]));
    if (f.every((x) => x > 0)) continue;
    const poly = [];
    for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3]; if (f[k] <= 0) poly.push(corner(a)); if ((f[k] <= 0) !== (f[(k + 1) % 3] <= 0)) poly.push(cut(a, b)); }
    for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0], poly[k], poly[k + 1]);
  }
  // VISOR: a curved sheet out of the front of the crown at the brim line, angled slightly down
  let rad = 0; for (let i = 0; i < nv; i++) if (Math.abs(P[i * 3 + 1] - BRIM_Y) < 0.012 && region[i] === R.HEAD && P[i * 3 + 2] > 0.15) rad = Math.max(rad, Math.hypot(P[i * 3] - CX, P[i * 3 + 2]));
  const ring = (rr, y, dz) => { const out = []; for (let k = 0; k <= 20; k++) { const a = -1.15 + (2.3 * k) / 20; out.push(pos.length / 3); pos.push(CX + Math.sin(a) * rr, y, Math.cos(a) * rr + dz); cover.push(-1, -1, -1); } return out; };
  const inner = ring(rad + OFF * 0.4, BRIM_Y + 0.004, -0.03), outer = ring(rad + 0.17, BRIM_Y - 0.04, 0.02);
  for (let k = 0; k < 20; k++) idx.push(inner[k], outer[k], inner[k + 1], inner[k + 1], outer[k], outer[k + 1]);
  const tidx = new Uint32Array(idx), P3 = new Float32Array(pos);
  const [sIdx] = MeshoptSimplifier.simplify(tidx, P3, 3, Math.min(1500 * 3, tidx.length), 0.004, ["LockBorder"]);
  const remap = new Map(), cpos = [], cf = [], cidx = new Uint32Array(sIdx.length);
  sIdx.forEach((v, k) => { if (!remap.has(v)) { remap.set(v, cpos.length / 3); cpos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); cf.push(cover[v * 3], cover[v * 3 + 1], cover[v * 3 + 2]); } cidx[k] = remap.get(v); });
  const cn = cpos.length / 3, cj = new Uint8Array(cn * 4), cw = new Float32Array(cn * 4); for (let v = 0; v < cn; v++) { cj[v * 4] = JI.Head; cw[v * 4] = 1; }
  return { raw: tidx.length / 3, geo: { pos: new Float32Array(cpos), cover: new Float32Array(cf), j: cj, w: cw, idx: cidx } };
}

const garmentDocs = [];
for (const spec of BODY_GARMENTS) {
  const { raw, geo } = buildBodyGarment(spec);
  garmentDocs.push({ id: spec.id, raw, tris: geo.idx.length / 3, doc: writeGarmentDoc(spec.id, "top", spec.hides, spec.look, geo) });
}
{
  const { raw, geo } = buildCap();
  garmentDocs.push({ id: "cap", raw, tris: geo.idx.length / 3, doc: writeGarmentDoc("cap", "head", ["TUFT"], { main: "#d8483a", trim: "#d8483a", trimCover: TRIM_F }, geo) });
}

// =====================================================================================================
// 5b. REGION SEAMS — split body triangles that straddle a REGION_CUTS line, duplicating the seam
//     vertices per side, so every triangle belongs to exactly ONE region and garment hiding is exact
//     (a per-vertex mask on a long triangle would discard up to its midpoint). This is the proof's
//     stand-in for the clean edge loops the production base must be modelled with.
// =====================================================================================================
const SEAMS = [
  ...["_L", "_R"].flatMap((S) => [
    { a: R[`UPPERARM${S}`], b: R[`FOREARM${S}`], f: (x) => Math.abs(x[0] - CX) - RC.upperArmX },
    { a: R[`FOREARM${S}`], b: R[`HAND${S}`], f: (x) => Math.abs(x[0] - CX) - RC.wristX },
  ]),
  { a: R.PELVIS, b: R.BELLY, f: (x) => x[1] - RC.waistY },
  { a: R.BELLY, b: R.CHEST, f: (x) => x[1] - RC.chestY },
  { a: R.NECK, b: R.CHEST, f: (x) => Math.max(RC.neck.y - x[1], neckE(x[0] - CX, x[2]) - 1) },
];
const seamStats = (() => {
  const TAN = prim.getAttribute("TANGENT")?.getArray(), UV0 = prim.getAttribute("TEXCOORD_0").getArray();
  const out = { pos: [], nor: [], tan: [], uv: [], j: [], w: [], reg: [] }, idx = [], keyed = new Map();
  const emit = (key, vtx) => {
    if (keyed.has(key)) return keyed.get(key);
    const k = out.reg.length; keyed.set(key, k);
    out.pos.push(...vtx.p); out.nor.push(...vtx.n); if (TAN) out.tan.push(...vtx.t); out.uv.push(...vtx.uv); out.j.push(...vtx.j); out.w.push(...vtx.w); out.reg.push(vtx.r);
    return k;
  };
  const orig = (i, r) => ({
    p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], n: [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]],
    t: TAN ? [TAN[i * 4], TAN[i * 4 + 1], TAN[i * 4 + 2], TAN[i * 4 + 3]] : null, uv: [UV0[i * 2], UV0[i * 2 + 1]],
    j: [...newJ.slice(i * 4, i * 4 + 4)], w: [...newW.slice(i * 4, i * 4 + 4)], r,
  });
  const mix = (A, B, t, r) => {
    const l = (a, b) => a.map((v, k) => v + (b[k] - v) * t);
    const n = l(A.n, B.n), nl = Math.hypot(...n) || 1;
    const acc = new Map(); for (const [V, f] of [[A, 1 - t], [B, t]]) V.j.forEach((jj, k) => { if (V.w[k] > 0) acc.set(jj, (acc.get(jj) ?? 0) + V.w[k] * f); });
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s2, [, v]) => s2 + v, 0);
    const j = [0, 0, 0, 0], w = [0, 0, 0, 0]; top.forEach(([jj, v], k) => { j[k] = jj; w[k] = v / sum; });
    let tt = null; if (A.t) { tt = l(A.t, B.t); const tl = Math.hypot(tt[0], tt[1], tt[2]) || 1; tt = [tt[0] / tl, tt[1] / tl, tt[2] / tl, A.t[3]]; }
    return { p: l(A.p, B.p), n: n.map((v) => v / nl), t: tt, uv: l(A.uv, B.uv), j, w, r };
  };
  let split = 0;
  for (let t = 0; t < IDX.length; t += 3) {
    const v = [IDX[t], IDX[t + 1], IDX[t + 2]], rs = v.map((i) => region[i]);
    const seam = rs[0] === rs[1] && rs[1] === rs[2] ? null : SEAMS.find((sm) => rs.every((r) => r === sm.a || r === sm.b));
    if (!seam) { for (const i of v) idx.push(emit(`v${i}`, orig(i, region[i]))); continue; }
    split++;
    const V = v.map((i) => orig(i, region[i])), F = V.map((x) => seam.f(x.p));
    // two pieces: the a-side (f < 0) and the b-side (f >= 0)
    for (const [want, r] of [[true, seam.a], [false, seam.b]]) {
      const poly = [];
      for (let k = 0; k < 3; k++) {
        const k2 = (k + 1) % 3, inA = F[k] < 0, inB = F[k2] < 0;
        if (inA === want) poly.push(emit(`v${v[k]}|${r}`, { ...V[k], r }));
        if (inA !== inB) {
          const lo = Math.min(v[k], v[k2]), hi = Math.max(v[k], v[k2]), tt = F[k] / (F[k] - F[k2]);
          const [A, B, t2] = v[k] < v[k2] ? [V[k], V[k2], tt] : [V[k2], V[k], 1 - tt];
          poly.push(emit(`e${lo}-${hi}|${r}`, mix(A, B, t2, r)));
        }
      }
      for (let k = 1; k + 1 < poly.length; k++) idx.push(poly[0], poly[k], poly[k + 1]);
    }
  }
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  prim.setAttribute("POSITION", acc("VEC3", new Float32Array(out.pos))).setAttribute("NORMAL", acc("VEC3", new Float32Array(out.nor)))
    .setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array(out.uv))).setAttribute("JOINTS_0", acc("VEC4", new Uint8Array(out.j)))
    .setAttribute("WEIGHTS_0", acc("VEC4", new Float32Array(out.w))).setAttribute("_REGION", acc("SCALAR", new Float32Array(out.reg)))
    .setIndices(acc("SCALAR", new Uint32Array(idx)));
  if (TAN) prim.setAttribute("TANGENT", acc("VEC4", new Float32Array(out.tan)));
  return { split, verts: out.reg.length, tris: idx.length / 3 };
})();

// =====================================================================================================
// 6. WRITE + REPORT (intermediates: stage 2, build-monkey-base.mjs, makes the shipped LODs from these)
// =====================================================================================================
fs.mkdirSync(OUT_DIR, { recursive: true });
// keepAttributes: the custom _REGION attribute is not sampled by any glTF material, and the default
// prune would strip it
await doc.transform(prune({ keepAttributes: true, keepLeaves: true }));
await io.write(`${OUT_DIR}/monkey-agent-fullres.glb`, doc);
for (const gd of garmentDocs) await io.write(`${OUT_DIR}/garment-${gd.id}.glb`, gd.doc);
const dominantBy = {}; for (let i = 0; i < nv; i++) { const b = C.MONKEY_SKELETON_JOINTS[newJ[i * 4]]; dominantBy[b] = (dominantBy[b] ?? 0) + 1; }
console.log("zones", JSON.stringify(stats), "junction smoothing", JSON.stringify(smoothStats), "seams", JSON.stringify(seamStats));
console.log("dominant", JSON.stringify(dominantBy));
for (const gd of garmentDocs) console.log("garment", gd.id, "tris raw", gd.raw, "->", gd.tris);
for (const r of clipReport) console.log("clip", r);
console.log("fullres", (fs.statSync(`${OUT_DIR}/monkey-agent-fullres.glb`).size / 1e6).toFixed(2), "MB");
