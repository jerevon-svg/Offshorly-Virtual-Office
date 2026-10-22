// v3/identity/report.mjs — Stage 0: normalised identity frame, traits, pairwise distinctness, and the two review sheets.
//   node scripts/avatar-pipeline/human-base/v3/identity/report.mjs [--out=<dir>]
// Pure function of identity.json (+ the canonical crops for the source panels). No manual editing of any sketch.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CX, CY, IOD } from "./extract.mjs";
import { normalise, resample, traits, vec, dist, known, GRID } from "./metrics.mjs";
const require = createRequire("/Users/lekoffshorly/Documents/AI Agents/frontend/package.json");
const sharp = require("sharp");

const args = process.argv.slice(2), opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = opt("out") ?? "scripts/avatar-pipeline/output/human-base/stage0-identity";
const J = JSON.parse(fs.readFileSync(path.join(OUT, "identity.json"), "utf8")), people = Object.values(J.results).filter((r) => r.contour);
const COLORS = ["#d1495b", "#2e86ab", "#e39b1b", "#3a7d44", "#8e5ad6", "#1b998b"];
const LBL = { visible: "solid", "stroke-over-neck": "solid", "edge-over-neck": "solid", "scalp-silhouette": "solid", "stroke-over-ear": "dash", "hair-bounded": "dash" }; // others = unknown

// ---------- drawing ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function sketchSVG(p, map, { face = true, hair = true, color = "#1d2733", ghost = false, hairImg = null } = {}) {
  const P = (q) => map(q).map((v) => v.toFixed(1)).join(","), s = [];
  if (hair) { if (hairImg) s.push(hairImg);
    for (const h of p.hairRays) if (h.pt) s.push(h.label === "hair" ? `<circle cx="${map(h.pt)[0].toFixed(1)}" cy="${map(h.pt)[1].toFixed(1)}" r="1.7" fill="#9c7647"/>` : `<circle cx="${map(h.pt)[0].toFixed(1)}" cy="${map(h.pt)[1].toFixed(1)}" r="2.4" fill="none" stroke="#9c7647" stroke-width="1"/>`);
    const hl = p.hairline.filter((h) => h.y !== null && h.kind === "hair-edge"); if (hl.length > 1) s.push(`<polyline points="${hl.map((h) => P([h.x, h.y])).join(" ")}" fill="none" stroke="#2f9e44" stroke-width="2" stroke-dasharray="5 3"/>`); }
  if (face) {
    const C = p.contour;
    for (let i = 0; i < C.length; i++) { const A = C[i], B = C[(i + 1) % C.length], st = !known(A) || !known(B) ? "unk" : LBL[A.label] === "solid" && LBL[B.label] === "solid" ? "solid" : "dash";
      const [x1, y1] = map(A.pt), [x2, y2] = map(B.pt);
      s.push(st === "solid" ? `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>`
        : st === "dash" ? `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${ghost ? color : "#e07a1f"}" stroke-width="2.2" stroke-dasharray="5 3"/>`
          : `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${ghost ? color : "#8d99a6"}" stroke-opacity="${ghost ? 0.35 : 0.9}" stroke-width="1.4" stroke-dasharray="1.5 3"/>`); }
    if (!ghost) for (const c of C) { const [x, y] = map(c.pt); s.push(known(c) ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${LBL[c.label] === "solid" ? color : "#e07a1f"}"/>` : `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="8" fill="#8d99a6" text-anchor="middle" font-family="Helvetica">?</text>`); }
    for (const sd of ["R", "L"]) { const e = p.eyes[sd]; if (e.found) { s.push(`<polygon points="${[...e.upper, ...e.lower.slice().reverse()].map(P).join(" ")}" fill="${ghost ? "none" : "#fff"}" stroke="${color}" stroke-width="1.6"/>`);
        const [ix, iy] = map(e.iris), rr = Math.abs(map([e.iris[0] + e.irisR, e.iris[1]])[0] - ix); s.push(`<circle cx="${ix.toFixed(1)}" cy="${iy.toFixed(1)}" r="${rr.toFixed(1)}" fill="${ghost ? "none" : color}" stroke="${color}" stroke-width="1.2"/>`); }
      const b = p.brows[sd]; if (b.found) s.push(`<polygon points="${[...b.top, ...b.bottom.slice().reverse()].map(P).join(" ")}" fill="${ghost ? "none" : color}" fill-opacity="${b.conf < 0.6 ? 0.45 : 0.9}" stroke="${color}" stroke-width="1.2"/>`); }
    if (p.nose.found) { const n = p.nose; s.push(`<path d="M${P(n.wingR)} Q${P([n.base[0], n.base[1] + 6])} ${P(n.wingL)}" fill="none" stroke="${color}" stroke-width="2"/>`); for (const q of [n.wingR, n.wingL, n.base]) s.push(`<circle cx="${map(q)[0].toFixed(1)}" cy="${map(q)[1].toFixed(1)}" r="2" fill="${color}"/>`); }
    if (p.mouth.found) { const m = p.mouth; s.push(`<polygon points="${[...m.upper, ...m.lower.slice().reverse()].map(P).join(" ")}" fill="${ghost ? "none" : "#e8a39b"}" fill-opacity="0.7" stroke="${color}" stroke-width="1.6"/>`); }
  }
  return s.join("");
}

const crop = { x0: CX - 2.7 * IOD, y0: CY - 2.4 * IOD, w: 5.4 * IOD, h: 5.9 * IOD };
const PW = 300, PH = Math.round((PW * crop.h) / crop.w);
const mapCrop = (ox, oy) => (q) => [ox + ((q[0] - crop.x0) / crop.w) * PW, oy + ((q[1] - crop.y0) / crop.h) * PH];
async function cropB64(id, fade) {
  let img = sharp(path.join(OUT, `${id}-canonical.png`)).extract({ left: Math.round(crop.x0), top: Math.round(crop.y0), width: Math.round(crop.w), height: Math.round(crop.h) }).resize(PW, PH);
  if (fade) img = img.modulate({ saturation: 0.35 }).linear(0.45, 140);
  return (await img.png().toBuffer()).toString("base64");
}

async function hairB64(id) { // hair mask → pale brown translucent layer (exactly what the extractor labelled hair)
  const m = await sharp(path.join(OUT, `${id}-hairmask.png`)).extract({ left: Math.round(crop.x0), top: Math.round(crop.y0), width: Math.round(crop.w), height: Math.round(crop.h) }).resize(PW, PH).extractChannel(0).raw().toBuffer();
  const rgba = Buffer.alloc(PW * PH * 4); for (let i = 0; i < PW * PH; i++) { rgba[i * 4] = 181; rgba[i * 4 + 1] = 139; rgba[i * 4 + 2] = 90; rgba[i * 4 + 3] = Math.round(m[i] * 0.33); }
  return (await sharp(rgba, { raw: { width: PW, height: PH, channels: 4 } }).png().toBuffer()).toString("base64");
}
async function sheet1() {
  const gap = 18, colW = PW * 3 + gap * 2, W = colW * 2 + 60 + 40, rowH = PH + 64, H = 110 + rowH * 3 + 120, s = [];
  s.push(`<rect width="${W}" height="${H}" fill="#fbfaf7"/>`, `<text x="30" y="44" font-family="Helvetica" font-size="26" font-weight="700" fill="#1d2733">Stage 0 — illustrated source → automatically extracted identity sketch</text>`,
    `<text x="30" y="74" font-family="Helvetica" font-size="15" fill="#4a5561">One generic extractor for all six (no per-person code, values or descriptions). Panels: source · sketch over faded source (alignment check) · identity sketch (face geometry dark, hair layer pale brown, separate).</text>`);
  for (let k = 0; k < people.length; k++) { const p = people[k], ox = 30 + (k % 2) * (colW + 40), oy = 110 + Math.floor(k / 2) * rowH;
    s.push(`<text x="${ox}" y="${oy + 16}" font-family="Helvetica" font-size="18" font-weight="700" fill="#1d2733">${esc(p.id[0].toUpperCase() + p.id.slice(1))}</text>`,
      `<text x="${ox + 90}" y="${oy + 16}" font-family="Helvetica" font-size="12.5" fill="#6b7682">${p.status}${p.failures.length ? " · " + esc(p.failures.join(", ")) : ""} · contour known ${p.contour.filter(known).length}/${p.contour.length} rays</text>`);
    const y = oy + 26, a = await cropB64(p.id, false), b = await cropB64(p.id, true);
    s.push(`<image x="${ox}" y="${y}" width="${PW}" height="${PH}" href="data:image/png;base64,${a}"/>`, `<rect x="${ox}" y="${y}" width="${PW}" height="${PH}" fill="none" stroke="#d6d2c8"/>`);
    s.push(`<text x="${ox + PW + gap / 2}" y="${y + PH / 2}" font-family="Helvetica" font-size="20" fill="#8d99a6" text-anchor="middle">→</text>`);
    const hm = await hairB64(p.id), hImg = (x0) => `<image x="${x0}" y="${y}" width="${PW}" height="${PH}" href="data:image/png;base64,${hm}"/>`;
    s.push(`<image x="${ox + PW + gap}" y="${y}" width="${PW}" height="${PH}" href="data:image/png;base64,${b}"/>`, sketchSVG(p, mapCrop(ox + PW + gap, y), { hairImg: hImg(ox + PW + gap) }), `<rect x="${ox + PW + gap}" y="${y}" width="${PW}" height="${PH}" fill="none" stroke="#d6d2c8"/>`);
    s.push(`<rect x="${ox + 2 * (PW + gap)}" y="${y}" width="${PW}" height="${PH}" fill="#fff" stroke="#d6d2c8"/>`, sketchSVG(p, mapCrop(ox + 2 * (PW + gap), y), { hairImg: hImg(ox + 2 * (PW + gap)) })); }
  const ly = H - 92; s.push(`<g font-family="Helvetica" font-size="13.5" fill="#1d2733">
   <line x1="30" y1="${ly}" x2="70" y2="${ly}" stroke="#1d2733" stroke-width="2.6"/><text x="78" y="${ly + 5}">face contour seen against background / drawn over neck (high confidence)</text>
   <line x1="560" y1="${ly}" x2="600" y2="${ly}" stroke="#e07a1f" stroke-width="2.2" stroke-dasharray="5 3"/><text x="608" y="${ly + 5}">bounded by hair or ear, consistent with mirror side (medium)</text>
   <line x1="1060" y1="${ly}" x2="1100" y2="${ly}" stroke="#8d99a6" stroke-width="1.4" stroke-dasharray="1.5 3"/><text x="1108" y="${ly + 5}">? UNKNOWN — hidden by hair / hairline / cut off (not used as face contour)</text>
   <rect x="30" y="${ly + 22}" width="40" height="14" fill="#b58b5a" fill-opacity="0.33"/><text x="78" y="${ly + 34}">hair layer = extracted hair mask; ● outer silhouette samples (○ = merged with clothing / cut off)</text>
   <line x1="640" y1="${ly + 29}" x2="680" y2="${ly + 29}" stroke="#2f9e44" stroke-width="2" stroke-dasharray="5 3"/><text x="688" y="${ly + 34}">fringe / hair–face boundary (observed)</text>
   <text x="1060" y="${ly + 34}">eyes, iris, brows, nose base, mouth: measured from image ink, not from the detector mesh</text></g>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${s.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, "stage0-review-sheet.png")); return { W, H };
}

async function sheet2(T, D) {
  const W = 1900, H = 1180, s = [], sc = 150, O = [330, 330]; // big overlay: normalised units → px
  const m = (q) => [O[0] + q[0] * sc, O[1] + q[1] * sc];
  s.push(`<rect width="${W}" height="${H}" fill="#fbfaf7"/>`, `<text x="30" y="44" font-family="Helvetica" font-size="26" font-weight="700" fill="#1d2733">Stage 0 — normalised FACE-ONLY comparison (hair removed)</text>`,
    `<text x="30" y="72" font-family="Helvetica" font-size="14.5" fill="#4a5561">Frame: origin = measured eye midpoint, x = eye line, unit u = √(IOD × eye→mouth). Solid = known contour; faint dotted = unknown (hair / cut-off). Inner triangle is NOT forced equal.</text>`);
  s.push(`<rect x="30" y="92" width="600" height="640" fill="#fff" stroke="#d6d2c8"/>`);
  for (let k = 0; k < people.length; k++) { const p = people[k], F = normalise(p); s.push(sketchSVG(p, (q) => m(F.T(q)), { hair: false, color: COLORS[k], ghost: true })); }
  s.push(`<line x1="${O[0] - 280}" y1="${O[1]}" x2="${O[0] + 280}" y2="${O[1]}" stroke="#ccc" stroke-dasharray="2 4"/><line x1="${O[0]}" y1="102" x2="${O[0]}" y2="720" stroke="#ccc" stroke-dasharray="2 4"/>`);
  people.forEach((p, k) => s.push(`<rect x="${50 + k * 96}" y="702" width="14" height="14" fill="${COLORS[k]}"/><text x="${68 + k * 96}" y="714" font-family="Helvetica" font-size="13" fill="#1d2733">${esc(p.id)}</text>`));
  // small multiples: each person vs the six-person mean contour (gray)
  const grids = people.map((p) => resample(p, normalise(p))), mean = Array.from({ length: GRID }, (_, g) => { const v = grids.map((G) => G.out[g]).filter((x) => x.ok); return v.length ? { r: v.reduce((a, x) => a + x.r, 0) / v.length, a: grids[0].out[g].a } : null; });
  const cen = [0, grids.reduce((a, G) => a + G.cen[1], 0) / grids.length];
  for (let k = 0; k < people.length; k++) { const p = people[k], F = normalise(p), ox = 660 + (k % 3) * 300, oy = 92 + Math.floor(k / 3) * 320, ss = 75, mm = (q) => [ox + 150 + q[0] * ss, oy + 120 + q[1] * ss];
    s.push(`<rect x="${ox}" y="${oy}" width="285" height="305" fill="#fff" stroke="#d6d2c8"/><text x="${ox + 10}" y="${oy + 20}" font-family="Helvetica" font-size="14" font-weight="700" fill="${COLORS[k]}">${esc(p.id)} vs six-person mean</text>`);
    const mp = mean.map((x) => (x ? mm([cen[0] + Math.cos(x.a) * x.r, cen[1] + Math.sin(x.a) * x.r]) : null)).filter(Boolean); s.push(`<polygon points="${mp.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="#eceae4" stroke="#b9b5aa" stroke-width="1.5"/>`);
    s.push(sketchSVG(p, (q) => mm(F.T(q)), { hair: false, color: COLORS[k] })); }
  // trait table
  const rows = [["eyeSpacing_IODoverEM", "eye spacing IOD/EM", 2], ["lowerFace_eyeToChin", "eye→chin (u)", 2], ["width_cheek", "cheek width (u)", 2], ["width_mouth", "width @mouth (u)", 2], ["width_jaw", "width @jaw (u)", 2], ["width_chin", "width @chin (u)", 2],
    ["taper_jawOverCheek", "jaw/cheek", 2], ["taper_chinOverCheek", "chin/cheek", 2], ["faceAspect_lengthOverWidth", "eye→chin / width", 2], ["chinTaper_chinOverJaw", "chin/jaw width", 2], ["eye_widthOverIOD", "eye width/IOD", 2], ["eye_open", "eye openness", 2], ["eye_tiltDeg", "eye tilt °", 1],
    ["brow_thickness", "brow thickness (u)", 3], ["brow_gapToEye", "brow→eye gap (u)", 2], ["brow_tiltDeg", "brow tilt °", 1], ["nose_widthOverIOD", "nose width/IOD", 2], ["nose_baseDrop_overEM", "nose base / EM", 2], ["mouth_widthOverIOD", "mouth width/IOD", 2], ["mouth_lipHeight", "lip height (u)", 3],
    ["foreheadToHairline_hairDependent", "eye→hairline (u) [hair]", 2], ["hair_topAboveEyes", "hair top (u) [hair]", 2], ["hair_maxHalfWidth", "hair half-width (u) [hair]", 2]];
  const tx = 30, ty = 770, cw = [210, ...people.map(() => 92)]; s.push(`<text x="${tx}" y="${ty - 12}" font-family="Helvetica" font-size="15" font-weight="700" fill="#1d2733">Automatically measured relationships (— = unknown / not observable; eye/brow = higher-confidence side)</text>`);
  people.forEach((p, k) => s.push(`<text x="${tx + cw[0] + k * 92}" y="${ty + 8}" font-family="Helvetica" font-size="12.5" font-weight="700" fill="${COLORS[k]}">${esc(p.id)}</text>`));
  rows.forEach(([key, name, dp], r) => { const y = ty + 26 + r * 16.2; s.push(`<text x="${tx}" y="${y}" font-family="Helvetica" font-size="12" fill="#4a5561">${esc(name)}</text>`);
    const vals = people.map((p) => T[p.id].t[key]), num = vals.filter((v) => typeof v === "number"), lo = Math.min(...num), hi = Math.max(...num);
    vals.forEach((v, k) => s.push(`<text x="${tx + cw[0] + k * 92}" y="${y}" font-family="Helvetica" font-size="12" fill="${typeof v === "number" && num.length > 2 && (v === lo || v === hi) ? "#c2410c" : "#1d2733"}" font-weight="${typeof v === "number" && (v === lo || v === hi) && num.length > 2 ? 700 : 400}">${typeof v === "number" ? v.toFixed(dp) : "—"}</text>`)); });
  // distance matrix
  const mx = 1000, my = 770; s.push(`<text x="${mx}" y="${my - 12}" font-family="Helvetica" font-size="15" font-weight="700" fill="#1d2733">Pairwise face-only identity distance (RMS, u) — mutually-known evidence only</text>`);
  people.forEach((p, k) => { s.push(`<text x="${mx + 120 + k * 92}" y="${my + 8}" font-family="Helvetica" font-size="12.5" font-weight="700" fill="${COLORS[k]}">${esc(p.id)}</text>`, `<text x="${mx}" y="${my + 34 + k * 24}" font-family="Helvetica" font-size="12.5" font-weight="700" fill="${COLORS[k]}">${esc(p.id)}</text>`);
    people.forEach((q, j) => { const d = D.pair[p.id][q.id]; const v = d.d ?? 0, sh = j === k ? "#f2f1ec" : `rgba(209,73,91,${Math.min(0.85, v / 0.45).toFixed(2)})`;
      s.push(`<rect x="${mx + 112 + j * 92}" y="${my + 18 + k * 24}" width="88" height="21" fill="${sh}"/><text x="${mx + 120 + j * 92}" y="${my + 34 + k * 24}" font-family="Helvetica" font-size="12" fill="#1d2733">${j === k ? "·" : v.toFixed(3)}</text>`); }); });
  if (D.noise) s.push(`<text x="${mx}" y="${my + 190}" font-family="Helvetica" font-size="13" fill="#1d2733">${esc(D.noise)}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${s.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, "stage0-face-only-overlay.png"));
}

const T = Object.fromEntries(people.map((p) => [p.id, traits(p)])), V = Object.fromEntries(people.map((p) => [p.id, vec(p)]));
const D = { pair: {} }; for (const p of people) { D.pair[p.id] = {}; for (const q of people) D.pair[p.id][q.id] = dist(V[p.id], V[q.id]); }
const noiseF = path.join(OUT, "stability.json"); if (fs.existsSync(noiseF)) { const S = JSON.parse(fs.readFileSync(noiseF, "utf8")); D.noise = S.summary; }
fs.writeFileSync(path.join(OUT, "traits.json"), JSON.stringify(Object.fromEntries(people.map((p) => [p.id, T[p.id].t])), null, 1));
fs.writeFileSync(path.join(OUT, "distances.json"), JSON.stringify(D, null, 1));
await sheet1(); await sheet2(T, D);
console.log("sheets written");
