// qa-360.mjs — 360° PRODUCTION QA SHEETS for HumanBase identities. ZERO CREDITS. Visual acceptance, not a test.
//
//   node scripts/avatar-pipeline/human-base/qa-360.mjs [outDir] [--who=bon,micah] [--src=production|v1] [--sheets=orbit,eyes,closeups]
//
// Drives the dev QA viewer (human-base-qa.html, served by the running Vite dev server) in system Chrome, on the
// OPTIMISED production candidates with each employee's full configuration (body preset, outfit, glasses, accessories):
//   orbit    — front · front ¾ L/R · exact sides · rear ¾ L/R · back · high · low front · low rear · underneath
//   eyes     — open → 25% → 50% → sleepy → closed → happy, and gaze centre / left / right / up, at front, both ¾ and side
//   closeups — eyes/lids, hairline/fringe, jaw/chin, behind ears and nape close views + head-turn motion
//   hair     — hair flow / highlight continuity and tied-hair architecture: 360, crown, behind ears, nape, underside, motion
// Each sheet is one PNG per employee plus an all-employee orbit sheet. Fixed QA sheets missed arbitrary-angle defects
// in V1: this set includes the low/rear/underside views and close eye views at oblique angles on purpose.
import fs from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";

const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = args.find((a) => !a.startsWith("--")) ?? "scripts/avatar-pipeline/output/human-base/v1.2-release/qa";
const WHO = opt("who", "bon,micah,angelo,clang,france").split(","), SRC = opt("src", "production"), SHEETS = opt("sheets", "orbit,eyes,closeups,hair,body,behaviour,accessories").split(",");
const GLASSES = opt("glasses", "glasses-rect,micah-glasses,glasses-classic,bon-glasses").split(","), ATTACHED = opt("attached", "clang-flower").split(","), ACC = {};
const behaviourReport = {};
const URL0 = process.env.QA_URL ?? "http://localhost:5173/virtual-office/human-base-qa.html", HEAD = opt("head", null);   // --head=identity/x.glb (dev, single --who)
fs.mkdirSync(OUT, { recursive: true });
const puppeteer = createRequire(`${process.cwd()}/package.json`)("puppeteer");
const browser = await puppeteer.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  userDataDir: `${process.env.TMPDIR ?? "/tmp"}/hb-qa-chrome`, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
const page = await browser.newPage(); await page.setCacheEnabled(false);   // always the files on disk (rebuilt candidates)
const T = 440;   // tile size
await page.setViewport({ width: T, height: T, deviceScaleFactor: 1 });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${URL0}?humanbase=1&capture=1&src=${SRC}&who=${WHO[0]}${HEAD ? `&head=${HEAD}` : ""}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => window.__qa?.ready, { timeout: 180000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async () => Buffer.from(await page.screenshot({ type: "png" }));
const label = (text, w = T) => Buffer.from(`<svg width="${w}" height="26"><rect width="100%" height="100%" fill="#14161a"/><text x="8" y="18" font-family="Menlo, monospace" font-size="14" fill="#7ee0b0">${text}</text></svg>`);
async function sheet(file, title, tiles, cols) {
  const rows = Math.ceil(tiles.length / cols), H = 26 + T, W = cols * T, head = 34;
  const comp = [{ input: Buffer.from(`<svg width="${W}" height="${head}"><rect width="100%" height="100%" fill="#0d0f12"/><text x="10" y="23" font-family="Menlo, monospace" font-size="18" fill="#eef1f6">${title}</text></svg>`), left: 0, top: 0 }];
  tiles.forEach((t, i) => { const x = (i % cols) * T, y = head + Math.floor(i / cols) * H; comp.push({ input: label(t.label), left: x, top: y }, { input: t.png, left: x, top: y + 26 }); });
  await sharp({ create: { width: W, height: head + rows * H, channels: 3, background: "#0d0f12" } }).composite(comp).png().toFile(file);
  console.log(file);
}
const ORBIT = ["front", "front34L", "front34R", "sideL", "sideR", "rear34L", "rear34R", "back", "high", "lowFront", "lowRear", "under"];
const orbitAll = [];
for (const who of WHO) {
  await page.evaluate((w) => window.__qa.load(w), who); await wait(400);
  await page.evaluate(() => { window.__qa.setAnimate(false); window.__qa.setFace("open", "center"); });
  if (SHEETS.includes("orbit")) {
    const tiles = [];
    for (const v of ORBIT) { await page.evaluate((x) => window.__qa.cam(x), v); await wait(120); tiles.push({ label: `${who} · ${v}`, png: await shot() }); }
    orbitAll.push(...tiles.filter((t) => /front$|front34L|sideR|rear34L|back|lowFront|lowRear/.test(t.label)));
    await sheet(`${OUT}/${who}-orbit.png`, `${who} · 360° orbit (${SRC} candidate, open eyes, idle frame 0)`, tiles, 4);
  }
  if (SHEETS.includes("eyes")) {   // every eye state and gaze at front, both ¾, both sides, high and low
    const tiles = [], EV = ["eyeFront", "eye34L", "eye34R", "eyeSideL", "eyeSideR", "eyeHigh", "eyeLow"];
    for (const s of ["open", "c25", "c50", "sleepy", "closed", "happy"]) for (const v of EV) {
      await page.evaluate((x, y) => { window.__qa.cam(x); window.__qa.setFace(y, "center"); }, v, s); await wait(140); tiles.push({ label: `${s} · ${v}`, png: await shot() }); }
    for (const g of ["center", "left", "right", "up", "idle"]) for (const v of EV) {
      await page.evaluate((x, y) => { window.__qa.cam(x); window.__qa.setFace("open", y); }, v, g); await wait(g === "idle" ? 700 : 140); tiles.push({ label: `gaze ${g} · ${v}`, png: await shot() }); }
    await sheet(`${OUT}/${who}-eyes.png`, `${who} · eye states × 7 views, gaze × 7 views`, tiles, 7);
  }
  if (SHEETS.includes("closeups")) {
    const tiles = [];
    await page.evaluate(() => window.__qa.setFace("open", "center"));
    for (const v of ["eyeFront", "eye34L", "eye34R", "eyeSideL", "eyeSideR", "eyeHigh", "eyeLow", "hairline", "hairline34", "crown", "fringeL", "fringeR", "jawL", "jawR", "chin", "behindEarL", "behindEarR", "nape"]) { await page.evaluate((x) => window.__qa.cam(x), v); await wait(120); tiles.push({ label: `${who} · ${v}`, png: await shot() }); }
    // hair in motion: a head-turn sweep, frames mid-swing
    await page.evaluate(() => { window.__qa.setAnimate(true); window.__qa.setHeadTurn(true); window.__qa.setFace("live"); window.__qa.cam("front34L"); });
    for (let k = 0; k < 3; k++) { await wait(700); tiles.push({ label: `${who} · head turn ${k + 1}`, png: await shot() }); }
    await page.evaluate(() => { window.__qa.setHeadTurn(false); window.__qa.setAnimate(false); });
    await sheet(`${OUT}/${who}-closeups.png`, `${who} · close views (eyes/lids · hairline/fringe · jaw/chin · behind ears/nape) + head-turn motion`, tiles, 5);
  }
  if (SHEETS.includes("hair")) {   // hair flow + highlight continuity, tied-hair architecture (behind ear → nape → tie → tail)
    const tiles = []; await page.evaluate(() => { window.__qa.setMode("idle"); window.__qa.setAnimate(false); window.__qa.setFace("open", "center"); });
    for (const v of ["front", "front34L", "front34R", "sideL", "sideR", "high", "crown", "rear34L", "rear34R", "back", "lowRear", "under", "behindEarL", "behindEarR", "nape"]) { await page.evaluate((x) => window.__qa.cam(x), v); await wait(120); tiles.push({ label: `${who} · ${v}`, png: await shot() }); }
    await page.evaluate(() => { window.__qa.setAnimate(true); window.__qa.setHeadTurn(true); window.__qa.cam("rear34L"); });
    for (let k = 0; k < 5; k++) { await wait(600); tiles.push({ label: `${who} · head turn + hair motion ${k + 1}`, png: await shot() }); }
    await page.evaluate(() => { window.__qa.setHeadTurn(false); window.__qa.setAnimate(false); });
    await sheet(`${OUT}/${who}-hair.png`, `${who} · hair flow / highlights / tied architecture (360 + behind ear + nape + underside) + motion`, tiles, 5);
  }
  if (SHEETS.includes("accessories")) {   // the SAME accessory on every wearer (accessory contract): rows = people, cols = views
    const GV = ["eyeFront", "eye34L", "eye34R", "eyeSideL", "eyeSideR", "eyeHigh", "eyeLow"], FV = ["front34L", "front34R", "sideL", "sideR", "high", "back"];
    await page.evaluate(() => { window.__qa.setMode("idle"); window.__qa.setAnimate(false); window.__qa.setFace("open", "center"); });
    for (const g of GLASSES) { await page.evaluate((x) => window.__qa.wear("glasses", x), g); await wait(900);
      for (const v of GV) { await page.evaluate((x) => window.__qa.cam(x), v); await wait(120); (ACC[g] ??= []).push({ label: `${g} on ${who} · ${v}`, png: await shot() }); } }
    await page.evaluate(() => window.__qa.wear("glasses", null)); await wait(300);
    for (const a of ATTACHED) { await page.evaluate((x) => window.__qa.wearAccessory(x), a); await wait(900);
      for (const v of FV) { await page.evaluate((x) => window.__qa.cam(x), v); await wait(120); (ACC[a] ??= []).push({ label: `${a} on ${who} · ${v}`, png: await shot() }); } }
    await page.evaluate(() => window.__qa.wearAccessory(null)); await wait(300);
    // the future categories, procedurally, from the same contract (headband on the hair envelope, earrings at the lobes, a clip)
    (globalThis.DEMO ??= {})[who] = await page.evaluate(() => window.__qa.demoWearables(true));
    for (const v of ["front34L", "front34R", "sideL", "sideR", "high", "back"]) { await page.evaluate((x) => window.__qa.cam(x), v); await wait(120); (ACC["contract-demo"] ??= []).push({ label: `headband·earrings·clip on ${who} · ${v}`, png: await shot() }); }
    await page.evaluate(() => window.__qa.demoWearables(false));
    await page.evaluate((w) => window.__qa.load(w), who); await wait(600); await page.evaluate(() => { window.__qa.setAnimate(false); window.__qa.setFace("open", "center"); });
  }
  if (SHEETS.includes("body")) {   // construction seams of the whole avatar (neck → ankles), idle frame 0
    const tiles = []; await page.evaluate(() => { window.__qa.setMode("idle"); window.__qa.setAnimate(false); window.__qa.setFace("open", "center"); });
    for (const v of ["neck", "neckSide", "neckBack", "collar", "shoulders", "waist", "waistBack", "crotch", "seat", "hands", "sleeves", "ankles", "anklesBack", "fullLow", "under", "eyeLow"]) { await page.evaluate((x) => window.__qa.cam(x), v); await wait(120); tiles.push({ label: `${who} · ${v}`, png: await shot() }); }
    await sheet(`${OUT}/${who}-body.png`, `${who} · body construction close views (neck, collar, waist, seat, hands, ankles, underneath)`, tiles, 4);
  }
  if (SHEETS.includes("behaviour")) {   // shared clips + behaviours, two views each; garment ↔ skin check per pose
    const tiles = []; behaviourReport[who] = {};
    for (const [mode, settle] of [["idle", 600], ["walk", 900], ["turn", 1200], ["run", 700], ["sit", 900], ["agree", 1100], ["listen", 1100], ["scooter", 1600], ["typing", 9000]]) {
      await page.evaluate((m) => { window.__qa.setAnimate(true); window.__qa.setMode(m); window.__qa.setFace("live"); }, mode); await wait(settle);
      await page.evaluate(() => window.__qa.setAnimate(false)); await wait(80);
      behaviourReport[who][mode] = await page.evaluate(() => window.__qa.garmentCheck());
      for (const v of ["full", "waist"]) { await page.evaluate((x) => window.__qa.cam(x), v); await wait(120); tiles.push({ label: `${who} · ${mode} · ${v}`, png: await shot() }); } }
    await page.evaluate(() => { window.__qa.setMode("idle"); window.__qa.setAnimate(false); });
    await sheet(`${OUT}/${who}-behaviour.png`, `${who} · behaviours (idle, walk, turn, run, sit, agree, listen, scooter, typing)`, tiles, 6);
  }
}
if (Object.keys(behaviourReport).length) { fs.writeFileSync(`${OUT}/behaviour-garment-check.json`, JSON.stringify(behaviourReport, null, 1)); console.log(`${OUT}/behaviour-garment-check.json`); }
if (globalThis.DEMO) { fs.writeFileSync(`${OUT}/accessory-contract-demo-check.json`, JSON.stringify(globalThis.DEMO, null, 1)); console.log(`${OUT}/accessory-contract-demo-check.json`); }
for (const [id, tiles] of Object.entries(ACC)) await sheet(`${OUT}/accessory-fit-${id}.png`, `accessory contract · ${id} auto-fitted to every wearer (rows: ${WHO.join(", ")})`, tiles, GLASSES.includes(id) ? 7 : 6);
if (orbitAll.length && WHO.length > 1) await sheet(`${OUT}/all-orbit.png`, `HumanBase production candidates · 360° (${SRC})`, orbitAll, 7);
if (errors.length) console.log("page errors:\n" + errors.slice(0, 10).join("\n"));
await browser.close();
