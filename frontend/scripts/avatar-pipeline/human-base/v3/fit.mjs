// v3/fit.mjs — HumanBase V3 proof: IDENTITY FITTING of the canonical head. ZERO CREDITS.
// The canonical topology never changes; only its vertex positions move (bounded, regularised), so every structural
// property of the template (closed skull, ears, sockets, single manifold, UVs, landmarks) is inherited by construction.
import fs from "node:fs";
import { TriIndex, deform, insideLoopXY, neighbours, rbfWarp, triNormal, vertexNormals } from "./geom.mjs";

export function loadTemplate(file = "scripts/avatar-pipeline/output/human-base/v3-proof/template/canonical-head-v3p.json") {
  const t = JSON.parse(fs.readFileSync(file, "utf8"));
  t.P = Float32Array.from(t.P); t.I = Uint32Array.from(t.I); t.region = Uint8Array.from(t.region); t.n = t.P.length / 3;
  t.nb = neighbours(t.I, t.n); t.N = vertexNormals(t.P, t.I);
  t.uv.I = Uint32Array.from(t.uv.I); t.uv.UV = Float32Array.from(t.uv.UV); t.uv.src = Int32Array.from(t.uv.src);
  return t;
}
const v3 = (A, i) => [A[i * 3], A[i * 3 + 1], A[i * 3 + 2]];

/** similarity (Umeyama, uniform scale) mapping point set A → B; returns apply(p) */
export function similarity(A, B) {
  const n = A.length, ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) { ca[q] += A[i][q] / n; cb[q] += B[i][q] / n; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let va = 0;
  for (let i = 0; i < n; i++) { const a = A[i].map((x, q) => x - ca[q]), b = B[i].map((x, q) => x - cb[q]); va += a[0] ** 2 + a[1] ** 2 + a[2] ** 2; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += b[r] * a[c] / n; }
  // polar decomposition of S by iteration (R = S (SᵀS)^-1/2) — robust for these small, well-conditioned sets
  let R = S.map((r) => r.slice()); for (let it = 0; it < 60; it++) { const inv = inv3(R), Rt = [[inv[0][0], inv[1][0], inv[2][0]], [inv[0][1], inv[1][1], inv[2][1]], [inv[0][2], inv[1][2], inv[2][2]]]; R = R.map((r, i) => r.map((x, j) => 0.5 * (x + Rt[i][j]))); }
  let tr = 0; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tr += R[r][c] * S[r][c];
  const s = tr / (va / n);
  return { s, R, apply: (p) => { const a = [p[0] - ca[0], p[1] - ca[1], p[2] - ca[2]]; return [0, 1, 2].map((r) => cb[r] + s * (R[r][0] * a[0] + R[r][1] * a[1] + R[r][2] * a[2])); } };
}
function inv3(m) { const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2], A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]; }

// identity lives in the whole face SILHOUETTE too (cheeks, temples, jaw, chin underside): full data weight wherever the
// evidence has skin — a weak weight there lets the canonical width survive (the 'normalised face' failure)
// EVIDENCE decides participation, not the template's region labels: a canonical 'scalp' vertex sitting where the person
// has skin (a tall forehead, a receding hairline, a bald head) is fitted like face. Regions only set the weight.
const DATA = (R, REG) => (R === REG.nose || R === REG.mouth ? 1.6 : R === REG.face || R === REG.eyeL || R === REG.eyeR ? 1 : R === REG.jaw ? 1.2 : R === REG.under ? 0.5 : R === REG.side ? 1 : R === REG.nape ? 0.8 : R === REG.scalp ? 1 : 0);

/** fit the canonical head to 3D evidence (skin surface + landmarks). Returns fitted positions + diagnostics. */
export function fit3D(tpl, ev, { stages = [30, 12, 5, 2, 0.8, 0.35, 0.15], maxD = 0.08, ceil = true } = {}) {
  const { n, P: X0, I, nb, region: R, REGION: REG, landmarks: TL } = tpl, sk = ev.skin, L = ev.fitLandmarks ?? ev.landmarks;
  // ---- ears: template ear construction, placed + sized by the evidence's own ear landmarks (similarity per side)
  const earT = new Float32Array(n * 3), isEar = new Uint8Array(n), earFit = {};
  for (const s of ["l", "r"]) {
    const S = s.toUpperCase(), keys = ["root", "top", "lobe", "outer", "back"], e = L.attach?.ears?.[s];
    if (!e) continue;
    // translation of the measured ear centre + uniform scale from ear height, bounded to the family band (no rotation:
    // the template ear's construction and orientation are the style; the evidence only places and sizes it)
    const cen = (pts) => [0, 1, 2].map((q) => (pts[0][q] + pts[1][q] + pts[2][q] + pts[3][q]) / 4);
    const A = ["top", "lobe", "outer", "back"].map((k) => v3(X0, TL[`ear${S}${k}`])), B = ["top", "lobe", "outer", "back"].map((k) => e[k]);
    const ca = cen(A), cb = cen(B), sc = Math.min(1.4, Math.max(0.5, (B[0][1] - B[1][1]) / Math.max(1e-6, A[0][1] - A[1][1])));
    const sim = { s: sc, apply: (p) => [0, 1, 2].map((q) => cb[q] + sc * (p[q] - ca[q])) }; earFit[s] = { scale: +sc.toFixed(4), move: cb.map((v, q) => +(v - ca[q]).toFixed(4)) };
    const want = s === "l" ? REG.earL : REG.earR;
    for (let i = 0; i < n; i++) if (R[i] === want) { isEar[i] = 1; const q = sim.apply(v3(X0, i)); earT[i * 3] = q[0]; earT[i * 3 + 1] = q[1]; earT[i * 3 + 2] = q[2]; }
  }
  // ---- landmark targets on the evidence skin
  const proj = (p) => { const q = sk.index.closest(p[0], p[1], p[2], 0.15); return q ? [q.x, q.y, q.z] : p; };
  const lmT = [];
  if (L.eyes) { lmT.push([TL.eyeL, proj(L.eyes.l)], [TL.eyeR, proj(L.eyes.r)]); }
  if (L.mouth) lmT.push([TL.mouth, proj(L.mouth.c)]);
  if (L.attach?.nose?.tip) lmT.push([TL.noseTip, proj(L.attach.nose.tip)]);
  if (ev.chin) lmT.push([TL.chin, ev.chin]);
  // ---- 1. COARSE: a smooth landmark-driven warp (Gaussian RBF) moves the large structures (eyes, mouth, nose, chin,
  // ears) to the evidence's layout while the cranium stays canonical (zero-displacement anchors) — large moves done
  // smoothly, so the detail fit afterwards only has small residuals to resolve
  const cen = [], dis = [];
  for (const [vi, p] of lmT) { cen.push(v3(X0, vi)); dis.push([p[0] - X0[vi * 3], p[1] - X0[vi * 3 + 1], p[2] - X0[vi * 3 + 2]]); }
  for (const s of ["l", "r"]) { const S = s.toUpperCase(), e = L.attach?.ears?.[s]; if (!e) continue;
    for (const k of ["top", "lobe", "outer", "back"]) { const vi = TL[`ear${S}${k}`], q = earT.subarray(vi * 3, vi * 3 + 3); cen.push(v3(X0, vi)); dis.push([q[0] - X0[vi * 3], q[1] - X0[vi * 3 + 1], q[2] - X0[vi * 3 + 2]]); } }
  for (const k of ["crown", "occiput", "nape"]) { cen.push(v3(X0, TL[k])); dis.push([0, 0, 0]); }
  { const cz = tpl.centre; for (const [x, y, z] of [[0.3, cz[1] + 0.25, cz[2] - 0.15], [-0.3, cz[1] + 0.25, cz[2] - 0.15], [0.25, cz[1] + 0.05, cz[2] - 0.3], [-0.25, cz[1] + 0.05, cz[2] - 0.3], [0, cz[1] + 0.35, cz[2] + 0.15]]) {
    const vi = tpl.P.reduce ? null : null; void vi; let b = -1, d = Infinity; for (let i = 0; i < n; i++) { const e2 = (X0[i * 3] - x) ** 2 + (X0[i * 3 + 1] - y) ** 2 + (X0[i * 3 + 2] - z) ** 2; if (e2 < d) { d = e2; b = i; } } cen.push(v3(X0, b)); dis.push([0, 0, 0]); } }
  // A FOLD is a local inversion — a triangle facing against its own neighbourhood in the fitted surface — or a collapse
  // (area < 4 % of the template's). Large but consistent rotations (lip corners, nostrils) are not folds.
  const triAdj = (() => { const E = new Map(), A = Array.from({ length: I.length / 3 }, () => []); for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3], key = a < b ? a * n + b : b * n + a; const o = E.get(key); if (o === undefined) E.set(key, t); else { A[t].push(o); A[o].push(t); } } return A; })();
  const foldList = (Y) => { const nT = I.length / 3, Nt = new Float32Array(nT * 4); for (let t = 0; t < nT; t++) Nt.set(triNormal(Y, I, t), t * 4);
    const out = []; for (let t = 0; t < nT; t++) { let ax = 0, ay = 0, az = 0; for (const u of triAdj[t]) { ax += Nt[u * 4]; ay += Nt[u * 4 + 1]; az += Nt[u * 4 + 2]; } const l = Math.hypot(ax, ay, az) || 1;
      const d = (Nt[t * 4] * ax + Nt[t * 4 + 1] * ay + Nt[t * 4 + 2] * az) / l, a0 = triNormal(X0, I, t)[3]; if (d < -0.2 || Nt[t * 4 + 3] < 0.04 * a0) out.push(t); } return out; };
  const flips = (Y) => foldList(Y).length;
  const ctr = [0, (X0[TL.earLroot * 3 + 1] + X0[TL.earRroot * 3 + 1]) / 2, (X0[TL.earLroot * 3 + 2] + X0[TL.earRroot * 3 + 2]) / 2];
  // the smallest fold-free falloff (deterministic ladder): local enough to keep the cranium canonical, wide enough that
  // the eye/ear moves never fold the surface
  let XW = null, sigma = null; for (const sg of [0.13, 0.18, 0.24, 0.32]) { const W2 = rbfWarp(X0, cen, dis, sg); if (!flips(W2)) { XW = W2; sigma = sg; break; } }
  if (!XW) { XW = Float32Array.from(X0); sigma = null; }
  let X = Float32Array.from(XW); const log = []; let accepted = "warp";
  { const fw = flips(XW); const by = {}; for (const t of foldList(XW)) { const rn = Object.keys(REG).find((k) => REG[k] === R[I[t * 3]]); by[rn] = (by[rn] ?? 0) + 1; }
    log.push({ lambda: "warp", sigma, folds: fw, foldRegions: by, landmarks: cen.length }); if (fw > 0) X = Float32Array.from(X0), accepted = null; }
  const REST = X;
  for (const lambda of stages) {
    let Y = X;
    for (let it = 0; it < 3; it++) {
      const N = vertexNormals(Y, I), W = new Float32Array(n), C = new Float32Array(n * 3); let hits = 0, dsum = 0, ceilN = 0;
      for (let i = 0; i < n; i++) {
        if (isEar[i]) { W[i] = 1; C.set([earT[i * 3], earT[i * 3 + 1], earT[i * 3 + 2]], i * 3); continue; }
        const base = DATA(R[i], REG);
        if (base > 0) {
          const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
          const ok = (t) => { if (sk.unreliableTri[t]) return false; const tn = triNormal(sk.P, sk.I, t); return tn[0] * nx + tn[1] * ny + tn[2] * nz > 0.45; };
          // NORMAL SHOOTING (both directions along the vertex normal), closest point only as a fallback — stable on faces
          let q = sk.index.raycast(Y[i * 3] - nx * maxD * 0.5, Y[i * 3 + 1] - ny * maxD * 0.5, Y[i * 3 + 2] - nz * maxD * 0.5, nx, ny, nz, maxD, ok);
          if (q) { const a = sk.I[q.t * 3] * 3, b = sk.I[q.t * 3 + 1] * 3, c = sk.I[q.t * 3 + 2] * 3; q.x = sk.P[a] * q.u + sk.P[b] * q.v + sk.P[c] * q.w; q.y = sk.P[a + 1] * q.u + sk.P[b + 1] * q.v + sk.P[c + 1] * q.w; q.z = sk.P[a + 2] * q.u + sk.P[b + 2] * q.v + sk.P[c + 2] * q.w; q.d = Math.abs(q.d - maxD * 0.5); }
          if (!q) q = sk.index.closest(Y[i * 3], Y[i * 3 + 1], Y[i * 3 + 2], maxD, ok);
          // lips: where the skin has the mouth opening, the mouth module's surface (2 mm behind it) is the shape evidence
          if (!q && ev.mouth && (R[i] === REG.mouth || R[i] === REG.nose || R[i] === REG.face || R[i] === REG.jaw)) { const m = ev.mouth.index.closest(Y[i * 3], Y[i * 3 + 1], Y[i * 3 + 2], 0.03);
            if (m) { const tn = triNormal(ev.mouth.P, ev.mouth.I, m.t), sgn = tn[0] * nx + tn[1] * ny + tn[2] * nz >= 0 ? 1 : -1; const tx = m.x - 0.002 * sgn * tn[0], ty = m.y - 0.002 * sgn * tn[1], tz = m.z - 0.002 * sgn * tn[2];
              const dn = (tx - Y[i * 3]) * tn[0] + (ty - Y[i * 3 + 1]) * tn[1] + (tz - Y[i * 3 + 2]) * tn[2]; W[i] = base; C[i * 3] = Y[i * 3] + dn * tn[0]; C[i * 3 + 1] = Y[i * 3 + 1] + dn * tn[1]; C[i * 3 + 2] = Y[i * 3 + 2] + dn * tn[2]; hits++; continue; } }
          // POINT-TO-PLANE target: only the offset along the evidence normal is prescribed — vertices slide freely along
          // the surface (no collapse of many template vertices onto one evidence point)
          if (q) { const tn = triNormal(sk.P, sk.I, q.t), dn = (q.x - Y[i * 3]) * tn[0] + (q.y - Y[i * 3 + 1]) * tn[1] + (q.z - Y[i * 3 + 2]) * tn[2];
            W[i] = base * (1 - q.d / maxD); C[i * 3] = Y[i * 3] + dn * tn[0]; C[i * 3 + 1] = Y[i * 3 + 1] + dn * tn[1]; C[i * 3 + 2] = Y[i * 3 + 2] + dn * tn[2]; hits++; dsum += q.d; continue; }
        }
        // HAIR CEILING: where the evidence has hair instead of skin, the hair says where the head ends — the head may not
        // stand outside the evidence hair's inner surface (minus a 4 mm-eq lie-on gap). Without it the canonical skull
        // width survives under the hair (the 'too wide / round' failure) and the hair is pushed outward
        if (ceil) { const dx = Y[i * 3] - ctr[0], dy = Y[i * 3 + 1] - ctr[1], dz = Y[i * 3 + 2] - ctr[2], r = Math.hypot(dx, dy, dz) || 1; const h = ev.hair.index.raycast(ctr[0], ctr[1], ctr[2], dx / r, dy / r, dz / r, 1.2);
          if (h && r > h.d - 0.004 + 0.004) { const tr = h.d - 0.004; W[i] = 0.8; C[i * 3] = ctr[0] + dx / r * tr; C[i * 3 + 1] = ctr[1] + dy / r * tr; C[i * 3 + 2] = ctr[2] + dz / r * tr; ceilN++; continue; } }
        // NO EVIDENCE HERE. Next to the face (face/side/jaw/under regions) the vertex is NOT anchored to the canonical
        // template — that is normalisation toward the template's width. It continues the fitted face's own deformation
        // (bi-Laplacian continuation). Only the cranium (scalp/nape) keeps a weak canonical anchor.
        W[i] = R[i] === REG.scalp || R[i] === REG.nape ? 0.03 : base > 0 ? 0 : 0.03; C[i * 3] = REST[i * 3]; C[i * 3 + 1] = REST[i * 3 + 1]; C[i * 3 + 2] = REST[i * 3 + 2];
      }
      if (lambda >= 5) for (const [vi, p] of lmT) { W[vi] = 6; C.set(p, vi * 3); }   // landmarks steer the stiff stages only
      // CLOSED LIP SEAM: canonical mouth vertices in front of the evidence's mouth opening sink 3.5 mm-eq behind its rim
      // depth — a shallow groove where the lips meet (the mouth stays closed and inert)
      if (sk.mouthLoop) for (let i = 0; i < n; i++) { if (R[i] !== REG.mouth && R[i] !== REG.face && R[i] !== REG.jaw) continue; const zIn = insideLoopXY(sk.mouthLoop, Y[i * 3], Y[i * 3 + 1]); if (zIn === null || Y[i * 3 + 2] < zIn - 0.05) continue;
        W[i] = 2; C[i * 3] = Y[i * 3]; C[i * 3 + 1] = Y[i * 3 + 1]; C[i * 3 + 2] = zIn - 0.0035; }
      const r = deform(nb, REST, W, C, lambda, 1500, Y); Y = r.X;
      log.push({ lambda, hits, ceiling: ceilN, meanD: +(dsum / Math.max(1, hits)).toFixed(4), cg: r.iterations });
    }
    // FOLD GUARD: a stage that folds any triangle (normal turned > ~78° from the template) is rejected; the fit keeps the
    // most detailed fold-free stage — identity detail never buys a broken surface
    let f = flips(Y); log[log.length - 1].folds = f;
    // LOCAL FOLD ROLLBACK: a handful of folded triangles do not cost the whole stage — their vertices (+ 2 rings) blend
    // back to the last fold-free surface, then the stage is re-checked
    if (f > 0 && f <= 40) { const back = new Uint8Array(n); for (const t of foldList(Y)) for (let k = 0; k < 3; k++) back[I[t * 3 + k]] = 1;
      for (let r = 0; r < 2; r++) { const b2 = Uint8Array.from(back); for (let i = 0; i < n; i++) if (back[i]) for (const j of nb[i]) b2[j] = 1; back.set(b2); }
      const Z = Float32Array.from(Y); for (let i = 0; i < n; i++) if (back[i]) for (let q = 0; q < 3; q++) Z[i * 3 + q] = X[i * 3 + q];
      const f2 = flips(Z); log[log.length - 1].rollback = { verts: back.reduce((a, b) => a + b, 0), foldsAfter: f2 }; if (!f2) { Y = Z; f = 0; } }
    if (f > 0) { const by = {}; for (const t of foldList(Y)) { const rn = Object.keys(REG).find((k) => REG[k] === R[I[t * 3]]); by[rn] = (by[rn] ?? 0) + 1; } log[log.length - 1].foldRegions = by; }
    if (f > 0) break;
    X = Y; accepted = lambda;
  }
  // ---- DENSE FINAL STAGE: the face carries identity at the scale of a few canonical edges (lip crease, nostril, lid
  // forms, chin) — skin-confident face vertices are pulled onto the evidence along their normals (weight 6, light
  // regularisation); accepted only if fold-free, else the last stage stands
  { const N = vertexNormals(X, I), W = new Float32Array(n), C = Float32Array.from(X); let hits = 0;
    for (let i = 0; i < n; i++) { W[i] = 0.05; if (isEar[i] || DATA(R[i], REG) === 0) continue; const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      const q = sk.index.raycast(X[i * 3] - nx * 0.008, X[i * 3 + 1] - ny * 0.008, X[i * 3 + 2] - nz * 0.008, nx, ny, nz, 0.016, (t) => { if (sk.unreliableTri[t]) return false; const tn = triNormal(sk.P, sk.I, t); return tn[0] * nx + tn[1] * ny + tn[2] * nz > 0.6; });
      if (!q) continue; const a = sk.I[q.t * 3] * 3, b = sk.I[q.t * 3 + 1] * 3, c = sk.I[q.t * 3 + 2] * 3; W[i] = 6; hits++;
      C[i * 3] = sk.P[a] * q.u + sk.P[b] * q.v + sk.P[c] * q.w; C[i * 3 + 1] = sk.P[a + 1] * q.u + sk.P[b + 1] * q.v + sk.P[c + 1] * q.w; C[i * 3 + 2] = sk.P[a + 2] * q.u + sk.P[b + 2] * q.v + sk.P[c + 2] * q.w; }
    const r = deform(nb, X, W, C, 0.08, 1500, X), f = flips(r.X); log.push({ lambda: "dense", hits, folds: f, cg: r.iterations });
    if (!f) { X = r.X; accepted = `${accepted}+dense`; } }
  // ---- SURFACE FAIRING: vertex-scale fitting noise reads as lumpy, blotchy skin (the approved style is smooth). A light
  // Taubin pass (λ|μ, no shrink) on the face-like regions keeps every form larger than a few edges (nose, lips, chin)
  { const face = new Uint8Array(n); for (let i = 0; i < n; i++) face[i] = DATA(R[i], REG) > 0 && !isEar[i] ? 1 : 0;
    const Y = Float32Array.from(X), T = new Float32Array(X.length);
    for (let it = 0; it < 6; it++) for (const k of [0.5, -0.53]) { T.set(Y); for (let i = 0; i < n; i++) { if (!face[i]) continue; const d = nb[i].length; for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb[i]) a += Y[j * 3 + q]; T[i * 3 + q] = Y[i * 3 + q] + k * (a / d - Y[i * 3 + q]); } } Y.set(T); }
    if (!flips(Y)) { X = Y; accepted = `${accepted}+fair`; } }
  // ---- validity: the fit may only move vertices, never fold the surface
  const N0 = tpl.N, N1 = vertexNormals(X, I); let flipped = 0, minRatio = Infinity;
  for (let t = 0; t < I.length / 3; t++) { const a = triNormal(X0, I, t), b = triNormal(X, I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) flipped++; minRatio = Math.min(minRatio, b[3] / Math.max(1e-12, a[3])); }
  let maxDisp = 0; for (let i = 0; i < n; i++) maxDisp = Math.max(maxDisp, Math.hypot(X[i * 3] - X0[i * 3], X[i * 3 + 1] - X0[i * 3 + 1], X[i * 3 + 2] - X0[i * 3 + 2]));
  void N0; void N1;
  return { X, log, earFit, accepted, flipped, minAreaRatio: +minRatio.toFixed(4), maxDisp: +maxDisp.toFixed(4) };
}
