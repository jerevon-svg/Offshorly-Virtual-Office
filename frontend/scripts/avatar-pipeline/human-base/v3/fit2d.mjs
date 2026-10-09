// v3/fit2d.mjs — HumanBase V3 proof, VARIANT A: the canonical head built from 2D evidence ONLY (the approved Offshorly
// illustration). No Meshy / no 3D evidence anywhere. ZERO CREDITS. From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/fit2d.mjs --who=bon,kael,lui,nicole --mp=<mediapipe dir>
// Geometry: MediaPipe landmarks on the illustration → canonical landmark targets (front plane; depth stays canonical),
//   distinctiveness-preserving vertical mapping (face length keeps K of its deviation from the roster mean) → smooth
//   fold-free RBF warp of the canonical head.
// Appearance: the prepped illustration projected onto the canonical face (the illustration's own painted eyes/brows/lips).
// Hair: front hair silhouette + the same construction contract (complete head under hair, designed nape, ear tuck).
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";
import { loadBase, writeModule } from "../lib.mjs";
import { loadTemplate } from "./fit.mjs";
import { detect } from "./landmarks2d.mjs";
import { TriIndex, dilateGutter, pushPull, rasterUV, rbfWarp, triNormal, vertexNormals } from "./geom.mjs";
import { NP, NT, buildHairSolid, dirBin, finishMaps, headRadiusMap, regionBins, sampleMap } from "./hair.mjs";
import { finishHairMesh, neckExtension } from "./build.mjs";

const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const WHO = opt("who", "bon,kael,lui,nicole").split(","), MP = opt("mp", null), TEX = 2048, K_RETAIN = Number(opt("retain", 0.7));
const OUT = "scripts/avatar-pipeline/output/human-base/v3-proof";
const base = await loadBase(), tpl = loadTemplate(), HEAD = base.JI.Head, POP = JSON.parse(fs.readFileSync(`${OUT}/population-stats.json`, "utf8"));
const refOf = (w) => (w === "bon" ? "scripts/avatar-pipeline/output/human-base/meshy-ref/bon-head-ref-final.png" : `scripts/avatar-pipeline/output/human-base/meshy-ref/${w}/${w}-ref-final.png`);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
let shoulderY = -Infinity; for (let i = 0; i < base.geo.P.length / 3; i++) { const x = Math.abs(base.geo.P[i * 3]); if (x > 0.16 && x < 0.3 && base.geo.P[i * 3 + 1] < 0.95) shoulderY = Math.max(shoulderY, base.geo.P[i * 3 + 1]); }
const ring = tpl.neckRing; let ncx = 0, ncz = 0, nyy = 0; for (const r of ring) { ncx += r.p[0] / ring.length; ncz += r.p[2] / ring.length; nyy += r.p[1] / ring.length; }
let nr = 0; for (const r of ring) nr += Math.hypot(r.p[0] - ncx, r.p[2] - ncz) / ring.length;

const det = await detect(MP, WHO.map(refOf));
for (const [wi, who] of WHO.entries()) {
  const t0 = Date.now(), D = det[wi], report = { who, variant: "A", evidence: { file: D.file, faceFound: D.found } };
  if (!D.found) { console.log(`${who} A: FAIL CLOSED — no face found in the illustration`); continue; }
  const Lm = D.landmarks, img = await (async () => { const { data, info } = await sharp(D.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, W: info.width, H: info.height }; })();
  const px = (x, y) => { const X = Math.max(0, Math.min(img.W - 1, Math.round(x))), Y = Math.max(0, Math.min(img.H - 1, Math.round(y))), o = (Y * img.W + X) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]; };
  // ---- 1. image ↔ canonical frame (front plane) ------------------------------------------------------------------------
  const { P: X0, I, n, region: R, REGION: RG, landmarks: TL } = tpl, at0 = (i) => [X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2]];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], eyeImg = mid(Lm[468], Lm[473]), cxImg = (Lm[234][0] + Lm[454][0]) / 2, Wimg = Math.abs(Lm[454][0] - Lm[234][0]);
  const yE3 = (at0(TL.eyeL)[1] + at0(TL.eyeR)[1]) / 2;
  let W3 = 0; for (let i = 0; i < n; i++) if (Math.abs(X0[i * 3 + 1] - (yE3 - 0.08)) < 0.012 && X0[i * 3 + 2] > tpl.centre[2] && R[i] !== RG.earL && R[i] !== RG.earR) W3 = Math.max(W3, Math.abs(X0[i * 3]));
  W3 *= 2; const s = W3 / Wimg;
  const Lill = Math.abs(Lm[152][1] - eyeImg[1]) / Wimg, Ltpl = Math.abs(at0(TL.chin)[1] - yE3) / W3, mu = POP.sprites.stats.faceLength.mean;
  const Lmapped = Ltpl * (1 + K_RETAIN * (Lill / mu - 1)), vs = Lmapped / Lill;   // DISTINCTIVENESS-PRESERVING vertical map
  // piecewise: the style's vertical map applies to the LOWER face only; the cranium maps at the skull scale
  const to3 = (q) => [(q[0] - cxImg) * s, yE3 - (q[1] - eyeImg[1]) * s * (q[1] > eyeImg[1] ? vs : 1)];
  const toImg = (x3, y3) => [cxImg + x3 / s, eyeImg[1] + (yE3 - y3) / (s * (y3 < yE3 ? vs : 1))];
  report.mapping = { Lill: +Lill.toFixed(3), rosterMean: +mu.toFixed(3), Lmapped: +Lmapped.toFixed(3), verticalScale: +vs.toFixed(3), retain: K_RETAIN };
  // ---- 2. landmark targets on the front plane (depth stays canonical) + smooth fold-free warp ------------------------
  const pairs = [[TL.eyeL, Lm[468]], [TL.eyeR, Lm[473]], [TL.mouth, mid(Lm[13], Lm[14])], [TL.noseTip, Lm[1]], [TL.chin, Lm[152]], [TL.cheekL, Lm[234]], [TL.cheekR, Lm[454]], [TL.jawL, Lm[172]], [TL.jawR, Lm[397]]];
  const cen = [], dis = [];
  for (const [vi, q] of pairs) { const p = at0(vi), t = to3(q); cen.push(p); dis.push([t[0] - p[0], t[1] - p[1], 0]); }
  for (const k of ["crown", "occiput", "nape", "earLtop", "earRtop", "earLlobe", "earRlobe"]) { cen.push(at0(TL[k])); dis.push([0, 0, 0]); }
  const flips = (Y) => { let f = 0; for (let t = 0; t < I.length / 3; t++) { const a = triNormal(X0, I, t), b = triNormal(Y, I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) f++; } return f; };
  let X = null, sigma = null; for (const sg of [0.13, 0.18, 0.24, 0.32]) { const W2 = rbfWarp(X0, cen, dis, sg); if (!flips(W2)) { X = W2; sigma = sg; break; } }
  if (!X) { console.log(`${who} A: FAIL CLOSED — no fold-free warp`); continue; }
  const N = vertexNormals(X, I); report.fit = { sigma, folds: 0, landmarks: pairs.length };
  const at = (i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], centre = [0, (at(TL.earLroot)[1] + at(TL.earRroot)[1]) / 2, (at(TL.earLroot)[2] + at(TL.earRroot)[2]) / 2];
  // ---- 3. hair from the front silhouette ------------------------------------------------------------------------------
  // hair colour: the dominant non-skin colour above the forehead; hair mask: opaque pixels close to it (or darker)
  const skinC = px(Lm[50][0], Lm[50][1]), top = []; for (let y = 0; y < eyeImg[1] - 0.6 * Wimg; y += 3) for (let x = cxImg - 0.6 * Wimg; x < cxImg + 0.6 * Wimg; x += 3) { const c = px(x, y); if (c[3] > 200 && lum(c) < lum(skinC) * 0.7) top.push(c); }
  top.sort((a, b) => lum(a) - lum(b)); const hairC = top[Math.floor(top.length / 2)] ?? [40, 32, 30, 255];
  const isHair = (x, y) => { const c = px(x, y); return c[3] > 128 && Math.hypot(c[0] - hairC[0], c[1] - hairC[1], c[2] - hairC[2]) < 70 && lum(c) < lum(skinC) * 0.75; };
  const headR = headRadiusMap(X, centre), RB = regionBins(X, centre, R), mask = new Uint8Array(NT * NP), T = new Float32Array(NT * NP);
  const sideT = new Float32Array(NT).fill(0), sideN = new Float32Array(NT);
  for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p, th = (t + 0.5) / NT * Math.PI, ph = (p + 0.5) / NP * 2 * Math.PI - Math.PI, d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    if (d[2] < -0.1) continue;   // back: decided below
    const q = [centre[0] + d[0] * headR[k], centre[1] + d[1] * headR[k], centre[2] + d[2] * headR[k]], [ix, iy] = toImg(q[0], q[1]);
    const face = RB[k] === RG.face || RB[k] === RG.eyeL || RB[k] === RG.eyeR || RB[k] === RG.nose || RB[k] === RG.mouth || RB[k] === RG.jaw;
    if (!isHair(ix, iy) || (face && q[1] < yE3 + 0.05) || (RB[k] === RG.under && iy < Lm[152][1])) continue;
    // thickness: march outward in the image (away from the head centre's projection) to the silhouette edge
    const [cx2, cy2] = toImg(centre[0], centre[1]); let ux = ix - cx2, uy = iy - cy2; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    let dpx = 0; while (dpx < 0.5 * Wimg && isHair(ix + ux * dpx, iy + uy * dpx)) dpx += 2;
    mask[k] = 1; T[k] = Math.min(0.15, Math.max(0.026, dpx * s * Math.max(0.3, Math.hypot(d[0], d[1])))); if (Math.abs(d[2]) < 0.35) { sideT[t] += T[k]; sideN[t]++; } }
  // back of the head: the illustration cannot see it — hair continues from the sides/crown down to the designed nape line
  let crown = 0, crownN = 0; for (let t = 0; t < NT * 0.2; t++) for (let p = 0; p < NP; p++) { crownN++; if (mask[t * NP + p]) crown++; }
  const backCover = crownN ? crown / crownN : 0; report.hair = { hairColour: hairC.slice(0, 3), crownCoverage: +backCover.toFixed(3) };
  for (let t = 0; t < NT; t++) { const st = sideN[t] ? sideT[t] / sideN[t] : 0.03;
    for (let p = 0; p < NP; p++) { const k = t * NP + p, th = (t + 0.5) / NT * Math.PI, ph = (p + 0.5) / NP * 2 * Math.PI - Math.PI, dz = Math.sin(th) * Math.sin(ph);
      if (dz >= -0.1) continue; if (backCover > 0.5 && RB[k] !== RG.under && RB[k] !== RG.earL && RB[k] !== RG.earR) { mask[k] = 1; T[k] = Math.max(0.026, st); } } }
  const maps = finishMaps(T, mask, 0.026);
  const earVerts = { l: [], r: [] }; for (let i = 0; i < n; i++) { if (R[i] === RG.earL) earVerts.l.push(i); if (R[i] === RG.earR) earVerts.r.push(i); }
  const sideOf = (i) => (R[i] === RG.earL ? "l" : R[i] === RG.earR ? "r" : null), earTriSide = []; for (let t = 0; t < I.length / 3; t++) earTriSide.push(sideOf(I[t * 3]) && sideOf(I[t * 3]) === sideOf(I[t * 3 + 1]) && sideOf(I[t * 3]) === sideOf(I[t * 3 + 2]) ? sideOf(I[t * 3]) : null);
  const hs = buildHairSolid({ P: X, I }, { centre, headR, T: maps.T, Ms: maps.Ms, ears: { verts: earVerts, index: new TriIndex(X, I, 0.02, (t) => earTriSide[t] !== null), side: earTriSide }, neck: { cx: ncx, cz: ncz, r: nr, y1: centre[1] }, floorY: shoulderY + 0.015 });
  report.hair.earMode = hs.earMode; report.hair.rawTris = hs.I.length / 3;
  const earIdxA = new TriIndex(X, I, 0.02, (t) => earTriSide[t] !== null);
  const { P: hairP, I: hairI } = finishHairMesh(hs, report, { H: { S: hs.headSDF.S, ...hs.grid }, earIndex: earIdxA, earSide: earTriSide, earMode: hs.earMode }); const hairN = vertexNormals(hairP, hairI), nh = hairP.length / 3;
  const HC = new Float32Array(nh * 4); for (let i = 0; i < nh; i++) HC.set([hairC[0] / 255, hairC[1] / 255, hairC[2] / 255, 1], i * 4);
  // ---- 4. texture: the illustration projected onto the canonical face; skin elsewhere; hair base under the hair ------
  const cover = new Float32Array(n); for (let i = 0; i < n; i++) { const [th, ph] = dirBin(X[i * 3] - centre[0], X[i * 3 + 1] - centre[1], X[i * 3 + 2] - centre[2]); cover[i] = smooth(0.35, 0.6, sampleMap(maps.Ms, th, ph)); }
  const S = TEX, RGB = new Float32Array(S * S * 3), known = new Uint8Array(S * S), cov = new Float32Array(S * S), inside = new Uint8Array(S * S), src = tpl.uv.src, UI = tpl.uv.I;
  rasterUV(tpl.uv.UV, UI, S, (g, t, w0, w1, w2) => { const a = src[UI[t * 3]], b = src[UI[t * 3 + 1]], c = src[UI[t * 3 + 2]];
    const p = [0, 1, 2].map((q) => X[a * 3 + q] * w0 + X[b * 3 + q] * w1 + X[c * 3 + q] * w2), nz = N[a * 3 + 2] * w0 + N[b * 3 + 2] * w1 + N[c * 3 + 2] * w2;
    inside[g] = 1; cov[g] = cover[a] * w0 + cover[b] * w1 + cover[c] * w2;
    if (nz < 0.25 || p[2] < centre[2]) return; const [ix, iy] = toImg(p[0], p[1]), col = px(ix, iy); if (col[3] < 128) return;
    RGB[g * 3] = col[0]; RGB[g * 3 + 1] = col[1]; RGB[g * 3 + 2] = col[2]; known[g] = 1; });
  const skinLike = new Uint8Array(S * S); for (let g = 0; g < S * S; g++) if (known[g] && Math.hypot(RGB[g * 3] - skinC[0], RGB[g * 3 + 1] - skinC[1], RGB[g * 3 + 2] - skinC[2]) < 60) skinLike[g] = 1;
  const filled = pushPull(RGB, skinLike, S); for (let g = 0; g < S * S; g++) if (known[g]) for (let q = 0; q < 3; q++) filled[g * 3 + q] = RGB[g * 3 + q];
  const scalp = hairC.slice(0, 3).map((v) => v * 0.85), out = Buffer.alloc(S * S * 3);
  for (let g = 0; g < S * S; g++) { const k = inside[g] ? cov[g] : 0; for (let q = 0; q < 3; q++) out[g * 3 + q] = Math.max(0, Math.min(255, Math.round(filled[g * 3 + q] * (1 - k) + scalp[q] * k))); }
  dilateGutter(out, inside, S);
  const webp = await sharp(out, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 92 }).toBuffer();
  // ---- 5. write ---------------------------------------------------------------------------------------------------------
  const uvN = src.length, HP = new Float32Array(uvN * 3), HN = new Float32Array(uvN * 3); for (let j = 0; j < uvN; j++) { const i = src[j]; HP.set(at(i), j * 3); HN.set([N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], j * 3); }
  const rigid = (m) => { const J = new Uint8Array(m * 4), W = new Float32Array(m * 4); for (let i = 0; i < m; i++) { J[i * 4] = HEAD; W[i * 4] = 1; } return { J, W }; };
  const hr = rigid(uvN), hh = rigid(nh), hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const ear = (S2) => ({ root: at(TL[`ear${S2}root`]), outer: at(TL[`ear${S2}outer`]), top: at(TL[`ear${S2}top`]), lobe: at(TL[`ear${S2}lobe`]), back: at(TL[`ear${S2}back`]), measured: true, canonical: true });
  const eyeHW = Math.abs(Lm[133][0] - Lm[33][0]) / 2 * s;
  const L = { eyes: { l: at(TL.eyeL), r: at(TL.eyeR), halfW: eyeHW, halfH: eyeHW * 0.4 }, mouth: { c: at(TL.mouth), halfW: Math.abs(Lm[291][0] - Lm[61][0]) / 2 * s }, bridge: at(TL.noseTip), forward: [0, at(TL.eyeL)[1], 2], skin: hex(skinC), iris: "#1f1714", attach: { v: 1, centre, ears: { l: ear("L"), r: ear("R") }, nose: { tip: at(TL.noseTip) }, crown: at(TL.crown), forehead: at(TL.forehead) } };
  const meshes = [
    { name: "identity_head", P: HP, N: HN, I: Array.from(UI), UV: tpl.uv.UV, J: hr.J, W: hr.W, extraAttrs: { _PAINT: { type: "VEC4", array: new Float32Array(uvN * 4) } }, material: { name: "identity_skin", texture: webp, roughness: 0.9 } },
    { name: "identity_hair_main", P: hairP, N: hairN, I: Array.from(hairI), J: hh.J, W: hh.W, extraAttrs: { _PAINT: { type: "VEC4", array: HC }, _FLOW: { type: "VEC3", array: new Float32Array(nh * 3) }, _CLUMP: { type: "SCALAR", array: new Float32Array(nh) } }, material: { name: "identity_hair", roughness: 0.9 } },
    neckExtension(),
  ];
  const dir = `${OUT}/${who}/A/pass1`, file = `${dir}/${who}-v1.glb`;
  await writeModule(file, base, meshes, { humanIdentity: { id: `${who}-v3a`, base: "human-base-v1", source: D.file, v3: { template: tpl.id, variant: "A", pipeline: "humanbase-v3-proof-1" }, landmarks: L, hides: [], hairFused: false, hairMotion: "short" } }, { compress: false });
  const bytes = fs.readFileSync(file); report.artifactHash = crypto.createHash("sha256").update(bytes).digest("hex"); report.bytes = bytes.length; report.counts = { headTris: UI.length / 3, hairTris: hairI.length / 3 };
  report.timings = { total: Date.now() - t0 };
  fs.writeFileSync(`${dir}/qa-geometry.json`, JSON.stringify({ X: Array.from(X), hairP: Array.from(hairP), hairI: Array.from(hairI), centre, T: Array.from(maps.T), Ms: Array.from(maps.Ms), earMode: hs.earMode }));
  fs.writeFileSync(`${dir}/build.json`, JSON.stringify(report, null, 1));
  console.log(`${who} A: ${file} ${(bytes.length / 1e6).toFixed(2)} MB · ${JSON.stringify(report.mapping)} · hair ${JSON.stringify({ ...report.hair, topology: report.hair.topology?.components })} · ${report.timings.total} ms`);
}
