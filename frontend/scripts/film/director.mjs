#!/usr/bin/env node
// FILM RIG ONLY — the local director for the LinkedIn teaser's individual takes.
//
// Orchestration, never a feature: every shot is staged through the REAL product on the isolated film
// rig (:5175 → :8003 → backend/dev_film.db) — the existing window.__vo3d driver surface, real key
// presses, real clicks on the real HUD, the real Socket.IO protocol and the real REST API.
//
//   node scripts/film/director.mjs serve            # hero Chrome for recording (app window, 1920×1080)
//   node scripts/film/director.mjs serve --headless # same, no window (validation / screenshots)
//   node scripts/film/director.mjs list             # every shot and what it stages
//   node scripts/film/director.mjs <Shot>           # stage a shot, verify it, leave it ready to record
//   node scripts/film/director.mjs <Shot> go        # stage, then run its live action (the part you record)
//   node scripts/film/director.mjs <Shot> go record # same, captured straight from the page → out/clips/<Shot>.mp4
//                                                   # (Chrome's own screencast, 3D + HUD; no display recording)
//   node scripts/film/director.mjs snap [target]    # screenshot → scripts/film/out/<target>.png
//   node scripts/film/director.mjs eval <target> '<js>'   # console escape hatch (bon | alex | …)
//   node scripts/film/director.mjs reset            # checked-out Bon on Floor 1, puppets home, panels shut
//
// Targets: `bon` is the hero (the only rendered 3D browser). Alex / Angelo / Micah / Jan are Socket.IO
// puppets by default; a shot that needs a genuinely interactive second client (typing, Ask to Join, a
// spatial conversation, spatial video) opens that person in a lightweight Classic-office session in a
// SEPARATE Chrome with no fake camera (so the fake camera can only ever be Bon's).
import { createServer } from "node:http";
import { mkdir, writeFile, access, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Puppets, CAST } from "./puppets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const req = createRequire(resolve(HERE, "../../package.json"));
const PORT = 5199;
const FRONT = "http://localhost:5175/virtual-office/";
const API = "http://localhost:8003";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = resolve(HERE, "out");
const PROFILES = resolve(HERE, "out/profiles");
const CAMERA = resolve(HERE, "out/bon-camera.mjpeg");
const SILENCE = resolve(HERE, "out/silence.wav");
const CLIPS = resolve(HERE, "out/clips");
// a private ffmpeg for encoding the page capture (FILM_FFMPEG), else whatever is on PATH
const FFMPEG = process.env.FILM_FFMPEG ?? "ffmpeg";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------ client
if (argv[0] !== "serve") {
  const [cmd = "list", ...rest] = argv;
  const body = cmd === "eval" ? { target: rest[0], js: rest.slice(1).join(" ") }
    : cmd === "snap" ? { target: rest[0] ?? "bon", name: rest[1] }
    : { args: rest };
  const path = ["list", "eval", "snap", "reset", "status"].includes(cmd) ? `/${cmd}` : `/shot/${cmd}`;
  const res = await fetch(`http://localhost:${PORT}${path}`, { method: "POST", body: JSON.stringify(body) }).catch(() => null);
  if (!res) { console.error("director is not running — start it with: node scripts/film/director.mjs serve"); process.exit(1); }
  const text = await res.text();
  console.log(text);
  process.exit(res.ok ? 0 : 1);
}

// ------------------------------------------------------------------------------------------ server
const puppeteer = req("puppeteer");
await mkdir(PROFILES, { recursive: true });
await ensureSilence();
const headless = has("headless");
const cameraReady = await access(CAMERA).then(() => true, () => false);
const log = (...a) => console.log("[director]", ...a);

const COMMON_ARGS = [
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows", "--autoplay-policy=no-user-gesture-required",
  "--no-first-run", "--no-default-browser-check", "--disable-features=Translate,MediaRouter",
  "--hide-scrollbars", "--disable-infobars", "--use-fake-ui-for-media-stream",
];

async function launch(name, { hero }) {
  const args = [...COMMON_ARGS];
  if (hero) {
    args.push("--window-position=0,0", "--window-size=1920,1080");
    if (cameraReady) args.push("--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${CAMERA}`, `--use-file-for-fake-audio-capture=${SILENCE}`);
  } else {
    // An extra client never shows a camera on film; if one is ever turned on it gets Chrome's generic
    // fake device, which is why no shot turns an extra's camera on.
    args.push("--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${SILENCE}`, "--window-size=960,600");
  }
  return puppeteer.launch({
    headless: hero ? headless : true,
    executablePath: CHROME,
    userDataDir: resolve(PROFILES, name),
    // a recording window uses its REAL size (the full-screen window below); emulation only when headless
    defaultViewport: hero ? (headless ? { width: 1920, height: 1080, deviceScaleFactor: 1 } : null) : { width: 1280, height: 800, deviceScaleFactor: 1 },
    ignoreDefaultArgs: ["--enable-automation"],
    args,
  });
}

const errors = [];
const hero = await launch("bon", { hero: true });
const bon = (await hero.pages())[0] ?? (await hero.newPage());
if (!headless) {
  // macOS full screen for the recording window: no tabs, no URL bar, frontmost, the whole 1920×1080 display
  const cdp = await bon.createCDPSession();
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  await bon.bringToFront();
}
bon.on("pageerror", (e) => errors.push(`bon: ${e}`));
bon.on("console", (m) => { if (m.type() === "error") errors.push(`bon: ${m.text().slice(0, 200)}`); });

let extrasBrowser = null;
const extras = new Map(); // key → Page (Classic office sessions)
async function extra(key) {
  if (extras.has(key)) return extras.get(key);
  extrasBrowser ??= await launch("extras", { hero: false });
  const ctx = await extrasBrowser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${key}: ${e}`));
  await page.goto(`${FRONT}?world=v1&as=${encodeURIComponent(CAST[key].email)}`, { waitUntil: "domcontentloaded" });
  extras.set(key, page);
  return page;
}
async function closeExtra(key) {
  const p = extras.get(key);
  if (!p) return;
  await p.browserContext().close().catch(() => {});
  extras.delete(key);
}

const puppets = new Puppets(API);

// ---- the shot context handed to shots.mjs: small verbs over the real surfaces --------------------
const ctx = {
  FRONT, API, CAST, sleep, log, puppets, extra, closeExtra,
  page: bon,
  /** evaluate in Bon's page */
  vo: (fn, ...args) => bon.evaluate(fn, ...args),
  /** REST as an employee, the real dev-identity header the frontend itself sends */
  api: async (email, method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method, headers: { "content-type": "application/json", "x-dev-email": email },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} as ${email} → ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  },
  /** wait until a predicate in Bon's page is truthy */
  until: async (fn, { timeout = 20000, label = "condition", arg } = {}) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await bon.evaluate(fn, arg).catch(() => false)) return true;
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${label}`);
  },
  /** click the first visible element matching an aria-label / title / text */
  click: async (label, page = bon) => {
    const ok = await page.evaluate((label) => {
      const onScreen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; };
      const els = [...document.querySelectorAll("button,[role=button],a,[role=tab],[role=menuitem],[role=option]")].filter(onScreen);
      const hit = els.find((e) => (e.getAttribute("aria-label") ?? "") === label)
        ?? els.find((e) => (e.getAttribute("title") ?? "") === label)
        ?? els.find((e) => (e.textContent ?? "").trim() === label)
        ?? els.find((e) => (e.textContent ?? "").trim().startsWith(label))
        ?? els.find((e) => (e.textContent ?? "").includes(label));
      if (!hit) return false;
      const r = hit.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    if (!ok) throw new Error(`no visible control "${label}"`);
    await page.mouse.click(ok.x, ok.y);
    await sleep(120);
    // park the pointer in a corner so hover states never linger on camera
    await page.mouse.move(1919, 1079);
    return true;
  },
  /** is a control with this label visible */
  visible: (label, page = bon) => page.evaluate((label) =>
    [...document.querySelectorAll("button,[role=button],[role=dialog],[aria-label],h1,h2,h3")].some((e) =>
      (e.offsetParent || e.getClientRects().length) && ((e.getAttribute("aria-label") ?? "") === label || (e.textContent ?? "").trim() === label)), label),
  /** hold real keys for ms (the same KeyboardEvents PlayerInput listens to) */
  hold: async (keys, ms, page = bon) => {
    for (const k of keys) await page.keyboard.down(k);
    await sleep(ms);
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
  },
  press: (key, page = bon) => page.keyboard.press(key),
  /** close any open panel/dialog the way a person would: Escape */
  closePanels: async () => { for (let i = 0; i < 3; i++) { await bon.keyboard.press("Escape"); await sleep(80); } await bon.mouse.move(1919, 1079); },
  snap: async (name, page = bon) => { await mkdir(OUT, { recursive: true }); const p = resolve(OUT, `${name}.png`); await page.screenshot({ path: p }); return p; },
};

// ---- boot Bon --------------------------------------------------------------------------------------
async function bootBon() {
  await bon.goto(`${FRONT}?as=${encodeURIComponent(CAST.bon.email)}`, { waitUntil: "domcontentloaded" });
  await ctx.until(() => !!window.__vo3d?.selfMovement, { timeout: 60000, label: "the 3D office" });
  await bon.mouse.move(1919, 1079);
}
await puppets.connect(Object.keys(CAST).filter((k) => k !== "bon"));
await bootBon();
const gpu = await bon.evaluate(() => { const g = document.createElement("canvas").getContext("webgl2"); const x = g?.getExtension("WEBGL_debug_renderer_info"); return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : "unknown"; });
log(`hero ready (${headless ? "headless" : "window"}), camera source ${cameraReady ? "ON" : "missing — run make-camera.mjs"}, WebGL ${gpu}`);

// ---- HTTP control ------------------------------------------------------------------------------------
let busy = false;
createServer(async (rq, rs) => {
  let raw = "";
  for await (const c of rq) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const reply = (code, v) => { rs.writeHead(code, { "content-type": "text/plain" }); rs.end(typeof v === "string" ? v : JSON.stringify(v, null, 2)); };
  const url = rq.url ?? "/";
  if (busy && !url.startsWith("/status")) return reply(409, "busy — a shot is still being staged");
  busy = true;
  errors.length = 0;
  try {
    // re-read the shot list on every request, so a tuned shot applies without restarting the browsers
    const { SHOTS } = await import(`./shots.mjs?v=${Date.now()}`);
    if (url === "/list") return reply(200, Object.entries(SHOTS).map(([k, s]) => `${k.padEnd(20)} ${s.about}`).join("\n"));
    if (url === "/status") return reply(200, { extras: [...extras.keys()], puppets: puppets.status() });
    if (url === "/eval") {
      const page = body.target === "bon" || !body.target ? bon : await extra(body.target);
      return reply(200, await page.evaluate(`(async () => { return (${body.js}); })()`));
    }
    if (url === "/snap") {
      const page = body.target === "bon" || !body.target ? bon : extras.get(body.target);
      return reply(200, await ctx.snap(body.name ?? body.target ?? "bon", page));
    }
    if (url === "/reset") { await SHOTS.Reset.stage(ctx); return reply(200, "reset"); }
    const m = url.match(/^\/shot\/([A-Za-z0-9]+)$/);
    const shot = m && SHOTS[m[1]];
    if (!shot) return reply(404, `unknown shot — try: list`);
    const t0 = Date.now();
    await shot.stage(ctx);
    const ready = shot.verify ? await shot.verify(ctx) : true;
    let ran = null;
    let clip = null;
    if (body.args?.[0] === "go" && shot.go) {
      const rec = body.args.includes("record") ? await record(m[1]) : null;
      ran = await shot.go(ctx);
      if (rec) clip = await rec.stop();
    }
    const snap = await ctx.snap(m[1]);
    return reply(ready ? 200 : 500, { shot: m[1], ready, ran, ms: Date.now() - t0, snap, clip, pageErrors: errors.slice(0, 8) });
  } catch (e) {
    return reply(500, { error: String(e?.stack ?? e).slice(0, 1200), pageErrors: errors.slice(0, 8) });
  } finally { busy = false; }
}).listen(PORT, "127.0.0.1", () => log(`listening on http://127.0.0.1:${PORT}`));

// Page capture: Chrome's own screencast of Bon's page (the composited 3D canvas + DOM HUD, via CDP
// Page.startScreencast) — no display recording. Frames land on disk with Chrome's timestamps and are
// encoded afterwards (x264) with their real durations, so encoding never competes with the take.
// An in-page rAF counter reports the real render rate over the take.
async function record(name) {
  const dir = resolve(CLIPS, `${name}.frames`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const cdp = await bon.createCDPSession();
  const frames = [];
  const writes = [];
  cdp.on("Page.screencastFrame", (f) => {
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    const file = `${String(frames.length).padStart(6, "0")}.jpg`;
    frames.push({ file, t: f.metadata.timestamp });
    writes.push(writeFile(resolve(dir, file), Buffer.from(f.data, "base64")));
  });
  await bon.evaluate(() => { const w = window; w.__filmFrames = 0; w.__filmT0 = performance.now(); const tick = () => { w.__filmFrames++; if (w.__filmT0 !== null) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(700);
  return {
    async stop() {
      await sleep(1500);
      const r = await bon.evaluate(() => { const ms = performance.now() - window.__filmT0; window.__filmT0 = null; return { frames: window.__filmFrames, ms }; });
      await cdp.send("Page.stopScreencast").catch(() => {});
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
      // concat list with each frame's real on-screen duration → constant 60 fps H.264
      const lines = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? f.t + 1 / 30) - f.t)).toFixed(4)}`);
      lines.push(`file '${frames.at(-1).file}'`);
      await writeFile(resolve(dir, "list.txt"), lines.join("\n"));
      const out = resolve(CLIPS, `${name}.mp4`);
      await new Promise((ok, bad) => execFile(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", resolve(dir, "list.txt"),
        "-vf", "fps=60,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-movflags", "+faststart", out],
        (e, _o, err) => e ? bad(new Error(String(err || e))) : ok()));
      const span = frames.at(-1).t - frames[0].t;
      return { path: out, seconds: +span.toFixed(1), captureFps: +((frames.length - 1) / span).toFixed(1), renderFps: +(r.frames / (r.ms / 1000)).toFixed(1), frames: frames.length };
    },
  };
}

async function shutdown() { puppets.close(); await hero.close().catch(() => {}); await extrasBrowser?.close().catch(() => {}); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// A silent WAV for Chrome's fake microphone — without one, Chrome's fake audio device is a beep.
async function ensureSilence() {
  if (await access(SILENCE).then(() => true, () => false)) return;
  const rate = 48000, secs = 10, n = rate * secs;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  await mkdir(dirname(SILENCE), { recursive: true });
  await writeFile(SILENCE, b);
}
