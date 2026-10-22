// v3/stage1/qa-surface.mjs — SURFACE QA (fail-closed): visible sculptural defects on the final head, incl. low-angle ones.
// Identity QA proves it is this person, structural QA that the mesh is valid; this proves the clay READS clean. Skin only — the
// designed creases are excluded: lid↔eyeball contact (inside ball + 0.6 lid thickness), lip seam, nostrils. Metrics (HD canonical topology):
//   K  CREASE      dihedral angle between adjacent faces on skin (> 30° is a visible crease at this resolution — smooth skin is < 15°)
//   R  MOTTLING    normal offset from a band-limited (Taubin ×10) copy of the surface, p99 / eye spacing over lower-face skin (mid-frequency
//                  bumps; a bilaplacian measure read refinement-level mesh seams, not mottling)
//   P  SPIKE       |Δp_i| / edge, max over skin
//   L  LOW ANGLE   creases on the jaw + under-jaw (what a low camera sees)
//   M  FOOTPRINT   REPORT ONLY — module displacement outside its measured region (failed its negative test; kept as evidence)
//   L2 LIP ENDS    lips taper and meet at the measured corners (a soft ridge from a lip tube grown off the corner passed every surface test)
//   E  EAR SEAM    creases in rings 2–6 around each ear (ring 1 is the anatomical ear-root groove)
//   node scripts/avatar-pipeline/human-base/v3/stage1/qa-surface.mjs --who=a,b [--dirs=label:path,...]     (exit 1 on any failure)
import fs from "node:fs";
import sharp from "sharp";
import { loadFinal } from "./measure-final.mjs";
import { vertexNormals } from "../geom.mjs";
const O = "scripts/avatar-pipeline/output/human-base/stage1-proof", arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const RUNS = [...(arg("who") ?? "").split(",").filter(Boolean).map((w) => [w, `${O}/${w}/V/pass1`]), ...(arg("dirs") ?? "").split(",").filter(Boolean).map((s) => s.split(":"))];
// tolerances calibrated on evidence (pre-round heads with visible cut lids / mottling / jaw ridges: 1400–1750 crease edges, max ~150°, mottle p99
// 0.0031–0.0034, spike 0.95, low-angle 130–144, ear 61–85): a crease is VISIBLE above ~50° or in numbers; a few 30–50° edges are not
const TOL = { creaseDeg: 30, creaseMax: 30, creaseMaxDeg: 50, mottleP99: 0.002, spikeMax: 0.7, lowCrease: 30, earCrease: 25, footprintLeak: 0.004, lipEndRadius: 0.35, lipEndOffset: 0.08 };
const results = {}; let allPass = true;
for (const [label, dir] of RUNS) { const F = await loadFinal(dir), { X, T, g3, bj } = F, n = T.n, RG = T.REGION, RN = Object.fromEntries(Object.entries(RG).map(([k, v]) => [v, k]));
  const nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < T.I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = T.I[t * 3 + k], b = T.I[t * 3 + (k + 1) % 3]; nb[a].add(b); nb[b].add(a); }
  // designed creases (excluded): eyeball contact, lip seam, nostrils
  const balls = (bj.features?.eyes ?? []).filter((b) => b && b.c), mY = g3.mouthY, mW = Math.abs((bj.layout?.landing?.mouthR?.[0] ?? 0.05) - (bj.layout?.landing?.mouthL?.[0] ?? -0.05)) / 2 || 0.05, iod = Math.abs(g3.cR[0] - g3.cL[0]);
  // designed creases: declared by the feature modules (build.json features.designed); the geometric heuristic only for older builds
  const designed = new Uint8Array(n), declared = bj.features?.designed; if (declared) for (const i of declared) designed[i] = 1;
  if (!declared) for (let i = 0; i < n; i++) { const p = [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
    if (balls.some((b) => Math.hypot(p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]) < b.r + 0.6 * (b.lidU ?? 0.01))) designed[i] = 1;
    else if (Math.abs(p[1] - mY) < 0.12 * iod && Math.abs(p[0]) < 1.3 * mW && p[2] > T.centre[2]) designed[i] = 1;
    else if (RN[T.region[i]] === "nose" && Math.abs(p[1] - g3.noseY) < 0.12 * iod) designed[i] = 1; }
  const ear = (i) => T.region[i] === RG.earL || T.region[i] === RG.earR, ring = new Int16Array(n).fill(-1); { let fr = []; for (let i = 0; i < n; i++) if (ear(i)) { ring[i] = 0; fr.push(i); } for (let k = 1; k <= 6; k++) { const nx = []; for (const i of fr) for (const j of nb[i]) if (ring[j] < 0) { ring[j] = k; nx.push(j); } fr = nx; } }
  const skin = (i) => !designed[i] && !ear(i) && RN[T.region[i]] !== "scalp" || (RN[T.region[i]] === "scalp" && ring[i] > 0);
  // K / L / E: dihedral angles over interior edges
  const tn = (t) => { const a = T.I[t * 3], b = T.I[t * 3 + 1], c = T.I[t * 3 + 2], u = [0, 1, 2].map((q) => X[b * 3 + q] - X[a * 3 + q]), v = [0, 1, 2].map((q) => X[c * 3 + q] - X[a * 3 + q]), w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...w) || 1; return w.map((q) => q / l); };
  const edgeTris = new Map(); for (let t = 0; t < T.I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = T.I[t * 3 + k], b = T.I[t * 3 + (k + 1) % 3], key = a < b ? a * n + b : b * n + a; (edgeTris.get(key) ?? edgeTris.set(key, []).get(key)).push(t); }
  const cr = { skin: {}, low: 0, ear: 0, max: 0, where: {} }, bad = []; for (const [key, ts] of edgeTris) { if (ts.length !== 2) continue; const a = Math.floor(key / n), b = key % n; const n1 = tn(ts[0]), n2 = tn(ts[1]), ang = (Math.acos(Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]))) * 180) / Math.PI;
    if (ang <= TOL.creaseDeg) continue; const ra = RN[T.region[a]], isEarSeam = ring[a] >= 2 && ring[b] >= 2 && ring[a] <= 6 && ring[b] <= 6, nearEar = (ring[a] >= 0 && ring[a] < 2) || (ring[b] >= 0 && ring[b] < 2);
    if (nearEar) continue; if (isEarSeam && !designed[a] && !designed[b]) { cr.ear++; bad.push([a, b]); continue; } if (!skin(a) || !skin(b)) continue;
    bad.push([a, b]); cr.skin[ra] = (cr.skin[ra] ?? 0) + 1; if (/under|jaw/.test(ra)) cr.low++; cr.max = Math.max(cr.max, ang); const tt = ((g3.eyeY - X[a * 3 + 1]) / (g3.eyeY - g3.chinY)).toFixed(1); cr.where[`${ra}@t${tt}`] = (cr.where[`${ra}@t${tt}`] ?? 0) + 1; }
  // R / P: Laplacian + bilaplacian over skin
  const lap = new Float32Array(n * 3), el = new Float32Array(n); for (let i = 0; i < n; i++) { const N2 = [...nb[i]]; let e = 0; for (const j of N2) { for (let q = 0; q < 3; q++) lap[i * 3 + q] += (X[j * 3 + q] - X[i * 3 + q]) / N2.length; e += Math.hypot(X[j * 3] - X[i * 3], X[j * 3 + 1] - X[i * 3 + 1], X[j * 3 + 2] - X[i * 3 + 2]) / N2.length; } el[i] = e || 1e-6; }
  // band-limited reference: Taubin λ|μ ×10 (removes a few-vertex bumps, keeps form)
  let S = Float32Array.from(X); const NB = nb.map((q) => [...q]); for (let it = 0; it < 10; it++) for (const lam of [0.5, -0.53]) { const T0 = S.slice(); for (let i = 0; i < n; i++) { const N2 = NB[i]; for (let q = 0; q < 3; q++) { let a2 = 0; for (const j of N2) a2 += T0[j * 3 + q]; S[i * 3 + q] = T0[i * 3 + q] + lam * (a2 / N2.length - T0[i * 3 + q]); } } }
  const NV = vertexNormals(X, T.I);
  const rough = [], spikes = []; for (let i = 0; i < n; i++) { if (!skin(i)) continue; const N2 = [...nb[i]], m = [0, 0, 0]; for (const j of N2) for (let q = 0; q < 3; q++) m[q] += lap[j * 3 + q] / N2.length; spikes.push(Math.hypot(lap[i * 3], lap[i * 3 + 1], lap[i * 3 + 2]) / el[i]);
    const y = X[i * 3 + 1]; if (y < g3.eyeY && y > g3.chinY - 0.02 && X[i * 3 + 2] > T.centre[2] - 0.05) rough.push(Math.abs((X[i * 3] - S[i * 3]) * NV[i * 3] + (X[i * 3 + 1] - S[i * 3 + 1]) * NV[i * 3 + 1] + (X[i * 3 + 2] - S[i * 3 + 2]) * NV[i * 3 + 2]) / iod); }
  rough.sort((a, b) => a - b); const p99 = rough[Math.floor(rough.length * 0.99)] ?? 0, spk = Math.max(0, ...spikes), nCr = Object.values(cr.skin).reduce((a, b) => a + b, 0);
  const R = { designedDeclared: declared ? declared.length : null, checks: { K_crease: { pass: nCr <= TOL.creaseMax && cr.max <= TOL.creaseMaxDeg, edges: nCr, maxDeg: +cr.max.toFixed(1), where: Object.fromEntries(Object.entries(cr.where).sort((a, b) => b[1] - a[1]).slice(0, 6)) }, R_mottling: { pass: p99 <= TOL.mottleP99, p99: +p99.toFixed(5) },
    P_spike: { pass: spk <= TOL.spikeMax, max: +spk.toFixed(3) }, L_lipEnds: { pass: bj.features?.lipEnds ? bj.features.lipEnds.endRadiusRatio <= TOL.lipEndRadius && bj.features.lipEnds.endOffset_mouthW <= TOL.lipEndOffset : true, ...(bj.features?.lipEnds ?? {}) }, M_moduleFootprint: { pass: true, reportOnly: "disproven gate: scored 0 on the lip-ridge negative (the region is the measurement's, so a malformed outline defines its own region)", lips: bj.features?.lips?.footprint ?? null }, L_lowAngle: { pass: cr.low <= TOL.lowCrease, creaseEdges: cr.low }, E_earSeam: { pass: cr.ear <= TOL.earCrease, creaseEdges: cr.ear } } };
  // DEFECT MAP (review): front + from-below projections; grey = head, blue = declared designed creases, red = defect edges
  if (arg("map")) { const W2 = 560, H2 = 560, views = [["front", 0], ["from below (low angle)", -55]], cx = 0, cy = (g3.eyeY + g3.chinY) / 2, sc = 1.6 * W2;
    const pj = (i, pit) => { const c = Math.cos((pit * Math.PI) / 180), s2 = Math.sin((pit * Math.PI) / 180), y = X[i * 3 + 1] - cy, z = X[i * 3 + 2] - T.centre[2]; return [W2 / 2 + (X[i * 3] - cx) * sc, H2 / 2 - (y * c - z * s2) * sc, y * s2 + z * c]; };
    const tiles = await Promise.all(views.map(async ([nm, pit]) => { let svg = `<rect width="${W2}" height="${H2}" fill="#14161a"/>`; for (let i = 0; i < n; i += 3) { const q = pj(i, pit); if (q[2] < -0.02) continue; svg += `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="0.7" fill="${designed[i] ? "#3d6fa8" : "#5a5f68"}"/>`; }
      for (const [a, b] of bad) { const p1 = pj(a, pit), p2 = pj(b, pit); if (p1[2] < -0.02) continue; svg += `<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="#ff4d4d" stroke-width="2.4"/>`; }
      svg += `<text x="10" y="22" font-family="Menlo" font-size="14" fill="#eef1f6">${label} · ${nm} · red = defect creases (${bad.length})</text>`; return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${H2}">${svg}</svg>`)).png().toBuffer(); }));
    fs.mkdirSync(arg("map"), { recursive: true }); await sharp({ create: { width: W2 * 2, height: H2, channels: 3, background: "#14161a" } }).composite(tiles.map((b, k) => ({ input: b, left: k * W2, top: 0 }))).png().toFile(`${arg("map")}/${label.replace(/[^a-z0-9-]+/gi, "_")}-defects.png`); }
  R.failures = Object.entries(R.checks).filter(([, c]) => !c.pass).map(([k]) => k); R.pass = !R.failures.length; if (!R.pass) allPass = false; results[label] = R;
  console.log(`${label.padEnd(18)} ${R.pass ? "PASS" : "FAIL"} · designed ${declared ? declared.length : "heuristic"} · crease ${nCr} (max ${cr.max.toFixed(0)}°) ${JSON.stringify(R.checks.K_crease.where)} · mottle p99 ${p99.toFixed(4)} · spike ${spk.toFixed(2)} · low ${cr.low} · ear ${cr.ear} · lipEnds ${JSON.stringify(bj.features?.lipEnds ?? null)}`); }
fs.writeFileSync(`${O}/qa-surface.json`, JSON.stringify({ tolerances: TOL, results }, null, 1));
process.exitCode = allPass ? 0 : 1;
