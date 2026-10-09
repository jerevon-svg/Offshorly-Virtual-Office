// v3/render.mjs — HumanBase V3 proof: render identity files on the PRODUCTION HumanAvatar (the dev QA viewer,
// human-base-qa.html, mounted on the employee's own body preset + Offshorly uniform) into labelled contact sheets.
// ZERO CREDITS. Needs the Vite dev server (:5173). From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/render.mjs <jobs.json>
// jobs.json: [{ out, title, cols, tiles: [{ who, head (frontend-relative glb | null = production), view, label, face?, mode? }] }]
import fs from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";

const jobs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const URL0 = process.env.QA_URL ?? "http://localhost:5173/virtual-office/human-base-qa.html", T = Number(process.env.V3_TILE ?? 360);
const puppeteer = createRequire(`${process.cwd()}/package.json`)("puppeteer");
const browser = await puppeteer.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  userDataDir: `${process.env.TMPDIR ?? "/tmp"}/hb-v3-chrome`, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
const page = await browser.newPage(); await page.setCacheEnabled(false);
await page.setViewport({ width: T, height: T, deviceScaleFactor: 1 });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
let loaded = null;
async function load(who, head, wear = null) {
  const key = `${who}|${head}|${wear}`; if (loaded === key) return;
  const h = head ? `&head=${encodeURIComponent(`../../${head}`)}` : "";
  await page.goto(`${URL0}?humanbase=1&capture=1&who=${who}${h}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => window.__qa?.ready, { timeout: 180000 });
  await page.evaluate((w) => window.__qa.load(w), who); await wait(500);
  await page.evaluate(() => { window.__qa.setAnimate(false); window.__qa.setFace("open", "center"); });
  if (wear) { await page.evaluate((s, i) => window.__qa.wear(s, i), wear[0], wear[1]); await wait(600); }
  loaded = key;
}
for (const job of jobs) {
  const shots = new Array(job.tiles.length);
  // capture grouped by identity file (one page load each), compose in the requested order
  const order = job.tiles.map((t, i) => [i, t]).sort((a, b) => `${a[1].who}|${a[1].head}|${a[1].wear}`.localeCompare(`${b[1].who}|${b[1].head}|${b[1].wear}`));
  for (const [idx, t] of order) {
    const push = (x) => { shots[idx] = x; };
    if (t.blank) { push({ label: t.label ?? "", png: await sharp({ create: { width: T, height: T, channels: 3, background: "#22252b" } }).png().toBuffer() }); continue; }
    if (t.image) { push({ label: t.label, png: await sharp(t.image).resize(T, T, { fit: "contain", background: "#d9dfe6" }).flatten({ background: "#d9dfe6" }).png().toBuffer() }); continue; }
    await load(t.who, t.head, t.wear ?? null);
    if (t.mode) await page.evaluate((m) => { window.__qa.setMode(m); }, t.mode);
    await page.evaluate((v, f) => { if (typeof v === "string") window.__qa.cam(v); else window.__qa.camCustom(v); window.__qa.setFace(f ?? "open", "center"); }, t.view, t.face ?? "open");
    await wait(t.mode ? 900 : 160);
    const png = Buffer.from(await page.screenshot({ type: "png" })); if (t.save) { fs.mkdirSync(t.save.slice(0, t.save.lastIndexOf("/")), { recursive: true }); fs.writeFileSync(t.save, png); }
    push({ label: t.label ?? `${t.who} · ${typeof t.view === "string" ? t.view : "custom"}`, png });
    if (t.mode) { await page.evaluate(() => window.__qa.setMode("idle")); }
  }
  const cols = job.cols ?? 4, rows = Math.ceil(shots.length / cols), H = 24 + T, head = 32, W = cols * T;
  const comp = [{ input: Buffer.from(`<svg width="${W}" height="${head}"><rect width="100%" height="100%" fill="#0d0f12"/><text x="10" y="22" font-family="Menlo, monospace" font-size="16" fill="#eef1f6">${esc(job.title)}</text></svg>`), left: 0, top: 0 }];
  shots.forEach((s, i) => { const x = (i % cols) * T, y = head + Math.floor(i / cols) * H;
    comp.push({ input: Buffer.from(`<svg width="${T}" height="24"><rect width="100%" height="100%" fill="#14161a"/><text x="6" y="17" font-family="Menlo, monospace" font-size="12" fill="#7ee0b0">${esc(s.label)}</text></svg>`), left: x, top: y }, { input: s.png, left: x, top: y + 24 }); });
  fs.mkdirSync(job.out.slice(0, job.out.lastIndexOf("/")), { recursive: true });
  await sharp({ create: { width: W, height: head + rows * H, channels: 3, background: "#0d0f12" } }).composite(comp).png().toFile(job.out);
  console.log(job.out);
}
if (errors.length) console.log("page errors:", [...new Set(errors)].slice(0, 5).join(" | "));
await browser.close();
