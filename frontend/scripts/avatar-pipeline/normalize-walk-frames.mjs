/**
 * One-off batch normalizer for the Blender-rendered walk frames (see
 * render-walk-frames.py). Reuses normalizeFrame() from frame-normalize.mjs
 * (same trim/letterbox-to-191x240 logic used by the AI-generated pipeline)
 * against raw/{front,back,left,right}-{1..8}.png, writing to normalized/.
 *
 * Usage: node normalize-walk-frames.mjs <frames_dir>
 * (expects <frames_dir>/raw/*.png, writes <frames_dir>/normalized/*.png)
 */

import fs from "fs/promises";
import path from "path";
import { normalizeFrame } from "./frame-normalize.mjs";

const framesDir = process.argv[2];
if (!framesDir) {
  console.error("Usage: node normalize-walk-frames.mjs <frames_dir>");
  process.exit(1);
}

const rawDir = path.join(framesDir, "raw");
const outDir = path.join(framesDir, "normalized");

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const files = (await fs.readdir(rawDir)).filter((f) => f.endsWith(".png")).sort();
  for (const file of files) {
    const buf = await fs.readFile(path.join(rawDir, file));
    const normalized = await normalizeFrame(buf);
    await fs.writeFile(path.join(outDir, file), normalized);
    console.log(`Normalized ${file}`);
  }
  console.log(`Done: ${files.length} frames -> ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
