#!/usr/bin/env node
// VO3D stress harness — REGRESSION GUARD. Proves the dev-only stress harness changed nothing about the
// product page: a clean load has no crowd and no frozen shadows, and OFFICE / 3D EXPLORE / PLAYER / the
// CAVE portal all still behave. Run it after touching devtools/Crowd, devtools/Stress or the loop hooks.
//
//   node scripts/vo3d/stress-verify.mjs      (needs `npm run dev` on 5173)
import { chromium } from "playwright";
const b = await chromium.launch({ channel: "chrome", headless: false, args: ["--ignore-gpu-blocklist","--use-angle=metal","--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", e => errs.push("pageerror: " + e.message));
p.on("console", m => { if (m.type()==="error" && !/weather/i.test(m.text())) errs.push("console.error: " + m.text().slice(0,160)); });
await p.goto("http://localhost:5173/virtual-office/dev/vo3d.html", { waitUntil: "load", timeout: 120000 });
await p.waitForFunction(() => Boolean(window.__vo3d?.stress), null, { timeout: 120000 });
await p.waitForTimeout(6000);
const ok = [];
const check = (n, v) => { ok.push(`${v ? "PASS" : "FAIL"}  ${n}`); };

// no crowd exists until asked
check("no crowd on a clean load", (await p.evaluate(() => window.__vo3d.stress.stats())) === null);
check("shadow freeze off", (await p.evaluate(() => window.__vo3d.stress.shadows().frozen)) === false);
// OFFICE
check("OFFICE is the default mode", (await p.evaluate(() => window.__vo3d.params.cameraMode)) === "office");
await p.evaluate(() => window.__vo3d.nav.walkToGround(700, 700));
await p.waitForTimeout(1500);
check("click-to-walk still moves Bon", (await p.evaluate(() => window.__vo3d.avatarState.clip)) !== "");
// EXPLORE
await p.evaluate(() => window.__vo3d.cameraModes.set("explore"));
await p.waitForTimeout(600);
check("EXPLORE mode entered", (await p.evaluate(() => window.__vo3d.cameraModes.mode)) === "explore");
check("EXPLORE orbit accepted", await p.evaluate(() => window.__vo3d.cameraModes.orbit(40, 30, 0.6)));
// PLAYER
await p.evaluate(() => { window.__vo3d.nav.placeBonAtEntrance(); window.__vo3d.player.enter(); });
await p.waitForTimeout(800);
check("PLAYER mode active", await p.evaluate(() => window.__vo3d.player.mode.active));
const before = await p.evaluate(() => window.__vo3d.player.position());
await p.evaluate(() => { for (let i=0;i<30;i++) window.__vo3d.player.move(0, 1); });
const after = await p.evaluate(() => window.__vo3d.player.position());
check("PLAYER body moves", Math.hypot(after.x-before.x, after.z-before.z) > 1);
// CAVE
await p.evaluate(() => { window.__vo3d.cave.atPortal(); window.__vo3d.cave.enter(); });
await p.waitForTimeout(1200);
check("CAVE entered", await p.evaluate(() => window.__vo3d.cave.inside()));
await p.evaluate(() => window.__vo3d.cave.exit());
await p.waitForTimeout(1200);
check("CAVE exited", !(await p.evaluate(() => window.__vo3d.cave.inside())));
await p.evaluate(() => window.__vo3d.cameraModes.set("office"));
await p.waitForTimeout(600);
// shadow counters still tick without stress
const sh = await p.evaluate(() => window.__vo3d.stress.shadows());
check("shadow counters live without stress mode", sh.frames > 0);
const live = await p.evaluate(() => window.__vo3d.bench.live());
check("frames still rendering", live.avgFps > 5);
console.log(ok.join("\n"));
console.log("fps (no stress):", live.avgFps, "| calls:", live.avgDrawCalls, "| shadow redraw rate:", (sh.redraws/sh.frames).toFixed(3));
console.log("errors:", errs.length ? errs : "none");
await b.close();
process.exit(ok.some(l => l.startsWith("FAIL")) ? 1 : 0);
