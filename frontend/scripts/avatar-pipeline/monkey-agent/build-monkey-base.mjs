// build-monkey-base.mjs — MONKEYAGENT STAGE 2 (P2): MonkeyAgent_Base_V1, the shipped production base.
//
//   node scripts/avatar-pipeline/monkey-agent/build-monkey-fullres.mjs   (stage 1, once)
//   node scripts/avatar-pipeline/monkey-agent/build-monkey-base.mjs      (from frontend/)
//
// ZERO CREDITS, NO GENERATION. The base is the established master, technically rebuilt:
//   · LOD0/1/2 by SKINNING- and UV-AWARE simplification of the stage-1 full-res derivative. Every LOD
//     vertex is an ORIGINAL master vertex, so the silhouette, bind, UVs, texture and repaired weights carry
//     over exactly; region seam vertices are LOCKED so every region boundary survives as an exact edge.
//   · per-LOD face shells (eyes + mouth) rebuilt from that LOD's own head — none on LOD2.
//   · fur / skin / dark-detail MASKS segmented from the master's own albedo (measured unlit), plus two
//     per-vertex marking channels, for runtime recolouring.
//   · Draco geometry + near-lossless WebP texture (lod-policy), garments compressed alongside.
// Inputs (read-only): stage-1 work/ files + the untouched master (deviation ruler).
// Output: public/avatars/monkey-agent-base-v1/{monkey-agent-base.glb, masks.png, garments/*.glb}
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { draco, prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/world/monkeyAgentContract.ts";
import { surfaceDeviation } from "../../../src/dev/vo3d/world/meshDeviation.ts";
import { ATLAS_FILL_REMAINDER, ATLAS_PAD_RADIUS, TEXTURE_ENCODING } from "../lod-policy.mjs";
import { padAtlasImage, rasterizeUvCoverage } from "../atlas-dilate.mjs";

const WORK = "scripts/avatar-pipeline/monkey-agent/work";
const MASTER = "public/avatars/monkey-base-v1/monkey-master.glb";
const OUT = "public/avatars/monkey-agent-base-v1";
const R = C.BODY_REGIONS, L = C.MONKEY_SURFACE_LANDMARKS;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(), "draco3d.encoder": await draco3d.createEncoderModule(),
});
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const doc = await io.read(`${WORK}/monkey-agent-fullres.glb`);
const root = doc.getRoot(), buf = root.listBuffers()[0], skin = root.listSkins()[0];
const bodyNode = root.listNodes().find((n) => n.getName() === "Mesh_0");
const prim = bodyNode.getMesh().listPrimitives()[0];
const A = Object.fromEntries(["POSITION", "NORMAL", "TANGENT", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0", "_REGION"].map((k) => [k, prim.getAttribute(k)?.getArray() ?? null]));
const P = A.POSITION, N = A.NORMAL, J = A.JOINTS_0, W = A.WEIGHTS_0, REG = A._REGION, IDX = new Uint32Array(prim.getIndices().getArray());
const nv = P.length / 3;
const JI = Object.fromEntries(C.MONKEY_SKELETON_JOINTS.map((n, i) => [n, i]));
const CX = 0;

// ---- per-vertex markings (bind-space functions; the masks decide fur vs skin at runtime) ----------------
// KEEP (third channel): the painted face details — nose, brows, mouth line — never take a fur tint. They
// are the same dark brown as the fur in colour space, so only position + darkness can tell them apart.
const albedo0 = await sharp(Buffer.from(root.listTextures()[0].getImage())).raw().toBuffer({ resolveWithObject: true });
const texLum = (i) => { const { data, info } = albedo0; const x = Math.min(info.width - 1, Math.round(A.TEXCOORD_0[i * 2] * info.width)), y = Math.min(info.height - 1, Math.round(A.TEXCOORD_0[i * 2 + 1] * info.height)); const o = (y * info.width + x) * info.channels; return 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]; };
const MARKS = new Float32Array(nv * 3);
for (let i = 0; i < nv; i++) {
  const x = P[i * 3] - CX, y = P[i * 3 + 1], z = P[i * 3 + 2];
  // crown: a stripe from the brow over the top and down the back of the head (+ the tuft)
  const crown = REG[i] === R.TUFT ? 1 : (1 - smooth(0.1, 0.16, Math.abs(x))) * smooth(1.2, 1.3, y + Math.max(0, -z) * 0.7);
  // muzzle: the snout around nose and mouth
  const muzzle = z > 0.22 ? 1 - smooth(0.82, 1.0, Math.hypot(x / 0.15, (y - 0.985) / 0.095)) : 0;
  MARKS[i * 3] = REG[i] === R.HEAD || REG[i] === R.TUFT ? crown : 0;
  MARKS[i * 3 + 1] = muzzle;
  const face = z > 0.2 && y > 0.92 && y < 1.36 && Math.abs(x) < 0.34 && (REG[i] === R.HEAD || REG[i] === R.MOUTH || REG[i] === R.EYE_L || REG[i] === R.EYE_R);
  MARKS[i * 3 + 2] = face ? 1 - smooth(62, 80, texLum(i)) : 0;
}

// ---- seam lock: every position shared by more than one region is a region-boundary vertex ----------------
const posKey = (i) => `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`;
const regionsAt = new Map();
for (let i = 0; i < nv; i++) { const k = posKey(i); (regionsAt.get(k) ?? regionsAt.set(k, new Set()).get(k)).add(REG[i]); }
const lock = new Uint8Array(nv).map((_, i) => (regionsAt.get(posKey(i)).size > 1 ? 1 : 0));

// ---- LODs: UV + normal + skinning-aware simplification ---------------------------------------------------
await MeshoptSimplifier.ready;
const WJ = ["Hips", "Spine02", "Spine01", "Spine", "neck", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"].map((n) => JI[n]);
const AS = 5 + WJ.length, attr = new Float32Array(nv * AS);
for (let i = 0; i < nv; i++) {
  attr.set([A.TEXCOORD_0[i * 2], A.TEXCOORD_0[i * 2 + 1], N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], i * AS);
  for (let k = 0; k < 4; k++) { const c = WJ.indexOf(J[i * 4 + k]); if (c >= 0) attr[i * AS + 5 + c] += W[i * 4 + k]; }
}
const weights = [8, 8, 1.2, 1.2, 1.2, ...WJ.map(() => 0.6)];
const master = await io.read(MASTER);
const mPos = master.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute("POSITION").getArray();

function compact(idx) {
  const remap = new Map(), order = [];
  const out = new Uint32Array(idx.length);
  idx.forEach((v, k) => { if (!remap.has(v)) { remap.set(v, order.length); order.push(v); } out[k] = remap.get(v); });
  return { order, idx: out };
}
const pick = (arr, size, order, Ctor = arr.constructor) => { const o = new Ctor(order.length * size); order.forEach((v, k) => { for (let c = 0; c < size; c++) o[k * size + c] = arr[v * size + c]; }); return o; };

const report = [];
const lods = [];
for (const tier of C.MONKEY_BASE_LODS) {
  // LOD0/1 keep every UV seam; only LOD2 (drawn under ~110 px tall) may collapse across them
  // (Permissive) — without it the seams pin it at ~13k, and its texel bleed is sub-pixel there
  // Regularize on the far LODs: without it the seam constraints leave long sliver triangles whose
  // interpolated normals shade as dark scratches across the face plate
  const flags = tier.name === "lod2" ? ["Permissive", "Regularize"] : tier.name === "lod1" ? ["Regularize"] : [];
  // DEVIATION-AWARE LADDER: loosen the error until the triangle target is met, but never accept a result
  // whose surface deviation from the master breaks this tier's budget — the reference wins over the count
  let best = null;
  for (const e of [0.004, 0.007, 0.01, 0.014, 0.02, 0.04, 0.08]) {
    const [cand, err] = MeshoptSimplifier.simplifyWithAttributes(IDX, P, 3, attr, AS, weights, lock, tier.triangles * 3, e, flags);
    const c = compact(cand), cpos = pick(P, 3, c.order), dev = surfaceDeviation(mPos, cpos, c.idx);
    if (dev.max > tier.maxDeviation) break;
    best = { ...c, pos: cpos, dev, err };
    if (cand.length / 3 <= tier.triangles * 1.08) break;
  }
  const { order, idx: cidx, pos: pos0, dev, err } = best;
  // SEAM REPAIR: a collapse can still join two sides of a region seam (the seam copies share position and
  // attributes). Each such triangle gets its minority vertex DUPLICATED with the majority region — it sits
  // right at the seam, so the hidden area stays inside the garment's cover margin.
  const regL = Array.from(pick(REG, 1, order)), SEAM_PAIRS = new Set([[R.UPPERARM_L, R.FOREARM_L], [R.FOREARM_L, R.HAND_L], [R.UPPERARM_R, R.FOREARM_R],
    [R.FOREARM_R, R.HAND_R], [R.PELVIS, R.BELLY], [R.BELLY, R.CHEST], [R.NECK, R.CHEST]].map(([a, b]) => `${Math.min(a, b)},${Math.max(a, b)}`));
  let repaired = 0;
  for (let t = 0; t < cidx.length; t += 3) {
    const r3 = [regL[cidx[t]], regL[cidx[t + 1]], regL[cidx[t + 2]]], set = [...new Set(r3)].sort((a, b) => a - b);
    if (set.length !== 2 || !SEAM_PAIRS.has(set.join(","))) continue;
    const major = r3.filter((r) => r === set[0]).length >= 2 ? set[0] : set[1];
    for (let k = 0; k < 3; k++) if (r3[k] !== major) { order.push(order[cidx[t + k]]); regL.push(major); cidx[t + k] = order.length - 1; repaired++; }
  }
  const pos = repaired ? pick(P, 3, order) : pos0;
  let ymin = Infinity, ymax = -Infinity; for (let k = 0; k < order.length; k++) { ymin = Math.min(ymin, pos[k * 3 + 1]); ymax = Math.max(ymax, pos[k * 3 + 1]); }
  lods.push({ tier, order, idx: cidx, pos, regL: new Float32Array(regL) });
  report.push({ lod: tier.name, tris: cidx.length / 3, verts: order.length, seamRepaired: repaired, simplifyErr: +err.toFixed(4), height: +(ymax - ymin).toFixed(4), devMean: +dev.mean.toFixed(4), devP99: +dev.p99.toFixed(4), devMax: +dev.max.toFixed(4), budgetMax: tier.maxDeviation });
}

/** Area-weighted smooth normals of THIS geometry, welded across UV seams (exact positions). The far LODs
 *  use these: an original vertex normal at a sculpted crease (eye socket, brow) shades a long simplified
 *  triangle dark, which read as scratches across the face plate. */
function lodNormals(pos, idx) {
  const n = pos.length / 3, key = (v) => `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`, acc = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]), e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) { const k = key(v), s2 = acc.get(k) ?? [0, 0, 0]; s2[0] += f[0]; s2[1] += f[1]; s2[2] += f[2]; acc.set(k, s2); }
  }
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) { const s2 = acc.get(key(v)) ?? [0, 1, 0], l = Math.hypot(...s2) || 1; out.set([s2[0] / l, s2[1] / l, s2[2] / l], v * 3); }
  return out;
}

// ---- per-LOD face shells -------------------------------------------------------------------------------
function faceShells(lod) {
  const { order, idx } = lod;
  const lp = (k, c) => P[order[k] * 3 + c];
  // welded smooth normals within this LOD
  const wk = (k) => `${Math.round(lp(k, 0) * 1e4)},${Math.round(lp(k, 1) * 1e4)},${Math.round(lp(k, 2) * 1e4)}`;
  const acc = new Map(); for (let k = 0; k < order.length; k++) { const key = wk(k), v = order[k]; const a = acc.get(key) ?? [0, 0, 0]; a[0] += N[v * 3]; a[1] += N[v * 3 + 1]; a[2] += N[v * 3 + 2]; acc.set(key, a); }
  const nrm = (k) => { const a = acc.get(wk(k)), l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const headRigid = (k) => J[order[k] * 4] === JI.Head && W[order[k] * 4] > 0.999 && lp(k, 2) > 0.2;
  const eyeR = (x, y, s) => Math.hypot((x - s * L.eye.cx) / L.eye.rx, (y - L.eye.cy) / L.eye.ry);
  const mouthR = (x, y) => Math.hypot((x - L.mouth.cx) / 0.1, (y - (L.mouth.cy - 0.012)) / 0.065);
  const build = (inside, off, uvOf, sideOf) => {
    const map = new Map(), pos = [], nor = [], uv = [], side = [], out = [];
    const vtx = (k) => { const key = wk(k); if (map.has(key)) return map.get(key); const n = nrm(k), x = lp(k, 0), y = lp(k, 1), z = lp(k, 2), q = pos.length / 3; pos.push(x + n[0] * off, y + n[1] * off, z + n[2] * off); nor.push(...n); uv.push(...uvOf(x, y)); if (sideOf) side.push(sideOf(x)); map.set(key, q); return q; };
    for (let t = 0; t < idx.length; t += 3) { const v = [idx[t], idx[t + 1], idx[t + 2]]; if (v.every(inside)) out.push(vtx(v[0]), vtx(v[1]), vtx(v[2])); }
    // the eye is drawn from PLANAR uvs, so any triangulation draws it identically; the only limit is that
    // a flat triangle must not sag into the bulge below — an absolute error well under the offset
    const P3 = new Float32Array(pos);
    const [sIdx] = MeshoptSimplifier.simplify(new Uint32Array(out), P3, 3, Math.min(600 * 3, out.length), off * 0.35, ["LockBorder", "ErrorAbsolute"]);
    return { pos: P3, nor: new Float32Array(nor), uv: new Float32Array(uv), side: new Float32Array(side), idx: sIdx };
  };
  const eyes = build((k) => headRigid(k) && Math.min(eyeR(lp(k, 0), lp(k, 1), 1), eyeR(lp(k, 0), lp(k, 1), -1)) <= 1.08, 0.0035,
    (x, y) => { const s = x >= 0 ? 1 : -1; return [(x - s * L.eye.cx) / L.eye.rx, (y - L.eye.cy) / L.eye.ry]; }, (x) => (x >= 0 ? 1 : -1));
  const mouth = build((k) => headRigid(k) && lp(k, 2) > 0.3 && mouthR(lp(k, 0), lp(k, 1)) <= 1.0, 0.003,
    (x, y) => [(x - L.mouth.cx) / 0.1, (y - (L.mouth.cy - 0.012)) / 0.065]);
  return { eyes, mouth };
}

// ---- assemble: one GLB, three body LODs + two face LODs, one skin, one texture, the clips once -------------
const bodyMat = prim.getMaterial();
const scene = root.listScenes()[0];
const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
const rigid = (n) => { const j = new Uint8Array(n * 4), w = new Float32Array(n * 4); for (let v = 0; v < n; v++) { j[v * 4] = JI.Head; w[v * 4] = 1; } return { j, w }; };
for (const lod of lods) {
  const { order, idx, tier } = lod;
  const pr = doc.createPrimitive()
    .setAttribute("POSITION", acc("VEC3", lod.pos))
    .setAttribute("NORMAL", acc("VEC3", tier.name === "lod0" ? pick(N, 3, order) : lodNormals(lod.pos, idx)))
    .setAttribute("TEXCOORD_0", acc("VEC2", pick(A.TEXCOORD_0, 2, order)))
    .setAttribute("JOINTS_0", acc("VEC4", pick(J, 4, order, Uint8Array)))
    .setAttribute("WEIGHTS_0", acc("VEC4", pick(W, 4, order)))
    .setAttribute("_REGION", acc("SCALAR", lod.regL))
    .setAttribute("_MARKS", acc("VEC3", pick(MARKS, 3, order)))
    .setIndices(acc("SCALAR", idx)).setMaterial(bodyMat);
  if (A.TANGENT) pr.setAttribute("TANGENT", acc("VEC4", pick(A.TANGENT, 4, order)));
  scene.addChild(doc.createNode(`body_${tier.name}`).setMesh(doc.createMesh(`body_${tier.name}`).addPrimitive(pr)).setSkin(skin));
  if (!tier.face) continue;
  const { eyes, mouth } = faceShells(lod);
  const faceTris = [];
  for (const [name, g, side] of [["face_eyes", eyes, true], ["face_mouth", mouth, false]]) {
    const n = g.pos.length / 3, { j, w } = rigid(n); // (unused vertices are dropped by prune at write)
    const fp = doc.createPrimitive().setAttribute("POSITION", acc("VEC3", g.pos)).setAttribute("NORMAL", acc("VEC3", g.nor))
      .setAttribute("TEXCOORD_0", acc("VEC2", g.uv)).setAttribute("JOINTS_0", acc("VEC4", j)).setAttribute("WEIGHTS_0", acc("VEC4", w))
      .setIndices(acc("SCALAR", g.idx)).setMaterial(doc.createMaterial(`monkey-${name}`));
    if (side) fp.setAttribute("_SIDE", acc("SCALAR", g.side));
    scene.addChild(doc.createNode(`${name}_${tier.name}`).setMesh(doc.createMesh(`${name}_${tier.name}`).addPrimitive(fp)).setSkin(skin));
    faceTris.push(g.idx.length / 3);
  }
  report.find((r) => r.lod === tier.name).faceTris = faceTris;
}
bodyNode.detach?.(); bodyNode.getMesh().dispose(); bodyNode.dispose();

// ---- masks from the albedo: fur / skin / dark detail ------------------------------------------------------
const tex = root.listTextures()[0];
// ATLAS PADDING (the employee pipeline's own atlas-dilate): a simplified LOD edge can cut across a
// concave UV chart corner and sample the gutter; dilating every FULL-RES chart into its gutter makes
// that sample the chart's own colour. Coverage comes from the full-res UVs, i.e. the master's charts.
{
  const [tw, th] = tex.getSize();
  const cov = rasterizeUvCoverage(A.TEXCOORD_0, IDX, tw, th, { margin: 1 });
  const padded = await padAtlasImage(sharp, Buffer.from(tex.getImage()), { radius: ATLAS_PAD_RADIUS, fillRemainder: ATLAS_FILL_REMAINDER, coverage: cov.mask });
  tex.setImage(padded.png).setMimeType("image/png");
}
const albedo = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
const MS = 1024, mask = Buffer.alloc(MS * MS * 4);
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const FUR = hex(C.MONKEY_ALBEDO_REF.fur), SKIN = hex(C.MONKEY_ALBEDO_REF.skin);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
{
  const { data, info } = albedo, sx = info.width / MS;
  for (let y = 0; y < MS; y++) for (let x = 0; x < MS; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = 0; dy < sx; dy++) for (let dx = 0; dx < sx; dx++) { const o = ((Math.floor(y * sx) + dy) * info.width + Math.floor(x * sx) + dx) * info.channels; r += data[o]; g += data[o + 1]; b += data[o + 2]; n++; }
    const c = [r / n, g / n, b / n], lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const dark = 1 - smooth(38, 62, lum);
    const df = dist(c, FUR), ds = dist(c, SKIN);
    const fur = (1 - dark) * smooth(-30, 30, ds - df);
    const o = (y * MS + x) * 4;
    mask[o] = Math.round(fur * 255); mask[o + 1] = Math.round((1 - dark) * (1 - fur / Math.max(1e-6, 1 - dark)) * 255); mask[o + 2] = Math.round(dark * 255); mask[o + 3] = 255;
  }
}

// ---- texture encode (lod-policy near-lossless WebP), compress, write --------------------------------------
fs.mkdirSync(`${OUT}/garments`, { recursive: true });
await sharp(mask, { raw: { width: MS, height: MS, channels: 4 } }).png({ compressionLevel: 9 }).toFile(`${OUT}/masks.png`);
doc.createExtension(EXTTextureWebP).setRequired(true);
const webp = await sharp(Buffer.from(tex.getImage())).webp({
  lossless: TEXTURE_ENCODING.lossless, nearLossless: TEXTURE_ENCODING.nearLossless, quality: TEXTURE_ENCODING.quality, effort: TEXTURE_ENCODING.effort,
}).toBuffer();
tex.setImage(webp).setMimeType("image/webp");
const DRACO = { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeGeneric: 12 };
await doc.transform(prune({ keepAttributes: true, keepLeaves: true }), draco(DRACO));
await io.write(`${OUT}/monkey-agent-base.glb`, doc);
const gReport = [];
for (const f of fs.readdirSync(WORK).filter((x) => x.startsWith("garment-"))) {
  const g = await io.read(`${WORK}/${f}`);
  await g.transform(prune({ keepAttributes: true, keepLeaves: true }), draco(DRACO));
  await io.write(`${OUT}/garments/${f.replace("garment-", "")}`, g);
  const gp = g.getRoot().listMeshes()[0].listPrimitives()[0];
  gReport.push(`${f.replace("garment-", "").replace(".glb", "")} ${gp.getIndices().getCount() / 3} tris ${(fs.statSync(`${OUT}/garments/${f.replace("garment-", "")}`).size / 1e3).toFixed(0)} KB`);
}
for (const r of report) console.log(JSON.stringify(r));
console.log("locked seam verts", lock.reduce((a, b) => a + b, 0));
console.log("base", (fs.statSync(`${OUT}/monkey-agent-base.glb`).size / 1e6).toFixed(2), "MB  masks", (fs.statSync(`${OUT}/masks.png`).size / 1e3).toFixed(0), "KB  texture webp", (webp.length / 1e6).toFixed(2), "MB");
for (const g of gReport) console.log("garment", g);
