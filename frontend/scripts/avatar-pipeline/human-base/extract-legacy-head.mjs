// extract-legacy-head.mjs — EXISTING-CHARACTER REUSE (ZERO CREDITS): cut an approved legacy production character's own
// head out of its rigged GLB and write it in the RAW-HEAD format the identity pipeline reads (one textured primitive,
// like a Meshy image-to-3D head), so chibify.mjs can give it the HumanBase identity contract (canonical fit, living
// eyes/lids, closure, neck attach) with NO generation. The source is read-only; geometry, UVs and texture are the
// character's own, vertex for vertex — no mirror (unlike build-alex-head-envelope.mjs, which neutralises identity).
// The head rule is build-alex-head-envelope's: y > 0.9, or > 50 % weighted to the head joints outside the neck column.
//
//   node scripts/avatar-pipeline/human-base/extract-legacy-head.mjs <legacy.glb> <out-raw.glb> [--minY=y]
//   --minY: also take everything above y (the neck and the full occiput, like a generated raw head) — needed for a BALD
//   head, whose occiput below the head/body split is visible
import fs from "node:fs";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import * as THREE from "three";

const [SRC, OUT] = process.argv.slice(2).filter((a) => !a.startsWith("--")), MINY = Number(process.argv.find((a) => a.startsWith("--minY="))?.slice(7) ?? NaN);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const root = (await io.read(SRC)).getRoot(), prim = root.listMeshes()[0].listPrimitives()[0];
const skin = root.listSkins()[0], names = skin.listJoints().map((j) => j.getName()), JI = Object.fromEntries(names.map((n, i) => [n, i]));
const ibm = skin.getInverseBindMatrices().getArray(), neckZ = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(ibm, JI.neck * 16).invert()).z;
const P = prim.getAttribute("POSITION").getArray(), UV = prim.getAttribute("TEXCOORD_0").getArray(), N = prim.getAttribute("NORMAL")?.getArray();
const J = prim.getAttribute("JOINTS_0").getArray(), W = prim.getAttribute("WEIGHTS_0").getArray(), I = prim.getIndices().getArray(), nv = P.length / 3;
const HJ = new Set(["Head", "head_end", "headfront"].map((n) => JI[n]).filter((v) => v !== undefined));
const isHead = (i) => { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (y > 0.9 || y > MINY) return true; let w = 0; for (let k = 0; k < 4; k++) if (HJ.has(J[i * 4 + k])) w += W[i * 4 + k]; return w > 0.5 && !(Math.hypot(x, z - neckZ) < 0.085 && y < 0.86); };
const map = new Int32Array(nv).fill(-1), oP = [], oUV = [], oN = [], oI = [];
const take = (i) => { if (map[i] < 0) { map[i] = oP.length / 3; oP.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); oUV.push(UV[i * 2], UV[i * 2 + 1]); if (N) oN.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); } return map[i]; };
for (let t = 0; t < I.length; t += 3) if (isHead(I[t]) && isHead(I[t + 1]) && isHead(I[t + 2])) oI.push(take(I[t]), take(I[t + 1]), take(I[t + 2]));
const doc = new Document(), buf = doc.createBuffer(), srcTex = root.listTextures()[0];
const tex = doc.createTexture("base_color").setImage(srcTex.getImage()).setMimeType(srcTex.getMimeType());
const p = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(oP)).setBuffer(buf))
  .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(oUV)).setBuffer(buf))
  .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(oI)).setBuffer(buf))
  .setMaterial(doc.createMaterial("head").setBaseColorTexture(tex));
if (N) p.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(oN)).setBuffer(buf));
doc.createScene().addChild(doc.createNode("head").setMesh(doc.createMesh("head").addPrimitive(p)));
doc.getRoot().listScenes()[0].setExtras({ legacyHeadSource: { file: SRC, verts: oP.length / 3, tris: oI.length / 3, rule: `build-alex-head-envelope isHead, no mirror${Number.isFinite(MINY) ? `, + all above y ${MINY}` : ""}` } });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await new NodeIO().write(OUT, doc);
console.log(`legacy head: ${oP.length / 3} verts, ${oI.length / 3} tris (of ${nv} / ${I.length / 3}) → ${OUT}`);
