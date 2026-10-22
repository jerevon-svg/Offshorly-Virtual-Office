// v3/stage1/features.mjs — SCULPTED FEATURE MODULES on the canonical HD topology. ONE generic mechanism for every employee:
//   0. POLISH   volume-preserving (Taubin) relaxation of the lifted HD face — subdivision-surface smoothness, no shrink
//   1. EYES     a real EYEBALL sphere per eye; the head's lids WRAP it: aperture = the Stage 0 eye aperture (upper/lower lid
//               curves + corners, mapped through the person's own 3D↔image map), lid shells at ball radius + lid thickness,
//               rounded lid margin, upper-lid crease, aperture floor tucked under the ball; ball centre solved so the lid
//               shells sit on the identity head's own socket surface (identity depth preserved)
//   2. NOSE     SDF primitives unioned along vertex normals: tip ball, alar wings at the Stage 0 wing points, nostril dimples
//   3. LIPS     upper/lower lip volumes swept along the Stage 0 lip curves (height from the Stage 0 lip borders), closed-mouth
//               seam groove + corner pits
// Every size is a STYLE constant (locked, relative to the face's own eye width / inter-eye distance) modulated by the same
// Stage 0 z-score drives as the sculpture basis. No names, no per-person values.
import { vertexNormals } from "../geom.mjs";
import { faceOutlineX, mentonY, FRONT_MARGIN_IOD, subnasale } from "./proportions.mjs";

const NSTYLE_UNDER = { iters: 500, alpha: 0.12, frontNz: 0.2, ring0: 3, ring1: 6 };   // under-jaw thin-plate fairing (step < 1/8 keeps the uniform bi-Laplacian flow stable)
export const STYLE = {
  // eye sizes × the eye half-width hw; hw itself = the APPROVED envelope (mean eye half-width / IOD of the five approved heads
  // = 0.257, range 0.23–0.30) × the Stage 0 eye-width drive — the Stage 0 aperture SHAPE (lid curves, corners, tilt) is kept
  eye: { hwRange: [0.23, 0.30], ballR: 1.08, ballProj: 0.07, lidU: 0.09, lidL: 0.055, roll: 0.07, inset: 0.06, floorDrop: 0.2, bandU: 0.55, bandL: 0.36, creaseD: 0.3, creaseDepth: 0.028, creaseW: 0.055, underBulge: 0.02, fitBand: 0.15, bead: 0.03, beadW: 0.6, clear: 0.35, marginEps: 0.002, rollK: 1.3, rollMin: 0.09, rollMax: 0.32 },
  nose: { tipR: 0.088, tipProj: 0.006, alaR: 0.064, alaIn: 0.5, alaOut: 0.45, nostrilR: 0.034, k: 0.008, baseCrease: 0.03, alaShape: [0.75, 0.62, 1.0], sillOut: 0.12, alaBlend: 0.45, faceBlend: 0.35, wallR: 0.55, grooveDepth: 0.06, grooveW: 0.16, baseSpan: 1.05, baseShape: [1, 0.7, 0.95], baseOut: 0.42, baseLift: 0.1, oneBlend: 0.6, oneFace: 0.5, seatIters: 50, columella: 0.42, nostrilShape: [0.75, 0.6, 1.3], nostrilDepth: 0.45 },                                                                       // × IOD
  chin: { padR: 0.17, padOut: 0.28, k: 0.06 },
  smile: { upper: 0.16, lower: 0.22, reach: 1.25, cornerPow: 0.55, relax: 5, seamW: 0.012, seamDepth: 0.014, seamEnd: 0.45, cornerExt: 0.04 },   // lip-form amplitude × traced lip height; seam × IOD
  lips: { upperR: 0.48, lowerR: 0.56, upperOut: 0.26, lowerOut: 0.32, seamR: 0.009, seamK: 0.004, cornerR: 0.011, k: 0.02, cornerTaper: 0.2 },                                                  // × lip height / × IOD
};
const sm = (t, a, b) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const ss5 = (t2) => { const u = Math.min(1, Math.max(0, t2)); return u * u * u * (u * (6 * u - 15) + 10); };   // smootherstep (C2)
const clamp = (v, a = -2, b = 2) => Math.max(a, Math.min(b, v ?? 0));
const seg2 = (q, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l)); return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy); };
const plD = (q, pl, closed) => { let d = Infinity; for (let i = 0; i + 1 < pl.length; i++) d = Math.min(d, seg2(q, pl[i], pl[i + 1])); if (closed) d = Math.min(d, seg2(q, pl[pl.length - 1], pl[0])); return d; };
const inPoly = (q, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = (a) => Math.hypot(a[0], a[1], a[2]), nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
/** C1 floor (FC-CLAMP-CREASE, learned in surface QA: hard max() clamps left a crease where they start acting): ≥ max(a, b), smooth over k */
const softMax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
// primitive SDFs
const sdSphere = (p, c, r) => len(sub(p, c)) - r;
const sdEll = (p, c, R) => { const q = sub(p, c), k0 = Math.hypot(q[0] / R[0], q[1] / R[1], q[2] / R[2]), k1 = Math.hypot(q[0] / R[0] ** 2, q[1] / R[1] ** 2, q[2] / R[2] ** 2); return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...R); };
const sdRoundCone = (p, a, b, ra, rb) => { const ab = sub(b, a), l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)); return len(sub(p, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]])) - (ra + t * (rb - ra)); };
const primD = (p, pr) => (pr.t === "s" ? sdSphere(p, pr.c, pr.r) : pr.t === "e" ? sdEll(p, pr.c, pr.R) : sdRoundCone(p, pr.a, pr.b, pr.ra, pr.rb));
const primsD = (p, prims, kInt = 0) => { let d = Infinity; for (const pr of prims) { const e = primD(p, pr); d = kInt > 0 && d < Infinity ? smin(d, e, kInt) : Math.min(d, e); } return d; };   // kInt: smooth union BETWEEN primitives

/** move verts along their normals onto smooth-union(head, prims) (add) or smooth-subtract (carve) — SDF sculpting */
function sdfAlongNormals(Y, N, verts, prims, k, mode, gain, nb, tmax = 0.05, relax = 3, depthOnly = false, declare = null) {
  const dt = 0.0005; let moved = 0, maxT = 0; const Tm = new Map();
  // DEPTH-ONLY = a front-plane HEIGHT FIELD (FC-DEPTH-SHEAR, learned: pushing z by t·n_z with t solved along the normal sheared the
  // down/back-facing under-chin into a jagged ridge): the ray runs along +z, and the form fades out on oblique/back-facing surface
  for (const i of verts) { const x = [Y[i * 3], Y[i * 3 + 1], Y[i * 3 + 2]], wD = depthOnly ? sm(N[i * 3 + 2], 0.25, 0.6) : 1; if (!wD) continue;
    const n = depthOnly ? [0, 0, 1] : [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], at = (t) => [x[0] + t * n[0], x[1] + t * n[1], x[2] + t * n[2]];
    let t = 0;
    if (mode === "add") { const f = (s) => smin(s, primsD(at(s), prims, prims.kInt ?? 0), k); if (f(0) >= 0) continue; let lo = 0, hi = dt; while (hi < tmax && f(hi) < 0) { lo = hi; hi += dt; } if (hi >= tmax) continue; for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; } t = (lo + hi) / 2; }
    else { const f = (s) => smax(s, -primsD(at(s), prims), k); if (f(0) <= 0) continue; let lo = 0, hi = -dt; while (hi > -tmax && f(hi) > 0) { lo = hi; hi -= dt; } if (hi <= -tmax) continue; for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; } t = (lo + hi) / 2; }
    if (t) Tm.set(i, t * wD); }
  // FC-SDF-SPIKE (learned): independent per-vertex ray solutions cross in concave creases (alar groove) and spike in carves —
  // the displacement FIELD is relaxed over the surface before it is applied (forms kept, crossings removed)
  let S = new Map(Tm); for (const i of Tm.keys()) for (const j of nb[i]) if (!S.has(j)) S.set(j, 0);
  for (let it = 0; it < relax; it++) { const T2 = new Map(); for (const [i, v] of S) { let a = 0, c = 0; for (const j of nb[i]) { a += S.get(j) ?? 0; c++; } T2.set(i, 0.5 * v + 0.5 * (c ? a / c : 0)); } S = T2; }
  if (declare) { let mx = 0; for (const v of S.values()) mx = Math.max(mx, Math.abs(v)); for (const [i, v] of S) if (Math.abs(v) > 0.05 * mx) declare.add(i); }   // the carve's groove band is a designed crease; a form LEAKING out of its region is caught by the footprint check (FC-MODULE-FOOTPRINT)
  for (const [i, t0] of S) { const t = t0 * gain; if (!t) continue; if (depthOnly) Y[i * 3 + 2] += t; else for (let q = 0; q < 3; q++) Y[i * 3 + q] += t * N[i * 3 + q]; moved++; maxT = Math.max(maxT, Math.abs(t)); }
  return { moved, maxT: +maxT.toFixed(4) };
}
/** HEIGHT-FIELD FORM (shared): Δz_i = fn(i) over verts, the field RELAXED over the surface before it is applied — a smooth form, never a
 *  per-vertex product with noisy normals (FC-FORM-SPECKLE, learned: a 1.5 cm bump × a per-vertex facing weight turned normal noise into
 *  chin speckle). Depth only: the front-view layout is the proportion solve's. */
function heightForm(Y, verts, fn, nb, relax = 6) { let S = new Map(); for (const i of verts) { const t = fn(i); if (t) S.set(i, t); } for (const i of [...S.keys()]) for (const j of nb[i]) if (!S.has(j)) S.set(j, 0);
  for (let it = 0; it < relax; it++) { const T2 = new Map(); for (const [i, v] of S) { let a = 0, c = 0; for (const j of nb[i]) { a += S.get(j) ?? 0; c++; } T2.set(i, 0.5 * v + 0.5 * (c ? a / c : 0)); } S = T2; }
  let moved = 0, maxT = 0; for (const [i, t] of S) { if (!t) continue; Y[i * 3 + 2] += t; moved++; maxT = Math.max(maxT, Math.abs(t)); } return { moved, maxT: +maxT.toFixed(4) }; }
/** NORMAL-DIRECTION FORM (shared): Δ_i = fn(i) along the vertex normal, the field relaxed over the surface first (like heightForm, for forms on
 *  surfaces that do not face the camera — the nose underside) */
function normalForm(Y, N, verts, fn, nb, relax = 4) { let S = new Map(); for (const i of verts) { const t = fn(i); if (t) S.set(i, t); } for (const i of [...S.keys()]) for (const j of nb[i]) if (!S.has(j)) S.set(j, 0);
  for (let it = 0; it < relax; it++) { const T2 = new Map(); for (const [i, v] of S) { let a = 0, c = 0; for (const j of nb[i]) { a += S.get(j) ?? 0; c++; } T2.set(i, 0.5 * v + 0.5 * (c ? a / c : 0)); } S = T2; }
  let moved = 0, maxT = 0; for (const [i, t] of S) { if (!t) continue; for (let q = 0; q < 3; q++) Y[i * 3 + q] += t * N[i * 3 + q]; moved++; maxT = Math.max(maxT, Math.abs(t)); } return { moved, maxT: +maxT.toFixed(4) }; }
/** person-space point → 3D surface point: inverse-distance blend of the 4 front verts whose person coords are nearest */
function to3D(q, F, Q, Y) { const best = []; for (const i of F) { const d = (Q[i * 2] - q[0]) ** 2 + (Q[i * 2 + 1] - q[1]) ** 2; if (best.length < 4 || d < best[3][0]) { best.push([d, i]); best.sort((a, b) => a[0] - b[0]); if (best.length > 4) best.pop(); } }
  let w = 0; const p = [0, 0, 0]; for (const [d, i] of best) { const ww = 1 / (Math.sqrt(d) + 1e-4); w += ww; for (let k = 0; k < 3; k++) p[k] += ww * Y[i * 3 + k]; } return { p: p.map((v) => v / w), i: best[0][1] }; }
const nearN = (N, i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];

export function sculptFeatures(X, hd, ctx, gain = 1) {
  const R = hd.REGION, n = hd.n, Y = Float32Array.from(X), log = {}, TL = hd.landmarks, FACE = new Set([R.face, R.eyeL, R.eyeR, R.nose, R.mouth, R.jaw]);
  const at = (i) => [Y[i * 3], Y[i * 3 + 1], Y[i * 3 + 2]], IOD = Math.abs(at(TL.eyeR)[0] - at(TL.eyeL)[0]);
  // the clean-up's reference gets the SAME polish (FC-CLEANUP-NOISE-TRANSPLANT, learned: Y = T0 + lowpass(Y − T0) re-adds the raw
  // template's fine noise on top of the polished surface → lower-face mottling)
  const T0s = Float32Array.from(hd.P);
  // ---- 0. POLISH: Taubin λ|μ over the face (refined region), weights ramp to 0 at the refined-region border ----
  { const ring = new Int16Array(n).fill(-1); let fr = []; for (let i = 0; i < n; i++) if (!FACE.has(hd.region[i])) { ring[i] = 0; fr.push(i); }
    for (let k = 1; k <= 4; k++) { const nx = []; for (const i of fr) for (const j of hd.nb[i]) if (ring[j] < 0) { ring[j] = k; nx.push(j); } fr = nx; }
    const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = ring[i] < 0 ? 1 : ring[i] / 4;
    const L2 = new Set([R.eyeL, R.eyeR, R.nose, R.mouth]), taubin = (iters, sel, A = Y) => { for (let it = 0; it < iters; it++) for (const lam of [0.5, -0.53]) { const T = A.slice(); for (const i of sel) { const nb = hd.nb[i]; for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb) a += T[j * 3 + q]; A[i * 3 + q] = T[i * 3 + q] + w[i] * lam * (a / nb.length - T[i * 3 + q]); } } } };
    const all = []; for (let i = 0; i < n; i++) if (w[i]) all.push(i); taubin(64, all); taubin(64, all, T0s);
    // dense (level-2) regions have half the edge length: 3× more iterations there reach the same physical smoothing scale
    const w2 = new Float32Array(n); { const rr = new Int16Array(n).fill(-1); let f2 = []; for (let i = 0; i < n; i++) if (!L2.has(hd.region[i])) { rr[i] = 0; f2.push(i); } for (let k = 1; k <= 6; k++) { const nx = []; for (const i of f2) for (const j of hd.nb[i]) if (rr[j] < 0) { rr[j] = k; nx.push(j); } f2 = nx; } for (let i = 0; i < n; i++) w2[i] = rr[i] < 0 ? 1 : rr[i] / 6; }
    const dense = []; for (let i = 0; i < n; i++) if (w2[i] > 0) { dense.push(i); w[i] = Math.min(w[i], w2[i]); } taubin(160, dense); taubin(160, dense, T0s); }
  if ((process.env.HB_FEAT_STOP ?? "") === "taubin") return { X: Y, balls: [], log: { stop: "taubin" } };   // diagnostics only
  // ---- 0b. LOWER-FACE CLEAN-UP (FC-FIT-NOISE-LOWERFACE, learned): the approved fits' mean carries 2–4 cm lumps over the cheeks,
  // nasolabial area, upper lip, chin and under-jaw (open shells / trims in the approved heads). The DISPLACEMENT from the smooth
  // canonical head is low-passed there (≈4 cm scale): broad identity forms (cheek, jaw, muzzle, nose projection) survive, lumps go.
  // The nose ridge and the eyes are excluded; the feature modules then rebuild nose/lip/chin anatomy on top.
  // the clean-up reference is smoothed at FULL strength over its whole region (FC-CLEANUP-BORDER-NOISE, learned: the polish's border ramp left
  // raw template noise in a band along the jaw, which the clean-up transplanted as a speckled jawline)
  { const LFr = new Set([R.face, R.nose, R.mouth, R.jaw, R.under, R.eyeL, R.eyeR]), selR = []; for (let i = 0; i < n; i++) if (LFr.has(hd.region[i])) selR.push(i);
    for (let it = 0; it < 64; it++) for (const lam of [0.5, -0.53]) { const T = T0s.slice(); for (const i of selR) { const nb2 = hd.nb[i]; for (let q = 0; q < 3; q++) { let a2 = 0; for (const j of nb2) a2 += T[j * 3 + q]; T0s[i * 3 + q] = T[i * 3 + q] + lam * (a2 / nb2.length - T[i * 3 + q]); } } } }
  { const T0 = T0s, eY = (at(TL.eyeL)[1] + at(TL.eyeR)[1]) / 2, chinY = at(TL.chin)[1], LF = new Set([R.face, R.nose, R.mouth, R.jaw, R.under, R.eyeL, R.eyeR]), sw = new Float32Array(n), D = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { D[i * 3] = Y[i * 3] - T0[i * 3]; D[i * 3 + 1] = Y[i * 3 + 1] - T0[i * 3 + 1]; D[i * 3 + 2] = Y[i * 3 + 2] - T0[i * 3 + 2]; if (!LF.has(hd.region[i])) continue;
      const x = Y[i * 3], y = Y[i * 3 + 1], z = Y[i * 3 + 2], u = Math.abs(x) / IOD, v = (y - eY) / IOD; if (z < -0.05) continue;
      const below = sm(-v, 0.28, 0.5), ridge = (1 - sm(u, 0.1, 0.22)) * sm(v, -0.62, -0.5), neck = sm(y, chinY - 0.07, chinY - 0.03); sw[i] = below * (1 - ridge) * neck; }
    // depth component only: the front-view layout/outline is owned by the proportion solve
    for (let it = 0; it < 300; it++) { const T = D.slice(); for (let i = 0; i < n; i++) { if (!sw[i]) continue; const nb = hd.nb[i]; for (let q = 2; q < 3; q++) { let a = 0; for (const j of nb) a += T[j * 3 + q]; D[i * 3 + q] = T[i * 3 + q] + 0.5 * sw[i] * (a / nb.length - T[i * 3 + q]); } } }
    for (let i = 0; i < n * 3; i++) Y[i] = T0[i] + D[i]; }
  if ((process.env.HB_FEAT_STOP ?? "") === "cleanup") return { X: Y, balls: [], log: { stop: "cleanup" } };   // diagnostics only
  // ---- 0c. SEAM FAIRING (FC-LOWANGLE-SEAM / FC-EAR-SEAM, learned in surface QA): the under-jaw, the jaw, the refined-region border and the
  // rings around each ear (2–6; ring 1 is the anatomical ear-root groove) are outside/at the edge of the face polish, so the base's
  // approved-face↔canonical junction kept creases a low camera sees. Volume-preserving Taubin there, ramped at its own border.
  { const yMQ = ctx.mouthY3 ?? at(TL.mouth)[1];   // QA's mouth height (landing) — the chin relations are levels between mouth and menton
    const ringOf = (seed) => { const r = new Int16Array(n).fill(-1); let fr = []; for (let i = 0; i < n; i++) if (seed(i)) { r[i] = 0; fr.push(i); } for (let k = 1; k <= 8; k++) { const nx = []; for (const i of fr) for (const j of hd.nb[i]) if (r[j] < 0) { r[j] = k; nx.push(j); } fr = nx; } return r; };
    const earR = ringOf((i) => hd.region[i] === R.earL || hd.region[i] === R.earR), faceB = ringOf((i) => !FACE.has(hd.region[i])), NOF = new Set([R.eyeL, R.eyeR, R.nose, R.mouth]);
    const inS = (i) => !NOF.has(hd.region[i]) && (earR[i] < 0 || earR[i] >= 2) && (hd.region[i] === R.under || hd.region[i] === R.jaw || (faceB[i] >= 0 && faceB[i] <= 6 && Y[i * 3 + 1] < at(TL.eyeL)[1]) || (earR[i] >= 2 && earR[i] <= 8));
    const out = ringOf((i) => !inS(i)), ws = new Float32Array(n), sel = []; for (let i = 0; i < n; i++) if (inS(i)) { const t2 = Math.min(1, (out[i] < 0 ? 8 : out[i]) / 3); ws[i] = t2 * t2 * (3 - 2 * t2); if (ws[i] > 0) sel.push(i); }   /* ring 1 (ear-root groove) not faired: tested at 0.35 weight, it pushed the groove through the hair shell (T4) */
    // OUTLINE-PRESERVING FAIRING (FC-FAIRING-OUTLINE-DRIFT, learned: a full 3D fairing rounded the chin tip out of its measured shape; locking x
    // on the outline band kept that band's faceting as a speckled jawline): fair fully, then restore the MEASURED front outline below the
    // eye line with a smooth per-height lateral rescale (u² ramp, the outline solve's own form) — a 1–3% correction that cannot re-facet
    const yCh = mentonY(Y, n, yMQ);   // the shared menton definition
    const yE = at(TL.eyeL)[1], STEP = 0.002, levels = []; for (let y = yE; y > yCh + 0.001; y -= STEP) levels.push(y); const yCh0 = yCh;
    const preMenton = mentonY(Y, n, yMQ), preW = (y) => { const q = faceOutlineX(Y, n, hd.region, R.earL, R.earR, hd.centre[2], IOD, y, 0.004, hd.I); return q[1] - q[0]; }, preCl = yMQ + 0.8 * (preMenton - yMQ), pre75 = +(preW(preCl + 0.75 * (preMenton - preCl)) / preW(preCl)).toFixed(3);
    const wOf = () => levels.map((y) => { const w = faceOutlineX(Y, n, hd.region, R.earL, R.earR, hd.centre[2], IOD, y, 0.004, hd.I); return Number.isFinite(w[1] - w[0]) ? w : null; }), W0 = wOf();
    for (let it = 0; it < 40; it++) for (const lam of [0.5, -0.53]) { const T = Y.slice(); for (const i of sel) { const nb2 = hd.nb[i]; for (let q = 0; q < 3; q++) { let a2 = 0; for (const j of nb2) a2 += T[j * 3 + q]; Y[i * 3 + q] = T[i * 3 + q] + ws[i] * lam * (a2 / nb2.length - T[i * 3 + q]); } } }
    // CREASE RELAXER (FC-BASE-JAW-RIDGE, learned in surface QA: the base's approved-face↔canonical-under junction keeps a 50–70° jaw-edge ridge that a
    // uniform fairing only softens): find remaining skin creases (> 25°) in the seam set, fair their 2-ring neighbourhood, repeat
    const creaseRelax = (q0, rmax, rings = 2, hold = null) => { const tnr = (t) => { const a = hd.I[t * 3], b = hd.I[t * 3 + 1], c = hd.I[t * 3 + 2], u2 = [0, 1, 2].map((q) => Y[b * 3 + q] - Y[a * 3 + q]), v2 = [0, 1, 2].map((q) => Y[c * 3 + q] - Y[a * 3 + q]), w2 = [u2[1] * v2[2] - u2[2] * v2[1], u2[2] * v2[0] - u2[0] * v2[2], u2[0] * v2[1] - u2[1] * v2[0]], l = Math.hypot(...w2) || 1; return w2.map((q) => q / l); };
      const inSel = new Uint8Array(n); for (const i of sel) inSel[i] = 1; const eT = new Map(); for (let t = 0; t < hd.I.length / 3; t++) { const a = hd.I[t * 3], b = hd.I[t * 3 + 1], c = hd.I[t * 3 + 2]; if (!inSel[a] || !inSel[b] || !inSel[c]) continue; for (const [p2, q2] of [[a, b], [b, c], [c, a]]) { const key = p2 < q2 ? p2 * n + q2 : q2 * n + p2; (eT.get(key) ?? eT.set(key, []).get(key)).push(t); } }
      let rounds = 0, last = 0; for (let r = 0; r < rmax; r++) { const hot = new Set(); for (const [key, ts] of eT) { if (ts.length !== 2) continue; const n1 = tnr(ts[0]), n2 = tnr(ts[1]); if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < Math.cos((25 * Math.PI) / 180)) { hot.add(Math.floor(key / n)); hot.add(key % n); } }
        last = hot.size; if (!hot.size) break; let fr = [...hot]; for (let k = 0; k < rings; k++) { const nx = []; for (const i of fr) for (const j of hd.nb[i]) if (inSel[j] && !hot.has(j)) { hot.add(j); nx.push(j); } fr = nx; } const hl = [...hot];
        for (let it = 0; it < 10; it++) for (const lam of [0.5, -0.53]) { const T = Y.slice(); for (const i of hl) { const nb2 = hd.nb[i]; const hw2 = hold ? 1 - hold[i] : 1; for (let q = q0; q < 3; q++) { let a2 = 0; for (const j of nb2) a2 += T[j * 3 + q]; Y[i * 3 + q] = T[i * 3 + q] + hw2 * ws[i] * lam * (a2 / nb2.length - T[i * 3 + q]); } } } rounds++; }   /* full hold: an x-only hold rounded the silhouette vertically and moved the chin-tip relation (tested, reverted) */
      return { rounds, lastHotVerts: last }; };
    log.creaseRelax = creaseRelax(0, 6);
    // MINIMAL INTERVENTION (FC-RESTORE-RESHARPEN, learned: restoring the exact pre-fairing outline re-imposed the jaw ridge the fairing removed):
    // only the drift beyond a 2% deadband is corrected. MENTON first (the chin's vertical extent is identity: mouth→chin), then the outline, iterated on a 2 mm grid — fine (3 mm σ) at the chin tip
    // (~2.5 cm tall), face-scale (1.2 cm) above the mouth, each level clamped ±3% (a fine σ everywhere chased single-level outline jumps → creases)
    { const yC1 = mentonY(Y, n, yMQ), dY = yCh0 - yC1, yM0 = yMQ;
      if (Number.isFinite(dY) && dY) for (const i of sel) { const y = Y[i * 3 + 1]; if (y < yM0) Y[i * 3 + 1] += dY * ss5((yM0 - y) / Math.max(1e-4, yM0 - yC1)); } }
    const rel75 = () => { const mY = yMQ, cY = mentonY(Y, n, mY), yCl = mY + 0.8 * (cY - mY), w = (y) => { const q = faceOutlineX(Y, n, hd.region, R.earL, R.earR, hd.centre[2], IOD, y, 0.004, hd.I); return q[1] - q[0]; }, y75 = yCl + 0.75 * (cY - yCl); let cnt = 0; for (const i of sel) if (Math.abs(Y[i * 3 + 1] - y75) < 0.004) cnt++; return { r75: +(w(y75) / w(yCl)).toFixed(3), menton: +cY.toFixed(4), selAt75: cnt }; };
    const dbg = { beforeFairing: { r75: pre75, menton: +preMenton.toFixed(4) }, afterFairing: rel75() };
    let mx = 0, devMax = 0; for (let pass = 0; pass < (process.env.HB_DIAG_NO_RESTORE ? 0 : 3); pass++) { const W1 = wOf(), yMo = yMQ, cl = (y) => (y < yMo ? 0.1 : 0.03), wAbs = (W, y) => { const f = (yE - y) / STEP, k = Math.max(0, Math.min(levels.length - 2, Math.floor(f))), t2 = Math.min(1, Math.max(0, f - k)), a2 = W[k], b2 = W[k + 1]; if (!a2 || !b2) return NaN; return (a2[1] - a2[0]) * (1 - t2) + (b2[1] - b2[0]) * t2; },
        mentonNow = mentonY(Y, n, yMo), yCl0 = yMo + 0.8 * (yCh0 - yMo), yCl1 = yMo + 0.8 * (mentonNow - yMo),
        // CHIN TIP by RELATION (FC-CHIN-TIP-RELATION, learned: absolute-height restoration could not hold the 75% chin relation once fairing moved the tip):
        // below the chin-width level, a level at fraction f toward the menton targets (pre-fairing width ratio at f) × the current chin width
        target = (y) => { if (y >= yCl1) return null; const f = Math.min(1, (yCl1 - y) / Math.max(1e-4, yCl1 - mentonNow)), r0 = wAbs(W0, yCl0 - f * (yCl0 - yCh0)) / wAbs(W0, yCl0), c1 = wAbs(W0, yCl0); return Number.isFinite(r0 * c1) ? r0 * c1 : null; },   /* reference = the chin width this pass restores TOWARD (W0), not the faired width — the chin-width level is restored in the same pass (FC-RESTORE-RATIO-REFERENCE) */
        sc = levels.map((y, k) => { if (!W0[k] || !W1[k]) return 1; const tg = target(y), dv = (tg ?? (W0[k][1] - W0[k][0])) / (W1[k][1] - W1[k][0]) - 1, ex = Math.sign(dv) * Math.max(0, Math.abs(dv) - (tg != null ? 0.01 : 0.02)); return 1 + Math.min(cl(y), Math.max(-cl(y), ex)); }),   /* chin-tip relation levels: 1% deadband (an exact restore re-sharpened the chin underside) */ sgAt = (y) => 0.003 + 0.009 * sm(y, yMo - 0.01, yMo + 0.02), md = levels.map((y, k) => (W1[k] ? (W1[k][0] + W1[k][1]) / 2 : 0));
      const sS = levels.map((y) => { const sg = sgAt(y); let a2 = 0, w2 = 0; levels.forEach((y2, k) => { if (Math.abs(y2 - y) > 4 * sg) return; const ww = Math.exp(-0.5 * ((y2 - y) / sg) ** 2); a2 += ww * sc[k]; w2 += ww; }); return a2 / w2; }), hw = levels.map((y, k) => (W1[k] ? (W1[k][1] - W1[k][0]) / 2 : 1));
      const lerpL = (arr, y) => { const f = (yE - y) / STEP, k = Math.max(0, Math.min(levels.length - 2, Math.floor(f))), t2 = Math.min(1, Math.max(0, f - k)); return arr[k] * (1 - t2) + arr[k + 1] * t2; };
      devMax = Math.max(devMax, ...sS.map((v) => Math.abs(v - 1)));
      // DEPTH WINDOW below the mouth (FC-UNDERJAW-SHEAR, same rule as the outline solve): a chin-tip level corrects surface at/in front of its own
      // outline depth; the under-jaw rising behind the chin through those heights follows passively
      const zO = levels.map((y, k) => { if (!W1[k] || y > yMo) return -Infinity; const pts = []; for (const i of sel) { if (Math.abs(Y[i * 3 + 1] - y) > 0.004) continue; pts.push([Math.abs(Y[i * 3] - md[k]), Y[i * 3 + 2]]); } pts.sort((a2, b2) => b2[0] - a2[0]); const t6 = pts.slice(0, 6); return t6.length ? t6.reduce((a2, q) => a2 + q[1], 0) / t6.length : -Infinity; });
      const zOs = zO.map((v, k) => { const q = [zO[k - 1], v, zO[k + 1]].filter(Number.isFinite); return q.length ? q.reduce((a2, b2) => a2 + b2, 0) / q.length : v; });
      for (const i of sel) { const y = Y[i * 3 + 1]; if (y > yE || y < yCh0 - 0.002 || hd.region[i] === R.earL || hd.region[i] === R.earR) continue; const s2 = lerpL(sS, y), m2 = lerpL(md, y), h2 = lerpL(hw, y), dx = Y[i * 3] - m2, u = Math.abs(dx) / Math.max(1e-4, h2);
        const zw = y < yMo ? (Number.isFinite(lerpL(zOs, y)) ? 1 - sm(yMo - y, 0, 0.01) * (1 - sm(Y[i * 3 + 2], lerpL(zOs, y) - 0.9 * IOD, lerpL(zOs, y) - 0.1 * IOD)) : 1) : 1;
        const dd = Math.sign(dx) * (s2 - 1) * h2 * (u <= 1 ? u * u : 2 * u - 1) * zw * sm(Y[i * 3 + 2], hd.centre[2] - 0.17, hd.centre[2] - 0.11); Y[i * 3] += dd; mx = Math.max(mx, Math.abs(dd)); } }
    {
      log.seamFairingOutlineRestore = { maxShift: +mx.toFixed(5), maxScaleDev: +devMax.toFixed(4), chinTip: { ...dbg, afterRestore: rel75() } }; }
    // EDGE ROUNDING FROM BEHIND (FC-CHIN-EDGE-RESHARPEN, learned: the restore re-imposes the chin-bottom outline, and with it the base's chin↔under
    // junction ridge; y/z-only rounding could not reach creases along the chin's sides)
    // the SILHOUETTE band holds (smoothly) and the surface behind it comes up to meet it — a silhouette edge is rounded from behind, so the
    // front-view outline the restore set does not move (y/z-only rounding could not reach creases running along the chin's sides)
    { const HB2 = new Map(), bn = (y) => Math.round(y / 0.002); for (let i = 0; i < n; i++) if (hd.region[i] !== R.earL && hd.region[i] !== R.earR && Y[i * 3 + 2] > hd.centre[2] - FRONT_MARGIN_IOD * IOD) { const k = bn(Y[i * 3 + 1]); HB2.set(k, Math.max(HB2.get(k) ?? 0, Math.abs(Y[i * 3]))); }
      const hold = new Float32Array(n); for (const i of sel) if (Y[i * 3 + 1] < yMQ) hold[i] = sm(Math.abs(Y[i * 3]) / (HB2.get(bn(Y[i * 3 + 1])) ?? Infinity), 0.88, 0.99);
      log.creaseRelaxDepth = creaseRelax(0, 16, 6, hold); }
    log.seamFairing = { verts: sel.length }; }
  // ---- 0d. UNDER-JAW = THE SMOOTHEST SURFACE between the face front and the neck (FC-UNDERJAW-SEAM, learned over four rounds: the base's approved-face ↔
  // canonical-under junction kept re-creasing under every repair layer): a thin-plate (bi-Laplacian) fairing of the DOWN-facing under-jaw, weight 0 within
  // 3 rings of front-facing surface (normal z > 0.2: the traced front outline and chin stay) rising to 1 by ring 6; ears and neck rings untouched
  if (!process.env.HB_DIAG_NO_UNDERFAIR) { const N0 = vertexNormals(Y, hd.I), yMQ = ctx.mouthY3 ?? at(TL.mouth)[1], fr0 = new Int16Array(n).fill(-1); let fr = [];
    for (let i = 0; i < n; i++) if (N0[i * 3 + 2] > NSTYLE_UNDER.frontNz || hd.region[i] === R.earL || hd.region[i] === R.earR) { fr0[i] = 0; fr.push(i); }
    for (let k = 1; k <= 6; k++) { const nx = []; for (const i of fr) for (const j of hd.nb[i]) if (fr0[j] < 0) { fr0[j] = k; nx.push(j); } fr = nx; }
    // (tested + rejected: rounding the protected chin edge from behind with height/depth-only fairing moved the menton → chin relations failed, creases worse)
    const w = new Float32Array(n), sel = []; for (let i = 0; i < n; i++) { if ((hd.region[i] !== R.under && hd.region[i] !== R.jaw) || Y[i * 3 + 1] > yMQ || N0[i * 3 + 1] > -0.2) continue; const rk = fr0[i] < 0 ? 6 : fr0[i]; w[i] = sm(rk, NSTYLE_UNDER.ring0, NSTYLE_UNDER.ring1); if (w[i] > 0) sel.push(i); }
    const Lp = new Float32Array(n * 3), near = new Set(sel); for (const i of sel) for (const j of hd.nb[i]) near.add(j); const nearA = [...near];
    for (let it = 0; it < NSTYLE_UNDER.iters; it++) { for (const i of nearA) { const nb = hd.nb[i]; for (let q = 0; q < 3; q++) { let a2 = 0; for (const j of nb) a2 += Y[j * 3 + q]; Lp[i * 3 + q] = a2 / nb.length - Y[i * 3 + q]; } }
      for (const i of sel) { const nb = hd.nb[i]; for (let q = 0; q < 3; q++) { let a2 = 0; for (const j of nb) a2 += near.has(j) ? Lp[j * 3 + q] : 0; Y[i * 3 + q] -= NSTYLE_UNDER.alpha * w[i] * (a2 / nb.length - Lp[i * 3 + q]); } } }
    log.underJawFair = { verts: sel.length, iters: NSTYLE_UNDER.iters }; }
  const nanAt = {}, nanCk = (k) => { let c = 0; for (let i = 0; i < Y.length; i++) if (!Number.isFinite(Y[i])) c++; nanAt[k] = c; }; nanCk("afterPolishCleanup"); log.nan = nanAt;
  const STOP = process.env.HB_FEAT_STOP ?? "";   // diagnostics only: stop after a stage (taubin|polish|eyes|nose)
  if (STOP === "polish") return { X: Y, balls: [], log: { stop: STOP } };
  // front face verts + their person-space coordinates (the person's own 3D→image map)
  const F = [], Q = new Float32Array(n * 2); for (let i = 0; i < n; i++) if (FACE.has(hd.region[i]) && Y[i * 3 + 2] > 0.05) { F.push(i); const q = ctx.toN(Y[i * 3], Y[i * 3 + 1]); Q[i * 2] = q[0]; Q[i * 2 + 1] = q[1]; }
  // DESIGNED CREASES are declared by the module that builds them (lid↔ball contact + steep margin roll, canthus corners, lip seam,
  // nostrils); surface QA judges every other skin edge — and reports the declared count, so a module cannot hide a defect in it
  const DESIGNED = new Set();
  const od = ctx.od ?? {}, E = STYLE.eye, balls = [], zOnly = new Uint8Array(n);
  // ---- 1. EYES ----
  let N = vertexNormals(Y, hd.I);
  // eye spacing for the eye-width target = distance between the two MAPPED eye centres — the same quantity QA measures (visible-opening centres);
  // the template's eye landmarks are a different point (FC-EYE-IOD-DEFINITION)
  // FIXED POINT (FC-EYE-WIDTH-FIXED-POINT, learned: an eye scaled about its outline centroid also moves its corner midpoint, so "target × spacing"
  // built 8% narrow): ONE common scale k (each person's own left/right size relation kept) is solved so that mean corner width / corner-midpoint
  // spacing — exactly what QA measures — equals the target eye width
  let kEye = null; if (ctx.eyeW_IOD && ctx.eyes[0] && ctx.eyes[1]) { const P2 = ctx.eyes.map((e) => { const a2 = [...e.upper, ...e.lower], c = [a2.reduce((u, q) => u + q[0], 0) / a2.length, a2.reduce((u, q) => u + q[1], 0) / a2.length]; return { e, c }; });
    const corners = (k) => P2.map(({ e, c }) => [e.inner, e.outer].map((q) => to3D([c[0] + (q[0] - c[0]) * k, c[1] + (q[1] - c[1]) * k], F, Q, Y).p)), ratio = (k) => { const C = corners(k), w = C.map(([a2, b2]) => Math.hypot(a2[0] - b2[0], a2[1] - b2[1])), m = C.map(([a2, b2]) => [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2]); return (w[0] + w[1]) / 2 / Math.hypot(m[0][0] - m[1][0], m[0][1] - m[1][1]); };
    kEye = 1; for (let it = 0; it < 4; it++) kEye *= ctx.eyeW_IOD / ratio(kEye); log.eyeWidthSolve = { k: +kEye.toFixed(4), achieved: +ratio(kEye).toFixed(4), target: +ctx.eyeW_IOD.toFixed(4) }; }
  for (const e of ctx.eyes) { if (!e) continue;
    const ci0 = to3D(e.inner, F, Q, Y), co0 = to3D(e.outer, F, Q, Y), hwP = len(sub(co0.p, ci0.p)) / 2, IOD3 = len(sub(at(TL.eyeL), at(TL.eyeR)));
    // the person's MEASURED eye width is kept; the approved envelope only clamps it to the Offshorly range
    // the eye is built at the TARGET width (one definition: the style range is applied in the target map, with provenance); legacy clamp only without a target
    const hw = kEye != null ? kEye * hwP : Math.min(E.hwRange[1] * IOD3, Math.max(E.hwRange[0] * IOD3, hwP)), f = hw / hwP, all2 = [...e.upper, ...e.lower], cen = [all2.reduce((a, q) => a + q[0], 0) / all2.length, all2.reduce((a, q) => a + q[1], 0) / all2.length];
    const scl = (q) => [cen[0] + (q[0] - cen[0]) * f, cen[1] + (q[1] - cen[1]) * f], eu = e.upper.map(scl), el = e.lower.map(scl), ap = [...eu, ...el.slice().reverse()];
    const s3 = (2 * hw) / Math.hypot(scl(e.outer)[0] - scl(e.inner)[0], scl(e.outer)[1] - scl(e.inner)[1]);
    const tU = E.lidU * hw * (1 + 0.25 * clamp(od.upperLidFullness)), tL = E.lidL * hw * (1 + 0.2 * clamp(od.underEyeFullness)), Rb = E.ballR * hw, reach = (E.bandU + 0.05) * hw;
    // TRACED LID MARGIN (FC-LID-JAGGED, learned: the margin↔floor transition fell wherever the mesh cut the traced opening, so the lid/ball contact line
    // zig-zagged one triangle row at a time): on every mesh edge that crosses the traced opening, the endpoint nearer to it is moved ONTO it in the
    // front plane (≤ half an edge) — the margin vertex ring IS the traced opening, the contact line follows its curve
    if (!process.env.HB_DIAG_JAGGED_LIDS) { const apF = ap.map((q) => to3D(q, F, Q, Y).p), inF = new Set(F), snap = new Map();
      const near2 = (x, y) => { let best = null; for (let k = 0; k < apF.length; k++) { const a2 = apF[k], b2 = apF[(k + 1) % apF.length], vx = b2[0] - a2[0], vy = b2[1] - a2[1], l2 = vx * vx + vy * vy || 1e-12, t = Math.max(0, Math.min(1, ((x - a2[0]) * vx + (y - a2[1]) * vy) / l2)), px = a2[0] + t * vx, py = a2[1] + t * vy, dd = (x - px) ** 2 + (y - py) ** 2; if (!best || dd < best[2]) best = [px, py, dd]; } return best; };
      for (let t = 0; t < hd.I.length / 3; t++) for (let k = 0; k < 3; k++) { const a2 = hd.I[t * 3 + k], b2 = hd.I[t * 3 + (k + 1) % 3]; if (!inF.has(a2) || !inF.has(b2)) continue; const ia = inPoly([Q[a2 * 2], Q[a2 * 2 + 1]], ap), ib = inPoly([Q[b2 * 2], Q[b2 * 2 + 1]], ap); if (ia === ib) continue;
        const na = near2(Y[a2 * 3], Y[a2 * 3 + 1]), nb2 = near2(Y[b2 * 3], Y[b2 * 3 + 1]), [v, nv2] = na[2] <= nb2[2] ? [a2, na] : [b2, nb2], el2 = (Y[a2 * 3] - Y[b2 * 3]) ** 2 + (Y[a2 * 3 + 1] - Y[b2 * 3 + 1]) ** 2; if (nv2[2] <= 0.25 * el2 && !snap.has(v)) snap.set(v, nv2); }
      for (const [v, [px, py]] of snap) { Y[v * 3] = px; Y[v * 3 + 1] = py; const q = ctx.toN(px, py); Q[v * 2] = q[0]; Q[v * 2 + 1] = q[1]; } log[`lidSnap${balls.length}`] = snap.size; }
    const zone = []; for (const i of F) { const q = [Q[i * 2], Q[i * 2 + 1]], dU = plD(q, eu), dL = plD(q, el), d = (inPoly(q, ap) ? -1 : 1) * Math.min(dU, dL) * s3; if (d < reach) zone.push([i, d, dU <= dL, (dL - dU) * s3]); }
    const inside = zone.filter((z) => z[1] < 0); if (inside.length < 12) { log[`eye${balls.length}`] = "aperture too small — skipped (fail-soft)"; continue; }
    const A0 = [0, 0, 0], Na = [0, 0, 0]; for (const [i] of inside) for (let q = 0; q < 3; q++) { A0[q] += Y[i * 3 + q] / inside.length; Na[q] += N[i * 3 + q]; }
    const ax = nrm([0.5 * nrm(Na)[0], 0.5 * nrm(Na)[1], 0.5 * nrm(Na)[2] + 0.5]);
    // ball centre depth: lid shells sit on the head's own socket surface (mean over the lid band) — identity depth preserved
    // ball depth: the ball FRONT (on the aperture axis) sits at the head's own surface at the aperture centre + a small style
    // projection — a convex eyeball the lids wrap over (identity socket depth preserved: it is the identity head's surface)
    // FC-BALL-DEPTH-OFFAXIS (learned): the depth reference is the aperture vertex nearest the aperture centre IN THE FRONT PLANE
    let A1 = A0; { let best = Infinity; for (const [i] of inside) { const p = at(i), dd = (p[0] - A0[0]) ** 2 + (p[1] - A0[1]) ** 2; if (dd < best) { best = dd; A1 = p; } } }
    const c0 = Rb - E.ballProj * hw, C = [A0[0], A0[1], A1[2] - c0];   // centre on the aperture centroid (front plane), depth from the head's own surface
    const m = E.roll * hw, ins = E.inset * hw;
    // FC-EYE-SEAT (learned with shape completion): a narrowed face recedes at the sides (in-plane narrowing keeps depth), so the ball is
    // SEATED behind the head's own surrounding surface — every zone vertex beyond the lid margin that lies over the ball's front-plane
    // disk must stay in front of the ball (+ clearance); the ball moves back only as far as needed (capped), the lids are built around it
    { const keep0 = new Set(zone.filter((z2) => z2[1] < m).map((z2) => z2[0])); let deficit = 0;
      // ALL forward-facing head verts over the ball's disk (any region — FC-EYE-SEAT-REGIONS: temple/side verts were missed), except aperture floor + margin
      for (let i = 0; i < n; i++) { if (keep0.has(i) || N[i * 3 + 2] < 0.2 || hd.region[i] === R.earL || hd.region[i] === R.earR) continue; const p = at(i), rho = Math.hypot(p[0] - C[0], p[1] - C[1]); if (rho >= Rb || p[2] < C[2] - Rb) continue;
        const need = C[2] + Math.sqrt(Rb * Rb - rho * rho) + 0.3 * tL - p[2]; if (need > deficit) deficit = need; }
      deficit = Math.min(deficit, 0.5 * Rb); C[2] -= deficit; log[`eyeSeat${balls.length}`] = +deficit.toFixed(4); }
    // lid profile as a FRONT-PLANE HEIGHT FIELD over the ball (FC-RADIAL-APERTURE-SHRINK, learned in the proportion audit: radial
    // moves from the ball centre slid the projected aperture inward at the corners — eye width −25%, inner gap +25%). Vertices
    // move ONLY along z, so the Stage 0 aperture outline (a front-plane measurement) is reproduced exactly in the front view.
    // radius profile r(d): aperture floor tucked under the ball → rounded margin → lid shell → back to the head's own surface
    const zOn = (rr, rho) => (rho < rr ? C[2] + Math.sqrt(rr * rr - rho * rho) : null);
    // EYELIDS = the person's own surrounding surface ROLLING ONTO THE EYEBALL over a rounded margin (FC-LID-SHELL-CLIFF, learned: a lid
    // shell around a deep-seated ball sat far below the face and snapped back to it at the shell's silhouette → a recessed shelf with a
    // circular cliff; a thin bead read as a second cut line). Per vertex (front-plane height field, so the Stage 0 aperture is exact):
    //   outer lid surface = max(own surface, ball + lid thickness); the margin rolls from the ball (touching, tucked) to that surface with a
    //   circular profile whose width follows the local depth gap (deep-set eyes roll wide, prominent eyes roll tight); then lid thickness
    //   relaxes to the own surface over the lid band; upper-lid fold and under-eye fullness are gentle, d-only modulations
    // FC-CANTHUS-SEAM (learned, surface QA): each vertex used to take the upper OR the lower lid profile (nearest outline), so the two
    // profiles met in a crease running out of each eye corner — both are evaluated and blended across the canthal line
    const lidZ = (d, up, p, rho) => { const t = up ? tU : tL, bnd = (up ? E.bandU : E.bandL) * hw, zb = rho < Rb ? C[2] + Math.sqrt(Rb * Rb - rho * rho) : C[2], zOut = Math.max(p[2], zb + t), gap = zOut - zb, W = Math.min(E.rollMax * hw, Math.max(E.rollMin * hw, E.rollK * gap));
      const u = Math.min(1, d / W); let z = zb + E.marginEps + (zOut - zb - E.marginEps) * Math.sqrt(1 - (1 - u) * (1 - u));
      if (d > W) z += (p[2] - zOut) * ss5((d - W) / Math.max(1e-6, bnd - W));
      if (up) z -= E.creaseDepth * hw * Math.exp(-(((d - Math.max(W, E.creaseD * hw)) / (E.creaseW * hw)) ** 2)) * (1 - sm(d, bnd * 0.8, bnd)) * sm(d, 0.5 * W, W);
      else z += E.underBulge * hw * Math.exp(-(((d - Math.max(W, 0.45 * bnd)) / (0.3 * bnd)) ** 2)) * (1 - sm(d, bnd * 0.8, bnd));
      if (rho < Rb) z = softMax(z, zb + E.marginEps + E.clear * t * sm(d, 0, m), 0.6 * t); lastW = W; return z; };
    let lastW = 0; const ci3 = to3D(scl(e.inner), F, Q, Y).p, co3 = to3D(scl(e.outer), F, Q, Y).p;
    const DZ = new Map(), FLR = new Map(), FIX = new Set();
    for (const [i, d, , dLU] of zone) { const p = at(i), rho = Math.hypot(p[0] - C[0], p[1] - C[1]); let z;
      if (d < 0) { const r = Rb - ins * (0.5 + 0.5 * sm(-d, 0, E.floorDrop * m)); z = zOn(r, rho); if (z === null) z = C[2]; DESIGNED.add(i); FIX.add(i); }   // aperture floor tucked under the ball (FC-APERTURE-TIP-LOSS)
      else { const wU = ss5(0.5 + dLU / (2 * 0.12 * hw)), zu = lidZ(d, true, p, rho), Wu = lastW, zl = lidZ(d, false, p, rho), Wl = lastW; z = wU * zu + (1 - wU) * zl;   // blend ±0.12 hw across the canthal line
        if (d < 0.5 * (wU * Wu + (1 - wU) * Wl) || Math.min(Math.hypot(p[0] - ci3[0], p[1] - ci3[1]), Math.hypot(p[0] - co3[0], p[1] - co3[1])) < 0.2 * hw) { DESIGNED.add(i); FIX.add(i); }
        if (rho < Rb) FLR.set(i, C[2] + Math.sqrt(Rb * Rb - rho * rho) + E.marginEps + E.clear * (wU * tU + (1 - wU) * tL) * sm(d, 0, m)); }
      DZ.set(i, gain * (z - p[2])); zOnly[i] = 1; }
    // LID FAIRING (FC-LID-CONSTRUCTION-LINES, learned in surface QA: roll/relax/fold terms left arcs at fixed offsets from the aperture): the
    // lid displacement field is relaxed over the surface outside the declared margin (margin + floor fixed), then the anti-poke floor is
    // re-applied smoothly — form kept, construction lines gone
    for (let it = 0; it < 14; it++) { const T2 = new Map(DZ); for (const [i] of DZ) { if (FIX.has(i)) continue; let a2 = 0, c2 = 0; for (const j of hd.nb[i]) { a2 += T2.get(j) ?? 0; c2++; } DZ.set(i, 0.5 * T2.get(i) + 0.5 * (c2 ? a2 / c2 : 0)); } }
    for (const [i, dz] of DZ) { let z = Y[i * 3 + 2] + dz; const fl = FLR.get(i); if (fl != null) z = softMax(z, fl, FIX.has(i) ? 0.2 * tL : 0.6 * tL); Y[i * 3 + 2] = z; }   // the floor holds on EVERY lid vertex (FC-CANTHUS-POKE: declared corners skipped it)
    // FC-BALL-POKE (whole silhouette): any head surface over the ball's front-plane silhouette that is not aperture stays in front of it
    { const inAp = new Set(inside.map((z2) => z2[0])); for (const i of F) { if (inAp.has(i)) continue; const p = at(i), rho = Math.hypot(p[0] - C[0], p[1] - C[1]); if (rho >= Rb) continue; const zb = zOn(Rb, rho) + 0.12 * tL, zN = softMax(Y[i * 3 + 2], zb, 0.8 * tL); if (zN !== Y[i * 3 + 2]) { Y[i * 3 + 2] = zN; zOnly[i] = 1; } } }
    // FC-EYE-CONTAINMENT (learned with shape completion): a narrowed face side must still CONTAIN the eyeball — every head vertex
    // outside the aperture/lid zone that lies inside (ball + clearance) is pushed radially outward from the ball centre (temple wraps
    // over the eye). Radial moves keep the angular order around the centre → no folds.
    { const keep = new Set(zone.filter((z2) => z2[1] < m).map((z2) => z2[0])), cl = Rb + 0.5 * tL; let pushed = 0; for (let i = 0; i < n; i++) { if (keep.has(i)) continue;   /* aperture floor + lid margin keep their construction */ const p = at(i), v = sub(p, C), l = len(v), lN = softMax(l, cl, 0.8 * tL); if (lN === l || l < 1e-6) continue;
        const tgt = [C[0] + (v[0] / l) * lN, C[1] + (v[1] / l) * lN, C[2] + (v[2] / l) * lN]; for (let q = 0; q < 3; q++) Y[i * 3 + q] = p[q] + gain * (tgt[q] - p[q]); pushed++; } log[`eyeContain${balls.length}`] = pushed; }
    const r5 = (a) => a.map((v) => +v.toFixed(5));
    // the DESIGNED eye opening in the front plane (structural QA T7: an eyeball visible OUTSIDE it is a poke-through)
    const ap3 = ap.map((q) => { const pq = to3D(q, F, Q, Y).p; return [+pq[0].toFixed(5), +pq[1].toFixed(5)]; });
    balls.push({ ap3, s0inner3: r5(ci0.p), s0outer3: r5(co0.p), inner3: r5(to3D(scl(e.inner), F, Q, Y).p), outer3: r5(to3D(scl(e.outer), F, Q, Y).p), c: C.map((v) => +v.toFixed(5)), r: +Rb.toFixed(5), axis: ax.map((v) => +v.toFixed(4)), hw: +hw.toFixed(4), scale: +f.toFixed(3), lidU: +tU.toFixed(4), lidL: +tL.toFixed(4), zone: zone.length, aperture: inside.length }); }
  log.eyes = balls; nanCk("afterEyes"); if (STOP === "eyes") return { X: Y, balls, log };
  // ---- 2. NOSE ----
  N = vertexNormals(Y, hd.I); const NS = STYLE.nose;
  if (ctx.nose) { const tip = TL.noseTip, tp = at(tip), tn = nearN(N, tip), rt = NS.tipR * IOD * (1 + 0.12 * clamp(od.noseTipWidth) + 0.08 * clamp(od.noseTipRoundness)), pj = NS.tipProj * IOD * (1 + 0.3 * clamp(od.noseTipProjection));
    const prims = [{ t: "s", c: [tp[0] - tn[0] * (rt - pj), tp[1] - tn[1] * (rt - pj), tp[2] - tn[2] * (rt - pj)], r: rt }], ra = NS.alaR * IOD * (1 + 0.15 * clamp(od.noseAlarWidth)), holes = [];
    const base3 = to3D(ctx.nose.base, F, Q, Y).p; log.noseLand = { base3, wingR3: to3D(ctx.nose.wingR, F, Q, Y).p, wingL3: to3D(ctx.nose.wingL, F, Q, Y).p };
    // CLEAN SEAT (FC-NOSE-INHERITED-CRUMPLE, learned: the style base averages the approved heads' nostrils into folded, crumpled geometry that every
    // nose built on top inherited — speckled pits, a slit under wide noses): the nose underside zone is faired (volume-preserving Taubin, all three
    // components, weight falling to 0 at its edge) BEFORE the one nose is built on it. The new nose is the only nose.
    if (!process.env.HB_DIAG_LEGACY_NOSE) { const w0 = log.noseLand.wingR3, w1 = log.noseLand.wingL3, hwS = Math.abs(w1[0] - w0[0]) / 2, Rn = hwS + 1.6 * ra, c0 = [base3[0], (base3[1] + tp[1]) / 2], ws = new Float32Array(n), zone = [];
      for (const i of F) { const pp = at(i), d = Math.hypot(pp[0] - c0[0], (pp[1] - c0[1]) * 1.3); if (d >= Rn || pp[1] > tp[1] + 0.6 * rt) continue; ws[i] = 1 - sm(d, 0.55 * Rn, Rn); if (ws[i] > 0) zone.push(i); }
      // below the tip the inherited dimples span 5–10 edges — Taubin is a band-pass that KEEPS them (tested: 600 iterations moved ≤ 1 mm); plain Laplacian
      // relaxation flattens them, and the one nose (tip from the PRE-seat tip position, base from the traced wings) is rebuilt on the clean seat
      for (let it = 0; it < NS.seatIters; it++) { const T = Y.slice(); for (const i of zone) { const nb2 = hd.nb[i], wl = ws[i] * (1 - sm(at(i)[1], tp[1] - 0.5 * rt, tp[1] + 0.2 * rt)); if (!wl) continue; for (let q = 0; q < 3; q++) { let a2 = 0; for (const j of nb2) a2 += T[j * 3 + q]; Y[i * 3 + q] = T[i * 3 + q] + 0.5 * wl * (a2 / nb2.length - T[i * 3 + q]); } } }
      N = vertexNormals(Y, hd.I); log.noseSeat = { verts: zone.length, R: +Rn.toFixed(4) }; if (STOP === "noseseat") return { X: Y, balls, log }; }
    const alaC = []; for (const w of [ctx.nose.wingR, ctx.nose.wingL]) { const g = to3D(w, F, Q, Y), gn = nearN(N, g.i), sx = Math.sign(g.p[0] - tp[0]) || 1;
      const c = [g.p[0] - sx * NS.alaIn * ra - gn[0] * (1 - NS.alaOut) * ra, g.p[1] - gn[1] * (1 - NS.alaOut) * ra, g.p[2] - gn[2] * (1 - NS.alaOut) * ra];
      // ALA = a flattened lobe (longer front→back, lower) joined to the tip by a tapered sidewall, all smooth-unioned (FC-NOSE-PEBBLES, learned:
      // near-spherical wing balls hard-unioned to the tip and blended into the face over 0.008 IOD read as detached pebbles)
      // the sidewall runs from the wing to a NASAL-BASE point just below/behind the tip at the wings' own protrusion depth — the wings become the
      // rounded ends of ONE continuous base whatever the nose width (a tip-centre sidewall ran inside the head on wide noses)
      alaC.push(c);
      // nostril: on the nose's real UNDERSIDE (down-facing verts) between tip and ala, half-embedded
      const tc = prims[0].c, tx = 0.5 * c[0] + 0.5 * tc[0], tz = tc[2] - 0.1 * rt, nr = NS.nostrilR * IOD; let bi = -1, bd = Infinity;
      for (const i of F) { if (N[i * 3 + 1] > -0.45) continue; const p = at(i); if (Math.abs(p[1] - tc[1]) > 2 * rt || p[1] > tc[1] - 0.3 * rt) continue;   /* nostrils sit on the base UNDERSIDE, below the tip centre (a narrow nose let the search land on a wing's flank) */ const dd = (p[0] - tx) ** 2 + (p[2] - tz) ** 2; if (dd < bd) { bd = dd; bi = i; } }
      if (bi >= 0) { const p = at(bi), nn = nearN(N, bi); holes.push({ t: "e", c: [p[0], p[1], p[2]], R: [0.6 * nr, 0.4 * nr, 1.35 * nr] }); } }   /* elongated front→back */
    // NASAL BASE BAR (FC-NOSE-PEBBLES, learned: wing lobes far from a small tip read as detached pebbles even with a sidewall — the sidewall sat deeper
    // and thinner): ONE chain of overlapping flattened ellipsoids wing → nasal base (below the tip) → wing, each seated at the SAME protrusion above
    // the local face surface — the wings are the rounded ends of one continuous base, the tip sits on it. Width = the person's wing points.
    // ONE NOSE (FC-NOSE-BAR, learned: a chain of 9 equal ellipsoids read as a flat bar with a slit, its alar groove + nostril carves as speckled pits): the
    // nasal base is ONE smooth ellipsoid spanning the traced wing points (its rounded ends ARE the alae), seated on the face, smooth-unioned with the tip —
    // width = the person's wings, projection = tip drive; no separate groove. Legacy bar only on the diagnostic path.
    if (alaC.length === 2 && !process.env.HB_DIAG_LEGACY_NOSE) { const w0 = log.noseLand.wingR3, w1 = log.noseLand.wingL3, wy = (w0[1] + w1[1]) / 2, cx = (w0[0] + w1[0]) / 2, hwN = Math.abs(w1[0] - w0[0]) / 2, Ry0 = Math.max(NS.baseShape[1] * ra, 0.5 * Math.abs(wy - base3[1]) + 0.15 * ra), cy = base3[1] + Ry0;   /* spans the traced wing level, its BOTTOM ON the traced nose base (the identity nose-base height) */
      const zs = []; for (const i of F) { const pp = at(i); if (Math.abs(pp[1] - wy) < 0.5 * ra && Math.abs(Math.abs(pp[0] - cx) - hwN) < 0.5 * ra) zs.push(pp[2]); } zs.sort((a3, b3) => a3 - b3); const bz = zs.length ? zs[zs.length >> 1] : prims[0].c[2] - rt;
      const R = [Math.max(hwN * NS.baseSpan, 1.2 * ra), Ry0, NS.baseShape[2] * ra]; prims.push({ t: "e", c: [cx, cy, bz - (1 - NS.baseOut) * R[2]], R });
      // COLUMELLA (FC-SUBNASALE-UNBUILT again, learned: once the inherited underside is faired, nothing turned the nose into the lip at the traced base): a
      // tapered round cone from the tip down-back to the TRACED nose base — the nose underside meets the upper lip at the identity nose-base height
      const tc = prims[0].c, rc = NS.columella * rt, cb = [base3[0], base3[1] + 1.0 * rc, base3[2] - 0.5 * rc];   /* the cone's underside ENDS on the traced base height */ prims.push({ t: "c", a: [tc[0], tc[1] - 0.2 * rt, tc[2]], b: cb, ra: 1.25 * rc, rb: rc });
      log.nose = { base: { R: R.map((v) => +v.toFixed(4)), halfWidth: +hwN.toFixed(4) }, columella: { r: +rc.toFixed(4), to: cb.map((v) => +v.toFixed(4)) } }; }
    else if (alaC.length === 2) { const Rb = [NS.alaShape[0] * ra, NS.alaShape[1] * ra, NS.alaShape[2] * ra], tcB = prims[0].c, Bm = [tcB[0], tcB[1] - 0.45 * rt, tcB[2]], pts = [];
      const nS = 9; for (let k = 0; k < nS; k++) { const u = k / (nS - 1), a2 = u < 0.5 ? alaC[0] : Bm, b2 = u < 0.5 ? Bm : alaC[1], v = u < 0.5 ? u * 2 : (u - 0.5) * 2; pts.push([a2[0] + v * (b2[0] - a2[0]), a2[1] + v * (b2[1] - a2[1])]); }
      // seat on the MEDIAN local surface depth (the front-most vertex caught the nose sidewall → a curled flap); protrusion tapers from the wings to a
      // recessed middle under the tip (alae flare, the nostril sill dips) — not a flat horizontal band
      pts.forEach((q, k) => { const zs = []; for (const i of F) { const pp = at(i); if (Math.hypot(pp[0] - q[0], pp[1] - q[1]) < 0.4 * ra) zs.push(pp[2]); } if (!zs.length) return; zs.sort((a3, b3) => a3 - b3);
        const bz = zs[zs.length >> 1], e2 = Math.abs(k / (nS - 1) - 0.5) * 2, wEnd = sm(e2, 0.35, 0.95), out = NS.alaOut * wEnd + NS.sillOut * (1 - wEnd), R = [Rb[0], Rb[1] * (0.75 + 0.25 * wEnd), Rb[2]];
        prims.push({ t: "e", c: [q[0], q[1], bz - (1 - out) * R[2]], R }); }); }
    const ONE = !process.env.HB_DIAG_LEGACY_NOSE, nv = F.filter((i) => len(sub(at(i), tp)) < 2.6 * rt + 2 * ra + (ONE ? Math.abs(log.noseLand.wingR3[0] - log.noseLand.wingL3[0]) / 2 : 0)); prims.kInt = (ONE ? NS.oneBlend : NS.alaBlend) * ra; const Yn0 = Float32Array.from(Y);
    log.nose = { ...(log.nose ?? {}), tipR: +rt.toFixed(4), alaR: +ra.toFixed(4), add: sdfAlongNormals(Y, N, nv, prims, Math.max(NS.k * IOD, (ONE ? NS.oneFace : NS.faceBlend) * ra), "add", gain, hd.nb, 0.05, ONE ? 8 : 5) };
    // BUILT TO MEASURE (FC-NOSE-BASE-BLEND, learned: the nose↔face blend spreads the underside ~1 blend radius below the columella end, so the corner QA reads
    // as the nose base landed 3–4% of face height low): the shared subnasale definition is measured on the built nose and the columella end is moved by the
    // error, rebuilt from the same seat (≤ 3 rounds, ≤ 2 columella radii) — the nose base lands where the identity map puts it
    if (ONE && log.nose.columella && ctx.mouthY3 != null) { const col = prims.find((q) => q.t === "c"), bas = prims.find((q) => q.t === "e"), lim = 2 * col.rb, b0 = col.b[1], e0 = bas ? bas.c[1] : 0, hist = [];   /* the nose UNDERSIDE (columella end + nasal base) moves as one */
      for (let r = 0; r < 3; r++) { const sn = subnasale(Y, n, at(TL.noseTip)[1], at(TL.noseTip)[2], ctx.mouthY3); if (!sn) break; const err = sn.y - base3[1]; hist.push(+err.toFixed(4)); if (Math.abs(err) < 0.002) break;
        col.b[1] = Math.max(b0 - lim, Math.min(b0 + lim, col.b[1] - err)); if (bas) bas.c[1] = e0 + (col.b[1] - b0); Y.set(Yn0); log.nose.add = sdfAlongNormals(Y, N, nv, prims, Math.max(NS.k * IOD, NS.oneFace * ra), "add", gain, hd.nb, 0.05, 8); }
      log.nose.baseSolve = { errs: hist, shift: +(col.b[1] - b0).toFixed(4) }; }
    // ALAR GROOVE: a soft crease where each wing meets the cheek (upper-lateral arc around the lobe), declared as a designed crease
    if (!ONE) { const bar = prims.filter((q) => q.t === "e"), alae = bar.length >= 2 ? [bar[0], bar[bar.length - 1]] : bar; N = vertexNormals(Y, hd.I); log.nose.alarGroove = heightForm(Y, nv, (i) => { const q = at(i); let t = 0;
        for (const a of alae) { const dx = q[0] - a.c[0], dy = q[1] - a.c[1], rr = Math.hypot(dx / a.R[0], dy / a.R[1]), ang = Math.atan2(dy, Math.abs(dx) * Math.sign(dx * Math.sign(a.c[0] - tp[0]) || 1));
          const arc = sm(ang, -0.9, -0.2) * (1 - sm(ang, 1.0, 1.5)) * sm(Math.hypot(q[0] - prims[0].c[0], q[1] - prims[0].c[1]), 1.0 * rt, 1.4 * rt); t -= gain * NS.grooveDepth * ra * Math.exp(-(((rr - 1.02) / NS.grooveW) ** 2)) * arc * sm(N[i * 3 + 2], 0.1, 0.5);   /* cheek side only — on a narrow nose the arc crossed the tip's flank */ if (Math.abs(rr - 1.02) < NS.grooveW) DESIGNED.add(i); }
        return t; }, hd.nb, 3); }
    N = vertexNormals(Y, hd.I); const decN = new Set(); // SOFT NOSTRILS (FC-NOSTRIL-PITS, learned: ellipsoid carves along per-vertex rays cut ragged pits into the curved underside): each nostril is a smooth,
    // compact dimple along the surface normal at the traced nostril point — a shadowed opening seen from below, no carved rim
    if (ONE && !process.env.HB_DIAG_NO_NOSTRILS) { const nr = NS.nostrilR * IOD; log.nose.nostrils = normalForm(Y, N, nv, (i) => { let t = 0; for (const h of holes) { const q2 = ((Y[i * 3] - h.c[0]) / (NS.nostrilShape[0] * nr)) ** 2 + ((Y[i * 3 + 1] - h.c[1]) / (NS.nostrilShape[1] * nr)) ** 2 + ((Y[i * 3 + 2] - h.c[2]) / (NS.nostrilShape[2] * nr)) ** 2; if (q2 < 1) t -= gain * NS.nostrilDepth * nr * (1 - q2) ** 2; } return t; }, hd.nb, 4); }
    else if (!process.env.HB_DIAG_NO_NOSTRILS) log.nose.nostrils = sdfAlongNormals(Y, N, nv, holes, (ONE ? 0.016 : 0.01) * IOD, "carve", gain, hd.nb, 0.4 * NS.nostrilR * IOD, ONE ? 10 : 6, false, decN);
    for (const i of decN) { DESIGNED.add(i); for (const j of hd.nb[i]) DESIGNED.add(j); }   // a nostril is an OPENING: its rim ring is part of the designed crease
    // SUBNASALE JUNCTION (FC-NOSE-BASE-UNBUILT, learned on low-projecting noses): the nose base is BUILT where the proportion map puts
    // it — a shallow horizontal crease spanning the nose base at the Stage 0 base height (the same corner the shared subnasale
    // definition measures), so the underside→lip corner exists even when the tip barely projects
    { const wr = to3D(ctx.nose.wingR, F, Q, Y).p, wl = to3D(ctx.nose.wingL, F, Q, Y).p, hwN = Math.abs(wr[0] - wl[0]) / 2; let bi = -1, bz = -Infinity;
      for (const i of nv) { const p = at(i); if (Math.abs(p[0] - base3[0]) > 0.004 || Math.abs(p[1] - base3[1]) > 0.004) continue; if (p[2] > bz) { bz = p[2]; bi = i; } }
      // SOFT JUNCTION (FC-SUBNASALE-SLIT, learned: an ellipsoid carve read as a second little mouth): a shallow, relaxed depth-only
      // concavity — the corner the shared definition measures, sculpted as the nose underside turning into the upper lip
      if (bi >= 0) { const p = at(bi), rz = NS.baseCrease * IOD, hx = 0.9 * hwN; N = vertexNormals(Y, hd.I);
        const junction = (mul) => heightForm(Y, nv, (i) => { const q = at(i), dx = Math.abs(q[0] - base3[0]); if (dx >= hx) return 0; return -gain * mul * 0.4 * rz * Math.cos((Math.PI / 2) * (dx / hx)) ** 2 * Math.exp(-(((q[1] - p[1]) / (0.6 * rz)) ** 2)) * (ONE ? sm(q[2], p[2] - 1.5 * rz, p[2] - 0.3 * rz) : sm(N[i * 3 + 2], -0.1, 0.4)); }, hd.nb, ONE ? 6 : 3);
        // ONE path: the junction depth is part of the BUILT-TO-MEASURE solve (a low-projecting nose has no corner of its own — the subnasale turn is built
        // where the identity map puts it, deepened only as far as the shared definition needs: ×1, ×1.6, ×2.2)
        if (!ONE || ctx.mouthY3 == null) log.nose.subnasale = junction(1); else { const Ys = Float32Array.from(Y), tries = []; for (const mul of [1, 1.6, 2.2]) { Y.set(Ys); log.nose.subnasale = junction(mul); const sn = subnasale(Y, n, at(TL.noseTip)[1], at(TL.noseTip)[2], ctx.mouthY3), err = sn ? sn.y - base3[1] : null; tries.push([mul, err == null ? null : +err.toFixed(4)]); if (err != null && Math.abs(err) < 0.004) break; } log.nose.junctionSolve = tries; } } } }   /* ONE path: a smooth DEPTH weight (FC-FORM-SPECKLE again: a per-vertex normal factor turned normal noise into pits under the nose) */
  nanCk("afterNose"); if (STOP === "nose") return { X: Y, balls, log };
  // ---- 3. LIPS (closed mouth) ----
  N = vertexNormals(Y, hd.I); const LS = STYLE.lips;
  // SEAM-FIRST SMILE (FC-LIP-STRIPS, learned: lip TUBES swept along the outlines read as two thick clay strips, and their ends dangled at the corners):
  // a closed smile is a clean SEAM along the traced mouth line + two LOW, soft lip forms (height fields in the mouth's own frame: along-seam u,
  // across-seam v / traced lip height) that vanish at the traced corners. Mouth width, corners, curvature and lip heights are the person's; the
  // amplitude is the style's (subtle). Legacy tubes only on the diagnostic path (negative tests).
  if (ctx.mouth && ctx.smile && !process.env.HB_DIAG_LEGACY_LIPS) { const U = ctx.mouth.upper, Lw = ctx.mouth.lower, K = U.length, seam = U.map((q, i) => [q[0], (q[1] + Lw[i][1]) / 2]), SM = STYLE.smile;
    const c3 = to3D(ctx.mouth.cR, F, Q, Y).p, c4 = to3D(ctx.mouth.cL, F, Q, Y).p, s3 = len(sub(c3, c4)) / Math.hypot(ctx.mouth.cR[0] - ctx.mouth.cL[0], ctx.mouth.cR[1] - ctx.mouth.cL[1]);
    // the closed-smile SPEC (mouth.mjs: traced corners/width/curvature, one smooth seam curve, lip heights with provenance) — corner to corner
    const S2 = ctx.smile.seam, acc = [0]; for (let k = 1; k < S2.length; k++) acc.push(acc[k - 1] + Math.hypot(S2[k][0] - S2[k - 1][0], S2[k][1] - S2[k - 1][1])); const Ltot = acc[acc.length - 1];
    const hU = ctx.smile.hU, hL = ctx.smile.hL, hMax = Math.max(...hU, ...hL, 1e-6), upSign = -1;   // image y: the upper lip lies above the seam
    const frame = (q) => { let best = { d: Infinity }; for (let k = 0; k + 1 < S2.length; k++) { const a2 = S2[k], b2 = S2[k + 1], vx = b2[0] - a2[0], vy = b2[1] - a2[1], l2 = vx * vx + vy * vy || 1e-12, t = Math.max(0, Math.min(1, ((q[0] - a2[0]) * vx + (q[1] - a2[1]) * vy) / l2)), px = a2[0] + t * vx, py = a2[1] + t * vy, d = Math.hypot(q[0] - px, q[1] - py);
        if (d < best.d) { const l = Math.sqrt(l2), nx = -vy / l, ny = vx / l, sg = Math.sign((q[0] - px) * nx + (q[1] - py) * ny) * Math.sign(nx * 0 + ny * upSign) || 1; best = { d, k, t, u: (acc[k] + t * (acc[k + 1] - acc[k])) / Ltot, v: sg * d, hu: hU[k] + t * (hU[k + 1] - hU[k]), hl: hL[k] + t * (hL[k + 1] - hL[k]), end: (t === 0 && k === 0) || (t === 1 && k === S2.length - 2) }; } }
      return best; };
    // lip heights along the seam, smoothed (the traced border's wiggle is not form) and rounded to the corners (sin taper)
    const taper = (u) => Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** SM.cornerPow, bump = (t) => (t <= 0 || t >= SM.reach ? 0 : Math.sin((Math.PI * t) / SM.reach) ** 2);
    const mv = F.filter((i) => { const q = [Q[i * 2], Q[i * 2 + 1]]; return Math.hypot(q[0] - S2[S2.length >> 1][0], q[1] - S2[S2.length >> 1][1]) < 0.75 * Ltot + 3 * hMax; });
    const fr = new Map(); for (const i of mv) fr.set(i, frame([Q[i * 2], Q[i * 2 + 1]]));
    const aU = SM.upper * (1 + 0.2 * clamp(od.upperLipVolume)), aL = SM.lower * (1 + 0.2 * clamp(od.lowerLipVolume));
    const lipZ = (i) => { const f = fr.get(i); if (!f) return 0; const tp = taper(f.u); if (!tp) return 0; return f.v > 0 ? aU * f.hu * s3 * tp * bump(f.v / Math.max(1e-6, f.hu)) : aL * f.hl * s3 * tp * bump(-f.v / Math.max(1e-6, f.hl)); };
    log.lips = { mode: "seam-first smile", add: heightForm(Y, mv, (i) => gain * lipZ(i), hd.nb, SM.relax) };
    // the SEAM: one narrow groove along the traced mouth line, soft-ended just past each corner (no pits, nothing dangling)
    const wP = SM.seamW * IOD / s3, ext = SM.cornerExt * Ltot, seamZ = (i) => { const f = fr.get(i); if (!f) return 0; const along = f.end ? Math.max(0, 1 - f.d / Math.max(1e-6, ext)) : 1, tp = SM.seamEnd + (1 - SM.seamEnd) * taper(f.u) ** 0.5; return -SM.seamDepth * IOD * tp * along * Math.exp(-(((f.end ? 0 : f.v) / wP) ** 2)) * (f.end ? Math.exp(-(((f.d * 0.3) / wP) ** 2)) : 1); };
    { const before = Float32Array.from(Y); log.lips.seam = heightForm(Y, mv, (i) => gain * seamZ(i), hd.nb, 1); let mx = 0; for (const i of mv) mx = Math.max(mx, before[i * 3 + 2] - Y[i * 3 + 2]); for (const i of mv) if (before[i * 3 + 2] - Y[i * 3 + 2] > 0.15 * mx) { DESIGNED.add(i); } }
    // LIP ENDS invariant (surface QA L_lipEnds): the volume at the outer 10% of the seam vs the lip maximum; the forms end ON the traced corners by construction
    { let mE = 0, mA = 0; for (const i of mv) { const f = fr.get(i), z = Math.abs(lipZ(i)); mA = Math.max(mA, z); if (f && (f.u < 0.1 || f.u > 0.9)) mE = Math.max(mE, z); } log.lipEnds = { endRadiusRatio: +(mE / Math.max(1e-9, mA)).toFixed(3), endOffset_mouthW: 0 }; }
    log.lips.amp = { upper: +(aU * Math.max(...hU) * s3 / IOD).toFixed(4), lower: +(aL * Math.max(...hL) * s3 / IOD).toFixed(4), unit: "IOD" }; }
  else if (ctx.mouth && ctx.mouth.upper.length === ctx.mouth.lower.length) { const U = ctx.mouth.upper, Lw = ctx.mouth.lower, K = U.length, seam = U.map((q, i) => [q[0], (q[1] + Lw[i][1]) / 2]);
    const c3 = to3D(ctx.mouth.cR, F, Q, Y).p, c4 = to3D(ctx.mouth.cL, F, Q, Y).p, s3 = len(sub(c3, c4)) / Math.hypot(ctx.mouth.cR[0] - ctx.mouth.cL[0], ctx.mouth.cR[1] - ctx.mouth.cL[1]);
    const up = [], lo = [], sp = [];
    for (let k = 0; k < K; k++) { const end = Math.min(k, K - 1 - k) / ((K - 1) / 2), taper = LS.cornerTaper + (1 - LS.cornerTaper) * sm(end, 0, 0.6);
      const hu = Math.abs(U[k][1] - seam[k][1]) * s3, hl = Math.abs(Lw[k][1] - seam[k][1]) * s3, s = to3D(seam[k], F, Q, Y); sp.push(s);
      const pu = to3D([seam[k][0], seam[k][1] + 0.5 * (U[k][1] - seam[k][1])], F, Q, Y), pl = to3D([seam[k][0], seam[k][1] + 0.5 * (Lw[k][1] - seam[k][1])], F, Q, Y);
      // COMMISSURES (FC-LIP-END-SPIKE, learned on a holdout: a lip-outline END point measured far off the mouth corner grew a tube segment → a
      // ridge from the corner into the cheek): lips MEET at the corners — the volumes taper to ~0 and converge onto the measured corner point
      // over the outer part of each lip (the corner positions = mouth width are the person's; only the outline's tail is not trusted)
      const conv = process.env.HB_DIAG_LEGACY_LIPENDS ? 0 : 1 - sm(end, 0, 0.35), cz = k < K / 2 ? c3 : c4, conv3 = (p3) => [p3[0] + conv * (cz[0] - p3[0]), p3[1] + conv * (cz[1] - p3[1]), p3[2] + conv * (cz[2] - p3[2])];
      const ru = Math.max(0.002, LS.upperR * hu * taper * (1 - conv) * (1 + 0.2 * clamp(od.upperLipVolume))), rl = Math.max(0.002, LS.lowerR * hl * taper * (1 - conv) * (1 + 0.2 * clamp(od.lowerLipVolume)));
      const nu = nearN(N, pu.i), nl = nearN(N, pl.i);
      up.push({ c: conv3([pu.p[0] - nu[0] * (1 - LS.upperOut) * ru, pu.p[1] - nu[1] * (1 - LS.upperOut) * ru, pu.p[2] - nu[2] * (1 - LS.upperOut) * ru]), r: ru });
      lo.push({ c: conv3([pl.p[0] - nl[0] * (1 - LS.lowerOut) * rl, pl.p[1] - nl[1] * (1 - LS.lowerOut) * rl, pl.p[2] - nl[2] * (1 - LS.lowerOut) * rl]), r: rl }); }
    const chain = (pts) => { const pr = []; for (let k = 0; k + 1 < pts.length; k++) pr.push({ t: "c", a: pts[k].c, b: pts[k + 1].c, ra: pts[k].r, rb: pts[k + 1].r }); return pr; };
    // the working region and the blend come FROM THE LIP VOLUMES (FC-LIP-REGION-CUTOFF, learned in surface QA: a fixed ±0.75 mouth-half-width box cut
    // a full lower lip's volume off in a ledge; a fixed blend radius undercut full lips) — region = volume extent + margin, blend ∝ lip radius
    const allL = [...up, ...lo], rMax = Math.max(...allL.map((q) => q.r)), kLip = Math.max(LS.k * IOD, 0.35 * rMax), yLo = Math.min(...allL.map((q) => q.c[1] - q.r)) - 3 * kLip, yHi = Math.max(...allL.map((q) => q.c[1] + q.r)) + 3 * kLip, xLo = Math.min(...allL.map((q) => q.c[0] - q.r)) - 3 * kLip, xHi = Math.max(...allL.map((q) => q.c[0] + q.r)) + 3 * kLip;
    const mid = [(c3[0] + c4[0]) / 2, (c3[1] + c4[1]) / 2, (c3[2] + c4[2]) / 2], mhw = len(sub(c3, c4)) / 2, mv = F.filter((i) => { const p = at(i); return p[0] > xLo && p[0] < xHi && p[1] > yLo && p[1] < yHi; });   /* LATERAL bounds too (FC-LIP-REGION-CUTOFF: a fixed ±1.35 half-width box cut the volume at the corners → a wavy mouth-to-cheek crease) */
    const Yl0 = Float32Array.from(Y);
    log.lips = { add: sdfAlongNormals(Y, N, mv, [...chain(up), ...chain(lo)], kLip, "add", gain, hd.nb, 0.05, 6), kLip: +kLip.toFixed(4) };
    // MODULE FOOTPRINT (FC-MODULE-FOOTPRINT, learned: a lip volume grown along a malformed outline end leaked a ridge from the mouth corner into the
    // cheek — a soft form no edge-angle test sees): the lip displacement must stay inside the MEASURED mouth region (corners + lip heights) + blend
    { const hU = Math.max(...up.map((q) => q.r)) * 3 + 3 * kLip, hL = Math.max(...lo.map((q) => q.r)) * 3 + 3 * kLip, aX = mhw + 3 * kLip; let leak = 0, nLeak = 0;
      for (let i = 0; i < n; i++) { const dz = Math.hypot(Y[i * 3] - Yl0[i * 3], Y[i * 3 + 1] - Yl0[i * 3 + 1], Y[i * 3 + 2] - Yl0[i * 3 + 2]); if (dz < 1e-6) continue; const dx = (Y[i * 3] - mid[0]) / aX, dy = Y[i * 3 + 1] - mid[1], e2 = dx * dx + (dy / (dy > 0 ? hU : hL)) ** 2; if (e2 > 1) { leak = Math.max(leak, dz); nLeak++; } }
      // LIP ENDS invariant (FC-LIP-END-SPIKE regression check): end tubes thin and on the measured corners
      { const rM = Math.max(...allL.map((q) => q.r)), ends = [up[0], lo[0], up[up.length - 1], lo[lo.length - 1]], cr = [c3, c3, c4, c4];
        log.lipEnds = { endRadiusRatio: +(Math.max(0, Math.max(...ends.map((q) => q.r)) - 0.002) / Math.max(1e-6, rM - 0.002)).toFixed(3),   /* volume ABOVE the 2 mm floor (thin lips sit at the floor everywhere) */ endOffset_mouthW: +(Math.max(...ends.map((q, j) => Math.hypot(q.c[0] - cr[j][0], q.c[1] - cr[j][1]))) / (2 * mhw)).toFixed(3) }; }
      log.lips.footprint = { leakMax_IOD: +(leak / IOD).toFixed(4), leakVerts: nLeak, region: { aX: +aX.toFixed(4), hU: +hU.toFixed(4), hL: +hL.toFixed(4) } }; }   // relaxed ×6: soft lip-volume edges (surface QA)
    // seam groove + commissure pits on the NEW surface (re-sampled)
    N = vertexNormals(Y, hd.I); const seam3 = seam.map((q) => { const s = to3D(q, F, Q, Y), nn = nearN(N, s.i); return { c: [s.p[0] - nn[0] * 0.3 * LS.seamR * IOD, s.p[1] - nn[1] * 0.3 * LS.seamR * IOD, s.p[2] - nn[2] * 0.3 * LS.seamR * IOD], r: LS.seamR * IOD }; });
    for (const k of [0, K - 1]) seam3[k].r *= 0.6;
    const pits = [ctx.mouth.cR, ctx.mouth.cL].map((q) => { const s = to3D(q, F, Q, Y), nn = nearN(N, s.i), r = LS.cornerR * IOD; return { t: "s", c: [s.p[0] - nn[0] * 0.3 * r, s.p[1] - nn[1] * 0.3 * r, s.p[2] - nn[2] * 0.3 * r], r }; });
    log.lips.seam = sdfAlongNormals(Y, N, mv, [...chain(seam3), ...pits], LS.seamK * IOD, "carve", gain, hd.nb, 0.05, 1, false, DESIGNED); }
  nanCk("afterLips");
  // ---- 4. CHIN PAD: one smooth height bump at the identity chin (width/projection from the person + basis drives) ----
  // CHIN MASS sized by the PERSON (FC-CHIN-COMPRESSED, learned): the pad spans this face's own chin height (lower-lip bottom → menton)
  // and width (current silhouette at the chin level); projection is the style constant × the Stage 0 chin drive; depth only
  // (FC-CHIN-PAD-RIDGE, learned: a separate height bump on the chin read as a raised ridge across the chin bottom — the chin's mass is the traced outline +
  // the calibrated volume basis; the pad stays only on the diagnostic path)
  N = vertexNormals(Y, hd.I); if (process.env.HB_DIAG_LEGACY_CHINPAD) { const CS = STYLE.chin, ch = at(TL.chin), cn = nearN(N, TL.chin), lb = ctx.mouth ? to3D(ctx.mouth.lower.reduce((a2, q) => (q[1] > a2[1] ? q : a2)), F, Q, Y).p : [ch[0], ch[1] + 0.06, ch[2]];
    let lo2 = Infinity, hi2 = -Infinity; const yc = ch[1] + 0.2 * (lb[1] - ch[1]); for (let i = 0; i < n; i++) { if (Math.abs(Y[i * 3 + 1] - yc) > 0.004 || Y[i * 3 + 2] < ch[2] - 0.12) continue; lo2 = Math.min(lo2, Y[i * 3]); hi2 = Math.max(hi2, Y[i * 3]); }
    const span = Math.max(0.02, lb[1] - ch[1]), rx = Number.isFinite(hi2 - lo2) ? 0.42 * (hi2 - lo2) : CS.padR * IOD, R3 = [rx, 0.55 * span, 0.7 * rx], out = CS.padOut * R3[2] * (1 + 0.3 * clamp(od.chinProjection));
    const cy = ch[1] + 0.45 * span, c = [ch[0] - cn[0] * (R3[2] - out), cy, ch[2] - cn[2] * (R3[2] - out)], rr = Math.max(...R3), cv = F.filter((i) => len(sub(at(i), [ch[0], cy, ch[2]])) < 2.2 * rr);
    // SMOOTH HEIGHT BUMP (FC-CHIN-RIM-CLIFF, learned: an ellipsoid union solved as a height field drops from ~2 cm to 0 at the ellipsoid
    // rim → a jagged ridge across the chin bottom): Δz = out · (1 − q²)² over the same person-sized ellipse (zero slope at its edge),
    // faded by DEPTH behind the chin front (FC-CHIN-EDGE-CREASE, learned: a facing-based fade left a sharp overhang where the chin turns under) and only on
    // back-facing surface (FC-DEPTH-SHEAR). Depth only — the outline stays the proportion solve's.
    log.chin = { ...heightForm(Y, cv, (i) => { const q2 = ((Y[i * 3] - ch[0]) / R3[0]) ** 2 + ((Y[i * 3 + 1] - cy) / R3[1]) ** 2; return q2 >= 1 ? 0 : gain * out * (1 - q2) ** 2 * sm(Y[i * 3 + 2], ch[2] - 1.6 * R3[2], ch[2] - 0.3 * R3[2]) * sm(N[i * 3 + 2], -0.5, -0.1); }, hd.nb, 8), out: +out.toFixed(4), R: R3.map((v) => +v.toFixed(4)) }; void c; }
  nanCk("afterChin"); if (Object.values(nanAt).some((c) => c > 0)) throw new Error(`feature modules produced non-finite vertices ${JSON.stringify(nanAt)} — fail closed`);
  { const hist = {}; const names = Object.fromEntries(Object.entries(R).map(([k, v]) => [v, k])); for (let t = 0; t < hd.I.length / 3; t++) { const a = hd.I[t * 3], b = hd.I[t * 3 + 1], c = hd.I[t * 3 + 2];
      const n1 = triN(hd.P, a, b, c), n2 = triN(Y, a, b, c); if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < 0) { const k = names[hd.region[a]]; hist[k] = (hist[k] ?? 0) + 1; } } log.foldTrisByRegion = hist; }
  log.designed = [...DESIGNED].sort((a2, b2) => a2 - b2);
  return { X: Y, balls, log, zOnly };
}
const triN = (P, a, b, c) => { const u = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], v = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]]; return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; };

/** neutral eyeball spheres (UV spheres, outward normals) — geometry only, no iris/texture */
export function eyeballMesh(balls, seg = 40, rings = 28) { const P = [], I = [], Nn = [];
  for (const b of balls) { const o = P.length / 3; for (let a = 0; a <= rings; a++) { const th = (a / rings) * Math.PI; for (let k = 0; k <= seg; k++) { const ph = (k / seg) * 2 * Math.PI, d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; P.push(b.c[0] + b.r * d[0], b.c[1] + b.r * d[1], b.c[2] + b.r * d[2]); Nn.push(...d); } }
    for (let a = 0; a < rings; a++) for (let k = 0; k < seg; k++) { const i0 = o + a * (seg + 1) + k, i1 = i0 + seg + 1; if (a > 0) I.push(i0, i0 + 1, i1); if (a < rings - 1) I.push(i0 + 1, i1 + 1, i1); } }
  return { P: Float32Array.from(P), N: Float32Array.from(Nn), I }; }
