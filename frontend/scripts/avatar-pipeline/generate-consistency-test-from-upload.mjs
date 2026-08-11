#!/usr/bin/env node
/**
 * Second consistency test: generate a FRESH chibi (front-left 3/4 turn) for
 * Bon, Alex, Micah, Lui starting from each person's ORIGINAL flat/uploaded
 * reference image — NOT an existing chibi anchor. This mirrors the real
 * "Add Employee" production entry point (see gen-server.mjs's raw-photo ->
 * anchor step), which is a more representative test than editing an
 * already-generated chibi.
 *
 * Reuses OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE + generateOne from
 * generate-production-v2.mjs unmodified (same prompt/size convention
 * gen-server.mjs uses for a person's very first/anchor generation: single
 * images/edits call, n=1, size fixed at 1024x1024, model gpt-image-1 —
 * gen-server.mjs does NOT aspect-match the raw photo for this step).
 *
 * Inputs (flat/uploaded Sprite references, NOT chibi anchors):
 *   Bon:   /Users/lekoffshorly/Downloads/Employee Sprite/Jerevon_Sprite.png
 *   Alex:  /Users/lekoffshorly/Downloads/Employee Sprite/Alex_Sprite.png
 *   Micah: /Users/lekoffshorly/Downloads/Employee Sprite/Micah_Sprite.png
 *   Lui:   /Users/lekoffshorly/Downloads/Employee Sprite/Lui_Sprite.png
 *
 * Output: output/consistency-test-from-upload/{bon,alex,micah,lui}.png
 *
 * Does NOT touch output/consistency-test-3-4/ (separate concurrent test).
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Errors are redacted
 * before printing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEnvKey, redact, OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE, generateOne } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_DIR = path.join(__dirname, "output", "consistency-test-from-upload");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

// Standard moderate front-left 3/4 turn, worded for a flat/front-facing
// source illustration (not an existing chibi walk pose), plus a full
// standing pose since the flat references are static front portraits/full
// body illustrations, not pre-posed chibi anchors.
const THREE_QUARTER_POSE = `Now, put this character in a standing idle pose in a standard moderate front-left 3/4 turned view: the body and head are turned partially toward the camera's left, showing a partial profile view (not a full side profile, and not a steep overhead or back-facing angle) — a normal moderate 3/4 turn, both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides. Keep everything else (identity, clothing, art style, lighting, camera, scale) exactly the same as the input image.`;

function getPixelDims(filePath) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], {
    encoding: "utf8",
  });
  const w = Number(out.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const h = Number(out.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!w || !h) throw new Error(`Could not parse pixel dimensions for ${filePath}`);
  return { width: w, height: h };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`  [retry ${attempt}/${MAX_RETRIES}] ${label} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

const PEOPLE = [
  {
    name: "bon",
    reference: "/Users/lekoffshorly/Downloads/Employee Sprite/Jerevon_Sprite.png",
  },
  {
    name: "alex",
    reference: "/Users/lekoffshorly/Downloads/Employee Sprite/Alex_Sprite.png",
  },
  {
    name: "micah",
    reference: "/Users/lekoffshorly/Downloads/Employee Sprite/Micah_Sprite.png",
  },
  {
    name: "lui",
    reference: "/Users/lekoffshorly/Downloads/Employee Sprite/Lui_Sprite.png",
  },
];

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  for (const person of PEOPLE) {
    if (!existsSync(person.reference)) throw new Error(`Reference not found for ${person.name} at ${person.reference}`);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const results = [];

  for (const person of PEOPLE) {
    const refDims = getPixelDims(person.reference);
    console.log(`-- ${person.name}: flat reference ${refDims.width}x${refDims.height}, generating via images/edits (size 1024x1024, matching gen-server.mjs's raw-photo->anchor convention) --`);

    const refBuffer = readFileSync(person.reference);
    const refBlob = new Blob([refBuffer], { type: "image/png" });
    const prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${THREE_QUARTER_POSE}`;
    const label = `${person.name}/from-upload-three-quarter`;
    const outPath = path.join(OUTPUT_DIR, `${person.name}.png`);

    const buf = await withRetry(() => generateOne(apiKey, prompt, refBlob, label), label);
    writeFileSync(outPath, buf);

    const finalDims = getPixelDims(outPath);
    console.log(`   saved ${outPath} (final dims ${finalDims.width}x${finalDims.height})`);
    results.push({ person: person.name, refDims, finalDims, outPath });
  }

  console.log(`\n=== SUMMARY ===`);
  for (const r of results) {
    console.log(
      `${r.person}: reference ${r.refDims.width}x${r.refDims.height} -> saved ${r.finalDims.width}x${r.finalDims.height} at ${r.outPath}`
    );
  }
}

main().catch((err) => {
  console.error(`From-upload consistency test FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
