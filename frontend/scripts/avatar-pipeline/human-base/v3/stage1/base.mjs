// v3/stage1/base.mjs — PARAMETRIC OFFSHORLY HEAD BASE (style calibration only; never an employee answer).
// The approved HumanBase heads are registered FEATURE-TO-FEATURE onto the canonical front (thin-plate spline on eye centres,
// eye corners, lids, mouth corners, nose bridge + tip, chin, forehead), their front relief (head + face twin + eye + mouth
// modules) sampled through that registration and AVERAGED — features are aligned before averaging, so nose, lids, lips
// and chin keep their sculpted form instead of blurring. Per facial region the approved heads' own relief amplitude range
// is measured: that range is the STYLE ENVELOPE the identity controls must stay inside.
// Writes output/human-base/stage1-proof/base.json + prior-head.glb (clay reference). From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/stage1/base.mjs
import fs from "node:fs";
import { Document } from "@gltf-transform/core";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
import { vertexNormals } from "../geom.mjs";
const tpl = loadTemplate(), TL = tpl.landmarks, RG = tpl.REGION, O = "scripts/avatar-pipeline/output/human-base/stage1-proof", APPROVED = ["bon", "micah", "angelo", "clang", "france"];
const GX = [-0.55, 0.55], GY = [0.65, 1.6], CELL = 0.0035, NX = Math.round((GX[1] - GX[0]) / CELL), NY = Math.round((GY[1] - GY[0]) / CELL);
function depthMap(P, I) { const D = new Float32Array(NX * NY).fill(-9);
  for (let t = 0; t < I.length / 3; t++) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], ax = (P[a * 3] - GX[0]) / CELL, ay = (P[a * 3 + 1] - GY[0]) / CELL, bx = (P[b * 3] - GX[0]) / CELL, by = (P[b * 3 + 1] - GY[0]) / CELL, cx = (P[c * 3] - GX[0]) / CELL, cy = (P[c * 3 + 1] - GY[0]) / CELL;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(NY - 1, Math.ceil(Math.max(ay, by, cy))); y++) for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(NX - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
      const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, w2 = 1 - w0 - w1; if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * P[a * 3 + 2] + w1 * P[b * 3 + 2] + w2 * P[c * 3 + 2], k = y * NX + x; if (z > D[k]) D[k] = z; } }
  { const S = D.slice(); for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) { const k = y * NX + x; if (S[k] < -8) continue; let a = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = S[k + dy * NX + dx]; if (v > -8) { a += v; c++; } } D[k] = a / c; } }
  return D; }
const look = (D, x, y) => { const fx = (x - GX[0]) / CELL, fy = (y - GY[0]) / CELL, x0 = Math.floor(fx), y0 = Math.floor(fy); if (x0 < 0 || y0 < 0 || x0 >= NX - 1 || y0 >= NY - 1) return null; let s = 0, w = 0;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const v = D[(y0 + dy) * NX + x0 + dx]; if (v < -8) continue; const ww = (dx ? fx - x0 : 1 - fx + x0) * (dy ? fy - y0 : 1 - fy + y0); s += v * ww; w += ww; } return w > 0.3 ? s / w : null; };
function tps(src, dst, lam = 1e-5) { const n = src.length, U = (r2) => (r2 > 1e-12 ? r2 * Math.log(r2) * 0.5 : 0), A = Array.from({ length: n + 3 }, () => new Float64Array(n + 5));
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] = U((src[i][0] - src[j][0]) ** 2 + (src[i][1] - src[j][1]) ** 2) + (i === j ? lam : 0); A[i][n] = 1; A[i][n + 1] = src[i][0]; A[i][n + 2] = src[i][1]; A[n][i] = 1; A[n + 1][i] = src[i][0]; A[n + 2][i] = src[i][1]; A[i][n + 3] = dst[i][0]; A[i][n + 4] = dst[i][1]; }
  const m = n + 3; for (let c = 0; c < m; c++) { let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; const d = A[c][c]; for (let k = c; k < m + 2; k++) A[c][k] /= d; for (let r = 0; r < m; r++) if (r !== c) { const f = A[r][c]; if (f) for (let k = c; k < m + 2; k++) A[r][k] -= f * A[c][k]; } }
  const W = A.map((r) => [r[m], r[m + 1]]); return (q) => { let x = W[n][0] + W[n + 1][0] * q[0] + W[n + 2][0] * q[1], y = W[n][1] + W[n + 1][1] * q[0] + W[n + 2][1] * q[1]; for (let i = 0; i < n; i++) { const u = U((q[0] - src[i][0]) ** 2 + (q[1] - src[i][1]) ** 2); x += W[i][0] * u; y += W[i][1] * u; } return [x, y]; }; }

// ---- approved heads: geometry + feature points (in their own frame) ----
const heads = [];
for (const w of APPROVED) { const d = await io.read(`public/avatars/human-base-v1/production/${w}-v1.glb`), L = d.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks, P = [], I = [];
  for (const m of d.getRoot().listMeshes()) if (["identity_head", "identity_face_twin", "face_eyes", "face_mouth"].includes(m.getName())) { const pr = m.listPrimitives()[0], o = P.length / 3, PA = pr.getAttribute("POSITION").getArray(), IA = pr.getIndices().getArray(); for (const v of PA) P.push(v); for (const v of IA) I.push(v + o); }
  const PP = Float32Array.from(P), E = (L.eyes.l[1] + L.eyes.r[1]) / 2, IOD = Math.abs(L.eyes.r[0] - L.eyes.l[0]), My = L.mouth.c[1], EM = E - My;
  let chin = null; for (const [dx, lo] of [[0.02, 0.75], [0.04, 1.0], [0.07, 1.2]]) { for (let i = 0; i < PP.length / 3; i++) if (Math.abs(PP[i * 3]) < dx && PP[i * 3 + 1] < My - 0.25 * EM && PP[i * 3 + 1] > My - lo * EM && (!chin || PP[i * 3 + 2] > chin[2])) chin = [0, PP[i * 3 + 1], PP[i * 3 + 2]]; if (chin) break; }
  // (a head whose midline chin cannot be measured gets it imputed below from the others' normalised chin offset)
  const hw = L.eyes.halfW, hh = L.eyes.halfH, mw = L.mouth.halfW, nb = L.attach?.nose?.bridge ?? L.bridge, nt = L.attach?.nose?.tip ?? L.bridge, fh = L.attach?.forehead ?? [0, E + 0.5 * EM];
  const pts = { eyeL: L.eyes.l, eyeR: L.eyes.r, eyeLo: [L.eyes.l[0] - hw, L.eyes.l[1]], eyeLi: [L.eyes.l[0] + hw, L.eyes.l[1]], eyeRi: [L.eyes.r[0] - hw, L.eyes.r[1]], eyeRo: [L.eyes.r[0] + hw, L.eyes.r[1]],
    eyeLu: [L.eyes.l[0], L.eyes.l[1] + hh], eyeLd: [L.eyes.l[0], L.eyes.l[1] - hh], eyeRu: [L.eyes.r[0], L.eyes.r[1] + hh], eyeRd: [L.eyes.r[0], L.eyes.r[1] - hh],
    mouth: L.mouth.c, mouthL: [-mw, My], mouthR: [mw, My], noseBridge: nb, noseTip: nt, chin, forehead: fh };
  heads.push({ w, P: PP, D: depthMap(PP, I), E, IOD, EM, pts }); }
{ const ok = heads.filter((h) => h.pts.chin); const off = ok.reduce((a, h) => a + (h.pts.chin[1] - h.pts.mouth[1]) / h.EM, 0) / ok.length;
  for (const h of heads) if (!h.pts.chin) { h.pts.chin = [0, h.pts.mouth[1] + off * h.EM]; h.chinImputed = true; console.log(`${h.w}: chin imputed (offset ${off.toFixed(3)} EM)`); } }
// ---- canonical feature points: canonical layout (eyes/mouth/nose/chin stay where the topology's landmarks are), feature
// SIZES = approved mean (normalised by IOD / EM) ----
const P0 = tpl.P, at = (i) => [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]], cE = (at(TL.eyeL)[1] + at(TL.eyeR)[1]) / 2, cIOD = Math.abs(at(TL.eyeR)[0] - at(TL.eyeL)[0]), cEM = cE - at(TL.mouth)[1];
const mean = (f) => heads.reduce((a, h) => a + f(h), 0) / heads.length;
const hwN = mean((h) => (h.pts.eyeLi[0] - h.pts.eyeL[0]) / h.IOD), hhN = mean((h) => (h.pts.eyeLu[1] - h.pts.eyeL[1]) / h.EM), mwN = mean((h) => (h.pts.mouthR[0]) / h.IOD), nbN = mean((h) => (h.pts.noseBridge[1] - h.E) / h.EM), fhN = mean((h) => (h.pts.forehead[1] - h.E) / h.EM);
const hw = hwN * cIOD, hh = hhN * cEM, mw = mwN * cIOD, eL = at(TL.eyeL), eR = at(TL.eyeR), mo = at(TL.mouth), nt = at(TL.noseTip), ch = at(TL.chin);
const cpts = { eyeL: eL, eyeR: eR, eyeLo: [eL[0] - hw, eL[1]], eyeLi: [eL[0] + hw, eL[1]], eyeRi: [eR[0] - hw, eR[1]], eyeRo: [eR[0] + hw, eR[1]], eyeLu: [eL[0], eL[1] + hh], eyeLd: [eL[0], eL[1] - hh], eyeRu: [eR[0], eR[1] + hh], eyeRd: [eR[0], eR[1] - hh],
  mouth: mo, mouthL: [mo[0] - mw, mo[1]], mouthR: [mo[0] + mw, mo[1]], noseBridge: [0, cE + nbN * cEM], noseTip: nt, chin: ch, forehead: [0, cE + fhN * cEM] };
const KEYS = Object.keys(cpts), Dc = depthMap(P0, tpl.I), cRef = look(Dc, 0, cpts.forehead[1]);
// ---- registered relief per head, sampled at every canonical front vertex ----
const n = tpl.n, N = vertexNormals(P0, tpl.I), Rh = heads.map(() => new Float32Array(n).fill(NaN)), front = new Uint8Array(n);
for (const h of heads) { h.T = tps(KEYS.map((k) => cpts[k].slice(0, 2)), KEYS.map((k) => h.pts[k].slice(0, 2))); h.s = Math.sqrt((h.IOD / cIOD) * (h.EM / cEM)); const fr = h.T(cpts.forehead); h.ref = look(h.D, fr[0], fr[1]); }
for (let i = 0; i < n; i++) { const r = tpl.region[i]; if (r === RG.earL || r === RG.earR || r === RG.nape || N[i * 3 + 2] < 0.05) continue; const [x, y, z] = at(i), zc = look(Dc, x, y); if (zc === null || Math.abs(zc - z) > 0.02) continue; front[i] = 1;
  heads.forEach((h, k) => { const q = h.T([x, y]), zh = look(h.D, q[0], q[1]); if (zh !== null && h.ref !== null) Rh[k][i] = (zh - h.ref) / h.s - (z - cRef); }); }
// TWO SCALES (FC-MASK-CLIFF, learned): the approved faces sit in a different overall depth plane than the canonical egg;
// a large low-frequency offset that ends at an inner-face mask edge reads as a pasted mask. So the registered relief is
// split: BROAD face-plane shape (heavily smoothed, blended over the whole front of the head with a very wide falloff) +
// SCULPTED DETAIL (relief − broad, applied inside the inner face). Neither can leave a cliff.
const smoothSE = (t, a, b) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const Rm = new Float32Array(n), has = new Uint8Array(n), wIn = new Float32Array(n), wWide = new Float32Array(n);
for (let i = 0; i < n; i++) { if (!front[i]) continue; const v = Rh.map((a) => a[i]).filter((q) => !Number.isNaN(q)); if (v.length < 4) continue; v.sort((a, b) => a - b); Rm[i] = v.length === 5 ? (v[1] + v[2] + v[3]) / 3 : (v[1] + v[2]) / 2; has[i] = 1; }
for (let i = 0; i < n; i++) { const [x, y] = at(i), nz = N[i * 3 + 2];
  const e1 = (x / (1.15 * cIOD)) ** 2 + ((y - (cE - 0.7 * cEM)) / (1.4 * cEM)) ** 2, e2 = (x / (1.75 * cIOD)) ** 2 + ((y - (cE - 0.55 * cEM)) / (2.1 * cEM)) ** 2;
  const rg = tpl.region[i], earish = rg === RG.earL || rg === RG.earR || rg === RG.nape, under = rg === RG.under;
  void under; wIn[i] = earish ? 0 : (1 - smoothSE(e1, 0.45, 1)) * smoothSE(nz, 0.1, 0.4);
  // broad layer: SPATIAL fade only — across x/y and through the head's DEPTH (face front → ear plane), never by normal
  wWide[i] = (1 - smoothSE(e2, 0.25, 1)) * smoothSE(at(i)[2], -0.12, 0.28); }
// (FC-RELIEF-SPILL, learned: the broad layer reached the ears and down-facing under-chin triangles and folded them)
const nconv = (val, w, its, keep = 0.5) => { const num = new Float32Array(n), den = new Float32Array(n); for (let i = 0; i < n; i++) { num[i] = val[i] * w[i]; den[i] = w[i]; }
  for (let it = 0; it < its; it++) for (const A of [num, den]) { const T = A.slice(); for (let i = 0; i < n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; let a = 0; for (const j of nb) a += T[j]; A[i] = keep * T[i] + (1 - keep) * a / nb.length; } }
  return { v: Float32Array.from(num, (x, i) => (den[i] > 1e-4 ? x / den[i] : 0)), d: den }; };
const wData = Float32Array.from(has, (h, i) => (h ? Math.max(0.05, wIn[i]) : 0));
const low = nconv(Rm, wData, 160).v;                                   // broad face-plane shape (data everywhere it exists)
const highRaw = new Float32Array(n); for (let i = 0; i < n; i++) highRaw[i] = has[i] ? Rm[i] - low[i] : 0;
const high = nconv(highRaw, Float32Array.from(has, (h, i) => (h ? wIn[i] : 0)), 18).v;   // enough to remove sampling noise, not the forms
const FL = new Float32Array(n), FH = new Float32Array(n); for (let i = 0; i < n; i++) { FL[i] = Math.max(-0.06, Math.min(0.1, low[i] * wWide[i])); FH[i] = Math.max(-0.04, Math.min(0.07, high[i])) * wIn[i]; }
// one gentle relaxation of each layer (only removes residual texel noise)
for (const A of [FL, FH]) { const T = A.slice(); for (let it = 0; it < 3; it++) { T.set(A); for (let i = 0; i < n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; let a = 0; for (const j of nb) a += T[j]; A[i] = 0.6 * T[i] + 0.4 * a / nb.length; } } }
const F = Float32Array.from(FL, (v, i) => v + FH[i]);
const wgt = wIn, R = F;
// ---- semantic regions (partition of unity over the face) + the approved range per region (STYLE ENVELOPE) ----
const REG = { nose: [[0, (nt[1] + cpts.noseBridge[1]) / 2], 0.065, 0.11], lips: [[0, mo[1]], 0.085, 0.045], chin: [[0, ch[1] - 0.01], 0.08, 0.055], cheeks: [[0.21, cE - 0.42 * cEM], 0.075, 0.08, true],
  brow: [[0.17, cE + 0.42 * hh + 0.07], 0.09, 0.04, true], eyes: [[eR[0], cE], 0.085, 0.05, true] };
const REST = 0.18, g = (name, x, y) => { const [[cx, cy], sx, sy, sym] = REG[name]; const dx = sym ? Math.abs(x) - cx : x - cx; return Math.exp(-0.5 * ((dx / sx) ** 2 + ((y - cy) / sy) ** 2)); };
const mask = Object.fromEntries(Object.keys(REG).map((k) => [k, new Float32Array(n)])), restM = new Float32Array(n);
for (let i = 0; i < n; i++) { const [x, y] = at(i); let s = REST; const gv = {}; for (const k of Object.keys(REG)) { gv[k] = g(k, x, y); s += gv[k]; } for (const k of Object.keys(REG)) mask[k][i] = gv[k] / s; restM[i] = REST / s; }
const amp = {}; for (const k of [...Object.keys(REG), "rest"]) { const M2 = k === "rest" ? restM : mask[k]; const per = heads.map((h, hi) => { let a = 0, b = 0; for (let i = 0; i < n; i++) { const r = Rh[hi][i]; if (!wgt[i] || Number.isNaN(r)) continue; a += M2[i] * wgt[i] * (r - low[i]) ** 2; b += M2[i] * wgt[i] * (Rm[i] - low[i]) ** 2; } return b ? Math.sqrt(a / b) : 1; });   // how pronounced this head's sculpted detail is in the region, vs the mean
  const m = per.reduce((a, b) => a + b, 0) / per.length, sd = Math.sqrt(per.reduce((a, b) => a + (b - m) ** 2, 0) / per.length); amp[k] = { perHead: Object.fromEntries(APPROVED.map((w, i) => [w, +per[i].toFixed(3)])), mean: +m.toFixed(3), sd: +sd.toFixed(3), min: +Math.min(...per).toFixed(3), max: +Math.max(...per).toFixed(3) }; }
fs.mkdirSync(O, { recursive: true });
for (const k of Object.keys(amp)) { const v = Object.values(amp[k].perHead).sort((a, b) => a - b); amp[k].median = v[v.length >> 1]; }
fs.writeFileSync(`${O}/base.json`, JSON.stringify({ approved: APPROVED, field: Array.from(F, (v) => +v.toFixed(5)), fieldLow: Array.from(FL, (v) => +v.toFixed(5)), fieldHigh: Array.from(FH, (v) => +v.toFixed(5)), regions: REG, rest: REST, amp, eyeHalf: { w: hw, h: hh }, mouthHalfW: mw, featurePoints: cpts }));
const Pp = Float32Array.from(P0); for (let i = 0; i < n; i++) Pp[i * 3 + 2] += F[i];
const doc = new Document(), buf = doc.createBuffer(), prim = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(Pp).setBuffer(buf)).setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(tpl.I)).setBuffer(buf));
doc.createScene().addChild(doc.createNode("identity_head").setMesh(doc.createMesh("identity_head").addPrimitive(prim))); await io.write(`${O}/prior-head.glb`, doc);
console.log("per-head detail ratio vs mean:", JSON.stringify(Object.fromEntries(Object.entries(amp).map(([k, v]) => [k, v.perHead])))); console.log("base relief: nose", F[TL.noseTip].toFixed(4), "mouth", F[TL.mouth].toFixed(4), "chin", F[TL.chin].toFixed(4), "| envelope", JSON.stringify(Object.fromEntries(Object.entries(amp).map(([k, v]) => [k, [v.min, v.max, v.sd]]))));
