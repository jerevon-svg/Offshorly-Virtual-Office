// v3/stage1/qa-silhouette.mjs — SILHOUETTE CONTINUITY QA (independent of identity, structural and surface QA). Surface QA judges edges; a broad
// step in the head's OUTLINE (a waist under the cranium, a shoulder at the temple, lobes where the chin meets the jaw) has no sharp edge and
// passed every gate (learned: Ivory pass 3). A head outline in this style is CONVEX: from the eye line to the crown the front-view half-width
// never bends outward again, and the front face outline from the jaw to the menton has no notch.
//   node scripts/avatar-pipeline/human-base/v3/stage1/qa-silhouette.mjs <who|dir> ...     (dir = a build dir with build.json + glb)
// Measure: per side, half-width h(y) of the front-view silhouette (ears and their 2 inner blend rings excluded — the ear junction is anatomy) and of the
// front face outline (the shared faceOutlineX definition); convexity defect κ(y) = (h(y+Δ) + h(y−Δ) − 2h(y)) / face height at two scales.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { loadFinal } from "./measure-final.mjs";
import { faceOutlineX } from "./proportions.mjs";
export const TOL = { waist: 0.006, craniumKappa: 0.045, lobe: 0.006, chinKappa: 0.06, chinTipExp: 0.8, scales: [0.05, 0.1] };   // calibrated in the trace round on the built population + real and synthetic negatives (regress.mjs)
const STEP = 0.004;
export function silhouetteQA(X, T, g3) { const n = T.n, R = T.REGION, Hf = g3.eyeY - g3.chinY, iod = Math.abs(g3.cR[0] - g3.cL[0]);
  const ring = new Int16Array(n).fill(-1); let fr = []; for (let i = 0; i < n; i++) if (T.region[i] === R.earL || T.region[i] === R.earR) { ring[i] = 0; fr.push(i); }
  for (let k = 1; k <= 2; k++) { const nx = []; for (const i of fr) for (const j of T.nb[i]) if (ring[j] < 0) { ring[j] = k; nx.push(j); } fr = nx; }   // ears + 2 blend rings: the SAME exclusion as the construction (8 rings left a measurement hole above the ear)
  let top = -Infinity; for (let i = 0; i < n; i++) top = Math.max(top, X[i * 3 + 1]);
  // skull silhouette (any depth, ear junction excluded) from the eye line to near the crown — EXACT cross-sections (mesh edges ∩ the plane y): a vertex
  // band missed the coarse scalp verts at some heights and read the face edge instead (false notches)
  const E = []; { const seen = new Set(); for (let t = 0; t < T.I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = T.I[t * 3 + k], b = T.I[t * 3 + (k + 1) % 3]; if (ring[a] >= 0 || ring[b] >= 0) continue; const key = a < b ? a * n + b : b * n + a; if (seen.has(key)) continue; seen.add(key); E.push(a, b); } }
  const section = (y) => { let lo = Infinity, hi = -Infinity; for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1], ya = X[a * 3 + 1], yb = X[b * 3 + 1]; if ((ya - y) * (yb - y) > 0 || ya === yb) continue; const x = X[a * 3] + ((y - ya) / (yb - ya)) * (X[b * 3] - X[a * 3]); if (x < lo) lo = x; if (x > hi) hi = x; } return [lo, hi]; };
  // from just above the EAR TOP: below it the ear is the visible outline and the excluded ear junction is a measurement hole, not a waist
  let earTop = -Infinity; for (let i = 0; i < n; i++) if (ring[i] === 0) earTop = Math.max(earTop, X[i * 3 + 1]);
  const skull = []; for (let y = Math.max(g3.eyeY, earTop + 0.01); y < top - 0.05 * Hf; y += STEP) { const [lo, hi] = section(y); if (Number.isFinite(lo)) skull.push({ y, L: -lo, R: hi }); }
  // front face outline (shared definition) from the mouth to just above the menton
  const face = []; for (let y = g3.mouthY; y > g3.chinY + 0.04 * Hf; y -= STEP) { const w = faceOutlineX(X, n, T.region, R.earL, R.earR, T.centre[2], iod, y, 0.004, T.I); if (Number.isFinite(w[0])) face.push({ y, L: -w[0], R: w[1] }); }
  const kap = (P, lo, hi) => { let worst = { k: -Infinity }; if (P.length < 5) return worst; const at = (y, s) => { const f = (y - P[0].y) / (P[1].y - P[0].y), a = Math.floor(f); if (a < 0 || a + 1 >= P.length) return null; return P[a][s] + (f - a) * (P[a + 1][s] - P[a][s]); };
    for (const sc of TOL.scales) { const D = sc * Hf; for (const q of P) { const t = (g3.eyeY - q.y) / Hf; if (t < lo || t > hi) continue; for (const s of ["L", "R"]) { const u = at(q.y + D, s), d = at(q.y - D, s); if (u == null || d == null) continue; const k = (u + d - 2 * q[s]) / Hf; if (k > worst.k) worst = { k, t, side: s, scale: sc }; } } } return worst; };
  // WAIST (literal): going up from the eye line the skull outline may widen then narrow, never narrow then widen again — depth of the deepest dip
  // between two wider levels (water-fill depth), per side, / face height
  const waist = (P) => { let worst = { d: 0 }; for (const s of ["L", "R"]) { const h = P.map((q) => q[s]), mb = [], ma = new Array(h.length); let m = -Infinity; for (let k = 0; k < h.length; k++) { mb.push(m); m = Math.max(m, h[k]); } m = -Infinity; for (let k = h.length - 1; k >= 0; k--) { ma[k] = m; m = Math.max(m, h[k]); }
      for (let k = 1; k + 1 < h.length; k++) { const d = (Math.min(mb[k], ma[k]) - h[k]) / Hf; if (d > worst.d) worst = { d, t: (g3.eyeY - P[k].y) / Hf, side: s }; } } return worst; };
  // CHIN LOBE (literal): below the jaw level the front outline narrows monotonically to the menton — a level wider than a level above it is a lobe
  const tJ = (g3.eyeY - (g3.mouthY + 0.5 * (g3.chinY - g3.mouthY))) / Hf, lobe = (P) => { let worst = { d: 0 }; for (const s of ["L", "R"]) { let mn = Infinity; for (const q of P) { const t = (g3.eyeY - q.y) / Hf; if (t < tJ) continue; const d = (q[s] - mn) / Hf; if (d > worst.d) worst = { d, t, side: s }; mn = Math.min(mn, q[s]); } } return worst; };
  // CHIN TIP (literal "pointed"): near the menton the outline half-width grows as h ∝ δ^γ — a round tip γ ≈ 0.5, a V point γ → 1 (δ = height above
  // the menton, 5% → 25% of the chin's own height); individual round / flat / pointed-ish chins all keep a ROUNDED tip
  const yClq = g3.mouthY + 0.8 * (g3.chinY - g3.mouthY), hAt = (f) => { const w = faceOutlineX(X, n, T.region, R.earL, R.earR, T.centre[2], iod, g3.chinY + f * (yClq - g3.chinY), 0.004, T.I); return (w[1] - w[0]) / 2; };
  const h05 = hAt(0.05), h25 = hAt(0.25), gam = Number.isFinite(h05) && Number.isFinite(h25) && h05 > 0 ? Math.log(h25 / h05) / Math.log(5) : null;
  const cr = kap(skull, -2, 0), ch = kap(face, 0, 2), wa = waist(skull), lo = lobe(face), r = (v) => +v.toFixed(4), at = (w) => (w.t != null ? { t: r(w.t), side: w.side, ...(w.scale ? { scale: w.scale } : {}) } : null);
  const checks = { craniumWaist: { pass: wa.d <= TOL.waist, depth: r(wa.d), at: at(wa), tol: TOL.waist }, craniumConvex: { pass: cr.k <= TOL.craniumKappa, kappa: r(cr.k), at: at(cr), tol: TOL.craniumKappa },
    chinLobe: { pass: lo.d <= TOL.lobe, rise: r(lo.d), at: at(lo), tol: TOL.lobe }, chinTip: { pass: gam != null && gam <= TOL.chinTipExp, exponent: gam == null ? null : r(gam), tol: TOL.chinTipExp }, jawChinConvex: { pass: ch.k <= TOL.chinKappa, kappa: r(ch.k), at: at(ch), tol: TOL.chinKappa } };
  return { pass: Object.values(checks).every((c) => c.pass), checks, profile: { skull: skull.filter((_, k) => k % 3 === 0).map((q) => [r((g3.eyeY - q.y) / Hf), r(q.L), r(q.R)]), face: face.filter((_, k) => k % 2 === 0).map((q) => [r((g3.eyeY - q.y) / Hf), r(q.L), r(q.R)]) } }; }
if (import.meta.url === pathToFileURL(process.argv[1]).href) { const O = "scripts/avatar-pipeline/output/human-base/stage1-proof", out = {}, ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  for (const a of ids) { const [w, d] = a.includes(":") ? a.split(":") : [a, null], dir = d ?? (fs.existsSync(`${O}/${w}/V/pass1`) ? `${O}/${w}/V/pass1` : w), F = await loadFinal(dir), Q = silhouetteQA(F.X, F.T, F.g3); out[w] = Q;
    console.log(`${w.padEnd(14)} ${Q.pass ? "PASS" : "FAIL"} · ${Object.entries(Q.checks).map(([k, c]) => `${k} ${c.depth ?? c.kappa ?? c.rise ?? c.exponent}${c.pass ? "" : "✗@" + JSON.stringify(c.at ?? null)}`).join(" · ")}`); }
  if (process.argv.includes("--write")) fs.writeFileSync(`${O}/qa-silhouette.json`, JSON.stringify(out, null, 1)); process.exitCode = Object.values(out).every((q) => q.pass) ? 0 : 1; }
