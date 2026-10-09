// v3/stage1/overlay.mjs — XYZ proof: midline side PROFILES (y–z), horizontal CROSS-SECTIONS (x–z) at five face heights, and
// FRONT outlines (x–y), all computed from the meshes' vertex coordinates (no rendering), overlaid in one sheet.
import fs from "node:fs";
import sharp from "sharp";
import { loadTemplate } from "../fit.mjs";
const tpl = loadTemplate(), TL = tpl.landmarks, RG = tpl.REGION, O = "scripts/avatar-pipeline/output/human-base/stage1-proof";
const prior = Float32Array.from(JSON.parse(fs.readFileSync(`${O}/base2.json`, "utf8")).P);   // the parametric Offshorly base (style prior)
const sel = JSON.parse(fs.readFileSync(`${O}/selection.json`, "utf8")), ids = [sel.anchor, ...sel.pair];
const heads = [["style prior", prior, "#8d99a6"], ...ids.map((w, k) => [w, Float32Array.from(JSON.parse(fs.readFileSync(`${O}/${w}/V/pass1/qa-geometry.json`, "utf8")).X), ["#d1495b", "#2e86ab", "#3a7d44"][k]])];
const ear = (i) => tpl.region[i] === RG.earL || tpl.region[i] === RG.earR;
const profile = (X) => { const out = []; for (let y = 0.8; y <= 1.72; y += 0.006) { let z = null; for (let i = 0; i < tpl.n; i++) if (Math.abs(X[i * 3]) < 0.012 && Math.abs(X[i * 3 + 1] - y) < 0.004 && (z === null || X[i * 3 + 2] > z)) z = X[i * 3 + 2]; if (z !== null) out.push([z, y]); } return out; };
const section = (X, y0) => { const B = 140, best = new Array(B).fill(null); for (let i = 0; i < tpl.n; i++) { if (ear(i) || Math.abs(X[i * 3 + 1] - y0) > 0.005 || X[i * 3 + 2] < -0.02) continue; const b = Math.min(B - 1, Math.max(0, Math.floor((X[i * 3] + 0.5) / 1.0 * B))); if (best[b] === null || X[i * 3 + 2] > best[b][1]) best[b] = [X[i * 3], X[i * 3 + 2]]; } return best.filter(Boolean); };   // front surface per x bin
const front = (X) => { const B = 120, best = new Array(B).fill(null), cy = 1.15; for (let i = 0; i < tpl.n; i++) { if (ear(i) || X[i * 3 + 2] < -0.05) continue; const a = Math.atan2(X[i * 3 + 1] - cy, X[i * 3]), b = Math.min(B - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * B)), r = Math.hypot(X[i * 3], X[i * 3 + 1] - cy); if (!best[b] || r > best[b][2]) best[b] = [X[i * 3], X[i * 3 + 1], r]; } return best.filter(Boolean).map((q) => [q[0], q[1]]); };
const levels = [["brow", 1.27], ["eye", 1.175], ["cheekbone", 1.09], ["mouth", 0.93], ["jaw", 0.87]];
const W = 1900, H = 1180, s = [], esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
s.push(`<rect width="${W}" height="${H}" fill="#fbfaf7"/><text x="24" y="40" font-family="Helvetica" font-size="24" font-weight="700" fill="#1d2733">Stage 1 — XYZ geometry proof (vertex coordinates, no rendering): profiles · cross-sections · front outlines</text>`);
heads.forEach(([n, , c], k) => s.push(`<rect x="${24 + k * 170}" y="56" width="16" height="16" fill="${c}"/><text x="${46 + k * 170}" y="70" font-family="Helvetica" font-size="15" fill="#1d2733">${esc(n)}</text>`));
// panel A: side profiles (z → x axis, y up)
const pA = { x: 24, y: 90, w: 520, h: 720 }, mA = (q) => [pA.x + 40 + (q[0] - 0.05) * 1100, pA.y + pA.h - 20 - (q[1] - 0.8) * 740];
s.push(`<rect x="${pA.x}" y="${pA.y}" width="${pA.w}" height="${pA.h}" fill="#fff" stroke="#d6d2c8"/><text x="${pA.x + 10}" y="${pA.y + 22}" font-family="Helvetica" font-size="15" font-weight="700" fill="#1d2733">A · midline SIDE PROFILE (z–y) — face to the right</text>`);
for (const [, X, c] of heads) { const pr = profile(X).filter((q) => q[0] > 0.05); s.push(`<polyline points="${pr.map((q) => mA(q).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="2.4"/>`); }
// panel B: cross-sections
levels.forEach(([nm, y0], k) => { const px = 570 + (k % 3) * 440, py = 90 + Math.floor(k / 3) * 370, mB = (q) => [px + 210 + q[0] * 420, py + 300 - (q[1] + 0.05) * 420];
  s.push(`<rect x="${px}" y="${py}" width="420" height="350" fill="#fff" stroke="#d6d2c8"/><text x="${px + 10}" y="${py + 22}" font-family="Helvetica" font-size="15" font-weight="700" fill="#1d2733">B · cross-section x–z at ${nm} (y=${y0}) — front up</text>`);
  for (const [, X, c] of heads) { const sec = section(X, y0).filter((q) => q[1] > -0.02); s.push(`<polyline points="${sec.sort((a, b) => a[0] - b[0]).map((q) => mB(q).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="2.2"/>`); } });
// panel C: front outlines
{ const px = 1450, py = 460, mC = (q) => [px + 210 + q[0] * 420, py + 680 - (q[1] - 0.78) * 420];
  s.push(`<rect x="${px}" y="${py}" width="420" height="700" fill="#fff" stroke="#d6d2c8"/><text x="${px + 10}" y="${py + 22}" font-family="Helvetica" font-size="15" font-weight="700" fill="#1d2733">C · FRONT outline x–y (ears excluded)</text>`);
  for (const [, X, c] of heads) { const f = front(X); s.push(`<polygon points="${f.map((q) => mC(q).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="2.2"/>`); } }
// numbers: per-head displacement from the style prior (XYZ split)
const stats = heads.slice(1).map(([n, X]) => { let sx = 0, sy = 0, sz = 0, mz = 0, c = 0; for (let i = 0; i < tpl.n; i++) { if (ear(i) || tpl.region[i] === RG.scalp || tpl.region[i] === RG.nape) continue; const dx = X[i * 3] - prior[i * 3], dy = X[i * 3 + 1] - prior[i * 3 + 1], dz = X[i * 3 + 2] - prior[i * 3 + 2]; sx += dx * dx; sy += dy * dy; sz += dz * dz; mz = Math.max(mz, Math.abs(dz)); c++; } return [n, Math.sqrt(sx / c), Math.sqrt(sy / c), Math.sqrt(sz / c), mz]; });
s.push(`<text x="24" y="845" font-family="Helvetica" font-size="15" font-weight="700" fill="#1d2733">Face-region vertex displacement from the style prior (canonical units; head ≈ 0.9 tall)</text>`);
stats.forEach(([n, x, y, z, mz], k) => s.push(`<text x="24" y="${872 + k * 22}" font-family="Menlo, monospace" font-size="14" fill="#1d2733">${esc(n.padEnd(7))} RMS dx ${x.toFixed(4)}  dy ${y.toFixed(4)}  dz ${z.toFixed(4)}  max|dz| ${mz.toFixed(4)}</text>`));
fs.writeFileSync(`${O}/xyz-displacement.json`, JSON.stringify(Object.fromEntries(stats.map(([n, x, y, z, mz]) => [n, { rmsDx: x, rmsDy: y, rmsDz: z, maxAbsDz: mz }])), null, 1));
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${s.join("")}</svg>`)).png().toFile(`${O}/sheets/stage1-xyz-overlay.png`);
console.log("overlay written", JSON.stringify(stats.map((r) => [r[0], ...r.slice(1).map((v) => +v.toFixed(4))])));
