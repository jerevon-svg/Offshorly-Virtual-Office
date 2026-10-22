// v3/landmarks2d.mjs — HumanBase V3 proof: 2D face landmarks + scale-free identity TRAITS for images (illustrations,
// photos, renders). ZERO CREDITS, local only. Uses MediaPipe Face Landmarker (code + model weights Apache-2.0) run in the
// local headless Chrome. The proof keeps the package + model OUTSIDE the repo (pass its folder with --mp=); nothing is
// added to package.json. Landmarks are computed transiently; callers persist only derived ratios/scores.
//   node scripts/avatar-pipeline/human-base/v3/landmarks2d.mjs --mp=<dir with package/ + face_landmarker.task> <out.json> <img1> [img2 …]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

/** scale-free traits from 478 MediaPipe landmarks (x, y in image pixels, y down) */
export function traitsOf(L) {
  const p = (i) => L[i], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const irisR = L.length > 473 ? p(468) : mid(p(33), p(133)), irisL = L.length > 473 ? p(473) : mid(p(362), p(263));
  const eyeMid = mid(irisR, irisL), faceW = d(p(234), p(454)), chin = p(152), eyeChin = Math.abs(chin[1] - eyeMid[1]);
  const eyeW = (d(p(33), p(133)) + d(p(362), p(263))) / 2, eyeH = (d(p(159), p(145)) + d(p(386), p(374))) / 2;
  const mouthC = mid(p(13), p(14));
  return {
    faceLength: eyeChin / faceW,                         // eye line → chin over face width (long / round face)
    eyeSpacing: d(irisR, irisL) / faceW,
    eyeWidth: eyeW / faceW, eyeOpen: eyeH / eyeW,
    noseWidth: d(p(129), p(358)) / faceW, nosePos: (p(1)[1] - eyeMid[1]) / eyeChin,
    mouthWidth: d(p(61), p(291)) / faceW, mouthPos: (mouthC[1] - eyeMid[1]) / eyeChin,
    jawWidth: d(p(172), p(397)) / faceW, browRise: (eyeMid[1] - (p(105)[1] + p(334)[1]) / 2) / faceW,
    foreheadRise: (eyeMid[1] - p(10)[1]) / faceW,
  };
}

export async function detect(mpDir, images) {
  const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".task": "application/octet-stream", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".html": "text/html" };
  const page0 = `<!doctype html><meta charset=utf-8><body><script type=module>
import { FilesetResolver, FaceLandmarker } from "/mp/package/vision_bundle.mjs";
const fs = await FilesetResolver.forVisionTasks("/mp/package/wasm");
const fl = await FaceLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: "/mp/face_landmarker.task", delegate: "CPU" }, runningMode: "IMAGE", numFaces: 2, minFaceDetectionConfidence: 0.2, minFacePresenceConfidence: 0.2 });
window.run = async (url) => { const img = new Image(); img.src = url; await img.decode(); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d"); g.fillStyle = "#d9dfe6"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
  const r = fl.detect(c); return { w: c.width, h: c.height, faces: r.faceLandmarks.map((f) => f.map((q) => [q.x * c.width, q.y * c.height, q.z * c.width])) }; };
window.ready = true;
</script>`;
  const files = new Map(images.map((f, i) => [`/img/${i}${path.extname(f).toLowerCase()}`, f]));
  const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split("?")[0]);
    let f = u === "/" ? null : u.startsWith("/mp/") ? path.join(mpDir, u.slice(4)) : files.get(u);
    if (u === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page0); }
    if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": mime[path.extname(f).toLowerCase()] ?? "application/octet-stream" }); fs.createReadStream(f).pipe(res); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const port = srv.address().port;
  const puppeteer = createRequire(`${process.cwd()}/package.json`)("puppeteer");
  const browser = await puppeteer.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", userDataDir: `${process.env.TMPDIR ?? "/tmp"}/hb-v3-mp`, args: ["--disable-background-timer-throttling"] });
  const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => window.ready, { timeout: 120000 });
  const out = [];
  for (const [u, f] of files) { const r = await page.evaluate((x) => window.run(x), u); const face = r.faces.sort((a, b) => spread(b) - spread(a))[0] ?? null; out.push({ file: f, size: [r.w, r.h], found: !!face, faces: r.faces.length, landmarks: face, traits: face ? traitsOf(face) : null }); }
  await browser.close(); srv.close();
  return out;
}
const spread = (f) => { let a = Infinity, b = -Infinity; for (const q of f) { a = Math.min(a, q[0]); b = Math.max(b, q[0]); } return b - a; };

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), mp = args.find((a) => a.startsWith("--mp="))?.slice(5), rest = args.filter((a) => !a.startsWith("--"));
  const [out, ...imgs] = rest; const r = await detect(mp, imgs);
  fs.writeFileSync(out, JSON.stringify(r)); for (const x of r) console.log(path.basename(x.file), x.found ? `faces ${x.faces} faceLength ${x.traits.faceLength.toFixed(3)} eyeSpacing ${x.traits.eyeSpacing.toFixed(3)}` : "NO FACE");
}
