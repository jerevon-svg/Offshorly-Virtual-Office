// v3/stage1/mouth.mjs — TRACED MOUTH → CLOSED-SMILE SPEC (Stage 1 proof expression: a gentle closed-mouth smile, no teeth).
// What the reference shows decides what is traced (provenance on every value):
//   line   the mouth is drawn as one line → that line IS the seam (corners, width, curvature traced); lip thickness not drawn → population lips
//   lips   closed lips drawn → seam = the lips' midline (traced curvature), lip thickness traced; the upper/lower split is not drawn → style split
//   open   a grin with teeth → corners + width traced; a CLOSED seam is not drawn → the person's upper-lip line curvature or the population's
//          closed-smile curvature, whichever smiles more; lip thickness → population lips
// The seam is ONE smooth curve through the traced corners: o(s) = A·b + C·b² + D·b·(2s−1), b = 4s(1−s) (sag, flat-bottom, lopsided terms) — a
// drawn line's wiggle or an open mouth's V never becomes the seam (FC-SEAM-CHEVRON, learned: the midline of an open grin made a V-shaped seam).
export const MOUTH = { lineMaxH: 0.08, teethWhite: 0.15, upperShare: 0.45 };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const inPoly = (q, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
/** chord frame of a mouth: s along the corner chord (0 at cornerR), o perpendicular / width (positive = image-down, toward the lower lip) */
export function chordFrame(m) { const c = m.cornerR, d = m.cornerL, W = dist(c, d), ux = (d[0] - c[0]) / W, uy = (d[1] - c[1]) / W;
  return { W, to: (p) => [((p[0] - c[0]) * ux + (p[1] - c[1]) * uy) / W, (-(p[0] - c[0]) * uy + (p[1] - c[1]) * ux) / W], from: (s, o) => [c[0] + W * (s * ux - o * uy), c[1] + W * (s * uy + o * ux)] }; }
/** least-squares smooth seam curve o(s) through the corners from sample points (chord coords) */
export function fitSeam(pts) { const rows = pts.filter(([s]) => s > 0.02 && s < 0.98).map(([s, o]) => { const b = 4 * s * (1 - s); return [b, b * b, b * (2 * s - 1), o]; });
  if (rows.length < 3) return null; const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0], lam = 1e-3; for (const r of rows) for (let i = 0; i < 3; i++) { y[i] += r[i] * r[3]; for (let j = 0; j < 3; j++) A[i][j] += r[i] * r[j]; } for (let i = 0; i < 3; i++) A[i][i] += lam;
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]), D = det(A);
  const sol = [0, 1, 2].map((k) => det(A.map((r, i) => r.map((v, j) => (j === k ? y[i] : v)))) / D); return { A: sol[0], C: sol[1], D: sol[2], o: (s) => { const b = 4 * s * (1 - s); return sol[0] * b + sol[1] * b * b + sol[2] * b * (2 * s - 1); } }; }
/** which kind of mouth the reference DRAWS (outline + interior pixels, Stage 0 pixel coords) */
export function classifyMouth(m, pixAt) { const W = dist(m.cornerR, m.cornerL), h = Math.max(...m.lower.map((q, i) => q[1] - m.upper[i][1])) / W; if (h < MOUTH.lineMaxH) return { kind: "line", h };
  const poly = [...m.upper, ...m.lower.slice().reverse()], xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]); let n = 0, white = 0;
  for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++) for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) { if (!inPoly([x, y], poly)) continue; const [r, g, b] = pixAt(x, y); n++; if ((r + g + b) / 3 > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 40) white++; }
  const wf = n ? white / n : 0; return { kind: wf >= MOUTH.teethWhite ? "open" : "lips", h, white: +wf.toFixed(3) }; }
/** the closed-smile spec in the mouth's own coords: seam polyline (corner→corner), lip heights along it, provenance */
export function smileSpec(m, kind, prior, nS = 33) { const F = chordFrame(m), mid = m.upper.map((q, i) => F.to([(q[0] + m.lower[i][0]) / 2, (q[1] + m.lower[i][1]) / 2])), up = m.upper.map(F.to);
  let fit, sagSrc; if (kind === "open") { const fu = fitSeam(up), aP = prior.sag; fit = fu && fu.A > aP ? fu : { A: aP, C: 0, D: 0, o: (s) => aP * 4 * s * (1 - s) }; sagSrc = fu && fu.A > aP ? "traced (upper lip line)" : "population closed smile (seam not drawn)"; }
  else { fit = fitSeam(mid) ?? { A: prior.sag, C: 0, D: 0, o: (s) => prior.sag * 4 * s * (1 - s) }; sagSrc = "traced"; }
  const seam = [], hU = [], hL = []; const tot = (s) => { if (kind !== "lips") return prior.lipsH; let a = 0, w = 0; m.upper.forEach((q, i) => { const sU = F.to(q)[0], ww = Math.exp(-0.5 * ((sU - s) / 0.08) ** 2); a += ww * (m.lower[i][1] - q[1]) / F.W; w += ww; }); return w ? a / w : prior.lipsH; };
  for (let k = 0; k < nS; k++) { const s = k / (nS - 1), tp = Math.sin(Math.PI * s) ** 0.5, t = tot(s); seam.push(F.from(s, fit.o(s))); hU.push(MOUTH.upperShare * t * F.W * tp); hL.push((1 - MOUTH.upperShare) * t * F.W * tp); }
  return { kind, seam, hU, hL, sag: { A: +fit.A.toFixed(4), C: +(fit.C ?? 0).toFixed(4), D: +(fit.D ?? 0).toFixed(4), src: sagSrc }, lipHeight: kind === "lips" ? "traced (split: style)" : "population closed lips", width: +F.W.toFixed(4) }; }
/** population calibration (calibrate-proportions): closed-smile sag of line mouths + drawn closed-lip height (median), / mouth width */
export function smilePrior(POP) { const sag = [], lh = []; for (const p of Object.values(POP)) { const m = p.mouth; if (!m?.found) continue; const F = chordFrame(m), h = Math.max(...m.lower.map((q, i) => q[1] - m.upper[i][1])) / F.W, mid = m.upper.map((q, i) => F.to([(q[0] + m.lower[i][0]) / 2, (q[1] + m.lower[i][1]) / 2]));
    if (h < MOUTH.lineMaxH) { const f = fitSeam(mid); if (f) sag.push(f.A); } }
  // drawn closed lips: interior is lip colour, not teeth — classified upstream; here: plausible lip heights (0.12–0.6 W) among non-line mouths without teeth flag
  for (const p of Object.values(POP)) { const m = p.mouth; if (!m?.found || p.__mouthKind !== "lips") continue; const F = chordFrame(m); const k = m.upper.length >> 1; lh.push((m.lower[k][1] - m.upper[k][1]) / F.W); }
  const med = (v) => { const a = v.slice().sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
  return { sag: med(sag), nSag: sag.length, lipsH: med(lh), nLips: lh.length }; }
