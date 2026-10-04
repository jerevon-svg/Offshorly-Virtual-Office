// lib.mjs — shared plumbing for the HumanBase_V1 module builds (identity, hair, garments, shoes, accessories).
//
// A MODULE is a skinned GLB on the base's skeleton: the same 36 joint names and the base's own inverse bind
// matrices, vertices in the base's scene (bind) space. The runtime rebinds it by joint NAME onto a body's bones,
// so a module never carries clips and never needs rigging of its own.
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { draco, prune, sparse } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import * as THREE from "three";
import fs from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer";
await MeshoptSimplifier.ready;

export const BASE_FULL = "scripts/avatar-pipeline/output/human-base/base-fullres.glb";
export const BASE_OUT = "public/avatars/human-base-v1";
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(), "draco3d.encoder": await draco3d.createEncoderModule(),
});
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** The base: joint names, IBMs, rest world matrices + positions, and its full-res geometry arrays. */
export async function loadBase() {
  const doc = await io.read(BASE_FULL);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const names = joints.map((j) => j.getName());
  const ibm = Array.from(skin.getInverseBindMatrices().getArray());
  const world = Object.fromEntries(joints.map((j) => [j.getName(), new THREE.Matrix4().fromArray(j.getWorldMatrix())]));
  const rest = Object.fromEntries(Object.entries(world).map(([k, m]) => [k, new THREE.Vector3().setFromMatrixPosition(m)]));
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const g = (k) => prim.getAttribute(k).getArray();
  return {
    doc, names, ibm, world, rest, JI: Object.fromEntries(names.map((n, i) => [n, i])),
    geo: { P: g("POSITION"), N: g("NORMAL"), UV: g("TEXCOORD_0"), J: g("JOINTS_0"), W: g("WEIGHTS_0"), REG: g("_REGION"), I: prim.getIndices().getArray() },
  };
}

/** Smooth per-vertex normals from positions + indices (area weighted). */
export function computeNormals(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { N[v] += nx; N[v + 1] += ny; N[v + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return N;
}

/** Normals averaged across vertices that share a position (UV seams) so seams shade continuously. */
export function weldNormals(P, N) {
  const key = (i) => `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
  const acc = new Map();
  for (let i = 0; i < P.length / 3; i++) { const k = key(i); const a = acc.get(k) ?? [0, 0, 0]; a[0] += N[i * 3]; a[1] += N[i * 3 + 1]; a[2] += N[i * 3 + 2]; acc.set(k, a); }
  for (let i = 0; i < P.length / 3; i++) { const a = acc.get(key(i)); const l = Math.hypot(...a) || 1; N[i * 3] = a[0] / l; N[i * 3 + 1] = a[1] / l; N[i * 3 + 2] = a[2] / l; }
  return N;
}

/** Vertex adjacency (welded by position) as arrays of neighbour lists. */
export function adjacency(P, I) {
  const n = P.length / 3;
  const key = (i) => `${Math.round(P[i * 3] * 2e4)},${Math.round(P[i * 3 + 1] * 2e4)},${Math.round(P[i * 3 + 2] * 2e4)}`;
  const rep = new Int32Array(n); const m = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); if (!m.has(k)) m.set(k, i); rep[i] = m.get(k); }
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = rep[I[t + k]], b = rep[I[t + (k + 1) % 3]];
    if (a !== b) { nb[a].add(b); nb[b].add(a); }
  }
  return { rep, nb: nb.map((s) => [...s]) };
}

/**
 * Write one module GLB.
 * meshes: [{ name, P, N, I, UV?, COLOR?, J (indices into base joint names), W, extraAttrs?: {NAME: {type, array}},
 *            material: { name, color?, texture?: Uint8Array (webp), roughness?, doubleSided?, metallic? } }]
 */
/**
 * meshes[i].morphs: { name: Float32Array of POSITION deltas } — identity shape controls (glTF morph targets; three
 * builds the dictionary from extras.targetNames). opts.extraJoints: [{ name, parent, world: Matrix4 }] — joints the
 * MODULE owns (hair chains): appended after the base's, the runtime creates them under `parent` on equip.
 * opts.compress: true = Draco (no morphs allowed), "quantize" = KHR_mesh_quantization (morph-safe), false = raw.
 */
export async function writeModule(path, base, meshes, extras = {}, { compress = true, extraJoints = [] } = {}) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene("module");
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  // joints: flat, each at the base's rest WORLD transform; the base's own IBMs
  const jointNodes = base.names.map((n) => {
    const m = base.world[n]; const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
    const node = doc.createNode(n).setTranslation(p.toArray()).setRotation(q.toArray()).setScale(s.toArray());
    scene.addChild(node); return node;
  });
  const ibmAll = [...base.ibm];
  for (const ej of extraJoints) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); ej.world.decompose(p, q, sc);
    const node = doc.createNode(ej.name).setTranslation(p.toArray()).setRotation(q.toArray()).setScale(sc.toArray());
    scene.addChild(node); jointNodes.push(node); ibmAll.push(...ej.world.clone().invert().toArray());
  }
  const skin = doc.createSkin("humanbase").setInverseBindMatrices(acc("MAT4", new Float32Array(ibmAll)));
  for (const j of jointNodes) skin.addJoint(j);
  if (extraJoints.length) extras = { ...extras, moduleJoints: extraJoints.map((j) => ({ name: j.name, parent: j.parent })) };
  let usesWebp = false;
  for (const m of meshes) {
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", acc("VEC3", new Float32Array(m.P)))
      .setAttribute("NORMAL", acc("VEC3", new Float32Array(m.N)))
      .setAttribute("JOINTS_0", acc("VEC4", new Uint8Array(m.J)))
      .setAttribute("WEIGHTS_0", acc("VEC4", new Float32Array(m.W)))
      .setIndices(acc("SCALAR", new Uint32Array(m.I)));
    if (m.UV) prim.setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array(m.UV)));
    // COLOR_0 is linear in glTF; the builds sample sRGB textures, so convert here (once, for every module)
    if (m.COLOR) prim.setAttribute("COLOR_0", acc("VEC3", new Float32Array(m.COLOR).map((c) => Math.pow(Math.min(1, Math.max(0, c)), 2.2))));
    for (const [k, v] of Object.entries(m.extraAttrs ?? {})) prim.setAttribute(k, acc(v.type, v.array));
    const mat = doc.createMaterial(m.material.name).setRoughnessFactor(m.material.roughness ?? 0.9).setMetallicFactor(m.material.metallic ?? 0)
      .setDoubleSided(m.material.doubleSided ?? false).setBaseColorFactor(m.material.color ?? [1, 1, 1, 1]);
    if (m.material.texture) {
      const tex = doc.createTexture(`${m.name}_tex`).setImage(m.material.texture).setMimeType("image/webp");
      mat.setBaseColorTexture(tex); usesWebp = true;
    }
    prim.setMaterial(mat);
    const mesh = doc.createMesh(m.name).addPrimitive(prim);
    if (m.morphs) {
      const names = Object.keys(m.morphs);
      for (const n of names) prim.addTarget(doc.createPrimitiveTarget(n).setAttribute("POSITION", acc("VEC3", new Float32Array(m.morphs[n]))));
      mesh.setWeights(names.map(() => 0)).setExtras({ targetNames: names });
    }
    const node = doc.createNode(m.name).setMesh(mesh).setSkin(skin);
    if (m.extras) node.setExtras(m.extras);
    scene.addChild(node);
  }
  scene.setExtras(extras);
  if (usesWebp) doc.createExtension(EXTTextureWebP).setRequired(true);
  // keepAttributes: face shells and clogs carry a TEXCOORD_0 no texture reads (eye-local / vent coordinates)
  await doc.transform(prune({ keepLeaves: true, keepAttributes: true }));
  // "quantize" is kept as the option name, but quantisation rewrites the inverse bind matrices (a module must keep the
  // base's) — so morph modules are stored with SPARSE morph targets instead (most deltas are zero)
  if (compress === "quantize") await doc.transform(sparse({ ratio: 1 / 3 }));
  else if (compress) await doc.transform(draco({ method: "edgebreaker", quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeGeneric: 12 }));
  fs.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await io.write(path, doc);
  return fs.statSync(path).size;
}

/** Keep only the listed triangles and the vertices they use (all per-vertex arrays remapped). */
export function subset(arrays, I, keep) {
  const nv = arrays.P.length / 3;
  const map = new Int32Array(nv).fill(-1);
  const out = Object.fromEntries(Object.keys(arrays).map((k) => [k, []])); out.I = []; out.src = [];
  const stride = Object.fromEntries(Object.entries(arrays).map(([k, a]) => [k, a.length / nv]));
  for (let t = 0; t < I.length; t += 3) {
    if (!keep(t / 3)) continue;
    for (let k = 0; k < 3; k++) {
      const i = I[t + k];
      if (map[i] < 0) {
        map[i] = out.P.length / 3; out.src.push(i);
        for (const [name, a] of Object.entries(arrays)) for (let q = 0; q < stride[name]; q++) out[name].push(a[i * stride[name] + q]);
      }
      out.I.push(map[i]);
    }
  }
  return out;
}

/** Harmonic (Jacobi) solve of a per-vertex field over `free` vertices, others fixed. field: Float32Array stride s. */
export function harmonic(field, s, nb, rep, free, iterations = 300) {
  const n = rep.length;
  const isRep = (i) => rep[i] === i;
  const tmp = new Float32Array(field.length);
  for (let it = 0; it < iterations; it++) {
    tmp.set(field);
    for (let i = 0; i < n; i++) {
      if (!isRep(i) || !free[i] || nb[i].length === 0) continue;
      for (let q = 0; q < s; q++) { let a = 0; for (const j of nb[i]) a += field[j * s + q]; tmp[i * s + q] = a / nb[i].length; }
    }
    field.set(tmp);
  }
  for (let i = 0; i < n; i++) if (!isRep(i)) for (let q = 0; q < s; q++) field[i * s + q] = field[rep[i] * s + q];
  return field;
}

/** Simplify a subset (from `subset`) to about `tris` triangles; borders are locked so seams with neighbouring
 *  surfaces (a hairline, a collar) stay exactly where they were. Returns a compacted copy. */
export function simplifyGeo(g, tris, error = 0.01) {
  if (g.I.length / 3 <= tris) return g;
  const [idx] = MeshoptSimplifier.simplify(new Uint32Array(g.I), new Float32Array(g.P), 3, tris * 3, error, ["LockBorder"]);
  const nv = g.P.length / 3, map = new Int32Array(nv).fill(-1);
  const out = Object.fromEntries(Object.keys(g).map((k) => [k, []]));
  const per = Object.fromEntries(Object.entries(g).filter(([k]) => k !== "I").map(([k, a]) => [k, a.length / nv]));
  for (const i of idx) {
    if (map[i] < 0) { map[i] = out.P.length / 3; for (const [k, st] of Object.entries(per)) for (let q = 0; q < st; q++) out[k].push(g[k][i * st + q]); }
    out.I.push(map[i]);
  }
  return out;
}

/** Merge vertices that share a position (keeps the first one's attributes) — for surfaces whose UV seams do not
 *  matter (a painted scalp, vertex-coloured hair), so simplification is not blocked by thousands of seam borders. */
export function weldGeo(g) {
  const nv = g.P.length / 3, m = new Map(), map = new Int32Array(nv);
  const out = Object.fromEntries(Object.keys(g).map((k) => [k, []]));
  const per = Object.fromEntries(Object.entries(g).filter(([k]) => k !== "I" && k !== "src").map(([k, a]) => [k, a.length / nv]));
  for (let i = 0; i < nv; i++) {
    const key = `${Math.round(g.P[i * 3] * 2e4)},${Math.round(g.P[i * 3 + 1] * 2e4)},${Math.round(g.P[i * 3 + 2] * 2e4)}`;
    let j = m.get(key);
    if (j === undefined) { j = out.P.length / 3; m.set(key, j); for (const [k, st] of Object.entries(per)) for (let q = 0; q < st; q++) out[k].push(g[k][i * st + q]); }
    map[i] = j;
  }
  for (const i of g.I) out.I.push(map[i]);
  delete out.src;
  return out;
}

/** Taubin λ|μ smoothing of positions over `free` vertices (others fixed): removes surface noise without shrinking */
export function taubin(P, nb, rep, free, iterations = 10, lam = 0.5, mu = -0.53) {
  const n = rep.length, tmp = new Float32Array(P.length);
  const step = (k) => {
    tmp.set(P);
    for (let i = 0; i < n; i++) {
      if (rep[i] !== i || !free[i] || !nb[i].length) continue;
      for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb[i]) a += P[j * 3 + q]; tmp[i * 3 + q] = P[i * 3 + q] + k * (a / nb[i].length - P[i * 3 + q]); }
    }
    P.set(tmp);
  };
  for (let it = 0; it < iterations; it++) { step(lam); step(mu); }
  for (let i = 0; i < n; i++) if (rep[i] !== i) for (let q = 0; q < 3; q++) P[i * 3 + q] = P[rep[i] * 3 + q];
  return P;
}

/** SURFACE NETS: a smooth closed mesh from a signed distance function (negative inside). Returns {P, I} with
 *  outward-facing triangles. Used for sculpted solid parts (shoes) where offsetting the body is not enough. */
export function surfaceNets(sdf, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1, ny = Math.ceil((max[1] - min[1]) / cell) + 1, nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const V = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) V[id(i, j, k)] = sdf(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
  const vert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const P = [], I = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = corners.map(([a, b, c]) => V[id(i + a, j + b, k + c)]);
    let inside = 0; for (const x of v) if (x < 0) inside++;
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      const pa = corners[a], pb = corners[b];
      sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t; n++;
    }
    vert[cid(i, j, k)] = P.length / 3;
    P.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  // one quad per grid edge with a sign change, between the four cells around it
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = V[id(i, j, k)] < 0;
    // x-edge (i,j,k)→(i+1,j,k): cells (i, j-1..j, k-1..k)
    if (i < nx - 1 && v0 !== (V[id(i + 1, j, k)] < 0)) { const q = [vert[cid(i, j - 1, k - 1)], vert[cid(i, j, k - 1)], vert[cid(i, j, k)], vert[cid(i, j - 1, k)]]; if (q.every((x) => x >= 0)) quad(q, v0); }
    if (j < ny - 1 && v0 !== (V[id(i, j + 1, k)] < 0)) { const q = [vert[cid(i - 1, j, k - 1)], vert[cid(i - 1, j, k)], vert[cid(i, j, k)], vert[cid(i, j, k - 1)]]; if (q.every((x) => x >= 0)) quad(q, v0); }
    if (k < nz - 1 && v0 !== (V[id(i, j, k + 1)] < 0)) { const q = [vert[cid(i - 1, j - 1, k)], vert[cid(i, j - 1, k)], vert[cid(i, j, k)], vert[cid(i - 1, j, k)]]; if (q.every((x) => x >= 0)) quad(q, v0); }
  }
  function quad(q, flip) { if (flip) I.push(q[0], q[1], q[2], q[0], q[2], q[3]); else I.push(q[0], q[2], q[1], q[0], q[3], q[2]); }
  // orient: triangles must face along the SDF gradient (outward)
  const grad = (x, y, z) => { const e = cell * 0.5; return [sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)]; };
  let wrong = 0; const sample = Math.max(1, Math.floor(I.length / 3 / 400));
  for (let t = 0; t < I.length; t += 3 * sample) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const e1 = [0, 1, 2].map((q) => P[b * 3 + q] - P[a * 3 + q]), e2 = [0, 1, 2].map((q) => P[c * 3 + q] - P[a * 3 + q]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const g = grad(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
    if (n[0] * g[0] + n[1] * g[1] + n[2] * g[2] < 0) wrong++;
  }
  if (wrong > I.length / 3 / sample / 2) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
  return { P, I };
}

/** Mirror the +x half of a welded mesh onto −x: a perfectly symmetric mesh (the seam is snapped to x = 0). Extra
 *  per-vertex arrays in `attrs` (stride given) are mirrored with it. */
export function symmetrize(P, I, attrs = {}) {
  const nv = P.length / 3;
  const keep = []; for (let t = 0; t < I.length; t += 3) if (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3] >= 0) keep.push(t);
  const use = new Map();
  for (const t of keep) for (let k = 0; k < 3; k++) { let a = I[t + k], b = I[t + (k + 1) % 3]; if (a > b) [a, b] = [b, a]; const key = a * nv + b; use.set(key, (use.get(key) ?? 0) + 1); }
  const seam = new Uint8Array(nv);
  for (const [key, c] of use) if (c === 1) { const a = Math.floor(key / nv), b = key % nv; if (Math.abs(P[a * 3]) < 0.03 && Math.abs(P[b * 3]) < 0.03) { seam[a] = 1; seam[b] = 1; } }
  const used = new Uint8Array(nv); for (const t of keep) for (let k = 0; k < 3; k++) used[I[t + k]] = 1;
  const out = { P: [], I: [], ...Object.fromEntries(Object.keys(attrs).map((k) => [k, []])) };
  const a1 = new Int32Array(nv).fill(-1), a2 = new Int32Array(nv).fill(-1);
  const push = (i, mir) => { out.P.push(seam[i] ? 0 : mir ? -P[i * 3] : P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    for (const [k, [arr, st, mirX]] of Object.entries(attrs)) for (let q = 0; q < st; q++) out[k].push(mir && mirX && q === 0 ? -arr[i * st] : arr[i * st + q]);
    return out.P.length / 3 - 1; };
  for (let i = 0; i < nv; i++) if (used[i]) a1[i] = push(i, false);
  for (let i = 0; i < nv; i++) if (used[i]) a2[i] = seam[i] ? a1[i] : push(i, true);
  for (const t of keep) out.I.push(a1[I[t]], a1[I[t + 1]], a1[I[t + 2]]);
  for (const t of keep) out.I.push(a2[I[t]], a2[I[t + 2]], a2[I[t + 1]]);
  return out;
}

/** Transfer a source mesh's morph deltas onto other geometry: each point takes the inverse-distance blend of the
 *  deltas of its k nearest source vertices (a fitted module — hair, glasses, face shells — follows the head). */
export function transferMorphs(srcP, srcMorphs, P, k = 8) {
  const GC = 0.03, grid = new Map();
  for (let i = 0; i < srcP.length / 3; i++) { const key = `${Math.floor(srcP[i * 3] / GC)},${Math.floor(srcP[i * 3 + 1] / GC)},${Math.floor(srcP[i * 3 + 2] / GC)}`; (grid.get(key) ?? grid.set(key, []).get(key)).push(i); }
  const out = Object.fromEntries(Object.keys(srcMorphs).map((n) => [n, new Float32Array(P.length)]));
  for (let v = 0; v < P.length / 3; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let found = [];
    for (let r = 1; r <= 8 && found.length < k; r++) {
      found = [];
      const cx = Math.floor(x / GC), cy = Math.floor(y / GC), cz = Math.floor(z / GC);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const c = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!c) continue;
        for (const i of c) found.push([Math.hypot(srcP[i * 3] - x, srcP[i * 3 + 1] - y, srcP[i * 3 + 2] - z), i]);
      }
    }
    found.sort((a, b) => a[0] - b[0]); const near = found.slice(0, k);
    let ws = 0; for (const [d] of near) ws += 1 / (d + 0.003) ** 2;
    for (const [n, src] of Object.entries(srcMorphs)) { let ax = 0, ay = 0, az = 0;
      for (const [d, i] of near) { const w = 1 / (d + 0.003) ** 2 / ws; ax += src[i * 3] * w; ay += src[i * 3 + 1] * w; az += src[i * 3 + 2] * w; }
      out[n][v * 3] = ax; out[n][v * 3 + 1] = ay; out[n][v * 3 + 2] = az; }
  }
  return out;
}
