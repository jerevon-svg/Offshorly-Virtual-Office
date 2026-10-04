// build-bon-chibi-head.mjs — BON AS A SOFT-3D OFFSHORLY CHIBI ON THE ALEX SKULL + MESHY HAIR. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-bon-chibi-head.mjs
//
// Architecture:  Alex neutral head (skull, neck seam, weights)  →  Bon's illustrated face as soft-3D features
//                + Bon's Meshy hair, extracted from the raw fused mesh (a COPY) and fitted around the Alex skull.
// Inputs (read only): identity/alex-neutral-head-v1.glb · meshy-employees/bon-head-v1/raw-untouched/*.glb
//                     · output/human-base/bon-meshy-fit.json (the earlier uniform fit, reused for the hair)
// Outputs: identity/bon-chibi-head-v1.glb (identity slot, HEAD ONLY — the HumanBase neck stays the body's)
//          hair/bon-meshy-hair-v1.glb (hair slot — modular, swappable)
//
// The face is NOT Meshy's anatomy and NOT Alex's: it is Bon's illustration (bon-head-ref-final.png) re-drawn in
// geometry — almond half-lidded eyes enlarged to the chibi family, heavy angled brows, a small soft nose, a simple
// closed smile, soft cheeks, a slightly wider jaw corner. Each feature is its own part (eyes, lids, brows, mouth), so
// blink / look / talk can later move them without re-authoring the skin.
import fs from "node:fs";
import sharp from "sharp";
import * as THREE from "three";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, adjacency, computeNormals, io, loadBase, taubin, weldNormals, writeModule } from "./lib.mjs";

const base = await loadBase();
const HEAD = base.JI.Head;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

// ================================ THE PALETTE (from the approved illustration) ====================================
const SKIN = hex("#fbc4a0"), SKIN_SH = hex("#e9a988"), BLUSH = hex("#f2a08c"), LIP = hex("#7a4637"), LIP_SOFT = hex("#b9776a");
const BROW = hex("#1c1513"), LASH = hex("#151010"), SCLERA = hex("#f3efe9"), IRIS_OUT = hex("#2b1b15"), IRIS_IN = hex("#140d0a"), PUPIL = hex("#070505");
const UNDER = hex("#c98b70"), CREASE = hex("#d79b7c");

// ================================ 1. THE HEAD: a copy of the Alex neutral head ======================================
const nhDoc = await io.read(`${BASE_OUT}/identity/alex-neutral-head-v1.glb`);
const nh = nhDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = Float32Array.from(nh.getAttribute("POSITION").getArray()), I = Array.from(nh.getIndices().getArray());
const J = Array.from(nh.getAttribute("JOINTS_0").getArray()), W = Array.from(nh.getAttribute("WEIGHTS_0").getArray());
const n = P.length / 3;
const neutralLm = (nhDoc.getRoot().listScenes()[0].getExtras()).humanIdentity.landmarks;
console.log(`neutral head: ${n} verts, ${I.length / 3} tris · Alex eyes ±${neutralLm.eyes.r[0].toFixed(3)} y ${neutralLm.eyes.r[1].toFixed(3)}`);

// front height map of the (unsculpted) face: z(x, y) by rasterising front-facing triangles
const HM = { x0: -0.48, y0: 0.78, s: 0.002, nx: 480, ny: 460 };
const zbuf = new Float32Array(HM.nx * HM.ny).fill(-9);
{ const N0 = computeNormals(P, I);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2]; if (N0[a * 3 + 2] + N0[b * 3 + 2] + N0[c * 3 + 2] < 0) continue;
    const q = [a, b, c].map((v) => [(P[v * 3] - HM.x0) / HM.s, (P[v * 3 + 1] - HM.y0) / HM.s, P[v * 3 + 2]]);
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(HM.ny - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(HM.nx - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2]; const k = y * HM.nx + x; if (z > zbuf[k]) zbuf[k] = z;
      } } }
const surf = (x, y) => { const fx = (x - HM.x0) / HM.s, fy = (y - HM.y0) / HM.s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const g = (i, j) => zbuf[Math.min(HM.ny - 1, Math.max(0, j)) * HM.nx + Math.min(HM.nx - 1, Math.max(0, i))];
  return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty; };

// ================================ 2. THE FACE LAYOUT (Bon, on the Alex face) =========================================
// Alex's compact chibi face: chin 0.809, his eye line 1.178. Bon's eyes sit a touch lower and closer, his own shape.
const CHIN = 0.809;
const EYE = { x: 0.168, y: 1.16, hw: 0.112, hh: 0.076 };       // almond half-width / half-height (fully open)
const LID = 0.34;                                                // upper lid rest: the lid line, as a fraction of hh above centre
const BROWY = EYE.y + EYE.hh * 0.95 + 0.05;
const NOSE = { y: 1.045, w: 0.036, h: 0.05, p: 0.026 };          // small soft nose: half-width, half-height, projection
const MOUTH = { y: 0.925, hw: 0.074, smile: 0.016 };
// almond outline in eye-local units (u: -1 inner … +1 outer, v: -1 … 1): Bon's sleepy almond — pointed corners,
// a fuller lower curve, the outer corner a touch low
const upperV = (u) => Math.pow(Math.max(0, 1 - u * u), 0.72) * (1 - 0.08 * u) - 0.04 * u;
const lowerV = (u) => -0.72 * Math.pow(Math.max(0, 1 - u * u), 1.05) - 0.04 * u;
const lidV = (u) => LID - 0.06 * u;                              // the lid line slants down to the outer corner
const inAlmond = (u, v) => Math.abs(u) <= 1 && v <= upperV(u) && v >= lowerV(u);

// ================================ 3. SCULPT THE SKIN (smooth, small) ================================================
{ const { nb, rep } = adjacency(P, I); const use = new Map(); for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = rep[I[t + k]], b = rep[I[t + (k + 1) % 3]], kk = a < b ? a + "_" + b : b + "_" + a; use.set(kk, (use.get(kk) ?? 0) + 1); }
  const edge = new Uint8Array(n); for (const [kk, c] of use) if (c === 1) { const [a, b] = kk.split("_").map(Number); edge[a] = edge[b] = 1; }
  const free = new Uint8Array(n).map((_, i) => (!edge[i] && P[i * 3 + 2] > 0.02 && P[i * 3 + 1] < 1.04 && P[i * 3 + 1] > 0.79 ? 1 : 0));
  taubin(P, nb, rep, free, 30, 0.5, -0.505); }
const N1 = weldNormals(P, computeNormals(P, I));
const PAINT = new Float32Array(n * 4);
for (let i = 0; i < n; i++) {
  let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
  if (z < 0) { PAINT.set([...SKIN, 1], i * 4); continue; }
  const ax = Math.abs(x); let d = 0;
  // nose: a small rounded button, the tip a little low and soft (no bridge, no nostril anatomy)
  { const nx = x / NOSE.w, ny = (y - NOSE.y) / NOSE.h, r2 = nx * nx + ny * ny * (ny > 0 ? 0.55 : 1.3); if (r2 < 1) d += NOSE.p * Math.pow(1 - r2, 1.6); }
  // eye sockets: a shallow almond hollow the eye sits in
  { const u = (ax - EYE.x) / (EYE.hw * 1.12), v = (y - EYE.y) / (EYE.hh * 1.25), r2 = u * u + v * v; if (r2 < 1) d -= 0.012 * Math.pow(1 - r2, 1.5); }
  // soft cheeks
  { const u = (ax - 0.205) / 0.11, v = (y - 1.0) / 0.09, r2 = u * u + v * v; if (r2 < 1) d += 0.012 * Math.pow(1 - r2, 2); }
  // brow ridge, under the brows
  { const u = (ax - 0.16) / 0.13, v = (y - BROWY) / 0.04, r2 = u * u + v * v; if (r2 < 1) d += 0.005 * Math.pow(1 - r2, 2); }
  // the smile: a soft crease along the mouth line, a hint of upper-lip roundness above it
  { const lx = x / MOUTH.hw, ly = MOUTH.y + MOUTH.smile * lx * lx; if (Math.abs(lx) < 1.15) { const dy = y - ly, fall = sm(1.15, 0.85, Math.abs(lx)); d -= 0.004 * Math.exp(-(dy * dy) / (2 * 0.004 * 0.004)) * fall; d += 0.003 * Math.exp(-((dy - 0.012) ** 2) / (2 * 0.008 * 0.008)) * fall; } }
  for (let k = 0; k < 3; k++) P[i * 3 + k] += N1[i * 3 + k] * d;
  // Bon's wider, slightly squarer jaw corner (the illustration's jaw), inside a smooth band — never above the cheeks
  { const band = sm(0.79, 0.86, y) * (1 - sm(0.93, 1.02, y)), side = sm(0.08, 0.22, ax); P[i * 3] *= 1 + 0.045 * band * side; }
  x = P[i * 3]; y = P[i * 3 + 1];
  // paint: skin, blush, the soft shadow under the nose, the lower-lip hint
  let c = SKIN.slice();
  { const u = (Math.abs(x) - 0.21) / 0.075, v = (y - 1.0) / 0.05, r2 = u * u + v * v; if (r2 < 1) c = mix(c, BLUSH, 0.28 * Math.pow(1 - r2, 1.5)); }
  { const u = x / 0.04, v = (y - (NOSE.y - NOSE.h * 0.55)) / 0.018, r2 = u * u + v * v; if (r2 < 1) c = mix(c, SKIN_SH, 0.75 * Math.pow(1 - r2, 1.2)); }
  { const u = x / 0.03, v = (y - (MOUTH.y - 0.026)) / 0.006, r2 = u * u + v * v; if (r2 < 1) c = mix(c, LIP_SOFT, 0.55 * Math.pow(1 - r2, 1.2)); }
  PAINT.set([...c, 1], i * 4);
}
// Alex's source mesh carries a few inward-wound triangles on the cranium (dark flecks when lit): re-orient them outward
{ let flipped = 0; const C0 = [0, 1.22, -0.03];
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2];
    const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3; if (cy < 1.0 || (Math.abs(cx) > 0.34 && cy < 1.32)) continue;   // cranium, not ears
    const e1 = [0, 1, 2].map((q) => P[b * 3 + q] - P[a * 3 + q]), e2 = [0, 1, 2].map((q) => P[c * 3 + q] - P[a * 3 + q]);
    const nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const r = [0, 1, 2].map((q) => (P[a * 3 + q] + P[b * 3 + q] + P[c * 3 + q]) / 3 - C0[q]);
    if (nr[0] * r[0] + nr[1] * r[1] + nr[2] * r[2] < 0) { I[t + 1] = c; I[t + 2] = b; flipped++; } }
  console.log(`head: re-oriented ${flipped} inward cranium triangles`); }
const N = weldNormals(P, computeNormals(P, I));
const surfNow = (x, y) => surf(x, y) + 0;   // features are placed on the sculpted surface below via local offsets

// ================================ 4. FEATURE PARTS (vertex-coloured soft-3D) ========================================
// a grid patch over a feature's box, positioned on the face surface; colour/height per vertex from analytic shapes
function patch(nu, nv, toXY, shade, keep) {
  const Pp = [], Cc = [], idx = new Int32Array((nu + 1) * (nv + 1)).fill(-1), Ip = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv; if (!keep(u, v)) continue;
    const [x, y] = toXY(u, v), s = shade(u, v, x, y); if (!s) continue;
    idx[j * (nu + 1) + i] = Pp.length / 3; Pp.push(x, y, s.z); Cc.push(...s.c);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = idx[j * (nu + 1) + i], b = idx[j * (nu + 1) + i + 1], c = idx[(j + 1) * (nu + 1) + i], d = idx[(j + 1) * (nu + 1) + i + 1];
    if (a >= 0 && b >= 0 && d >= 0) Ip.push(a, b, d); if (a >= 0 && d >= 0 && c >= 0) Ip.push(a, d, c);
  }
  return { P: Pp, C: Cc, I: Ip };
}
function merge(parts) { const out = { P: [], C: [], I: [] }; for (const p of parts) { const o = out.P.length / 3; for (const v of p.P) out.P.push(v); for (const v of p.C) out.C.push(v); for (const v of p.I) out.I.push(v + o); } return out; }
// sculpt-aware surface: the original face height + the same feature displacement used on the skin
const dispAt = (x, y) => { const ax = Math.abs(x); let d = 0;
  { const nx = x / NOSE.w, ny = (y - NOSE.y) / NOSE.h, r2 = nx * nx + ny * ny * (ny > 0 ? 0.55 : 1.3); if (r2 < 1) d += NOSE.p * Math.pow(1 - r2, 1.6); }
  { const u = (ax - EYE.x) / (EYE.hw * 1.12), v = (y - EYE.y) / (EYE.hh * 1.25), r2 = u * u + v * v; if (r2 < 1) d -= 0.012 * Math.pow(1 - r2, 1.5); }
  { const u = (ax - 0.205) / 0.11, v = (y - 1.0) / 0.09, r2 = u * u + v * v; if (r2 < 1) d += 0.012 * Math.pow(1 - r2, 2); }
  { const u = (ax - 0.16) / 0.13, v = (y - BROWY) / 0.04, r2 = u * u + v * v; if (r2 < 1) d += 0.005 * Math.pow(1 - r2, 2); }
  return d; };
const S = (x, y) => surf(x, y) + dispAt(x, y) * 0.92;            // ~z of the sculpted skin (normals mostly +z on the face)

// ---- EYES: one domed almond per side — the eyeball (sclera, big dark iris, catchlights) under a skin lid with a heavy
// lash band. The lid is a separate ledge in front of the eyeball: blink = the lid line moving down.
function eyePart(side) {
  const NU = 220, NV = 150, M = 1.1;                                // grid, with a skin margin ring outside the almond
  return patch(NU, NV, (u, v) => [side * (EYE.x + (u * 2 - 1) * EYE.hw * M), EYE.y + (v * 2 - 1) * EYE.hh * M],
    (u0, v0, x, y) => {
      const u = (u0 * 2 - 1) * M, v = (v0 * 2 - 1) * M;            // u: + is OUTER for both sides (x mirrored above)
      const base = S(x, y);
      const up = upperV(u), lo = lowerV(u), lid = lidV(u);
      if (!inAlmond(u, v)) {                                      // margin: skin, flush on the skin
        const ed = Math.min(Math.abs(v - up), Math.abs(v - lo), Math.abs(Math.abs(u) - 1) * 2);
        if (ed > 0.16) return null;
        let c = SKIN.slice(); if (v < lo + 0.02 && v > lo - 0.09 && Math.abs(u) < 0.95) c = mix(c, UNDER, 0.55 * Math.max(0, 1 - Math.abs(v - (lo - 0.035)) / 0.055) * sm(0.95, 0.6, Math.abs(u)));
        if (v > up && v < up + 0.06 && Math.abs(u) < 1) c = mix(c, hex("#b07c66"), 0.45 * sm(0.04, 0.0, v - up) * sm(1.0, 0.7, Math.abs(u)));   // a thin upper outline, soft
        return { z: base + 0.0008, c };
      }
      const r2 = Math.min(1, u * u * 0.85 + v * v * 0.9);
      if (v > lid) {                                              // the upper lid (skin) with the lash band on its edge
        const t = (v - lid) / Math.max(1e-3, up - lid);
        let c = mix(SKIN, CREASE, 0.25 * sm(0.55, 0.9, t));
        const lash = 0.13 + 0.05 * Math.max(0, u);                  // thicker toward the outer corner
        if (v - lid < lash) c = mix(LASH, c, sm(lash * 0.6, lash * 1.05, v - lid));
        return { z: base + 0.006 + 0.014 * (1 - r2) + 0.003 * sm(0.0, 0.25, t), c };
      }
      // the eyeball: domed; iris large, set slightly toward the inner corner, half under the lid
      const ix = u, iy = v - (lid - 0.5), ir = Math.hypot(ix * 0.95, iy * 1.15);
      let c = SCLERA.slice();
      c = mix(c, hex("#d8d0c8"), 0.45 * sm(-0.22, 0.0, v - lid));          // the lid's shadow on the white
      c = mix(c, hex("#d9cfc6"), 0.4 * sm(0.75, 1.0, Math.abs(u)));            // corners
      if (ir < 0.5) { const t = ir / 0.5; c = mix(IRIS_IN, IRIS_OUT, sm(0.35, 0.95, t)); if (ir < 0.2) c = mix(PUPIL, c, sm(0.14, 0.2, ir)); if (t > 0.92) c = mix(c, hex("#0d0807"), sm(0.92, 1.0, t)); }
      const hl = Math.hypot((ix - 0.2) * 1.2, (iy - 0.14) * 1.4), hl2 = Math.hypot(ix + 0.16, iy + 0.2);
      if (hl < 0.12) c = mix(c, [1, 1, 1], sm(0.12, 0.07, hl));
      if (hl2 < 0.055) c = mix(c, [1, 1, 1], 0.85 * sm(0.055, 0.03, hl2));
      if (v < lo + 0.07) c = mix(c, hex("#b98a77"), 0.5 * sm(lo + 0.07, lo, v));  // lower rim
      const edgeV = Math.min(up - v, v - lo), edgeU = 1 - Math.abs(u), edge = Math.min(edgeV * 1.2, edgeU * 0.9);
      c = mix(hex("#9c6e5e"), c, sm(0.0, 0.06, edge));                           // a soft rim where the white meets the skin
      return { z: base + 0.0008 - 0.003 * sm(0.0, 0.12, edge) + 0.016 * (1 - r2) * sm(0.0, 0.25, edge), c };
    }, () => true);
}
// mirror the left eye's winding (x flipped)
const flipWinding = (p) => { for (let t = 0; t < p.I.length; t += 3) { const a = p.I[t + 1]; p.I[t + 1] = p.I[t + 2]; p.I[t + 2] = a; } return p; };
const eyes = merge([eyePart(1), flipWinding(eyePart(-1))]);

// ---- BROWS: heavy, flat, squared at the inner end, tapering and dropping slightly to the outer end (the illustration)
function browPart(side) {
  return patch(96, 16, (u, v) => { const t = u, x = side * (0.065 + 0.205 * t); const h = 0.048 * Math.pow(1 - t, 0.55) * (0.82 + 0.18 * sm(0, 0.12, t)) + 0.004; const yc = BROWY + 0.004 + 0.008 * Math.sin(Math.PI * Math.min(1, t * 1.3)) - 0.006 * t * t; return [x, yc + (v - 0.5) * h]; },
    (u, v, x, y) => { const bev = 1 - Math.pow(Math.abs(v * 2 - 1), 3); const endT = sm(1.0, 0.94, u) * sm(0.0, 0.03, u);
      return { z: S(x, y) + 0.004 + 0.006 * bev * endT, c: mix(BROW, hex("#3a2b26"), 0.18 * Math.max(0, v - 0.6)) }; }, () => true);
}
const brows = merge([browPart(1), flipWinding(browPart(-1))]);

// ---- MOUTH: the simple closed smile line (thicker in the middle, fine at the corners, corners lifted)
const mouth = patch(64, 6, (u, v) => { const lx = u * 2 - 1, x = lx * MOUTH.hw, w = 0.0055 * (1 - 0.65 * lx * lx); return [x, MOUTH.y + MOUTH.smile * lx * lx + (v - 0.5) * w * 2]; },
  (u, v, x, y) => ({ z: S(x, y) - 0.0015 + 0.0024, c: mix(LIP, hex("#5e352a"), 0.4 * (1 - Math.abs(v * 2 - 1))) }), () => true);

// ================================ 5. THE HAIR: Meshy's, extracted from a copy and fitted around the Alex skull ======
const fitJ = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/output/human-base/bon-meshy-fit.json", "utf8"));
const rawDoc = await io.read("scripts/avatar-pipeline/output/meshy-employees/bon-head-v1/raw-untouched/bon-head-v1-raw-model.glb");
const rp = rawDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const RP = rp.getAttribute("POSITION").getArray(), RN = rp.getAttribute("NORMAL").getArray(), RUV = rp.getAttribute("TEXCOORD_0").getArray(), RI = rp.getIndices().getArray();
const rn = RP.length / 3, rt = RI.length / 3;
const jpeg = Buffer.from(rawDoc.getRoot().listTextures()[0].getImage());
const { data: tx, info: ti } = await sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const texL = (u, v) => { const x = Math.min(ti.width - 1, Math.max(0, Math.round(u * (ti.width - 1)))), y = Math.min(ti.height - 1, Math.max(0, Math.round(v * (ti.height - 1)))); const o = (y * ti.width + x) * 3; return 0.3 * tx[o] + 0.59 * tx[o + 1] + 0.11 * tx[o + 2]; };
const hairT = new Uint8Array(rt);
for (let t = 0; t < rt; t++) { const a = RI[t * 3], b = RI[t * 3 + 1], c = RI[t * 3 + 2]; const mx = Math.max(texL(RUV[a * 2], RUV[a * 2 + 1]), texL(RUV[b * 2], RUV[b * 2 + 1]), texL(RUV[c * 2], RUV[c * 2 + 1])); hairT[t] = texL((RUV[a * 2] + RUV[b * 2] + RUV[c * 2]) / 3, (RUV[a * 2 + 1] + RUV[b * 2 + 1] + RUV[c * 2 + 1]) / 3) < 70 && mx < 120 ? 1 : 0; }
const rkey = (i) => `${Math.round(RP[i * 3] * 1e5)},${Math.round(RP[i * 3 + 1] * 1e5)},${Math.round(RP[i * 3 + 2] * 1e5)}`;
const rwm = new Map(), rw = new Int32Array(rn); for (let i = 0; i < rn; i++) { const k = rkey(i); if (!rwm.has(k)) rwm.set(k, i); rw[i] = rwm.get(k); }
// painted strand lines on Meshy's skin are 'hair' texels lying flush on the face: thin runs of hair triangles with
// skin triangles on two sides. Three erosion passes remove them; real hair (solid regions, free-standing strands) stays.
{ const ek = (a, b) => (a < b ? a * rn + b : b * rn + a);
  const nbT = new Int32Array(rt * 3).fill(-1);
  const first = new Map(); for (let t = 0; t < rt; t++) for (let k = 0; k < 3; k++) { const e = ek(rw[RI[t * 3 + k]], rw[RI[t * 3 + (k + 1) % 3]]); const o = first.get(e); if (o === undefined) first.set(e, t * 3 + k); else { nbT[t * 3 + k] = Math.floor(o / 3); nbT[o] = t; } }
  let removed = 0;
  for (let pass = 0; pass < 3; pass++) { const kill = []; for (let t = 0; t < rt; t++) { if (!hairT[t]) continue; let sk = 0; for (let k = 0; k < 3; k++) { const o = nbT[t * 3 + k]; if (o >= 0 && !hairT[o]) sk++; } if (sk >= 2) kill.push(t); } for (const t of kill) hairT[t] = 0; removed += kill.length; }
  console.log(`hair: eroded ${removed} painted-on strand triangles`); }
// components of hair triangles; brows / eyes / face specks (front, at the face's height) are not hair
const par = new Int32Array(rn).map((_, i) => i); const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
for (let t = 0; t < rt; t++) if (hairT[t]) { const a = f(rw[RI[t * 3]]); par[f(rw[RI[t * 3 + 1]])] = a; par[f(rw[RI[t * 3 + 2]])] = a; }
const cs = new Map(); for (let t = 0; t < rt; t++) if (hairT[t]) { const r = f(rw[RI[t * 3]]); const c = cs.get(r) ?? { n: 0, zmax: -9, ymin: 9 }; c.n++; const v = RI[t * 3]; c.zmax = Math.max(c.zmax, RP[v * 3 + 2]); c.ymin = Math.min(c.ymin, RP[v * 3 + 1]); cs.set(r, c); }
const keepC = new Set([...cs.entries()].filter(([, c]) => c.n > 40000 || (c.n > 1000 && c.zmax < 0.3)).map(([r]) => r));
console.log(`hair components kept ${keepC.size}: ${[...keepC].map((r) => cs.get(r).n).join(", ")} of ${cs.size}`);
const hmap = new Int32Array(rn).fill(-1); let hn = 0; const HI = [];
for (let t = 0; t < rt; t++) { if (!hairT[t] || !keepC.has(f(rw[RI[t * 3]]))) continue; for (let k = 0; k < 3; k++) { const v = RI[t * 3 + k]; if (hmap[v] < 0) hmap[v] = hn++; HI.push(hmap[v]); } }
const HP = new Float32Array(hn * 3), HN = new Float32Array(hn * 3), HUV = new Float32Array(hn * 2);
for (let v = 0; v < rn; v++) { const k = hmap[v]; if (k < 0) continue; for (let q = 0; q < 3; q++) { HP[k * 3 + q] = RP[v * 3 + q] * fitJ.S + fitJ.T[q]; HN[k * 3 + q] = RN[v * 3 + q]; } HUV[k * 2] = RUV[v * 2]; HUV[k * 2 + 1] = RUV[v * 2 + 1]; }
console.log(`hair: ${hn} verts, ${HI.length / 3} tris (fused raw ${rt})`);
// fit around the Alex skull: every hair vertex stays at least CLEAR outside the new head (radial bins about the head
// centre); the push is smoothed over the hair surface so strands move together and the silhouette is kept
const CEN = new THREE.Vector3(0, 1.22, -0.03), AZ = 240, EL = 120, CLEAR = 0.012;
const binR = new Float32Array(AZ * EL);
const binOf = (x, y, z) => { const dx = x - CEN.x, dy = y - CEN.y, dz = z - CEN.z, r = Math.hypot(dx, dy, dz); const a = Math.floor(((Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI)) * AZ) % AZ, e = Math.min(EL - 1, Math.floor(((Math.asin(dy / r) + Math.PI / 2) / Math.PI) * EL)); return [e * AZ + a, r]; };
for (let i = 0; i < n; i++) { if (P[i * 3 + 1] < 0.86) continue; const [b, r] = binOf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (r > binR[b]) binR[b] = r; }
{ const cp = binR.slice(); for (let e = 0; e < EL; e++) for (let a = 0; a < AZ; a++) { let m = cp[e * AZ + a]; for (let de = -1; de <= 1; de++) for (let da = -1; da <= 1; da++) { const ee = e + de; if (ee < 0 || ee >= EL) continue; m = Math.max(m, cp[ee * AZ + ((a + da + AZ) % AZ)]); } binR[e * AZ + a] = m; } }
const push = new Float32Array(hn);
let pushed = 0, maxPush = 0;
for (let i = 0; i < hn; i++) { const [b, r] = binOf(HP[i * 3], HP[i * 3 + 1], HP[i * 3 + 2]); if (!binR[b]) continue; const need = binR[b] + CLEAR - r; if (need > 0) { push[i] = need; pushed++; maxPush = Math.max(maxPush, need); } }
{ const { nb, rep } = adjacency(HP, HI); const tmp = new Float32Array(hn);
  for (let it = 0; it < 12; it++) { tmp.set(push); for (let i = 0; i < hn; i++) { if (rep[i] !== i || !nb[i].length) continue; let s = push[i], c = 1; for (const j of nb[i]) { s += push[j]; c++; } tmp[i] = Math.max(push[i], s / c); } push.set(tmp); for (let i = 0; i < hn; i++) if (rep[i] !== i) push[i] = push[rep[i]]; } }
for (let i = 0; i < hn; i++) { if (!push[i]) continue; const d = new THREE.Vector3(HP[i * 3] - CEN.x, HP[i * 3 + 1] - CEN.y, HP[i * 3 + 2] - CEN.z).normalize(); HP[i * 3] += d.x * push[i]; HP[i * 3 + 1] += d.y * push[i]; HP[i * 3 + 2] += d.z * push[i]; }
console.log(`hair fit: ${pushed} verts were inside the skull + clearance (max ${maxPush.toFixed(3)}); pushed out radially (smoothed)`);

// ================================ 6. WRITE ===========================================================================
const rigid = (k) => ({ J: new Uint8Array(k * 4).map((_, i) => (i % 4 === 0 ? HEAD : 0)), W: new Float32Array(k * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)) });
const surfN = (x, y) => { const e = 0.004, dx = (S(x + e, y) - S(x - e, y)) / (2 * e), dy = (S(x, y + e) - S(x, y - e)) / (2 * e), l = Math.hypot(dx, dy, 1); return [-dx / l, -dy / l, 1 / l]; };
const part = (name, g, roughness, skinNormals = null) => { const k = g.P.length / 3, Pp = Float32Array.from(g.P), Nn = weldNormals(Pp, computeNormals(Pp, g.I));
  if (skinNormals) for (let i = 0; i < k; i++) if (skinNormals(g.C.slice(i * 3, i * 3 + 3))) Nn.set(surfN(Pp[i * 3], Pp[i * 3 + 1]), i * 3);
  return { name, P: Pp, N: Nn, I: g.I, COLOR: g.C, ...rigid(k), material: { name, roughness } }; };
const skinLike = (c) => Math.abs(c[0] - SKIN[0]) + Math.abs(c[1] - SKIN[1]) + Math.abs(c[2] - SKIN[2]) < 0.12;
const landmarks = { eyes: { l: [-EYE.x, EYE.y, S(EYE.x, EYE.y)], r: [EYE.x, EYE.y, S(EYE.x, EYE.y)], halfW: EYE.hw, halfH: EYE.hh }, mouth: { c: [0, MOUTH.y, S(0, MOUTH.y)], halfW: MOUTH.hw },
  bridge: [0, EYE.y + 0.01, S(0, EYE.y) + 0.03], forward: [0, EYE.y, 1.4], skin: "#" + SKIN.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join(""), iris: "#1a110d" };
const headBytes = await writeModule(`${BASE_OUT}/identity/bon-chibi-head-v1.glb`, base, [
  { name: "identity_head", P, N, I, J, W, extraAttrs: { _PAINT: { type: "VEC4", array: PAINT } }, material: { name: "identity_skin", roughness: 0.82, doubleSided: true } },
  part("baked_eyes", eyes, 0.3, skinLike), part("baked_brows", brows, 0.9), part("baked_mouth", mouth, 0.7),
], { humanIdentity: { id: "bon-chibi-head-v1", base: C.HUMAN_BASE_VERSION, skull: "alex-neutral-head-v1", source: "bon-head-ref-final.png", landmarks, hides: [], parts: { eyes: "baked_eyes", brows: "baked_brows", mouth: "baked_mouth" }, lidRest: LID } }, { compress: false });
console.log(`bon-chibi-head-v1.glb ${(headBytes / 1024).toFixed(0)} KB · eyes ${eyes.I.length / 3} tris · brows ${brows.I.length / 3} · mouth ${mouth.I.length / 3}`);
const webp = await sharp(jpeg).webp({ lossless: true }).toBuffer();
const hairBytes = await writeModule(`${BASE_OUT}/hair/bon-meshy-hair-v1.glb`, base, [
  { name: "baked_hair", P: HP, N: HN, I: HI, UV: HUV, ...rigid(hn), material: { name: "baked_hair", texture: webp, roughness: 0.55, doubleSided: true } },
], { humanHair: { id: "bon-meshy-hair-v1", base: C.HUMAN_BASE_VERSION, source: "meshy 01a0ff53 (hair texels, raw copy)", fit: { scale: fitJ.S, translate: fitJ.T, clear: CLEAR }, hides: [] } }, { compress: false });
console.log(`bon-meshy-hair-v1.glb ${(hairBytes / 1048576).toFixed(1)} MB`);
