// v3/stage1/build.mjs — STAGE 1 PROOF: Stage 0 identity representation → Offshorly style translation → canonical HumanBase.
// ZERO CREDITS, local only, never writes to production/ or public/. From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/stage1/build.mjs [--who=a,b,c] [--anchor=nicole]
// ONE generalized path for every id (ids only name files). The ONLY identity input is the approved Stage 0 representation
// (stage0-identity/identity.json + its canonical crop + hair mask). No Meshy / legacy / manual geometry is read.
//
// STYLE TRANSLATION T (generalized):
//   population prior  = mean Stage 0 face over every available sprite (stage1-proof/population, failures excluded)
//   style map C       = thin-plate spline fitted so the population-MEAN face (normalised frame) lands exactly on the
//                       CANONICAL HumanBase front landmarks/silhouette (the locked Offshorly style)
//   person targets    = C(person) — the person's deviations from the mean pass through the same smooth map, so identity
//                       relationships survive while proportions become Offshorly's (canonical = C(mean) by construction)
//   unknown evidence  = the mirrored observed side (flagged) when available, else the population mean ⇒ canonical prior
// CONSTRUCTION: Gaussian-RBF warp of the V3 canonical topology in the FRONT PLANE ONLY (x,y): depth stays the canonical 3D
//   prior (no flattening), skull/ears/neck pinned, fold-free ladder, fail closed. Hair = separate solid from the Stage 0
//   hair layer. Appearance = TEMPORARY vector paint rendered from the Stage 0 representation (clearly labelled).
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";
import { loadBase, writeModule } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
import { TriIndex, dilateGutter, pushPull, rasterUV, triNormal, vertexNormals } from "../geom.mjs";
import { NP, NT, buildHairSolid, dirBin, finishMaps, headRadiusMap, regionBins, sampleMap } from "../hair.mjs";
import { finishHairMesh, neckExtension } from "../build.mjs";
import { resample, vec, dist, traits } from "../identity/metrics.mjs";
import { observables, zscores, drives, applyDepthPrior } from "./depthprior.mjs";
import { fadeFolds } from "./fadefolds.mjs";
import { calibrate, opDrives, applyBasis, OBSERVED_OPS } from "./sculpt.mjs";
import { HD_FILE, lift } from "./hd.mjs";
import { s0Ratios } from "./calibrate-layout.mjs";
import { g3OfCanonical } from "./calibrate-proportions.mjs";
import { inputGate } from "./input-gate.mjs";
import { measure3D, FRONT_MARGIN_IOD, faceOutlineX, mentonY } from "./proportions.mjs";
import { measureS0, translate, layoutWarp, subnasale, withEyeEvidence } from "./proportions.mjs";
import { completeFor, hairOuterFrom, envAt } from "./envelope.mjs";
import { sculptFeatures, eyeballMesh, STYLE as FEATURE_STYLE } from "./features.mjs";
import { classifyMouth, smileSpec } from "./mouth.mjs";

const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
// DIAGNOSTIC stage skip (drift/defect localisation, never a production path): V3_DIAG_SKIP=outline,basis writes to <who>/<variant>/diag-<skips>
const DIAG = new Set((process.env.V3_DIAG_SKIP ?? "").split(",").filter(Boolean));
const VAR = opt("variant", "V"), OUT = "scripts/avatar-pipeline/output/human-base/stage1-proof", S0DIR = process.env.V3_S0DIR ?? "scripts/avatar-pipeline/output/human-base/stage0-identity"   /* input path (an uploaded identity), never a name gate */, TEX = 2048;
const S0 = JSON.parse(fs.readFileSync(`${S0DIR}/identity.json`, "utf8")).results, POP = JSON.parse(fs.readFileSync(`${OUT}/population/identity.json`, "utf8")).results;
const base = await loadBase(), tpl = loadTemplate(), HEAD = base.JI.Head, RG = tpl.REGION, TL = tpl.landmarks;
const HDT = fs.existsSync(HD_FILE) ? loadTemplate(HD_FILE) : null;   // canonical HD topology (stage1/hd.mjs) — same for everyone
// variant V runs on the PARAMETRIC OFFSHORLY BASE (base2.mjs); fold guarantees stay against the canonical template (TPLP)
const B2 = VAR === "V" ? JSON.parse(fs.readFileSync(`${OUT}/base2.json`, "utf8")) : null, TPLP = tpl.P;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- automatic selection: the anchor + the pair maximising the trio's minimum identity distance ----------
let WHO = opt("who", null)?.split(",");
if (!WHO) { const anchor = opt("anchor") ?? (() => { throw new Error("trio selection needs --anchor=<id> (no built-in default id)"); })(), ids = Object.keys(S0).filter((i) => S0[i].contour), V = Object.fromEntries(ids.map((i) => [i, vec(S0[i])])), c = ids.filter((i) => i !== anchor); let best = null;
  for (let a = 0; a < c.length; a++) for (let b = a + 1; b < c.length; b++) { const d = [dist(V[anchor], V[c[a]]).d, dist(V[anchor], V[c[b]]).d, dist(V[c[a]], V[c[b]]).d], s = { pair: [c[a], c[b]], min: Math.min(...d), sum: d.reduce((x, y) => x + y, 0), d }; if (!best || s.min > best.min || (s.min === best.min && s.sum > best.sum)) best = s; }
  WHO = [anchor, ...best.pair]; fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/selection.json`, JSON.stringify({ rule: "anchor + pair maximising min pairwise Stage 0 face-only distance (tie: max sum)", anchor, ...best }, null, 1)); }

// ---------- normalised frame (same as metrics.normalise, with its inverse) ----------
function frame(p) {
  const anc = (e) => (e.found && e.conf >= 0.5 && e.innerOk !== false && e.outerOk !== false ? [(e.inner[0] + e.outer[0]) / 2, (e.inner[1] + e.outer[1]) / 2] : e.iris);
  const eR = anc(p.eyes.R), eL = anc(p.eyes.L), E = [(eR[0] + eL[0]) / 2, (eR[1] + eL[1]) / 2], ang = Math.atan2(eL[1] - eR[1], eL[0] - eR[0]), iod = Math.hypot(eL[0] - eR[0], eL[1] - eR[1]);
  const mc = [(p.mouth.cornerR[0] + p.mouth.cornerL[0]) / 2, (Math.min(...p.mouth.upper.map((q) => q[1])) + Math.max(...p.mouth.lower.map((q) => q[1]))) / 2];
  const co = Math.cos(-ang), si = Math.sin(-ang), rot = (q) => [co * (q[0] - E[0]) - si * (q[1] - E[1]), si * (q[0] - E[0]) + co * (q[1] - E[1])];
  const em = rot(mc)[1], u = Math.sqrt(iod * em), T = (q) => { const r = rot(q); return [r[0] / u, r[1] / u]; };
  const Ti = (n) => { const x = n[0] * u, y = n[1] * u, c2 = Math.cos(ang), s2 = Math.sin(ang); return [E[0] + c2 * x - s2 * y, E[1] + s2 * x + c2 * y]; };
  return { T, Ti, u, iod, em, E, ang };
}
// ---------- the representation in the normalised frame ----------
const GRID = 72, mirrorG = (g) => (((35 - g) % GRID) + GRID) % GRID;
function rep(p) {
  const F = frame(p), T = F.T, R = resample(p, { T, u: F.u, iod: F.iod, em: F.em });
  const eye = (e) => (e.found && e.conf >= 0.5 ? { c: T([(e.inner[0] + e.outer[0]) / 2, (e.inner[1] + e.outer[1]) / 2]), inner: T(e.inner), outer: T(e.outer), upper: e.upper.map(T), lower: e.lower.map(T), iris: T(e.iris), irisR: e.irisR / F.u, lineW: (e.appearance?.strokeWeight?.upper ?? 3) / F.u } : null);
  const brow = (b) => (b.found ? { top: b.top.map(T), bottom: b.bottom.map(T), conf: b.conf } : null);
  const m = p.mouth.found ? { cR: T(p.mouth.cornerR), cL: T(p.mouth.cornerL), upper: p.mouth.upper.map(T), lower: p.mouth.lower.map(T) } : null;
  return { p, F, contour: R.out.map((g) => ({ q: g.q, ok: g.ok, label: g.label })), eyes: { R: eye(p.eyes.R), L: eye(p.eyes.L) }, brows: { R: brow(p.brows.R), L: brow(p.brows.L) },
    nose: p.nose.found ? { wingR: T(p.nose.wingR), wingL: T(p.nose.wingL), base: T(p.nose.base) } : null, mouth: m, mouthC: m ? [(m.cR[0] + m.cL[0]) / 2, (Math.min(...m.upper.map((q) => q[1])) + Math.max(...m.lower.map((q) => q[1]))) / 2] : [0, F.em / F.u] };
}
// contour with honest fallback: observed → mirrored observed side (flagged) → null (= population mean ⇒ canonical prior)
const contourPt = (r, g) => (r.contour[g].ok ? { q: r.contour[g].q, src: "observed" } : r.contour[mirrorG(g)].ok ? { q: [-r.contour[mirrorG(g)].q[0], r.contour[mirrorG(g)].q[1]], src: "mirrored" } : null);

// ---------- population prior ----------
const popReps = Object.values(POP).filter((p) => p.contour && p.eyes?.R?.found && p.eyes?.L?.found && p.mouth?.found).map(rep);
const mean = (arr) => { const v = arr.filter(Boolean); return v.length ? [v.reduce((a, q) => a + q[0], 0) / v.length, v.reduce((a, q) => a + q[1], 0) / v.length] : null; };
const M = { contour: Array.from({ length: GRID }, (_, g) => mean(popReps.map((r) => contourPt(r, g)?.q))), eyeR: mean(popReps.map((r) => r.eyes.R?.c)), eyeL: mean(popReps.map((r) => r.eyes.L?.c)),
  mouth: mean(popReps.map((r) => r.mouthC)), nose: mean(popReps.map((r) => r.nose?.base)), n: popReps.length };
const CHIN_G = [53, 54], chinOf = (r) => mean(CHIN_G.map((g) => contourPt(r, g)?.q));
M.chin = mean(popReps.map(chinOf));
// eye corner + lid means (observed controls)
for (const [k, f] of [["eRo", (r) => r.eyes.R?.outer], ["eRi", (r) => r.eyes.R?.inner], ["eRu", (r) => r.eyes.R?.upper[4]], ["eRd", (r) => r.eyes.R?.lower[4]], ["eLo", (r) => r.eyes.L?.outer], ["eLi", (r) => r.eyes.L?.inner], ["eLu", (r) => r.eyes.L?.upper[4]], ["eLd", (r) => r.eyes.L?.lower[4]]]) M[k] = mean(popReps.map(f));
// PARAMETRIC OFFSHORLY BASE (style-locked sculpture + semantic regions + approved envelopes) — built by base.mjs
const BASE = null; // (superseded by base2.json — dense approved fits)
const TP = tpl.P, nearestFront = (x, y) => { let best = -1, bd = 1e9; for (let i = 0; i < tpl.n; i++) { if (tpl.region[i] === RG.earL || tpl.region[i] === RG.earR || TP[i * 3 + 2] < 0.15) continue; const d = (TP[i * 3] - x) ** 2 + (TP[i * 3 + 1] - y) ** 2 - 0.02 * TP[i * 3 + 2]; if (d < bd) { bd = d; best = i; } } return best; };
const EYEV = null;   // eye corner/lid geometry controls: disabled (destabilised the 2D warp; eye form comes from the base)
const REGM = (() => { const BB = B2 ?? BASE; if (!BB) return null; const BASE_ = BB, names = Object.keys(BASE_.regions), m = Object.fromEntries(names.map((k) => [k, new Float32Array(tpl.n)])), rest = new Float32Array(tpl.n);
  const PP = B2 ? Float32Array.from(B2.P) : TP; for (let i = 0; i < tpl.n; i++) { const x = PP[i * 3], y = PP[i * 3 + 1]; let s2 = BASE_.rest; const gv = {}; for (const k of names) { const [[cx, cy], sx, sy, sym] = BASE_.regions[k], dx = sym ? Math.abs(x) - cx : x - cx; gv[k] = Math.exp(-0.5 * ((dx / sx) ** 2 + ((y - cy) / sy) ** 2)); s2 += gv[k]; } for (const k of names) m[k][i] = gv[k] / s2; rest[i] = BASE_.rest / s2; }
  return { names, m, rest }; })();
const obsOf = (r) => observables(r, contourPt, chinOf, { foreheadH: traits(r.p).t.foreheadToHairline_hairDependent });
const popObs = popReps.map(obsOf);

// ---------- canonical (Offshorly) front landmarks + silhouette ----------
// variant V runs on the PARAMETRIC OFFSHORLY BASE (base2.mjs: canonical skull/ears/neck + mean of dense approved fits)
const P0 = B2 ? Float32Array.from(B2.P) : tpl.P, at0 = (i) => [P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2]];
const eyeY3 = (at0(TL.eyeL)[1] + at0(TL.eyeR)[1]) / 2, EM3 = eyeY3 - at0(TL.mouth)[1], c3 = [0, eyeY3 - 0.6 * EM3];
const angOf = (g) => -Math.PI + (2 * Math.PI * (g + 0.5)) / GRID;               // normalised-image convention (y down)
const silV = new Int32Array(GRID).fill(-1); { const best = new Float32Array(GRID).fill(-1);
  for (let i = 0; i < tpl.n; i++) { const r = tpl.region[i]; if (r === RG.earL || r === RG.earR || r === RG.nape || P0[i * 3 + 2] < tpl.centre[2]) continue;
    const dx = P0[i * 3] - c3[0], dy = -(P0[i * 3 + 1] - c3[1]), a = Math.atan2(dy, dx), rr = Math.hypot(dx, dy);
    let g = Math.floor(((a + Math.PI) / (2 * Math.PI)) * GRID - 0.5 + 0.5); g = ((g % GRID) + GRID) % GRID; const da = Math.abs(((a - angOf(g) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (da < (Math.PI / GRID) && rr > best[g]) { best[g] = rr; silV[g] = i; } } }
// the face arc that carries identity: from just above the eye line at the sides, down around the chin (forehead/crown = skull prior)
const ARC = []; for (let g = 0; g < GRID; g++) { const a = angOf(g); if ((a > -0.62 || a < -Math.PI + 0.62) && !CHIN_G.includes(g) && silV[g] >= 0 && M.contour[g]) ARC.push(g); }
const ARC_CTRL = ARC.filter((g) => g % 4 === 1 && Math.abs(angOf(g) - Math.PI / 2) > 0.3);

// ---------- thin-plate spline (2D → 2D) ----------
function tps(src, dst, lam = 1e-6) {
  const n = src.length, U = (r2) => (r2 > 1e-12 ? r2 * Math.log(r2) * 0.5 : 0), A = Array.from({ length: n + 3 }, () => new Float64Array(n + 5));
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] = U((src[i][0] - src[j][0]) ** 2 + (src[i][1] - src[j][1]) ** 2) + (i === j ? lam : 0); A[i][n] = 1; A[i][n + 1] = src[i][0]; A[i][n + 2] = src[i][1]; A[n][i] = 1; A[n + 1][i] = src[i][0]; A[n + 2][i] = src[i][1]; A[i][n + 3] = dst[i][0]; A[i][n + 4] = dst[i][1]; }
  const m = n + 3; for (let c = 0; c < m; c++) { let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; const d = A[c][c]; for (let k = c; k < m + 2; k++) A[c][k] /= d; for (let r = 0; r < m; r++) if (r !== c) { const f = A[r][c]; if (f) for (let k = c; k < m + 2; k++) A[r][k] -= f * A[c][k]; } }
  const W = A.map((r) => [r[m], r[m + 1]]);
  return (q) => { let x = W[n][0] + W[n + 1][0] * q[0] + W[n + 2][0] * q[1], y = W[n][1] + W[n + 1][1] * q[0] + W[n + 2][1] * q[1]; for (let i = 0; i < n; i++) { const u = U((q[0] - src[i][0]) ** 2 + (q[1] - src[i][1]) ** 2); x += W[i][0] * u; y += W[i][1] * u; } return [x, y]; };
}
// style map C: population mean (normalised) → canonical front plane
const xy = (i) => [P0[i * 3], P0[i * 3 + 1]];
const CP = [["eyeR", M.eyeR, xy(TL.eyeL)], ["eyeL", M.eyeL, xy(TL.eyeR)], ["mouth", M.mouth, xy(TL.mouth)], ["nose", M.nose, xy(TL.noseTip)], ["chin", M.chin, xy(TL.chin)], ...ARC.map((g) => [`c${g}`, M.contour[g], xy(silV[g])])];
const C = tps(CP.map((c) => c[1]), CP.map((c) => c[2]), 1e-4);
const styleFit = Math.max(...CP.map((c) => { const q = C(c[1]); return Math.hypot(q[0] - c[2][0], q[1] - c[2][1]); }));
// ---------- IDENTITY-PROPORTIONAL LAYOUT (default; HB_LAYOUT=legacy restores the TPS deviation transfer) ----------
// FC-STYLE-LAYOUT-OVERRIDE (learned in the proportion audit): the TPS style map C interpolates the population-MEAN face onto the
// style base's landmark layout, so every employee received the style base's absolute proportions + only a Jacobian-scaled
// deviation — measured eye spacing / eye→mouth→chin relationships were overwritten. The layout map is now ONE SIMILARITY
// (uniform scale + offset, fitted once: population mean → head), which places + sizes the face without changing any ratio.
// The style still owns the skull, the sculpture (volume), the feature grammar and the allowed ranges.
const LAYOUT = process.env.HB_LAYOUT ?? "identity";
// semantic anchor (FC-NOSE-BASE-TIP): Stage 0's nose BASE ↔ the 3D NOSTRIL LINE (alar base), never the nose-tip vertex.
// Measured exactly as in the approved calibration (approved 3D nostril line ≈ sprite nose base: 0.43 vs 0.44 of eye→chin):
// the 5th-percentile height of the front nose surface; anchor = the front-most midline vertex at that height
// (FC-SUBNASALE-MOUTH / FC-SUBNASALE-UNDERTIP: profile minima found the mouth seam or a dip just under the tip)
const NOSEB = (() => { const sn = subnasale(P0, tpl.n, P0[TL.noseTip * 3 + 1], P0[TL.noseTip * 3 + 2], P0[TL.mouth * 3 + 1]); return sn ? sn.i : TL.noseTip; })();
// alar-base verts on the style base (nostril line, left/right extremes of the front nose surface) — nose-width/nostril-line controls
const NOSEW = (() => { const yb = P0[NOSEB * 3 + 1], tipz = P0[TL.noseTip * 3 + 2]; let lo = -1, hi = -1; for (let i = 0; i < tpl.n; i++) { if (tpl.region[i] !== RG.nose || Math.abs(P0[i * 3 + 1] - yb) > 0.01 || P0[i * 3 + 2] < tipz - 0.1) continue; if (lo < 0 || P0[i * 3] < P0[lo * 3]) lo = i; if (hi < 0 || P0[i * 3] > P0[hi * 3]) hi = i; } return [lo, hi]; })();
// learned style-space translation (calibrate-layout.mjs; approved heads only) — identical for every employee
const SL = JSON.parse(fs.readFileSync(`${OUT}/style-layout.json`, "utf8")), SP = JSON.parse(fs.readFileSync(`${OUT}/style-proportions.json`, "utf8"));
const RELIABLE_EDGE = new Set(["visible", "stroke-over-ear", "stroke-over-neck", "edge-over-neck", "scalp-silhouette"]);
const SIM = (() => { const ky = SL.k_y, kfw = SL.k_fw, src = [M.eyeR, M.eyeL, M.mouth, M.nose, M.chin, ...ARC.map((g) => M.contour[g])], dst = [xy(TL.eyeL), xy(TL.eyeR), xy(TL.mouth), xy(NOSEB), xy(TL.chin), ...ARC.map((g) => xy(silV[g]))], isC = src.map((_, i) => i >= 5);
  // model: p = s·(σx·x·(k_fw if contour) , σy·k_y·y) + t   (least squares in s, t over the population-mean layout → style base)
  const sg = [0, 1].map((k) => Math.sign(src.reduce((a, q, i) => a + q[k] * (dst[i][k] - dst.reduce((u, d) => u + d[k], 0) / dst.length), 0)) || 1);
  const pre = (q, c, ky_, kfw_) => [sg[0] * q[0] * (c ? kfw_ : 1), sg[1] * q[1] * ky_];
  const Q = src.map((q, i) => pre(q, isC[i], ky, kfw)), n = Q.length, mq = [0, 1].map((k) => Q.reduce((a, q) => a + q[k], 0) / n), mp = [0, 1].map((k) => dst.reduce((a, q) => a + q[k], 0) / n);
  let num = 0, den = 0; for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) { num += (Q[i][k] - mq[k]) * (dst[i][k] - mp[k]); den += (Q[i][k] - mq[k]) ** 2; }
  const sc = num / den, t = [mp[0] - sc * mq[0], mp[1] - sc * mq[1]];
  const make = (ky_, kfw_) => (q, contour = false) => { const a = pre(q, contour, ky_, kfw_); return [sc * a[0] + t[0], sc * a[1] + t[1]]; };
  const f = make(ky, kfw), resid = Math.sqrt(src.reduce((a, q, i) => { const r2 = f(q, isC[i]); return a + (r2[0] - dst[i][0]) ** 2 + (r2[1] - dst[i][1]) ** 2; }, 0) / n);
  return { f, make, scale: sc, sign: sg, t, resid, ky, kfw }; })();

// ---------- RBF warp (Gaussian, exact with a small ridge) ----------
function rbf(P, cen, dis, sigma, ridge = 1e-6) {
  const m = cen.length, k = (a, b) => Math.exp(-((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / (2 * sigma * sigma));
  const A = cen.map((a, i) => [...cen.map((b, j) => k(a, b) + (i === j ? ridge : 0)), ...dis[i]]);
  for (let c = 0; c < m; c++) { let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; const d = A[c][c]; for (let q = c; q < m + 3; q++) A[c][q] /= d; for (let r = 0; r < m; r++) if (r !== c) { const f = A[r][c]; if (f) for (let q = c; q < m + 3; q++) A[r][q] -= f * A[c][q]; } }
  const Wt = A.map((r) => r.slice(m)), out = Float32Array.from(P);
  for (let i = 0; i < P.length / 3; i++) { const q = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]; let dx = 0, dy = 0, dz = 0; for (let j = 0; j < m; j++) { const g = k(q, cen[j]); dx += Wt[j][0] * g; dy += Wt[j][1] * g; dz += Wt[j][2] * g; } out[i * 3] += dx; out[i * 3 + 1] += dy; out[i * 3 + 2] += dz; }
  return out;
}
const EARV = { l: [], r: [] }, EARRING = { l: new Set(), r: new Set() };
for (let i = 0; i < tpl.n; i++) { const s2 = tpl.region[i] === RG.earL ? "l" : tpl.region[i] === RG.earR ? "r" : null; if (!s2) continue; EARV[s2].push(i); for (const j of tpl.nb[i]) if (tpl.region[j] !== tpl.region[i]) EARRING[s2].add(j); }
/** each canonical ear moves rigidly with the mean displacement of the skull ring it is attached to (shape never changes) */
// k-ring distance (≤ 6) from each ear: the ear moves rigidly, the skull around it fades from rigid (ring 0) to warped (ring 6)
const EARK = { l: new Map(), r: new Map() }; for (const s2 of ["l", "r"]) { let fr = EARV[s2]; for (const i of fr) EARK[s2].set(i, 0);
  for (let k = 1; k <= 6; k++) { const nx = []; for (const i of fr) for (const j of tpl.nb[i]) if (!EARK[s2].has(j)) { EARK[s2].set(j, k); nx.push(j); } fr = nx; } }
const SCULPT_CAL = VAR === "V" ? (() => { const A = `${OUT}/approved-fits`, W = JSON.parse(fs.readFileSync(new URL("./approved-heads.json", import.meta.url), "utf8")).heads; return calibrate(tpl, Float32Array.from(JSON.parse(fs.readFileSync(`${A}/mean.json`, "utf8")).X), W.map((w) => Float32Array.from(JSON.parse(fs.readFileSync(`${A}/${w}.json`, "utf8")).X))); })() : null;
const EARZONE = new Uint8Array(tpl.n), EARTAPER = new Float32Array(tpl.n).fill(1);   // the volume prior fades to zero toward each ear (no step)
for (const s2 of ["l", "r"]) for (const [i, k] of EARK[s2]) { EARZONE[i] = 1; const t = k / 6; EARTAPER[i] = Math.min(EARTAPER[i], t * t * (3 - 2 * t)); }
const EARNEAR = new Int32Array(tpl.n).fill(-1); for (const s2 of ["l", "r"]) { const R2 = [...EARRING[s2]]; for (const i of EARV[s2]) { let b2 = -1, bd = Infinity; for (const j of R2) { const d2 = (P0[i * 3] - P0[j * 3]) ** 2 + (P0[i * 3 + 1] - P0[j * 3 + 1]) ** 2 + (P0[i * 3 + 2] - P0[j * 3 + 2]) ** 2; if (d2 < bd) { bd = d2; b2 = j; } } EARNEAR[i] = b2; } }
// exact whole-section half-width at height y (template edges ∩ plane; ears + their 2 inner blend rings excluded) — the cranium's measurement (QA uses the same idea)
const SEC_E = (() => { const ex = (i) => tpl.region[i] === RG.earL || tpl.region[i] === RG.earR || (EARK.l.get(i) ?? 99) <= 2 || (EARK.r.get(i) ?? 99) <= 2, seen = new Set(), E = [];
  for (let t = 0; t < tpl.I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = tpl.I[t * 3 + k], b = tpl.I[t * 3 + (k + 1) % 3]; if (ex(a) || ex(b)) continue; const key = a < b ? a * tpl.n + b : b * tpl.n + a; if (!seen.has(key)) { seen.add(key); E.push(a, b); } } return Int32Array.from(E); })();
const secHalf = (Y, y) => { let lo = Infinity, hi = -Infinity; for (let e = 0; e < SEC_E.length; e += 2) { const a = SEC_E[e], b = SEC_E[e + 1], ya = Y[a * 3 + 1], yb = Y[b * 3 + 1]; if ((ya - y) * (yb - y) > 0 || ya === yb) continue; const x = Y[a * 3] + ((y - ya) / (yb - ya)) * (Y[b * 3] - Y[a * 3]); if (x < lo) lo = x; if (x > hi) hi = x; } return (hi - lo) / 2; };
function rigidEars(X) { for (const s2 of ["l", "r"]) { const d = [0, 0, 0]; for (const j of EARRING[s2]) for (let q = 0; q < 3; q++) d[q] += (X[j * 3 + q] - P0[j * 3 + q]) / EARRING[s2].size;
    for (const [i, k] of EARK[s2]) { const w = k === 0 ? 1 : 1 - k / 6, t = w * w * (3 - 2 * w); for (let q = 0; q < 3; q++) X[i * 3 + q] = P0[i * 3 + q] + t * d[q] + (1 - t) * (X[i * 3 + q] - P0[i * 3 + q]); } } return X; }
/** LOCAL FOLD ROLLBACK (shared): relax Y toward ref only in small 2-ring zones around folded triangles (vs the canonical
 *  template); returns true when fold-free. Refuses (false) if the folds are not a few local spots (> maxVerts). */
function localRollback(Y, ref, maxVerts = 60) { const flipSet = () => { const bad = new Set(); for (let t = 0; t < tpl.I.length / 3; t++) { const a = triNormal(tpl.P, tpl.I, t), b = triNormal(Y, tpl.I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) for (let q = 0; q < 3; q++) bad.add(tpl.I[t * 3 + q]); } return bad; };
  let bad = flipSet(); if (bad.size > maxVerts) return false;
  for (let pass = 0; pass < 20 && bad.size; pass++) { let fr = [...bad]; const zone = new Set(fr); for (let k = 0; k < 2; k++) { const nx = []; for (const i of fr) for (const j of tpl.nb[i]) if (!zone.has(j)) { zone.add(j); nx.push(j); } fr = nx; }
    for (const i of zone) for (let q = 0; q < 3; q++) Y[i * 3 + q] = ref[i * 3 + q] + 0.5 * (Y[i * 3 + q] - ref[i * 3 + q]); bad = flipSet(); }
  return !bad.size; }
/** after any rollback: a short relaxation of the DISPLACEMENT (Y − ref) so rolled zones blend into their surroundings */
function relaxDisp(Y, ref, its = 4) { const D = new Float32Array(Y.length); for (let i = 0; i < Y.length; i++) D[i] = Y[i] - ref[i];
  for (let it = 0; it < its; it++) { const T = D.slice(); for (let i = 0; i < tpl.n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb) a += T[j * 3 + q]; D[i * 3 + q] = 0.5 * T[i * 3 + q] + 0.5 * a / nb.length; } } }
  const Z = Float32Array.from(ref, (v, i) => v + D[i]); let f = 0; for (let t = 0; t < tpl.I.length / 3; t++) { const a = triNormal(tpl.P, tpl.I, t), b = triNormal(Z, tpl.I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) { f++; break; } } if (!f) Y.set(Z); return !f; }
const flipWhere = (X) => { const h = {}; for (let t = 0; t < tpl.I.length / 3; t++) { const a = triNormal(TPLP, tpl.I, t), b = triNormal(X, tpl.I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) { const v = tpl.I[t * 3], k = Object.keys(RG).find((q) => RG[q] === tpl.region[v]) + (EARZONE[v] ? "@ear" : "") + `@y${(X[v * 3 + 1] - tpl.centre[1]).toFixed(2)}z${(X[v * 3 + 2] - tpl.centre[2]).toFixed(2)}`; h[k] = (h[k] ?? 0) + 1; } } return h; };
const flips = (X) => { let f = 0; for (let t = 0; t < tpl.I.length / 3; t++) { const a = triNormal(TPLP, tpl.I, t), b = triNormal(X, tpl.I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) f++; } return f; };

// ---------- colour helpers ----------
const lab2rgb = ([L, a, b]) => { const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.95047 * f(fx), Y = f(fy), Z = 1.08883 * f(fz), lin = [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
  return lin.map((c) => Math.max(0, Math.min(255, Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))))); };
const inPoly = (q, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const segD = (q, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1e-12, t = Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / l2)); return Math.hypot(q[0] - a[0] - t * vx, q[1] - a[1] - t * vy); };
const polyD = (q, pl) => { let d = Infinity; for (let i = 0; i + 1 < pl.length; i++) d = Math.min(d, segD(q, pl[i], pl[i + 1])); return d; };

let shoulderY = -Infinity; for (let i = 0; i < base.geo.P.length / 3; i++) { const x = Math.abs(base.geo.P[i * 3]); if (x > 0.16 && x < 0.3 && base.geo.P[i * 3 + 1] < 0.95) shoulderY = Math.max(shoulderY, base.geo.P[i * 3 + 1]); }
const ring = tpl.neckRing; let ncx = 0, ncz = 0; for (const r of ring) { ncx += r.p[0] / ring.length; ncz += r.p[2] / ring.length; } let nr = 0; for (const r of ring) nr += Math.hypot(r.p[0] - ncx, r.p[2] - ncz) / ring.length;

/** layout of a canonical-resolution head: control verts + front-silhouette widths (ears/back excluded) — audit only */
function layoutOf(Xs) { const g = (i) => [+Xs[i * 3].toFixed(5), +Xs[i * 3 + 1].toFixed(5), +Xs[i * 3 + 2].toFixed(5)], eR = g(TL.eyeL), eL = g(TL.eyeR), mo = g(TL.mouth), ch = g(TL.chin), ey = (eR[1] + eL[1]) / 2;
  const wAt = (y) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < tpl.n; i++) { if (tpl.region[i] === RG.earL || tpl.region[i] === RG.earR || Xs[i * 3 + 2] < tpl.centre[2] || Math.abs(Xs[i * 3 + 1] - y) > 0.004) continue; lo = Math.min(lo, Xs[i * 3]); hi = Math.max(hi, Xs[i * 3]); } return +(hi - lo).toFixed(5); };
  return { cR: eR, cL: eL, noseBase: g(NOSEB), noseTip: g(TL.noseTip), mouthC: mo, chin: ch, faceWeye: wAt(ey), jawW: wAt(mo[1] + 0.5 * (ch[1] - mo[1])), chinW: wAt(mo[1] + 0.8 * (ch[1] - mo[1])) }; }
export async function buildS(who) {
  const t0 = Date.now(), p = withEyeEvidence(S0[who]); if (!p?.contour) throw new Error(`${who}: no Stage 0 representation — fail closed`);
  // INPUT PLAUSIBILITY GATE (FC-S0-IMPLAUSIBLE): an implausible Stage 0 record is refused — Stage 1 never invents proportions to cover it
  { const G = inputGate(p); if (!G.pass && !DIAG.has("gate")) throw new Error(`${who}: Stage 0 input implausible — fail closed · ${G.failed.map((k) => `${k} ${JSON.stringify(G.checks[k].value)} (limit ${G.checks[k].limit})`).join(" · ")}`); }
  // FACE SHAPE COMPLETION (envelope.mjs): occlusion is missing evidence, not missing anatomy — one continuous face envelope
  const ENV = completeFor(p, SP.prior.envelope, await hairOuterFrom(`${S0DIR}/${who}-hairmask.png`, sharp), who, { eyeSideMargin: SP.locked["eye.sideMargin_IOD"]?.v });
  const r = rep(p), report = { who, variant: VAR, input: { stage0: `${S0DIR}/identity.json`, sourceHash: p.sourceHash }, population: M.n, styleFitMaxErr: +styleFit.toExponential(2) };
  // ---- 1. controls: canonical surface points + displacement C(person) − C(mean) in the front plane (z = 0) ----
  const cen = [], dis = [], ctrlLog = [], IDL = LAYOUT === "identity";
  // identity: target = SIM(person point) (absolute; missing evidence → SIM(population mean)); legacy: C(person) − C(mean)
  const dxyAt = (pq, mq, vi, kind) => { if (!IDL) { const a = C(pq ?? mq), b = C(mq); return [a[0] - b[0], a[1] - b[1], 0]; } const a = LMAP(pq ?? mq, kind); return [a[0] - P0[vi * 3], a[1] - P0[vi * 3 + 1], 0]; };
  const feat = [["eyeR", r.eyes.R?.c, M.eyeR, TL.eyeL], ["eyeL", r.eyes.L?.c, M.eyeL, TL.eyeR], ["mouth", r.mouthC, M.mouth, TL.mouth], ["nose", r.nose?.base, M.nose, IDL ? NOSEB : TL.noseTip], ["chin", chinOf(r), M.chin, TL.chin]];
  let LMAP = SIM.f; report.layout = { mode: LAYOUT };
  const KF = { eyeR: "eyeR", eyeL: "eyeL", mouth: "mouth", nose: "nose", chin: "contour" }; let H3L = 0, SCL = 0;
  // outline evidence per grid point (FC-HAIR-AS-SKULL): reliable edge → used; else the opposite side mirrored when reliable;
  // else no identity constraint (the style base silhouette stays) — hair-bounded edges never define the face/skull width
  // outline control points come from the COMPLETED envelope at the grid point's level (provenance-tagged); above the temple the
  // face hands over to the canonical cranium (tFade). Hair never acts as face geometry.
  const midXn = (ENV.fr.midX - r.F.E[0]) / r.F.u, tOf = (yn) => (yn * r.F.u + r.F.E[1] - ENV.fr.eyeY) / ENV.fr.H, envW = (t) => envAt(ENV, t);
  const arcEv = (g) => { const c = r.contour[g]; if (!c) return null; const t = tOf(c.q[1]); if (t < -0.55 || t > 1.0) return null; const e = envW(t), side = Math.sign(c.q[0] - midXn) || 1;
    return { q: [midXn + side * e.w * ENV.fr.iod / r.F.u, c.q[1]], src: e.cls, t }; };
  if (IDL) {
    // IDENTITY PROPORTION MAP (proportions.mjs): Stage 0 relationships → learned Offshorly style transform (per relationship,
    // approved sprite→3D pairs; weak evidence ⇒ identity kept) → TARGET map → proportion-space warp. Feature positions AND shapes
    // come from this one map; the only free parameters are the face's absolute scale + offset in the canonical head (least squares
    // vs the style base layout, features ×3, evidence-backed outline ×1). Sculpt controls never move features afterwards.
    const s0m = measureS0(p, { ...SP.prior, env: ENV }), TM = translate(s0m.map, SP.style, SP.locked), PW = layoutWarp(r, s0m, TM), sgx = SIM.sign[0], sgy = SIM.sign[1];
    const K = (kind) => (kind === true ? "contour" : kind || "general"), mOf = (q, kind) => { const a = PW(q, K(kind)); return [sgx * a[0], sgy * a[1]]; };
    const pairs = []; for (const [k, pq, mq, vi] of feat) pairs.push([mOf(pq ?? mq, KF[k]), [P0[vi * 3], P0[vi * 3 + 1]], 3]);
    // placement = FEATURES only (FC-PLACEMENT-HAIR-DRIFT: outline samples on hair boundaries shifted the face up the skull); the outline is the envelope's job
    const Wt = pairs.reduce((s2, x) => s2 + x[2], 0), mm = [0, 1].map((k) => pairs.reduce((s2, x) => s2 + x[2] * x[0][k], 0) / Wt), pp = [0, 1].map((k) => pairs.reduce((s2, x) => s2 + x[2] * x[1][k], 0) / Wt);
    let num = 0, den = 0; for (const [m2, p2, w2] of pairs) for (let k = 0; k < 2; k++) { num += w2 * (m2[k] - mm[k]) * (p2[k] - pp[k]); den += w2 * (m2[k] - mm[k]) ** 2; }
    const sc = num / den, tt = [pp[0] - sc * mm[0], pp[1] - sc * mm[1]];
    LMAP = (q, kind) => { const m2 = mOf(q, kind); return [sc * m2[0] + tt[0], sc * m2[1] + tt[1]]; }; H3L = TM["frame.faceH_IOD"].v; SCL = sc;
    const cmp = (M2) => Object.fromEntries(Object.entries(M2).map(([k, v]) => [k, { v: +v.v.toFixed(4), ...(v.raw != null ? { raw: +v.raw.toFixed(4), style: v.style, clamped: v.clamped } : {}), flag: v.flag }]));
    report.layout.ipm = { stage0: cmp(s0m.map), target: cmp(TM), outlineLevelsConstrained: PW.outlineLevels, placement: { scale: +sc.toFixed(4), offset: tt.map((v) => +v.toFixed(4)), n: pairs.length } }; }
  for (const [k, pq, mq, vi] of feat) { const d = pq || IDL ? dxyAt(pq, mq, vi, KF[k]) : [0, 0, 0]; cen.push(at0(vi)); dis.push(d); ctrlLog.push({ k, src: pq ? "observed" : "prior", d: d.map((v) => +v.toFixed(4)) }); }
  // SOCKET ANCHORS (FC-SOCKET-COMPRESSION, learned with shape completion): the outer/inner orbit of each eye moves RIGIDLY with its eye
  // centre, so outline narrowing happens between the orbit and the silhouette — never by compressing the eye socket (which made the
  // temple wall recede behind the eyeball)
  if (IDL) { const iod0 = Math.abs(P0[TL.eyeL * 3] - P0[TL.eyeR * 3]); for (let k = 0; k < 2; k++) { const vi = feat[k][3], d0 = dis[k], ex0 = P0[vi * 3], ey0 = P0[vi * 3 + 1], sg = Math.sign(ex0) || 1;
      for (const off of [0.42, -0.3]) { const a = nearestFront(ex0 + sg * off * iod0, ey0); if (a < 0) continue; cen.push(at0(a)); dis.push(d0.slice()); ctrlLog.push({ k: `orbit${k}${off > 0 ? "o" : "i"}`, src: "rigid with eye", d: d0.map((v) => +v.toFixed(4)) }); } } }
  // NOSE as a unit: alar base (Stage 0 wings) + TIP from the style-locked tip-above-nostril relation (not observable in a front drawing)
  // (alar wings are NOT warp controls — FC-NOSE-CONTROL-CROWDING: wing + base + tip controls inside 3 cm folded the warp; the nose
  // module builds the alae at the Stage 0 wing positions on the same map)
  if (IDL && r.nose) { const b3 = LMAP(r.nose.base, "nose"), tipY = b3[1] + SP.locked["nose.tipAboveBase_H"].v * H3L * SCL; cen.push(at0(TL.noseTip)); dis.push([b3[0] - P0[TL.noseTip * 3], tipY - P0[TL.noseTip * 3 + 1], 0]); ctrlLog.push({ k: "noseTip", src: "style-locked", d: dis[dis.length - 1].map((v) => +v.toFixed(4)) });
    report.layout.noseTipTarget = [+b3[0].toFixed(5), +tipY.toFixed(5)]; }
  // ENVELOPE OUTLINE CONTROLS (identity layout): each canonical silhouette vertex keeps its RELATIVE face height t (on the style base)
  // and moves to the style-translated COMPLETED envelope width at that same t, at that t's height in the target layout
  // (FC-ARC-HEIGHT-DRIFT: using the person's contour sample height dragged the cheeks/eyes when that sample was a hair boundary)
  let envCtl = null; if (IDL) { const TMv = report.layout.ipm.target, Lv = ENV.levels, eR3 = LMAP(r.eyes.R.c, "eyeR"), eL3 = LMAP(r.eyes.L.c, "eyeL"), iod3 = Math.hypot(eR3[0] - eL3[0], eR3[1] - eL3[1]), mid3 = (eR3[0] + eL3[0]) / 2;
    const kl = [["forehead", "frame.foreheadW_IOD"], ["temple", "frame.templeW_IOD"], ["eye", "frame.eyeLevelW_IOD"], ["cheekbone", "frame.cheekW_IOD"], ["nose", "frame.noseLevelW_IOD"], ["mouth", "frame.mouthLevelW_IOD"], ["jaw", "frame.jawW_IOD"], ["chin", "frame.chinW_IOD"]].map(([nm, k]) => [Lv[nm], TMv[k] ? TMv[k].v / TMv[k].raw : 1]).sort((a2, b2) => a2[0] - b2[0]);
    const kAt = (t) => { if (t <= kl[0][0]) return kl[0][1]; for (let k = 1; k < kl.length; k++) if (t <= kl[k][0]) { const f = (t - kl[k - 1][0]) / (kl[k][0] - kl[k - 1][0]); return kl[k - 1][1] + f * (kl[k][1] - kl[k - 1][1]); } return kl[kl.length - 1][1]; };
    const yT = (t) => LMAP([midXn, (t * ENV.fr.H + ENV.fr.eyeY - r.F.E[1]) / r.F.u])[1], eyeB = eyeY3, chinB = P0[TL.chin * 3 + 1];
    // below the chin-width level the chin bottom is FORM (style-base round chin), not width (FC-CHIN-SPIKE)
    envCtl = (v) => { const tb = (eyeB - P0[v * 3 + 1]) / (eyeB - chinB); if (tb < -0.55 || tb > 0.85) return null; const e = envAt(ENV, tb), w3 = e.w * kAt(tb) * iod3;
      return { d: [(mid3 + Math.sign(P0[v * 3] - mid3) * w3 - P0[v * 3]) * smooth(-0.55, -0.3, tb), (yT(tb) - P0[v * 3 + 1]) * smooth(-0.55, -0.3, tb), 0], src: e.cls, tb }; };
    report.layout.envTarget = { iod3, mid3, k: kl.map(([t2, k2]) => [+t2.toFixed(3), +k2.toFixed(3)]), t: ENV.t.filter((t2) => t2 >= -0.55).map((t2) => +t2.toFixed(3)), halfW3: ENV.t.filter((t2) => t2 >= -0.55).map((t2) => +(envAt(ENV, t2).w * kAt(t2) * iod3).toFixed(4)), y3: ENV.t.filter((t2) => t2 >= -0.55).map((t2) => +yT(t2).toFixed(4)), cls: ENV.t.map((t2, i) => (t2 >= -0.55 ? ENV.cls[i] : null)).filter(Boolean) }; }
  // ONE OUTLINE PASS (FC-WARP-OUTLINE-FIGHT, learned: the warp's outline controls left the face front narrow and the cranium wide, then the outline
  // solve corrected them in opposite directions (+9% / −7%) across a few cm — a ripple band from the eye to the ear): in identity mode the warp places
  // FEATURES and the outline's HEIGHTS (face height is identity); every WIDTH is built once, by the outline solve, from the traced profile
  // (legacy lateral controls: V3_DIAG_SKIP=warpoutline-legacy)
  const OUTC = new Set();   // indices of the outline controls (vertical-only field below)
  for (const g of ARC_CTRL) { const ec = IDL ? envCtl(silV[g]) : null, cp = IDL ? (ec ? { src: ec.src, t: ec.tb } : null) : contourPt(r, g); let d = IDL ? (ec ? ec.d : [0, 0, 0]) : cp ? dxyAt(cp.q, M.contour[g], silV[g], true) : [0, 0, 0]; if (IDL && !DIAG.has("warpoutline-legacy")) { if (ec && ec.tb > 0.7) continue; OUTC.add(cen.length); }   /* heights from the cheeks up — the jaw/chin silhouette is left FREE (not pinned) for the chin control (FC-UNDERJAW-HEIGHT-SHEAR) */
    // FC-TEMPLE-CREASE (learned): the face outline hands over to the canonical (style-locked) cranium silhouette from the eye line
    // up — identity width applies from the cheekbones down, so a narrow face never creases against the fixed temples
    // (identity layout: the cranium hand-off above the temple is inside envCtl)
    cen.push(at0(silV[g])); dis.push(d); ctrlLog.push({ k: `c${g}`, src: cp?.src ?? "prior", d: d.map((v) => +v.toFixed(4)) }); }
  // FC-EAR-OVERSHOOT (learned in the clay test): pinning the ears while the face narrows beside them made the RBF overshoot
  // on the ear flaps (flared ears) and pinched the face under a canonical-width cranium. Ears are NOT pinned: the skull side
  // follows the face, and each ear is then re-seated as a RIGID canonical ear riding with its root ring (rigidEars).
  for (const k of ["crown", "occiput", "nape", "forehead"]) { cen.push(at0(TL[k])); dis.push([0, 0, 0]); }
  for (let k = 0; k < ring.length; k += 17) { cen.push(ring[k].p.slice()); dis.push([0, 0, 0]); }
  report.controls = ctrlLog;
  if (IDL) { const T2 = (q, c = false) => (q ? LMAP(q, c).map((v) => +v.toFixed(5)) : null), bcq = (b) => (b ? [[...b.top, ...b.bottom].reduce((a, q) => a + q[0], 0) / (b.top.length + b.bottom.length), [...b.top, ...b.bottom].reduce((a, q) => a + q[1], 0) / (b.top.length + b.bottom.length)] : null);
    report.layout.targets = { cR: T2(r.eyes.R?.c, "eyeR"), cL: T2(r.eyes.L?.c, "eyeL"), iR: T2(r.eyes.R?.inner, "eyeR"), iL: T2(r.eyes.L?.inner, "eyeL"), oR: T2(r.eyes.R?.outer, "eyeR"), oL: T2(r.eyes.L?.outer, "eyeL"), noseBase: T2(r.nose?.base, "nose"), wingR: T2(r.nose?.wingR, "nose"), wingL: T2(r.nose?.wingL, "nose"),
      mouthC: T2(r.mouthC, "mouth"), mouthR: T2(r.mouth?.cR, "mouth"), mouthL: T2(r.mouth?.cL, "mouth"), chin: T2(chinOf(r), true), browR: T2(bcq(r.brows.R)), browL: T2(bcq(r.brows.L)), jaw: Array.from({ length: GRID }, (_, g) => g).filter((g) => angOf(g) > 0.25 && angOf(g) < Math.PI - 0.25).map((g) => { const ev = arcEv(g); return ev ? [...T2(ev.q, true), ev.src === "mirrored" ? 1 : 0] : null; }).filter(Boolean),
      // full target drawing (review): feature shapes + the evidence-graded outline, all through the same map
      polys: { eyeR: r.eyes.R ? [...r.eyes.R.upper, ...r.eyes.R.lower.slice().reverse()].map((q) => T2(q, "eyeR")) : null, eyeL: r.eyes.L ? [...r.eyes.L.upper, ...r.eyes.L.lower.slice().reverse()].map((q) => T2(q, "eyeL")) : null,
        mouthU: r.mouth?.upper.map((q) => T2(q, "mouth")), mouthL: r.mouth?.lower.map((q) => T2(q, "mouth")), browR: r.brows.R?.top.map((q) => T2(q)), browL: r.brows.L?.top.map((q) => T2(q)),
        outline: Array.from({ length: GRID }, (_, g) => { const ev = arcEv(g); return ev ? [...T2(ev.q, true), ev.src] : null; }) } }; }
  // ---- 2. fold-free front-plane warp (depth = canonical prior); fail closed ----
  // SEPARATE AXES (FC-WARP-OUTLINE-FIGHT): the lateral field comes from the feature controls only (widths are the outline solve's, built once); the
  // vertical field from features + the outline's traced heights (face height is identity)
  const rbf2 = (P, ce, di, sg) => { if (!OUTC.size) return rbf(P, ce, di, sg); const keep = ce.map((_, k) => !OUTC.has(k)), A = rbf(P, ce.filter((_, k) => keep[k]), di.filter((_, k) => keep[k]), sg), B = rbf(P, ce, di, sg); for (let i = 0; i < A.length / 3; i++) A[i * 3 + 1] = B[i * 3 + 1]; return A; };
  let X = null; for (const gain of [1, 0.85, 0.7]) { for (const sg of (IDL ? [0.18, 0.24, 0.13, 0.32] : [0.13, 0.18, 0.24, 0.32])) { const W = rigidEars(rbf2(P0, cen, dis.map((d) => d.map((v) => v * gain)), sg)); const f0 = flips(W), f = f0 === 0 ? 0 : fadeFolds(tpl, P0, W, { maxIter: 6 }).ok ? 0 : 1; if (!f) { X = W; report.fit = { sigma: sg, gain, folds: 0 }; break; } } if (X) break; }
  if (!X) { const W = rbf(P0, cen, dis, 0.13), Wr = rigidEars(Float32Array.from(W)), h = {}, h2 = {}; for (let t = 0; t < tpl.I.length / 3; t++) { const a = triNormal(P0, tpl.I, t); for (const [Y, H] of [[W, h], [Wr, h2]]) { const b = triNormal(Y, tpl.I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) { const k = Object.keys(RG).find((q) => RG[q] === tpl.region[tpl.I[t * 3]]); H[k] = (H[k] ?? 0) + 1; } } }
    throw new Error(`${who}: no fold-free warp — fail closed · flips raw ${JSON.stringify(h)} · after rigid ears ${JSON.stringify(h2)} · controls ${JSON.stringify(ctrlLog.slice(0, 12).map((c) => [c.k, c.d]))}`); }
  for (let i = 0; i < tpl.n; i++) if (Math.abs(X[i * 3 + 2] - P0[i * 3 + 2]) > 1e-6) throw new Error("the 2D stage changed depth — construction violated");
  // ---- 2a. OUTLINE SOLVE: after the warp OTHER verts can become the front silhouette (FC-SILHOUETTE-SWAP), so the warp's controls
  // alone leave the outline off target. From the eye line down, front-side verts are moved in x so the MEASURED silhouette matches the
  // completed, style-translated envelope (cheek band), jaw, chin width and chin-bottom shape. Smooth by construction (see below);
  // fades to zero toward the back + neck; progressive fold check; fail closed.
  if (IDL && report.layout.ipm && !DIAG.has("outline")) { const TMv = report.layout.ipm.target, ok = (k) => TMv[k] && !/STYLE_PRIOR/.test(TMv[k].flag);
    const eR = LMAP(r.eyes.R.c, "eyeR"), eL = LMAP(r.eyes.L.c, "eyeL"), iod3 = Math.hypot(eR[0] - eL[0], eR[1] - eL[1]), yM = LMAP(r.mouthC, "mouth")[1], yC = (() => { const m = mentonY(X, tpl.n, yM); return Number.isFinite(m) ? m : LMAP(chinOf(r), "contour")[1]; })();   /* the MEASURED menton — QA's levels (FC-SOLVE-LEVELS-MENTON: the target menton put the chin-shape levels where QA never measures) */
    // CHIN SHAPE (FC-CHIN-PRIOR-OVERRIDE, learned): the chin bottom used to be the shared style base's — every chin came out alike. The
    // person's style-translated roundness (half-width at 25/50/75% from the chin-width level to the menton) now sets those levels too.
    const chT = ok("frame.chinW_IOD") ? TMv["frame.chinW_IOD"].v * iod3 : null, yCl = yM + 0.8 * (yC - yM), yJ = yM + 0.5 * (yC - yM), yN = r.nose ? LMAP(r.nose.base, "nose")[1] : null;
    // TEMPLE→jaw band (FC-CRANIUM-LOCKED, learned on a holdout: starting at the eye line left the temples to the canonical cranium, +16% on a
    // narrow-templed person): evidence-backed temple levels join; above the band the correction carries into the cranium, fading out 60% of the way
    // to the crown — the skull follows the person's temple proportion with no waist. Hair-hidden (STYLE_PRIOR) temples are never forced.
    // eye-line→jaw band follows the CONTINUOUS style-translated envelope (FC-OUTLINE-WIGGLE: matching only a few levels left ±6–11%
    // wiggles; FC-OUTLINE-ONSET-CREASE: the band starts at the eye line, where the correction is ~0); then jaw, chin width and the
    // person's chin-bottom shape
    const ET = report.layout.envTarget, yE3 = (eR[1] + eL[1]) / 2, band = ET ? ET.t.map((t, i) => [ET.y3[i], 2 * ET.halfW3[i], t, ET.cls[i]]).filter(([y, , t, c], i) => i % 2 === 0 && (DIAG.has("eyelineband") ? y <= yE3 + 1e-6 : t >= -0.35) && y > yCl + 0.005 && Math.abs(y - yJ) > 0.005 && !/STYLE_PRIOR/.test(c ?? "")).map(([y, w]) => [y, w, "band"]) : [];
    // (FC-JAW-CHIN-GAP, learned: no level between the jaw and chin-width heights let that stretch bulge 6–10%; the band now runs to the chin level)
    // CHIN BOTTOM = ONE SMOOTH CURVE (FC-CHIN-LEVEL-LOBES, learned: three independent roundness levels, each solved on its own, left lobes where the chin
    // meets the jaw): the traced roundness relations (25/50/75%) are fitted by one convex curve w(f) = (1 − f^p)^(1/q) — round, flat or pointed is the
    // person's (p, q) — and the chin is solved on that curve at dense levels
    const CHF = (() => { const obs = [25, 50, 75].filter((f) => ok(`frame.chinRound${f}`)).map((f) => [f / 100, TMv[`frame.chinRound${f}`].v]); if (!chT || obs.length < 2) return null; let best = null;
      for (let p2 = 1; p2 <= 8.001; p2 += 0.05) for (let q2 = 1; q2 <= 8.001; q2 += 0.05) { const e = obs.reduce((a2, [f, r2]) => a2 + ((1 - f ** p2) ** (1 / q2) - r2) ** 2, 0); if (!best || e < best.e) best = { p: p2, q: q2, e }; }
      return { ...best, g: (f) => (1 - f ** best.p) ** (1 / best.q), obs }; })();
    if (CHF) report.layout.chinCurve = { p: +CHF.p.toFixed(2), q: +CHF.q.toFixed(2), rmsErr: +Math.sqrt(CHF.e / CHF.obs.length).toFixed(4), fit: CHF.obs.map(([f, r2]) => [f, r2, +CHF.g(f).toFixed(4)]) };
    const chinLv = CHF ? [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.875].map((f) => [yCl + f * (yC - yCl), chT * CHF.g(f), "chin"]) : [25, 50, 75].map((f) => [yCl + (f / 100) * (yC - yCl), chT && ok(`frame.chinRound${f}`) ? chT * TMv[`frame.chinRound${f}`].v : null, "chin"]);
    const lv = [...band, [yJ, ok("frame.jawW_IOD") ? TMv["frame.jawW_IOD"].v * iod3 : null, "jaw"], [yCl, chT, "chin"], ...chinLv].filter((v) => v[1]).sort((a2, b2) => b2[0] - a2[0]);
    // ONE CONTINUOUS FACE OUTLINE (FC-OUTLINE-ONE-CURVE, learned: the jaw narrowed steeply to the chin-width level while the chin curve started gently below it
    // — two separately solved pieces met in an inward kink that read as chin lobes): the traced targets (cheeks/eye-level band, jaw, chin width, chin
    // roundness) are joined into the LEAST CONVEX OUTLINE over them (upper concave hull of half-width vs height — a face outline has no dents), lightly
    // smoothed. Individual jaw breadth and chin roundness survive (the hull only fills notches between them).
    // LEAST-SQUARES CONVEX OUTLINE (FC-OUTLINE-ONE-CURVE): the closest outline to the traced targets whose half-width is a CONCAVE function of height
    // (projection onto the concave cone, Hildreth dual ascent) — it moves targets both ways, so an inconsistent jaw↔chin pair is split, not filled
    if (!DIAG.has("outlinepieces") && lv.length > 3) { const P0s = lv.map((v) => [v[0], v[1] / 2]).sort((a2, b2) => a2[0] - b2[0]), P2 = []; for (const q of P0s) { const l = P2[P2.length - 1]; if (l && q[0] - l[0] < 1e-4) l[1] = (l[1] + q[1]) / 2; else P2.push(q.slice()); }
      { const m = P2.length, Y2 = P2.map((q) => q[0]), hh = P2.map((q) => q[1]), lam = new Float64Array(m), A = []; for (let k = 1; k + 1 < m; k++) { const d0 = Y2[k] - Y2[k - 1], d1 = Y2[k + 1] - Y2[k]; A.push([k, 1 / d0, -1 / d1 - 1 / d0, 1 / d1]); }
        for (let sw = 0; sw < 4000; sw++) { let moved = 0; A.forEach(([k, a0, a1, a2], j) => { const v = a0 * hh[k - 1] + a1 * hh[k] + a2 * hh[k + 1], nn = a0 * a0 + a1 * a1 + a2 * a2, l2 = Math.max(0, lam[j] + v / nn), d = l2 - lam[j]; if (d) { hh[k - 1] -= d * a0; hh[k] -= d * a1; hh[k + 1] -= d * a2; lam[j] = l2; moved += Math.abs(d); } }); if (moved < 1e-12) break; }
        P2.forEach((q, k) => (q[1] = hh[k])); }
      const H = P2;
      const hull = (y) => { if (y <= H[0][0]) return H[0][1]; for (let k = 1; k < H.length; k++) if (y <= H[k][0]) { const f = (y - H[k - 1][0]) / (H[k][0] - H[k - 1][0]); return H[k - 1][1] + f * (H[k][1] - H[k - 1][1]); } return H[H.length - 1][1]; };
      const sgH = 0.04 * Math.abs(yE3 - yC), yLo = P2[0][0], yHi = P2[P2.length - 1][0], sm2 = (y) => { const hw = Math.min(3 * sgH, y - yLo, yHi - y), sg = hw / 3; if (sg < 1e-5) return hull(y); let a2 = 0, w2 = 0; for (let k = -12; k <= 12; k++) { const yy = y + (k / 12) * hw, ww = Math.exp(-0.5 * ((yy - y) / sg) ** 2); a2 += ww * hull(yy); w2 += ww; } return a2 / w2; };   /* SYMMETRIC window, shrinking at the ends (a one-sided window lifted the chin tip) */
      const before = lv.map((v) => v[1]); for (const v of lv) v[1] = 2 * sm2(v[0]);
      report.layout.outlineCurve = { fit: "least-squares concave", of: P2.length, maxUp: +Math.max(...lv.map((v, k) => v[1] / before[k] - 1)).toFixed(4), maxDown: +Math.min(...lv.map((v, k) => v[1] / before[k] - 1)).toFixed(4), levels: lv.map((v, k) => [+v[0].toFixed(4), v[2], +before[k].toFixed(4), +v[1].toFixed(4)]) }; }
    // ONE outline definition (FC-OUTLINE-DEFINITION-MISMATCH, learned: a "robust" ±6 mm, 3-vertex silhouette here vs the ±4 mm single
    // outline in QA smeared the chin tip, where levels are ~7 mm apart — the solve read the 75% level 10% wide and made the chin pointy).
    // Noise is handled by smoothing the scale profile, never by a different measurement.
    const sil = (Y, y) => faceOutlineX(Y, tpl.n, tpl.region, RG.earL, RG.earR, tpl.centre[2], iod3, y, 0.004, tpl.I);
    let yCrown = -Infinity, yCrown0 = -Infinity; for (let i = 0; i < tpl.n; i++) { yCrown = Math.max(yCrown, X[i * 3 + 1]); yCrown0 = Math.max(yCrown0, P0[i * 3 + 1]); }
    // CRANIUM CONTINUATION (FC-CRANIUM-WAIST, learned: a temple correction that faded back to the canonical skull width above the temple left a waist —
    // narrow temples under a canonical-width cranium): above the highest traced level the skull is the CANONICAL skull outline (style) × the person's
    // traced width ratio at that level, carried unchanged to the crown, through the whole section (sides + back). One smooth skull, no hand-back.
    const CRANIUM = lv.length > 0 && lv[0][2] === "band" && !DIAG.has("craniumfade");
    // WHOLE-SECTION BLEND from just below the ear top to the temple, ~0.45 face heights (FC-TEMPLE-SECTION-STEP, learned twice: a 0.1-unit blend from
    // front-only to whole-section correction stepped the outline ~1 cm, and at the ear top it drew a ridge from the eye to the ear on the head's side)
    let yEarTop = -Infinity; for (const s3 of ["l", "r"]) for (const i of EARV[s3]) yEarTop = Math.max(yEarTop, X[i * 3 + 1]);
    // ABOVE THE EAR TOP the skull SIDE is the silhouette: the cranium is measured + targeted on the EXACT whole cross-section (secHalf). Target =
    // the canonical skull profile LOW-PASSED (style is the skull's shape — the base's face↔scalp seam carries a ~3 mm ledge at the temple, FC-BASE-TEMPLE-LEDGE)
    // × the person's traced width RATIO (target / canonical outline at the same relative height) from the traced levels above the ear top, smoothed and
    // carried unchanged above the highest traced level. Traced band levels above the ear top become these levels (one measurement there, not two).
    if (CRANIUM) { const HfC = Math.abs(yE3 - yC), mapC = (y) => eyeY3 + ((y - yE3) / Math.max(1e-4, yCrown - yE3)) * (yCrown0 - eyeY3), frontC = (y) => { const w2 = sil(P0, mapC(y)); return (w2[1] - w2[0]) / 2; };
      const HSr = []; for (let y2 = mapC(yEarTop) - 0.06; y2 <= yCrown0 - 0.004; y2 += 0.004) { const h = secHalf(P0, y2); if (Number.isFinite(h)) HSr.push([y2, h]); }
      const HS = (y2) => { let a2 = 0, w2 = 0; for (const [yy, h] of HSr) { const ww = Math.exp(-0.5 * ((yy - y2) / 0.03) ** 2); a2 += ww * h; w2 += ww; } return w2 ? a2 / w2 : NaN; };
      const up = lv.filter((v) => v[2] === "band" && v[0] > yEarTop + 0.01), src = up.length ? up : [lv[0]], rL = src.map(([y2, w]) => [y2, w / 2 / frontC(y2)]), yHi = Math.max(...rL.map((q) => q[0]));
      const rAt = (y2) => { const yy2 = Math.min(y2, yHi); let a2 = 0, w2 = 0; for (const [yy, r2] of rL) { const ww = Math.exp(-0.5 * ((yy - yy2) / (0.1 * HfC)) ** 2); a2 += ww * r2; w2 += ww; } return a2 / w2; };
      const add = []; for (let y = yEarTop + 0.01; y <= yEarTop + 0.85 * (yCrown - yEarTop); y += 0.012) { const h2 = HS(mapC(y)); if (Number.isFinite(h2) && h2 > 0.02) add.push([y, 2 * rAt(y) * h2, "cranium"]); }
      for (const v of up) lv.splice(lv.indexOf(v), 1); lv.push(...add); lv.sort((a2, b2) => b2[0] - a2[0]);
      report.layout.cranium = { ratioAll: lv.filter((v) => v[2] === "band" || v[2] === "jaw").map((v) => [+v[0].toFixed(4), +(v[1] / 2 / frontC(v[0])).toFixed(4)]).concat(up.map((v) => [+v[0].toFixed(4), +(v[1] / 2 / frontC(v[0])).toFixed(4), "up"])), ratioTop: +rAt(yHi).toFixed(4), ratioEarTop: +rAt(yEarTop).toFixed(4), tracedLevelsAboveEar: up.length, levels: add.length, yEarTop: +yEarTop.toFixed(4) }; }
    const XB = Float32Array.from(X), log2 = [], yTop = lv.length ? (lv.find((v) => v[2] !== "cranium") ?? lv[0])[0] : yM, mdF = ET ? ET.mid3 : 0, Hf = Math.abs(yE3 - yC), yCF = yTop + 0.6 * Math.max(0, yCrown - yTop);   /* onset fade is face-relative (FC-OUTLINE-ONSET-CREASE: a 3.5 cm fade on a 0.4-unit face creased the eye line) */   /* lv entries are [y, targetWidth, kind] */
    // PROGRESSIVE + SMOOTH (FC-OUTLINE-FOLD, learned: dense levels with noisy per-level scales folded the mesh): scales smoothed along y,
    // damped steps, fold check after EVERY iteration — keep the last fold-free state instead of reverting everything
    let lastGood = Float32Array.from(X), stopped = null; const outlineFaded = [];
    for (let it = 0; it < 6 && lv.length; it++) { const cur0 = lv.map(([y, w, kind]) => { if (kind === "cranium") { const h = secHalf(X, y); return { y, kind, s: w / (2 * h), half: h }; } const s2 = sil(X, y); return { y, kind, s: w / (s2[1] - s2[0]), half: (s2[1] - s2[0]) / 2 }; });
      // SMOOTH scale profile (FC-OUTLINE-RIPPLE / FC-OUTLINE-LEDGE, learned): the cheek band + jaw are Gaussian-smoothed along y at the
      // FACE's scale, coarse→fine (σ = 15% → 10% of eye→chin, never finer; a 2 cm σ was one level wide on this head and let the residual flip sign at the nose base →
      // a cheek ledge). Chin levels are anatomical targets and keep their own value (smoothing them in erased chin shape); damped 0.7
      const sgY = [0.15, 0.15, 0.12, 0.1, 0.1, 0.1][it] * Math.abs(yE3 - yC), gs = (c) => { const HfS = Math.abs(yE3 - yC), cc = c.kind === "cranium", farC = cc && c.y > yEarTop + 0.12 * HfS, lowF = !DIAG.has("outlinepieces") && c.y < yJ, sg3 = farC ? 0.012 : cc ? 0.12 * HfS : lowF ? (c.y <= yCl + 0.005 ? 0.12 * Math.abs(yCl - yC) : 0.03 * HfS) : c.y > yE3 ? Math.max(sgY, 0.25 * HfS) : sgY;   /* on the chin itself σ scales with the CHIN's height (a face-scale σ smeared its roundness) */ if (c.kind === "chin" && !lowF) return c.s; let a2 = 0, w2 = 0;
        // the face (front outline) and cranium (whole section) levels are smoothed TOGETHER near their junction above the ear (FC-SKULL-JUNCTION-CREASE, learned:
        // smoothing each kind alone left a scale jump at the junction → a zigzag crease band at eye level on the temples); far up the cranium a narrow σ cancels the base's temple ledge
        for (const q of cur0) { if ((q.kind === "chin" && !lowF) || (farC && q.kind !== "cranium")) continue; const ww = Math.exp(-0.5 * ((q.y - c.y) / sg3) ** 2);   /* above the eye line the skull cannot pinch: a wider σ spreads a temple correction over the cranium (FC-CRANIUM-PINCH) */ a2 += ww * q.s; w2 += ww; } return a2 / w2; };
      const cur = cur0.map((c) => ({ ...c, s: 1 + 0.7 * (gs(c) - 1) }));
      const at2 = (y, k) => { if (y >= cur[0].y) return cur[0][k]; for (let j = 1; j < cur.length; j++) if (y >= cur[j].y) { const f = (y - cur[j - 1].y) / (cur[j].y - cur[j - 1].y); return cur[j - 1][k] + f * (cur[j][k] - cur[j - 1][k]); } return cur[cur.length - 1][k]; };
      // outline depth per level: mean z of the 3 outermost verts per side, then smoothed across levels (FC-DEPTH-WINDOW-JITTER, learned: the
      // single outermost vertex's z jumped level to level → jittery window weights → a speckled jawline)
      const zO0 = cur.map((c) => { const pts = []; for (let i = 0; i < tpl.n; i++) { if (tpl.region[i] === RG.earL || tpl.region[i] === RG.earR || Math.abs(X[i * 3 + 1] - c.y) > 0.004 || X[i * 3 + 2] < tpl.centre[2] - FRONT_MARGIN_IOD * iod3) continue; pts.push([Math.abs(X[i * 3] - mdF), X[i * 3 + 2]]); } pts.sort((a2, b2) => b2[0] - a2[0]); const t3 = pts.slice(0, 6); return { y: c.y, z: t3.length ? t3.reduce((a2, q) => a2 + q[1], 0) / t3.length : -Infinity }; });
      const zO = zO0.map((o, j) => { const q = [zO0[j - 1], o, zO0[j + 1]].filter((v) => v && Number.isFinite(v.z)); return { y: o.y, z: q.length ? q.reduce((a2, v) => a2 + v.z, 0) / q.length : o.z }; });
      const zOutAt = (y) => { const q = zO.filter((o) => Number.isFinite(o.z)); if (!q.length) return -Infinity; if (y >= q[0].y) return q[0].z; for (let j = 1; j < q.length; j++) if (y >= q[j].y) { const f = (y - q[j - 1].y) / (q[j].y - q[j - 1].y); return q[j - 1].z + f * (q[j].z - q[j - 1].z); } return q[q.length - 1].z; };
      // ABOVE the band (cranium carry) the ramp's half-width is the skull's OWN outline at each height (FC-CRANIUM-RAMP, learned: holding the temple's
      // half-width made every cranium vertex u > 1 → extrapolated ramp → a ledge around the skull)
      const HA = []; for (let y = yTop; y <= (CRANIUM ? yCrown : yCF) + 0.004; y += 0.004) { const w2 = sil(X, y); HA.push(Number.isFinite(w2[1] - w2[0]) ? (w2[1] - w2[0]) / 2 : null); }
      // the ramp's half-width profile is SMOOTHED along height (FC-RAMP-HALF-RIPPLE, learned: the row-by-row measured half-width carried row noise into
      // R(u) = 2u − 1 behind the outline → horizontal ripples from the eye corner to the ear)
      { const k0 = Math.max(1, Math.round((0.05 * Hf) / 0.004)), src = HA.slice(); for (let k = 0; k < HA.length; k++) { let a2 = 0, w2 = 0; for (let j = Math.max(0, k - 3 * k0); j <= Math.min(HA.length - 1, k + 3 * k0); j++) { if (src[j] == null) continue; const ww = Math.exp(-0.5 * ((j - k) / k0) ** 2); a2 += ww * src[j]; w2 += ww; } HA[k] = w2 ? a2 / w2 : null; } }
      const halfAbove = (y) => { const f = (y - yTop) / 0.004, k = Math.max(0, Math.min(HA.length - 1, Math.floor(f))), a2 = HA[k], b2 = HA[Math.min(HA.length - 1, k + 1)]; if (a2 == null || b2 == null) return a2 ?? b2 ?? at2(yTop, "half"); return a2 + (b2 - a2) * Math.min(1, f - k); };
      const XI = Float32Array.from(X); for (let i = 0; i < tpl.n; i++) { const y = X[i * 3 + 1]; if ((!CRANIUM && y >= yCF) || tpl.region[i] === RG.earL || tpl.region[i] === RG.earR) continue; const cr0 = CRANIUM ? smooth(yEarTop - 0.1 * Hf, yEarTop + 0.35 * Hf, y) : smooth(yTop - 0.06, yTop + 0.04, y), wz = (cr0 + (1 - cr0) * smooth(tpl.centre[2] - 0.17, tpl.centre[2] - 0.11, X[i * 3 + 2]))   /* the cranium is corrected through its WHOLE section (a face-style behind-ear fade dented the skull side — FC-CRANIUM-SECTION) */ * (CRANIUM ? 1 : 1 - smooth(yTop, yCF, y)) * smooth(yC - 0.04, yC, y) * (y >= yJ ? 1 : 1 - smooth(yJ, yJ - 0.02, y) * (1 - smooth(zOutAt(y) - 0.9 * iod3, zOutAt(y) - 0.1 * iod3, X[i * 3 + 2]))); if (!wz) continue;
        // DEPTH WINDOW below the jaw (FC-UNDERJAW-SHEAR, learned: the under-jaw rises toward the neck BEHIND the chin, through every chin level's
        // height, so a y-only field sheared it into a dangling ridge; a normal-based fade froze the chin's own down-facing outline instead):
        // a chin level corrects the surface at/in front of its outline vertex; the hidden under-jaw behind it follows passively, over a LONG fade
        // (0.8 eye spacing — FC-JAW-EDGE-RING, learned: a 0.35 fade left a hard jaw-edge ring on a broad, much-widened chin)
        // FRONT-PLANE MAP (FC-OUTLINE-LEDGE, learned): the correction is a function of (x, y) like the main warp — a depth fade that was
        // full only on FRONTAL verts left the silhouette verts (≈ ear depth) nearly unweighted, so the solve inflated the front cheek over a
        // static side → a cheek ledge. Fades only BEHIND THE EAR (a fade across the ear's blend rings folded them), so the back of the skull stays canonical.
        // LATERAL RAMP R(u) = u² (C1; FC-OUTLINE-CREASE, learned: a smoothstep ramp over the outer 40% stretched the cheek 3.75× the scale
        // error and creased it): features near the midline barely move, the silhouette moves fully; whole-width below the jaw. Scaling is
        // about the envelope's FIXED midline (a per-level measured midline sheared the cheek level by level)
        const sc2 = at2(y, "s"), half = y > yTop ? halfAbove(y) : at2(y, "half"), dx = X[i * 3] - mdF, u = Math.abs(dx) / Math.max(1e-4, half), beta = smooth(yJ, yM, y);
        const gam = CRANIUM ? smooth(yTop, yTop + 0.25 * Hf, y) : 0, R = (1 - gam) * ((1 - beta) * u + beta * (u <= 1 ? u * u : 2 * u - 1)) + gam * u; X[i * 3] += Math.sign(dx) * (sc2 - 1) * half * R * wz; }
      // EARS TRANSLATE with the mean correction of their own root ring (FC-EAR-STRETCH, learned: an ear riding the lateral map stretched to
      // a point; re-seating with the k-ring blend fought the field and lumped the ear root) — canonical ear shape, no seam
      for (const s3 of ["l", "r"]) for (const i of EARV[s3]) { const j = EARNEAR[i]; X[i * 3] += X[j * 3] - XI[j * 3]; }   // each ear vertex follows its NEAREST root-ring vertex (FC-EAR-RING-MISMATCH: a mean translate disagreed with a height-varying field at the seam → spike)
      // local fold ladder (FC-OUTLINE-FOLD): a few marginal triangles (ear blend rings under the lobe) are faded back toward the last
      // fold-free state; only a non-local or unresolvable fold stops the solve (keeping the last good iteration)
      if (flips(X)) { const fw = flipWhere(X), FF = fadeFolds(tpl, lastGood, X, { maxIter: 6, rings: 4 }); if (FF.ok && !flips(X)) { outlineFaded.push(fw); } }
      if (flips(X)) { const fw = JSON.stringify(flipWhere(X)); X.set(lastGood); stopped = `iteration ${it + 1} would fold ${fw} — kept iteration ${it}`; break; } lastGood = Float32Array.from(X); log2.push(cur0.map((c) => +c.s.toFixed(3))); report.layout.outlineApplied = cur.map((c) => [+c.y.toFixed(4), c.kind, +c.s.toFixed(4)]); }
    report.layout.outlineSolve0 = { y: lv.map((v) => +v[0].toFixed(4)), kind: lv.map((v) => v[2]), yM: +yM.toFixed(4), yJ: +yJ.toFixed(4), yC: +yC.toFixed(4), yTop: +yTop.toFixed(4) };
    const f2 = flips(X); if (f2) { X.set(XB); report.layout.outlineSolve = { applied: false, reason: `${f2} folds — reverted (fail closed)` }; } else report.layout.outlineSolve = { applied: true, scales: log2, stopped, localFoldFades: outlineFaded };
    report.layout.envelope = { scale: +ENV.scale.toFixed(4), levels: Object.fromEntries(Object.entries(ENV.levels).map(([k2, t2]) => { const e = envAt(ENV, t2); return [k2, { t: +t2.toFixed(3), halfW_IOD: +e.w.toFixed(4), cls: e.cls }]; })), w: ENV.w.map((v) => +v.toFixed(4)), cls: ENV.cls, t: ENV.t.map((v) => +v.toFixed(3)), priorSrc: ENV.prior.src, lo: ENV.evidence.map((e) => e.lo), hi: ENV.evidence.map((e) => (Number.isFinite(e.hi) ? e.hi : null)) }; }
  report.layout.stages = { styleBase: layoutOf(P0), afterLayoutWarp: layoutOf(X) };
  const stageMap = (Xs, tp) => { try { const m = measure3D(g3OfCanonical(Xs, tp, null)).map; return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.v.toFixed(4)])); } catch (e) { return { error: String(e) }; } };
  if (IDL) report.layout.stageMaps = { afterWarpOutline: stageMap(X, tpl) };
  // ---- 2b. IDENTITY-CONDITIONED VOLUME (variant V): observables → population z-scores → linear drives → 3D fields ----
  if (VAR === "V" && !DIAG.has("basis")) {
    // STYLE-PRIOR RELIEF (same for everyone): the approved-mean Offshorly facial relief the V3 proof template lacked
    // PARAMETRIC SCULPTURE: z += F_base(v) · Σ_region m_r(v) · f_r   (F_base = style-locked Offshorly relief; f_r = identity
    // factor of each semantic region, driven by Stage 0 observables, bounded by the APPROVED heads' own range for that region)
    const o = obsOf(r), z = zscores(o, popObs), d = drives(z), drv = { nose: d.noseProj, lips: 0.5 * d.muzzle + 0.5 * d.lips, chin: d.chinProj, cheeks: 0.5 * d.cheekbone + 0.5 * d.cheekFull, brow: d.browRidge, eyes: d.eyeSocket, rest: d.midface };
    // PARAMETRIC SCULPTURE BASIS (sculpt.mjs): ~30 semantic operators, each calibrated on the approved fits' own spread,
    // driven by Stage 0 z-scores (observed dims by their own measurement, inferred dims by general relations)
    const cal = SCULPT_CAL, od = opDrives(z), XB = Float32Array.from(X); let ok = false;
    for (const gain of [1, 0.75, 0.5]) { const R2 = applyBasis(XB, tpl, od, cal, EARTAPER, gain, { volumeOnly: LAYOUT === "identity" }), FF = fadeFolds(tpl, XB, R2.X, { maxIter: 6 });
      if (FF.ok) { X = R2.X; report.volume = { gain, foldFade: FF, operators: R2.log, observed: [...OBSERVED_OPS] }; ok = true; break; } }
    if (!ok) throw new Error(`${who}: sculpture basis folds at every gain — fail closed`);
    report.volume.observables = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? null : +v.toFixed(4)])); report.volume.z = Object.fromEntries(Object.entries(z).map(([k, v]) => [k, +v.toFixed(2)])); report.volume.drives = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, +v.toFixed(2)])); }
  const N = vertexNormals(X, tpl.I), I = tpl.I, n = tpl.n, at = (i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
  const centre = [0, (at(TL.earLroot)[1] + at(TL.earRroot)[1]) / 2, (at(TL.earLroot)[2] + at(TL.earRroot)[2]) / 2];
  // person-space inverse map (3D front plane → person normalised) for paint + hair: TPS fitted on the person's own controls
  const invSrc = [], invDst = []; for (const [, pq, , vi] of feat) if (pq) { invSrc.push([X[vi * 3], X[vi * 3 + 1]]); invDst.push(pq); }
  // FC-INVERSE-MAP-MISMATCH (learned): the inverse map must use the SAME layout map as the forward warp (identity: LMAP; the
  // legacy TPS C here made apertures explode) — identity mode also anchors every observed feature point (corners, wings, lips)
  if (IDL) { for (const [e2, kd] of [[r.eyes.R, "eyeR"], [r.eyes.L, "eyeL"]]) if (e2) for (const q of [e2.inner, e2.outer, ...e2.upper.filter((_, i) => i % 2 === 0), ...e2.lower.filter((_, i) => i % 2 === 0)]) { invSrc.push(LMAP(q, kd)); invDst.push(q); }
    if (r.nose) for (const q of [r.nose.wingR, r.nose.wingL]) { invSrc.push(LMAP(q, "nose")); invDst.push(q); }
    for (const b of [r.brows.R, r.brows.L]) if (b) for (const q of [b.top[0], b.top[b.top.length - 1], b.top[b.top.length >> 1]]) { invSrc.push(LMAP(q)); invDst.push(q); }
    if (r.mouth) for (const q of [r.mouth.cR, r.mouth.cL, r.mouth.upper[Math.floor(r.mouth.upper.length / 2)], r.mouth.lower[Math.floor(r.mouth.lower.length / 2)]]) { invSrc.push(LMAP(q, "mouth")); invDst.push(q); } }
  for (const g of ARC) { const cp = IDL ? arcEv(g) : contourPt(r, g); if (cp) { const q = IDL ? LMAP(cp.q, true) : C(cp.q); invSrc.push(q); invDst.push(cp.q); } }   // OPEN (hair/paint round): anchoring at the LANDED outline fixes hairline paint (V2) but changes temporary hair coverage (V1 back-facing px) — tested both ways, deferred
  const Cinv = tps(invSrc, invDst, 1e-4), toImg = (x3, y3) => r.F.Ti(Cinv([x3, y3]));
  report.layout.stages.afterBasis = layoutOf(X); if (IDL) report.layout.stageMaps.afterBasis = stageMap(X, tpl);
  if (IDL) { const chk = {}; for (const [k, q, kd] of [["cR", r.eyes.R?.c, "eyeR"], ["iR", r.eyes.R?.inner, "eyeR"], ["oR", r.eyes.R?.outer, "eyeR"], ["uR", r.eyes.R?.upper[4], "eyeR"], ["mouth", r.mouthC, "mouth"], ["chin", chinOf(r), "contour"]]) if (q) { const a = LMAP(q, kd), b = Cinv(a), e2 = 1e-3, dx = Cinv([a[0] + e2, a[1]]), dy = Cinv([a[0], a[1] + e2]);
      chk[k] = { err: +Math.hypot(b[0] - q[0], b[1] - q[1]).toFixed(4), J: [[(dx[0] - b[0]) / e2, (dy[0] - b[0]) / e2], [(dx[1] - b[1]) / e2, (dy[1] - b[1]) / e2]].map((r2) => r2.map((v) => +v.toFixed(2))), q: q.map((v) => +v.toFixed(3)), a: a.map((v) => +v.toFixed(4)) }; }
    report.layout.invCheck = chk; report.layout.invN = invSrc.length; }
  // LANDING of every Stage 0 layout point on this head (where the pipeline places it: 3D front vertex whose person coords match)
  { const fr = []; for (let i = 0; i < n; i++) if (tpl.region[i] !== RG.earL && tpl.region[i] !== RG.earR && X[i * 3 + 2] > centre[2] + 0.05) fr.push([i, Cinv([X[i * 3], X[i * 3 + 1]])]);
    const land = (q) => { if (!q) return null; let b = null, bd = Infinity; for (const [i, c] of fr) { const d = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2; if (d < bd) { bd = d; b = i; } } return at(b).map((v) => +v.toFixed(5)); };
    const bc = (b) => (b ? [[...b.top, ...b.bottom].reduce((a, q) => a + q[0], 0) / (b.top.length + b.bottom.length), [...b.top, ...b.bottom].reduce((a, q) => a + q[1], 0) / (b.top.length + b.bottom.length)] : null);
    const top = [17, 18].map((g) => contourPt(r, g)?.q).filter(Boolean);
    report.layout.landing = { iR: land(r.eyes.R?.inner), oR: land(r.eyes.R?.outer), iL: land(r.eyes.L?.inner), oL: land(r.eyes.L?.outer), cR: land(r.eyes.R?.c), cL: land(r.eyes.L?.c), noseBase: land(r.nose?.base), wingR: land(r.nose?.wingR), wingL: land(r.nose?.wingL),
      mouthC: land(r.mouthC), mouthR: land(r.mouth?.cR), mouthL: land(r.mouth?.cL), chin: land(chinOf(r)), browR: land(bc(r.brows.R)), browL: land(bc(r.brows.L)), top: land(top.length ? [top.reduce((a, q) => a + q[0], 0) / top.length, top.reduce((a, q) => a + q[1], 0) / top.length] : null) }; }
  // ---- 3. hair: the Stage 0 HAIR layer (separate solid; complete head under hair; designed nape; ear tuck) ----
  const hm = await sharp(`${S0DIR}/${who}-hairmask.png`).extractChannel(0).raw().toBuffer({ resolveWithObject: true }), crop = await sharp(`${S0DIR}/${who}-canonical.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const HW = hm.info.width, HH = hm.info.height, isHair = (x, y) => { const X1 = Math.round(x), Y1 = Math.round(y); return X1 >= 0 && Y1 >= 0 && X1 < HW && Y1 < HH && hm.data[Y1 * HW + X1] > 127; };
  const cpx = (x, y) => { const X1 = Math.max(0, Math.min(HW - 1, Math.round(x))), Y1 = Math.max(0, Math.min(HH - 1, Math.round(y))), o = (Y1 * HW + X1) * 3; return [crop.data[o], crop.data[o + 1], crop.data[o + 2]]; };
  const medianCol = (pts) => { const c = pts.map(([x, y]) => cpx(x, y)).sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2]); return c[Math.floor(c.length / 2)] ?? [60, 50, 45]; };
  // CLOSED-SMILE SPEC (mouth.mjs): what the reference draws (line / closed lips / open grin with teeth) decides what is traced
  const mouthK = p.mouth?.found ? classifyMouth(p.mouth, (x, y) => cpx(x, y)) : null, smile = mouthK && r.mouth && SP.prior.smile?.sag != null ? smileSpec({ cornerR: r.mouth.cR, cornerL: r.mouth.cL, upper: r.mouth.upper, lower: r.mouth.lower }, mouthK.kind, SP.prior.smile) : null;
  report.mouth = smile ? { ...mouthK, sag: smile.sag, lipHeight: smile.lipHeight } : { kind: null };
  const hairPix = []; for (let y = 0; y < HH; y += 4) for (let x = 0; x < HW; x += 4) if (isHair(x, y)) hairPix.push([x, y]); const hairC = medianCol(hairPix);
  const sPerPx = Math.hypot(...(([a, b]) => [a[0] - b[0], a[1] - b[1]])([C([1, 0]), C([0, 0])])) / r.F.u;
  const headR = headRadiusMap(X, centre), RB = regionBins(X, centre, tpl.region), mask = new Uint8Array(NT * NP), T = new Float32Array(NT * NP), sideT = new Float32Array(NT), sideN = new Float32Array(NT);
  const [hcx, hcy] = toImg(centre[0], centre[1]), chinImgY = r.F.Ti(chinOf(r) ?? M.chin)[1];
  for (let t = 0; t < NT; t++) for (let pp = 0; pp < NP; pp++) { const k = t * NP + pp, th = (t + 0.5) / NT * Math.PI, ph = (pp + 0.5) / NP * 2 * Math.PI - Math.PI, d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    if (d[2] < -0.1) continue; const q = [centre[0] + d[0] * headR[k], centre[1] + d[1] * headR[k], centre[2] + d[2] * headR[k]], [ix, iy] = toImg(q[0], q[1]);
    const face = RB[k] === RG.face || RB[k] === RG.eyeL || RB[k] === RG.eyeR || RB[k] === RG.nose || RB[k] === RG.mouth || RB[k] === RG.jaw;
    if (!isHair(ix, iy) || (face && q[1] < eyeY3 + 0.05) || (RB[k] === RG.under && iy < chinImgY)) continue;
    let ux = ix - hcx, uy = iy - hcy; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul; let dpx = 0; while (dpx < 600 && isHair(ix + ux * dpx, iy + uy * dpx)) dpx += 2;
    mask[k] = 1; T[k] = Math.min(0.15, Math.max(0.026, dpx * sPerPx * Math.max(0.3, Math.hypot(d[0], d[1])))); if (Math.abs(d[2]) < 0.35) { sideT[t] += T[k]; sideN[t]++; } }
  let crownN = 0, crownH = 0; for (let t = 0; t < NT * 0.2; t++) for (let pp = 0; pp < NP; pp++) { crownN++; if (mask[t * NP + pp]) crownH++; }
  const backCover = crownN ? crownH / crownN : 0; report.hair = { colour: hairC, crownCoverage: +backCover.toFixed(3), source: "stage0 hair layer" };
  for (let t = 0; t < NT; t++) { const st = sideN[t] ? sideT[t] / sideN[t] : 0.03; for (let pp = 0; pp < NP; pp++) { const k = t * NP + pp, th = (t + 0.5) / NT * Math.PI, ph = (pp + 0.5) / NP * 2 * Math.PI - Math.PI;
    if (Math.sin(th) * Math.sin(ph) >= -0.1) continue; if (backCover > 0.5 && RB[k] !== RG.under && RB[k] !== RG.earL && RB[k] !== RG.earR) { mask[k] = 1; T[k] = Math.max(0.026, st); } } }
  const maps = finishMaps(T, mask, 0.026), earVerts = { l: [], r: [] }; for (let i = 0; i < n; i++) { if (tpl.region[i] === RG.earL) earVerts.l.push(i); if (tpl.region[i] === RG.earR) earVerts.r.push(i); }
  const sideOf = (i) => (tpl.region[i] === RG.earL ? "l" : tpl.region[i] === RG.earR ? "r" : null), earTriSide = []; for (let t = 0; t < I.length / 3; t++) earTriSide.push(sideOf(I[t * 3]) && sideOf(I[t * 3]) === sideOf(I[t * 3 + 1]) && sideOf(I[t * 3]) === sideOf(I[t * 3 + 2]) ? sideOf(I[t * 3]) : null);
  const hs = buildHairSolid({ P: X, I }, { centre, headR, T: maps.T, Ms: maps.Ms, ears: { verts: earVerts, index: new TriIndex(X, I, 0.02, (t) => earTriSide[t] !== null), side: earTriSide }, neck: { cx: ncx, cz: ncz, r: nr, y1: centre[1] }, floorY: shoulderY + 0.015 });
  report.hair.earMode = hs.earMode;
  const { P: hairP, I: hairI } = finishHairMesh(hs, report, { H: { S: hs.headSDF.S, ...hs.grid }, earIndex: new TriIndex(X, I, 0.02, (t) => earTriSide[t] !== null), earSide: earTriSide, earMode: hs.earMode });
  const hairN = vertexNormals(hairP, hairI), nh = hairP.length / 3, HC = new Float32Array(nh * 4); for (let i = 0; i < nh; i++) HC.set([hairC[0] / 255, hairC[1] / 255, hairC[2] / 255, 1], i * 4);
  // ---- 4. TEMPORARY APPEARANCE: vector paint rendered from the Stage 0 representation (not the illustration's pixels) ----
  const skin = lab2rgb(p.skinTones[0].lab), toN = (x3, y3) => Cinv([x3, y3]), Fi = r.F.Ti;
  const sampleIn = (poly) => { const pts = []; const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]); for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.01) for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.01) if (inPoly([x, y], poly)) pts.push(Fi([x, y])); return medianCol(pts); };
  const paint = { eyes: ["R", "L"].map((s) => r.eyes[s]).filter(Boolean).map((e) => ({ ...e, open: [...e.upper, ...e.lower.slice().reverse()], irisC: (() => { const pts = []; for (let a = 0; a < 6.28; a += 0.4) for (const rr of [0.3, 0.55]) pts.push(Fi([e.iris[0] + Math.cos(a) * rr * e.irisR, e.iris[1] + Math.sin(a) * rr * e.irisR])); return medianCol(pts); })() })),
    brows: ["R", "L"].map((s) => r.brows[s]).filter(Boolean).map((b) => ({ poly: [...b.top, ...b.bottom.slice().reverse()], col: sampleIn([...b.top, ...b.bottom.slice().reverse()]) })),
    mouth: r.mouth ? { poly: [...r.mouth.upper, ...r.mouth.lower.slice().reverse()], mid: r.mouth.upper.map((q, i) => [q[0], (q[1] + r.mouth.lower[i][1]) / 2]), col: sampleIn([...r.mouth.upper, ...r.mouth.lower.slice().reverse()]) } : null,
    nose: r.nose ? Array.from({ length: 13 }, (_, k) => { const t = k / 12, a = r.nose.wingR, b = [r.nose.base[0], r.nose.base[1] + 0.04], c = r.nose.wingL; return [(1 - t) ** 2 * a[0] + 2 * t * (1 - t) * b[0] + t * t * c[0], (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * b[1] + t * t * c[1]]; }) : null };
  const liner = [34, 26, 24], mix = (a, b, k) => a.map((v, i) => v * (1 - k) + b[i] * k);
  const paintAt = (q) => { let c = skin;
    for (const b of paint.brows) if (inPoly(q, b.poly)) c = b.col;
    if (paint.nose && polyD(q, paint.nose) < 0.018) c = mix(skin, [90, 50, 40], 0.45);
    if (paint.mouth) { if (inPoly(q, paint.mouth.poly)) c = paint.mouth.col; if (polyD(q, paint.mouth.mid) < 0.012) c = mix(c, [60, 30, 30], 0.6); }
    for (const e of paint.eyes) { if (inPoly(q, e.open)) { c = [246, 244, 242]; const di = Math.hypot(q[0] - e.iris[0], q[1] - e.iris[1]); if (di < e.irisR) c = di < 0.45 * e.irisR ? mix(e.irisC, [10, 8, 8], 0.75) : e.irisC;
        if (Math.hypot(q[0] - e.iris[0] - 0.3 * e.irisR, q[1] - e.iris[1] + 0.35 * e.irisR) < 0.17 * e.irisR) c = [255, 255, 255]; }
      if (polyD(q, e.upper) < Math.max(0.012, e.lineW / 2)) c = liner; else if (polyD(q, e.lower) < 0.008) c = mix(skin, liner, 0.35); }
    return c; };
  const cover = new Float32Array(n); for (let i = 0; i < n; i++) { const [th, ph] = dirBin(X[i * 3] - centre[0], X[i * 3 + 1] - centre[1], X[i * 3 + 2] - centre[2]); cover[i] = smooth(0.35, 0.6, sampleMap(maps.Ms, th, ph)); }
  const S = TEX, out = Buffer.alloc(S * S * 3), inside = new Uint8Array(S * S), src = tpl.uv.src, UI = tpl.uv.I, scalp = hairC.map((v) => v * 0.85);
  rasterUV(tpl.uv.UV, UI, S, (g, t, w0, w1, w2) => { const a = src[UI[t * 3]], b = src[UI[t * 3 + 1]], c2 = src[UI[t * 3 + 2]];
    const q3 = [0, 1, 2].map((k) => X[a * 3 + k] * w0 + X[b * 3 + k] * w1 + X[c2 * 3 + k] * w2), nz = N[a * 3 + 2] * w0 + N[b * 3 + 2] * w1 + N[c2 * 3 + 2] * w2, cv = cover[a] * w0 + cover[b] * w1 + cover[c2] * w2;
    inside[g] = 1; let col = skin; if (nz > 0.2 && q3[2] > centre[2] && q3[1] > at(TL.chin)[1] - 0.02) col = paintAt(toN(q3[0], q3[1]));
    for (let k = 0; k < 3; k++) out[g * 3 + k] = Math.max(0, Math.min(255, Math.round(col[k] * (1 - cv) + scalp[k] * cv))); });
  dilateGutter(out, inside, S);
  const webp = await sharp(out, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 92 }).toBuffer();
  // ---- 4b. SCULPTED FEATURES on the canonical HD topology (features.mjs): eyeballs + wrapped lids, nose, lips — generic modules,
  // sizes = locked style constants, shapes/positions = Stage 0 evidence through the person's own 3D↔image map, drives = the basis z-drives
  let XH = X, HT = tpl, eb = null;
  if (HDT && VAR === "V") { const odr = Object.fromEntries(Object.entries(report.volume?.operators ?? {}).map(([k, v]) => [k, v.drive])), XL = lift(X, HDT); let FSR = null; if (IDL) report.layout.stageMaps.afterLift = stageMap(XL, HDT);
    for (const g of [1, 0.75, 0.5]) { const R3 = sculptFeatures(XL, HDT, { toN, eyes: [r.eyes.R, r.eyes.L], mouth: r.mouth, smile, nose: r.nose, od: odr, mouthY3: report.layout.landing?.mouthC?.[1], eyeW_IOD: report.layout.ipm?.target?.["h.eyeW_IOD"]?.v }, g), hid = (Y, i) => R3.balls.some((b) => Math.hypot(Y[i * 3] - b.c[0], Y[i * 3 + 1] - b.c[1], Y[i * 3 + 2] - b.c[2]) < b.r - 1e-4), FF = fadeFolds(HDT, XL, R3.X, { maxIter: 6, hidden: hid, zOnly: R3.zOnly }); if (FF.ok) { FSR = { ...R3, gain: g, foldFade: FF }; break; } }
    if (!FSR) throw new Error(`${who}: feature modules fold at every gain — fail closed`);
    report.features = { gain: FSR.gain, foldFade: FSR.foldFade, style: FEATURE_STYLE, ...FSR.log }; if (DIAG.has("ballpush")) for (const b of FSR.balls) b.c[2] += 0.8 * b.lidU;   /* DIAGNOSTICS ONLY (T7 negative test, diag-* output): eyeballs pushed through the lids */
    XH = FSR.X; HT = HDT; eb = FSR.balls.length ? eyeballMesh(FSR.balls) : null;
    // DIAGNOSTICS ONLY (T7 negative test, diag-* output): sink the lid ring over each ball into it, after every construction safeguard and fold fade
    if (DIAG.has("lidsink")) for (const b of FSR.balls) for (let i = 0; i < HDT.n; i++) { const rho = Math.hypot(XH[i * 3] - b.c[0], XH[i * 3 + 1] - b.c[1]) / b.r; if (rho > 0.6 && rho < 0.92 && XH[i * 3 + 2] > b.c[2]) { const zb = b.c[2] + b.r * Math.sqrt(Math.max(0, 1 - rho * rho)), w = Math.sin(Math.PI * (rho - 0.6) / 0.32); XH[i * 3 + 2] += w * (Math.min(XH[i * 3 + 2], zb - 0.4 * b.lidU) - XH[i * 3 + 2]); } } }
  // HAIR CLEARS THE FINAL HEAD (FC-HAIR-FINAL-CLEARANCE, learned: the temporary hair is built around the base head, then feature fairing moved
  // the head surface by up to ~2 mm → hair verts inside the final head, T4): any hair vertex inside / within 0.5 mm of the FINAL head is pushed
  // out along the head normal to 0.5 mm clearance (a handful of verts, ≤ a few mm; logged)
  { const idx = new TriIndex(XH, HT.I, 0.02), PUSH = new Map(); let moved = 0, maxMv = 0; for (let i = 0; i < hairP.length / 3; i++) { const q = idx.closest(hairP[i * 3], hairP[i * 3 + 1], hairP[i * 3 + 2], 0.01); if (!q) continue;
      const tn = triNormal(XH, HT.I, q.t), sd = (hairP[i * 3] - q.x) * tn[0] + (hairP[i * 3 + 1] - q.y) * tn[1] + (hairP[i * 3 + 2] - q.z) * tn[2]; if (sd >= 0.0005) continue;
      const mv = 0.0005 - sd; PUSH.set(i, [tn[0] * mv, tn[1] * mv, tn[2] * mv]); moved++; maxMv = Math.max(maxMv, mv); }
    // the push is a SMOOTH field over the hair mesh (2 rings, falling off) — single-vertex pushes tipped tiny hair triangles over (V1 back-facing)
    if (PUSH.size) { const hn = Array.from({ length: hairP.length / 3 }, () => []); for (let t = 0; t < hairI.length / 3; t++) for (let k = 0; k < 3; k++) { const a = hairI[t * 3 + k], b = hairI[t * 3 + (k + 1) % 3]; hn[a].push(b); hn[b].push(a); }
      const D = new Map(PUSH); let fr = [...PUSH.keys()]; for (const fall of [0.6, 0.3]) { const nx = []; for (const i of fr) for (const j of hn[i]) { const dj = D.get(i).map((v) => v * fall); const cur = D.get(j); if (!cur || Math.hypot(...cur) < Math.hypot(...dj)) { if (!cur) nx.push(j); D.set(j, dj); } } fr = nx; }
      for (const [i, d] of D) for (let k = 0; k < 3; k++) hairP[i * 3 + k] += d[k]; const HN2 = vertexNormals(hairP, hairI); hairN.set(HN2); }
    report.hairFinalClearance = { moved, maxMove: +maxMv.toFixed(4) }; }
  const NH = vertexNormals(XH, HT.I); if (IDL && HT !== tpl) report.layout.stageMaps.afterFeatures = stageMap(XH, HT);
  // ---- 5. write (same module contract as V3: head + separate hair + neck extension) ----
  const hsrc = HT.uv.src, uvN = hsrc.length, HP = new Float32Array(uvN * 3), HN = new Float32Array(uvN * 3); for (let j = 0; j < uvN; j++) { const i = hsrc[j]; HP.set([XH[i * 3], XH[i * 3 + 1], XH[i * 3 + 2]], j * 3); HN.set([NH[i * 3], NH[i * 3 + 1], NH[i * 3 + 2]], j * 3); }
  const rigid = (m) => { const J = new Uint8Array(m * 4), W = new Float32Array(m * 4); for (let i = 0; i < m; i++) { J[i * 4] = HEAD; W[i * 4] = 1; } return { J, W }; };
  const hr = rigid(uvN), hh = rigid(nh), hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const ear = (S2) => ({ root: at(TL[`ear${S2}root`]), outer: at(TL[`ear${S2}outer`]), top: at(TL[`ear${S2}top`]), lobe: at(TL[`ear${S2}lobe`]), back: at(TL[`ear${S2}back`]), measured: true, canonical: true });
  const eyeHW = paint.eyes.length ? (paint.eyes.reduce((a, e) => a + Math.abs(e.outer[0] - e.inner[0]), 0) / paint.eyes.length / 2) * sPerPx * r.F.u : 0.07;
  const L = { eyes: { l: at(TL.eyeL), r: at(TL.eyeR), halfW: eyeHW, halfH: eyeHW * 0.4, ...(report.features?.eyes ? { balls: report.features.eyes } : {}) }, mouth: { c: at(TL.mouth), halfW: r.mouth ? Math.abs(r.mouth.cL[0] - r.mouth.cR[0]) / 2 * sPerPx * r.F.u : 0.08 }, bridge: at(TL.noseTip), forward: [0, at(TL.eyeL)[1], 2], skin: hex(skin), iris: hex(paint.eyes[0]?.irisC ?? [31, 23, 20]),
    attach: { v: 1, centre, ears: { l: ear("L"), r: ear("R") }, nose: { tip: at(TL.noseTip) }, crown: at(TL.crown), forehead: at(TL.forehead) } };
  const meshes = [
    { name: "identity_head", P: HP, N: HN, I: Array.from(HT.uv.I), UV: HT.uv.UV, J: hr.J, W: hr.W, extraAttrs: { _PAINT: { type: "VEC4", array: new Float32Array(uvN * 4) } }, material: { name: "identity_skin_TEMP_stage0_vector_paint", texture: webp, roughness: 0.9 } },
    { name: "identity_hair_main", P: hairP, N: hairN, I: Array.from(hairI), J: hh.J, W: hh.W, extraAttrs: { _PAINT: { type: "VEC4", array: HC }, _FLOW: { type: "VEC3", array: new Float32Array(nh * 3) }, _CLUMP: { type: "SCALAR", array: new Float32Array(nh) } }, material: { name: "identity_hair_TEMP_flat", roughness: 0.9 } },
    neckExtension(),
    ...(eb ? [{ name: "face_eyes", P: eb.P, N: eb.N, I: eb.I, J: rigid(eb.P.length / 3).J, W: rigid(eb.P.length / 3).W, extraAttrs: { _PAINT: { type: "VEC4", array: new Float32Array(eb.P.length / 3 * 4).fill(1) } }, material: { name: "face_eyes_TEMP_neutral_ball", roughness: 0.5 } }] : []),
  ];
  const ENVD = Object.keys(process.env).filter((k) => k.startsWith("HB_DIAG_")).map((k) => k.slice(8).toLowerCase()), dir = `${OUT}/${who}/${VAR}/${DIAG.size || process.env.HB_FEAT_STOP || ENVD.length ? "diag-" + [...DIAG, ...ENVD, ...(process.env.HB_FEAT_STOP ? ["stop_" + process.env.HB_FEAT_STOP] : [])].sort().join("-") : "pass1"}`   /* a diagnostic stage stop never overwrites pass1 */, file = `${dir}/${who}-v1.glb`; fs.mkdirSync(dir, { recursive: true });
  await writeModule(file, base, meshes, { humanIdentity: { id: `${who}-stage1`, base: "human-base-v1", source: `${S0DIR}/identity.json#${who}`, v3: { template: tpl.id, variant: VAR, pipeline: "humanbase-stage1-proof-1", temporaryAppearance: ["head paint = Stage 0 vector paint", "hair = flat colour"] }, landmarks: L, hides: [], hairFused: false, hairMotion: "short" } }, { compress: false });
  const bytes = fs.readFileSync(file); report.artifactHash = crypto.createHash("sha256").update(bytes).digest("hex"); report.bytes = bytes.length; report.counts = { headTris: HT.uv.I.length / 3, hairTris: hairI.length / 3, eyeTris: eb ? eb.I.length / 3 : 0 };
  report.timings = { total: Date.now() - t0 };
  fs.writeFileSync(`${dir}/qa-geometry.json`, JSON.stringify({ X: Array.from(XH), template: HT === tpl ? "base" : "hd", hairP: Array.from(hairP), hairI: Array.from(hairI), centre, T: Array.from(maps.T), Ms: Array.from(maps.Ms), earMode: hs.earMode }));
  fs.writeFileSync(`${dir}/build.json`, JSON.stringify(report, null, 1));
  console.log(`${who} ${VAR}: ${file} ${(bytes.length / 1e6).toFixed(2)} MB · fit ${JSON.stringify(report.fit)} · hair ${report.hair.earMode ? JSON.stringify(report.hair.earMode) : ""} · ${report.timings.total} ms`);
  return { report, X };
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`trio: ${WHO.join(", ")} · population ${M.n} · style-map fit max err ${styleFit.toExponential(2)} · arc ${ARC.length} pts (${ARC_CTRL.length} controls)`);
  for (const w of WHO) await buildS(w);
}
