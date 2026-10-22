// check-classifier.mjs — ROBUSTNESS OF THE GENERAL SKIN/HAIR CLASSIFIER, without new generations. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/check-classifier.mjs <raw-meshy-head.glb>
//
// Recolours an in-memory COPY of a generated head's texture (hair → brown/blonde/grey/white/red/blue…, skin → deep/
// tan/very light…, shading preserved in CIELAB) and re-runs classifyHead() with NO colour hints. Scores each variant
// against the labels of the original. The source file is only read.
import { LABEL, classifyHead, readTexturedHead } from "./chibify.mjs";
import { adjacency } from "./lib.mjs";

const toLab = (r, g, b) => { const f = (u) => { u /= 255; return u > 0.04045 ? ((u + 0.055) / 1.055) ** 2.4 : u / 12.92; }; const R = f(r), G = f(g), B = f(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * g3(Y) - 16, 500 * (g3(X) - g3(Y)), 200 * (g3(Y) - g3(Z))]; };
const toRgb = (L, a, b) => { const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.95047 * inv(fx), Y = inv(fy), Z = 1.08883 * inv(fz); const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const g = (u) => Math.round(255 * Math.min(1, Math.max(0, u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055))); return [g(R), g(G), g(B)]; };
const hexLab = (h) => toLab(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));

const h = await readTexturedHead(process.argv[2]);
const { nb } = adjacency(h.P, h.I);
const COL0 = h.COL.slice();
const base = classifyHead(h, () => true, nb), L0 = base.label;
const meanLab = (lbl) => { const m = [0, 0, 0]; let c = 0; for (let i = 0; i < h.n; i++) if (L0[i] === lbl) { const l = toLab(COL0[i * 3], COL0[i * 3 + 1], COL0[i * 3 + 2]); for (let q = 0; q < 3; q++) m[q] += l[q]; c++; } return m.map((v) => v / c); };
const hairM = meanLab(LABEL.HAIR), skinM = meanLab(LABEL.SKIN);
const HAIR = { original: null, brown: "#5b3a24", blonde: "#d6b36a", grey: "#9b9b9b", white: "#e8e4dc", red: "#a8432a", blue: "#3a5bc6", pink: "#e27aa9" };
const SKIN = { original: null, deep: "#6a4231", tan: "#b8845a", "very light": "#f4ddcf" };
const cases = [...Object.keys(HAIR).map((k) => [k, "original"]), ["blonde", "deep"], ["black", "deep"], ["white", "very light"], ["grey", "tan"], ["brown", "tan"], ["blonde", "very light"], ["red", "very light"]];
console.log("hair / skin".padEnd(26), "hair recall  hair prec   skin recall  skin prec   bald?");
for (const [hc, sc] of cases) {
  const tH = HAIR[hc] ? hexLab(HAIR[hc]) : null, tS = SKIN[sc] ? hexLab(SKIN[sc]) : null;
  for (let i = 0; i < h.n; i++) { const o = toLab(COL0[i * 3], COL0[i * 3 + 1], COL0[i * 3 + 2]); let out = null;
    if (L0[i] === LABEL.HAIR && tH) out = toRgb(tH[0] + (o[0] - hairM[0]) * 0.9, tH[1] + (o[1] - hairM[1]), tH[2] + (o[2] - hairM[2]));
    if (L0[i] === LABEL.SKIN && tS) out = toRgb(tS[0] + (o[0] - skinM[0]), tS[1] + (o[1] - skinM[1]) * 0.8, tS[2] + (o[2] - skinM[2]) * 0.8);
    h.COL.set(out ?? [COL0[i * 3], COL0[i * 3 + 1], COL0[i * 3 + 2]], i * 3); }
  const r = classifyHead(h, () => true, nb).label;
  const pr = (lbl) => { let tp = 0, fp = 0, fn = 0; for (let i = 0; i < h.n; i++) { const a = L0[i] === lbl, b = r[i] === lbl; if (a && b) tp++; else if (b) fp++; else if (a) fn++; } return [tp / Math.max(1, tp + fn), tp / Math.max(1, tp + fp)]; };
  const [hr, hp] = pr(LABEL.HAIR), [sr, sp] = pr(LABEL.SKIN), f = (v) => (v * 100).toFixed(1).padStart(6) + "%";
  console.log(`${hc} / ${sc}`.padEnd(26), f(hr), "  ", f(hp), "  ", f(sr), "   ", f(sp), "  ", classifyHead(h, () => true, null).bald ? "BALD?!" : "");
}
