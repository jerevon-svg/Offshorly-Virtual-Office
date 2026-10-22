// v3/envelope-compare.mjs — review sheet + facial-envelope table for one person. ZERO CREDITS. Needs :5173.
//   node scripts/avatar-pipeline/human-base/v3/envelope-compare.mjs --who=nicole --mp=<dir> --old=<dir with saved old-V3 renders>
// Columns: APPROVED ILLUSTRATION · PREVIOUS IDENTITY EVIDENCE (V2 candidate / approved) · OLD V3 · NEW V3, front + ¾ (+ face).
// The envelope FACE_WIDTH(t) (visible half-width ÷ eye→chin, hair-occluded where the hair frames the face) is measured
// the same way on all four images of the front close-up; LENGTH/WIDTH = eye→chin ÷ eye-line full width.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { detect } from "./landmarks2d.mjs";
import { BANDS, envelope2D } from "./envelope.mjs";

const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const who = opt("who", "nicole"), MP = opt("mp"), OLD = opt("old"), OUT = "scripts/avatar-pipeline/output/human-base/v3-proof/sheets", TMP = `${process.env.TMPDIR ?? "/tmp"}/hb-v3-cmp`;
fs.mkdirSync(TMP, { recursive: true });
const REF = who === "bon" ? "scripts/avatar-pipeline/output/human-base/meshy-ref/bon-head-ref-final.png" : `scripts/avatar-pipeline/output/human-base/meshy-ref/${who}/${who}-ref-final.png`;
const prev = who === "bon" ? null : `scripts/avatar-pipeline/output/human-base/candidates/${who}/pass2/${who}-v1.glb`, v3 = `scripts/avatar-pipeline/output/human-base/v3-proof/${who}/B/pass1/${who}-v1.glb`;
const tiles = []; for (const [tag, head] of [["prev", prev], ["new", v3]]) for (const view of ["eyeFront", "front34L", "eye34L"]) tiles.push({ who, head, view, save: `${TMP}/${who}-${tag}-${view}.png` });
fs.writeFileSync(`${TMP}/jobs.json`, JSON.stringify([{ out: `${TMP}/x.png`, title: "x", cols: 3, tiles }]));
execFileSync("node", ["scripts/avatar-pipeline/human-base/v3/render.mjs", `${TMP}/jobs.json`], { env: { ...process.env, V3_TILE: "512" }, stdio: "ignore" });
const cols = [["APPROVED ILLUSTRATION", REF, REF, REF], [who === "bon" ? "APPROVED 3D (production)" : "PREVIOUS EVIDENCE (V2 candidate)", `${TMP}/${who}-prev-eyeFront.png`, `${TMP}/${who}-prev-front34L.png`, `${TMP}/${who}-prev-eye34L.png`],
  ["OLD V3", `${OLD}/${who}-B-eyeFront.png`, `${OLD}/${who}-B-front34L.png`, null], ["NEW V3", `${TMP}/${who}-new-eyeFront.png`, `${TMP}/${who}-new-front34L.png`, `${TMP}/${who}-new-eye34L.png`]];
// envelope table on the four front images
const fronts = cols.map((c) => c[1]), det = await detect(MP, fronts), env = [];
for (const [i, f] of fronts.entries()) { const L = det[i].landmarks, e = await envelope2D(f, L), eyeW = Math.abs(L[454][0] - L[234][0]); env.push({ bands: e.bands.map((b) => +b.half.toFixed(3)), lengthOverWidth: +(e.len / (2 * e.bands[0].half * e.len || eyeW)).toFixed(3), hairOccluded: e.bands.map((b) => !!b.hairOccluded) }); }
const table = { who, bands: BANDS, columns: cols.map((c) => c[0]), envelope: env };
fs.writeFileSync(`${OUT}/${who}-envelope.json`, JSON.stringify(table, null, 1));
console.log(`t                      ${BANDS.map((t) => String(t).padEnd(6)).join("")} length/width(eye line)`);
for (const [i, c] of cols.entries()) console.log(`${c[0].slice(0, 22).padEnd(23)}${env[i].bands.map((x) => x.toFixed(3).padEnd(6)).join("")} ${env[i].lengthOverWidth}`);
// sheet: 4 columns × (front, ¾, face ¾) + envelope overlay row
const T = 380, lab = (t) => Buffer.from(`<svg width="${T}" height="30"><rect width="100%" height="100%" fill="#14161a"/><text x="8" y="21" font-family="Menlo,monospace" font-size="14" fill="#eef1f6">${t}</text></svg>`);
const comp = [], rows = ["front", "¾ body", "¾ face"];
for (const [ci, c] of cols.entries()) { comp.push({ input: lab(c[0]), left: ci * T, top: 0 });
  for (let r = 0; r < 3; r++) { const f = c[1 + r]; const img = f ? await sharp(f).resize(T, T, { fit: "contain", background: "#d9dfe6" }).flatten({ background: "#d9dfe6" }).png().toBuffer() : await sharp({ create: { width: T, height: T, channels: 3, background: "#22252b" } }).png().toBuffer();
    comp.push({ input: img, left: ci * T, top: 30 + r * (T + 24) }, { input: Buffer.from(`<svg width="${T}" height="24"><rect width="100%" height="100%" fill="#0d0f12"/><text x="8" y="17" font-family="Menlo,monospace" font-size="12" fill="#7ee0b0">${rows[r]}${f ? "" : " (not captured for old V3)"}</text></svg>`), left: ci * T, top: 30 + r * (T + 24) + T }); } }
// envelope plot: half-width(t) per column
const PW = 4 * T, PH = 300, colr = ["#ffcc00", "#7ee0b0", "#ff6b6b", "#5aa9ff"]; let svg = `<svg width="${PW}" height="${PH}"><rect width="100%" height="100%" fill="#0d0f12"/>`;
const X = (h) => 60 + h * (PW - 120) / 1.0, Y = (t) => 30 + t * (PH - 60);
for (const t of BANDS) svg += `<text x="8" y="${Y(t) + 4}" font-family="Menlo" font-size="11" fill="#889">t=${t}</text><line x1="60" x2="${PW - 60}" y1="${Y(t)}" y2="${Y(t)}" stroke="#222"/>`;
env.forEach((e, i) => { svg += `<polyline fill="none" stroke="${colr[i]}" stroke-width="3" points="${e.bands.map((h, j) => `${X(h)},${Y(BANDS[j])}`).join(" ")}"/><text x="${PW - 420}" y="${20 + i * 16}" font-family="Menlo" font-size="12" fill="${colr[i]}">${cols[i][0]} (length/width ${e.lengthOverWidth})</text>`; });
svg += `<text x="60" y="${PH - 6}" font-family="Menlo" font-size="11" fill="#889">visible face half-width ÷ eye→chin (0 → 1.0), per height band t (0 eye line → 1 chin)</text></svg>`;
const H = 30 + 3 * (T + 24);
comp.push({ input: Buffer.from(svg), left: 0, top: H });
await sharp({ create: { width: 4 * T, height: H + PH, channels: 3, background: "#0d0f12" } }).composite(comp).png().toFile(`${OUT}/${who}-envelope-compare.png`);
console.log(`${OUT}/${who}-envelope-compare.png`);
