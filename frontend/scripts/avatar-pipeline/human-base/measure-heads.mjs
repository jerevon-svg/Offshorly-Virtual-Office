// measure-heads.mjs — HEAD ENVELOPE MEASUREMENTS in base bind space (scene units; Head joint at y 0.786). READ-ONLY.
//
//   node scripts/avatar-pipeline/human-base/measure-heads.mjs [--json out.json]
//
// Measures production Alex's real head (the part build-human-base cut away), the HumanBase identity heads, and the
// neutral Alex-derived envelope if it has been built. Every number is taken the same way for every head:
//   crown/chin/occiput/front from the silhouette; WIDTH and DEPTH profiles in fixed fractions of crown→chin;
//   ears = the lateral bump below the cranium; head-to-body = head height / standing height (feet at the base's y 0).
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import * as THREE from "three";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const ALEX = "public/avatars/alex-v2-hq-idle9/alex-v2-lod0.glb";

/** all skinned/plain primitives of a GLB: positions (scene space), joints, weights, joint names, joint bind positions */
export async function readPrims(file, meshFilter = () => true) {
  const root = (await io.read(file)).getRoot(), out = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(), skin = node.getSkin(); if (!mesh || !meshFilter(mesh.getName())) continue;
    const names = skin ? skin.listJoints().map((j) => j.getName()) : [];
    const ibm = skin?.getInverseBindMatrices()?.getArray();
    const jp = Object.fromEntries(names.map((n, k) => [n, new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(ibm, k * 16).invert())]));
    for (const p of mesh.listPrimitives()) out.push({ mesh: mesh.getName(), P: p.getAttribute("POSITION").getArray(), J: p.getAttribute("JOINTS_0")?.getArray(), W: p.getAttribute("WEIGHTS_0")?.getArray(), I: p.getIndices()?.getArray(), names, jp, prim: p });
  }
  return out;
}

/** Alex's head vertices: exactly the set build-human-base.mjs removes (Head-weighted, outside the neck stub cylinder) */
export function alexHeadMask(pr) {
  const { P, J, W, names, jp } = pr, n = P.length / 3, m = new Uint8Array(n), HJ = new Set(["Head", "head_end", "headfront"].map((x) => names.indexOf(x)));
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let w = 0; for (let k = 0; k < 4; k++) if (HJ.has(J[i * 4 + k])) w += W[i * 4 + k];
    m[i] = y > 0.9 || (w > 0.5 && !(Math.hypot(x, z - jp.neck.z) < 0.085 && y < 0.86)) ? 1 : 0;
  }
  return m;
}

/** the shared measurement. pts: Float32Array xyz (head only). neckZ: the neck joint z. */
export function measure(pts, { neckZ = 0.019, head = new THREE.Vector3(0, 0.786, 0.017), exclude = null } = {}) {
  const n = pts.length / 3, X = (i) => pts[i * 3], Y = (i) => pts[i * 3 + 1], Z = (i) => pts[i * 3 + 2];
  const use = (i) => !exclude || !exclude[i];
  let crown = -9, crownZ = 0, zMax = -9, zMin = 9, occY = 0, noseY = 0;
  for (let i = 0; i < n; i++) if (use(i)) {
    if (Y(i) > crown) { crown = Y(i); crownZ = Z(i); }
    if (Z(i) > zMax) { zMax = Z(i); noseY = Y(i); }
    if (Z(i) < zMin) { zMin = Z(i); occY = Y(i); }
  }
  // chin: the lowest point well in front of the neck (the jaw underside meets the neck behind it)
  let chin = 9, chinZ = 0;
  for (let i = 0; i < n; i++) if (use(i) && Math.abs(X(i)) < 0.03 && Z(i) > neckZ + 0.09 && Y(i) < chin) { chin = Y(i); chinZ = Z(i); }
  const H = crown - chin;
  const at = (f) => crown - f * H;          // f = 0 crown … 1 chin
  const slab = (y, dy = 0.006) => { let wx = 0, zf = -9, zb = 9; for (let i = 0; i < n; i++) if (use(i) && Math.abs(Y(i) - y) < dy) { wx = Math.max(wx, Math.abs(X(i))); zf = Math.max(zf, Z(i)); zb = Math.min(zb, Z(i)); } return { w: 2 * wx, front: zf, back: zb, d: zf - zb }; };
  const F = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const profile = F.map((f) => ({ f, y: +at(f).toFixed(3), ...Object.fromEntries(Object.entries(slab(at(f))).map(([k, v]) => [k, +v.toFixed(3)])) }));
  // cranium: the widest slab above 45% (no ears); ears: the widest point below that, when it exceeds the cranium line
  let cran = { w: 0 }, cranY = 0; for (let f = 0.05; f <= 0.45; f += 0.01) { const s = slab(at(f)); if (s.w > cran.w) { cran = s; cranY = at(f); } }
  let ear = { w: 0 }, earY = 0; for (let f = 0.4; f <= 0.85; f += 0.01) { const s = slab(at(f)); if (s.w > ear.w) { ear = s; earY = at(f); } }
  let earZ = 0, best = 0; for (let i = 0; i < n; i++) if (use(i) && Math.abs(Y(i) - earY) < 0.006 && Math.abs(X(i)) > best) { best = Math.abs(X(i)); earZ = Z(i); }
  const bbox = { min: [9, 9, 9], max: [-9, -9, -9] };
  for (let i = 0; i < n; i++) if (use(i)) for (let k = 0; k < 3; k++) { bbox.min[k] = Math.min(bbox.min[k], pts[i * 3 + k]); bbox.max[k] = Math.max(bbox.max[k], pts[i * 3 + k]); }
  const r = (v) => +v.toFixed(3);
  return {
    crownY: r(crown), crownZ: r(crownZ), chinY: r(chin), chinZ: r(chinZ), height: r(H),
    cranialWidth: r(cran.w), cranialWidthAtF: r((crown - cranY) / H),
    widthInclEars: r(ear.w > cran.w ? ear.w : cran.w), ear: { halfX: r(ear.w / 2), y: r(earY), z: r(earZ), protrudes: r(ear.w / 2 - cran.w / 2) },
    depth: r(zMax - zMin), frontZ: r(zMax), frontAtY: r(noseY), occiputZ: r(zMin), occiputY: r(occY),
    foreheadZ: profile[2].front, faceZ_mid: profile[5].front, crownBackZ: profile[1].back,
    // relationships to the Head bone
    headBone: { crownAbove: r(crown - head.y), chinBelow: r(head.y - chin), frontOf: r(zMax - head.z), behind: r(head.z - zMin), bboxCentre: bbox.min.map((v, k) => r((v + bbox.max[k]) / 2 - [head.x, head.y, head.z][k])) },
    ratios: { widthToHeight: r(cran.w / H), depthToHeight: r((zMax - zMin) / H), headToBody: r(H / crown), crownToBody: r(crown) },
    profile,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = {};
  const [alex] = await readPrims(ALEX);
  const m = alexHeadMask(alex), n = alex.P.length / 3, pts = [];
  for (let i = 0; i < n; i++) if (m[i]) pts.push(alex.P[i * 3], alex.P[i * 3 + 1], alex.P[i * 3 + 2]);
  let feet = 9; for (let i = 1; i < alex.P.length; i += 3) feet = Math.min(feet, alex.P[i]);
  out.alexProduction = { verts: pts.length / 3, feetY: +feet.toFixed(4), Head: alex.jp.Head.toArray().map((v) => +v.toFixed(3)), neck: alex.jp.neck.toArray().map((v) => +v.toFixed(3)), ...measure(Float32Array.from(pts)) };
  const heads = {
    neutralAlexEnvelope: "public/avatars/human-base-v1/identity/alex-neutral-head-v1.glb",
    canonicalHeadV1: "public/avatars/human-base-v1/identity/canonical-head-v1.glb",
    phase2BonHead: "public/avatars/human-base-v1/identity/bon/head.glb",
    bonMeshyFitted: "public/avatars/human-base-v1/identity/bon-meshy-head-v1.glb",
  };
  for (const [k, f] of Object.entries(heads)) {
    if (!fs.existsSync(f)) continue;
    const prims = await readPrims(f, (name) => name === "identity_head");
    const P = Float32Array.from(prims.flatMap((p) => Array.from(p.P)));
    out[k] = { verts: P.length / 3, Head: prims[0].jp.Head?.toArray().map((v) => +v.toFixed(3)), ...measure(P) };
  }
  const flag = process.argv.indexOf("--json");
  if (flag > 0) fs.writeFileSync(process.argv[flag + 1], JSON.stringify(out, null, 1));
  for (const [k, v] of Object.entries(out)) { const { profile, ...rest } = v; console.log(k, JSON.stringify(rest)); console.log("  profile", profile.map((p) => `f${p.f} w${p.w} d${p.d} fr${p.front}`).join(" | ")); }
}
