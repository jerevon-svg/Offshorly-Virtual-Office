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
// the fringe (foreground hair) must stay in front of every VISIBLE living-eye texel after simplification (chibify lifted it
// there by clearEye; a collapse may pull a vertex back) — the inverse of keepBehindEyeShell
/** after simplification the fringe may sit a few mm inside the (simplified) frontal face again — the chibify clamp, re-applied:
 *  5 mm–3 cm inside on the frontal face (slope < 1.2) → 2 mm-eq in front of it */
function keepFringeOffFace(doc, fr) {
  const hp = doc.getRoot().listMeshes().find((m) => m.getName() === "identity_head")?.listPrimitives()[0]; if (!hp) return 0;
  const HP = hp.getAttribute("POSITION").getArray(), HI = hp.getIndices().getArray(), Gc = { x0: -0.6, y0: 0.8, c: 0.004, nx: 300, ny: 220 }, Zr = new Float32Array(Gc.nx * Gc.ny).fill(NaN);
  for (let t = 0; t < HI.length; t += 3) { const q = [0, 1, 2].map((k) => { const v = HI[t + k]; return [(HP[v * 3] - Gc.x0) / Gc.c, (HP[v * 3 + 1] - Gc.y0) / Gc.c, HP[v * 3 + 2]]; });
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue;
    for (let y = Math.max(0, Math.ceil(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(Gc.ny - 1, Math.floor(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.ceil(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(Gc.nx - 1, Math.floor(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = y * Gc.nx + x; if (!(z <= Zr[k])) Zr[k] = z; } }
  const pa = fr.getAttribute("POSITION"), P = pa.getArray().slice(); let moved = 0;
  for (let v = 0; v < P.length / 3; v++) { const i = Math.round((P[v * 3] - Gc.x0) / Gc.c), j = Math.round((P[v * 3 + 1] - Gc.y0) / Gc.c); if (i < 1 || j < 1 || i >= Gc.nx - 1 || j >= Gc.ny - 1) continue; const z = Zr[j * Gc.nx + i]; if (Number.isNaN(z)) continue;
    const sl = Math.max(Math.abs((Zr[j * Gc.nx + i + 1] - Zr[j * Gc.nx + i - 1]) / (2 * Gc.c)), Math.abs((Zr[(j + 1) * Gc.nx + i] - Zr[(j - 1) * Gc.nx + i]) / (2 * Gc.c))); if (!(sl < 1.2)) continue;
    if (P[v * 3 + 2] < z - 0.003 && P[v * 3 + 2] > z - 0.03) { P[v * 3 + 2] = z + 0.002; moved++; } }
  if (moved) { pa.setArray(P); console.log(`fringe off face (after simplification): ${moved}`); } return moved;
}
async function keepFringeInFront(doc, fr) {
  const ep = doc.getRoot().listMeshes().find((m) => m.getName() === "face_eyes")?.listPrimitives()[0]; if (!ep) return;
  const E = ep.getAttribute("POSITION").getArray(), EU = ep.getAttribute("TEXCOORD_0").getArray(), G = Math.round(Math.sqrt(E.length / 3 / 2)), per = G * G;
  const { data: TA, info: TI } = await sharp(Buffer.from(ep.getMaterial().getBaseColorTexture().getImage())).raw().toBuffer({ resolveWithObject: true });
  const vis = (vi) => { const a = TA[(Math.min(TI.height - 1, Math.floor(EU[vi * 2 + 1] * TI.height)) * TI.width + Math.min(TI.width - 1, Math.floor(EU[vi * 2] * TI.width))) * 4 + 3]; return a === 2 || a === 8 || a === 9 || a === 10; };
  const pa = fr.getAttribute("POSITION"), P = pa.getArray().slice(); let moved = 0;
  for (let e = 0; e < 2; e++) { const o = e * per, x0 = E[o * 3], y0 = E[o * 3 + 1], x1 = E[(o + G - 1) * 3], y1 = E[(o + per - 1) * 3 + 1];
    for (let i = 0; i < P.length / 3; i++) { const fx = (P[i * 3] - x0) / (x1 - x0) * (G - 1), fy = (P[i * 3 + 1] - y0) / (y1 - y0) * (G - 1); if (fx < 0 || fy < 0 || fx > G - 1 || fy > G - 1) continue;
      const gi = Math.min(G - 2, Math.floor(fx)), gj = Math.min(G - 2, Math.floor(fy)), v00 = o + gj * G + gi; if (!(vis(v00) || vis(v00 + 1) || vis(v00 + G) || vis(v00 + G + 1))) continue;
      const z = Math.max(E[v00 * 3 + 2], E[(v00 + 1) * 3 + 2], E[(v00 + G) * 3 + 2], E[(v00 + G + 1) * 3 + 2]);
      if (P[i * 3 + 2] < z + 0.004 && P[i * 3 + 2] > z - 0.015) { P[i * 3 + 2] = z + 0.004; moved++; } } }   // only what simplification pulled back (≤ its error), never a lock's far side
  if (moved) pa.setArray(P); console.log(`fringe: ${moved} simplified verts kept in front of the visible eye shell`);
}
const tris = (doc) => doc.getRoot().listMeshes().map((m) => [m.getName(), m.listPrimitives().reduce((a, p) => a + p.getIndices().getCount() / 3, 0)]);
const base = await io.read(src);
const total0 = Object.fromEntries(tris(base));
console.log("source", JSON.stringify(total0));
const rows = [];
for (const target of TARGETS) for (const tex of TEXS) {
  const doc = await io.read(src);
  // V1.1 LAYERED HEADS: the budget covers the head + every hair layer (identity_head, identity_hair_scalp/main/back), one
  // shared ratio; layer boundaries are open borders → LOCKED, so layers never crack apart. The FRINGE (foreground locks)
  // keeps more detail and is re-checked in front of the eye shell; the interior closure is simplified hard (never seen
  // in detail). V1 heads (hair fused into identity_head) take the same path with one mesh.
  const mesh = (n) => doc.getRoot().listMeshes().find((m) => m.getName() === n)?.listPrimitives()[0] ?? null;
  const layered = ["identity_head", "identity_face_twin", "identity_hair_scalp", "identity_hair_main", "identity_hair_back", "identity_hair_base"].map(mesh).filter(Boolean), twinFace = mesh("identity_face_twin");
  const head = mesh("identity_head"), n0 = layered.reduce((a, p) => a + p.getIndices().getCount() / 3, 0), ratio = Math.min(1, target / n0);
  // V1.2 ERROR-BALANCED BUDGET (universal): one shared RATIO crushed a smooth face exactly as hard as the far denser hair
  // (Bon: 254k face + 920k hair → face at ~10% → faceted cheeks, nose and jaw). The budget is now spent by geometric
  // error: one error bound ε for every layer (what a joint simplification would do), the face held to FACE_K·ε (smooth
  // skin shows facets in its shading; hair hides them); ε is found by bisection so the total meets the target.
  if (ratio < 1) { const FACE_K = 0.35, parts = layered.map((p) => ({ p, isFace: p === head || p === twinFace, pos: p.getAttribute("POSITION").getArray(), idx: Uint32Array.from(p.getIndices().getArray()) }));
    const count = (eps) => parts.reduce((a, q) => a + MeshoptSimplifier.simplify(q.idx, q.pos, 3, 0, q.isFace ? eps * FACE_K : eps, ["LockBorder"])[0].length / 3, 0);
    let lo = 1e-5, hi = 0.05; for (let it = 0; it < 18; it++) { const mid = Math.sqrt(lo * hi); if (count(mid) > target) lo = mid; else hi = mid; }
    for (const q of parts) simplifyPrimitive(q.p, { simplifier: MeshoptSimplifier, ratio: 0, error: q.isFace ? hi * FACE_K : hi, lockBorder: true });
    console.log(`error-balanced budget: ε ${hi.toExponential(2)} (face ×${FACE_K}) → ${parts.map((q) => `${q.p.getAttribute("POSITION") ? "" : ""}${q.p.getIndices().getCount() / 3}`).join(" / ")} tris`); }
  const fr = mesh("identity_hair_fringe"); if (fr && ratio < 1) simplifyPrimitive(fr, { simplifier: MeshoptSimplifier, ratio: Math.min(1, ratio * 2), error: 0.004, lockBorder: true });
  const inn = mesh("baked_interior"); if (inn) simplifyPrimitive(inn, { simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.01, lockBorder: true });
  // simplification may move head vertices FORWARD through the (unsimplified) living-eye shell: wherever the shell is
  // visible (lid region / opening / kept paint), the head stays just behind it — as in chibify's eye-region cleanup
  if (ratio < 1) { await keepBehindEyeShell(doc, head); if (twinFace) await keepBehindEyeShell(doc, twinFace); }
  if (fr && ratio < 1) await keepFringeInFront(doc, fr);
  for (const p of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) if (p.getAttribute("_SRCUV")) { const a = p.getAttribute("_SRCUV"); p.setAttribute("_SRCUV", null); a.dispose(); }
  await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [tex, tex], quality: 90, pattern: /^(?!identity_hair_fringe)/ }), textureCompress({ encoder: sharp, targetFormat: "webp", quality: 90, pattern: /^identity_hair_fringe/ }), draco({ quantizePosition: 14, quantizeTexcoord: 12, quantizeNormal: 10 }));
  // the living-eye atlas goes back exactly as baked (its alpha codes and data rows must survive bit-exact)
  { const srcTex = base.getRoot().listTextures().find((t) => t.getName() === "face_eyes_tex"), dst = doc.getRoot().listTextures().find((t) => t.getName() === "face_eyes_tex"); if (srcTex && dst) dst.setImage(srcTex.getImage()).setMimeType(srcTex.getMimeType()); }
  const name = `tri${Math.round(target / 1000)}k-tex${tex}`, file = `${outDir}/${PREFIX}-${name}.glb`;
  await io.write(file, doc);
  // FRINGE OFF THE FACE — measured on the file exactly as written (the head as shipped, after every step above): any fringe
  // vertex the simplified head now covers by 3 mm–3 cm on the frontal face goes 2 mm-eq in front of it
  { const d2 = await io.read(file), fr2 = d2.getRoot().listMeshes().find((m) => m.getName() === "identity_hair_fringe")?.listPrimitives()[0];
    if (fr2 && keepFringeOffFace(d2, fr2)) { await d2.transform(draco({ quantizePosition: 14, quantizeTexcoord: 12, quantizeNormal: 10 })); await io.write(file, d2); } }
  const t = Object.fromEntries(tris(await io.read(file)));
  rows.push({ name, file, headTris: ["identity_head", "identity_face_twin", "identity_hair_twinfeature", "identity_hair_scalp", "identity_hair_main", "identity_hair_back", "identity_hair_fringe"].reduce((a, k) => a + (t[k] ?? 0), 0), totalTris: Object.values(t).reduce((a, b) => a + b, 0), mb: +(fs.statSync(file).size / 1048576).toFixed(2), untouched: { neck: t.bodyskin_neckext === total0.bodyskin_neckext, skullbase: t.baked_skullbase === total0.baked_skullbase } });
  console.log(JSON.stringify(rows.at(-1)));
}
fs.writeFileSync(`${outDir}/results${process.env.TAG ?? ""}.json`, JSON.stringify(rows, null, 1));
