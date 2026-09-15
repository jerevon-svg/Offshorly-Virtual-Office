#!/usr/bin/env node
// VO3D PERFORMANCE STRESS PHASE 1 — the repeatable driver.
//
// Opens the dev-only V2 page in a real GPU-backed Chromium, runs the eight-scenario stress matrix
// through window.__vo3d.stress, and writes a JSON + Markdown report. Measurement only: the page's
// harness forces FULL GRAPHICS (preset A — SSAO on via the approved depth reuse, shadows on, sway on,
// room culling + static batching + foliage instancing on, environment/weather running) before every
// capture and restores it afterwards. Nothing here lowers a quality setting.
//
//   node scripts/vo3d/stress.mjs                      # whole matrix, headed (real GPU), DPR 2
//   node scripts/vo3d/stress.mjs --only s7-70-cave    # one scenario
//   node scripts/vo3d/stress.mjs --seconds 10         # shorter captures (smoke run)
//   node scripts/vo3d/stress.mjs --no-attribution     # skip the crowd/shadow A/B sub-captures
//
// HEADED BY DEFAULT, ON PURPOSE. Headless Chromium falls back to SwiftShader (a software rasteriser),
// which would produce numbers that say nothing about the product. --headless is available for CI-ish
// runs but the report records which mode produced it so a software-rendered result is never mistaken
// for a real one.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "../..");
const DEFAULT_URL = "http://localhost:5173/virtual-office/dev/vo3d.html";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const has = (name) => process.argv.includes(`--${name}`);

const url = String(arg("url", DEFAULT_URL));
const seconds = arg("seconds") ? Number(arg("seconds")) : null;
const only = arg("only") ? String(arg("only")).split(",").map((s) => s.trim()).filter(Boolean) : null;
const attribution = !has("no-attribution");
const headless = has("headless");
const dpr = Number(arg("dpr", 2));
const width = Number(arg("width", 1440));
const height = Number(arg("height", 810));
const outDir = resolve(String(arg("out", resolve(HERE, "stress-results"))));

const log = (...a) => console.log("[stress]", ...a);

async function reachable(u) {
  try {
    const res = await fetch(u, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start `npm run dev` ourselves when nothing is serving 5173, and stop it again on the way out. */
async function ensureServer() {
  if (await reachable(url)) {
    log("dev server already up:", url);
    return null;
  }
  log("no dev server — starting `npm run dev`…");
  const proc = spawn("npm", ["run", "dev"], { cwd: FRONTEND, stdio: "ignore", detached: false });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await reachable(url)) {
      log("dev server up after", ((i + 1) * 0.5).toFixed(1), "s");
      return proc;
    }
  }
  proc.kill();
  throw new Error(`dev server never answered ${url}`);
}

async function main() {
  const server = await ensureServer();
  // SYSTEM CHROME FIRST. It is the real browser on a real GPU, and it saves a 150 MB download; the
  // bundled chromium is the fallback when Chrome is not installed (or was not requested).
  const channel = arg("channel", "chrome");
  const launchArgs = {
    headless,
    args: [
      "--enable-precise-memory-info", // makes performance.memory meaningful rather than bucketed
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--use-angle=metal",
      "--autoplay-policy=no-user-gesture-required", // the CAVE scenarios open the portal without a click
      `--window-size=${width + 16},${height + 120}`,
    ],
  };
  let browser;
  try {
    browser = await chromium.launch(channel === "chromium" ? launchArgs : { ...launchArgs, channel: String(channel) });
  } catch (e) {
    log(`could not launch "${channel}" (${String(e).split("\n")[0]}) — falling back to the bundled chromium`);
    browser = await chromium.launch(launchArgs);
  }
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`console.error: ${m.text().slice(0, 300)}`); });
  page.on("requestfailed", (r) => consoleErrors.push(`requestfailed: ${r.url().slice(0, 200)} — ${r.failure()?.errorText ?? "?"}`));

  log("opening", url);
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => Boolean(window.__vo3d?.stress), null, { timeout: 180_000 });
  // let the world finish building, the hero avatar land and the first shadow map settle
  await page.waitForTimeout(6000);

  const device = await page.evaluate(() => window.__vo3d.stress.device);
  log("gpu:", device.gpuRenderer);
  log("dpr:", device.devicePixelRatio, "· cores:", device.hardwareConcurrency, "· mem:", device.deviceMemoryGb ?? "n/a", "GB");
  if (/swiftshader|llvmpipe|software/i.test(device.gpuRenderer)) {
    log("WARNING: software renderer — these numbers do not describe the product. Run headed.");
  }

  const opts = { attribution };
  if (seconds) opts.seconds = seconds;
  if (only) opts.only = only;

  log("running matrix", only ? `(${only.join(", ")})` : "(all 8 scenarios)", "— this takes several minutes");
  await page.evaluate((o) => {
    window.__stressDone = null;
    window.__stressErr = null;
    window.__vo3d.stress.runAll(o).then((r) => { window.__stressDone = r; }).catch((e) => { window.__stressErr = String(e?.stack ?? e); });
  }, opts);

  let last = "";
  const deadline = Date.now() + 45 * 60_000;
  for (;;) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({
      done: window.__stressDone !== null,
      err: window.__stressErr,
      state: window.__vo3d.stress.state,
    }));
    if (s.err) throw new Error(`in-page failure: ${s.err}`);
    const line = `${s.state.progress} ${s.state.scenario} — ${s.state.status}`;
    if (line !== last) { log(line); last = line; }
    if (s.done) break;
    if (Date.now() > deadline) throw new Error("matrix timed out after 45 minutes");
  }

  const payload = await page.evaluate(() => window.__stressDone);
  const report = {
    generatedAt: new Date().toISOString(),
    url,
    driver: { headless, channel, deviceScaleFactor: dpr, viewport: { width, height }, attribution, secondsOverride: seconds ?? null, only: only ?? null },
    device: payload.device,
    consoleErrors,
    results: payload.results,
  };

  await mkdir(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = resolve(outDir, `stress-${stamp}.json`);
  const mdPath = resolve(outDir, `stress-${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(mdPath, renderMarkdown(report, payload.markdown));
  log("wrote", jsonPath);
  log("wrote", mdPath);
  console.log("\n" + payload.markdown + "\n");

  await context.close();
  await browser.close();
  if (server) server.kill();
}

function renderMarkdown(report, table) {
  const d = report.device;
  const lines = [
    "# VO3D performance stress — phase 1 (measurement only)",
    "",
    `Generated ${report.generatedAt}`,
    "",
    "## Rig",
    "",
    `- GPU: \`${d.gpuRenderer}\` (${d.gpuVendor})`,
    `- Cores: ${d.hardwareConcurrency} · device memory: ${d.deviceMemoryGb ?? "n/a"} GB`,
    `- Viewport ${report.driver.viewport.width}×${report.driver.viewport.height} @ DPR ${report.driver.deviceScaleFactor} · ${report.driver.headless ? "HEADLESS (software rendering likely)" : "headed (real GPU)"} · browser \`${report.driver.channel}\``,
    `- Page: ${report.url}`,
    "",
    "## Scaling results",
    "",
    table,
    "",
    "## Per-scenario detail",
    "",
  ];
  for (const r of report.results) {
    const c = r.config;
    lines.push(`### ${c.label}`, "");
    lines.push(`- Config: ${c.avatars} avatars (${c.placed} crowd + hero) · layout \`${c.layout}\` · motion ${c.motion} · ${c.seconds}s · camera ${c.camera}`);
    lines.push(`- Graphics: preset ${c.preset} · SSAO ${c.ssao ? "on" : "off"} (depth reuse ${c.ssaoDepthReuse}) · shadows ${c.shadows ? "on" : "off"} · room culling ${c.roomCulling} · static batching ${c.staticBatching} · LOD${c.lod} · pixel ratio ${c.pixelRatio} · buffer ${c.drawingBuffer}`);
    lines.push(`- Frame: ${r.frame.avgFps} fps avg · 1% low ${r.frame.onePercentLowFps} fps · avg ${r.frame.avgFrameMs} ms · median ${r.frame.medianFrameMs} ms · p95 ${r.frame.p95FrameMs} ms · p99 ${r.frame.p99FrameMs} ms · worst ${r.frame.worstFrameMs} ms · ${r.frame.frames} frames`);
    lines.push(`- Scene: ${r.scene.drawCalls} draw calls · ${r.scene.triangles.toLocaleString()} triangles · ${r.scene.visibleMeshes} visible meshes/sprites · ${r.scene.geometries} geometries · ${r.scene.textures} textures · ${r.scene.programs} programs`);
    lines.push(`- Memory: JS heap ${r.memory.jsHeapMb ?? "n/a"} MB (total ${r.memory.totalHeapMb ?? "n/a"} MB, limit ${r.memory.limitMb ?? "n/a"} MB)`);
    if (r.avatarCost) {
      lines.push(`- Avatar cost: crowd hidden ${r.avatarCost.hiddenFrameMs} ms → crowd visible ${r.avatarCost.crowdFrameMs} ms = **${r.avatarCost.deltaMs} ms** (${r.avatarCost.perAvatarMs} ms/avatar) · +${r.avatarCost.deltaCalls} draw calls · +${r.avatarCost.deltaTriangles.toLocaleString()} triangles`);
    }
    if (r.shadowCost) {
      lines.push(`- Shadow invalidation: redrawn on ${(r.shadowCost.invalidationRate * 100).toFixed(1)}% of frames · frozen ${r.shadowCost.frozenFrameMs} ms → live ${r.shadowCost.liveFrameMs} ms = **${r.shadowCost.deltaMs} ms (${r.shadowCost.sharePct}% of the frame)**`);
      if (r.shadowCost.staticOnlyFrameMs !== null) {
        lines.push(`- Shadow split: static casters only ${r.shadowCost.staticOnlyFrameMs} ms → static world share **${r.shadowCost.staticShareMs} ms**, avatar share **${r.shadowCost.dynamicShareMs} ms**`);
      }
      if (r.shadowCost.liveCalls !== null) {
        lines.push(`- Shadow pass cost in submissions: ${r.shadowCost.frozenCalls} → ${r.shadowCost.liveCalls} calls (+${r.shadowCost.liveCalls - r.shadowCost.frozenCalls}) · ${r.shadowCost.frozenTriangles.toLocaleString()} → ${r.shadowCost.liveTriangles.toLocaleString()} triangles`);
      }
    }
    lines.push(`- Errors: ${r.errors.length ? r.errors.join("; ") : "none"}`);
    lines.push(`- Duration: ${(r.durationMs / 1000).toFixed(1)}s (started ${r.startedAt})`, "");
  }
  if (report.consoleErrors.length) {
    lines.push("## Driver-observed page errors", "", ...report.consoleErrors.map((e) => `- ${e}`), "");
  }
  return lines.join("\n");
}

main().catch((e) => {
  console.error("[stress] FAILED:", e);
  process.exit(1);
});
