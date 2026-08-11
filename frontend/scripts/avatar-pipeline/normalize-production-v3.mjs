#!/usr/bin/env node
/**
 * Batch-normalizes the already-generated production-v3 output (raw 1024x1024
 * RGB, opaque, studio-render framing) into the app's real sprite frame shape
 * (191x240 RGBA transparent), reusing the exact normalizeFrame() logic
 * gen-server.mjs / normalize-production-v2.mjs already use.
 *
 * Input:  output/production-v3/{bon,alex,micah,lui}/{slot-filename}.png
 *         (flat per-person dir, e.g. idle-front.png, walk-left-1.png,
 *         pat-back-2.png — no per-candidate subfolder nesting like v2)
 * Output: output/production-v3-normalized/{person}/{slot-filename}.png
 *
 * Does NOT touch/overwrite the raw production-v3 originals.
 *
 * Run: node scripts/avatar-pipeline/normalize-production-v3.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeFrame } from "./frame-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_ROOT = path.join(__dirname, "output", "production-v3");
const OUTPUT_ROOT = path.join(__dirname, "output", "production-v3-normalized");

const PEOPLE = ["bon", "alex", "micah", "lui"];

async function main() {
  let total = 0;
  let failed = 0;

  for (const person of PEOPLE) {
    const personInDir = path.join(INPUT_ROOT, person);
    if (!existsSync(personInDir)) {
      console.error(`SKIP: no input dir for ${person} (${personInDir})`);
      continue;
    }
    const personOutDir = path.join(OUTPUT_ROOT, person);
    mkdirSync(personOutDir, { recursive: true });

    const files = readdirSync(personInDir)
      .filter((entry) => entry.endsWith(".png"))
      .sort();

    for (const file of files) {
      const inPath = path.join(personInDir, file);
      const outPath = path.join(personOutDir, file);
      try {
        const buffer = readFileSync(inPath);
        const normalized = await normalizeFrame(buffer);
        writeFileSync(outPath, normalized);
        total += 1;
        console.log(`OK  ${person}/${file}`);
      } catch (err) {
        failed += 1;
        console.error(`FAIL ${person}/${file}: ${err && err.message ? err.message : err}`);
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Normalized: ${total}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`normalize-production-v3 FAILED: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
