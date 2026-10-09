// studio/pipeline-sheet.mjs — ONE REVIEW SHEET per employee: reference → Stage 0 trace → raw Meshy head → chibified head BEFORE the
// identity correction → AFTER it (clay, same cameras) → the complete avatar on the production HumanBase body (idle front / 3/4 / walk),
// before vs after. Zero credits. Needs the Vite dev server (:5173). From frontend/:
//   node scripts/avatar-pipeline/human-base/studio/pipeline-sheet.mjs <who>
import fs from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(`${process.cwd()}/package.json`), sharp = require("sharp"), puppeteer = require("puppeteer");
const who = process.argv[2], O = "scripts/avatar-pipeline/output/human-base", C = `${O}/candidates/${who}`, X = `${O}/exports/${who}`, V = "http://localhost:5173/virtual-office";
fs.mkdirSync(X, { recursive: true });
const pick = (tags) => tags.map((t) => `${C}/${t}/${who}-v1.glb`).find((f) => fs.existsSync(f)) ?? null;
const before = pick(["pass2", "pass1"]), after = pick(["corr-pass2", "corr-pass1"]); if (!after) { console.error("no corrected candidate — run the build step first"); process.exit(1); }
const raw = `scripts/avatar-pipeline/output/meshy-employees/${who}-head-v1/raw-untouched`, pop = `${O}/stage1-proof/population`, key = fs.existsSync(`${pop}/${who}-canonical.png`) ? who : who === "bon" ? "jerevon" : who;
const trace = `${O}/studio/${who}-trace.png`; if (!fs.existsSync(trace)) execFileSync("node", ["scripts/avatar-pipeline/human-base/studio/trace-sheet.mjs", who], { stdio: "inherit" });
const T = 420, browser = await puppeteer.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", userDataDir: `${process.env.TMPDIR ?? "/tmp"}/hb-studio`, args: ["--disable-background-timer-throttling", "--use-angle=swiftshader"] });
const tiles = {};
try {
  // clay heads (same cameras) — before / after correction
  { const p = await browser.newPage(); await p.setViewport({ width: T, height: T }); await p.goto(`${V}/${O}/stage1-proof/clay/clay.html`, { waitUntil: "load", timeout: 120000 }); await p.waitForFunction(() => window.ready, { timeout: 120000 });
    for (const [nm, f] of [["before", before], ["after", after]]) { if (!f) continue; await p.evaluate((u) => window.load(u, ["identity_head"]), `/virtual-office/${f}`);
      for (const [vn, az, el, d] of [["front", 0, 0, 2.6], ["3/4", 38, 3, 2.9]]) tiles[`${nm}-${vn}`] = Buffer.from((await p.evaluate((a, e, dd) => window.view(a, e, dd, 0), az, el, d)).split(",")[1], "base64"); }
    await p.close(); }
  // the complete avatar on the production body (lineup page, the candidate's own gate-validated mount)
  const BIG = 1000;   // render large, crop around the avatar (the lineup frames a whole row)
  for (const [nm, f] of [["before", before], ["after", after]]) { if (!f) continue; const p = await browser.newPage(); await p.setViewport({ width: BIG, height: BIG }); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(`${V}/human-base-lineup.html?humanbase=1&ids=${who}&candidate=${who}:${f}&capture=1&view=front`, { waitUntil: "load", timeout: 180000 });
    try { await p.waitForFunction(() => window.__lineup?.ready, { timeout: 180000 }); } catch { throw new Error(`lineup did not load (${errs.slice(0, 2).join(" | ")})`); }
    const shot = async (box) => sharp(await p.screenshot()).extract(box).resize(T, T, { fit: "cover" }).png().toBuffer(), BODY = { left: 290, top: 300, width: 420, height: 560 }, FACE = { left: 0, top: 0, width: BIG, height: BIG };
    await p.evaluate(() => { window.__lineup.view("faces"); window.__lineup.setMode("idle"); window.__lineup.turn(0); window.__lineup.step(0.5); }); await new Promise((r) => setTimeout(r, 500)); tiles[`${nm}-face`] = await shot(FACE);
    await p.evaluate(() => { window.__lineup.view("front"); window.__lineup.step(0.2); }); await new Promise((r) => setTimeout(r, 400)); tiles[`${nm}-body`] = await shot(BODY);
    if (nm === "after") { await p.evaluate(() => { window.__lineup.turn(40); window.__lineup.step(0.3); }); await new Promise((r) => setTimeout(r, 300)); tiles["after-body34"] = await shot(BODY);
      await p.evaluate(() => { window.__lineup.turn(25); window.__lineup.setMode("walk"); window.__lineup.step(0.45); }); await new Promise((r) => setTimeout(r, 300)); tiles["after-walk"] = await shot(BODY); }
    await p.close(); }
} finally { await browser.close(); }
const img = async (f) => (f && fs.existsSync(f) ? sharp(f).resize(T, T, { fit: "contain", background: "#e9ebef" }).png().toBuffer() : sharp({ create: { width: T, height: T, channels: 3, background: "#e9ebef" } }).png().toBuffer());
const cells = [["1 · reference (approved illustration)", await img(`${pop}/${key}-canonical.png`)], ["2 · Stage 0 trace (identity analysis)", await img(trace)], ["3 · raw Meshy head (front)", await img(`${raw}/${who}-head-v1-raw-thumb-front.png`)], ["3 · raw Meshy head (side)", await img(`${raw}/${who}-head-v1-raw-thumb-left.png`)],
  ["4 · chibified, BEFORE correction · front", tiles["before-front"] ?? (await img(null))], ["5 · AFTER identity correction · front", tiles["after-front"]], ["4 · BEFORE · 3/4", tiles["before-3/4"] ?? (await img(null))], ["5 · AFTER · 3/4", tiles["after-3/4"]],
  ["6 · avatar BEFORE · face (textured)", tiles["before-face"] ?? (await img(null))], ["6 · avatar AFTER · face (textured)", tiles["after-face"]], ["6 · full avatar BEFORE (idle)", tiles["before-body"] ?? (await img(null))], ["6 · full avatar AFTER (idle)", tiles["after-body"]],
  ["6 · AFTER · 3/4", tiles["after-body34"]], ["6 · AFTER · walking", tiles["after-walk"]]].map(([l, b]) => [l, b]);
const rep = JSON.parse(fs.readFileSync(`${C}/report.corrected.json`, "utf8")), ic = rep.identityCorrection ?? {}, LH = 30, cols = 4, rows = Math.ceil(cells.length / cols), HEAD = 70, W = cols * T, Hh = HEAD + rows * (T + LH);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const head = `<svg width="${W}" height="${HEAD}"><rect width="100%" height="100%" fill="#0d0f12"/><text x="14" y="30" font-family="Helvetica" font-size="22" fill="#eef1f6">${esc(who)} · upload → identity → Meshy → Offshorly correction → HumanBase avatar</text><text x="14" y="56" font-family="Helvetica" font-size="15" fill="#9aa3b2">${esc(`gate: automated ${rep.automatedPass ? "PASS" : "FAIL"}${rep.failed?.length ? " (" + rep.failed.join(", ") + ")" : ""} · sign-off ${rep.signoffRequired?.join(", ") || "—"} · face length ×${ic.length?.apply ? ic.length.mul : 1} · widths ${JSON.stringify((ic.plan ?? []).filter((l) => l[0] !== "eye").map((l) => [l[0], l[1]]))}`)}</text></svg>`;
const comp = [{ input: Buffer.from(head), left: 0, top: 0 }]; cells.forEach(([l, b], k) => { const x = (k % cols) * T, y = HEAD + Math.floor(k / cols) * (T + LH); comp.push({ input: Buffer.from(`<svg width="${T}" height="${LH}"><rect width="100%" height="100%" fill="#14161a"/><text x="8" y="20" font-family="Menlo, monospace" font-size="13" fill="#7ee0b0">${esc(l)}</text></svg>`), left: x, top: y }, { input: b, left: x, top: y + LH }); });
await sharp({ create: { width: W, height: Hh, channels: 3, background: "#0d0f12" } }).composite(comp).png().toFile(`${X}/${who}-pipeline-sheet.png`); console.log(`${X}/${who}-pipeline-sheet.png`);
