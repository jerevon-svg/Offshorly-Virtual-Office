// build-meshy-identity-head.mjs — THE RAW MESHY BON HEAD, FITTED ONTO HUMANBASE (integration proof). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-meshy-identity-head.mjs
//
// Reads the preserved raw Meshy GLB (output/meshy-employees/bon-head-v1/raw-untouched/, never written) and writes a
// HumanBase identity module. Full resolution: no decimation, no remesh, the texture's pixels unchanged (lossless WebP).
//   1. CLEAN: drop only non-identity garbage — everything below the neck (bust shelf + stub). The two small separate
//      islands are KEPT: they are hair locks lying 2–45 mm off the hair surface (left side), not floating debris.
//   2. FIT (least destructive): ONE uniform scale + translation. Scale = ear-to-ear skin width → Alex's (0.43 half),
//      i.e. the skull sides; chin → Alex's chin (0.809); centred on the eyes in x; ears → Alex's ear depth in z.
//      Face, jaw, eyes, brows, ears and hair keep Meshy's own proportions exactly. Hair is not compressed.
//   3. ATTACH: only the neck below the jaw is tapered (smooth radial blend) into the base's neck ellipse at the cut, so
//      the head grows out of the body's neck; the base NECK region is hidden under it. Rigid on Head, blended to neck
//      over the lower neck.
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, loadBase, writeModule } from "./lib.mjs";

const RAW = "scripts/avatar-pipeline/output/meshy-employees/bon-head-v1/raw-untouched/bon-head-v1-raw-model.glb";
const OUTF = "scripts/avatar-pipeline/output/human-base/superseded/bon-meshy-head-v1.glb";   // superseded by chibify.mjs (kept out of the catalogue)
const ALEX = { earHalf: 0.43, earZ: -0.06, chinY: 0.809 };
const RAW_FLOOR = -0.72;   // raw y below which only the bust shelf and the stand stub exist (profiled)
const CUT_Y = 0.735;       // fitted: the base's neck ↔ chest line — the head ends inside the collar

const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(RAW);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P0 = prim.getAttribute("POSITION").getArray(), N0 = prim.getAttribute("NORMAL").getArray(), UV0 = prim.getAttribute("TEXCOORD_0").getArray(), I0 = prim.getIndices().getArray();
const n0 = P0.length / 3;
const jpeg = Buffer.from(doc.getRoot().listTextures()[0].getImage());
const { data: tex, info: ti } = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const col = (i) => { const u = Math.min(ti.width - 1, Math.max(0, Math.round(UV0[i * 2] * (ti.width - 1)))), v = Math.min(ti.height - 1, Math.max(0, Math.round(UV0[i * 2 + 1] * (ti.height - 1)))); const o = (v * ti.width + u) * 3; return [tex[o], tex[o + 1], tex[o + 2]]; };
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const isSkin = (c) => lum(c) >= 90 && c[0] > c[2] + 30;

// ---- 1. islands (welded by position) — keep the main shell only ---------------------------------------------------
const key = (i) => `${Math.round(P0[i * 3] * 1e5)},${Math.round(P0[i * 3 + 1] * 1e5)},${Math.round(P0[i * 3 + 2] * 1e5)}`;
const wm = new Map(), w = new Int32Array(n0); for (let i = 0; i < n0; i++) { const k = key(i); if (!wm.has(k)) wm.set(k, i); w[i] = wm.get(k); }
const par = new Int32Array(n0).map((_, i) => i); const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
for (let t = 0; t < I0.length; t += 3) { const a = f(w[I0[t]]); par[f(w[I0[t + 1]])] = a; par[f(w[I0[t + 2]])] = a; }
const size = new Map(); for (let i = 0; i < n0; i++) { const r = f(w[i]); size.set(r, (size.get(r) ?? 0) + 1); }
const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
const islandBox = new Map(); for (let i = 0; i < n0; i++) { const r = f(w[i]); if (r === main) continue; const b = islandBox.get(r) ?? [9, 9, 9, -9, -9, -9]; for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], P0[i * 3 + k]); b[3 + k] = Math.max(b[3 + k], P0[i * 3 + k]); } islandBox.set(r, b); }
for (const [r, b] of islandBox) console.log(`kept hair-lock island: ${size.get(r)} verts, box ${b.map((v) => v.toFixed(2)).join(" ")}`);

// ---- 2. measure the raw head (eyes from the sclera texels, ears from the lateral skin extremes, chin) ---------------
const eyes = { l: [0, 0, 0, 0], r: [0, 0, 0, 0] };
let exL = 0, exR = 0, chin = 9;
for (let i = 0; i < n0; i++) {
  const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2], c = col(i);
  if (z > 0.2 && c[0] > 185 && c[2] > 175 && Math.abs(c[0] - c[2]) < 22 && Math.abs(c[0] - c[1]) < 18) { const a = x < 0 ? eyes.l : eyes.r; a[0] += x; a[1] += y; a[2] += z; a[3]++; }
  if (y > -0.3 && y < 0.25 && isSkin(c)) { exL = Math.min(exL, x); exR = Math.max(exR, x); }
}
const eye = (a) => a.slice(0, 3).map((v) => v / a[3]);
const eL = eye(eyes.l), eR = eye(eyes.r), cx = (eL[0] + eR[0]) / 2;
for (let i = 0; i < n0; i++) if (Math.abs(P0[i * 3] - cx) < 0.04 && P0[i * 3 + 2] > 0.35) chin = Math.min(chin, P0[i * 3 + 1]);
let earZ = 0, ez = 0; for (let i = 0; i < n0; i++) { const x = P0[i * 3], y = P0[i * 3 + 1]; if (y > -0.3 && y < 0.25 && (x < exL + 0.06 || x > exR - 0.06) && isSkin(col(i))) { earZ += P0[i * 3 + 2]; ez++; } }
earZ /= ez;
const S = ALEX.earHalf / ((exR - exL) / 2);
const T = [-cx * S, ALEX.chinY - chin * S, ALEX.earZ - earZ * S];
const fit = (x, y, z) => [x * S + T[0], y * S + T[1], z * S + T[2]];
console.log(`raw: eyes L ${eL.map((v) => v.toFixed(3))} R ${eR.map((v) => v.toFixed(3))} · ears ±${((exR - exL) / 2).toFixed(3)} z ${earZ.toFixed(3)} · chin ${chin.toFixed(3)}`);
console.log(`fit: uniform scale ${S.toFixed(4)} · translate ${T.map((v) => v.toFixed(4))}`);

// ---- 3. positions: fit, then taper only the neck below the jaw into the base neck --------------------------------
const base = await loadBase();
const neckEll = (() => { // the base neck at the cut: half-widths + centre (from its NECK region, y 0.74–0.78)
  const { P, REG } = base.geo; let x0 = 9, x1 = -9, z0 = 9, z1 = -9;
  for (let i = 0; i < REG.length; i++) if (Math.round(REG[i]) === C.BODY_REGIONS.NECK && P[i * 3 + 1] > 0.74 && P[i * 3 + 1] < 0.78) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2]); }
  return { hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, cz: (z0 + z1) / 2 };
})();
const FP = new Float32Array(n0 * 3);
for (let i = 0; i < n0; i++) FP.set(fit(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]), i * 3);
// the fitted neck's own ellipse just under the jaw (where it is a clean cylinder), for the radial taper
const jawY = ALEX.chinY - 0.01;
let nx0 = 9, nx1 = -9, nz0 = 9, nz1 = -9; for (let i = 0; i < n0; i++) { const y = FP[i * 3 + 1]; if (y > CUT_Y && y < CUT_Y + 0.03) { nx0 = Math.min(nx0, FP[i * 3]); nx1 = Math.max(nx1, FP[i * 3]); nz0 = Math.min(nz0, FP[i * 3 + 2]); nz1 = Math.max(nz1, FP[i * 3 + 2]); } }
const own = { hx: (nx1 - nx0) / 2, hz: (nz1 - nz0) / 2, cx: (nx0 + nx1) / 2, cz: (nz0 + nz1) / 2 };
console.log(`neck at cut: Meshy ${(own.hx * 2).toFixed(3)}×${(own.hz * 2).toFixed(3)} → base ${(neckEll.hx * 2).toFixed(3)}×${(neckEll.hz * 2).toFixed(3)}`);
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let i = 0; i < n0; i++) {
  const y = FP[i * 3 + 1]; if (y >= jawY || FP[i * 3 + 2] > own.cz + own.hz + 0.05) continue;   // nothing at or above the jaw
  const t = 1 - sm(CUT_Y, jawY, y);                                                                // 1 at the cut … 0 at the jaw
  const sx = 1 + t * (neckEll.hx / own.hx - 1), sz = 1 + t * (neckEll.hz / own.hz - 1);
  FP[i * 3] = own.cx + (FP[i * 3] - own.cx) * sx;
  FP[i * 3 + 2] = (own.cz + t * (neckEll.cz - own.cz)) + (FP[i * 3 + 2] - own.cz) * sz;
}

// ---- 4. keep: everything above the raw floor (shelf/stub) and above the cut -----------------------------------------------------
const keepV = new Uint8Array(n0).map((_, i) => (P0[i * 3 + 1] > RAW_FLOOR && FP[i * 3 + 1] > CUT_Y - 0.004 ? 1 : 0));
const map = new Int32Array(n0).fill(-1); let m = 0; const I = [];
for (let t = 0; t < I0.length; t += 3) { const a = I0[t], b = I0[t + 1], c = I0[t + 2]; if (!keepV[a] || !keepV[b] || !keepV[c]) continue; for (const v of [a, b, c]) { if (map[v] < 0) map[v] = m++; I.push(map[v]); } }
const P = new Float32Array(m * 3), N = new Float32Array(m * 3), UV = new Float32Array(m * 2), J = new Uint8Array(m * 4), W = new Float32Array(m * 4);
const HEAD = base.JI.Head, NECK = base.JI.neck;
for (let v = 0; v < n0; v++) { const k = map[v]; if (k < 0) continue;
  P.set(FP.subarray(v * 3, v * 3 + 3), k * 3); N.set(N0.subarray(v * 3, v * 3 + 3), k * 3); UV.set(UV0.subarray(v * 2, v * 2 + 2), k * 2);
  const h = sm(CUT_Y, jawY - 0.03, P[k * 3 + 1]);                     // neck → Head over the lower neck
  J.set([HEAD, NECK, 0, 0], k * 4); W.set([h, 1 - h, 0, 0], k * 4); }
console.log(`kept ${m} verts, ${I.length / 3} tris (raw ${n0} / ${I0.length / 3})`);

// ---- 5. landmarks (fitted), skin tone (median face texel), write ---------------------------------------------------
const fe = (e) => fit(...e);
const L = fe(eL), R = fe(eR), sym = (L[0] - R[0]) / -2, ey = (L[1] + R[1]) / 2, ezz = (L[2] + R[2]) / 2;
const sk = []; for (let i = 0; i < n0; i += 7) { const c = col(i); if (P0[i * 3 + 2] > 0.3 && P0[i * 3 + 1] < 0 && P0[i * 3 + 1] > -0.45 && isSkin(c)) sk.push(c); }
const med = [0, 1, 2].map((q) => sk.map((c) => c[q]).sort((a, b) => a - b)[sk.length >> 1]);
const skinHex = "#" + med.map((v) => v.toString(16).padStart(2, "0")).join("");
const landmarks = { eyes: { l: [-sym, ey, ezz], r: [sym, ey, ezz], halfW: 0.07, halfH: 0.04 }, mouth: { c: [0, ALEX.chinY + 0.12, ezz], halfW: 0.07 }, bridge: [0, ey, ezz + 0.04], forward: [0, ey, ezz + 1], skin: skinHex, iris: "#1f1714" };
console.log(`fitted eyes ±${sym.toFixed(3)} y ${ey.toFixed(3)} z ${ezz.toFixed(3)} (Alex: ±0.152 y 1.178 z 0.322) · skin ${skinHex}`);
const webp = await sharp(jpeg).webp({ lossless: true }).toBuffer();   // pixel-identical to the decoded Meshy texture
const bytes = await writeModule(OUTF, base, [
  { name: "identity_head", P, N, I, UV, J, W, extraAttrs: { _PAINT: { type: "VEC4", array: new Uint8Array(m * 4) } }, material: { name: "identity_skin", texture: webp, roughness: 0.8 } },
], { humanIdentity: { id: "bon-meshy-head-v1", base: C.HUMAN_BASE_VERSION, source: "meshy image-to-3d 01a0ff53 (raw, fitted)", fit: { scale: +S.toFixed(5), translate: T.map((v) => +v.toFixed(5)) }, landmarks, hides: ["NECK"], hairFused: true } }, { compress: false });
console.log(`${OUTF} ${(bytes / 1048576).toFixed(1)} MB`);
fs.writeFileSync("scripts/avatar-pipeline/output/human-base/bon-meshy-fit.json", JSON.stringify({ S, T, eL, eR, ears: [exL, exR], earZ, chin, neckEll, own, landmarks }, null, 1));
