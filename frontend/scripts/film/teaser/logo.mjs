// FILM RIG ONLY — the end card's reversed logo: the official SVG read verbatim, only the near-black wordmark fill
// (#1c1c22) swapped to white IN MEMORY; the teal mark, paths and proportions untouched. The brand file is never written.
//   node scripts/film/teaser/logo.mjs   → scripts/film/out/final/offshorly-logo-reversed.png (1600 px wide, transparent)
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "../../..");
const puppeteer = createRequire(resolve(FRONTEND, "package.json"))("puppeteer");
const SRC = resolve(FRONTEND, "src/assets/brand/offshorly-logo.svg");
const OUT = resolve(HERE, "../out/final/offshorly-logo-reversed.png");
const raw = await readFile(SRC, "utf8");
if (!raw.includes('fill="#1c1c22"')) throw new Error(`${SRC}: wordmark fill #1c1c22 not found — the brand file changed; check before reversing`);
const svg = raw.replaceAll('fill="#1c1c22"', 'fill="#ffffff"');
const W = 1600, H = Math.round(W * 148.9631 / 630.1376);                // the SVG's own viewBox ratio
await mkdir(dirname(OUT), { recursive: true });
const b = await puppeteer.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${W}" height="${H}" `)}</body></html>`);
await p.screenshot({ path: OUT, omitBackground: true });
await b.close();
console.log(`${OUT} (${W}×${H})`);
