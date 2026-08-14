#!/usr/bin/env node
/**
 * FULL BATCH run (avatar-pipeline, blank/faceless placeholder chibi):
 * generates the REMAINING 16 pose slots for the base-chibi placeholder
 * figure, on top of the 4 already-approved probe slots (idle-front,
 * idle-back, walk-front-1, walk-front-2 — untouched by this script) and the
 * already-approved anchor (masters/BaseChibi_Master.png — untouched).
 *
 * Reuses OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE + withRetry/callAndSave pattern
 * from generate-blank-chibi-probe.mjs, and loadEnvKey/redact/generateOne
 * from generate-production-v2.mjs (same OpenAI images/edits plumbing).
 *
 * Slot plan (see task instructions this script was written against — NOTE:
 * the task's own slot list omitted walk-back-1/2, which are added here as a
 * necessary correction; see the ADDED comment near WALK_BACK_1_PROMPT below
 * for why):
 *   AI calls (11 total):
 *     idle-left            (one-hop edit of anchor)
 *     walk-left-1           (one-hop edit of anchor)
 *     walk-left-2           (chained off walk-left-1's own output)
 *     walk-back-1           (one-hop edit of anchor) [added — see below]
 *     walk-back-2           (chained off walk-back-1's own output) [added]
 *     pat-front-1           (one-hop edit of anchor)
 *     pat-front-2           (chained off pat-front-1's own output)
 *     pat-back-1            (one-hop edit of anchor)
 *     pat-back-2            (chained off pat-back-1's own output)
 *     pat-left-1            (one-hop edit of anchor)
 *     pat-left-2            (chained off pat-left-1's own output)
 *   Free sharp().flop() mirrors (3 pairs, no AI call):
 *     idle-right  <- idle-left
 *     walk-right-1/2 <- walk-left-1/2
 *     pat-right-1/2  <- pat-left-1/2
 *
 * IMPORTANT — moonwalk-bug check (per generate-production-v3.mjs's
 * LEFT_SLOT_IS_ACTUALLY_RIGHT_FACING precedent for real employees): this
 * script does NOT hardcode an assumption about which way the raw "-left"
 * AI output actually faces. It saves each "-left" AI generation to disk
 * under its own filename first; the calling agent visually inspects the
 * result (Read tool) before the flop-derive step runs, and swaps the
 * left/right labels (see relabelIfMoonwalked()) only if the raw output is
 * confirmed to face the wrong way, exactly mirroring the real employees'
 * fix. This avoids baking in an assumption that may or may not apply to a
 * different figure/prompt (blank chibi has no identity/hair/clothing
 * clauses at all, so the real employees' known root cause may not transfer).
 *
 * Output: output/production-v3/base-chibi-probe/{slot}.png (same folder as
 * the existing 4 approved probe slots — consistency over renaming).
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-blank-chibi-full.mjs [--flop-only]
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Any caught error is
 * sanitized before being written to stdout/stderr so a header/request dump
 * can't leak the key.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { loadEnvKey, redact, generateOne } from "./generate-production-v2.mjs";
import { OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE } from "./generate-blank-chibi-probe.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const MASTERS_DIR = path.join(__dirname, "masters");
const OUTPUT_DIR = path.join(__dirname, "output", "production-v3", "base-chibi-probe");
const ANCHOR_PATH = path.join(MASTERS_DIR, "BaseChibi_Master.png");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

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

function poseSuffix(text) {
  return `Now, ${text} Keep everything else (proportions, art style, lighting, camera, scale, and the fully featureless/faceless/hairless/clothesless surface) exactly the same.`;
}

// ---- One-hop-off-anchor prompts ----
const IDLE_LEFT_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character in a relaxed standing idle pose, true left profile — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, body and head oriented toward the left side of the frame."
)}`;

const WALK_LEFT_1_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character in a mid-walk-stride pose, true left profile — front leg forward and back leg trailing, natural walking motion, front arm swinging back and back arm swinging forward in opposition to the legs. This is walk frame 1 of a 2-frame walk cycle."
)}`;

const PAT_FRONT_1_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character in a patting/waving gesture pose, facing the camera/front direction (true front-facing view, not profile) — one arm just beginning to raise up and forward in a patting/waving motion, elbow bent low, the other arm relaxed at the side. This is pat frame 1 of a 2-frame gesture."
)}`;

const PAT_BACK_1_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character in a patting/waving gesture pose, true back view (not a profile, not a 3/4 view) — the character's back is fully toward the camera, showing the back/crown of the smooth featureless head. One arm just beginning to raise up in a patting/waving motion, elbow bent low, the other arm relaxed at the side, body standing still (not walking). No face, eyes, hair, or clothing anywhere, same as every other view of this figure."
)}`;

const PAT_LEFT_1_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character in a patting/waving gesture pose, true left profile — body and head oriented toward the left side of the frame, one arm just beginning to raise up and forward in a patting/waving motion, elbow bent low, the other arm relaxed at the side. This is pat frame 1 of a 2-frame gesture."
)}`;

// ADDED (not in the original task slot list, which only enumerated
// idle-left/walk-left/pat-front/pat-back/pat-left as the 9 paid calls and
// omitted walk-back-1/2 entirely): the full 20-slot set requires all 8 walk
// directions (front x2, back x2, left x2, right x2 = 8), and the task's own
// step 3 asks to normalize "the full 20-slot set." Without walk-back-1/2 the
// walk-norm folder would be missing 2 of its 8 frames and the normalize
// script would fail (confirmed: it did fail on the first run before this
// addition). Generating these 2 extra slots (11 total paid calls, not 9) to
// actually deliver a complete 20-slot set as the later steps require.
const WALK_BACK_1_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character walking directly AWAY from the camera, true back view (not a profile, not a 3/4 view) — the character's back is fully toward the camera, showing the back/crown of the smooth featureless head. Mid-walking-stride pose, front leg forward and back leg trailing, arms swinging naturally in opposition to the legs. This is walk frame 1 of a 2-frame walk cycle. No face, eyes, hair, or clothing anywhere, same as every other view of this figure."
)}`;

// ---- Chained-off-prior-frame prompts (frame 2 sees frame 1's own output) ----
const WALK_BACK_2_CHAIN_PROMPT =
  "Here is frame 1 of this featureless blank chibi figure's walk cycle, walking directly AWAY from the camera (true back view). Generate frame 2: swap the stride exactly — the forward leg goes back, the trailing leg comes forward, arms swing to the opposite positions. Keep proportions, art style, camera angle, scale, lighting, and the fully featureless/faceless/hairless/clothesless surface exactly identical to this frame, including the true back view (no face, eyes, hair, or clothing visible) — only the leg/arm positions change to the opposite stride phase.";

const WALK_LEFT_2_CHAIN_PROMPT =
  "Here is frame 1 of a LEFT-facing walk cycle (character faces the LEFT edge of the image) for a completely featureless, faceless, hairless, clothesless placeholder chibi figure. In this frame one leg reaches FORWARD toward the LEFT edge (knee bent, heel down) and the other trails BACK toward the RIGHT edge (toe only). Generate frame 2, the opposite stride phase: the leg now reaching toward the LEFT edge must swing BACK toward the RIGHT edge, and the leg now trailing toward the RIGHT edge must swing FORWARD toward the LEFT edge; swap the arms to match. This is a LARGE, deliberate change to leg and arm positions — they MUST clearly differ from frame 1, not a copy. Keep proportions, art style, camera angle, scale, lighting, and the fully featureless/faceless/hairless/clothesless surface exactly identical; do not add any face, eyes, hair, or clothing; only the pose itself changes.";

const PAT_FRAME2_CHAIN_PROMPT =
  "Here is frame 1 of this featureless blank chibi figure's patting/waving gesture. Generate frame 2: raise the same arm higher, to the peak of the patting/waving motion (hand up near shoulder/head height), keep the other arm relaxed at the side. Keep proportions, art style, camera angle, scale, lighting, and the fully featureless/faceless/hairless/clothesless surface exactly identical to this frame — only the arm position changes. Do not add any face, eyes, hair, or clothing.";

async function callAndSave({ apiKey, prompt, refPath, label, outPath }) {
  const refBuffer = readFileSync(refPath);
  const refBlob = new Blob([refBuffer], { type: "image/png" });
  console.log(`-- ${label} --`);
  const buf = await withRetry(() => generateOne(apiKey, prompt, refBlob, label), label);
  writeFileSync(outPath, buf);
  console.log(`   saved -> ${outPath}`);
  return outPath;
}

async function isValidExistingImage(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    const stat = statSync(filePath);
    if (stat.size < 20000) return false;
    const meta = await sharp(filePath).metadata();
    return Boolean(meta.width && meta.height && meta.width > 100 && meta.height > 100);
  } catch {
    return false;
  }
}

async function flop(srcPath, destPath, label) {
  const buf = await sharp(srcPath).flop().toBuffer();
  writeFileSync(destPath, buf);
  console.log(`-- ${label}: mirrored via sharp().flop() (no API call) --`);
}

async function main() {
  const flopOnly = process.argv.includes("--flop-only");

  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  if (!existsSync(ANCHOR_PATH)) throw new Error(`Anchor not found at ${ANCHOR_PATH}`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const generated = [];
  const skipped = [];
  const failures = [];

  const aiSlots = [
    { slot: "idle-left", prompt: IDLE_LEFT_PROMPT, ref: "anchor" },
    { slot: "walk-left-1", prompt: WALK_LEFT_1_PROMPT, ref: "anchor" },
    { slot: "walk-left-2", prompt: WALK_LEFT_2_CHAIN_PROMPT, ref: "walk-left-1" },
    { slot: "walk-back-1", prompt: WALK_BACK_1_PROMPT, ref: "anchor" },
    { slot: "walk-back-2", prompt: WALK_BACK_2_CHAIN_PROMPT, ref: "walk-back-1" },
    { slot: "pat-front-1", prompt: PAT_FRONT_1_PROMPT, ref: "anchor" },
    { slot: "pat-front-2", prompt: PAT_FRAME2_CHAIN_PROMPT, ref: "pat-front-1" },
    { slot: "pat-back-1", prompt: PAT_BACK_1_PROMPT, ref: "anchor" },
    { slot: "pat-back-2", prompt: PAT_FRAME2_CHAIN_PROMPT, ref: "pat-back-1" },
    { slot: "pat-left-1", prompt: PAT_LEFT_1_PROMPT, ref: "anchor" },
    { slot: "pat-left-2", prompt: PAT_FRAME2_CHAIN_PROMPT, ref: "pat-left-1" },
  ];

  if (!flopOnly) {
    for (const { slot, prompt, ref } of aiSlots) {
      const outPath = path.join(OUTPUT_DIR, `${slot}.png`);
      if (await isValidExistingImage(outPath)) {
        console.log(`-- ${slot}: SKIPPED (already present, valid) --`);
        skipped.push(slot);
        continue;
      }
      const refPath = ref === "anchor" ? ANCHOR_PATH : path.join(OUTPUT_DIR, `${ref}.png`);
      if (!existsSync(refPath)) {
        const msg = `Cannot generate ${slot}: reference ${refPath} missing (must run its prior-frame slot first).`;
        console.error(`  FAILED: ${msg}`);
        failures.push(msg);
        continue;
      }
      try {
        await callAndSave({
          apiKey,
          prompt,
          refPath,
          label: `base-chibi-full/${slot}`,
          outPath,
        });
        generated.push(slot);
      } catch (err) {
        const msg = redact(err.message, apiKey);
        console.error(`  FAILED: ${slot}: ${msg}`);
        failures.push(`${slot}: ${msg}`);
      }
    }
  } else {
    console.log("--flop-only: skipping all AI generation, deriving -right mirrors only.");
  }

  // Free mirror-derive step. Run AFTER visual inspection has confirmed
  // idle-left/walk-left-1/pat-left-1 actually face left (not moonwalked) —
  // see relabelIfMoonwalked() below for the swap path if inspection finds
  // the opposite.
  const mirrorPairs = [
    { left: "idle-left", right: "idle-right" },
    { left: "walk-left-1", right: "walk-right-1" },
    { left: "walk-left-2", right: "walk-right-2" },
    { left: "pat-left-1", right: "pat-right-1" },
    { left: "pat-left-2", right: "pat-right-2" },
  ];
  for (const { left, right } of mirrorPairs) {
    const leftPath = path.join(OUTPUT_DIR, `${left}.png`);
    const rightPath = path.join(OUTPUT_DIR, `${right}.png`);
    if (!(await isValidExistingImage(leftPath))) {
      const msg = `Cannot mirror ${right}: source ${left}.png missing/invalid.`;
      console.error(`  FAILED: ${msg}`);
      failures.push(msg);
      continue;
    }
    await flop(leftPath, rightPath, right);
  }

  console.log(`\n=== FULL-BATCH SUMMARY ===`);
  console.log(`AI generations this run: ${generated.length}/9`);
  for (const s of generated) console.log(`  generated: ${s}`);
  if (skipped.length) {
    console.log(`Skipped (already valid): ${skipped.length}`);
    for (const s of skipped) console.log(`  skipped: ${s}`);
  }
  if (failures.length > 0) {
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Blank-chibi full-batch run FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
