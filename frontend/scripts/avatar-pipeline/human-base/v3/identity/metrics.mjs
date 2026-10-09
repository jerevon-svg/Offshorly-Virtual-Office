// v3/identity/metrics.mjs — Stage 0 normalised frame, traits, identity vector + distance (shared by report + stability).
export const known = (c) => c.conf >= 0.4;
// ---------- normalised identity frame: origin = image-measured eye midpoint, x along the eye line, unit u = √(IOD·EM) ----------
export function normalise(p) {
  // eye anchor = canthal centre (mid inner/outer corner) when both corners are observed — gaze-invariant and measured ≤1 px
  // stable; else the iris centre; low-confidence eyes fall back to their iris centre as well
  const anchor = (e) => (e.found && e.conf >= 0.5 && e.innerOk !== false && e.outerOk !== false ? [(e.inner[0] + e.outer[0]) / 2, (e.inner[1] + e.outer[1]) / 2] : e.iris);
  const eR = anchor(p.eyes.R), eL = anchor(p.eyes.L), em = [(eR[0] + eL[0]) / 2, (eR[1] + eL[1]) / 2], ang = Math.atan2(eL[1] - eR[1], eL[0] - eR[0]);
  const iod = Math.hypot(eL[0] - eR[0], eL[1] - eR[1]), mc = p.mouth.found ? [(p.mouth.cornerR[0] + p.mouth.cornerL[0]) / 2, (Math.min(...p.mouth.upper.map((q) => q[1])) + Math.max(...p.mouth.lower.map((q) => q[1]))) / 2] : p.seeds.mouthMP;
  const co = Math.cos(-ang), si = Math.sin(-ang), rot = (q) => [co * (q[0] - em[0]) - si * (q[1] - em[1]), si * (q[0] - em[0]) + co * (q[1] - em[1])];
  const em2 = rot(mc)[1], u = Math.sqrt(iod * em2), T = (q) => { const r = rot(q); return [r[0] / u, r[1] / u]; };
  return { T, u, iod, em: em2, rollDeg: (ang * 180) / Math.PI };
}
// contour on a common angular grid about the normalised mid-face centre (0, 0.6·EM/u)
export const GRID = 72;
export function resample(p, F) {
  const cen = [0, (0.6 * F.em) / F.u], pts = p.contour.map((c) => { const q = F.T(c.pt); return { q, a: Math.atan2(q[1] - cen[1], q[0] - cen[0]), r: Math.hypot(q[0] - cen[0], q[1] - cen[1]), c }; }).sort((x, y) => x.a - y.a);
  const out = [];
  for (let g = 0; g < GRID; g++) { const a = -Math.PI + (2 * Math.PI * (g + 0.5)) / GRID; let j = pts.findIndex((x) => x.a >= a); if (j < 0) j = 0; const B = pts[j], A = pts[(j - 1 + pts.length) % pts.length];
    let span = B.a - A.a; if (span <= 0) span += 2 * Math.PI; let f = (a - A.a) / span; if (f < 0) f += 2 * Math.PI / span; f = Math.min(1, Math.max(0, f));
    const r = A.r + (B.r - A.r) * f, ok = known(A.c) && known(B.c); out.push({ a, r, ok, q: [cen[0] + Math.cos(a) * r, cen[1] + Math.sin(a) * r], label: (f < 0.5 ? A : B).c.label }); }
  return { cen, out };
}

// ---------- traits (scale-free; unknown when the evidence is not observable) ----------
function widthAt(p, F, y) { // face width at normalised height y from known contour points on each side (null if a side is unknown)
  const pts = p.contour.map((c) => ({ q: F.T(c.pt), c })), side = (s) => { let best = null; for (let i = 0; i < pts.length; i++) { const A = pts[i], B = pts[(i + 1) % pts.length];
    if ((A.q[1] - y) * (B.q[1] - y) > 0 || A.q[1] === B.q[1]) continue; const x = A.q[0] + ((y - A.q[1]) / (B.q[1] - A.q[1])) * (B.q[0] - A.q[0]); if (Math.sign(x) !== s) continue;
    const ok = known(A.c) && known(B.c); if (!best || Math.abs(x) > Math.abs(best.x)) best = { x, ok }; } return best; };
  const l = side(-1), r = side(1); return { w: l && r ? r.x - l.x : null, ok: !!(l?.ok && r?.ok), half: [l?.x ?? null, r?.x ?? null], okSides: [!!l?.ok, !!r?.ok] };
}
export function traits(p) {
  const F = normalise(p), T = F.T, t = {}, unk = (k) => (t[k] = null);
  // chin = lowest known contour point near the midline
  const cps = p.contour.map((c) => ({ q: T(c.pt), c })), chinC = cps.filter((x) => Math.abs(x.q[0]) < 0.35 && x.q[1] > 0).sort((a, b) => b.q[1] - a.q[1])[0];
  const chinY = chinC?.q[1], chinOk = !!chinC && known(chinC.c), mY = F.em / F.u;
  t.eyeSpacing_IODoverEM = F.iod / F.em;
  t.lowerFace_eyeToChin = chinOk ? chinY : null;
  t.chinBelowMouth_overEM = chinOk ? (chinY - mY) / mY : null;
  const lv = { eye: 0, cheek: 0.5 * mY, mouth: mY, jaw: chinOk ? mY + 0.5 * (chinY - mY) : null, chin: chinOk ? mY + 0.85 * (chinY - mY) : null };
  for (const [k, y] of Object.entries(lv)) { if (y === null) { unk(`width_${k}`); continue; } const w = widthAt(p, F, y); t[`width_${k}`] = w.ok ? w.w : null; t[`width_${k}_sides`] = w.okSides; }
  const wc = t.width_cheek ?? t.width_eye; t.taper_jawOverCheek = t.width_jaw && wc ? t.width_jaw / wc : null; t.taper_chinOverCheek = t.width_chin && wc ? t.width_chin / wc : null;
  t.faceAspect_lengthOverWidth = chinOk && wc ? chinY / wc : null;
  // chin angle: angle at the chin between contour points at the 'jaw' level on both sides
  t.chinTaper_chinOverJaw = t.width_chin && t.width_jaw ? t.width_chin / t.width_jaw : null;
  // forehead (hair-dependent): eye line → hairline/scalp at the midline
  const hl = p.hairline.filter((h) => h.y !== null).map((h) => T([h.x, h.y])).sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]))[0];
  t.foreheadToHairline_hairDependent = hl ? -hl[1] : null;
  for (const s of ["R", "L"]) { const e = p.eyes[s]; if (!e.found || e.conf < 0.5) continue; const a = T(e.inner), b = T(e.outer), up = e.upper.map(T), lo = e.lower.map(T);
    const w = Math.abs(b[0] - a[0]), hs = lo.map((q, i) => q[1] - up[i][1]), h = Math.max(...hs), ir = (p.eyes[s].irisR / F.u), ic = T(e.iris);
    t[`eye${s}_widthOverIOD`] = (w * F.u) / F.iod; t[`eye${s}_open`] = h / w; t[`eye${s}_tiltDeg`] = (Math.atan2(a[1] - b[1], Math.abs(b[0] - a[0])) * 180) / Math.PI; t[`eye${s}_irisOverWidth`] = (2 * ir) / w;
    t[`eye${s}_irisOverOpening`] = (2 * ir) / h;
    // iris vertical placement in the opening at the iris column: 0 = touching upper lid, 1 = touching lower lid
    const k = Math.max(0, Math.min(up.length - 1, Math.round(((ic[0] - Math.min(a[0], b[0])) / w) * (up.length - 1)))), sgn = Math.sign(b[0] - a[0]);
    const kk = sgn > 0 ? k : up.length - 1 - k; void kk; t[`eye${s}_irisVert`] = (ic[1] - up[k][1]) / Math.max(1e-6, lo[k][1] - up[k][1]);
    // upper-lid peak position along inner→outer (0 = inner, 1 = outer) and lower-lid sag (depth below the corner chord / width)
    const iPk = hs.indexOf(h), peakX = up.reduce((m, q) => (q[1] < m[1] ? q : m))[0]; t[`eye${s}_upperPeakPos`] = Math.abs(peakX - a[0]) / w; void iPk;
    const chordY = (x) => a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]); t[`eye${s}_lowerSag`] = Math.max(...lo.map((q) => q[1] - chordY(q[0]))) / w; t[`eye${s}_upperRise`] = Math.max(...up.map((q) => chordY(q[0]) - q[1])) / w;
    t[`eye${s}_observed`] = ((e.upperObs?.filter(Boolean).length ?? 0) + (e.lowerObs?.filter(Boolean).length ?? 0)) / ((e.upperObs?.length ?? 0) + (e.lowerObs?.length ?? 0) || 1); }
  if (p.eyes.R.found && p.eyes.L.found) { const iR = T(p.eyes.R.inner), iL = T(p.eyes.L.inner), oR = T(p.eyes.R.outer), oL = T(p.eyes.L.outer);
    t.eyes_innerGapOverIOD = ((iL[0] - iR[0]) * F.u) / F.iod; t.eyes_outerSpanOverIOD = ((oL[0] - oR[0]) * F.u) / F.iod;
    const wr = t.eyeR_widthOverIOD, wl = t.eyeL_widthOverIOD; t.eyes_widthAsym = (wl - wr) / ((wl + wr) / 2); t.eyes_openAsym = (t.eyeL_open - t.eyeR_open) / ((t.eyeL_open + t.eyeR_open) / 2); }
  for (const s of ["R", "L"]) { const b = p.brows[s], e = p.eyes[s]; if (!b.found || !e.found) continue; const top = b.top.map(T), bot = b.bottom.map(T);
    const th = top.map((q, i) => bot[i][1] - q[1]), cen = top.map((q, i) => [(q[0] + bot[i][0]) / 2, (q[1] + bot[i][1]) / 2]), inner = s === "R" ? cen[cen.length - 1] : cen[0], outer = s === "R" ? cen[0] : cen[cen.length - 1];
    const chord = Math.hypot(outer[0] - inner[0], outer[1] - inner[1]), arch = Math.max(...cen.map((q) => { const v = [outer[0] - inner[0], outer[1] - inner[1]]; return ((q[0] - inner[0]) * v[1] - (q[1] - inner[1]) * v[0]) / chord; }).map((v) => (s === "R" ? v : -v)));
    const eyeTop = Math.min(...e.upper.map((q) => T(q)[1]));
    t[`brow${s}_thickness`] = median(th); t[`brow${s}_gapToEye`] = eyeTop - Math.max(...bot.map((q) => q[1])); t[`brow${s}_tiltDeg`] = (Math.atan2(inner[1] - outer[1], Math.abs(outer[0] - inner[0])) * 180) / Math.PI;
    t[`brow${s}_archOverLen`] = arch / chord; t[`brow${s}_lenOverIOD`] = (chord * F.u) / F.iod; }
  if (p.nose.found) { const a = T(p.nose.wingR), b = T(p.nose.wingL), base = T(p.nose.base); t.nose_widthOverIOD = ((b[0] - a[0]) * F.u) / F.iod; t.nose_baseDrop_overEM = base[1] / mY; }
  if (p.mouth.found) { const a = T(p.mouth.cornerR), b = T(p.mouth.cornerL), up = p.mouth.upper.map(T), lo = p.mouth.lower.map(T);
    t.mouth_widthOverIOD = ((b[0] - a[0]) * F.u) / F.iod; t.mouth_lipHeight = lo[3][1] - up[3][1]; t.mouth_cornerLift = ((a[1] + b[1]) / 2 - (up[3][1] + lo[3][1]) / 2) * -1; }
  // table value per paired feature = the higher-confidence side (mean when equal); asymmetric extraction is visible, not averaged in
  for (const [f, keys] of [["eye", ["widthOverIOD", "open", "tiltDeg", "irisOverWidth", "irisOverOpening", "irisVert", "upperPeakPos", "lowerSag", "upperRise"]], ["brow", ["thickness", "gapToEye", "tiltDeg", "archOverLen", "lenOverIOD"]]]) {
    const src = f === "eye" ? p.eyes : p.brows, cR = src.R?.found ? src.R.conf : -1, cL = src.L?.found ? src.L.conf : -1;
    for (const k of keys) { const r = t[`${f}R_${k}`], l = t[`${f}L_${k}`]; t[`${f}_${k}`] = r === undefined ? l ?? null : l === undefined ? r : cR > cL ? r : cL > cR ? l : (r + l) / 2; } }
  // hair layer (kept separate from face identity)
  const hp = p.hairRays.filter((h) => h.pt && h.label === "hair").map((h) => T(h.pt));
  t.hair_topAboveEyes = hp.length ? -Math.min(...hp.map((q) => q[1])) : null; t.hair_maxHalfWidth = hp.length ? Math.max(...hp.map((q) => Math.abs(q[0]))) : null;
  t.hair_belowChin = p.hairRays.some((h) => h.label === "merged-below-chin" || (h.pt && T(h.pt)[1] > (chinY ?? 9))) ? "yes" : "no";
  const fr = p.hairline.filter((h) => h.y !== null), frHair = fr.filter((h) => h.kind === "hair-edge");
  t.hair_fringeCoverage = fr.length ? frHair.filter((h) => T([h.x, h.y])[1] > -0.9).length / fr.length : null;
  return { F, t };
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

// identity vector for distinctness: contour grid (known only) + feature points, all normalised
export function vec(p) {
  const F = normalise(p), R = resample(p, F), v = [];
  R.out.forEach((g, i) => v.push({ k: `c${i}`, val: g.ok ? g.r : null, w: 1 }));
  const add = (k, q, w = 1) => { if (!q) return; const n = F.T(q); v.push({ k: `${k}x`, val: n[0], w }, { k: `${k}y`, val: n[1], w }); };
  for (const s of ["R", "L"]) { const e = p.eyes[s]; if (e.found && e.conf >= 0.5) { const n = e.upper.length - 1, m = n >> 1, q1 = Math.round(n / 4), q3 = Math.round((3 * n) / 4);
      if (e.innerOk !== false) add(`e${s}i`, e.inner); if (e.outerOk !== false) add(`e${s}o`, e.outer); add(`e${s}u`, e.upper[m]); add(`e${s}l`, e.lower[m]);
      if (e.upperObs) { add(`e${s}u1`, e.upper[q1]); add(`e${s}u3`, e.upper[q3]); if (e.irisConf >= 0.6) add(`e${s}c`, e.iris); } }
    const b = p.brows[s]; if (b.found) { add(`b${s}0`, b.top[0]); add(`b${s}5`, b.top[b.top.length - 1]); add(`b${s}m`, b.bottom[2]); } }
  if (p.nose.found) { add("nR", p.nose.wingR); add("nL", p.nose.wingL); add("nB", p.nose.base); }
  if (p.mouth.found) { add("mR", p.mouth.cornerR); add("mL", p.mouth.cornerL); add("mU", p.mouth.upper[3]); add("mD", p.mouth.lower[3]); }
  return v;
}
export function dist(a, b) { const m = new Map(b.map((x) => [x.k, x])); let s = 0, n = 0; for (const x of a) { const y = m.get(x.k); if (!y || x.val === null || y.val === null) continue; s += (x.val - y.val) ** 2; n++; } return { d: n ? Math.sqrt(s / n) : null, n }; }

