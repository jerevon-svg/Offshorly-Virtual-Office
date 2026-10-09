// v3/stage1/sculpt.mjs — PARAMETRIC SCULPTURE BASIS (generalized; the mechanism employee #100 uses).
// Each OPERATOR is one semantic sculptural dimension: a smooth geometric operation (translate / scale / rotate / inflate)
// inside an anatomical region located from the mesh's OWN landmark vertices (face units fu = inter-eye distance), so the
// same definition works on any head built on the canonical topology.
//   amplitude  = the approved HumanBase heads' own spread along that operator (each dense approved fit projected onto the
//                operator field around the approved mean) → 1 population-σ of identity = 1 approved-σ of sculpture
//   drive      = a fixed linear map of Stage 0 population z-scores (OBSERVED dims map their own measurement; INFERRED dims
//                use general anthropometric / style relationships) — never a name, never a per-person value
//   envelope   = |drive| ≤ 2 and per-kind amplitude caps (identity reaches the approved family's range, not beyond)
import { vertexNormals } from "../geom.mjs";

const sm = (t, a, b) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
/** anatomical anchor points on a head X (canonical topology) — from landmark vertex ids + face-unit offsets */
export function anchors(X, tpl) {
  const TL = tpl.landmarks, at = (i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], eL = at(TL.eyeL), eR = at(TL.eyeR), fu = Math.abs(eR[0] - eL[0]);
  const front = (x, y) => { let b = null; for (let i = 0; i < tpl.n; i++) { if (Math.abs(X[i * 3] - x) > 0.01 || Math.abs(X[i * 3 + 1] - y) > 0.01) continue; if (!b || X[i * 3 + 2] > b[2]) b = at(i); } return b ?? [x, y, 0.3]; };
  const eyeY = (eL[1] + eR[1]) / 2, ex = Math.abs(eR[0]), nose = at(TL.noseTip), mouth = at(TL.mouth), chin = at(TL.chin);
  return { fu, eyeY, ex, eL, eR, nose, mouth, chin, root: front(0, eyeY - 0.06 * fu), bridge: front(0, (eyeY + nose[1]) / 2 - 0.05 * fu), alar: [0.17 * fu, nose[1] - 0.04 * fu],
    cheekbone: [0.72 * fu, eyeY - 0.32 * fu], cheek: [0.6 * fu, mouth[1] + 0.12 * fu], jaw: at(TL.jawR), temple: at(TL.templeR), forehead: at(TL.forehead) };
}
// operator table: [name, kind, centre(A) → [x, y] (sym: right-side x, mirrored), σx, σy (fu), sym, frontMin]
// kinds: tz (depth), ty (height), txo (outward x, mirrored), sx (scale x about centre/midline), sy (scale y about centre),
//        rot (rotate in the face plane about centre, mirrored), inf (inflate along the normal)
export const OPS = [
  ["noseRootDepth", "tz", (A) => [0, A.root[1]], 0.13, 0.12, false],
  ["noseBridgeHeight", "tz", (A) => [0, A.bridge[1]], 0.09, 0.2, false],
  ["noseBridgeWidth", "sx0", (A) => [0, A.bridge[1]], 0.16, 0.2, false],
  ["noseTipProjection", "tz", (A) => [0, A.nose[1]], 0.12, 0.1, false],
  ["noseTipWidth", "sx0", (A) => [0, A.nose[1]], 0.13, 0.09, false],
  ["noseTipRoundness", "inf", (A) => [0, A.nose[1]], 0.09, 0.08, false],
  ["noseAlarWidth", "sx0", (A) => [A.alar[0], A.alar[1]], 0.1, 0.08, true],
  ["eyeWidth", "sx", (A) => [A.ex, A.eyeY], 0.24, 0.13, true],
  ["eyeOpenness", "sy", (A) => [A.ex, A.eyeY], 0.22, 0.13, true],
  ["eyeTilt", "rot", (A) => [A.ex, A.eyeY], 0.24, 0.14, true],
  ["eyeInnerCorner", "txo", (A) => [A.ex - 0.27 * A.fu, A.eyeY], 0.09, 0.09, true],
  ["eyeSocketDepth", "tz", (A) => [A.ex, A.eyeY], 0.24, 0.16, true],
  ["upperLidFullness", "inf", (A) => [A.ex, A.eyeY + 0.13 * A.fu], 0.22, 0.07, true],
  ["underEyeFullness", "inf", (A) => [A.ex, A.eyeY - 0.24 * A.fu], 0.22, 0.09, true],
  ["browRidgeProminence", "tz", (A) => [A.ex * 0.85, A.eyeY + 0.36 * A.fu], 0.3, 0.1, true],
  ["browRidgeHeight", "ty", (A) => [A.ex * 0.85, A.eyeY + 0.36 * A.fu], 0.3, 0.12, true],
  ["foreheadFullness", "tz", (A) => [0, A.forehead[1]], 0.6, 0.3, false],
  ["templeVolume", "inf", (A) => [Math.abs(A.temple[0]), A.temple[1]], 0.18, 0.2, true, -0.35],
  ["cheekboneWidth", "sx0", (A) => [A.cheekbone[0], A.cheekbone[1]], 0.25, 0.18, true, -0.2],
  ["cheekboneProjection", "inf", (A) => [A.cheekbone[0], A.cheekbone[1]], 0.22, 0.16, true],
  ["cheekFullness", "inf", (A) => [A.cheek[0], A.cheek[1]], 0.25, 0.22, true],
  ["midfaceProjection", "tz", (A) => [0, (A.eyeY + A.mouth[1]) / 2], 0.45, 0.3, false],
  ["mouthWidth", "sx0", (A) => [0, A.mouth[1]], 0.38, 0.12, false],
  ["upperLipVolume", "inf", (A) => [0, A.mouth[1] + 0.07 * A.fu], 0.25, 0.06, false],
  ["lowerLipVolume", "inf", (A) => [0, A.mouth[1] - 0.08 * A.fu], 0.22, 0.06, false],
  ["muzzleProjection", "tz", (A) => [0, A.mouth[1]], 0.38, 0.2, false],
  ["jawWidth", "sx0", (A) => [Math.abs(A.jaw[0]), A.jaw[1]], 0.25, 0.25, true, -0.4],
  ["jawAngleHeight", "ty", (A) => [Math.abs(A.jaw[0]), A.jaw[1]], 0.22, 0.2, true, -0.4],
  ["chinWidth", "sx0", (A) => [0, A.chin[1]], 0.22, 0.16, false, -0.3],
  ["chinProjection", "tz", (A) => [0, A.chin[1]], 0.2, 0.16, false, -0.3],
];
/** displacement field of operator op at unit parameter on head X (normals N), ear taper w ∈ [0,1] */
export function opField(op, X, N, tpl, A, taper) {
  const [, kind, cf, sxu, syu, sym, fmin = -0.05] = op, [cx, cy] = cf(A), sx = sxu * A.fu, sy = syu * A.fu, D = new Float32Array(X.length);
  for (let i = 0; i < tpl.n; i++) { const x = X[i * 3], y = X[i * 3 + 1], side = x >= 0 ? 1 : -1, ccx = sym ? side * cx : cx, dx = (x - ccx) / sx, dy = (y - cy) / sy, g = Math.exp(-0.5 * (dx * dx + dy * dy));
    if (g < 1e-4) continue; const m = g * sm(N[i * 3 + 2], fmin, fmin + 0.45) * (taper ? taper[i] : 1); if (m < 1e-5) continue;
    let d = [0, 0, 0];
    if (kind === "tz") d = [0, 0, A.fu * m]; else if (kind === "ty") d = [0, A.fu * m, 0]; else if (kind === "txo") d = [side * A.fu * m, 0, 0];
    else if (kind === "sx") d = [(x - ccx) * m, 0, 0]; else if (kind === "sx0") d = [x * m, 0, 0]; else if (kind === "sy") d = [0, (y - cy) * m, 0];
    else if (kind === "rot") { const th = side * -1 * m; d = [-(y - cy) * th, (x - ccx) * th, 0]; }   // + = outer corner up on both sides
    else if (kind === "inf") d = [N[i * 3] * A.fu * m, N[i * 3 + 1] * A.fu * m, N[i * 3 + 2] * A.fu * m];
    D[i * 3] = d[0]; D[i * 3 + 1] = d[1]; D[i * 3 + 2] = d[2]; }
  return D;
}
/** approved spread per operator: each approved fit projected onto the operator field around the approved mean */
export function calibrate(tpl, mean, fits) {
  const N = vertexNormals(mean, tpl.I), A = anchors(mean, tpl), out = {};
  for (const op of OPS) { const F = opField(op, mean, N, tpl, A, null); let ff = 0; for (let i = 0; i < F.length; i++) ff += F[i] * F[i];
    const c = fits.map((X) => { let a = 0; for (let i = 0; i < F.length; i++) if (F[i]) a += (X[i] - mean[i]) * F[i]; return ff ? a / ff : 0; });
    const m = c.reduce((a, b) => a + b, 0) / c.length, sd = Math.sqrt(c.reduce((a, b) => a + (b - m) ** 2, 0) / c.length); out[op[0]] = { sd, perHead: c.map((v) => +v.toFixed(4)) }; }
  // floor: no operator may be calibrated to (near-)zero range — at least 40% of the median spread of its kind
  const byKind = {}; for (const op of OPS) (byKind[op[1]] ??= []).push(out[op[0]].sd);
  // cap: registration noise between approved fits inflates some spreads — per-σ amplitude ≤ a sane sculptural step per kind
  const CAP = { tz: 0.05, ty: 0.05, txo: 0.05, inf: 0.05, sx: 0.1, sx0: 0.1, sy: 0.1, rot: 0.08 };
  for (const op of OPS) { const v = byKind[op[1]].slice().sort((a, b) => a - b), med = v[v.length >> 1]; out[op[0]].amp = Math.min(CAP[op[1]], Math.max(out[op[0]].sd, 0.4 * med)); }
  return out;
}
/** drives (z units) per operator from Stage 0 z-scores — OBSERVED dims use their own measurement, INFERRED use relations */
export function opDrives(z) {
  const browRidge = -z.browGap + 0.3 * z.browThick;
  return {
    noseRootDepth: 0.6 * browRidge - 0.4 * z.noseLen, noseBridgeHeight: 0.6 * z.noseLen - 0.4 * z.noseW + 0.3 * z.aspect, noseBridgeWidth: 0.7 * z.noseW,
    noseTipProjection: 0.5 * z.noseLen - 0.3 * z.noseW + 0.3 * z.aspect, noseTipWidth: 0.8 * z.noseW, noseTipRoundness: 0.6 * z.noseW - 0.4 * z.noseLen, noseAlarWidth: z.noseW,
    eyeWidth: z.eyeW, eyeOpenness: z.eyeOpen, eyeTilt: z.eyeTilt, eyeInnerCorner: z.innerGap, eyeSocketDepth: -(0.6 * browRidge - 0.4 * z.eyeOpen),
    upperLidFullness: 0.5 * z.browGap - 0.3 * z.eyeOpen, underEyeFullness: 0.5 * z.cheekBulge - 0.3 * z.aspect,
    browRidgeProminence: browRidge, browRidgeHeight: z.browGap, foreheadFullness: 0.3 * z.foreheadH, templeVolume: z.templeW,
    cheekboneWidth: 0.5 * z.angular, cheekboneProjection: 0.7 * z.angular + 0.3 * z.aspect, cheekFullness: z.cheekBulge - 0.4 * z.aspect, midfaceProjection: z.aspect,
    mouthWidth: z.mouthW, upperLipVolume: z.upperLip, lowerLipVolume: z.lowerLip, muzzleProjection: 0.5 * z.lipH + 0.3 * z.mouthW + 0.2 * z.lowerLen,
    jawWidth: 0.5 * z.jawW, jawAngleHeight: -0.5 * z.jawW - 0.3 * z.chinPoint, chinWidth: z.chinPoint, chinProjection: 0.6 * z.chinLen - 0.4 * z.chinPoint,
  };
}
export const OBSERVED_OPS = new Set(["noseBridgeWidth", "noseTipWidth", "noseAlarWidth", "eyeWidth", "eyeOpenness", "eyeTilt", "eyeInnerCorner", "browRidgeHeight", "templeVolume", "mouthWidth", "upperLipVolume", "lowerLipVolume", "chinWidth"]);
/** apply the full basis: Σ_k clamp(drive_k, ±2.5) · amp_k · φ_k(X) (fields evaluated on the current head, sequentially) */
export function applyBasis(X, tpl, drv, cal, taper, gain = 1, opts = {}) {
  const Y = Float32Array.from(X), log = {};
  for (const op of OPS) { const k = op[0], d = Math.max(-2, Math.min(2, drv[k] ?? 0)); let p = gain * d * cal[k].amp;
    // identity layout owns IN-PLANE placement (measured); the basis keeps depth/volume only (FC-INPLANE-DOUBLE-COUNT)
    if (opts.volumeOnly && op[1] !== "tz" && op[1] !== "inf") { log[k] = { drive: +d.toFixed(2), param: 0, skipped: "in-plane (layout owns it)" }; continue; }
    // FC-DEFLATE-GASH (learned): removing volume along the normal deepens existing creases into gashes — deflation is
    // limited to half the inflation range (a thin trait thins a form; it never carves into it)
    if (op[1] === "inf" && p < 0) p *= 0.5;
    log[k] = { drive: +d.toFixed(2), param: +p.toFixed(4) }; if (!p) continue;
    const N = vertexNormals(Y, tpl.I), A = anchors(Y, tpl), F = opField(op, Y, N, tpl, A, taper);
    // FORM never moves PROPORTION (FC-FORM-MOVES-OUTLINE): with the identity layout, volume acts in DEPTH only, so the front-view layout/outline is untouched
    if (opts.volumeOnly) for (let i = 0; i < F.length; i += 3) { F[i] = 0; F[i + 1] = 0; }
    for (let i = 0; i < Y.length; i++) Y[i] += p * F[i]; }
  // FC-OPERATOR-RIPPLE (learned): overlapping opposite-sign operators leave small-scale ripples — the SUMMED displacement
  // (never the shape) is relaxed briefly; the operators themselves are broad, so their forms survive
  { const D = new Float32Array(Y.length); for (let i = 0; i < Y.length; i++) D[i] = Y[i] - X[i];
    for (let it = 0; it < 6; it++) { const T = D.slice(); for (let i = 0; i < tpl.n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb) a += T[j * 3 + q]; D[i * 3 + q] = 0.5 * T[i * 3 + q] + 0.5 * a / nb.length; } } }
    for (let i = 0; i < Y.length; i++) Y[i] = X[i] + D[i]; }
  return { X: Y, log };
}
