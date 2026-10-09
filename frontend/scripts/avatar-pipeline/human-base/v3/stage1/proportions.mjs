// v3/stage1/proportions.mjs — IDENTITY PROPORTION MAP (IPM): the head/face as a proportional coordinate system.
//   measureS0(p)        Stage 0 → named, dimensionless relationships + evidence flags (observed / mirrored / bound / inferred)
//   measure3D(g)        the SAME definitions on a 3D head (front projection) — used for calibration AND final validation
//   learnStyle(pairs)   per-relationship Offshorly style transform from approved sprite → approved 3D pairs (log-ratio, shrunk
//                       toward identity when the approved evidence disagrees; approved range = soft clamp)
//   translate(map, st)  person map → TARGET 3D proportion map (multiplicative: ordering + relative differences preserved)
//   layoutWarp(...)     proportion-space warp: person normalised 2D → target layout (cheek width = 1), features keep their shapes
// Definitions (y down in Stage 0; H = eye line → chin; W = cheek width = max face width between eye line and nose base):
//   temple level = eye line − 0.3·H · jaw level = mouth + 0.5·(chin − mouth) · chin level = mouth + 0.8·(chin − mouth)
const RELIABLE = new Set(["visible", "stroke-over-ear", "stroke-over-neck", "edge-over-neck", "scalp-silhouette"]), BOUND = new Set(["hair-bounded", "feature-at-edge"]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** contour crossings at height y: per side the x and the evidence class of the crossing segment */
function sides(ct, y, midX) { const L = [], R = []; for (let i = 0; i < ct.length; i++) { const a = ct[i], b = ct[(i + 1) % ct.length]; if ((a.pt[1] - y) * (b.pt[1] - y) > 0 || a.pt[1] === b.pt[1]) continue;
    const x = a.pt[0] + ((y - a.pt[1]) / (b.pt[1] - a.pt[1])) * (b.pt[0] - a.pt[0]), cls = [a.label, b.label].every((l) => RELIABLE.has(l)) ? "reliable" : [a.label, b.label].some((l) => !RELIABLE.has(l) && !BOUND.has(l)) ? "unreliable" : "bound";
    (x < midX ? L : R).push({ x, cls }); }
  const pick = (arr, far) => (arr.length ? arr.reduce((u, v) => (far(v.x, u.x) ? v : u)) : null); return { L: pick(L, (p, q) => p < q), R: pick(R, (p, q) => p > q) }; }
/** evidence-resolved width at y: both reliable → observed; one reliable → mirrored about the face midline; both bounds → lower bound */
function widthAt(ct, y, midX, belowMouth = false) { const { L, R } = sides(ct, y, midX); if (!L || !R) return { v: null, flag: "missing" };
  if (belowMouth) for (const S of [L, R]) if (S.cls === "bound") S.cls = "probable";   // hair beside the jaw falls BEHIND it (FC-JAW-HAIR-BOUND)
  if (L.cls === "probable" && R.cls !== "unreliable" && R.cls !== "bound" || R.cls === "probable" && L.cls !== "unreliable" && L.cls !== "bound") return { v: R.x - L.x, flag: L.cls === "reliable" || R.cls === "reliable" ? "probable (one side hair)" : "probable (hair behind jaw)" };
  if (L.cls === "reliable" && R.cls === "reliable") return { v: R.x - L.x, flag: "observed" };
  if (L.cls === "reliable") return { v: 2 * (midX - L.x), flag: "mirrored" }; if (R.cls === "reliable") return { v: 2 * (R.x - midX), flag: "mirrored" };
  if (L.cls === "bound" && R.cls === "bound") return { v: R.x - L.x, flag: "lower-bound (hair)" }; return { v: R.x - L.x, flag: "uncertain" }; }
const crossY = (ct, x) => { const ys = []; for (let i = 0; i < ct.length; i++) { const a = ct[i], b = ct[(i + 1) % ct.length]; if ((a.pt[0] - x) * (b.pt[0] - x) <= 0 && a.pt[0] !== b.pt[0]) ys.push({ y: a.pt[1] + ((x - a.pt[0]) / (b.pt[0] - a.pt[0])) * (b.pt[1] - a.pt[1]), l: [a.label, b.label] }); } return ys; };

/** shared relationship builder from LEVELS (y down) + WIDTHS + feature points — identical for Stage 0 and 3D */
const USABLE = /^(observed|mirrored|probable|inferred|constrained)/i;
const worst = (...f) => (f.every((x) => USABLE.test(x)) ? (f.find((x) => !/^observed/i.test(x)) ?? "observed") : f.find((x) => !USABLE.test(x)));
function relations(g) { const M = {}, put = (k, v, flag = "observed") => { if (v != null && Number.isFinite(v)) M[k] = { v, flag }; };
  const H = g.chin - g.eye, W = g.cheekW.v, iod = d2(g.cR, g.cL), wf = (w) => (w.flag === "observed" || w.flag === "mirrored" ? w.flag : w.flag);
  // FRAME
  // the eye spacing (IOD) is the always-reliable unit; outline widths carry their own evidence flag (hair lower-bounds are marked)
  put("frame.faceH_IOD", H / iod); put("frame.templeW_IOD", g.templeW.v / iod, g.templeW.flag); put("frame.eyeLevelW_IOD", g.eyeW.v / iod, g.eyeW.flag); put("frame.cheekW_IOD", W / iod, g.cheekW.flag);
  put("frame.jawW_IOD", g.jawW.v / iod, g.jawW.flag); put("frame.chinW_IOD", g.chinW.v / iod, g.chinW.flag);
  // CHIN SHAPE (separate from chin position + width): half-width at 25/50/75% of the way from the chin-width level to the chin point,
  // relative to the chin width — round ≈ high, pointed (V) ≈ low, square ≈ stays high to the bottom
  if (g.chinShape) g.chinShape.forEach((r, k) => r != null && put(`frame.chinRound${[25, 50, 75][k]}`, r, g.chinShapeFlag ?? "observed"));
  if (g.foreheadW) put("frame.foreheadW_IOD", g.foreheadW.v / iod, g.foreheadW.flag); if (g.noseW_lvl) put("frame.noseLevelW_IOD", g.noseW_lvl.v / iod, g.noseW_lvl.flag); if (g.mouthW_lvl) put("frame.mouthLevelW_IOD", g.mouthW_lvl.v / iod, g.mouthW_lvl.flag);
  put("frame.faceH_cheekW", H / W, g.cheekW.flag); put("frame.jawW_cheekW", g.jawW.v / W, worst(g.jawW.flag, g.cheekW.flag)); put("frame.chinW_jawW", g.chinW.v / g.jawW.v, worst(g.chinW.flag, g.jawW.flag));
  if (g.top != null) { put("frame.forehead_total", (g.brow - g.top) / (g.chin - g.top), g.topFlag); put("frame.totalH_cheekW", (g.chin - g.top) / W, g.topFlag); }
  // VERTICAL (fractions of eye → chin)
  if (g.top != null && g.brow != null) put("v.topBrow_H", (g.brow - g.top) / H, g.topFlag); if (g.brow != null) put("v.browEye_H", (g.eye - g.brow) / H, g.browFlag ?? "observed");
  put("v.eyeNose_H", (g.nose - g.eye) / H); put("v.noseMouth_H", (g.mouth - g.nose) / H); put("v.mouthChin_H", (g.chin - g.mouth) / H); put("v.noseChin_H", (g.chin - g.nose) / H); put("v.eyeMouth_H", (g.mouth - g.eye) / H);
  // HORIZONTAL
  put("h.IOD_cheekW", iod / W, g.cheekW.flag); if (g.iR) { put("h.innerGap_IOD", d2(g.iR, g.iL) / iod); put("h.eyeW_IOD", (d2(g.iR, g.oR) + d2(g.iL, g.oL)) / 2 / iod); }
  if (g.oR && g.eyeEdge) put("h.eyeSide_cheekW", g.eyeEdge.v / W, g.eyeEdge.flag); if (g.noseW != null) put("h.noseW_IOD", g.noseW / iod); if (g.mouthW != null) { put("h.mouthW_IOD", g.mouthW / iod); if (g.noseW) put("h.mouthW_noseW", g.mouthW / g.noseW); }
  if (g.pupilD && g.mouthW != null) put("h.mouthW_pupilD", g.mouthW / g.pupilD, "appearance (iris)");
  // CROSS
  put("x.noseMouth_noseChin", (g.mouth - g.nose) / (g.chin - g.nose)); put("x.mouthChin_noseChin", (g.chin - g.mouth) / (g.chin - g.nose)); put("x.eyeNose_eyeChin", (g.nose - g.eye) / H);
  return M; }

/** Stage 0 → IPM (image px, y down). Returns { map, g (levels/points), H, W } */
/** EYE EVIDENCE (FC-EYE-EVIDENCE-QUARANTINE, learned: a bangs-overlapped eye (conf 0.3, "implausible-shape") and an occluded outer canthus
 *  ("outer-corner-occluded") were used as calibration truth — and an eye CENTRE built on a bad corner shifts the IOD unit of EVERY relation).
 *  Stage 0's own per-eye flags decide: an unreliable eye (conf < 0.5 or implausible shape) is rebuilt by MIRRORING the reliable eye about the
 *  inner-corner midline; an occluded outer corner is rebuilt from the observed inner corner + the mirrored eye vector. Provenance travels:
 *  "mirrored (eye R …)"; both eyes unreliable → "quarantined" (never used as evidence). Returns a copy — the Stage 0 record is untouched. */
export function withEyeEvidence(p) { const e = p?.eyes; if (!e?.R || !e?.L || p.eyeEvidence) return p;
  const bad = (q) => !q.found || (q.conf ?? 1) < 0.5 || (q.flags ?? []).includes("implausible-shape"), occ = (q, c) => (q.unknown ?? []).includes(c) || (q.flags ?? []).includes(`${c}-corner-occluded`) || q[`${c}Ok`] === false;
  const st = Object.fromEntries(["R", "L"].map((s) => [s, bad(e[s]) ? "unreliable" : occ(e[s], "outer") ? "outer-occluded" : occ(e[s], "inner") ? "inner-occluded" : "ok"]));
  if (st.R === "ok" && st.L === "ok") return { ...p, eyeEvidence: { status: st, flag: "observed" } };
  if (st.R !== "ok" && st.L !== "ok") return { ...p, eyeEvidence: { status: st, flag: "quarantined (both eyes unreliable/occluded)" } };
  const good = st.R === "ok" ? "R" : "L", badS = good === "R" ? "L" : "R", G = e[good], B = e[badS], mx = (e.R.inner[0] + e.L.inner[0]) / 2, mir = (q) => [2 * mx - q[0], q[1]];
  let nb; if (st[badS] === "unreliable") nb = { ...B, inner: mir(G.inner), outer: mir(G.outer), upper: G.upper.map(mir), lower: G.lower.map(mir), reconstructed: "mirrored" };
  else { const vo = [-(G.outer[0] - G.inner[0]), G.outer[1] - G.inner[1]], vi = [-(G.inner[0] - G.outer[0]), G.inner[1] - G.outer[1]];   // the bad eye's own observed corner + the mirrored eye vector
    nb = st[badS] === "outer-occluded" ? { ...B, outer: [B.inner[0] + vo[0], B.inner[1] + vo[1]], reconstructed: "outer corner mirrored" } : { ...B, inner: [B.outer[0] + vi[0], B.outer[1] + vi[1]], reconstructed: "inner corner mirrored" }; }
  return { ...p, eyes: { ...e, [badS]: nb }, eyeEvidence: { status: st, flag: `mirrored (eye ${badS} ${st[badS]})`, rebuilt: badS } }; }
export function measureS0(p0, prior = null) { const p = withEyeEvidence(p0); const e = p.eyes, ct = p.contour, cR = mid(e.R.inner, e.R.outer), cL = mid(e.L.inner, e.L.outer), eye = (cR[1] + cL[1]) / 2;
  const mouthC = [(p.mouth.cornerR[0] + p.mouth.cornerL[0]) / 2, (Math.min(...p.mouth.upper.map((q) => q[1])) + Math.max(...p.mouth.lower.map((q) => q[1]))) / 2];
  const midX = (((cR[0] + cL[0]) / 2) + (p.nose.found ? p.nose.base[0] : mouthC[0]) + mouthC[0]) / 3, ys = crossY(ct, midX), lo = ys.reduce((a, b) => (b.y > a.y ? b : a)), hi = ys.reduce((a, b) => (b.y < a.y ? b : a));
  const chin = lo.y, nose = p.nose.found ? p.nose.base[1] : null, H = chin - eye, mouth = mouthC[1];
  const brows = ["R", "L"].map((k) => p.brows[k]).filter((b) => b?.found).map((b) => [...b.top, ...b.bottom]).flat(), brow = brows.length ? brows.reduce((a, q) => a + q[1], 0) / brows.length : null;
  const topFlag = hi.l.every((l) => l === "scalp-silhouette") ? "observed (skull)" : "hair-dependent (hairline)";
  let cheekW = { v: 0, flag: "missing" }; if (nose != null) for (let k = 0; k <= 12; k++) { const w = widthAt(ct, eye + ((nose - eye) * k) / 12, midX); if (w.v != null && (w.v > cheekW.v)) cheekW = w; }
  const env = prior?.env;   // SHAPE-COMPLETED envelope (envelope.mjs): every width comes from ONE continuous face, with provenance
  const g = { eye, brow, browFlag: brows.length ? "observed" : null, top: hi.y, topFlag, nose, mouth, chin, cR, cL, iR: e.R.inner, oR: e.R.outer, iL: e.L.inner, oL: e.L.outer, midX,
    cheekW, templeW: widthAt(ct, eye - 0.3 * H, midX), eyeW: widthAt(ct, eye, midX), jawW: widthAt(ct, mouth + 0.5 * (chin - mouth), midX, true), chinW: widthAt(ct, mouth + 0.8 * (chin - mouth), midX, true), env,
    noseW: p.nose.found ? d2(p.nose.wingR, p.nose.wingL) : null, mouthW: d2(p.mouth.cornerR, p.mouth.cornerL), pupilD: e.R.iris && e.L.iris ? d2(e.R.iris, e.L.iris) : null };
  { const yc = mouth + 0.8 * (chin - mouth), wc = widthAt(ct, yc, midX, true); if (wc.v) { const fl = []; g.chinShape = [0.25, 0.5, 0.75].map((f) => { const w = widthAt(ct, yc + f * (chin - yc), midX, true); fl.push(w.flag); return w.v ? w.v / wc.v : null; }); g.chinShapeFlag = worst(wc.flag, ...fl); } }
  if (env) { const at = (t) => { const i = Math.max(0, Math.min(env.t.length - 2, Math.floor((t - env.t[0]) / 0.025))), f = Math.min(1, Math.max(0, (t - env.t[i]) / 0.025)); return { v: 2 * (env.w[i] * (1 - f) + env.w[i + 1] * f) * env.iodPx, flag: f < 0.5 ? env.cls[i] : env.cls[i + 1] }; };
    const L = env.levels; Object.assign(g, { foreheadW: at(L.forehead), templeW: at(L.temple), eyeW: at(L.eye), noseW_lvl: at(L.nose), mouthW_lvl: at(L.mouth), jawW: at(L.jaw), chinW: at(L.chin) });
    let best = null; for (let k = 0; k <= 12; k++) { const c = at((L.nose * k) / 12); if (!best || c.v > best.v) best = c; } g.cheekW = best; cheekW = best; }
  // cheek width unknown (hair lower-bound) → INFERRED from the jaw by the population cheek/jaw relation, never below the bound
  if (!env && prior?.cheekOverJaw && !/^(observed|mirrored)/.test(g.cheekW.flag) && g.jawW.v && /^(observed|mirrored|probable)/.test(g.jawW.flag)) { const inf = g.jawW.v * prior.cheekOverJaw; g.cheekW = { v: Math.max(inf, g.cheekW.v || 0), flag: `inferred (jaw × population ${prior.cheekOverJaw.toFixed(2)}; hair bound ${(g.cheekW.v || 0).toFixed(0)}px)` }; }
  // outer canthus → face edge at the eye line (each side; evidence-resolved by mirroring when one side is reliable)
  { const s = sides(ct, eye, midX), outR = e.R.outer[0] < e.L.outer[0] ? e.R.outer : e.L.outer, outL = outR === e.R.outer ? e.L.outer : e.R.outer, rel = [s.L, s.R].filter((x) => x?.cls === "reliable");
    g.eyeEdge = s.L && s.R ? { v: ((outR[0] - s.L.x) + (s.R.x - outL[0])) / 2, flag: rel.length === 2 ? "observed" : rel.length ? "partly mirrored" : "lower-bound (hair)" } : null; }
  // eye provenance travels into EVERY relation (the IOD unit comes from the eye centres); eye-shape relations carry it directly
  const map = relations(g), ef = p.eyeEvidence?.flag ?? "observed"; if (ef !== "observed") for (const [k, r] of Object.entries(map)) { if (/quarantined/.test(ef)) r.flag = ef; else if (/^h\.(eyeW|innerGap)|eyeEdge/.test(k) || /^observed/.test(r.flag ?? "observed")) r.flag = `${ef}${r.flag && !/^observed/.test(r.flag) ? " · " + r.flag : ""}`; }
  return { map, g, H, W: g.cheekW.v, eyeEvidence: p.eyeEvidence }; }

/** 3D head → IPM with the SAME definitions. g3 supplies levels in 3D y-UP world units (converted to y-down internally) and widths
 *  measured on the mesh silhouette: { eyeY, noseY, mouthY, chinY, browY?, topY?, cR, cL, iR?, oR?, iL?, oL?, noseW?, mouthW?, widthAt(y) } */
export function measure3D(g3) { const f = (y) => -y, H = g3.eyeY - g3.chinY, ln = (y) => ({ v: g3.widthAt(y), flag: "observed" }), ny = g3.noseY, mo = g3.mouthY, ch = g3.chinY;
  let cheekW = { v: 0, flag: "observed" }; for (let k = 0; k <= 12; k++) { const w = g3.widthAt(g3.eyeY + ((ny - g3.eyeY) * k) / 12); if (w > cheekW.v) cheekW = { v: w, flag: "observed" }; }
  const P = (q) => (q ? [q[0], f(q[1])] : null), g = { eye: f(g3.eyeY), nose: f(ny), mouth: f(mo), chin: f(ch), brow: g3.browY != null ? f(g3.browY) : null, browFlag: g3.browFlag ?? "landing (no brow geometry in clay)", top: g3.topY != null ? f(g3.topY) : null, topFlag: "landing (hairline)",
    cR: P(g3.cR), cL: P(g3.cL), iR: P(g3.iR), oR: P(g3.oR), iL: P(g3.iL), oL: P(g3.oL), cheekW, templeW: ln(g3.eyeY + 0.3 * H), eyeW: ln(g3.eyeY), jawW: ln(mo - 0.5 * (mo - ch)), chinW: ln(mo - 0.8 * (mo - ch)), foreheadW: ln(g3.eyeY + 0.45 * H), noseW_lvl: ln(ny), mouthW_lvl: ln(mo), noseW: g3.noseW ?? null, mouthW: g3.mouthW ?? null };
  { const yc = mo - 0.8 * (mo - ch), wc = g3.widthAt(yc); if (wc > 0) g.chinShape = [0.25, 0.5, 0.75].map((f) => g3.widthAt(yc - f * (yc - ch)) / wc); }
  if (g3.oR) { const w = g3.widthAtX(g3.eyeY), oRx = Math.min(g3.oR[0], g3.oL[0]), oLx = Math.max(g3.oR[0], g3.oL[0]); g.eyeEdge = { v: ((oRx - w[0]) + (w[1] - oLx)) / 2, flag: "observed" }; }
  return { map: relations(g), g, H, W: cheekW.v }; }

/** per-relationship style transform from approved pairs: k = exp(mean log(3D/S0)) shrunk toward 1 by disagreement; range = approved 3D */
export function learnStyle(pairs, { sdRef = 0.1, margin = 0.1 } = {}) { const keys = new Set(pairs.flatMap((p) => Object.keys(p.s3))), out = {};
  for (const k of keys) { const ok = pairs.filter((p) => p.s0[k] && p.s3[k] && p.s0[k].v > 0 && p.s3[k].v > 0 && USABLE.test(p.s0[k].flag)); if (ok.length < 3) continue;
    const lr = ok.map((p) => Math.log(p.s3[k].v / p.s0[k].v)), m = lr.reduce((a, b) => a + b, 0) / lr.length, sd = Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / lr.length), w = 1 / (1 + (sd / sdRef) ** 2);
    // FC-WEAK-STYLE-BIAS (learned): shrinking a weak factor toward 1 still tilted relationships (mouth pushed toward the chin by ~6%
    // from inconsistent approved heads) — below trust 0.5 the person's own relationship is kept EXACTLY
    out[k] = { k: w >= 0.5 ? Math.exp(m * w) : 1, kRaw: Math.exp(m), sdLog: sd, trust: w, n: ok.length, range: [Math.min(...ok.map((p) => p.s3[k].v)) * (1 - margin), Math.max(...ok.map((p) => p.s3[k].v)) * (1 + margin)] }; }
  return out; }

/** person IPM → TARGET 3D IPM. Relationships without approved evidence keep the person's raw value (identity-preserving). The three
 *  vertical intervals are renormalised to sum to the eye→chin height (internal consistency). */
export function translate(map, style, locked = null) { const T = {};
  for (const [k, m] of Object.entries(map)) { const st = style[k]; let v = st ? m.v * st.k : m.v, clamped = false; if (st) { const c = Math.min(st.range[1], Math.max(st.range[0], v)); clamped = c !== v; v = c; }
    T[k] = { v, raw: m.v, flag: m.flag, style: st ? (st.trust >= 0.5 ? `×${st.k.toFixed(3)}` : `identity (weak style evidence, trust ${st.trust.toFixed(2)})`) : "none (identity kept)", clamped }; }
  // LOCKED STYLE RANGE for eye size lives HERE, in the target (FC-EYE-RANGE-ONE-DEFINITION, learned: the eye module clamped eye width to the
  // approved heads' bare span while the target did not — target, construction and QA disagreed and the identity cost was invisible). The range is
  // calibration data (verified approved heads ± the standard margin); a limited value says so and keeps the identity value beside it.
  { const R = locked?.["eye.halfW_IOD_range"]?.v, t = T["h.eyeW_IOD"]; if (R && t) { const c = Math.min(2 * R[1], Math.max(2 * R[0], t.v)); if (c !== t.v) { t.identity = t.v; t.v = c; t.clamped = true; t.style = `style-limited: locked eye range ${(2 * R[0]).toFixed(3)}–${(2 * R[1]).toFixed(3)} (identity ${t.identity.toFixed(3)})`; } } }
  const a = T["v.eyeNose_H"]?.v, b = T["v.noseMouth_H"]?.v, c = T["v.mouthChin_H"]?.v; if (a && b && c) { const s = a + b + c; T["v.eyeNose_H"].v = a / s; T["v.noseMouth_H"].v = b / s; T["v.mouthChin_H"].v = c / s;
    T["v.noseChin_H"] && (T["v.noseChin_H"].v = (b + c) / s); T["v.eyeMouth_H"] && (T["v.eyeMouth_H"].v = (a + b) / s); T["x.noseMouth_noseChin"] && (T["x.noseMouth_noseChin"].v = b / (b + c)); T["x.mouthChin_noseChin"] && (T["x.mouthChin_noseChin"].v = c / (b + c)); T["x.eyeNose_eyeChin"] && (T["x.eyeNose_eyeChin"].v = a / s); }
  return T; }

/** PROPORTION-SPACE WARP: person normalised point → target layout (units: target cheek width = 1, origin = eye-line midpoint, y down).
 *  rn = Stage 1 rep (normalised frame), s0 = measureS0 result, T = target map. kind ∈ eyeR|eyeL|nose|mouth|contour|general.
 *  Vertical: piecewise-linear through eye / nose / mouth / chin levels (target fractions). Horizontal: features about their own centres
 *  (target sizes, shapes kept); the outline by the per-level target widths; everything else by the eye-spacing scale. */
export function layoutWarp(rn, s0, T) { const u = rn.F.u, px = (v) => v / u;   // Stage 0 px → normalised
  // unit: target IOD = 1 (origin = eye-line midpoint, y down)
  const IODn = Math.hypot(rn.eyes.R.c[0] - rn.eyes.L.c[0], rn.eyes.R.c[1] - rn.eyes.L.c[1]), gx = 1 / IODn, midXn = (rn.eyes.R.c[0] + rn.eyes.L.c[0]) / 2;
  const Hn = px(s0.H), lv = { nose: px(s0.g.nose - s0.g.eye), mouth: px(s0.g.mouth - s0.g.eye), chin: Hn };
  const H3 = T["frame.faceH_IOD"].v, tv = { nose: T["v.eyeNose_H"].v * H3, mouth: T["v.eyeMouth_H"].v * H3, chin: H3 };
  const Y = (y) => { if (y <= 0) return y * (tv.nose / lv.nose); if (y <= lv.nose) return (y / lv.nose) * tv.nose; if (y <= lv.mouth) return tv.nose + ((y - lv.nose) / (lv.mouth - lv.nose)) * (tv.mouth - tv.nose);
    if (y <= lv.chin) return tv.mouth + ((y - lv.mouth) / (lv.chin - lv.mouth)) * (tv.chin - tv.mouth); return tv.chin + (y - lv.chin) * ((tv.chin - tv.mouth) / (lv.chin - lv.mouth)); };
  // feature-local similarity: shape kept, target size (eye width, nose width, mouth width relative to IOD)
  const feat = (c, wn, w3) => (q) => { const s2 = w3 / wn; return [(c[0] - midXn) * gx + (q[0] - c[0]) * s2, Y(c[1]) + (q[1] - c[1]) * s2]; };
  const eyeW = (e) => Math.hypot(e.outer[0] - e.inner[0], e.outer[1] - e.inner[1]), eT = T["h.eyeW_IOD"].v;
  const FE = { eyeR: feat(rn.eyes.R.c, eyeW(rn.eyes.R), eT), eyeL: feat(rn.eyes.L.c, eyeW(rn.eyes.L), eT),
    nose: rn.nose ? feat(rn.nose.base, Math.hypot(rn.nose.wingR[0] - rn.nose.wingL[0], rn.nose.wingR[1] - rn.nose.wingL[1]), T["h.noseW_IOD"].v) : null,
    mouth: rn.mouth ? feat(rn.mouthC, Math.hypot(rn.mouth.cR[0] - rn.mouth.cL[0], rn.mouth.cR[1] - rn.mouth.cL[1]), T["h.mouthW_IOD"].v) : null };
  // outline: per-level horizontal scale = target width / person width (both in IOD units) at levels with RELIABLE evidence only
  const lev = [[-0.3 * Hn, "frame.templeW_IOD", s0.g.templeW], [0, "frame.eyeLevelW_IOD", s0.g.eyeW], [0.5 * lv.nose, "frame.cheekW_IOD", s0.g.cheekW], [lv.mouth + 0.5 * (lv.chin - lv.mouth), "frame.jawW_IOD", s0.g.jawW], [lv.mouth + 0.8 * (lv.chin - lv.mouth), "frame.chinW_IOD", s0.g.chinW]];
  const ws = lev.filter(([, k, w]) => w?.v && USABLE.test(w.flag) && T[k]).map(([y, k, w]) => [y, T[k].v / (px(w.v) / IODn)]);
  const sx = (y) => { if (!ws.length) return gx; if (y <= ws[0][0]) return ws[0][1] * gx; for (let i = 1; i < ws.length; i++) if (y <= ws[i][0]) { const t = (y - ws[i - 1][0]) / (ws[i][0] - ws[i - 1][0]); return (ws[i - 1][1] + t * (ws[i][1] - ws[i - 1][1])) * gx; } return ws[ws.length - 1][1] * gx; };
  const contour = (q) => [(q[0] - midXn) * sx(q[1]), Y(q[1])], general = (q) => [(q[0] - midXn) * gx, Y(q[1])];
  const warp = (q, kind = "general") => (kind === "contour" ? contour(q) : (FE[kind] ?? general)(q)); warp.outlineLevels = ws.length; return warp; }

/** SUBNASALE (shared anatomical definition — construction anchor, calibration and final measurement all use it): the CORNER where the
 *  steep nose underside turns into the upper lip — on the midline profile (front-most z per 3 mm, lightly smoothed), the point of
 *  maximum slope change (dz/dy above − dz/dy below, 12 mm windows) in the upper 75% of tip→mouth.
 *  (FC-SUBNASALE-CHORD, learned on holdouts: "deepest point below the tip→mouth chord" landed mid-lip when the upper lip was a long
 *  concave ramp.) Returns { y, i, turn }. */
/** FACE OUTLINE in front view at height y — ONE definition for calibration, construction and final QA (FC-OUTLINE-PLANE-DISCONTINUITY,
 *  learned: a hard "z ≥ ear-root plane" cut is discontinuous where the cheek outline straddles that plane — a 2 mm level shift flipped the
 *  measured nose-level width by 7%). Non-ear verts within ±band of y and no more than FRONT_MARGIN_IOD eye spacings behind the ear-root
 *  plane (the cheek→ear outline sits ≤ 0.12 IOD behind it; the wider skull behind the ear starts ≈ 0.3 IOD back). → [lo, hi] x */
export const FRONT_MARGIN_IOD = 0.2;
// EXACT SECTION (FC-OUTLINE-QUANTISED, learned: a ±4 mm vertex band read the coarse jaw/chin rows as a staircase — ±5% level-to-level — and a dense chin
// target fitted that staircase into lobes): with the topology's triangles the outline is the plane y ∩ the mesh edges (front of the margin, ears out).
const EDGES = new WeakMap();
function edgesOf(I, n) { let E = EDGES.get(I); if (E) return E; const seen = new Set(), a = []; for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const p = I[t * 3 + k], q = I[t * 3 + (k + 1) % 3], key = p < q ? p * n + q : q * n + p; if (!seen.has(key)) { seen.add(key); a.push(p, q); } } E = Int32Array.from(a); EDGES.set(I, E); return E; }
export function faceOutlineX(X, n, region, earL, earR, zPlane, iod, y, band = 0.004, I = null) { const zMin = zPlane - FRONT_MARGIN_IOD * iod; let lo = Infinity, hi = -Infinity;
  if (I) { const E = edgesOf(I, n); for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1], ya = X[a * 3 + 1], yb = X[b * 3 + 1]; if ((ya - y) * (yb - y) > 0 || ya === yb || region[a] === earL || region[a] === earR || region[b] === earL || region[b] === earR) continue;
      const f = (y - ya) / (yb - ya), z = X[a * 3 + 2] + f * (X[b * 3 + 2] - X[a * 3 + 2]); if (z < zMin) continue; const x = X[a * 3] + f * (X[b * 3] - X[a * 3]); if (x < lo) lo = x; if (x > hi) hi = x; } return [lo, hi]; }
  for (let i = 0; i < n; i++) { if (region[i] === earL || region[i] === earR || X[i * 3 + 2] < zMin || Math.abs(X[i * 3 + 1] - y) > band) continue; const x = X[i * 3]; if (x < lo) lo = x; if (x > hi) hi = x; } return [lo, hi]; }
/** MENTON — ONE definition (FC-MENTON-DEFINITION, learned: construction used "front of the ear plane", QA "z > 0.12" — different vertices, so a
 *  restore held a menton QA never measured): the lowest midline vertex of the front face below the mouth */
export function mentonY(X, n, mouthY) { let m = Infinity; for (let i = 0; i < n; i++) if (Math.abs(X[i * 3]) < 0.006 && X[i * 3 + 2] > 0.12 && X[i * 3 + 1] < mouthY) m = Math.min(m, X[i * 3 + 1]); return m; }
export function subnasale(X, n, tipY, tipZ, mouthY) { const B = 0.003, best = new Map(); for (let i = 0; i < n; i++) { const y = X[i * 3 + 1]; if (Math.abs(X[i * 3]) > 0.006 || y > tipY + 0.006 || y <= mouthY || X[i * 3 + 2] < 0.1) continue; const k = Math.round(y / B); const c = best.get(k); if (!c || X[i * 3 + 2] > X[c * 3 + 2]) best.set(k, i); }
  const ks = [...best.keys()].sort((a, b) => a - b); if (ks.length < 8) return null; let zs = ks.map((k) => X[best.get(k) * 3 + 2]); for (let it = 0; it < 2; it++) zs = zs.map((v, j) => (j > 0 && j < zs.length - 1 ? 0.25 * zs[j - 1] + 0.5 * v + 0.25 * zs[j + 1] : v));
  // the FIRST strong corner below the tip (FC-SUBNASALE-VERMILION: the lip's vermilion border is also a corner — the subnasale is the
  // one nearest the nose): candidates in the upper 70% of tip→mouth, local maxima ≥ 50% of the strongest, take the highest
  const W = Math.max(2, Math.round(0.012 / B)), lo = mouthY + 0.3 * (tipY - mouthY), cand = [];
  for (let j = W; j < ks.length - W; j++) { const y = ks[j] * B; if (y < lo || y > tipY - 0.006) continue; const above = (zs[j + W] - zs[j]) / (W * B), below = (zs[j] - zs[j - W]) / (W * B); cand.push({ j, y, turn: above - below }); }
  if (!cand.length) return null; const mx = Math.max(...cand.map((c) => c.turn)); let out = null;
  for (let k = 0; k < cand.length; k++) { const c = cand[k], l = cand[k - 1]?.turn ?? -Infinity, r = cand[k + 1]?.turn ?? -Infinity; if (c.turn >= l && c.turn >= r && c.turn >= 0.5 * mx && (!out || c.y > out.y)) out = { y: c.y, i: best.get(ks[c.j]), turn: c.turn }; }
  return out; }
