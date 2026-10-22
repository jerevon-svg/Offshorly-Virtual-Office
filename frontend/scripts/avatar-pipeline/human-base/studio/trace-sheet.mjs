// studio/trace-sheet.mjs — the IDENTITY ANALYSIS made visible: the approved illustration with its Stage 0 trace (face outline coloured
// by evidence — visible edge / face stroke / hair-bounded; eyes, brows, nose base + wings, mouth) and the style-translated targets the
// correction uses, with provenance. Zero credits. From frontend/:   node scripts/avatar-pipeline/human-base/studio/trace-sheet.mjs <who>
import fs from "node:fs";
import { createRequire } from "node:module";
import { targetFor } from "../identity-correct.mjs";
const sharp = createRequire(`${process.cwd()}/package.json`)("sharp"), who = process.argv[2], O = "scripts/avatar-pipeline/output/human-base";
const T = await targetFor(who), dir = T.source.slice(0, T.source.lastIndexOf("/")), p = JSON.parse(fs.readFileSync(T.source, "utf8")).results[T.key], img = `${dir}/${T.key}-canonical.png`;
const m = await sharp(img).metadata(), W = m.width, H = m.height, col = { visible: "#00c853", "stroke-over-ear": "#2962ff", "stroke-over-neck": "#00b0ff", "edge-over-neck": "#00e5ff", "scalp-silhouette": "#ffd600", "hair-bounded": "#ff1744", "feature-at-edge": "#ff9100" };
const line = (pts, c, w = 4, close = false) => `<polyline points="${[...pts, ...(close ? [pts[0]] : [])].map((q) => q.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>`;
let svg = ""; for (let i = 0; i < p.contour.length; i++) { const a = p.contour[i], b = p.contour[(i + 1) % p.contour.length]; svg += `<line x1="${a.pt[0]}" y1="${a.pt[1]}" x2="${b.pt[0]}" y2="${b.pt[1]}" stroke="${col[a.label] ?? "#bbbbbb"}" stroke-width="6"/>`; }
for (const e of [p.eyes?.R, p.eyes?.L]) if (e?.upper) { svg += line(e.upper, "#ff00ff", 4) + line(e.lower, "#ff00ff", 4); }
for (const b of [p.brows?.R, p.brows?.L]) if (b?.found) svg += line([...b.top, ...b.bottom.slice().reverse()], "#8d6e63", 3, true);
if (p.nose?.found) svg += `<circle cx="${p.nose.base[0]}" cy="${p.nose.base[1]}" r="9" fill="#ffab00"/><circle cx="${p.nose.wingR[0]}" cy="${p.nose.wingR[1]}" r="7" fill="#ffab00"/><circle cx="${p.nose.wingL[0]}" cy="${p.nose.wingL[1]}" r="7" fill="#ffab00"/>`;
if (p.mouth?.found) svg += line(p.mouth.upper, "#d50000", 4) + line(p.mouth.lower, "#d50000", 4);
const overlay = await sharp(img).composite([{ input: Buffer.from(`<svg width="${W}" height="${H}">${svg}</svg>`) }]).png().toBuffer();
const tg = T.target, rows = [["face height / eye spacing", "frame.faceH_IOD"], ["eye-level width", "frame.eyeLevelW_IOD"], ["cheek width", "frame.cheekW_IOD"], ["nose-level width", "frame.noseLevelW_IOD"], ["mouth-level width", "frame.mouthLevelW_IOD"], ["jaw width", "frame.jawW_IOD"], ["chin width", "frame.chinW_IOD"], ["chin roundness 50%", "frame.chinRound50"], ["eye width", "h.eyeW_IOD"]]
  .filter(([, k]) => tg[k]).map(([l, k]) => `${l.padEnd(26)} ${tg[k].v.toFixed(3).padStart(6)}  ${/STYLE_PRIOR/.test(tg[k].flag ?? "") ? "weak (hair-hidden)" : (tg[k].flag ?? "observed").slice(0, 26)}`);
const PW = 620, panel = `<svg width="${PW}" height="${H}"><rect width="100%" height="100%" fill="#101216"/><text x="20" y="44" font-family="Helvetica" font-size="26" fill="#eef1f6">${who} · identity analysis (Stage 0)</text>
  <text x="20" y="80" font-family="Helvetica" font-size="16" fill="#9aa3b2">traced outline: green visible · blue face stroke · red hair-bounded (never skin)</text>
  <text x="20" y="104" font-family="Helvetica" font-size="16" fill="#9aa3b2">magenta eyes · brown brows · amber nose base + wings · red mouth</text>
  <text x="20" y="150" font-family="Helvetica" font-size="18" fill="#eef1f6">Offshorly targets (style-translated, × eye spacing)</text>
  ${rows.map((r, i) => `<text x="20" y="${186 + i * 30}" font-family="Menlo, monospace" font-size="15" fill="#cfd6e2" xml:space="preserve">${r.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("")}
  <text x="20" y="${200 + rows.length * 30}" font-family="Helvetica" font-size="14" fill="#7d8796">eye evidence: ${(p.eyeEvidence?.flag ?? "observed").replace(/&/g, "&amp;")}</text></svg>`;
fs.mkdirSync(`${O}/studio`, { recursive: true });
await sharp({ create: { width: W + PW, height: H, channels: 3, background: "#101216" } }).composite([{ input: overlay, left: 0, top: 0 }, { input: Buffer.from(panel), left: W, top: 0 }]).png().toFile(`${O}/studio/${who}-trace.png`);
console.log(`${O}/studio/${who}-trace.png`);
