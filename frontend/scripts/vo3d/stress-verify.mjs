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
// ---- SPLIT SHADOW UPDATE correctness -----------------------------------------------------------
// The cache is only allowed to skip the FULL redraw when nothing static moved. These checks drive the
// real world objects and assert that each one still forces a static pass.
check("split shadow update is on by default", await p.evaluate(() => window.__vo3d.stress.shadowCache.enabled()));
check("split shadow update is active (a dynamic caster is registered)", await p.evaluate(() => window.__vo3d.stress.shadowCache.active()));

const passes = async (fn) => {
  await p.evaluate(() => window.__vo3d.stress.shadowCache.resetStats());
  await fn();
  await p.waitForTimeout(700);
  return p.evaluate(() => window.__vo3d.stress.shadowCache.stats());
};
// an idle world must settle to NO shadow work at all
const idle = await passes(async () => {});
check("an idle world stops updating the shadow map entirely", idle.staticPasses === 0 && idle.dynamicPasses === 0 && idle.skipped > 0);
// a walking avatar must update shadows, but WITHOUT redrawing the static world
const walking = await passes(async () => { await p.evaluate(() => window.__vo3d.nav.walkToGround(760, 690)); });
check("a walking avatar composites its shadow every frame", walking.dynamicPasses > 5);
check("a walking avatar does NOT redraw the static world", walking.staticPasses <= 2);
await p.waitForTimeout(2500);
// a SEAT interaction drags a CHAIR — static-world geometry that the cache must not freeze. It also
// opens the Design Room door on the way, so this covers both animating world objects at once.
await p.evaluate(() => window.__vo3d.cameraModes.set("office"));
const seating = await passes(async () => { await p.evaluate(() => window.__vo3d.seat.sit()); });
check("an animating chair/door redraws the static world every frame", seating.staticPasses + seating.fullPasses > 3);
// ...and because it invalidates on EVERY frame, the split must stand down and let three do one plain
// full redraw instead of paying for a probe render + static pass + blit + composite (the thrash guard).
check("continuous static motion falls back to the plain full redraw", seating.fullPasses > 3);
await p.evaluate(() => window.__vo3d.seat.stand());
await p.waitForTimeout(3000);
await p.evaluate(() => window.__vo3d.seat.reset());
await p.waitForTimeout(800);
// the EDITOR moving furniture must force a full redraw
const edited = await passes(async () => { await p.evaluate(() => window.__vo3d.edit.movePlantTo(300, 300)); });
check("an editor move redraws the static world", edited.staticPasses + edited.fullPasses >= 1);
await p.evaluate(() => { window.__vo3d.edit.cancel(); window.__vo3d.edit.setEditMode(false); });
// a TIME-OF-DAY change moves the sun: full redraw
const sun = await passes(async () => { await p.evaluate(() => window.__vo3d.env.setTime("sunset")); });
check("a Day→Sunset change redraws the static world", sun.staticPasses + sun.fullPasses >= 1);
const night = await passes(async () => { await p.evaluate(() => window.__vo3d.env.setTime("night")); });
check("a Sunset→Night change redraws the static world", night.staticPasses + night.fullPasses >= 1);
await p.evaluate(() => window.__vo3d.env.setTime("auto"));
// a WEATHER change re-grades the sun: full redraw
const wet = await passes(async () => { await p.evaluate(() => window.__vo3d.weather.setWeather("rain")); });
check("a weather change redraws the static world", wet.staticPasses + wet.fullPasses >= 1);
await p.evaluate(() => window.__vo3d.weather.setWeather("auto"));
// turning the cache OFF must restore the pre-split behaviour
await p.evaluate(() => window.__vo3d.stress.shadowCache.setCache(false));
await p.waitForTimeout(500);
check("cache off reports inactive", !(await p.evaluate(() => window.__vo3d.stress.shadowCache.active())));
await p.evaluate(() => window.__vo3d.stress.shadowCache.setCache(true));
await p.waitForTimeout(500);
check("cache back on reports active", await p.evaluate(() => window.__vo3d.stress.shadowCache.active()));

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
