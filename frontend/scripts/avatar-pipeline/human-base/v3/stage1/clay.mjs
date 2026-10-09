// v3/stage1/clay.mjs — renders CLAY sheets (geometry only) through the local Vite server + system Chrome. From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/stage1/clay.mjs <variant> <out.png> [--wire]
import fs from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
const [VAR = "V", OUTF, ...rest] = process.argv.slice(2), WIRE = rest.includes("--wire"), O = "scripts/avatar-pipeline/output/human-base/stage1-proof";
const sel = JSON.parse(fs.readFileSync(`${O}/selection.json`, "utf8")), ids = [sel.anchor, ...sel.pair];
const cols = [VAR === "V" ? ["STYLE PRIOR (no identity)", `${O}/prior-head.glb`, ["identity_head"]] : ["CANONICAL prior (reference)", "scripts/avatar-pipeline/output/human-base/v3-proof/template/canonical-head-v3p.glb", ["head", "mesh", "canonical", "node", ""]], ...ids.map((w) => [w.toUpperCase(), `${O}/${w}/${VAR}/pass1/${w}-v1.glb`, ["identity_head", "neckext"]])];
if (process.env.CLAY_COLS) cols.splice(0, cols.length, ...JSON.parse(process.env.CLAY_COLS).map(([l, f, k]) => [l, f, k ?? ["identity_head", "neckext"]]));
let views = [["front", 0, 0], ["3/4", 38, 3], ["side", 90, 0], ["high 3/4", 35, 28], ["low 3/4", 35, -24], ["face crop", 22, 4, 1.7], ["face crop front", 0, 2, 1.55], ["front close", 0, 0, 2.8], ["under", 25, -55], ["mouth crop", 32, 2, 1.45, -0.15], ["mouth crop low", 30, -28, 1.45, -0.17]]; if (process.env.CLAY_VIEWS) views = views.filter((v) => process.env.CLAY_VIEWS.split(",").includes(v[0])); if (process.env.CLAY_EXTRA) views.push(...JSON.parse(process.env.CLAY_EXTRA));   // extra [name, az, el, dist, dy] views (diagnostics)
const puppeteer = createRequire(`${process.cwd()}/package.json`)("puppeteer");
const browser = await puppeteer.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", userDataDir: `${process.env.TMPDIR ?? "/tmp"}/hb-clay`, args: ["--disable-background-timer-throttling"] });
const page = await browser.newPage(); await page.setViewport({ width: 480, height: 520 }); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://localhost:5173/virtual-office/${O}/clay/clay.html`, { waitUntil: "load", timeout: 120000 }); await page.waitForFunction(() => window.ready, { timeout: 120000 });
if (WIRE) await page.evaluate(() => window.setWire(true));
const tiles = []; for (const [label, file, keep] of cols) { const n = await page.evaluate((u, k) => window.load(u, k), `/virtual-office/${file}`, keep); if (!n) throw new Error(`no meshes in ${file}`);
  for (const [vn, az, el, dd, dy] of views) { const url = await page.evaluate((a, e, d, y) => window.view(a, e, d, y), az, el, dd ?? 3.4, dy ?? 0); tiles.push({ label: `${label} · ${vn}`, png: Buffer.from(url.split(",")[1], "base64") }); } }
await browser.close(); if (errs.length) console.log("page errors:", errs.slice(0, 3).join(" | "));
// layout: rows = views, columns = canonical + the trio
const T = 480, TH = 520, LH = 26, HEAD = 46, nc = cols.length, nr = views.length, comp = [];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
comp.push({ input: Buffer.from(`<svg width="${T * nc}" height="${HEAD}"><rect width="100%" height="100%" fill="#0d0f12"/><text x="12" y="30" font-family="Helvetica" font-size="20" fill="#eef1f6">${esc(process.env.CLAY_TITLE ?? `STAGE 1 CLAY GEOMETRY (${VAR === "V" ? "parametric sculpture basis" : "2D-only front-plane warp"}) — no hair, no texture, one neutral material, same lights + cameras${WIRE ? " · wireframe overlay" : ""}`)}</text></svg>`), left: 0, top: 0 });
for (let c = 0; c < nc; c++) for (let v = 0; v < nr; v++) { const t = tiles[c * nr + v], x = c * T, y = HEAD + v * (TH + LH);
  comp.push({ input: Buffer.from(`<svg width="${T}" height="${LH}"><rect width="100%" height="100%" fill="#14161a"/><text x="8" y="18" font-family="Menlo, monospace" font-size="13" fill="${c ? "#7ee0b0" : "#c9a96e"}">${esc(t.label)}</text></svg>`), left: x, top: y }, { input: t.png, left: x, top: y + LH }); }
fs.mkdirSync(OUTF.slice(0, OUTF.lastIndexOf("/")), { recursive: true });
await sharp({ create: { width: T * nc, height: HEAD + nr * (TH + LH), channels: 3, background: "#0d0f12" } }).composite(comp).png().toFile(OUTF); console.log(OUTF);
