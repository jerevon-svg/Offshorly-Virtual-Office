// v3/stage1/calibrate-layout.mjs — OFFSHORLY STYLE-SPACE TRANSLATION learned from the approved heads (calibration only).
// For each approved head: its own sprite's Stage 0 proportions vs its approved 3D proportions (dense canonical fit).
// Learned, consistent factors (applied identically to every employee, multiplicatively — identity differences survive):
//   k_y  = (eye→chin height / IOD)_3D ÷ (same)_Stage0      — the Offshorly face is vertically compressed
//   k_fw = (IOD / face width)_Stage0 ÷ (same)_3D            — the face outline is wider relative to the features
// plus the approved 3D RANGE of each ratio (the allowed style envelope). Pairs are calibration DATA (approved-pairs.json).
//   node scripts/avatar-pipeline/human-base/v3/stage1/calibrate-layout.mjs
import fs from "node:fs";
import { loadTemplate } from "../fit.mjs";
const t = loadTemplate(), TL = t.landmarks, RG = t.REGION, O = "scripts/avatar-pipeline/output/human-base/stage1-proof";
const POP = JSON.parse(fs.readFileSync(`${O}/population/identity.json`, "utf8")).results, PAIRS = JSON.parse(fs.readFileSync(new URL("./approved-pairs.json", import.meta.url), "utf8"));
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const crossX = (pts, y) => { const xs = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); } return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : NaN; };
const crossY = (pts, x) => { const ys = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])); } return ys; };
export function s0Ratios(p) { const e = p.eyes, cR = mid(e.R.inner, e.R.outer), cL = mid(e.L.inner, e.L.outer), ey = (cR[1] + cL[1]) / 2, ct = p.contour.map((c) => c.pt), chin = Math.max(...crossY(ct, (cR[0] + cL[0]) / 2)), iod = d2(cR, cL);
  const mo = (Math.min(...p.mouth.upper.map((q) => q[1])) + Math.max(...p.mouth.lower.map((q) => q[1]))) / 2, H = chin - ey;
  // cheekbone width: max contour width from the eye line to the nose base (skin-bounded below the temples; hair-robust)
  let cw = 0; if (p.nose?.found) for (let k = 0; k <= 12; k++) { const w = crossX(ct, ey + ((p.nose.base[1] - ey) * k) / 12); if (w > cw) cw = w; }
  return { H_IOD: H / iod, IOD_faceW: iod / crossX(ct, ey), mouthChin_H: (chin - mo) / H, cheekW_IOD: cw / iod }; }
function s3Ratios(X) { const g = (i) => [X[i * 3], X[i * 3 + 1]], cR = g(TL.eyeL), cL = g(TL.eyeR), ey = (cR[1] + cL[1]) / 2, mo = g(TL.mouth)[1], iod = Math.abs(cR[0] - cL[0]);
  let chin = Infinity; for (let i = 0; i < t.n; i++) if (Math.abs(X[i * 3]) < 0.006 && X[i * 3 + 2] > 0.12 && X[i * 3 + 1] < mo) chin = Math.min(chin, X[i * 3 + 1]);
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < t.n; i++) { if (t.region[i] === RG.earL || t.region[i] === RG.earR || X[i * 3 + 2] < t.centre[2] || Math.abs(X[i * 3 + 1] - ey) > 0.004) continue; lo = Math.min(lo, X[i * 3]); hi = Math.max(hi, X[i * 3]); }
  const H = ey - chin; return { H_IOD: H / iod, IOD_faceW: iod / (hi - lo), mouthChin_H: (mo - chin) / H }; }
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
const per = PAIRS.pairs.map(([fit, sprite]) => { const a = s0Ratios(POP[sprite]), b = s3Ratios(Float32Array.from(JSON.parse(fs.readFileSync(`${O}/approved-fits/${fit}.json`, "utf8")).X)); return { fit, sprite, s0: a, s3: b, ky: b.H_IOD / a.H_IOD, kfw: a.IOD_faceW / b.IOD_faceW }; });
const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length, sd = (v) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const range = (k) => [Math.min(...per.map((p) => p.s3[k])), Math.max(...per.map((p) => p.s3[k]))];
const out = { k_y: mean(per.map((p) => p.ky)), k_y_sd: sd(per.map((p) => p.ky)), k_fw: mean(per.map((p) => p.kfw)), k_fw_sd: sd(per.map((p) => p.kfw)), ranges: { H_IOD: range("H_IOD"), IOD_faceW: range("IOD_faceW"), mouthChin_H: range("mouthChin_H") }, rangeMargin: 0.1, per };
fs.writeFileSync(`${O}/style-layout.json`, JSON.stringify(out, null, 1));
console.log(`k_y ${out.k_y.toFixed(3)} ±${out.k_y_sd.toFixed(3)} · k_fw ${out.k_fw.toFixed(3)} ±${out.k_fw_sd.toFixed(3)} · ranges ${JSON.stringify(out.ranges, (k, v) => (typeof v === "number" ? +v.toFixed(3) : v))}`);
}
