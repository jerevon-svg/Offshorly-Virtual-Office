// v3/identity/eyestrip.mjs — Stage 0 eye close-up review: SOURCE EYES | EXTRACTED EYES (over faded source) for every id.
//   node scripts/avatar-pipeline/human-base/v3/identity/eyestrip.mjs [--out=<dir>] [--json=<identity.json>] [--name=<png>]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CX, CY, IOD } from "./extract.mjs";
const require = createRequire("/Users/lekoffshorly/Documents/AI Agents/frontend/package.json");
const sharp = require("sharp");
const args = process.argv.slice(2), opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = opt("out") ?? "scripts/avatar-pipeline/output/human-base/stage0-identity";
const J = JSON.parse(fs.readFileSync(opt("json") ?? path.join(OUT, "identity.json"), "utf8")).results, people = Object.values(J).filter((r) => r.eyes);
const box = { x0: CX - 1.05 * IOD, y0: CY - 0.62 * IOD, w: 2.1 * IOD, h: 0.95 * IOD }, Z = 3.0, PW = Math.round(box.w * Z), PH = Math.round(box.h * Z);
const m = (ox, oy) => (q) => [ox + (q[0] - box.x0) * Z, oy + (q[1] - box.y0) * Z];
const f = (v) => v.toFixed(1), pts = (a, M) => a.map((q) => M(q).map(f).join(",")).join(" ");
async function crop(id, fade) { let i = sharp(path.join(OUT, `${id}-canonical.png`)).extract({ left: Math.round(box.x0), top: Math.round(box.y0), width: Math.round(box.w), height: Math.round(box.h) }).resize(PW, PH, { kernel: "lanczos3" });
  if (fade) i = i.modulate({ saturation: 0.25 }).linear(0.4, 150); return (await i.png().toBuffer()).toString("base64"); }
let clipN = 0;
function eyeSVG(e, M, col) {
  if (!e?.found) return "";
  const s = [], st = e.conf >= 0.75 ? "" : ` stroke-dasharray="7 4"`;
  if (e.upper && e.lower) { s.push(`<polyline points="${pts(e.upper, M)}" fill="none" stroke="${col}" stroke-width="3"${st}/>`, `<polyline points="${pts(e.lower, M)}" fill="none" stroke="#2b8a3e" stroke-width="3"${st}/>`); }
  for (const [q, c] of [[e.inner, "#c2255c"], [e.outer, "#1971c2"]]) if (q) { const [x, y] = M(q); s.push(`<circle cx="${f(x)}" cy="${f(y)}" r="6" fill="${c}" stroke="#fff" stroke-width="1.5"/>`); }
  if (e.iris) { const [x, y] = M(e.iris), id = `clip${++clipN}`, poly = pts([...e.upper, ...e.lower.slice().reverse()], M), weak = e.irisConf !== undefined && e.irisConf < 0.6;
    s.push(`<clipPath id="${id}"><polygon points="${poly}"/></clipPath>`, `<circle cx="${f(x)}" cy="${f(y)}" r="${f(e.irisR * Z)}" fill="none" stroke="#e8590c" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="3 4"/>`,
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(e.irisR * Z)}" fill="none" stroke="#e8590c" stroke-width="3" clip-path="url(#${id})"${weak ? ` stroke-dasharray="6 4"` : ""}/>`, `<circle cx="${f(x)}" cy="${f(y)}" r="3" fill="#e8590c"/>`); }
  if (e.upperObs) e.upper.forEach((q, i) => { if (!e.upperObs[i]) { const [x, y] = M(q); s.push(`<circle cx="${f(x)}" cy="${f(y)}" r="3.5" fill="#fff" stroke="${col}" stroke-width="1.5"/>`); } });
  if (e.lowerObs) e.lower.forEach((q, i) => { if (!e.lowerObs[i]) { const [x, y] = M(q); s.push(`<circle cx="${f(x)}" cy="${f(y)}" r="3.5" fill="#fff" stroke="#2b8a3e" stroke-width="1.5"/>`); } });
  if (e.unknown?.length) for (const u of e.unknown) { const q = e[u === "inner" || u === "outer" ? u : null]; if (q) { const [x, y] = M(q); s.push(`<text x="${f(x)}" y="${f(y - 10)}" font-size="18" fill="#868e96" text-anchor="middle" font-family="Helvetica">?</text>`); } }
  return s.join("");
}
const APP = [["lineWork", "#7048e8", 0.55, "lid lines / liner / lashes"], ["eyeballShade", "#1c7ed6", 0.45, "shading ON the eyeball (inside opening)"], ["highlight", "#15aabf", 0.9, "iris highlight"], ["underEye", "#f08c00", 0.55, "under-eye shading / lines"], ["crease", "#a61e4d", 0.6, "lid crease / lines above lid"], ["accessory", "#2f9e44", 0.45, "glasses / accessory"]];
function appSVG(e, M) { if (!e?.appearance) return ""; const s = [];
  for (const [k, col, op] of APP) for (const [y, x0, x1] of e.appearance[k] ?? []) { const [a, b] = M([x0 - 0.5, y - 0.5]), [c] = M([x1 + 0.5, y]); s.push(`<rect x="${f(a)}" y="${f(b)}" width="${f(c - a)}" height="${f(Z)}" fill="${col}" fill-opacity="${op}"/>`); }
  if (e.upper) s.push(`<polyline points="${pts([...e.upper, ...e.lower.slice().reverse(), e.upper[0]], M)}" fill="none" stroke="#212529" stroke-width="1.2" stroke-dasharray="4 3"/>`);
  return s.join(""); }
function browSVG(b, M) { if (!b?.found) return ""; return `<polygon points="${pts([...b.top, ...b.bottom.slice().reverse()], M)}" fill="#495057" fill-opacity="0.35" stroke="#212529" stroke-width="1.5"${b.conf < 0.75 ? ` stroke-dasharray="5 3"` : ""}/>`; }
const gap = 24, W = 40 + PW * 3 + gap * 2 + 40, rowH = PH + 74, H = 150 + rowH * people.length + 60, s = [];
s.push(`<rect width="${W}" height="${H}" fill="#fbfaf7"/>`, `<text x="30" y="44" font-family="Helvetica" font-size="27" font-weight="700" fill="#1d2733">${opt("title") ?? "Stage 0 — eye close-up: SOURCE EYES | EXTRACTED STRUCTURAL EYES | APPEARANCE EVIDENCE"}</text>`,
  `<text x="30" y="100" font-family="Helvetica" font-size="15" fill="#4a5561">Panels: SOURCE · STRUCTURAL EYE (structure + iris only) · APPEARANCE EVIDENCE (kept separately; dashed outline = structure for reference).  ${APP.map(([, c, , n]) => `<tspan fill="${c}">■ ${n}</tspan>`).join("   ")}</text>`,
  `<text x="30" y="76" font-family="Helvetica" font-size="15" fill="#4a5561">STRUCTURE: upper lid (red) · lower lid (green) · inner corner ● pink · outer corner ● blue · iris (orange) · brow (grey). ○ on a lid = inferred (liner touches iris), solid = observed. Iris: solid arc = visible, faint = hidden by lid. Dashed = low confidence; ? = corner not observable.</text>`);
for (let k = 0; k < people.length; k++) { const p = people[k], y = 140 + k * rowH, a = await crop(p.id, false), b = await crop(p.id, true), x2 = 40 + PW + gap;
  const meta = ["R", "L"].map((sd) => { const e = p.eyes[sd]; if (!e.found) return `${sd}: not found`; const w = Math.abs(e.outer[0] - e.inner[0]); return `${sd === "R" ? "viewer-left" : "viewer-right"} eye: w ${(w / IOD).toFixed(2)} IOD · conf ${e.conf}${e.flags?.length ? " · " + e.flags.join(",") : ""}`; }).join("     ");
  s.push(`<text x="40" y="${y - 6}" font-family="Helvetica" font-size="19" font-weight="700" fill="#1d2733">${p.id[0].toUpperCase() + p.id.slice(1)}</text><text x="170" y="${y - 6}" font-family="Helvetica" font-size="13.5" fill="#5c6670">${meta}</text>`);
  s.push(`<image x="40" y="${y + 4}" width="${PW}" height="${PH}" href="data:image/png;base64,${a}"/>`, `<image x="${x2}" y="${y + 4}" width="${PW}" height="${PH}" href="data:image/png;base64,${b}"/>`);
  const M = m(x2, y + 4); s.push(eyeSVG(p.eyes.R, M, "#e03131"), eyeSVG(p.eyes.L, M, "#e03131"));
  const x3 = x2 + PW + gap, M3 = m(x3, y + 4); s.push(`<image x="${x3}" y="${y + 4}" width="${PW}" height="${PH}" href="data:image/png;base64,${b}"/>`, appSVG(p.eyes.R, M3), appSVG(p.eyes.L, M3));
  const sw = ["R", "L"].map((sd) => p.eyes[sd].appearance ? `${sd === "R" ? "v-left" : "v-right"} lid-line weight ${p.eyes[sd].appearance.strokeWeight.upper ?? "—"}px${p.eyes[sd].appearance.celSplit ? " · cel-shadow crosses eye" : ""}` : "").join("   ");
  s.push(`<text x="${x3}" y="${y - 6}" font-family="Helvetica" font-size="12.5" fill="#5c6670">${sw}</text>`);
  s.push(`<rect x="40" y="${y + 4}" width="${PW}" height="${PH}" fill="none" stroke="#d6d2c8"/><rect x="${x2}" y="${y + 4}" width="${PW}" height="${PH}" fill="none" stroke="#d6d2c8"/><rect x="${x3}" y="${y + 4}" width="${PW}" height="${PH}" fill="none" stroke="#d6d2c8"/>`); }
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${s.join("")}</svg>`)).png().toFile(path.join(OUT, opt("name") ?? "stage0-eye-closeup.png"));
console.log("eye strip written", W, H);
