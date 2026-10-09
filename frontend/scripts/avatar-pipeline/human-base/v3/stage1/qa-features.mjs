// v3/stage1/qa-features.mjs — FEATURE-FORM QA (independent of identity, structural, surface and silhouette QA; never reads construction logs).
// What a clay viewer judges about the features, measured on the final mesh alone:
//   M  SMILE RIDGE    lip relief above the face's own smoothed surface (thick strips stand proud of it) / eye spacing
//   C  CHIN RIDGE     relief across the chin below the lower lip (a separate raised bar across the chin) / eye spacing
//   N  NOSE DETACHED  a secondary nose peak whose prominence over the saddle to the main nose mass is large (detached wing pebbles) / eye spacing
//   E  JAGGED LIDS    roughness of the VISIBLE eye opening outline (front view, fine raster) around its own low-passed curve / eye half-width
//   node scripts/avatar-pipeline/human-base/v3/stage1/qa-features.mjs <who|label:dir> ... [--write]      (exit 1 on any failure)
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { loadFinal } from "./measure-final.mjs";
import { vertexNormals } from "../geom.mjs";
export const TOL = { lipRelief: 0.06, lipSlope: 2.0, chinRidge: 0.03, noseProminence: 0.003, lidRough: 0.03 };   // calibrated in the trace round (see STAGE1_REPORT): built heads vs real + synthetic negatives
/** relief = z − (z relaxed over the front-facing face) — the mid-frequency forms that stand proud of the face's own smooth shape */
function reliefField(X, T, g3, iters = 160) { const n = T.n, N = vertexNormals(X, T.I), R = T.REGION, F = new Set([R.face, R.nose, R.mouth, R.jaw]), S = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (F.has(T.region[i]) && N[i * 3 + 2] > 0.3 && X[i * 3 + 1] < g3.eyeY) S[i] = 1;
  let z = new Float32Array(n); for (let i = 0; i < n; i++) z[i] = X[i * 3 + 2]; for (let it = 0; it < iters; it++) { const z2 = z.slice(); for (let i = 0; i < n; i++) { if (!S[i]) continue; const nb = T.nb[i]; let a = 0; for (const j of nb) a += z2[j]; z[i] = a / nb.length; } }
  const r = new Float32Array(n); for (let i = 0; i < n; i++) r[i] = S[i] ? X[i * 3 + 2] - z[i] : 0; return r; }
/** front-view raster of max z (head) on a box */
function raster(X, I, x0, y0, W, H, res) { const NX = Math.round(W / res), NY = Math.round(H / res), Z = new Float32Array(NX * NY).fill(-9);
  for (let t = 0; t < I.length / 3; t++) { const P = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]].map((i) => [(X[i * 3] - x0) / res, (X[i * 3 + 1] - y0) / res, X[i * 3 + 2]]);
    const mnx = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), mxx = Math.min(NX - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0]))), mny = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), mxy = Math.min(NY - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1]))); if (mnx > mxx || mny > mxy) continue;
    const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]); if (Math.abs(den) < 1e-12) continue;
    for (let y = mny; y <= mxy; y++) for (let x = mnx; x <= mxx; x++) { const w0 = ((P[1][1] - P[2][1]) * (x - P[2][0]) + (P[2][0] - P[1][0]) * (y - P[2][1])) / den, w1 = ((P[2][1] - P[0][1]) * (x - P[2][0]) + (P[0][0] - P[2][0]) * (y - P[2][1])) / den, w2 = 1 - w0 - w1; if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue; const zz = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2], k = y * NX + x; if (zz > Z[k]) Z[k] = zz; } }
  return { Z, NX, NY }; }
export function featureQA(X, T, g3, landing, balls) { const iod = Math.abs(g3.cR[0] - g3.cL[0]), rel = reliefField(X, T, g3), relF = reliefField(X, T, g3, 40), r = (v) => +v.toFixed(4), checks = {};
  // M + C: smile ridge / chin ridge
  // the smile's THICK-STRIP signature is the steepness of the relief at the lip borders (crisp strips: |Δrelief|/Δxy 2.3–6.7 on the legacy tube lips;
  // soft lips ≤ 1.6) — protrusion height alone did not separate them
  { const mR = landing.mouthR, mL = landing.mouthL, mx = (mR[0] + mL[0]) / 2, mW = Math.abs(mL[0] - mR[0]), my = g3.mouthY, ch = g3.chinY; let lip = 0, slope = 0, chin = 0, at = null;
    for (let i = 0; i < T.n; i++) { if (!rel[i]) continue; const x = X[i * 3], y = X[i * 3 + 1]; if (Math.abs(x - mx) < 0.55 * mW && Math.abs(y - my) < 0.35 * mW) { lip = Math.max(lip, rel[i]); for (const j of T.nb[i]) { if (!relF[j] && !relF[i]) continue; const dl = Math.hypot(x - X[j * 3], y - X[j * 3 + 1]); if (dl > 1e-6) slope = Math.max(slope, Math.abs(relF[i] - relF[j]) / dl); } }
      if (Math.abs(x - mx) < 0.45 * mW && y < my - 0.45 * (my - ch) && y > ch + 0.1 * (my - ch) && rel[i] > chin) { chin = rel[i]; at = [r(x), r(y)]; } }
    checks.M_smileRidge = { pass: lip / iod <= TOL.lipRelief && slope <= TOL.lipSlope, relief_IOD: r(lip / iod), edgeSlope: r(slope), tol: [TOL.lipRelief, TOL.lipSlope] }; checks.C_chinRidge = { pass: chin / iod <= TOL.chinRidge, relief_IOD: r(chin / iod), at, tol: TOL.chinRidge }; }
  // N: detached nose volume (literal): walking OUT from the nose tip toward each wing and beyond, a continuous nose only descends; a detached lobe makes the
  // height field DIP and RISE again — the largest rise after the running minimum, over a fan of rays per side (front-view raster) / eye spacing
  { const wR = landing.wingR, wL = landing.wingL, nw = Math.abs(wL[0] - wR[0]), tip = T.landmarks.noseTip, tx = X[tip * 3], ty = X[tip * 3 + 1], res = 0.0008, x0 = Math.min(wR[0], wL[0]) - 1.0 * nw, y0 = Math.min(g3.noseY, wR[1], wL[1]) - 0.6 * nw, W = Math.abs(wL[0] - wR[0]) + 2.0 * nw, H = ty + 0.3 * nw - y0;
    const { Z, NX, NY } = raster(X, T.I, x0, y0, W, H, res), zAt = (x, y) => { const xi = Math.round((x - x0) / res), yi = Math.round((y - y0) / res); return xi < 0 || yi < 0 || xi >= NX || yi >= NY ? null : Z[yi * NX + xi] < -8 ? null : Z[yi * NX + xi]; };
    let rise = 0, at = null; for (const wv of [wR, wL]) { const dx = wv[0] - tx, dy = wv[1] - ty, L0 = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx); for (const da of [-0.5, -0.35, -0.2, -0.1, 0, 0.1, 0.2, 0.35]) { const a = a0 + da, steps = Math.round((1.7 * L0) / res); let mn = Infinity;
        for (let k = 1; k <= steps; k++) { const x = tx + Math.cos(a) * k * res, y = ty + Math.sin(a) * k * res, z = zAt(x, y); if (z == null) break; if (z < mn) mn = z; else if (z - mn > rise) { rise = z - mn; at = [r(x), r(y)]; } } } }
    checks.N_noseDetached = { pass: rise / iod <= TOL.noseProminence, prominence_IOD: r(rise / iod), at, tol: TOL.noseProminence }; }
  // E: jagged lids — the visible opening outline (ball in front of the head) on a fine raster, roughness around its own low-passed polar curve
  { let worst = 0; for (const b of balls ?? []) { const res = 0.0004, x0 = b.c[0] - 1.15 * b.r, y0 = b.c[1] - 1.15 * b.r, W = 2.3 * b.r, { Z, NX, NY } = raster(X, T.I, x0, y0, W, W, res), vis = new Uint8Array(NX * NY);
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { const px = x0 + x * res, py = y0 + y * res, dd = b.r * b.r - (px - b.c[0]) ** 2 - (py - b.c[1]) ** 2; if (dd > 0 && b.c[2] + Math.sqrt(dd) > Z[y * NX + x] + 1e-5) vis[y * NX + x] = 1; }
      let sx = 0, sy = 0, c = 0; for (let k = 0; k < vis.length; k++) if (vis[k]) { sx += k % NX; sy += (k / NX) | 0; c++; } if (c < 50) continue; const cx = sx / c, cy = sy / c, NB = 180, rad = new Float32Array(NB);
      for (let k = 0; k < vis.length; k++) { if (!vis[k]) continue; const x = k % NX, y = (k / NX) | 0; if (vis[k - 1] && vis[k + 1] && vis[k - NX] && vis[k + NX]) continue; const a = Math.atan2(y - cy, x - cx), bi = Math.min(NB - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * NB)), rr = Math.hypot(x - cx, y - cy); if (rr > rad[bi]) rad[bi] = rr; }
      const sm = rad.map((_, i) => { let a = 0, w = 0; for (let k = -4; k <= 4; k++) { const v = rad[(i + k + NB) % NB]; if (v > 0) { a += v; w++; } } return w ? a / w : 0; }); let s2 = 0, m = 0; for (let i = 0; i < NB; i++) if (rad[i] > 0) { s2 += (rad[i] - sm[i]) ** 2; m++; }
      const rough = (Math.sqrt(s2 / Math.max(1, m)) * res) / (b.hw ?? b.r); worst = Math.max(worst, rough); }
    // REPORT ONLY (failed its negative: injected ±0.6–4 mm margin jitter moved it 0.0146 → 0.0149–0.0239, inside the real-head spread 0.011–0.022) — evidence, not a gate
    checks.E_jaggedLids = { pass: true, reportOnly: true, roughness_hw: r(worst), note: "failed its negative test — not a gate" }; }
  return { pass: Object.values(checks).every((c) => c.pass), checks }; }
if (import.meta.url === pathToFileURL(process.argv[1]).href) { const O = "scripts/avatar-pipeline/output/human-base/stage1-proof", out = {};
  for (const a of process.argv.slice(2).filter((x) => !x.startsWith("--"))) { const [w, d] = a.includes(":") ? a.split(":") : [a, `${O}/${a}/V/pass1`], F = await loadFinal(d), Q = featureQA(F.X, F.T, F.g3, F.bj.layout.landing, F.balls); out[w] = Q;
    console.log(`${w.padEnd(14)} ${Q.pass ? "PASS" : "FAIL"} · ${Object.entries(Q.checks).map(([k, c]) => `${k.split("_")[0]} ${c.edgeSlope != null ? c.relief_IOD + "/" + c.edgeSlope : c.relief_IOD ?? c.prominence_IOD ?? c.roughness_hw}${c.pass ? "" : "✗"}`).join(" · ")}`); }
  if (process.argv.includes("--write")) fs.writeFileSync(`${O}/qa-features.json`, JSON.stringify(out, null, 1)); process.exitCode = Object.values(out).every((q) => q.pass) ? 0 : 1; }
