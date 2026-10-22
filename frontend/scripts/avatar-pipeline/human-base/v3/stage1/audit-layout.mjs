// v3/stage1/audit-layout.mjs — COMPLETE FACIAL LAYOUT AUDIT (X and Y): Stage 0 measured proportions → style-translated target
// → old Stage 1 → corrected Stage 1, measured on the FINAL 3D geometry (front projection). Scale-free ratios only.
//   node scripts/avatar-pipeline/human-base/v3/stage1/audit-layout.mjs <who> <oldBuildDir> <newBuildDir>
import fs from "node:fs";
import { io } from "../../lib.mjs";
import { loadTemplate } from "../fit.mjs";
import { HD_FILE } from "./hd.mjs";
const [who, oldDir, newDir] = process.argv.slice(2), O = "scripts/avatar-pipeline/output/human-base/stage1-proof";
const S0 = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/output/human-base/stage0-identity/identity.json", "utf8")).results[who], SL = JSON.parse(fs.readFileSync(`${O}/style-layout.json`, "utf8"));
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const crossX = (pts, y) => { const xs = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); } return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : NaN; };
const crossY = (pts, x) => { const ys = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])); } return ys; };
/** ratios from a layout L with "down" = +v (Stage 0: image y; 3D: −y) */
function ratios(L) { const ey = (L.cR[1] + L.cL[1]) / 2, iod = d2(L.cR, L.cL), H = L.chin - ey, by = L.brow, R = {};
  R.IOD_faceW = iod / L.faceWeye; R.IOD_cheekW = iod / L.cheekW; R.IOD_faceW_nose = iod / L.faceWnose; R.innerGap_IOD = d2(L.iR, L.iL) / iod; R.eyeW_IOD = (d2(L.iR, L.oR) + d2(L.iL, L.oL)) / 2 / iod; R.noseW_IOD = L.noseW / iod; R.mouthW_IOD = L.mouthW / iod; R.jawW_faceW = L.jawW / L.faceWeye; R.chinW_faceW = L.chinW / L.faceWeye;
  R.H_IOD = H / iod; R.browEye_H = by != null ? (ey - by) / H : NaN; R.eyeNose_H = (L.noseBase - ey) / H; R.noseMouth_H = (L.mouth - L.noseBase) / H; R.mouthChin_H = (L.chin - L.mouth) / H; R.mouthPos_H = (L.mouth - ey) / H; R.chinFrac_lowerFace = (L.chin - L.mouth) / (L.chin - L.noseBase);
  R.eyeSym = Math.abs(((L.cR[0] + L.cL[0]) / 2 - L.midX) / iod); return R; }
// ---- Stage 0 (px, y down) ----
const e = S0.eyes, ct = S0.contour.map((c) => c.pt), s0 = { iR: e.R.inner, oR: e.R.outer, iL: e.L.inner, oL: e.L.outer }; s0.cR = mid(s0.iR, s0.oR); s0.cL = mid(s0.iL, s0.oL);
{ const ey = (s0.cR[1] + s0.cL[1]) / 2, mx = (s0.cR[0] + s0.cL[0]) / 2; s0.chin = Math.max(...crossY(ct, mx)); s0.mouth = (Math.min(...S0.mouth.upper.map((q) => q[1])) + Math.max(...S0.mouth.lower.map((q) => q[1]))) / 2;
  s0.noseBase = S0.nose.base[1]; s0.noseW = d2(S0.nose.wingR, S0.nose.wingL); s0.mouthW = d2(S0.mouth.cornerR, S0.mouth.cornerL); s0.faceWeye = crossX(ct, ey); s0.jawW = crossX(ct, s0.mouth + 0.5 * (s0.chin - s0.mouth)); s0.chinW = crossX(ct, s0.mouth + 0.8 * (s0.chin - s0.mouth));
  { let w = 0; for (let k = 0; k <= 12; k++) w = Math.max(w, crossX(ct, ey + ((s0.noseBase - ey) * k) / 12)); s0.cheekW = w; s0.faceWnose = crossX(ct, s0.noseBase); }
  s0.eyeLineLabels = S0.contour.filter((c, i) => { const b = S0.contour[(i + 1) % S0.contour.length]; return (c.pt[1] - ey) * (b.pt[1] - ey) <= 0; }).map((c) => c.label);
  const br = ["R", "L"].map((k) => S0.brows[k]).filter((b) => b?.found).map((b) => [...b.top, ...b.bottom]); s0.brow = br.length ? br.flat().reduce((a, q) => a + q[1], 0) / br.flat().length : null;
  const ce = ct.filter((q) => Math.abs(q[1] - ey) < 40); s0.midX = mid(...[ce.reduce((a, q) => (q[0] < a[0] ? q : a)), ce.reduce((a, q) => (q[0] > a[0] ? q : a))])[0]; }
const R0 = ratios(s0), tgt = { ...R0, H_IOD: R0.H_IOD * SL.k_y, IOD_faceW: R0.IOD_faceW / SL.k_fw, IOD_cheekW: R0.IOD_cheekW / SL.k_fw, IOD_faceW_nose: R0.IOD_faceW_nose / SL.k_fw, jawW_faceW: R0.jawW_faceW * SL.k_fw / SL.k_fw, chinW_faceW: R0.chinW_faceW };
// ---- 3D measurement of a build (final geometry where it exists; pipeline landing otherwise) ----
const HD = loadTemplate(HD_FILE), BT = loadTemplate();
async function meas3(dir) { const bj = JSON.parse(fs.readFileSync(`${dir}/build.json`, "utf8")), file = fs.readdirSync(dir).find((f) => f.endsWith(".glb")), doc = await io.read(`${dir}/${file}`);
  const ex = doc.getRoot().listScenes()[0].getExtras().humanIdentity, head = doc.getRoot().listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0].getAttribute("POSITION").getArray();
  const T = head.length / 3 === HD.uv.src.length ? HD : BT, n = T.n, X = new Float32Array(n * 3); for (let j = 0; j < T.uv.src.length; j++) X.set(head.subarray(j * 3, j * 3 + 3), T.uv.src[j] * 3);
  const g = bj.layout.landing, balls = ex.landmarks?.eyes?.balls, RG = T.REGION, L = {}, src = {};
  // eyes: VISIBLE openings (front z-buffer: pixels where the eyeball is the front-most surface)
  if (balls?.length === 2) { const ey0 = (balls[0].c[1] + balls[1].c[1]) / 2, RES = 0.0012, x0 = -0.36, y0 = ey0 - 0.14, NX = Math.round(0.72 / RES), NY = Math.round(0.28 / RES), Z = new Float32Array(NX * NY).fill(-9), I = T.I;
    for (let t = 0; t < I.length / 3; t++) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], P = [a, b, c].map((i) => [(X[i * 3] - x0) / RES, (X[i * 3 + 1] - y0) / RES, X[i * 3 + 2]]);
      const mnx = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), mxx = Math.min(NX - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0]))), mny = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), mxy = Math.min(NY - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1]))); if (mnx > mxx || mny > mxy) continue;
      const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]); if (Math.abs(den) < 1e-12) continue;
      for (let y = mny; y <= mxy; y++) for (let x = mnx; x <= mxx; x++) { const w0 = ((P[1][1] - P[2][1]) * (x - P[2][0]) + (P[2][0] - P[1][0]) * (y - P[2][1])) / den, w1 = ((P[2][1] - P[0][1]) * (x - P[2][0]) + (P[0][0] - P[2][0]) * (y - P[2][1])) / den, w2 = 1 - w0 - w1; if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue; const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2], k = y * NX + x; if (z > Z[k]) Z[k] = z; } }
    const ap = balls.map((b) => { let inn = null, out = null, sx = 0, sy = 0, cnt = 0; for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { const px = x0 + x * RES, py = y0 + y * RES, dd = b.r * b.r - (px - b.c[0]) ** 2 - (py - b.c[1]) ** 2; if (dd <= 0) continue; if (b.c[2] + Math.sqrt(dd) <= Z[y * NX + x] + 1e-5) continue;
        cnt++; sx += px; sy += py; if (!inn || Math.abs(px) < Math.abs(inn[0])) inn = [px, py]; if (!out || Math.abs(px) > Math.abs(out[0])) out = [px, py]; } return { inn, out, c: [sx / cnt, sy / cnt], cx: b.c[0], px: cnt }; });
    const A = ap.find((a) => a.cx < 0), B = ap.find((a) => a.cx > 0); Object.assign(L, { iR: A.inn, oR: A.out, iL: B.inn, oL: B.out }); L.cR = mid(A.inn, A.out); L.cL = mid(B.inn, B.out); src.eyes = "visible opening (z-buffer)"; L.openPx = [A.px, B.px]; }
  else { Object.assign(L, { iR: g.iR, oR: g.oR, iL: g.iL, oL: g.oL }); L.cR = mid(g.iR, g.oR); L.cL = mid(g.iL, g.oL); src.eyes = "pipeline landing (paint)"; }
  const ey = (L.cR[1] + L.cL[1]) / 2;
  // midline profile (front surface): tip, subnasale, lips, seam, menton
  const B = 0.003, prof = new Map(); for (let i = 0; i < n; i++) { if (Math.abs(X[i * 3]) > 0.004 || X[i * 3 + 2] < 0.1) continue; const k = Math.round(X[i * 3 + 1] / B); if (!prof.has(k) || X[i * 3 + 2] > prof.get(k)) prof.set(k, X[i * 3 + 2]); }
  const ks = [...prof.keys()].sort((a, b) => b - a), zz = (k) => prof.get(k) ?? -9; let menton = Infinity; for (let i = 0; i < n; i++) if (Math.abs(X[i * 3]) < 0.006 && X[i * 3 + 2] > 0.12 && X[i * 3 + 1] < ey - 0.1) menton = Math.min(menton, X[i * 3 + 1]);
  const below = ks.filter((k) => k * B < ey - 0.03 && k * B > menton); let tipK = below[0]; for (const k of below) if (k * B > ey - 0.25 && zz(k) > zz(tipK)) tipK = k;
  const after = below.filter((k) => k < tipK), locMin = (arr, from) => { for (let j = from + 1; j < arr.length - 1; j++) if (zz(arr[j]) <= zz(arr[j - 1]) && zz(arr[j]) < zz(arr[j + 1])) return j; return -1; }, locMax = (arr, from) => { for (let j = from + 1; j < arr.length - 1; j++) if (zz(arr[j]) >= zz(arr[j - 1]) && zz(arr[j]) > zz(arr[j + 1])) return j; return -1; };
  const jSub = locMin(after, 0), jUp = locMax(after, jSub), jSeam = locMin(after, jUp);
  const geomOK = src.eyes.startsWith("visible") && jSub > 0 && jSeam > 0; L.noseBase = geomOK ? -after[jSub] * B : -g.noseBase[1]; L.mouth = geomOK ? -after[jSeam] * B : -g.mouthC[1]; L.chin = -menton; src.midline = geomOK ? "midline profile (subnasale / lip seam / menton)" : "landing (nose, mouth) + menton";
  // y-down convention for ratios
  for (const k of ["cR", "cL", "iR", "iL", "oR", "oL"]) L[k] = [L[k][0], -L[k][1]];
  const wAt = (y) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { if (T.region[i] === RG.earL || T.region[i] === RG.earR || X[i * 3 + 2] < T.centre[2] || Math.abs(X[i * 3 + 1] - y) > 0.004) continue; lo = Math.min(lo, X[i * 3]); hi = Math.max(hi, X[i * 3]); } return [lo, hi]; };
  const we = wAt(ey); L.faceWeye = we[1] - we[0]; { let w = 0; for (let k = 0; k <= 12; k++) { const yy = ey + ((-L.noseBase) - ey) * k / 12, ww = wAt(yy); w = Math.max(w, ww[1] - ww[0]); } L.cheekW = w; } { const wn = wAt(-L.noseBase); L.faceWnose = wn[1] - wn[0]; } L.midX = (we[0] + we[1]) / 2; const yJ = -(L.mouth + 0.5 * (L.chin - L.mouth)), yC = -(L.mouth + 0.8 * (L.chin - L.mouth)); L.jawW = wAt(yJ)[1] - wAt(yJ)[0]; L.chinW = wAt(yC)[1] - wAt(yC)[0];
  L.noseW = d2(g.wingR, g.wingL); L.mouthW = d2(g.mouthR, g.mouthL); L.brow = g.browR && g.browL ? -(g.browR[1] + g.browL[1]) / 2 : null; src.widths = "silhouette (ears excluded); nose/mouth width = landing of Stage 0 wings/corners";
  return { R: ratios(L), L, src, X, T, bj }; }
const OLD = await meas3(oldDir), NEW = await meas3(newDir);
const keys = Object.keys(R0), fmt = (v) => (v == null || isNaN(v) ? "—" : v.toFixed(3));
const rows = [["STAGE 0 measured", R0], ["STYLE-TRANSLATED target", tgt], ["OLD Stage 1", OLD.R], ["CORRECTED Stage 1", NEW.R]];
console.log("ratio".padEnd(20), ...rows.map((r) => r[0].padStart(24))); for (const k of keys) console.log(k.padEnd(20), ...rows.map((r) => fmt(r[1][k]).padStart(24)));
console.log("Stage 0 contour labels at the eye line:", JSON.stringify(s0.eyeLineLabels)); console.log("sources old:", JSON.stringify(OLD.src)); console.log("sources new:", JSON.stringify(NEW.src), "eye opening px", JSON.stringify(NEW.L.openPx));
fs.writeFileSync(`${O}/audit-layout-${who}.json`, JSON.stringify({ stage0: R0, target: tgt, old: OLD.R, corrected: NEW.R, oldL: OLD.L, newL: NEW.L, sources: { old: OLD.src, new: NEW.src }, styleLayout: { k_y: SL.k_y, k_fw: SL.k_fw } }, null, 1));
