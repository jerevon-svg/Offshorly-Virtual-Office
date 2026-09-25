#!/usr/bin/env node
// FILM RIG ONLY — turn Bon's prerecorded "hi" clip into a camera source Chrome can use as a webcam.
//
// Chrome's --use-file-for-fake-video-capture accepts only .y4m or .mjpeg. No ffmpeg is installed (and
// none may be), so the conversion uses the one H.264 decoder already on this machine: Chrome itself.
// A local page plays the .mov, seeks it frame by frame, draws each frame to a canvas (optionally
// cropped) and encodes it as JPEG; the frames are concatenated into an MJPEG stream (the format Chrome's
// fake-capture file reader expects: back-to-back JPEGs, played at 30 fps, looped).
//
//   node scripts/film/make-camera.mjs --preview                    # write out/camera-preview.png (frame 0)
//   node scripts/film/make-camera.mjs                               # the defaults below: Bon's face only
//   node scripts/film/make-camera.mjs [--crop x,y,w,h] [--size WxH] [--from s] [--to s] [--fps 30]
//
// THE SOURCE IS A SCREEN RECORDING OF A VO CALL, not a raw webcam file: Bon's real camera is visible only
// inside the call tile, 3.25–6.25 s in. The defaults crop exactly that tile's picture (below its "In a
// call" pill — a 16:9, 172×97 source rectangle), and play it forward then backward so Chrome's loop has no
// visible jump. Nothing of the recorded VO UI around the tile ends up in the camera feed.
//
// The source is read, never modified. Output: scripts/film/out/bon-camera.mjpeg
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, writeFile, open } from "node:fs/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const puppeteer = createRequire(resolve(HERE, "../../package.json"))("puppeteer");
const SRC = "/Users/lekoffshorly/Desktop/Screen Recording 2026-09-24 at 7.59.27 AM.mov";
const OUT = resolve(HERE, "out");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const preview = process.argv.includes("--preview");
const fps = Number(arg("fps", 30));
const [W, H] = String(arg("size", "640x360")).split("x").map(Number);
const crop = String(arg("crop", "652,104,172,97")).split(",").map(Number);
const from = Number(arg("from", 3.25)), to = Number(arg("to", 6.25));

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, "camera.html"), `<!doctype html><body style="margin:0;background:#000">
<video id="v" muted playsinline preload="auto" src="${pathToFileURL(SRC).href}"></video><canvas id="c"></canvas></body>`);

const browser = await puppeteer.launch({
  headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  userDataDir: resolve(OUT, "profiles/camera"), args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(OUT, "camera.html")).href);
const meta = await page.evaluate(() => new Promise((ok, bad) => {
  const v = document.getElementById("v");
  const done = () => ok({ w: v.videoWidth, h: v.videoHeight, d: v.duration });
  if (v.readyState >= 1) done(); else { v.onloadedmetadata = done; v.onerror = () => bad(new Error(`cannot decode: ${v.error?.code}`)); }
}));
console.log(`source ${meta.w}×${meta.h}, ${meta.d.toFixed(2)} s`);

const frameAt = (t, q = 0.9) => page.evaluate(({ t, W, H, crop, q }) => new Promise((ok) => {
  const v = document.getElementById("v"), c = document.getElementById("c");
  v.onseeked = () => {
    const [sx, sy, sw, sh] = crop ?? [0, 0, v.videoWidth, v.videoHeight];
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    // cover-fit the (cropped) source into W×H so the camera frame has no letterbox bars
    const s = Math.max(W / sw, H / sh), dw = sw * s, dh = sh * s;
    g.drawImage(v, sx, sy, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ok(c.toDataURL("image/jpeg", q).split(",")[1]);
  };
  v.currentTime = t;
}), { t, W, H, crop, q });

if (preview) {
  const b = await page.evaluate(() => new Promise((ok) => { const v = document.getElementById("v"); v.onseeked = () => { const c = document.getElementById("c"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0); ok(c.toDataURL("image/png").split(",")[1]); }; v.currentTime = Math.min(2, v.duration / 2); }));
  await writeFile(resolve(OUT, "camera-preview.png"), Buffer.from(b, "base64"));
  console.log("wrote out/camera-preview.png (full source frame at 2 s)");
} else {
  const frames = [];
  const count = Math.floor((Math.min(to, meta.d) - from) * fps);
  for (let i = 0; i < count; i++) {
    frames.push(Buffer.from(await frameAt(from + i / fps), "base64"));
    if (i % 30 === 0) process.stdout.write(`\rframe ${i}/${count}`);
  }
  const loop = [...frames, ...frames.slice(1, -1).reverse()]; // ping-pong: seamless when Chrome loops it
  const fh = await open(resolve(OUT, "bon-camera.mjpeg"), "w");
  for (const f of loop) await fh.write(f);
  await fh.close();
  const n = loop.length;
  const b = await frameAt((from + to) / 2);
  await writeFile(resolve(OUT, "camera-check.jpg"), Buffer.from(b, "base64"));
  console.log(`\nwrote out/bon-camera.mjpeg (${n} frames, ${W}×${H}, ${fps} fps) + out/camera-check.jpg`);
}
await browser.close();
