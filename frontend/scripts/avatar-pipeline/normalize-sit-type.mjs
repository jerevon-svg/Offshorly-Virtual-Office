#!/usr/bin/env node
/**
 * Batch-normalizes the already-generated sit-type output (raw 1024x1024 RGB,
 * opaque, chroma-key-background studio render) into the app's real sprite
 * frame shape (191x240 RGBA transparent), reusing the exact normalizeFrame()
 * logic every other production batch script uses.
 *
 * Input:  output/sit-type/{bon,alex,micah,lui}/{front,back,left,right}.png
 * Output: output/sit-type-normalized/{person}/{front,back,left,right}.png
 *
 * Does NOT touch/overwrite the raw sit-type originals.
 *
 * Run: node scripts/avatar-pipeline/normalize-sit-type.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeFrame } from "./frame-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_ROOT = path.join(__dirname, "output", "sit-type");
const OUTPUT_ROOT = path.join(__dirname, "output", "sit-type-normalized");

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
  console.error(`normalize-sit-type FAILED: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
