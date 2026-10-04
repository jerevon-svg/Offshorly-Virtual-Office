// illustration-traits.mjs — READ AN APPROVED ILLUSTRATED AVATAR into measured face traits. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/illustration-traits.mjs <illustration.png> [out.json]
//
// Every Offshorly employee already has an approved illustrated avatar: it IS the translation of the person into the
// house style. This reads it (front view, transparent or plain background) by pixel analysis — no generation:
//   · SKIN mask (lit and shaded skin), the FACE silhouette row by row (ears removed), the CHIN (the outline crossing
//     the centre line above the neck), the EYE LINE;
//   · dark FEATURES inside the face, found per region: brows, eyes (opening, iris, lid line), nostrils, mouth line,
//     lower-lip / chin marks;
//   · colours: lit skin, shaded skin, iris, brow.
// Everything is normalised by the face half-width at the eye line (W) and measured from the eye line, so it maps onto
// the HumanBase head whatever the illustration's resolution. fit-identity.mjs turns this into identity parameters.
import sharp from "sharp";
import fs from "node:fs";

const file = process.argv[2], out = process.argv[3];
const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const Wd = info.width, Ht = info.height;
const px = (x, y) => { const o = (y * Wd + x) * 4; return [data[o], data[o + 1], data[o + 2], data[o + 3]]; };
const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const isSkin = (c) => c[3] > 200 && c[0] > 160 && c[0] - c[2] > 30 && c[1] > 95 && c[0] >= c[1] && lum(c) > 0.5;
const isDark = (c) => c[3] > 200 && lum(c) < 0.33;

// ---- face silhouette: per row, the skin run through the face's centre column ----------------------------------------
let cx = 0, n = 0; for (let y = Math.floor(Ht * 0.35); y < Ht * 0.6; y++) for (let x = 0; x < Wd; x++) if (isSkin(px(x, y))) { cx += x; n++; }
cx = Math.round(cx / n);
/** the skin span through x0 on row y, crossing gaps of at most `tol` px (tol 3 stops at outline strokes) */
const run = (y, tol = 3, x0 = cx) => {
  const go = (d) => { let x = x0, gap = 0, last = x0; while (x > 0 && x < Wd - 1) { x += d; const c = px(x, y); if (isSkin(c)) { last = x; gap = 0; } else if (++gap > tol) break; } return last; };
  return isSkin(px(x0, y)) ? [go(-1), go(1)] : null;
};
// ---- DARK BANDS down the face: brows, eyes (the first two strong bands under the hairline) --------------------------
const darkRow = (y, hw = 200) => { let k = 0; for (let x = cx - hw; x <= cx + hw; x++) if (isDark(px(x, y))) k++; return k; };
const skinRow = (y) => { let k = 0; for (let x = 0; x < Wd; x++) if (isSkin(px(x, y))) k++; return k; };
const faceTop = (() => { for (let y = 0; y < Ht; y++) if (skinRow(y) > 150) return y; return 0; })();
// within the face interior only (side hair overlays the face edges); the EYE band is the band followed by a clear
// cheek zone (40 rows with almost no dark), the BROW band is the band just above it
const bands = []; for (let y = faceTop; y < Ht; y++) { if (darkRow(y, 125) > 35) { const b = bands[bands.length - 1]; if (b && y - b.y1 <= 3) b.y1 = y; else bands.push({ y0: y, y1: y }); } }
const clearBelow = (y) => { for (let k = 2; k < 42; k++) if (darkRow(y + k, 125) > 12) return false; return true; };
const ei = bands.findIndex((b) => clearBelow(b.y1));
const eyeB = bands[ei], browB = bands[ei - 1];
const eyeY = Math.round((eyeB.y0 + eyeB.y1) / 2);
// ---- below the eyes: nose (nostrils), mouth line, lower-lip / chin marks — small central dark groups -------------------
let neckY = -1; for (let y = Ht - 1; y > eyeY; y--) if (isSkin(px(cx, y))) { neckY = y; break; }
let chinY = -1; { let y = neckY; while (y > eyeY && isSkin(px(cx, y))) y--; while (y > eyeY && !isSkin(px(cx, y))) y--; chinY = y + 1; }
// feature strokes: anything opaque, not skin, clearly darker than skin (illustrations draw mouths in brown, not black)
const isStroke = (c) => c[3] > 200 && !isSkin(c) && lum(c) < 0.62;
const darkIn = (x0, x1, y0, y1, pred = isStroke) => { const p = []; for (let y = Math.max(0, y0); y < Math.min(Ht, y1); y++) for (let x = Math.max(0, x0); x < Math.min(Wd, x1); x++) if (pred(px(x, y))) p.push([x, y]); return p; };
const box = (p) => p.length ? { x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])), n: p.length } : null;
const lower = darkIn(cx - 90, cx + 90, eyeB.y1 + 30, chinY - 6);
const lrows = [...new Set(lower.map((q) => q[1]))].sort((a, b) => a - b);
const groups = []; for (const y of lrows) { const g = groups[groups.length - 1]; if (g && y - g.y1 <= 2) g.y1 = y; else groups.push({ y0: y, y1: y }); }
const feat = groups.map((g) => box(lower.filter((q) => q[1] >= g.y0 && q[1] <= g.y1))).filter((b) => b && b.n > 10);
const nose = feat[0];
const mouth = feat.slice(1)[0];   // the first stroke group below the nose
const marks = feat.filter((b) => b !== nose && b !== mouth && b.y0 > mouth.y1);
// ---- the face width: at the cheeks, below the nose (hair never covers it there), outline-bounded ------------------
const cheekY = nose.y1 + Math.round((mouth.y0 - nose.y1) * 0.5);
const span = (y) => { const r = run(y); return r ? (r[1] - r[0]) / 2 : 0; };
const Wf = Math.max(...[-4, -2, 0, 2, 4].map((d) => span(cheekY + d)));
// ---- eyes and brows inside their bands, within the face ---------------------------------------------------------
const eyes = {}, brows = {};
for (const [s, sx] of [["l", 1], ["r", -1]]) {
  const xa = Math.round(sx > 0 ? cx + 12 : cx - Wf * 0.95), xb = Math.round(sx > 0 ? cx + Wf * 0.95 : cx - 12);
  eyes[s] = box(darkIn(xa, xb, eyeB.y0 - 2, eyeB.y1 + 3));
  brows[s] = box(darkIn(xa, xb, browB.y0, browB.y1 + 1));
}
// colours
const sample = (pred, x0, x1, y0, y1) => { const c = [0, 0, 0]; let k = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = px(x, y); if (pred(q)) { c[0] += q[0]; c[1] += q[1]; c[2] += q[2]; k++; } } return k ? "#" + c.map((v) => Math.round(v / k).toString(16).padStart(2, "0")).join("") : null; };
const skinLit = sample((q) => isSkin(q) && lum(q) > 0.78, cx, cx + Wf, eyeY + 20, chinY - 20);
const skinShade = sample((q) => isSkin(q) && lum(q) < 0.76, cx - Wf, cx, eyeY + 20, chinY - 20);
const N = (v) => +(v / Wf).toFixed(3);
const traits = {
  source: file.split("/").pop(), size: [Wd, Ht], centreX: cx, eyeLineY: eyeY, chinY, faceHalfWidthAtEyes: Wf,
  units: "face half-widths at the eye line; y down from the eye line (+ = lower)",
  faceLength: N(chinY - eyeY),
  // the face outline below the eye line (t = 0 eyes … 1 chin); above the cheeks hair hides it
  // measured from a cheek point (not the centre: the nose and mouth would cut the run short)
  silhouette: [0.35, 0.5, 0.65, 0.8, 0.9].map((f) => { const y = Math.round(eyeY + f * (chinY - eyeY)); let best = 0; for (const fx of [0.5, 0.3, 0.1]) { const r = run(y, 3, Math.round(cx + fx * Wf)); if (r) best = Math.max(best, Math.max(cx - r[0], r[1] - cx)); } return { t: f, halfWidth: N(best) }; }),
  bands: bands.slice(0, 2),
  eyes: { centreX: N(((eyes.l.x0 + eyes.l.x1) / 2 - (eyes.r.x0 + eyes.r.x1) / 2) / 2), halfWidth: N(((eyes.l.x1 - eyes.l.x0) + (eyes.r.x1 - eyes.r.x0)) / 4), halfHeight: N(((eyes.l.y1 - eyes.l.y0) + (eyes.r.y1 - eyes.r.y0)) / 4), y: N((eyes.l.y0 + eyes.l.y1 + eyes.r.y0 + eyes.r.y1) / 4 - eyeY) },
  brows: { y: N((brows.l.y0 + brows.l.y1 + brows.r.y0 + brows.r.y1) / 4 - eyeY), thickness: N(((brows.l.y1 - brows.l.y0) + (brows.r.y1 - brows.r.y0)) / 2), innerX: N((Math.min(Math.abs(brows.l.x0 - cx), Math.abs(brows.l.x1 - cx)) + Math.min(Math.abs(brows.r.x0 - cx), Math.abs(brows.r.x1 - cx))) / 2), outerX: N((Math.max(Math.abs(brows.l.x0 - cx), Math.abs(brows.l.x1 - cx)) + Math.max(Math.abs(brows.r.x0 - cx), Math.abs(brows.r.x1 - cx))) / 2) },
  nose: nose ? { y: N((nose.y0 + nose.y1) / 2 - eyeY), halfWidth: N((nose.x1 - nose.x0) / 2) } : null,
  mouth: mouth ? { y: N((mouth.y0 + mouth.y1) / 2 - eyeY), halfWidth: N((mouth.x1 - mouth.x0) / 2), thickness: N(mouth.y1 - mouth.y0) } : null,
  chinMarks: marks.map((b) => ({ y: N((b.y0 + b.y1) / 2 - eyeY), halfWidth: N((b.x1 - b.x0) / 2) })),
  colours: { skinLit, skinShade, brow: sample((q) => isDark(q), brows.l.x0, brows.l.x1, brows.l.y0, brows.l.y1 + 1), iris: sample((q) => isDark(q), eyes.l.x0, eyes.l.x1, eyes.l.y0, eyes.l.y1 + 1) },
};
console.log(JSON.stringify(traits, null, 1));
if (out) fs.writeFileSync(out, JSON.stringify(traits, null, 1));
