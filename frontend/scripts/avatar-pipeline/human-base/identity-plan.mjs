// identity-plan.mjs — the PURE planning half of identity-correct.mjs (no file, model or network access, so it can be unit
// tested on its own): tolerances, the eye-spacing unit, the face-length plan, the relation-by-relation comparison and the
// width-correction plan — including the OFFSHORLY STYLE GUARDS of 2026-10-13. identity-correct.mjs re-exports all of it.
export const TOL = { width: 0.05, deadband: 0.025, feature: 0.08, maxStep: 0.25, eyeShift: 0.12 };   // relative; identity QA uses ±6% widths, ±0.06 chin, ±6% features

/** the target / current eye-spacing ratio (eye spacing : cheek width), clamped — the UNIT every relation is converted with */
export function eyeRatio(m, T) { const kI = "h.IOD_cheekW";
  return T[kI] && m[kI] && !/STYLE_PRIOR/.test(T[kI].flag ?? "") && Math.abs(T[kI].v / m[kI].v - 1) > 0.03 ? Math.min(1 + TOL.eyeShift, Math.max(1 - TOL.eyeShift, T[kI].v / m[kI].v)) : 1; }
// OFFSHORLY STYLE GUARDS (2026-10-13, from the visual regression audit — measured against the approved five, the style reference):
//   · the face is NEVER SHORTENED. Lowering chibify's face-length boost undid the long-face band and widened the face: Jona ×0.861
//     (aspect 2.07 → 2.42, past every approved head's 1.78–2.14), Nicole ×0.938 (FC-FACE-ASPECT-GROWTH fired), Bon's own photo head
//     ×0.885. The correction exists to LENGTHEN the too-wide Meshy face (Kael ×1.12); a shorter target keeps the band's length.
//   · the eyes are NEVER MOVED CLOSER. On Bon's own photo head the narrowing took eye spacing : cheek from 0.513 — his approved
//     head is 0.509 — to 0.474, away from his designer-approved likeness; on Lui (0.52 → 0.48) it read as eyes too close. The
//     ratio still converts every target (so the face keeps its absolute proportions); only the rigid move is never inward.
/** face LENGTH plan: the boost multiplier for chibify's face-length retention (face height / eye spacing → its target) */
export function planLength(m, T) { const k = "frame.faceH_IOD"; if (!T[k] || !m[k]) return { apply: false, why: "no face-height relation" }; const weak = /STYLE_PRIOR/.test(T[k].flag ?? "");
  // the eye-spacing step that follows changes the unit: plan the length for the CORRECTED eye spacing (learned on Lui: planned against the old
  // spacing, face height / eye spacing overshot +8.4% once the eyes moved in)
  const eyeK = eyeRatio(m, T), mul = (T[k].v * eyeK) / m[k].v;
  return { apply: !weak && mul - 1 > 0.04, mul: +mul.toFixed(4), eyeK: +eyeK.toFixed(4), target: T[k].v, current: m[k].v, flag: T[k].flag,
    ...(mul < 1 - 0.04 ? { why: "never shortened — a shorter face would widen it; the long-face band's length is kept" } : {}) }; }

const LEVELS = [["eye", "frame.eyeLevelW_IOD"], ["cheek", "frame.cheekW_IOD"], ["nose", "frame.noseLevelW_IOD"], ["mouth", "frame.mouthLevelW_IOD"], ["jaw", "frame.jawW_IOD"], ["chin", "frame.chinW_IOD"]];
/** relation-by-relation comparison: current vs target, error, provenance, out-of-tolerance */
export function compare(m, T) { const rows = []; const add = (k, tol) => { if (!T[k] || !m[k]) return; const err = m[k].v / T[k].v - 1, weak = /STYLE_PRIOR/.test(T[k].flag ?? ""); rows.push({ k, current: +m[k].v.toFixed(4), target: +T[k].v.toFixed(4), err: +(100 * err).toFixed(1), flag: T[k].flag, weak, out: !weak && Math.abs(err) > tol }); };
  for (const [, k] of LEVELS) add(k, TOL.width); add("frame.templeW_IOD", TOL.width); add("frame.faceH_IOD", 0.04);
  for (const k of ["frame.chinRound25", "frame.chinRound50", "frame.chinRound75"]) if (T[k] && m[k]) rows.push({ k, current: +m[k].v.toFixed(4), target: +T[k].v.toFixed(4), err: +(100 * (m[k].v - T[k].v)).toFixed(1), abs: true, flag: T[k].flag, out: Math.abs(m[k].v - T[k].v) > 0.06 });
  for (const k of Object.keys(T)) if (/^h\.|^x\.|^v\./.test(k)) add(k, TOL.feature);
  return rows; }

/** monotone cubic (Fritsch–Carlson) through (t, v) points — C1, no overshoot; constant outside */
function monoCubic(P) { const n = P.length, x = P.map((p) => p[0]), y = P.map((p) => p[1]); if (n === 1) return () => y[0]; const d = [], m = new Array(n).fill(0);
  for (let k = 0; k < n - 1; k++) d.push((y[k + 1] - y[k]) / (x[k + 1] - x[k])); m[0] = d[0]; m[n - 1] = d[n - 2]; for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) { if (d[k] === 0) { m[k] = m[k + 1] = 0; continue; } const a = m[k] / d[k], b = m[k + 1] / d[k], h = a * a + b * b; if (h > 9) { const t = 3 / Math.sqrt(h); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; } }
  return (t) => { if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1]; let k = 0; while (t > x[k + 1]) k++; const h = x[k + 1] - x[k], u = (t - x[k]) / h, h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2; return h00 * y[k] + h10 * h * m[k] + h01 * y[k + 1] + h11 * h * m[k + 1]; }; }
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the correction plan: per-level WIDTH / FACE-HEIGHT ratios (face height is the mount's size reference — a wide face is a width : height
 *  error, not an eye-spacing unit artefact), only evidence-backed targets, as one smooth lateral profile over the face height */
export function planCorrection(m, T, g3, check = {}) { const H = g3.eyeY - g3.chinY, tN = (g3.eyeY - g3.noseY) / H, tM = (g3.eyeY - g3.mouthY) / H;
  // EYE SPACING first (the unit every width is measured in): eye spacing : cheek width → its target by a RIGID move of each eye (skull-independent)
  const kI = "h.IOD_cheekW", eyeK = eyeRatio(m, T), eyeMove = Math.max(1, eyeK);   // converts with eyeK; moves the eyes outward only
  const tOf = { eye: 0, cheek: 0.5 * tN, nose: tN, mouth: tM, jaw: tM + 0.5 * (1 - tM), chin: tM + 0.8 * (1 - tM) }, pts = [[0, 1]],
    used = [["eye", 1, "LOCKED (canonical skull)"], ["eyeSpacing", +eyeMove.toFixed(4), eyeK < 1 ? `${T[kI]?.flag ?? ""} — target ${eyeK.toFixed(4)} not applied: the eyes are never moved closer`.trim() : T[kI]?.flag ?? null]];
  for (const [nm, k] of LEVELS) { if (nm === "eye" || !T[k] || !m[k] || /STYLE_PRIOR/.test(T[k].flag ?? "")) continue; if (check[nm] && !check[nm].agree) { used.push([nm, null, `UNRELIABLE measurement (fit ${check[nm].fit} vs skin ${check[nm].skin}) — not corrected`]); continue; } const r = (T[k].v * eyeK) / m[k].v; pts.push([tOf[nm], Math.min(1 + TOL.maxStep, Math.max(1 - TOL.maxStep, r))]); used.push([nm, +r.toFixed(4), T[k].flag]); }
  pts.sort((a, b) => a[0] - b[0]); const worst = Math.max(0, ...pts.map((p) => Math.abs(p[1] - 1)));
  return { apply: worst > TOL.width || eyeMove !== 1, worst: +worst.toFixed(4), H, levels: used, eyeK, eyeMove, s: pts.length ? monoCubic(pts) : () => 1, tOf }; }

export { sm };
