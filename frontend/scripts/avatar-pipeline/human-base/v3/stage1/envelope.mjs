// v3/stage1/envelope.mjs — FACE SHAPE COMPLETION. Occlusion is missing EVIDENCE, not missing ANATOMY.
// The face boundary is solved as ONE smooth, symmetric half-width profile w(t) over the face height (t = 0 eye line, t = 1 chin),
// using every constraint at once:
//   data       visible edges (OBSERVED), the opposite side (MIRRORED via the symmetric profile), hair beside the jaw (probable)
//   bounds     hair occlusion: the skin/hair boundary is a LOWER bound (the face continues under the hair), the outer hair
//              silhouette an UPPER bound — hair is never face geometry
//   smoothness curvature penalty: neighbouring levels must form one coherent shape (no isolated per-level widths)
//   prior      a human face-shape prior (population median profile, style-base shape where the population is blind),
//              SCALED TO THIS PERSON'S OWN VISIBLE EVIDENCE — a narrow face completes narrow, a broad face completes broad
// Every level carries a provenance class: OBSERVED · MIRRORED · CONSTRAINED · INFERRED · STYLE_PRIOR.
export const T_GRID = Array.from({ length: 69 }, (_, i) => -0.7 + i * 0.025);
const RELIABLE = new Set(["visible", "stroke-over-ear", "stroke-over-neck", "edge-over-neck", "scalp-silhouette"]), BOUND = new Set(["hair-bounded", "feature-at-edge"]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
function crossings(ct, y, midX) { const L = [], R = []; for (let i = 0; i < ct.length; i++) { const a = ct[i], b = ct[(i + 1) % ct.length]; if ((a.pt[1] - y) * (b.pt[1] - y) > 0 || a.pt[1] === b.pt[1]) continue;
    const x = a.pt[0] + ((y - a.pt[1]) / (b.pt[1] - a.pt[1])) * (b.pt[0] - a.pt[0]), labs = [a.label, b.label], cls = labs.every((l) => RELIABLE.has(l)) ? "reliable" : labs.some((l) => !RELIABLE.has(l) && !BOUND.has(l)) ? "unreliable" : "bound"; (x < midX ? L : R).push({ x, cls }); }
  const far = (arr, f) => (arr.length ? arr.reduce((u, v) => (f(v.x, u.x) ? v : u)) : null); return { L: far(L, (p, q) => p < q), R: far(R, (p, q) => p > q) }; }
/** the frame used by every level: eye line, chin, midline, IOD, mouth/nose levels (Stage 0 px, y down) */
export function faceFrame(p) { const e = p.eyes, cR = mid(e.R.inner, e.R.outer), cL = mid(e.L.inner, e.L.outer), eyeY = (cR[1] + cL[1]) / 2, iod = Math.hypot(cR[0] - cL[0], cR[1] - cL[1]);
  const mouthC = [(p.mouth.cornerR[0] + p.mouth.cornerL[0]) / 2, (Math.min(...p.mouth.upper.map((q) => q[1])) + Math.max(...p.mouth.lower.map((q) => q[1]))) / 2];
  const midX = ((cR[0] + cL[0]) / 2 + (p.nose.found ? p.nose.base[0] : mouthC[0]) + mouthC[0]) / 3; let chinY = -Infinity;
  for (let i = 0; i < p.contour.length; i++) { const a = p.contour[i].pt, b = p.contour[(i + 1) % p.contour.length].pt; if ((a[0] - midX) * (b[0] - midX) <= 0 && a[0] !== b[0]) chinY = Math.max(chinY, a[1] + ((midX - a[0]) / (b[0] - a[0])) * (b[1] - a[1])); }
  const H = chinY - eyeY; return { eyeY, chinY, H, midX, iod, tMouth: (mouthC[1] - eyeY) / H, tNose: p.nose.found ? (p.nose.base[1] - eyeY) / H : null, tTop: null }; }
/** per-level evidence. hairOuter(y, side) → outermost hair x on that side at row y (or null) — the occlusion UPPER bound */
export function evidence(p, fr, hairOuter = null, anat = null) { const out = [];
  // ANATOMICAL bound (FC-EYE-CONTAINMENT): the skull contains the eyes — around the eye line the face edge lies at least
  // (outer canthus + the approved heads' minimum eye-to-side margin) from the midline
  const outer = Math.max(Math.abs(p.eyes.R.outer[0] - fr.midX), Math.abs(p.eyes.L.outer[0] - fr.midX)) / fr.iod, eyeLo = anat?.eyeSideMargin != null ? outer + anat.eyeSideMargin : null;
  for (const t of T_GRID) { const y = fr.eyeY + t * fr.H, c = crossings(p.contour, y, fr.midX), s = { t, y, data: [], lo: null, hi: null, sides: {} };
    for (const [side, cr] of [["L", c.L], ["R", c.R]]) { if (!cr) continue; const w = Math.abs(cr.x - fr.midX) / fr.iod;
      // HAIR OVER THE SKULL (FC-HAIR-EDGE-AS-SKIN, learned: a hair strand's edge over the temple carried a reliable face-stroke label → "observed"
      // temples 27% narrow, a waist under the cranium): ABOVE THE EYE LINE hair lies ON the skull, so an edge with hair directly outside is where hair
      // starts covering skin — an occlusion boundary (lower bound), never the skin outline. Below the eye line hair falls BEHIND the face (kept).
      const hairOver = cr.cls === "reliable" && t < 0 && hairOuter && hairOuter(y, side, cr.x) != null;
      if (cr.cls === "reliable" && !hairOver) { s.data.push([w, 1]); s.sides[side] = { kind: "OBSERVED", w }; continue; }
      if (hairOver) { s.lo = Math.max(s.lo ?? 0, w); const hw = Math.abs(hairOuter(y, side, cr.x) - fr.midX) / fr.iod; if (hw > w) s.hi = Math.min(s.hi ?? Infinity, hw); s.sides[side] ??= { kind: "occluded", lo: w, by: "hair-over-skull" }; continue; }
      if (cr.cls === "bound") { if (t > fr.tMouth) { s.data.push([w, 0.5]); s.sides[side] = { kind: "probable", w }; }   // hair beside the jaw falls behind it
        s.lo = Math.max(s.lo ?? 0, w); const ho = hairOuter ? hairOuter(y, side, cr.x) : null; if (ho != null) { const hw = Math.abs(ho - fr.midX) / fr.iod; if (hw > w) s.hi = Math.min(s.hi ?? Infinity, hw); }
        s.sides[side] ??= { kind: "occluded", lo: w }; } }
    if (eyeLo != null && Math.abs(t) <= 0.15) { s.lo = Math.max(s.lo ?? 0, eyeLo); s.anat = true; }
    out.push(s); }
  return out; }
/** the completed envelope: solve w(t) (IOD units) — data + bounds + curvature + person-scaled shape prior */
export function completeEnvelope(p, fr, ev, priorProfile, { lamS = 40, lamP = 0.08, iters = 4000 } = {}) { const n = T_GRID.length, pr = priorProfile;
  // the prior is SCALED to the person by their own evidence (data + lower bounds where the face must be at least that wide)
  let a = 0, b = 0; ev.forEach((s, i) => { for (const [d, wgt] of s.data) { a += wgt * d * pr[i]; b += wgt * pr[i] * pr[i]; } }); const scale = b > 0 ? a / b : 1;
  const w = T_GRID.map((_, i) => scale * pr[i]); for (let it = 0; it < iters; it++) for (let i = 0; i < n; i++) { const s = ev[i]; let num = lamP * scale * pr[i], den = lamP;
      for (const [d, wgt] of s.data) { num += wgt * d; den += wgt; }
      // curvature energy Σ (w[k-1] − 2w[k] + w[k+1])² — Gauss–Seidel row for w[i] (ends use the available neighbours)
      const g = (k) => (k >= 0 && k < n ? w[k] : null), rows = [[i - 1, 1], [i, -2], [i + 1, 1]];
      for (const cIdx of [i - 1, i, i + 1]) { if (cIdx - 1 < 0 || cIdx + 1 >= n) continue; const coef = cIdx === i ? -2 : 1; let rest = 0; for (const [k, c] of [[cIdx - 1, 1], [cIdx, -2], [cIdx + 1, 1]]) if (k !== i) rest += c * g(k); num -= lamS * coef * rest; den += lamS * coef * coef; }
      let v = num / den; if (s.lo != null) v = Math.max(v, s.lo); if (s.hi != null) v = Math.min(v, s.hi); w[i] = Math.max(0, v); }
  // provenance per level
  const has = ev.map((s) => s.data.length > 0 || s.lo != null), first = has.indexOf(true), last = has.lastIndexOf(true);
  const cls = ev.map((s, i) => { if (s.sides.L?.kind === "OBSERVED" || s.sides.R?.kind === "OBSERVED") return s.sides.L?.kind === "OBSERVED" && s.sides.R?.kind === "OBSERVED" ? "OBSERVED" : "MIRRORED";
    if (s.data.length) return "CONSTRAINED"; if (s.lo != null) return Math.abs(w[i] - s.lo) < 0.01 || (s.hi != null && Math.abs(w[i] - s.hi) < 0.01) ? "CONSTRAINED" : "INFERRED"; return i > first && i < last ? "INFERRED" : "STYLE_PRIOR"; });
  return { t: T_GRID, w, cls, scale, evidence: ev }; }
/** half-width (IOD units) + class at any t (linear interpolation on the grid) */
export function envAt(env, t) { const i = Math.max(0, Math.min(T_GRID.length - 2, Math.floor((t - T_GRID[0]) / 0.025))), f = Math.min(1, Math.max(0, (t - T_GRID[i]) / 0.025)); return { w: env.w[i] * (1 - f) + env.w[i + 1] * f, cls: f < 0.5 ? env.cls[i] : env.cls[i + 1] }; }
/** the named cross-section levels used everywhere (Stage 0, target, final 3D) */
export function namedLevels(fr) { const tM = fr.tMouth, tN = fr.tNose ?? 0.45 * tM; return { forehead: -0.45, temple: -0.3, eye: 0, cheekbone: 0.5 * tN, nose: tN, mouth: tM, jaw: tM + 0.5 * (1 - tM), chin: tM + 0.8 * (1 - tM) }; }

/** occlusion UPPER bound from the Stage 0 hair layer: from the skin/hair boundary walk outward while hair (gaps ≤ 3 px) */
export async function hairOuterFrom(maskFile, sharpLib) { const { data, info } = await sharpLib(maskFile).extractChannel(0).raw().toBuffer({ resolveWithObject: true }), W = info.width, Hh = info.height, isH = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh && data[y * W + x] > 127;
  return (y, side, x0) => { const yy = Math.round(y), dir = side === "L" ? -1 : 1; let x = Math.round(x0) + dir * 2, last = null, gap = 0; if (!isH(x, yy) && !isH(x + dir, yy) && !isH(x + 2 * dir, yy)) return null;
    while (x >= 0 && x < W) { if (isH(x, yy)) { last = x; gap = 0; } else if (++gap > 3) break; x += dir; } return last; }; }
/** shape prior on T_GRID (IOD units): population median of OBSERVED half-widths (leave-one-out), style-base shape where blind */
export function shapePrior(priorData, excludeId = null) { const { obs, style } = priorData, n = T_GRID.length, med = new Array(n).fill(null), cnt = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { const v = obs[i].filter(([id]) => id !== excludeId).map(([, w]) => w).sort((a, b) => a - b); cnt[i] = v.length; if (v.length >= 3) med[i] = v[v.length >> 1]; }
  let a = 0, b = 0; for (let i = 0; i < n; i++) if (med[i] != null && style[i] != null) { a += med[i] * style[i]; b += style[i] * style[i]; } const k = b > 0 ? a / b : 1;
  let p = med.map((v, i) => v ?? (style[i] != null ? k * style[i] : null)); for (let i = 0; i < n; i++) if (p[i] == null) p[i] = p[i - 1] ?? 0.5;
  for (let it = 0; it < 6; it++) p = p.map((v, i) => (i > 0 && i < n - 1 ? 0.25 * p[i - 1] + 0.5 * v + 0.25 * p[i + 1] : v));
  return { p, src: med.map((v) => (v != null ? "population" : "style-base")), n: cnt, styleScale: k }; }
/** one call: frame → evidence (+ hair occlusion bounds) → leave-one-out shape prior → completed envelope (+ named levels) */
export function completeFor(p, priorData, hairOuter, id, anat = null) { const fr = faceFrame(p), ev = evidence(p, fr, hairOuter, anat), pr = shapePrior(priorData, id), env = completeEnvelope(p, fr, ev, pr.p);
  return { ...env, fr, iodPx: fr.iod, levels: namedLevels(fr), prior: pr }; }
