// v3/stage1/relief.mjs — OFFSHORLY STYLE-PRIOR RELIEF: the MEAN front facial relief of the approved HumanBase heads
// (calibration only — averaged, never any one person's face, never an employee answer), transferred onto the canonical
// topology as a depth (Z) field. Corrects the V3 proof template, which measured ~7× flatter than the approved style.
// Writes output/human-base/stage1-proof/relief-prior.json (+ prior-head.glb, clay reference). From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/stage1/relief.mjs
import fs from "node:fs";
import { Document } from "@gltf-transform/core";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
import { vertexNormals } from "../geom.mjs";
const tpl = loadTemplate(), TL = tpl.landmarks, RG = tpl.REGION, O = "scripts/avatar-pipeline/output/human-base/stage1-proof", APPROVED = ["bon", "micah", "angelo", "clang", "france"];
const GX = [-0.5, 0.5], GY = [0.7, 1.6], CELL = 0.004, NX = Math.round((GX[1] - GX[0]) / CELL), NY = Math.round((GY[1] - GY[0]) / CELL);
/** front depth map (max z) by triangle rasterisation */
function depthMap(P, I) { const D = new Float32Array(NX * NY).fill(-9);
  for (let t = 0; t < I.length / 3; t++) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], ax = (P[a * 3] - GX[0]) / CELL, ay = (P[a * 3 + 1] - GY[0]) / CELL, bx = (P[b * 3] - GX[0]) / CELL, by = (P[b * 3 + 1] - GY[0]) / CELL, cx = (P[c * 3] - GX[0]) / CELL, cy = (P[c * 3 + 1] - GY[0]) / CELL;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(NY - 1, Math.ceil(Math.max(ay, by, cy))); y++) for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(NX - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
      const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, w2 = 1 - w0 - w1; if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * P[a * 3 + 2] + w1 * P[b * 3 + 2] + w2 * P[c * 3 + 2], k = y * NX + x; if (z > D[k]) D[k] = z; } }
  // seams of overlapping face pieces / trims leave pixel noise: 3 passes of a 5×5 box blur over valid pixels only
  for (let pass = 0; pass < 3; pass++) { const S = D.slice(); for (let y = 2; y < NY - 2; y++) for (let x = 2; x < NX - 2; x++) { const k = y * NX + x; if (S[k] < -8) continue; let a = 0, c = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const v = S[k + dy * NX + dx]; if (v > -8) { a += v; c++; } } D[k] = a / c; } }
  return D; }
const look = (D, x, y) => { const fx = (x - GX[0]) / CELL, fy = (y - GY[0]) / CELL, x0 = Math.floor(fx), y0 = Math.floor(fy); if (x0 < 0 || y0 < 0 || x0 >= NX - 1 || y0 >= NY - 1) return null; let s = 0, w = 0;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const v = D[(y0 + dy) * NX + x0 + dx]; if (v < -8) continue; const ww = (dx ? fx - x0 : 1 - fx + x0) * (dy ? fy - y0 : 1 - fy + y0); s += v * ww; w += ww; } return w > 0.3 ? s / w : null; };
// canonical frame
const P0 = tpl.P, at = (i) => [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]], cE = (at(TL.eyeL)[1] + at(TL.eyeR)[1]) / 2, cIOD = Math.abs(at(TL.eyeR)[0] - at(TL.eyeL)[0]), cEM = cE - at(TL.mouth)[1];
const Dc = depthMap(P0, tpl.I), cRef = look(Dc, 0, cE + 0.55 * cEM);
const heads = [];
for (const w of APPROVED) { const d = await io.read(`public/avatars/human-base-v1/production/${w}-v1.glb`), L = d.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks; const P = [], I = [];
  for (const m of d.getRoot().listMeshes()) if (["identity_head", "identity_face_twin"].includes(m.getName())) { const pr = m.listPrimitives()[0], o = P.length / 3, PA = pr.getAttribute("POSITION").getArray(), IA = pr.getIndices().getArray(); for (const v of PA) P.push(v); for (const v of IA) I.push(v + o); }
  const E = (L.eyes.l[1] + L.eyes.r[1]) / 2, IOD = Math.abs(L.eyes.r[0] - L.eyes.l[0]), EM = E - L.mouth.c[1], D = depthMap(Float32Array.from(P), I);
  heads.push({ w, D, sx: IOD / cIOD, sy: EM / cEM, E, ref: look(D, 0, E + 0.55 * EM) }); }
// per canonical vertex: mean approved relief (relative to the forehead reference) − canonical relief, front face only
const n = tpl.n, N = vertexNormals(P0, tpl.I), dz = new Float32Array(n), wgt = new Float32Array(n);
for (let i = 0; i < n; i++) { const r = tpl.region[i]; if (r === RG.earL || r === RG.earR || r === RG.nape || N[i * 3 + 2] < 0.15) continue;
  const [x, y, z] = at(i), zc = look(Dc, x, y); if (zc === null || Math.abs(zc - z) > 0.02) continue;   // only the visible front surface
  const v = []; for (const h of heads) { const zh = look(h.D, x * h.sx, h.E + (y - cE) * h.sy); if (zh === null || h.ref === null) continue; v.push((zh - h.ref) / Math.sqrt(h.sx * h.sy)); }
  if (v.length < 3) continue; v.sort((a, b) => a - b); const m = v[v.length >> 1];   // MEDIAN of the approved heads: robust to any one head's trims / sockets / slits
  const eye = r === RG.eyeL || r === RG.eyeR, t = Math.min(1, Math.max(0, (N[i * 3 + 2] - 0.15) / 0.45));
  // inner-face mask (eyes→chin, cheek to cheek; hairline / temples / jaw underside excluded — trims live there)
  const ex = x / (1.0 * cIOD), ey = (y - (cE - 0.75 * cEM)) / (1.25 * cEM), e2 = ex * ex + ey * ey, fm = e2 >= 1 ? 0 : 1 - (e2 > 0.6 ? ((e2 - 0.6) / 0.4) ** 2 * (3 - 2 * (e2 - 0.6) / 0.4) : 0);
  dz[i] = Math.max(-0.025, Math.min(0.06, m - (z - cRef))); wgt[i] = eye ? 0 : t * t * (3 - 2 * t) * fm; }
// smooth (weighted umbrella) so the mask edge and eye exclusion leave no step; eyes take the surrounding relief
// NORMALISED CONVOLUTION over the surface: smooth (relief × weight) and (weight) alike, divide — removes per-vertex noise
// without shrinking the relief; fades out where the evidence weight is low (outside the inner face)
const num = new Float32Array(n), den = new Float32Array(n); for (let i = 0; i < n; i++) { num[i] = dz[i] * wgt[i]; den[i] = wgt[i]; }
for (let it = 0; it < 40; it++) for (const A of [num, den]) { const T = A.slice(); for (let i = 0; i < n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; let a = 0; for (const j of nb) a += T[j]; A[i] = 0.4 * T[i] + 0.6 * a / nb.length; } }
const F = new Float32Array(n); for (let i = 0; i < n; i++) F[i] = den[i] > 0.02 ? (num[i] / den[i]) * Math.min(1, den[i] / 0.5) : 0;
const out = { approved: APPROVED, grid: CELL, field: Array.from(F, (v) => +v.toFixed(5)), stats: { max: F.reduce((a, b) => Math.max(a, b), -9), min: F.reduce((a, b) => Math.min(a, b), 9), noseTip: F[TL.noseTip], mouth: F[TL.mouth], chin: F[TL.chin], forehead: F[TL.forehead] } };
fs.mkdirSync(O, { recursive: true }); fs.writeFileSync(`${O}/relief-prior.json`, JSON.stringify(out));
// clay reference: the canonical head with the style-prior relief (geometry only)
const Pp = Float32Array.from(P0); for (let i = 0; i < n; i++) Pp[i * 3 + 2] += F[i];
const doc = new Document(), buf = doc.createBuffer(), prim = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(Pp).setBuffer(buf)).setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(tpl.I)).setBuffer(buf));
const mesh = doc.createMesh("identity_head").addPrimitive(prim); doc.createScene().addChild(doc.createNode("identity_head").setMesh(mesh)); await io.write(`${O}/prior-head.glb`, doc);
console.log("relief prior:", JSON.stringify(out.stats, (k, v) => (typeof v === "number" ? +v.toFixed(4) : v)), "heads", heads.map((h) => `${h.w} s=${h.sx.toFixed(2)}/${h.sy.toFixed(2)}`).join(" "));
