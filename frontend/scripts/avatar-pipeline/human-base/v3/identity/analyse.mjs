// v3/identity/analyse.mjs — Stage 0 analysis on the canonical evidence: feature hull, hair layer, face contour rays,
// image-measured eyes / brows / nose / mouth, hairline + outer hair silhouette, normalised identity frame, traits.
// All thresholds are in face units (IOD = 160 px canonical) and identical for every input.
import { CW, CH, CX, CY, IOD, MP, median, components, erode, dilate, fillPoly, hull, N_RAYS, inv3 } from "./extract.mjs";

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const r1 = (v) => Math.round(v * 1000) / 1000;

// grayscale min / max filters (square, separable) → black top-hat = closing(L) − L: dark details thinner than the window
function minmax(src, r, isMax) {
  const t = new Float32Array(CW * CH), o = new Float32Array(CW * CH), pick = isMax ? Math.max : Math.min;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { let v = src[y * CW + x]; for (let k = Math.max(0, x - r); k <= Math.min(CW - 1, x + r); k++) v = pick(v, src[y * CW + k]); t[y * CW + x] = v; }
  for (let x = 0; x < CW; x++) for (let y = 0; y < CH; y++) { let v = t[y * CW + x]; for (let k = Math.max(0, y - r); k <= Math.min(CH - 1, y + r); k++) v = pick(v, t[k * CW + x]); o[y * CW + x] = v; }
  return o;
}
function blackTopHat(L, r) { const c = minmax(minmax(L, r, true), r, false); const o = new Float32Array(CW * CH); for (let i = 0; i < o.length; i++) o[i] = c[i] - L[i]; return o; }

export function analyse(C, E) {
  const N = CW * CH, lm = C.lm, P = (i) => lm[i], { Lab, BG, SKIN, tone, tones } = E, OUT = C.OUT;
  const Lc = new Float32Array(N); for (let o = 0; o < N; o++) Lc[o] = OUT[o] || BG[o] ? 100 : Lab[o * 3];
  const failures = [], notes = [];
  const mouthMP = mid(P(13), P(14)), EMmp = mouthMP[1] - CY;
  const browTopMP = Math.min(...[...MP.browR, ...MP.browL].map((i) => P(i)[1]));

  // --- feature hull (seed-level; only used to let rays pass internal features) ---
  const fp = [...MP.browR, ...MP.browL, ...MP.eyeR, ...MP.eyeL, ...MP.nose, ...MP.mouth].map(P), hp = hull(fp);
  const hc = hp.reduce((a, p) => [a[0] + p[0] / hp.length, a[1] + p[1] / hp.length], [0, 0]);
  const grow = (d) => hp.map((p) => { const v = [p[0] - hc[0], p[1] - hc[1]], n = Math.hypot(...v); return [p[0] + (v[0] / n) * d, p[1] + (v[1] / n) * d]; });
  const Hcore = fillPoly(hp, CW, CH), Hm = fillPoly(grow(0.08 * IOD), CW, CH);

  // --- hair layer: thick non-skin, non-background regions outside the feature hull, connected to the crown zone ---
  const cand = new Uint8Array(N); for (let o = 0; o < N; o++) cand[o] = !OUT[o] && !BG[o] && !SKIN[o] && !Hm[o] ? 1 : 0;
  const rr = Math.round(0.03 * IOD), opened = dilate(erode(cand, CW, CH, rr), CW, CH, rr);
  const hcmp = components(opened, CW, CH), crown = new Set();
  for (let y = 0; y < Math.min(CH, Math.floor(browTopMP)); y++) for (let x = 0; x < CW; x++) { const l = hcmp.L[y * CW + x]; if (l) crown.add(l); }
  let HAIR = new Uint8Array(N); for (let o = 0; o < N; o++) HAIR[o] = crown.has(hcmp.L[o]) ? 1 : 0;
  const hairNear = dilate(HAIR, CW, CH, rr + 2); for (let o = 0; o < N; o++) if (cand[o] && hairNear[o]) HAIR[o] = 1; // strands / outlines inside the mass

  // --- face skin components: those holding skin seeds or overlapping the core feature hull ---
  const sc = components(SKIN, CW, CH), Kface = new Set(), inCore = new Map();
  // FC-SEED-OFF-FACE (learned on the Stage 0 set): a peripheral generic-mesh seed (e.g. the detector's chin, placed for
  // a longer human face) can land on neck skin and admit it as "face". Face membership therefore comes ONLY from overlap
  // with the inner eyes–nose–mouth hull, which every drawn face contains and no neck / ear / chest region reaches.
  for (let o = 0; o < N; o++) if (Hcore[o] && sc.L[o]) inCore.set(sc.L[o], (inCore.get(sc.L[o]) ?? 0) + 1);
  for (const [l, n] of inCore) if (n >= 30) Kface.add(l);
  for (const l of [...Kface]) if (sc.sizes[l] < 200) Kface.delete(l);

  // --- face contour: rays from the mid-face centre through skin; internal features crossed only inside the hull ---
  const c = [CX + (mouthMP[0] - CX) * 0.6, CY + EMmp * 0.6], gMax = 0.09 * IOD, step = 0.5, rMax = 3.4 * IOD;
  const rays = [];
  for (let i = 0; i < N_RAYS; i++) {
    const th = (2 * Math.PI * i) / N_RAYS, d = [Math.cos(th), Math.sin(th)];
    let last = 0, gapStart = null, outLen = 0, gapFromInside = false, exit = null;
    for (let t = 0; t < rMax; t += step) {
      const x = Math.round(c[0] + d[0] * t), y = Math.round(c[1] + d[1] * t);
      if (x < 0 || y < 0 || x >= CW || y >= CH) { exit = { kind: "cutoff" }; break; }
      const o = y * CW + x;
      if (OUT[o]) { exit = { kind: "cutoff" }; break; }
      if (BG[o]) { exit = { kind: "background", gap: gapStart === null ? 0 : t - gapStart }; break; }
      if (SKIN[o]) {
        if (gapStart !== null && outLen > 0 && !Kface.has(sc.L[o])) { exit = { kind: "otherSkin", at: [x, y] }; break; }
        last = t; gapStart = null; outLen = 0; gapFromInside = false; continue;
      }
      if (gapStart === null) { gapStart = t; gapFromInside = !!Hm[o]; }
      if (!Hm[o]) { outLen += step; if (outLen > gMax) { exit = { kind: "gap" }; break; } }
    }
    exit ??= { kind: "cutoff" };
    // what lies beyond the last face-skin pixel (look ahead 0.35 IOD along the ray)
    let hair = 0, bgc = 0, other = 0, skinO = 0, n = 0;
    for (let t = last + 1; t < last + 0.35 * IOD; t += 1) { const x = Math.round(c[0] + d[0] * t), y = Math.round(c[1] + d[1] * t); if (x < 0 || y < 0 || x >= CW || y >= CH) break; const o = y * CW + x; if (OUT[o]) break; n++;
      if (BG[o]) bgc++; else if (HAIR[o]) hair++; else if (SKIN[o]) skinO++; else other++; }
    const pt = [c[0] + d[0] * (last + 0.5), c[1] + d[1] * (last + 0.5)];
    let kind = exit.kind;
    if (kind === "gap") kind = hair >= Math.max(other, skinO) && hair > 0 ? "hair" : skinO > other ? "otherSkin" : "occluder";
    if (kind === "gap" || (exit.kind === "gap" && gapFromInside)) notes.push(`ray ${i}: gap began inside feature hull`);
    rays.push({ i, th, r: last + 0.5, pt, kind, featureEdge: exit.kind === "gap" && gapFromInside, beyond: { hair, bg: bgc, other, skin: skinO, n } });
  }
  // labels + confidence (honest: hair-bounded / cut-off / accessory evidence is NOT treated as face contour)
  const browLine = browTopMP, mouthY = mouthMP[1];
  for (const ry of rays) {
    const y = ry.pt[1];
    if (ry.kind === "background") { ry.label = y < browLine ? "scalp-silhouette" : "visible"; ry.conf = 0.95; }
    else if (ry.kind === "otherSkin") { ry.label = y > mouthY ? "stroke-over-neck" : "stroke-over-ear"; ry.conf = y > mouthY ? 0.85 : 0.6; }
    else if (ry.kind === "hair") { ry.label = y < browLine ? "hairline" : "hair-bounded"; ry.conf = y < browLine ? 0.1 : 0.45; }
    else if (ry.kind === "cutoff") { ry.label = "cut-off"; ry.conf = 0; }
    else if (y > mouthY) { ry.label = "edge-over-neck"; ry.conf = 0.8; } // below the mouth the face is in front of neck / collar
    else { ry.label = "occluded"; ry.conf = 0.25; }
    if (ry.featureEdge) { ry.label = "feature-at-edge"; ry.conf = 0.2; }
  }
  // mirror test for hair-bounded sides: narrower than a trustworthy mirror ⇒ hair is in front ⇒ unknown
  const tol = 0.05 * IOD;
  for (const ry of rays) { if (ry.label !== "hair-bounded") continue; const m = rays[((N_RAYS / 2 - ry.i) % N_RAYS + N_RAYS) % N_RAYS];
    if (["visible", "stroke-over-neck", "stroke-over-ear"].includes(m.label)) { if (ry.r < m.r - tol) { ry.label = "hair-occluded"; ry.conf = 0.15; } else ry.conf = 0.55; ry.mirror = m.i; }
    else if (m.label === "hair-bounded" || m.label === "hair-occluded") { if (ry.r < m.r - tol) { ry.label = "hair-occluded"; ry.conf = 0.15; } else ry.conf = 0.45; ry.mirror = m.i; } }

  // --- top-hat ink maps (dark details narrower than the window; immune to large cel-shadow bands) ---
  const TH = blackTopHat(Lc, Math.round(0.11 * IOD)), THb = blackTopHat(Lc, Math.round(0.2 * IOD));
  const litL = tones[0].mean[0];

  // --- eyes (image-measured APERTURE model; Stage 0 eye refinement) ---
  // The eye is the visible opening = sclera ∪ iris. Liner, wings, lashes, glasses, hair, wrinkles and shading are NOT eye
  // geometry: they only bound the opening. Iris = circle fitted to the iris↔sclera boundary. Lid samples carry evidence
  // flags (observed / inferred across the iris where liner and iris ink touch). Corners = where the opening ends; a corner
  // whose opening runs into hair / background / the search limit is reported as not observable.
  const eyes = {}, skinC = Math.hypot(tones[0].mean[1], tones[0].mean[2]), LINER = new Uint8Array(N);
  const isDarkPx = (o) => !OUT[o] && !BG[o] && !SKIN[o] && Lc[o] < litL - 25;
  const isScl0 = (o) => !OUT[o] && !BG[o] && !HAIR[o] && Lc[o] > 0.8 * litL && Math.hypot(Lab[o * 3 + 1], Lab[o * 3 + 2]) < 0.5 * skinC;
  let isScl = isScl0;
  const kasa = (P) => { let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0; const n = P.length;
    for (const [x, y] of P) { const z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
    const M = [Sxx, Sxy, Sx, Sxy, Syy, Sy, Sx, Sy, n], I = inv3(M), b = [-Sxz, -Syz, -Sz];
    const D = I[0] * b[0] + I[1] * b[1] + I[2] * b[2], E = I[3] * b[0] + I[4] * b[1] + I[5] * b[2], F = I[6] * b[0] + I[7] * b[1] + I[8] * b[2];
    const cx = -D / 2, cy = -E / 2; return [cx, cy, Math.sqrt(Math.max(0, cx * cx + cy * cy - F))]; };
  const quad = (P) => { if (P.length < 3) return null; let s = [0, 0, 0, 0, 0], t = [0, 0, 0]; const x0 = P.reduce((a, p) => a + p[0], 0) / P.length;
    for (const [x0_, y] of P) { const x = x0_ - x0; s[0] += 1; s[1] += x; s[2] += x * x; s[3] += x * x * x; s[4] += x * x * x * x; t[0] += y; t[1] += x * y; t[2] += x * x * y; }
    const I = inv3([s[4], s[3], s[2], s[3], s[2], s[1], s[2], s[1], s[0]]); const a = I[0] * t[2] + I[1] * t[1] + I[2] * t[0], b = I[3] * t[2] + I[4] * t[1] + I[5] * t[0], c = I[6] * t[2] + I[7] * t[1] + I[8] * t[0];
    return (x) => a * (x - x0) ** 2 + b * (x - x0) + c; };
  for (const [side, ii] of [["R", MP.irisR], ["L", MP.irisL]]) {
    const seed = P(ii), flags = [], ell = (x, y, c) => ((x - c[0]) / (0.58 * IOD)) ** 2 + ((y - c[1]) / (0.24 * IOD)) ** 2 <= 1;
    const X0 = Math.round(seed[0] - 0.62 * IOD), X1 = Math.round(seed[0] + 0.62 * IOD), Y0 = Math.round(seed[1] - 0.3 * IOD), Y1 = Math.round(seed[1] + 0.26 * IOD);
    // FC-LIGHT-IRIS (learned in the eye refinement): a light grey / blue iris passes the skin-relative "white" test, so the
    // iris boundary is the first pixel that is either not white-neutral OR ≥12 L darker than the running sclera level.
    // (An eye-absolute white threshold was tried and rejected: it dropped cel-shaded sclera — FC-SHADED-SCLERA.)
    const dm = new Uint8Array(N); for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const o = y * CW + x; if (ell(x, y, seed) && isDarkPx(o)) dm[o] = 1; }
    const DK = dilate(erode(dm, CW, CH, 1), CW, CH, 1);
    // coarse iris centre (dark mass near the seed)
    let ic = [seed[0], seed[1]], nC = 0;
    for (let it = 0; it < 4; it++) { let sx = 0, sy = 0, n = 0; for (let y = Math.round(ic[1] - 0.14 * IOD); y <= ic[1] + 0.14 * IOD; y++) for (let x = Math.round(ic[0] - 0.14 * IOD); x <= ic[0] + 0.14 * IOD; x++) { if (DK[y * CW + x] && Math.hypot(x - ic[0], y - ic[1]) < 0.14 * IOD) { sx += x; sy += y; n++; } } if (n) ic = [sx / n, sy / n]; nC = n; }
    if (!nC) { eyes[side] = { found: false, conf: 0, flags: ["no-iris-ink"] }; failures.push(`FC-EYE-${side}`); continue; }
    // iris edge points: first sclera→dark transition scanning inward from each side (highlights sit inside the iris and are never reached)
    const edges = [];
    for (let y = Math.round(ic[1] - 0.17 * IOD); y <= ic[1] + 0.17 * IOD; y++) for (const dir of [1, -1]) { let run = 0;
      let lv = 0; for (let k = 0; k <= 0.5 * IOD; k++) { const x = Math.round(ic[0] - dir * (0.5 * IOD - k)), o = y * CW + x, scl = isScl(o);
        const drop = run >= 2 && (!scl || Lc[o] < lv - 12) && !SKIN[o] && !BG[o] && !OUT[o] && !HAIR[o];
        if (drop) { if (Math.abs(x - ic[0]) < 0.24 * IOD) edges.push([x - dir * 0.5, y, dir]); break; }
        if (scl) { lv = run ? 0.6 * lv + 0.4 * Lc[o] : Lc[o]; run++; } else run = 0; } }
    let fit = null, used = edges;
    for (let it = 0; it < 3 && used.length >= 5; it++) { fit = kasa(used); const res = used.map((p) => Math.abs(Math.hypot(p[0] - fit[0], p[1] - fit[1]) - fit[2])), md = median(res); used = used.filter((p, i) => res[i] <= Math.max(1.5, 2.5 * md)); }
    const sidesSeen = new Set(used.map((p) => p[2])).size, okFit = fit && used.length >= 5 && sidesSeen === 2 && fit[2] > 0.05 * IOD && fit[2] < 0.26 * IOD && Math.hypot(fit[0] - ic[0], fit[1] - ic[1]) < 0.15 * IOD;
    let iris, irisR, irisConf;
    if (okFit) { iris = [fit[0], fit[1]]; irisR = fit[2]; const rms = Math.sqrt(used.reduce((a, p) => a + (Math.hypot(p[0] - fit[0], p[1] - fit[1]) - fit[2]) ** 2, 0) / used.length); irisConf = used.length >= 10 && rms < 1.5 ? 0.9 : 0.6; }
    else { iris = ic; const row = Math.round(ic[1]); let a = Math.round(ic[0]), b = a; while (DK[row * CW + a - 1]) a--; while (DK[row * CW + b + 1]) b++; irisR = Math.min(0.2 * IOD, (b - a + 1) / 2); irisConf = 0.3; flags.push("iris-not-fit"); }
    // aperture = sclera ∪ (dark ∩ iris disc) ∪ (anything inside the disc: highlights), grown from the iris inside the anatomical ellipse
    const inDisc = (x, y) => Math.hypot(x - iris[0], y - iris[1]) <= irisR + 0.5;
    // FC-SHADE-AS-LID (learned in the semantic eye pass): a lid shadow / cel shadow on the eyeball is darker than the white,
    // and its gray→white contrast edge was taken as the eyelid. EYEBALL = the sclera INCLUDING its shaded parts (non-skin,
    // neutral relative to this person's skin, not stroke-dark), opened 3×3 so anti-aliased stroke fringes cannot creep in.
    const Lstroke = 0.45 * litL, chrom = (o) => Math.hypot(Lab[o * 3 + 1], Lab[o * 3 + 2]);
    const isInk = (o) => !OUT[o] && !BG[o] && !SKIN[o] && Lc[o] <= Lstroke;
    const ebm = new Uint8Array(N); for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const o = y * CW + x; if (!OUT[o] && !BG[o] && !HAIR[o] && !SKIN[o] && Lc[o] > Lstroke && chrom(o) < 0.5 * skinC) ebm[o] = 1; }
    const EB = dilate(erode(ebm, CW, CH, 1), CW, CH, 1);
    const isApt = (x, y) => { if (x < X0 || x > X1 || y < Y0 || y > Y1 || !ell(x, y, iris)) return false; const o = y * CW + x; return isScl(o) || (EB[o] && ebm[o]) || (inDisc(x, y) && !SKIN[o] && !BG[o] && !OUT[o]); };
    const reg = new Set(), q = [], seedA = (x, y) => { x = Math.round(x); y = Math.round(y); const o = y * CW + x; if (!reg.has(o) && isApt(x, y)) { reg.add(o); q.push([x, y]); } };
    seedA(iris[0], iris[1]); for (const p of used) { seedA(p[0] - p[2] * 1.5, p[1]); seedA(p[0] + p[2] * 1.5, p[1]); }
    while (q.length) { const [x, y] = q.pop(); for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { const n = ny * CW + nx; if (!reg.has(n) && isApt(nx, ny)) { reg.add(n); q.push([nx, ny]); } } }
    if (reg.size < 0.01 * IOD * IOD) { eyes[side] = { found: false, conf: 0, flags: ["no-aperture"] }; failures.push(`FC-EYE-${side}`); continue; }
    { const lq = []; for (const p of reg) { const x = p % CW, y = (p / CW) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const n = (y + dy) * CW + x + dx; if (dm[n] && !LINER[n]) { LINER[n] = 1; lq.push(n); } } }
      while (lq.length) { const p = lq.pop(), x = p % CW, y = (p / CW) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = (y + dy) * CW + x + dx; if (dm[n] && !LINER[n]) { LINER[n] = 1; lq.push(n); } } } }
    const cols = new Map(); for (const p of reg) { const x = p % CW, y = (p / CW) | 0; const c = cols.get(x) ?? [1e9, -1e9]; cols.set(x, [Math.min(c[0], y), Math.max(c[1], y)]); }
    const maxH = Math.max(...[...cols.values()].map((c) => c[1] - c[0] + 1)), xs = [...cols.keys()].filter((x) => cols.get(x)[1] - cols.get(x)[0] + 1 >= Math.max(2, 0.1 * maxH)).sort((a, b) => a - b);
    const xa = xs[0], xb = xs[xs.length - 1], w = xb - xa;
    // STRUCTURAL LIDS — a drawn lid line marks the boundary at its CENTRE LINE; its width is line weight (appearance).
    // Outward from the opening: no ink → the boundary is the opening edge; ink ≤ Smax thick ending in non-ink → a lid stroke;
    // ink running on beyond Smax → shading / hair, not a lid (boundary stays at the opening edge, flagged).
    // Over the iris, iris and stroke ink merge: the stroke's OUTER edge is still visible, so the lid = outer edge ∓ the
    // stroke half-width interpolated from the observed columns either side (inferred).
    const Smax = Math.round(0.09 * IOD), lid = { up: new Map(), dn: new Map() };
    const sclRef = (() => { const v = [...reg].filter((p) => isScl(p)).map((p) => Lc[p]).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length * 0.9)] : litL; })();
    for (const x of xs) { const [t, b] = cols.get(x);
      for (const [key, edge, dir] of [["up", t, -1], ["dn", b, 1]]) { const eo = edge * CW + x, merged = inDisc(x, edge) && [0, 1, 2].some((k) => { const o2 = (edge - dir * k) * CW + x; return isInk(o2) || (Lc[o2] > 0.9 * sclRef && !isScl(eo - dir * 2 * CW)); });
        if (merged) { let k2 = 0; while (k2 <= Smax && isInk((edge + dir * (k2 + 1)) * CW + x)) k2++; lid[key].set(x, { outer: k2 <= Smax ? edge + dir * k2 : edge, merged: true }); continue; }
        let k = 0; while (k <= Smax && isInk((edge + dir * (k + 1)) * CW + x)) k++;
        if (k === 0) lid[key].set(x, { y: edge + dir * 0.5, kind: "edge", obs: true });
        else if (k <= Smax) lid[key].set(x, { y: edge + dir * (k + 1) / 2, kind: "stroke", t: k, obs: true, outer: edge + dir * k });
        else lid[key].set(x, { y: edge + dir * 0.5, kind: "unbounded-dark", obs: true }); } }
    for (const key of ["up", "dn"]) { const M = lid[key], strokeXs = xs.filter((x) => M.get(x)?.kind === "stroke"), dir = key === "up" ? -1 : 1;
      for (const x of xs) { const v = M.get(x); if (!v?.merged) continue; const L = strokeXs.filter((s) => s < x).pop(), R = strokeXs.find((s) => s > x);
        const tl = L !== undefined ? M.get(L).t : null, tr = R !== undefined ? M.get(R).t : null, th = tl !== null && tr !== null ? tl + ((tr - tl) * (x - L)) / (R - L) : tl ?? tr;
        // no stroke anywhere on this lid → the iris ink meets skin directly: that IS the observed lid edge
        M.set(x, th === null ? { y: v.outer + dir * 0.5, kind: "edge", obs: !strokeXs.length } : { y: v.outer - dir * (th / 2 - 0.5), kind: "merged-inferred", obs: false, outer: v.outer }); } }
    const lidAt = (key, x) => { const M = lid[key]; const xr = Math.round(x); if (M.has(xr)) return M.get(xr); const near = xs.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)); return { ...M.get(near), obs: false }; };
    const U = Array.from({ length: 9 }, (_, k) => { const x = xa + (w * k) / 8, v = lidAt("up", x); return { p: [x, v.y], o: !!v.obs, kind: v.kind }; });
    const Lw = Array.from({ length: 9 }, (_, k) => { const x = xa + (w * k) / 8, v = lidAt("dn", x); return { p: [x, v.y], o: !!v.obs, kind: v.kind }; });
    // corner observability: opening that runs into hair / background / the search limit is not a corner
    const cornerAt = (x) => { const y = (lidAt("up", x).y + lidAt("dn", x).y) / 2; let bad = false; for (let dy = -3; dy <= 3; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = Math.round(y) + dy, o = yy * CW + xx; if (HAIR[o] || BG[o] || OUT[o]) bad = true; } if (x <= X0 + 1 || x >= X1 - 1 || !ell(x + Math.sign(x - iris[0]) * 3, y, iris)) bad = true; return { p: [x, y], ok: !bad }; };
    const cA = cornerAt(xa), cB = cornerAt(xb), inner = side === "R" ? cB : cA, outer = side === "R" ? cA : cB;
    U[0].p = [...cA.p]; Lw[0].p = [...cA.p]; U[8].p = [...cB.p]; Lw[8].p = [...cB.p];
    if (!inner.ok) flags.push("inner-corner-occluded"); if (!outer.ok) flags.push("outer-corner-occluded");
    const obsFrac = (U.filter((s) => s.o).length + Lw.filter((s) => s.o).length) / 18; if (obsFrac < 0.6) flags.push("lids-mostly-inferred");
    if ([...lid.up.values(), ...lid.dn.values()].some((v) => v.kind === "unbounded-dark")) flags.push("dark-beyond-lid");
    const openH = Math.max(...U.map((u, i) => Lw[i].p[1] - u.p[1]));
    const plausible = w > 0.25 * IOD && w < 0.95 * IOD && openH / w < 0.9; if (!plausible) flags.push("implausible-shape");
    const conf = !plausible ? 0.3 : Math.min(0.9, 0.35 + 0.25 * (inner.ok + outer.ok) + 0.1 * (obsFrac >= 0.6) + 0.1 * (irisConf >= 0.6) - 0.1 * !okFit);
    // APPEARANCE EVIDENCE (kept separately; never deforms the structure): line work (lid strokes, liner wings, lashes),
    // shading on the eyeball, highlights, under-eye shading / lines, lid crease, cel-shadow split across the eye.
    const runs = (test, ya, yb, xA0, xB0) => { const r = []; for (let y = Math.max(0, Math.round(ya)); y <= Math.min(CH - 1, Math.round(yb)); y++) { let s = -1; for (let x = Math.round(xA0); x <= Math.round(xB0) + 1; x++) { const on = x <= xB0 && test(x, y); if (on && s < 0) s = x; if (!on && s >= 0) { r.push([y, s, x - 1]); s = -1; } } } return r; };
    const upMin = Math.min(...U.map((u) => u.p[1])), dnMax = Math.max(...Lw.map((u) => u.p[1])), pad = 0.12 * IOD;
    const upAt = (x) => lidAt("up", x), dnAt = (x) => lidAt("dn", x);
    // line work is only what sits on / along the lid lines (band around the opening), never hair that the liner touches
    const regM = new Uint8Array(N); for (const p of reg) regM[p] = 1; const band = dilate(regM, CW, CH, Math.round(Smax + 0.12 * IOD));
    const linerThick = dilate(erode(LINER, CW, CH, Math.round(Smax / 2) + 1), CW, CH, Math.round(Smax / 2) + 1); // line work is stroke-thin; thick dark = hair
    const hueD = (o) => { const h = Math.atan2(Lab[o * 3 + 2], Lab[o * 3 + 1]), h0 = Math.atan2(tones[0].mean[2], tones[0].mean[1]); return Math.abs(((h - h0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); };
    const isAcc = (o) => !OUT[o] && !BG[o] && !HAIR[o] && !SKIN[o] && Lc[o] > Lstroke && chrom(o) > 0.5 * skinC && (chrom(o) > 1.3 * skinC || hueD(o) > Math.PI / 6);
    const accN = dilate((() => { const m = new Uint8Array(N); for (let y = Y0 - 20; y <= Y1 + 30; y++) for (let x = X0 - 10; x <= X1 + 10; x++) { const o = y * CW + x; if (o >= 0 && o < N && isAcc(o)) m[o] = 1; } return m; })(), CW, CH, 2);
    // thin horizontal marks only: keep components ≤ maxH tall and ≥ minW wide (eye bags / under-eye lines / creases);
    // tall blocks are cel-shadow or blush, accessory-adjacent pixels are frames
    const thinMarks = (test, ya, yb, xA0, xB0, maxHt, minW, minAspect = 2.5) => { const m = new Uint8Array(N); for (let y = Math.max(0, Math.round(ya)); y <= Math.min(CH - 1, Math.round(yb)); y++) for (let x = Math.round(xA0); x <= Math.round(xB0); x++) { const o = y * CW + x; if (!accN[o] && test(x, y)) m[o] = 1; }
      const cm = components(m, CW, CH), bb = {}; for (let y = Math.max(0, Math.round(ya)); y <= Math.min(CH - 1, Math.round(yb)); y++) for (let x = Math.round(xA0); x <= Math.round(xB0); x++) { const l = cm.L[y * CW + x]; if (!l) continue; const b = (bb[l] ??= [1e9, -1e9, 1e9, -1e9]); b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y); }
      const ok = new Set(Object.entries(bb).filter(([, b]) => b[3] - b[2] + 1 <= maxHt && b[1] - b[0] + 1 >= minW && (b[1] - b[0] + 1) / (b[3] - b[2] + 1) >= minAspect).map(([l]) => +l));
      return runs((x, y) => ok.has(cm.L[y * CW + x]), ya, yb, xA0, xB0); };
    const appearance = {
      lineWork: runs((x, y) => LINER[y * CW + x] === 1 && band[y * CW + x] === 1 && !linerThick[y * CW + x] && !inDisc(x, y), upMin - Smax - 4, dnMax + Smax, X0, X1),
      accessory: runs((x, y) => isAcc(y * CW + x) && !inDisc(x, y), upMin - 0.3 * IOD, dnMax + 0.3 * IOD, X0 - 10, X1 + 10),
      eyeballShade: runs((x, y) => reg.has(y * CW + x) && !inDisc(x, y) && Lc[y * CW + x] < sclRef - 15, upMin - 2, dnMax + 2, xa, xb),
      highlight: runs((x, y) => inDisc(x, y) && reg.has(y * CW + x) && Lc[y * CW + x] > 0.9 * sclRef, iris[1] - irisR, iris[1] + irisR, iris[0] - irisR, iris[0] + irisR),
      underEye: thinMarks((x, y) => { const o = y * CW + x, d = dnAt(Math.max(xa, Math.min(xb, x))); const base = (d.outer ?? d.y) + 2; return SKIN[o] && !LINER[o] && y > base && y < base + 0.3 * IOD && THb[o] > 5; }, dnMax, dnMax + 0.32 * IOD, xa - 0.05 * IOD, xb + 0.05 * IOD, Math.round(0.2 * IOD), Math.round(0.15 * IOD)),
      crease: thinMarks((x, y) => { const o = y * CW + x, u = upAt(Math.max(xa, Math.min(xb, x))); const top = (u.outer ?? u.y) - 2; return !LINER[o] && !HAIR[o] && !BG[o] && TH[o] > 10 && y < top && y > top - 0.22 * IOD; }, upMin - Smax - 0.25 * IOD, upMin, xa - pad / 2, xb + pad / 2, Math.round(0.05 * IOD), Math.round(0.12 * IOD)),
      strokeWeight: Object.fromEntries([["upper", lid.up], ["lower", lid.dn]].map(([k, M]) => { const t = [...M.values()].filter((v) => v.kind === "stroke").map((v) => v.t); return [k, t.length ? median(t) : null]; })),
      celSplit: (() => { const tn = new Set(); for (const x of [xa - 4, xb + 4]) for (const y of [Math.round((cA.p[1] + cB.p[1]) / 2)]) { const o = y * CW + x; if (tone[o] >= 0) tn.add(tone[o]); } return tn.size > 1; })(),
    };
    eyes[side] = { found: true, inner: inner.p, outer: outer.p, innerOk: inner.ok, outerOk: outer.ok, upper: U.map((s) => s.p), lower: Lw.map((s) => s.p), upperObs: U.map((s) => s.o), lowerObs: Lw.map((s) => s.o),
      upperKind: U.map((s) => s.kind), lowerKind: Lw.map((s) => s.kind), appearance,
      iris, irisR, irisConf, irisEdgePts: used.length, openingH: openH, area: reg.size, conf: +conf.toFixed(2), flags, unknown: [!inner.ok && "inner", !outer.ok && "outer"].filter(Boolean) };
  }
  // refined frame: iris centres + mouth (below)
  // --- mouth (dark lines / lips / teeth around the seed) ---
  let mouth = { found: false, conf: 0 };
  { const x0 = Math.floor(mouthMP[0] - 0.8 * IOD), x1 = Math.ceil(mouthMP[0] + 0.8 * IOD), y0 = Math.floor(P(0)[1] - 0.12 * EMmp), y1 = Math.ceil(P(17)[1] + 0.12 * EMmp);
    const isM0 = (o) => !OUT[o] && !BG[o] && !HAIR[o] && (THb[o] > 8 || (!SKIN[o] && Lc[o] > 75 && Math.hypot(Lab[o * 3 + 1], Lab[o * 3 + 2]) < 14));
    // FC-THIN-LINE-BREAK (learned from the noise test): a thin mouth line fragments at canonical scale and only its centre
    // was found. Bridge ≤ 4 px breaks (closing) inside the mouth window before growing.
    const mm0 = new Uint8Array(N); for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const o = y * CW + x; if (isM0(o)) mm0[o] = 1; }
    const mmC = erode(dilate(mm0, CW, CH, 2), CW, CH, 2), isM = (o) => mmC[o] === 1;
    // FC-SEED-OFF-FEATURE (learned): the detector's mouth centre sits low on a chibi face, so "nearest ink" picked lower-lip
    // shading. The mouth = the WIDEST horizontal ink structure in the window, only mildly weighted by detector proximity.
    const mc = components(mmC, CW, CH), mb = {};
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const l = mc.L[y * CW + x]; if (!l) continue; const b = (mb[l] ??= [1e9, -1e9, 0, 0, 0, y * CW + x]); b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] += x; b[3] += y; b[4]++; }
    let best = -1, bsc = 0;
    for (const b of Object.values(mb)) { const w = b[1] - b[0] + 1; if (w < 0.15 * IOD) continue; const d = Math.hypot(b[2] / b[4] - mouthMP[0], b[3] / b[4] - mouthMP[1]), sc = w * (1 - 0.5 * Math.min(1, d / (0.4 * IOD))); if (sc > bsc) { bsc = sc; best = b[5]; } }
    if (best >= 0) {
      const reg = new Set([best]), q = [best];
      while (q.length) { const p = q.pop(), x = p % CW, y = (p / CW) | 0; for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue; const n = ny * CW + nx; if (!reg.has(n) && isM(n)) { reg.add(n); q.push(n); } } }
      const cols = new Map(); for (const p of reg) { const x = p % CW, y = (p / CW) | 0; const cc = cols.get(x) ?? [1e9, -1e9]; cols.set(x, [Math.min(cc[0], y), Math.max(cc[1], y)]); }
      // FC-TAPER-END (learned from the noise test): a tapering mouth line's end moved under blur with a fixed threshold.
      // Corners = outermost columns whose ink strength stays ≥ 35% of the median strength of the central third.
      const allXs = [...cols.keys()].sort((a, b) => a - b), strength = new Map(); for (const p of reg) { const x = p % CW; strength.set(x, Math.max(strength.get(x) ?? 0, THb[p])); }
      const c0 = allXs[0], c1 = allXs[allXs.length - 1], midS = median(allXs.filter((x) => x > c0 + (c1 - c0) / 3 && x < c1 - (c1 - c0) / 3).map((x) => strength.get(x))), keepX = allXs.filter((x) => strength.get(x) >= 0.35 * midS);
      // and (as for eyes) ignore columns thinner than 20% of the mouth's thickest column — smile creases / corner flicks
      const thick = (x) => cols.get(x)[1] - cols.get(x)[0] + 1, maxTh = Math.max(...allXs.map(thick)), keep2 = keepX.filter((x) => thick(x) >= 0.2 * maxTh);
      const xs = keep2.length > 4 ? keep2 : keepX.length > 4 ? keepX : allXs, xa = xs[0], xb = xs[xs.length - 1], colAt = (x) => cols.get(xs.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)));
      const upper = [], lower = []; for (let k = 0; k <= 6; k++) { const x = xa + ((xb - xa) * k) / 6, cc = colAt(x); upper.push([x, cc[0]]); lower.push([x, cc[1]]); }
      const touches = [...reg].some((p) => { const x = p % CW, y = (p / CW) | 0; return x <= x0 || x >= x1 || y <= y0 || y >= y1; });
      mouth = { found: true, cornerR: [xa, (colAt(xa)[0] + colAt(xa)[1]) / 2], cornerL: [xb, (colAt(xb)[0] + colAt(xb)[1]) / 2], upper, lower, area: reg.size, conf: touches ? 0.45 : 0.85, touchesBox: touches };
    } else failures.push("FC-MOUTH");
  }
  // --- brows (top-hat ink above each measured eye, hair excluded) ---
  const brows = {};
  for (const side of ["R", "L"]) {
    const e = eyes[side]; if (!e.found) { brows[side] = { found: false, conf: 0 }; continue; }
    const eyeTop = Math.min(...e.upper.map((p) => p[1])), inX = e.inner[0], outX = e.outer[0], dir = Math.sign(outX - inX);
    const xA = Math.round(Math.min(inX - dir * 0.12 * IOD, outX + dir * 0.28 * IOD)), xB = Math.round(Math.max(inX - dir * 0.12 * IOD, outX + dir * 0.28 * IOD));
    const yA = Math.round(eyeTop - 0.65 * IOD), yB = Math.round(eyeTop - 0.03 * IOD);
    const m = new Uint8Array(N); for (let y = Math.max(0, yA); y <= yB; y++) for (let x = Math.max(0, xA); x <= Math.min(CW - 1, xB); x++) { const o = y * CW + x; if (!OUT[o] && !BG[o] && !HAIR[o] && !LINER[o] && TH[o] > 10) m[o] = 1; }
    const cm = components(dilate(erode(m, CW, CH, 2), CW, CH, 2), CW, CH); let bestL = 0, bs = 0; const ex = {}; // FC-FEATURE-LEAK
    for (let o = 0; o < N; o++) { const l = cm.L[o]; if (!l) continue; const x = o % CW, y = (o / CW) | 0; const b = (ex[l] ??= [1e9, -1e9, 1e9, -1e9, 0]); b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y); b[4]++; }
    for (const [l, b] of Object.entries(ex)) { const w = b[1] - b[0] + 1, h = b[3] - b[2] + 1; if (b[4] < 0.015 * IOD * IOD) continue; const s = b[4] * Math.min(1, w / h / 2.5); if (s > bs) { bs = s; bestL = +l; } }
    if (!bestL) { brows[side] = { found: false, conf: 0 }; failures.push(`FC-BROW-${side}`); continue; }
    const b = ex[bestL], top = [], bot = [];
    // FC-BROW-MERGE (learned in the eye refinement): brow ink merged with hair / frames / shading shows as columns that reach
    // the search ceiling or are far thicker than the brow's own median. Keep the longest clean run; trimmed ends are flagged.
    const cs = []; for (let x = b[0]; x <= b[1]; x++) { let t = 1e9, u = -1e9; for (let y = b[2]; y <= b[3]; y++) if (cm.L[y * CW + x] === bestL) { t = Math.min(t, y); u = Math.max(u, y); } if (t < 1e9) cs.push([x, t, u]); }
    const mth = median(cs.map((c) => c[2] - c[1] + 1));
    // brows taper (thick head, thin tail), so only gross departures count: > 2× median thickness, or > 0.6× median off the
    // robust smooth top/bottom edge, or touching the search ceiling.
    let gsel = cs.filter((c) => c[1] > yA + 1 && c[2] - c[1] + 1 <= 2 * mth), fTop = null, fBot = null;
    for (let it = 0; it < 3 && gsel.length >= 5; it++) { fTop = quad(gsel.map((c) => [c[0], c[1]])); fBot = quad(gsel.map((c) => [c[0], c[2]])); gsel = cs.filter((c) => c[1] > yA + 1 && c[2] - c[1] + 1 <= 2 * mth && Math.abs(c[1] - fTop(c[0])) <= 0.6 * mth && Math.abs(c[2] - fBot(c[0])) <= 0.6 * mth); }
    const gset = new Set(gsel.map((c) => c[0])), good = cs.map((c) => gset.has(c[0]));
    let best0 = 0, bestLen = 0; for (let i = 0; i < cs.length; ) { if (!good[i]) { i++; continue; } let j = i; while (j + 1 < cs.length && good[j + 1]) j++; if (j - i + 1 > bestLen) { bestLen = j - i + 1; best0 = i; } i = j + 1; }
    const run = cs.slice(best0, best0 + bestLen), trimmedA = best0 > 0, trimmedB = best0 + bestLen < cs.length;
    for (let k = 0; k <= 5; k++) { const c = run[Math.round((run.length - 1) * (0.04 + 0.92 * k / 5))]; top.push([c[0], c[1]]); bot.push([c[0], c[2]]); }
    const touches = run[0][0] <= xA || run[run.length - 1][0] >= xB, endFlags = [trimmedA && (side === "R" ? "outer" : "inner"), trimmedB && (side === "R" ? "inner" : "outer")].filter(Boolean);
    brows[side] = { found: true, top, bottom: bot, area: b[4], conf: touches || run.length < 0.6 * cs.length ? 0.5 : endFlags.length ? 0.7 : 0.85, touchesBox: touches, trimmedEnds: endFlags };
  }
  // --- nose base (top-hat ink between eyes and mouth) ---
  let nose = { found: false, conf: 0 };
  { const nx = P(MP.noseTip)[0], y0 = Math.round(CY + 0.35 * EMmp), y1 = Math.round((mouth.found ? Math.min(...mouth.upper.map((p) => p[1])) : P(0)[1]) - 0.08 * EMmp); // FC-NOSE-MOUTH-CROSSTALK
    // FC-NOSE-ACCESSORY (learned): glasses rims / blush edges / cheek lines enter the nose window from the sides. Keep only
    // ink components that do not touch the window's side walls and are no wider than a plausible nose base.
    const xa0 = Math.round(nx - 0.45 * IOD), xb0 = Math.round(nx + 0.45 * IOD), nm = new Uint8Array(N);
    for (let y = y0; y <= y1; y++) for (let x = xa0; x <= xb0; x++) { const o = y * CW + x; if (!OUT[o] && !BG[o] && !HAIR[o] && TH[o] > 14) nm[o] = 1; }
    const ncmp = components(nm, CW, CH), nb = {}; for (let y = y0; y <= y1; y++) for (let x = xa0; x <= xb0; x++) { const l = ncmp.L[y * CW + x]; if (!l) continue; const b = (nb[l] ??= [1e9, -1e9, 0]); b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2]++; }
    // FC-NOSE-SCATTER (learned from the noise test): stray shading specks far from the midline flipped the width 0.6↔0.2.
    // The nose base = compact ink components whose centre lies within ±0.3 IOD of the nose axis, in the lowest 0.3·EM band.
    for (let y = y0; y <= y1; y++) for (let x = xa0; x <= xb0; x++) { const l = ncmp.L[y * CW + x]; if (l) { const b = nb[l]; b[3] = (b[3] ?? 0) + x; b[4] = Math.max(b[4] ?? -1, y); } }
    let okC = new Set(Object.entries(nb).filter(([, b]) => b[0] > xa0 && b[1] < xb0 && b[1] - b[0] < 0.8 * IOD && b[2] >= 6 && Math.abs(b[3] / b[2] - nx) < 0.3 * IOD).map(([l]) => +l));
    const lowest = Math.max(-1, ...[...okC].map((l) => nb[l][4])); okC = new Set([...okC].filter((l) => nb[l][4] > lowest - 0.3 * EMmp));
    const pts = []; for (let y = y0; y <= y1; y++) for (let x = xa0; x <= xb0; x++) if (okC.has(ncmp.L[y * CW + x])) pts.push([x, y]);
    const cen = pts.filter((p) => Math.abs(p[0] - nx) < 0.3 * IOD);
    if (cen.length > 15) { const bottom = Math.max(...cen.map((p) => p[1])), band = pts.filter((p) => p[1] > bottom - 0.25 * EMmp && p[1] <= bottom);
      const xs = band.map((p) => p[0]).sort((a, b) => a - b), xL = xs[Math.floor(xs.length * 0.02)], xR = xs[Math.ceil(xs.length * 0.98) - 1];
      nose = { found: true, wingR: [xL, median(band.filter((p) => p[0] < xL + 4).map((p) => p[1]))], wingL: [xR, median(band.filter((p) => p[0] > xR - 4).map((p) => p[1]))], base: [(xL + xR) / 2, bottom], inkPx: pts.length, conf: band.length > 40 ? 0.8 : 0.5 }; }
    else failures.push("FC-NOSE"); }

  // --- hair silhouette (separate layer) + hairline / fringe edge ---
  const hcen = [CX, CY - 0.35 * IOD], hairRays = [];
  for (let k = 0; k < 72; k++) { const th = (2 * Math.PI * k) / 72, d = [Math.cos(th), Math.sin(th)]; let far = null, gap = 0, seen = false, cut = false;
    for (let t = 0; t < 4.5 * IOD; t += 1) { const x = Math.round(hcen[0] + d[0] * t), y = Math.round(hcen[1] + d[1] * t); if (x < 0 || y < 0 || x >= CW || y >= CH || OUT[y * CW + x]) { cut = seen && gap < 0.1 * IOD; break; }
      if (HAIR[y * CW + x]) { far = t; seen = true; gap = 0; } else if (seen) { gap++; if (gap > 0.3 * IOD) break; } }
    const pt = far === null ? null : [hcen[0] + d[0] * far, hcen[1] + d[1] * far];
    hairRays.push({ k, th, r: far, pt, label: far === null ? "none" : cut ? "cut-off" : pt[1] > (mouthY + EMmp * 0.9) ? "merged-below-chin" : "hair", conf: far === null ? 0.7 : cut ? 0 : pt[1] > mouthY + EMmp * 0.9 ? 0.3 : 0.85 }); }
  // fringe / hair-face boundary across the forehead: first HAIR→face-skin transition walking down each column
  const faceXs = rays.filter((r) => Math.abs(r.pt[1] - CY) < 0.5 * IOD).map((r) => r.pt[0]), fxa = Math.min(...faceXs), fxb = Math.max(...faceXs), hairline = [];
  for (let k = 0; k <= 10; k++) { const x = Math.round(fxa + ((fxb - fxa) * (0.05 + 0.9 * k / 10))); let y = Math.max(0, Math.round(CY - 2.6 * IOD)), sawHair = false, yy = null, bald = false;
    for (; y < CY; y++) { const o = y * CW + x; if (OUT[o]) continue; if (HAIR[o]) sawHair = true; else if (SKIN[o] && Kface.has(sc.L[o])) { yy = y; bald = !sawHair; break; } }
    hairline.push({ x, y: yy, kind: yy === null ? "no-skin-above-eyes" : bald ? "scalp-or-bald" : "hair-edge", conf: yy === null ? 0 : 0.85 }); }

  return { rep: { status: failures.length ? "PARTIAL" : "OK", failures, notes: notes.slice(0, 8), seeds: { centre: c, mouthMP, EMmp, browTopMP }, skinTones: tones.map((t) => ({ lab: t.mean.map(r1), share: r1(t.share) })), rejectedTones: E.rejectedTones,
    contour: rays.map((r) => ({ i: r.i, th: r1(r.th), r: r1(r.r), pt: r.pt.map(r1), label: r.label, conf: r.conf, beyond: r.beyond })),
    eyes, brows, nose, mouth, hairRays: hairRays.map((h) => ({ ...h, th: r1(h.th), r: h.r, pt: h.pt?.map(r1) })), hairline, hairCentre: hcen },
    HAIR, Hm };
}
