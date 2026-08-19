#!/usr/bin/env node
/**
 * One-off single-person regeneration of the "bon" (Jerevon) fresh chibi
 * master candidate, from his ORIGINAL flat/uploaded Sprite reference —
 * NOT an existing chibi anchor. This is a thin single-person variant of
 * generate-consistency-test-from-upload.mjs (same prompt/process, same
 * reused helpers), run because the currently-locked masters/Bon_Master.png
 * needs a genuinely fresh regenerated candidate for visual review before
 * any replacement — the locked master itself is NOT touched by this script.
 *
 * Reuses OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE + generateOne from
 * generate-production-v2.mjs unmodified (same prompt/size convention
 * gen-server.mjs uses for a person's very first/anchor generation: single
 * images/edits call, n=1, size fixed at 1024x1024, model gpt-image-1).
 *
 * Input:  /Users/lekoffshorly/Downloads/Employee Sprite/Jerevon_Sprite.png
 * Output: output/consistency-test-from-upload/bon-v2.png
 *         masters/Jerevon_Master_candidate.png (copy, for side-by-side review)
 *
 * Does NOT overwrite masters/Bon_Master.png or any other locked master.
 * Does NOT touch output/consistency-test-from-upload/{alex,micah,lui,bon}.png.
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Errors are redacted
 * before printing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEnvKey, OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE, generateOne } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_DIR = path.join(__dirname, "output", "consistency-test-from-upload");
const MASTERS_DIR = path.join(__dirname, "masters");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

const REFERENCE = "/Users/lekoffshorly/Downloads/Employee Sprite/Jerevon_Sprite.png";
const OUT_RAW_PATH = path.join(OUTPUT_DIR, "bon-v2.png");
const OUT_MASTER_CANDIDATE_PATH = path.join(MASTERS_DIR, "Jerevon_Master_candidate.png");

// Identical wording to generate-consistency-test-from-upload.mjs's
// THREE_QUARTER_POSE constant.
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

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  if (!existsSync(REFERENCE)) throw new Error(`Reference not found at ${REFERENCE}`);
  if (existsSync(OUT_RAW_PATH)) throw new Error(`Refusing to overwrite existing file: ${OUT_RAW_PATH}`);
  if (existsSync(OUT_MASTER_CANDIDATE_PATH)) throw new Error(`Refusing to overwrite existing file: ${OUT_MASTER_CANDIDATE_PATH}`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const refDims = getPixelDims(REFERENCE);
  console.log(`-- bon: flat reference ${refDims.width}x${refDims.height}, generating via images/edits (size 1024x1024, matching gen-server.mjs's raw-photo->anchor convention) --`);

  const refBuffer = readFileSync(REFERENCE);
  const refBlob = new Blob([refBuffer], { type: "image/png" });
  const prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${THREE_QUARTER_POSE}`;
  const label = "bon/from-upload-three-quarter-v2";

  const buf = await withRetry(() => generateOne(apiKey, prompt, refBlob, label), label);
  writeFileSync(OUT_RAW_PATH, buf);
  writeFileSync(OUT_MASTER_CANDIDATE_PATH, buf);

  const finalDims = getPixelDims(OUT_RAW_PATH);
  console.log(`   saved ${OUT_RAW_PATH} (final dims ${finalDims.width}x${finalDims.height})`);
  console.log(`   saved ${OUT_MASTER_CANDIDATE_PATH} (candidate copy for review, masters/Bon_Master.png NOT touched)`);
}

main().catch((err) => {
  console.error(`Bon master candidate regeneration FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
