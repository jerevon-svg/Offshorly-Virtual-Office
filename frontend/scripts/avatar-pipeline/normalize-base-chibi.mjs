#!/usr/bin/env node
/**
 * Batch-normalizes the full 20-slot base-chibi placeholder raw output
 * (output/production-v3/base-chibi-probe/{slot}.png — 1024x1024 opaque,
 * magenta chroma-key background) into the app's real sprite frame shape
 * (191x240 RGBA transparent), reusing the exact normalizeFrame() logic
 * gen-server.mjs / normalize-production-v3.mjs already use for real
 * employees.
 *
 * Input:  output/production-v3/base-chibi-probe/{slot}.png (flat, slot names
 *         e.g. idle-front.png, walk-left-1.png, pat-back-2.png)
 * Output: src/assets/office/characters/base-chibi-{idle,walk,pat}-norm/...
 *         following the exact same sub-naming convention already used for
 *         real employees (bon-idle-norm/front.png,
 *         bon-walk-norm/front-1.png, bon-pat-norm/back-2.png, etc.):
 *           base-chibi-idle-norm/{front,back,left,right}.png
 *           base-chibi-walk-norm/{front,back,left,right}-{1,2}.png
 *           base-chibi-pat-norm/{front,back,left,right}-{1,2}.png
 *
 * Does NOT touch the raw production-v3/base-chibi-probe originals, and does
 * NOT touch/delete the old base-chibi-{front,back,left,right}.png static
 * crops already in src/assets/office/characters/ (placeholder.ts rollback
 * safety net).
 *
 * Run: node scripts/avatar-pipeline/normalize-base-chibi.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeFrame } from "./frame-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const INPUT_DIR = path.join(__dirname, "output", "production-v3", "base-chibi-probe");
const CHARACTERS_DIR = path.join(APP_ROOT, "src", "assets", "office", "characters");

// Maps this figure's flat slot filename -> { outDir, outFile } using the
// exact naming convention real employees' -norm folders already use.
const SLOT_MAP = {
  "idle-front": { dir: "base-chibi-idle-norm", file: "front.png" },
  "idle-back": { dir: "base-chibi-idle-norm", file: "back.png" },
  "idle-left": { dir: "base-chibi-idle-norm", file: "left.png" },
  "idle-right": { dir: "base-chibi-idle-norm", file: "right.png" },
  "walk-front-1": { dir: "base-chibi-walk-norm", file: "front-1.png" },
  "walk-front-2": { dir: "base-chibi-walk-norm", file: "front-2.png" },
  "walk-back-1": { dir: "base-chibi-walk-norm", file: "back-1.png" },
  "walk-back-2": { dir: "base-chibi-walk-norm", file: "back-2.png" },
  "walk-left-1": { dir: "base-chibi-walk-norm", file: "left-1.png" },
  "walk-left-2": { dir: "base-chibi-walk-norm", file: "left-2.png" },
  "walk-right-1": { dir: "base-chibi-walk-norm", file: "right-1.png" },
  "walk-right-2": { dir: "base-chibi-walk-norm", file: "right-2.png" },
  "pat-front-1": { dir: "base-chibi-pat-norm", file: "front-1.png" },
  "pat-front-2": { dir: "base-chibi-pat-norm", file: "front-2.png" },
  "pat-back-1": { dir: "base-chibi-pat-norm", file: "back-1.png" },
  "pat-back-2": { dir: "base-chibi-pat-norm", file: "back-2.png" },
  "pat-left-1": { dir: "base-chibi-pat-norm", file: "left-1.png" },
  "pat-left-2": { dir: "base-chibi-pat-norm", file: "left-2.png" },
  "pat-right-1": { dir: "base-chibi-pat-norm", file: "right-1.png" },
  "pat-right-2": { dir: "base-chibi-pat-norm", file: "right-2.png" },
};

async function main() {
  let total = 0;
  let failed = 0;

  for (const [slot, { dir, file }] of Object.entries(SLOT_MAP)) {
    const inPath = path.join(INPUT_DIR, `${slot}.png`);
    if (!existsSync(inPath)) {
      console.error(`SKIP: missing raw input for ${slot} (${inPath})`);
      failed += 1;
      continue;
    }
    const outDir = path.join(CHARACTERS_DIR, dir);
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, file);
    try {
      const buffer = readFileSync(inPath);
      const normalized = await normalizeFrame(buffer);
      writeFileSync(outPath, normalized);
      total += 1;
      console.log(`OK  ${slot} -> ${dir}/${file}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${slot}: ${err && err.message ? err.message : err}`);
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Normalized: ${total}/20`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`normalize-base-chibi FAILED: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
