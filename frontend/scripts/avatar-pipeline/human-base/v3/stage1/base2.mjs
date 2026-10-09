// v3/stage1/base2.mjs — PARAMETRIC OFFSHORLY HEAD BASE from DENSE approved fits (style calibration only).
//   BASE  = canonical skull / ears / neck (safe construction) with the FACE region blended into the vertex-wise MEAN of the
//           approved heads densely fitted on the same canonical topology (fitapproved.mjs) — a crisp, sculpted mean
//   R     = BASE − canonical: the style-locked facial sculpture as a 3D displacement field
//   REGIONS (partition of unity): nose · lips/muzzle · chin · cheeks · brow · eyes · rest (mid-face) — the semantic controls
//   ENVELOPE per region = projection coefficient of each approved fit's regional sculpture onto the mean's (approved range)
// Writes output/human-base/stage1-proof/base2.json + prior-head.glb. From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/stage1/base2.mjs
import fs from "node:fs";
import { Document } from "@gltf-transform/core";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
import { triNormal } from "../geom.mjs";
import { fadeFolds } from "./fadefolds.mjs";
const tpl = loadTemplate(), TL = tpl.landmarks, RG = tpl.REGION, n = tpl.n, P0 = tpl.P, O = "scripts/avatar-pipeline/output/human-base/stage1-proof", A = `${O}/approved-fits`, W = ["bon", "micah", "angelo", "clang", "france"];
const fits = W.map((w) => Float32Array.from(JSON.parse(fs.readFileSync(`${A}/${w}.json`, "utf8")).X)), mean = Float32Array.from(JSON.parse(fs.readFileSync(`${A}/mean.json`, "utf8")).X);
const at = (X, i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], sm = (t, a, b) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const cE = (at(P0, TL.eyeL)[1] + at(P0, TL.eyeR)[1]) / 2, cEM = cE - at(P0, TL.mouth)[1], cIOD = Math.abs(at(P0, TL.eyeR)[0] - at(P0, TL.eyeL)[0]);
// ear k-rings (ears stay canonical; the blend fades to zero over 6 rings around them)
const ring = new Int8Array(n).fill(99); { let fr = []; for (let i = 0; i < n; i++) if (tpl.region[i] === RG.earL || tpl.region[i] === RG.earR) { ring[i] = 0; fr.push(i); }
  for (let k = 1; k <= 6; k++) { const nx = []; for (const i of fr) for (const j of tpl.nb[i]) if (ring[j] > k) { ring[j] = k; nx.push(j); } fr = nx; } }
// face blend weight: ellipse over the face (brow → under the chin, cheek to cheek) × fade through the head's depth; ears 0
const w = new Float32Array(n);
for (let i = 0; i < n; i++) { const [x, y, z] = at(P0, i), e = (x / (1.5 * cIOD)) ** 2 + ((y - (cE - 0.45 * cEM)) / (1.75 * cEM)) ** 2; let v = (1 - sm(e, 0.45, 1)) * sm(z, -0.1, 0.2);
  if (tpl.region[i] === RG.under || tpl.region[i] === RG.nape) v *= 0.6; if (ring[i] <= 6) v *= sm(ring[i], 0, 6); w[i] = v; }
// FC-FIT-BOUNDARY (learned): approved heads are open/cut under the jaw, so their fits are noisy there — the base fades out
// on down-facing surfaces below the chin; and the mean displacement is relaxed a little (fit noise, not forms)
{ const NT = (() => { const N = new Float32Array(n * 3); for (let t = 0; t < tpl.I.length / 3; t++) { const nn = triNormal(P0, tpl.I, t); for (let k = 0; k < 3; k++) for (let q = 0; q < 3; q++) N[tpl.I[t * 3 + k] * 3 + q] += nn[q]; } for (let i = 0; i < n; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; for (let q = 0; q < 3; q++) N[i * 3 + q] /= l; } return N; })();
  const chinY = at(P0, TL.chin)[1], mouthY = at(P0, TL.mouth)[1]; for (let i = 0; i < n; i++) { const y = P0[i * 3 + 1], ny = NT[i * 3 + 1];
    if (y < chinY + 0.04 && ny < 0.2) w[i] *= sm(ny, -0.6, 0.2) * 0.3 + 0.7 * sm(y, chinY - 0.04, chinY + 0.04);
    if (y < mouthY && ny < 0.15) w[i] *= sm(ny, -0.55, 0.15); }   // every down-facing surface below the mouth (jaw edge → ear)
  // the fade field itself is smoothed so it cannot draw a line
  for (let it = 0; it < 6; it++) { const T = w.slice(); for (let i = 0; i < n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; let a = 0; for (const j of nb) a += T[j]; w[i] = 0.5 * T[i] + 0.5 * a / nb.length; } } }
const D = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) D[i] = mean[i] - P0[i];
for (let it = 0; it < 6; it++) { const T = D.slice(); for (let i = 0; i < n; i++) { const nb = tpl.nb[i]; if (!nb.length) continue; for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb) a += T[j * 3 + q]; D[i * 3 + q] = 0.6 * T[i * 3 + q] + 0.4 * a / nb.length; } } }
// ROUGHNESS-ADAPTIVE smoothing (FC-FIT-NOISE, learned): where the approved fits' mean displacement is locally rough (open /
// hair-covered evidence at jaw edge, temples) it is relaxed hard; smooth sculpted forms (nose, lips, cheeks) are untouched
{ const rough = new Float32Array(n), lam = new Float32Array(n);
  for (let pass = 0; pass < 3; pass++) { for (let i = 0; i < n; i++) { const nb = tpl.nb[i]; let r = 0; for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb) a += D[j * 3 + q]; r += (D[i * 3 + q] - a / (nb.length || 1)) ** 2; } rough[i] = Math.sqrt(r); }
    const sorted = Array.from(rough).filter((v, i) => w[i] > 0.3).sort((a, b) => a - b), r0 = sorted[Math.floor(sorted.length * 0.85)] || 1e-4;
    for (let i = 0; i < n; i++) lam[i] = 0.85 * Math.min(1, Math.max(0, (rough[i] - r0) / r0));
    // spread the smoothing a little around rough spots, then relax
    for (let k = 0; k < 2; k++) { const L = lam.slice(); for (let i = 0; i < n; i++) for (const j of tpl.nb[i]) lam[i] = Math.max(lam[i], 0.7 * L[j]); }
    for (let it = 0; it < 6; it++) { const T = D.slice(); for (let i = 0; i < n; i++) { if (!lam[i]) continue; const nb = tpl.nb[i]; for (let q = 0; q < 3; q++) { let a = 0; for (const j of nb) a += T[j * 3 + q]; D[i * 3 + q] = (1 - lam[i]) * T[i * 3 + q] + lam[i] * a / nb.length; } } } } }
const B = Float32Array.from(P0); for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) B[i * 3 + q] = P0[i * 3 + q] + w[i] * D[i * 3 + q];
// the base keeps the V3 guarantee (no folds vs the canonical template): SMOOTH fold fade (no patchwork rollback)
const FF = fadeFolds(tpl, P0, B); console.log(`base folds: ${JSON.stringify(FF)}`); if (!FF.ok) throw new Error("base folds remain — fail closed");
const folds = 0;
// semantic regions on the BASE geometry (partition of unity)
const bE = (at(B, TL.eyeL)[1] + at(B, TL.eyeR)[1]) / 2, bEM = bE - at(B, TL.mouth)[1], nt = at(B, TL.noseTip), mo = at(B, TL.mouth), ch = at(B, TL.chin), eR = at(B, TL.eyeR);
const REG = { nose: [[0, nt[1] + 0.035], 0.07, 0.085], lips: [[0, mo[1]], 0.09, 0.05], chin: [[0, ch[1] - 0.015], 0.085, 0.06], cheeks: [[0.21, bE - 0.45 * bEM], 0.08, 0.085, true], brow: [[0.17, bE + 0.13], 0.1, 0.045, true], eyes: [[eR[0], bE], 0.085, 0.05, true] }, REST = 0.2;
const masks = Object.fromEntries(Object.keys(REG).map((k) => [k, new Float32Array(n)])), rest = new Float32Array(n);
for (let i = 0; i < n; i++) { const [x, y] = at(B, i); let s = REST; const g = {}; for (const [k, [[cx, cy], sx, sy, sym]] of Object.entries(REG)) { const dx = sym ? Math.abs(x) - cx : x - cx; g[k] = Math.exp(-0.5 * ((dx / sx) ** 2 + ((y - cy) / sy) ** 2)); s += g[k]; } for (const k of Object.keys(REG)) masks[k][i] = g[k] / s; rest[i] = REST / s; }
// approved envelope per region: projection of each fit's regional sculpture (fit − canonical, face-weighted) onto the mean's
const amp = {}; for (const k of [...Object.keys(REG), "rest"]) { const M = k === "rest" ? rest : masks[k]; const per = fits.map((F) => { let a = 0, b = 0; for (let i = 0; i < n; i++) { const m = M[i] * w[i]; if (m < 1e-4) continue; for (let q = 0; q < 3; q++) { const r = mean[i * 3 + q] - P0[i * 3 + q]; a += m * (F[i * 3 + q] - P0[i * 3 + q]) * r; b += m * r * r; } } return b ? a / b : 1; });
  const m = per.reduce((x, y) => x + y, 0) / per.length, sd = Math.sqrt(per.reduce((x, y) => x + (y - m) ** 2, 0) / per.length); amp[k] = { perHead: Object.fromEntries(W.map((h, i) => [h, +per[i].toFixed(3)])), mean: +m.toFixed(3), sd: +sd.toFixed(3), min: +Math.min(...per).toFixed(3), max: +Math.max(...per).toFixed(3) }; }
fs.writeFileSync(`${O}/base2.json`, JSON.stringify({ approved: W, P: Array.from(B, (v) => +v.toFixed(5)), weight: Array.from(w, (v) => +v.toFixed(4)), regions: REG, rest: REST, amp, folds }));
const doc = new Document(), buf = doc.createBuffer(), prim = doc.createPrimitive().setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(B).setBuffer(buf)).setIndices(doc.createAccessor().setType("SCALAR").setArray(Uint32Array.from(tpl.I)).setBuffer(buf));
doc.createScene().addChild(doc.createNode("identity_head").setMesh(doc.createMesh("identity_head").addPrimitive(prim))); await io.write(`${O}/prior-head.glb`, doc);
console.log(`base2: folds vs canonical ${folds} · envelope ${JSON.stringify(Object.fromEntries(Object.entries(amp).map(([k, v]) => [k, [v.min, v.max, v.sd]])))}`);
