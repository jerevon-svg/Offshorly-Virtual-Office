// optimize-identity.mjs — OPTIMISATION EXPERIMENT on a COPY of an approved identity head. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/optimize-identity.mjs <approved.glb> <outDir>
//
// Only `identity_head` (Meshy surface: face + fused hair) is simplified; the HumanBase-owned neck extension and the
// canonical Alex skull base are carried over untouched, so the head boundary and the neck/body connection never move.
// Simplification: meshoptimizer quadric collapse with UV seams respected, OPEN BORDERS LOCKED (the canonical cut edge
// and hair-strand edges keep their exact positions). Texture: WebP at 2048 / 1024 — except the living-eye atlas (face_eyes),
// whose alpha carries exact per-texel codes and data rows: it is kept lossless and full size. Geometry: Draco (runtime decodes).
import fs from "node:fs";
import { simplifyPrimitive, weld, textureCompress, draco, prune } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { io } from "./lib.mjs";

const [src, outDir] = process.argv.slice(2);
const PREFIX = process.env.PREFIX ?? src.split("/").pop().replace(/-meshy-chibi.*$|\.approved.*$|\.glb$/g, "");
fs.mkdirSync(outDir, { recursive: true });
await MeshoptSimplifier.ready;
const TARGETS = (process.env.TARGETS ?? "600000,300000,150000,80000,40000,20000").split(",").map(Number);
const TEXS = (process.env.TEXS ?? "2048,1024").split(",").map(Number);
async function keepBehindEyeShell(doc, head) {
  const ep = doc.getRoot().listMeshes().find((m) => m.getName() === "face_eyes")?.listPrimitives()[0]; if (!ep) return;
  const E = ep.getAttribute("POSITION").getArray(), EU = ep.getAttribute("TEXCOORD_0").getArray(), G = Math.round(Math.sqrt(E.length / 3 / 2)), per = G * G;
  const { data: TA, info: TI } = await sharp(Buffer.from(ep.getMaterial().getBaseColorTexture().getImage())).raw().toBuffer({ resolveWithObject: true });
  const vis = (vi) => { const a = TA[(Math.min(TI.height - 1, Math.floor(EU[vi * 2 + 1] * TI.height)) * TI.width + Math.min(TI.width - 1, Math.floor(EU[vi * 2] * TI.width))) * 4 + 3]; return a === 2 || a === 8 || a === 9 || a === 10; };
  const pa = head.getAttribute("POSITION"), P = pa.getArray().slice(); let moved = 0;
  for (let e = 0; e < 2; e++) { const o = e * per, x0 = E[o * 3], y0 = E[o * 3 + 1], x1 = E[(o + G - 1) * 3], y1 = E[(o + per - 1) * 3 + 1];
    for (let i = 0; i < P.length / 3; i++) { const fx = (P[i * 3] - x0) / (x1 - x0) * (G - 1), fy = (P[i * 3 + 1] - y0) / (y1 - y0) * (G - 1); if (fx < 0 || fy < 0 || fx > G - 1 || fy > G - 1) continue;
      const gi = Math.min(G - 2, Math.floor(fx)), gj = Math.min(G - 2, Math.floor(fy)), tx = fx - gi, ty = fy - gj, v00 = o + gj * G + gi;
      if (!(vis(v00) || vis(v00 + 1) || vis(v00 + G) || vis(v00 + G + 1))) continue;
      const z = (E[v00 * 3 + 2] * (1 - tx) + E[(v00 + 1) * 3 + 2] * tx) * (1 - ty) + (E[(v00 + G) * 3 + 2] * (1 - tx) + E[(v00 + G + 1) * 3 + 2] * tx) * ty;
      if (P[i * 3 + 2] > z - 0.002) { P[i * 3 + 2] = z - 0.002; moved++; } } }
  if (moved) pa.setArray(P); console.log(`eye shell: ${moved} simplified head verts kept behind the visible shell`);
}
const tris = (doc) => doc.getRoot().listMeshes().map((m) => [m.getName(), m.listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0)]);
const base = await io.read(src);
const total0 = Object.fromEntries(tris(base));
console.log("source", JSON.stringify(total0));
const rows = [];
for (const target of TARGETS) for (const tex of TEXS) {
  const doc = await io.read(src);
  const head = doc.getRoot().listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0];
  const n0 = head.getIndices().getCount() / 3;
  if (target < n0) simplifyPrimitive(head, { simplifier: MeshoptSimplifier, ratio: target / n0, error: 0.02, lockBorder: true });
  // simplification may move head vertices FORWARD through the (unsimplified) living-eye shell: wherever the shell is
  // visible (lid region / opening / kept paint), the head stays just behind it — as in chibify's eye-region cleanup
  if (target < n0) await keepBehindEyeShell(doc, head);
  await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [tex, tex], quality: 90 }), draco({ quantizePosition: 14, quantizeTexcoord: 12, quantizeNormal: 10 }));
  // the living-eye atlas goes back exactly as baked (its alpha codes and data rows must survive bit-exact)
  { const srcTex = base.getRoot().listTextures().find((t) => t.getName() === "face_eyes_tex"), dst = doc.getRoot().listTextures().find((t) => t.getName() === "face_eyes_tex"); if (srcTex && dst) dst.setImage(srcTex.getImage()).setMimeType(srcTex.getMimeType()); }
  const name = `tri${Math.round(target / 1000)}k-tex${tex}`, file = `${outDir}/${PREFIX}-${name}.glb`;
  await io.write(file, doc);
  const t = Object.fromEntries(tris(await io.read(file)));
  rows.push({ name, file, headTris: t.identity_head, totalTris: Object.values(t).reduce((a, b) => a + b, 0), mb: +(fs.statSync(file).size / 1048576).toFixed(2), untouched: { neck: t.bodyskin_neckext === total0.bodyskin_neckext, skullbase: t.baked_skullbase === total0.baked_skullbase } });
  console.log(JSON.stringify(rows.at(-1)));
}
fs.writeFileSync(`${outDir}/results${process.env.TAG ?? ""}.json`, JSON.stringify(rows, null, 1));
