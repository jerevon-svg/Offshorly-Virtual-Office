#!/usr/bin/env node
/**
 * Batch-normalizes the already-generated production-v2 output (raw 1024x1024
 * RGB, opaque, studio-render framing) into the app's real sprite frame shape
 * (191x240 RGBA transparent), reusing the exact normalizeFrame() logic
 * gen-server.mjs already uses for its live "Add Employee" pipeline.
 *
 * Input:  output/production-v2/{bon,alex,micah}/{slot}/candidate-1.png
 * Output: output/production-v2-normalized/{person}/{slot}.png
 *         (flattened — one candidate per slot, so the per-candidate folder
 *         nesting is dropped)
 *
 * Does NOT touch/overwrite the raw production-v2 originals.
 *
 * Run: node scripts/avatar-pipeline/normalize-production-v2.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeFrame } from "./frame-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_ROOT = path.join(__dirname, "output", "production-v2");
const OUTPUT_ROOT = path.join(__dirname, "output", "production-v2-normalized");

const PEOPLE = ["bon", "alex", "micah"];

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

    const slots = readdirSync(personInDir).filter((entry) =>
      existsSync(path.join(personInDir, entry, "candidate-1.png")),
    );
    slots.sort();

    for (const slot of slots) {
      const inPath = path.join(personInDir, slot, "candidate-1.png");
      const outPath = path.join(personOutDir, `${slot}.png`);
      try {
        const buffer = readFileSync(inPath);
        const normalized = await normalizeFrame(buffer);
        writeFileSync(outPath, normalized);
        total += 1;
        console.log(`OK  ${person}/${slot}`);
      } catch (err) {
        failed += 1;
        console.error(`FAIL ${person}/${slot}: ${err && err.message ? err.message : err}`);
      }
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Normalized: ${total}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`normalize-production-v2 FAILED: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
