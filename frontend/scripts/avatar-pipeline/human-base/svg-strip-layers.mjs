// svg-strip-layers.mjs — remove named drawable elements (by document index, as listed by a render-diff) from an
// approved VECTOR illustration and render it. Lossless: nothing is painted or invented — the artist's own underlying
// layers show through. ZERO CREDITS. Source is read only.
//   node svg-strip-layers.mjs <src.svg> <out.png> <size> [idx,idx,…]
import fs from "node:fs";
import sharp from "sharp";
const [src, out, size, list] = process.argv.slice(2);
const drop = new Set((list ?? "").split(",").filter(Boolean).map(Number));
let svg = fs.readFileSync(src, "utf8"); const re = /<(path|use|rect|ellipse|circle)\b[^>]*\/>/g; const cuts = []; let m, i = 0;
while ((m = re.exec(svg))) { if (drop.has(i)) cuts.push([m.index, m.index + m[0].length]); i++; }
for (const [a, b] of cuts.reverse()) svg = svg.slice(0, a) + svg.slice(b);
const S = Number(size); await sharp(Buffer.from(svg), { density: (72 * S) / 685 }).resize(S, S).png().toFile(out);
console.log(`removed ${cuts.length} of ${i} elements → ${out}`);
