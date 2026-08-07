#!/usr/bin/env node
/**
 * One-off targeted regen: fixes the BACK_NO_FACE_CLAUSE hair-bleed bug
 * (see generate-production-v2.mjs) and regenerates ONLY the 5 back-facing
 * slots for Alex — one generation per slot, no extra candidates.
 *
 * Slots: idle-back, walk-back-1, walk-back-2, pat-back-1, pat-back-2.
 * Anchor: output/alex-walk-left-e2v2-1.png (same anchor as the full run).
 *
 * Standalone script. Run manually with:
 *   node scripts/avatar-pipeline/regen-alex-back.mjs
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Any caught error is
 * sanitized before being written to stdout/stderr.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE,
  SLOTS,
  loadEnvKey,
  redact,
  generateOne,
} from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_ROOT = path.join(__dirname, "output", "production-v2");
const ANCHOR = path.join(__dirname, "output", "alex-walk-left-e2v2-1.png");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

const TARGET_SLOTS = ["idle-back", "walk-back-1", "walk-back-2", "pat-back-1", "pat-back-2"];

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
  if (!existsSync(ANCHOR)) throw new Error(`Anchor not found at ${ANCHOR}`);

  const anchorBuffer = readFileSync(ANCHOR);
  const anchorBlob = new Blob([anchorBuffer], { type: "image/png" });

  const failures = [];

  for (const slotName of TARGET_SLOTS) {
    const slotDir = path.join(OUTPUT_ROOT, "alex", slotName);
    mkdirSync(slotDir, { recursive: true });
    const outPath = path.join(slotDir, "candidate-1.png");
    const prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${SLOTS[slotName]}`;
    const label = `alex/${slotName}`;
    console.log(`-- ${label} (back-facing, hair-bleed fix regen) --`);

    try {
      const buf = await withRetry(() => generateOne(apiKey, prompt, anchorBlob, label), label);
      writeFileSync(outPath, buf);
      console.log(`  OK: wrote ${outPath}`);
    } catch (err) {
      const msg = redact(err.message, apiKey);
      console.error(`  FAILED (persistent): ${label}: ${msg}`);
      failures.push({ slot: slotName, error: msg });
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Regenerated: ${TARGET_SLOTS.length - failures.length}/${TARGET_SLOTS.length}`);
  for (const f of failures) console.log(`  FAILED ${f.slot}: ${f.error}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`Alex back-slot regen FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
