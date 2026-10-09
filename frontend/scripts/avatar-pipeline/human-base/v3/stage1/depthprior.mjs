// v3/stage1/depthprior.mjs — IDENTITY-CONDITIONED DEPTH PRIOR (Stage 1 volume pass). One generalized linear model:
//   observables  o_j  = scale-free traits measured on the Stage 0 representation (normalised frame; hidden contour → the
//                       mirrored observed side, else unknown ⇒ z = 0 = population mean)
//   z_j               = (o_j − population mean) / population std   (population = every Stage 0 sprite; clamped ±2.5)
//   volume field  φ_k = a smooth, region-localised displacement basis on the canonical topology (Gaussian weight × front
//                       mask × direction), centred on the WARPED canonical landmarks
//   amplitude     a_k = A_k · Σ_j W_kj z_j        Δ = Σ_k a_k φ_k
// W encodes general facial-anthropometry / Offshorly style relationships (sign + relative weight), never a person. Fields
// that INFER hidden depth move only in Z (or along the normal behind the silhouette), so the observed frontal silhouette
// transferred by the 2D stage is never contradicted. Nose width is the only observed interior X change.

/** observables from a Stage 1 representation r (see build.mjs rep()) */
export function observables(r, contourPt, chinOf, extra = {}) {
  const pts = Array.from({ length: 72 }, (_, g) => contourPt(r, g)?.q ?? null);
  const W = (y) => { let l = null, rr = null; for (let g = 0; g < 72; g++) { const a = pts[g], b = pts[(g + 1) % 72]; if (!a || !b || (a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
    const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]); if (x < 0) l = l === null ? x : Math.min(l, x); else rr = rr === null ? x : Math.max(rr, x); } return l !== null && rr !== null ? rr - l : null; };
  const mY = r.mouthC[1], cY = chinOf(r)?.[1] ?? null, iodN = r.eyes.R && r.eyes.L ? r.eyes.L.c[0] - r.eyes.R.c[0] : null;
  const Wcb = W(0.4 * mY), Wck = W(0.75 * mY), Wm = W(mY), Wj = cY ? W(mY + 0.5 * (cY - mY)) : null, Wc = cY ? W(mY + 0.85 * (cY - mY)) : null, Wt = W(-0.25);
  const div = (a, b) => (a !== null && b !== null && b ? a / b : null), eyes = [r.eyes.R, r.eyes.L].filter(Boolean), brows = [r.brows.R, r.brows.L].filter(Boolean);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const browGap = eyes.length && brows.length ? (() => { const v = []; for (const [e, b] of [[r.eyes.R, r.brows.R], [r.eyes.L, r.brows.L]]) if (e && b) v.push(Math.min(...e.upper.map((q) => q[1])) - Math.max(...b.bottom.map((q) => q[1]))); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; })() : null;
  return {
    aspect: div(cY, Wcb), chinLen: cY !== null ? (cY - mY) / mY : null, lowerLen: cY, angular: div(Wcb, Wj), chinPoint: div(Wc, Wj),
    cheekBulge: Wck !== null && Wcb !== null && Wm !== null ? (Wck - (Wcb + Wm) / 2) / Wcb : null, jawW: div(Wj, Wcb), templeW: div(Wt, Wcb),
    noseLen: r.nose ? r.nose.base[1] / mY : null, noseW: r.nose && iodN ? (r.nose.wingL[0] - r.nose.wingR[0]) / iodN : null,
    lipH: r.mouth ? r.mouth.lower[3][1] - r.mouth.upper[3][1] : null, mouthW: r.mouth && iodN ? (r.mouth.cL[0] - r.mouth.cR[0]) / iodN : null,
    browGap, browThick: brows.length ? med(brows.flatMap((b) => b.top.map((q, i) => b.bottom[i][1] - q[1]))) : null,
    eyeOpen: eyes.length ? eyes.reduce((a, e) => a + Math.max(...e.lower.map((q, i) => q[1] - e.upper[i][1])) / Math.abs(e.outer[0] - e.inner[0]), 0) / eyes.length : null,
    foreheadH: extra.foreheadH ?? null,
    // eye + lip GEOMETRY observables (sculpture basis): width, tilt (outer corner up = +), inner-corner gap, lip thicknesses
    eyeW: eyes.length && iodN ? eyes.reduce((a, e) => a + Math.abs(e.outer[0] - e.inner[0]), 0) / eyes.length / iodN : null,
    eyeTilt: eyes.length ? eyes.reduce((a, e) => a + Math.atan2(e.inner[1] - e.outer[1], Math.abs(e.outer[0] - e.inner[0])), 0) / eyes.length : null,
    innerGap: r.eyes.R && r.eyes.L && iodN ? (r.eyes.L.inner[0] - r.eyes.R.inner[0]) / iodN : null,
    upperLip: r.mouth ? (r.mouth.cR[1] + r.mouth.cL[1]) / 2 - r.mouth.upper[3][1] : null,
    lowerLip: r.mouth ? r.mouth.lower[3][1] - (r.mouth.cR[1] + r.mouth.cL[1]) / 2 : null,
  };
}
export function zscores(o, pop) {
  const z = {}; for (const k of Object.keys(o)) { const v = pop.map((p) => p[k]).filter((x) => typeof x === "number" && Number.isFinite(x)); if (v.length < 5 || typeof o[k] !== "number") { z[k] = 0; continue; }
    const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length) || 1; z[k] = Math.max(-2.5, Math.min(2.5, (o[k] - m) / sd)); }
  return z;
}
// W: field ← observables (sign + relative weight). Derived drives first.
export function drives(z) {
  const browRidge = -z.browGap + 0.3 * z.browThick;
  return {
    noseProj: 0.6 * z.noseLen - 0.3 * z.noseW + 0.3 * z.aspect,     // longer, narrower noses on longer faces project more
    noseRoot: 0.5 * z.noseLen + 0.5 * browRidge,                      // the root follows nose length and the brow ridge
    noseWidth: z.noseW,                                                // OBSERVED (interior X)
    browRidge,                                                         // small brow→eye gap / heavy brow = prominent ridge
    eyeSocket: 0.6 * browRidge - 0.4 * z.eyeOpen,                      // deep-set under a heavy ridge; wide-open eyes sit forward
    cheekbone: 0.7 * z.angular + 0.3 * z.aspect,                       // angular (cheek ≫ jaw) faces carry projecting zygomas
    cheekFull: z.cheekBulge - 0.4 * z.aspect,                          // a convex cheek contour / rounder face = fuller cheeks
    midface: z.aspect,                                                 // long faces project in the mid-face
    muzzle: 0.5 * z.lipH + 0.3 * z.mouthW + 0.2 * z.lowerLen,          // full lips / wide mouth = forward muzzle
    lips: z.lipH,
    chinProj: 0.6 * z.chinLen - 0.4 * z.chinPoint,                     // long, pointed chins project
    jawTaper: -0.6 * z.jawW - 0.4 * z.chinPoint,                       // tapered jaw: gonial region swings forward (V in 3D)
    temple: z.templeW,
    forehead: 0.5 * z.foreheadH,                                       // hair-dependent observable → low weight
  };
}
// canonical-unit amplitudes per drive unit (style prior strength); head ≈ 0.9 units tall
export const AMP = { noseProj: 0.014, noseRoot: 0.009, noseWidth: 0.16, browRidge: 0.010, eyeSocket: 0.008, cheekbone: 0.012, cheekFull: 0.012, midface: 0.010, muzzle: 0.010, lips: 0.006, chinProj: 0.016, jawTaper: 0.012, temple: 0.008, forehead: 0.010 };

/** Δ field on the (already 2D-warped) canonical X; returns displaced copy + per-field log */
export function applyDepthPrior(X, N, tpl, d, gain = 1, freeze = null, only = null) {
  const TL = tpl.landmarks, RG = tpl.REGION, n = tpl.n, at = (i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], out = Float32Array.from(X);
  const eyeY = (at(TL.eyeL)[1] + at(TL.eyeR)[1]) / 2, mouth = at(TL.mouth), nose = at(TL.noseTip), chin = at(TL.chin);
  const front = (x, y) => { let best = null, bz = -9; for (let i = 0; i < n; i++) { if (Math.abs(X[i * 3] - x) > 0.012 || Math.abs(X[i * 3 + 1] - y) > 0.012) continue; if (X[i * 3 + 2] > bz) { bz = X[i * 3 + 2]; best = at(i); } } return best ?? [x, y, 0.3]; };
  const ear = (i) => tpl.region[i] === RG.earL || tpl.region[i] === RG.earR, fm = (i, lo = 0.05, hi = 0.45) => { const t = Math.min(1, Math.max(0, (N[i * 3 + 2] - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  const F = [
    ["noseProj", [nose], 0.05, "z"], ["noseRoot", [front(0, eyeY - 0.015)], 0.04, "z"], ["browRidge", [front(-0.17, eyeY + 0.085), front(0.17, eyeY + 0.085)], 0.05, "z"],
    ["eyeSocket", [at(TL.eyeL), at(TL.eyeR)], 0.04, "-z"], ["cheekbone", [front(-0.24, eyeY - 0.09), front(0.24, eyeY - 0.09)], 0.06, "n"], ["cheekFull", [front(-0.19, mouth[1] + 0.07), front(0.19, mouth[1] + 0.07)], 0.065, "z"],
    ["midface", [front(0, (eyeY + mouth[1]) / 2)], 0.1, "z"], ["muzzle", [mouth], 0.06, "z"], ["lips", [mouth], 0.03, "z"], ["chinProj", [chin], 0.05, "z"],
    ["jawTaper", [at(TL.jawL), at(TL.jawR)], 0.07, "z"], ["temple", [at(TL.templeL), at(TL.templeR)], 0.06, "n"], ["forehead", [at(TL.forehead)], 0.12, "z"],
  ];
  const log = {};
  for (const [k, cens, sg, dir] of F) { if (only && !only.includes(k)) continue; const a = gain * AMP[k] * d[k]; log[k] = +a.toFixed(4); if (!a) continue;
    for (let i = 0; i < n; i++) { if (ear(i)) continue; let w = 0; for (const c of cens) w = Math.max(w, Math.exp(-((X[i * 3] - c[0]) ** 2 + (X[i * 3 + 1] - c[1]) ** 2 + (X[i * 3 + 2] - c[2]) ** 2) / (2 * sg * sg)));
      if (w < 1e-4) continue; const m = dir === "n" ? fm(i, -0.2, 0.3) : fm(i); if (!m) continue;
      if (dir === "n") { for (let q = 0; q < 3; q++) out[i * 3 + q] += a * w * m * N[i * 3 + q]; } else out[i * 3 + 2] += (dir === "-z" ? -a : a) * w * m; } }
  // nose width (OBSERVED): interior X scale of the nose about its axis, lower nose weighted
  { const k = gain * AMP.noseWidth * d.noseWidth; log.noseWidth = +k.toFixed(4);
    for (let i = 0; i < n; i++) { const w = Math.exp(-((X[i * 3] - nose[0]) ** 2 + ((X[i * 3 + 1] - nose[1] + 0.01) ** 2) * 1.5 + (X[i * 3 + 2] - nose[2]) ** 2) / (2 * 0.035 * 0.035)); if (w < 1e-4) continue; out[i * 3] += (X[i * 3] - nose[0]) * k * w * fm(i); } }
  // the Offshorly face is smooth: the SUM of fields is relaxed over the surface (umbrella smoothing of the displacement only,
  // never of the shape) so overlapping opposite-sign fields cannot leave lumps
  { const D = new Float32Array(out.length), T2 = new Float32Array(out.length); for (let i = 0; i < out.length; i++) D[i] = out[i] - X[i];
    for (let it = 0; it < 12; it++) { T2.set(D); for (let i = 0; i < n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb) a += T2[j * 3 + q]; D[i * 3 + q] = 0.5 * T2[i * 3 + q] + 0.5 * a / nb.length; } } }
    if (freeze) for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) D[i * 3 + q] *= freeze[i];   // smooth taper toward the ears
    for (let i = 0; i < out.length; i++) out[i] = X[i] + D[i]; }
  return { X: out, log };
}
