#!/usr/bin/env node
/**
 * Generates pose #13 (POSE_LIBRARY.md — "Sitting — Typing / Keyboard") for
 * the 4 existing employees with locked Stage-1 Masters. Modeled directly on
 * generate-production-v3.mjs's pattern: one-hop edits ONLY off each person's
 * own masters/{Name}_Master.png (never chained, never cross-referencing
 * another person's master), using the same fixed base prompt
 * (OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE — chroma-key background, no shadow,
 * full-frame margin) from generate-production-v2.mjs.
 *
 * 4 directional variants per person: front, back, left generated fresh via
 * the API (one call each, n=1, no candidate variants); right is derived
 * deterministically from left via sharp().flop() — same reasoning as idle's
 * left/right handling in generate-production-v3.mjs (idle's "-left" AI
 * generation is confirmed to reliably face left, unlike the confirmed
 * "moonwalk" bug that is specific to walk/pat). This is a brand-new pose with
 * no prior generation history, so it is treated like idle (mirror-from-left)
 * rather than like walk/pat (swap-and-flop) unless/until visual QA on this
 * pose's own output shows the same left/right inversion bug — if it does,
 * apply the same swap-and-flop fix used in generate-production-v3.mjs for
 * walk/pat.
 *
 * Output: output/sit-type/{bon,alex,micah,lui}/{front,back,left,right}.png
 * Does NOT touch app/src/assets/office/characters/... (live app assets) —
 * normalize-sit-type.mjs + a manual review-then-swap is a separate step.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-sit-type.mjs
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Any caught error is
 * sanitized before being written to stdout/stderr so a header/request dump
 * can't leak the key.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { loadEnvKey, redact, generateOne, OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE } from "./generate-production-v2.mjs";

function poseSuffix(text) {
  return `Now, ${text} Keep everything else (identity, clothing, art style, lighting, camera, scale) exactly the same as the input image.`;
}

// Same wording as generate-production-v2.mjs's BACK_NO_FACE_CLAUSE (not
// exported from there — kept as a local literal, matching the pattern
// generate-production-v3.mjs already uses for its own local copy).
const BACK_NO_FACE_CLAUSE =
  "true back view (not a profile, not a 3/4 view) — the character's back is fully toward the camera, showing the back/crown of the head, with NO face, eyes, nose, mouth, or ears visible anywhere in the image. The head covering must exactly match the input reference image: if the reference shows a bald head, this back view must also show a bald head/scalp — do NOT add hair that isn't in the reference. If the reference shows hair, show that exact hairstyle, hair color, and hair volume as it would appear from directly behind. Because no facial features are visible in this pose, identity must instead be conveyed through the correct head covering (bald scalp or matching hairstyle), build, and clothing/shoe details matching the input image.";

const SIT_TYPE_BODY =
  "upright-but-relaxed torso, hips as if resting on a seat, knees bent naturally, feet toward the floor. Both upper arms rest close to the sides, elbows bent approximately 90 degrees, both forearms raised forward to desk height, hands out in front at lower-chest/waist height with fingers gently curled and slightly spread as if resting on / typing on a keyboard, wrists neutral (not drooped, not raised). Focused-but-friendly neutral expression, gaze forward-down toward an implied work surface (no upward head tilt). Character only — do NOT render any chair, desk, keyboard, or other furniture/props; the character is composited onto seating and a desk later.";

export const SIT_TYPE_SLOTS = {
  "sit-type-front": poseSuffix(
    `Put this character in a seated, typing-at-a-keyboard pose, facing the camera/front direction (true front-facing view, not profile). ${SIT_TYPE_BODY}`
  ),
  "sit-type-back": poseSuffix(
    `Put this character in a seated, typing-at-a-keyboard pose, ${BACK_NO_FACE_CLAUSE} ${SIT_TYPE_BODY}`
  ),
  "sit-type-left": poseSuffix(
    `Put this character in a seated, typing-at-a-keyboard pose, true left profile — body and head oriented toward the left side of the frame. ${SIT_TYPE_BODY}`
  ),
};

const DIRECTIONS = ["front", "back", "left", "right"];

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_ROOT = path.join(__dirname, "output", "sit-type");
const MASTERS_DIR = path.join(__dirname, "masters");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 6;

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
  { name: "bon", master: path.join(MASTERS_DIR, "Bon_Master.png") },
  { name: "alex", master: path.join(MASTERS_DIR, "Alex_Master.png") },
  { name: "micah", master: path.join(MASTERS_DIR, "Micah_Master.png") },
  { name: "lui", master: path.join(MASTERS_DIR, "Lui_Master.png") },
];

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  for (const person of PEOPLE) {
    if (!existsSync(person.master)) throw new Error(`Master not found for ${person.name} at ${person.master}`);
  }

  mkdirSync(OUTPUT_ROOT, { recursive: true });

  let consecutiveFailures = 0;
  const failures = [];
  let successCount = 0;
  const generated = [];

  for (const person of PEOPLE) {
    const masterBuffer = readFileSync(person.master);
    const personDir = path.join(OUTPUT_ROOT, person.name);
    mkdirSync(personDir, { recursive: true });

    console.log(`\n=== ${person.name}: sit-type, 4 directions (Master-only anchor) ===`);

    for (const direction of DIRECTIONS) {
      const outPath = path.join(personDir, `${direction}.png`);
      const label = `${person.name}/sit-type-${direction}`;

      if (direction === "right") {
        const leftPath = path.join(personDir, "left.png");
        try {
          if (!(await isValidExistingImage(leftPath))) {
            throw new Error(`Cannot mirror sit-type-right: left.png missing/invalid at ${leftPath}.`);
          }
          const mirrored = await sharp(leftPath).flop().toBuffer();
          writeFileSync(outPath, mirrored);
          console.log(`-- ${label}: mirrored from left.png via sharp().flop() (no API call) --`);
          generated.push({ person: person.name, slot: `sit-type-${direction}`, mode: "mirrored" });
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures++;
          console.error(`  FAILED (mirror): ${label}: ${err.message}`);
          failures.push({ person: person.name, slot: `sit-type-${direction}`, error: err.message });
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(`\nABORTING: ${consecutiveFailures} consecutive failures — systemic, stopping run.`);
            printSummary();
            process.exit(1);
          }
        }
        continue;
      }

      try {
        const anchorBlob = new Blob([masterBuffer], { type: "image/png" });
        const prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${SIT_TYPE_SLOTS[`sit-type-${direction}`]}`;
        console.log(`-- ${label} --`);
        const buf = await withRetry(() => generateOne(apiKey, prompt, anchorBlob, label), label);
        writeFileSync(outPath, buf);
        successCount++;
        consecutiveFailures = 0;
        generated.push({ person: person.name, slot: `sit-type-${direction}`, mode: "generated" });
      } catch (err) {
        consecutiveFailures++;
        const msg = redact(err.message, apiKey);
        console.error(`  FAILED (persistent): ${label}: ${msg}`);
        failures.push({ person: person.name, slot: `sit-type-${direction}`, error: msg });
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`\nABORTING: ${consecutiveFailures} consecutive failures — systemic, stopping run.`);
          printSummary();
          process.exit(1);
        }
      }
    }
  }

  function printSummary() {
    console.log(`\n=== SUMMARY ===`);
    console.log(`Successful (incl. mirrors): ${generated.length}`);
    console.log(`API generations: ${successCount}`);
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) {
      console.log(`  ${f.person}/${f.slot}: ${f.error}`);
    }
  }

  printSummary();
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`generate-sit-type run FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
