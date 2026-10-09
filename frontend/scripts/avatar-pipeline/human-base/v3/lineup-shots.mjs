// v3/lineup-shots.mjs — HumanBase V3 proof: the PERMANENT lineup page (human-base-lineup.html) with V3-B candidates mounted
// on their production appearance next to the approved five (idle / walk / sit, front + profile). ZERO CREDITS. Needs :5173.
import fs from "node:fs";
import { createRequire } from "node:module";
const OUT = "scripts/avatar-pipeline/output/human-base/v3-proof/sheets", P = "scripts/avatar-pipeline/output/human-base/v3-proof";
const cand = ["kael", "lui", "nicole"].map((w) => `${w}:${P}/${w}/B/pass1/${w}-v1.glb`).join(",");
const puppeteer = createRequire(`${process.cwd()}/package.json`)("puppeteer");
const browser = await puppeteer.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", userDataDir: `${process.env.TMPDIR ?? "/tmp"}/hb-v3-lineup` });
const page = await browser.newPage(); await page.setViewport({ width: 1800, height: 640 }); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, q] of [["lineup-front", "view=front"], ["lineup-profile", "view=front&turn=90"], ["lineup-back", "view=front&turn=180"], ["lineup-walk", "view=front&mode=walk"], ["lineup-sit", "view=front&mode=sit"]]) {
  await page.goto(`http://localhost:5173/virtual-office/human-base-lineup.html?humanbase=1&capture=1&ids=bon,micah,angelo,clang,france,kael,lui,nicole&candidate=${cand}&${q}`, { waitUntil: "load", timeout: 180000 });
  await page.waitForFunction(() => window.__lineup?.ready, { timeout: 180000 }); await wait(q.includes("mode") ? 1500 : 600);
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(await page.screenshot({ type: "png" }))); console.log(`${OUT}/${name}.png`);
}
if (errors.length) console.log("page errors:", [...new Set(errors)].slice(0, 4).join(" | "));
await browser.close();
