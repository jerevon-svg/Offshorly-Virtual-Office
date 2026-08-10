#!/usr/bin/env node
/**
 * PRODUCTION run (Track 1, avatar-generation feature): first full
 * end-to-end sprite-sheet generation for real employees, using the frozen
 * recipe validated across E2-v2 / validation-batch / validation-back /
 * refine-back experiments. Do not deviate from this recipe without going
 * back through master's plan.
 *
 * Frozen recipe:
 *   - OpenAI images/edits, multi-image input (gpt-image-1), for the INITIAL
 *     generation of every frame:
 *       image[0] = employee's own portrait (identity, varies per employee)
 *       image[1] = ALWAYS bon-walk-norm/left-1.png (fixed camera/scale
 *                  exemplar, same for every employee/frame, no exceptions)
 *   - Prompt = exact E2-v2 style-bible base (OFFSHORLY_CHIBI_PROMPT_BASE,
 *     identical text to generate-validation-batch.mjs /
 *     generate-validation-back.mjs), with only the final pose-instruction
 *     paragraph swapped per slot. NOT v3 wording.
 *   - Direction/pose conveyed via TEXT instruction only; exemplar image
 *     itself never changes.
 *   - N = 4 candidates per slot, always (4 independent generateOne calls).
 *   - Back-facing slots (idle-back, walk-back-1, walk-back-2, pat-back-1,
 *     pat-back-2 -> 5 per employee) get a SECOND-PASS targeted refine call
 *     (single-image images/edits, same simple prompt as
 *     generate-refine-back.mjs) applied to EACH of the 4 one-shot
 *     candidates. The 4 REFINED outputs are what land in the review folder
 *     for those slots, not the raw one-shot ones (raw kept alongside as
 *     raw-candidate-N.png for debugging only).
 *
 * 20 slots per employee (matches bon-{idle,walk,pat}-norm naming/structure):
 *   idle:  front, back, left, right              (1 frame each = 4 slots)
 *   walk:  front, back, left, right, x2 strides   (8 slots: *-1, *-2)
 *   pat:   front, back, left, right, x2 strides   (8 slots: *-1, *-2)
 *
 * Employees: bon, alex, micah (3 x 20 slots x 4 candidates = 240 base
 * generations, + up to 3 x 5 x 4 = 60 refine calls for back-facing slots).
 *
 * Output: scripts/avatar-pipeline/output/production/{employee}/{slot}/
 *         candidate-{1..4}.png (raw-candidate-{1..4}.png kept for
 *         back-facing slots as pre-refine debug copies).
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-production.mjs
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Any caught error is
 * sanitized before being written to stdout/stderr so a header/request dump
 * can't leak the key.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const EXEMPLAR_IMAGE = path.join(
  APP_ROOT,
  "src/assets/office/characters/bon-walk-norm/left-1.png"
);
const OUTPUT_ROOT = path.join(__dirname, "output", "production");
const NUM_CANDIDATES = 4;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 6; // systemic-failure circuit breaker

// --- minimal .env parser (no new dependency; file is small KEY=VALUE lines + comments) ---
function loadEnvKey(envPath, key) {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    if (k === key) {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/** Strip any substring equal to the secret from a string, defense-in-depth. */
function redact(str, secret) {
  if (!secret) return str;
  return str.split(secret).join("[REDACTED]");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shared E2-v2 prompt body (identical to generate-validation-batch.mjs /
// generate-validation-back.mjs), everything up to the final pose-instruction
// paragraph which is swapped per slot.
const OFFSHORLY_CHIBI_PROMPT_BASE = `Transform the uploaded avatar into OffshorlyChibi.

Character Style
Create a premium soft-3D chibi character with a collectible designer-toy aesthetic.
Maintain the exact identity of the original avatar while simplifying it into a cute stylized character.
The character should have: Very large rounded head (approximately 55–60% of total height), Extremely squishy proportions, Tiny compact torso, Very short legs, Very short arms, Small rounded hands, Chunky oversized shoes, Almost no visible neck, Rounded soft silhouette everywhere, Slightly padded clothing, Matte plastic / vinyl style material, Soft ambient occlusion, Studio-quality lighting, Soft ground shadow, Clean white/light gray background.
The character should feel like a premium collectible figure rather than an anime character.

Face Preservation (Highest Priority)
Preserve the person's identity as accurately as possible. Do NOT redesign the face.
Preserve: Eye shape, Eye size, Eye spacing, Eyelid position, Eyebags/undereye shadows, Eyebrow thickness, Eyebrow angle, Nose shape, Mouth shape, Smile intensity, Facial expression, Gaze direction, Face width, Chin shape, Skin tone, Hairline, Hairstyle, Hair volume, Hair flow, Hair accessories, Glasses, Beard/facial hair, Earrings, Any defining facial feature.
The face should instantly resemble the original avatar.

Eye Construction (Standardized)
Every eye must be built from a dark iris/pupil sitting inside a clearly visible white sclera, with visible upper and lower eyelid boundaries in a soft, simplified chibi style, and a natural gaze direction — proportioned to match this person's own source avatar. Never render solid black/dark chibi eyes with no visible sclera, and never let the iris/pupil fill the entire visible eye opening; white sclera must always show around it. This construction rule is standardized across every character — it does not mean every character's eyes look alike. Preserve each person's own eye shape, eyelid shape, eyebrow shape, approximate iris/pupil size, and expression (relaxed, alert, sleepy, happy, serious, etc.) from their original avatar; only the sclera+pupil+eyelid construction itself is standardized, not the eyes' identity.

Clothing
Keep clothing identical. Preserve: Colors, Materials, Patterns, Logos, Shoes, Accessories. Only simplify geometry slightly to fit the chibi style.

Two Reference Images
You are given TWO reference images. The FIRST reference image is a front portrait — take the face, hair, identity, and clothing from THIS image only.
The SECOND reference image shows the EXACT correct camera angle, character scale, proportions, and shading style to match — a 50-60 degree high-overhead near-orthographic camera, crown of the head clearly visible, character shown small within the frame with generous padding on all sides, true left-profile walking silhouette, flat matte shading, soft ground shadow. Match the SECOND image's camera angle, scale, framing, and shading exactly. Do not use the SECOND image's face or identity — only its camera/pose/scale/style.

Camera
Use a fixed high-overhead isometric camera. Approximately 50–60° downward. The character remains standing naturally. The character is NOT looking at the camera — looking naturally forward into the world; the camera creates the angle. The head must NOT tilt upward. Avoid the "looking up at viewer" look. Avoid eye-level or 3/4-front framing entirely — this is the single most common failure mode, do not repeat it.

Perspective
The top of the head should be clearly visible. Show a noticeable amount of crown of the head, hair volume, shoulders. The character should feel viewed from above. Almost approaching an orthographic camera while still retaining a small amount of perspective. Never use eye-level, low-angle, or dramatic perspective. The character must appear small within the frame, matching the SECOND reference image's scale and padding — not zoomed in close on the face/torso.

Consistency Rules
Every future OffshorlyChibi character must preserve: identical proportions, head size, body size, camera height, camera rotation, lighting, floor shadow, rendering quality, material style, scale, framing. Different characters should feel like they belong to the exact same game.

Important
When generating OffshorlyChibi, always prioritize preserving the facial likeness (from the FIRST reference image) over making the face generically cute, while keeping the camera angle, scale, and framing locked to what the SECOND reference image shows. The identity of the original person should remain immediately recognizable, and the camera/scale/shading must visually match the SECOND reference image exactly.

`;

const BACK_NO_FACE_CLAUSE =
  "true back view (not a profile, not a 3/4 view) — the character's back is fully toward the camera, showing the back/crown of the head and the full back of the hair, with NO face, eyes, nose, mouth, or ears visible anywhere in the image; hair fully covers the head from behind exactly as it would from this angle. Because no facial features are visible in this pose, identity must instead be conveyed through hairstyle, hair volume/shape, hair color, build, and clothing/shoe details matching the FIRST reference image.";

function poseSuffix(text) {
  return `Generate this exact same character, in the exact same OffshorlyChibi style, camera, and proportions as the SECOND reference image, but with the identity of the FIRST reference image, ${text} Everything about camera, lighting, scale, and background must match the SECOND reference image exactly; everything about face/hair/identity must match the FIRST reference image (except where noted above for back-facing poses, where identity comes from hair/build/clothing instead of face).`;
}

// --- 20 slot definitions (name -> pose instruction paragraph) ---
const SLOTS = {
  "idle-front": poseSuffix(
    "now in a relaxed standing idle pose, facing the camera/front direction — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, true front-facing view (not profile)."
  ),
  "idle-back": poseSuffix(
    `now in a relaxed standing idle pose, ${BACK_NO_FACE_CLAUSE} Both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, standing still (not walking).`
  ),
  "idle-left": poseSuffix(
    "now in a relaxed standing idle pose, true left profile — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, body and head oriented toward the left side of the frame."
  ),
  "idle-right": poseSuffix(
    "now in a relaxed standing idle pose, true right profile — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, body and head oriented toward the right side of the frame."
  ),
  "walk-front-1": poseSuffix(
    "now in a mid-walk-stride pose facing the camera/front direction (true front-facing view, not profile) — right foot forward and left foot back, natural walking motion, arms swinging naturally in opposition to the legs (left arm forward, right arm back)."
  ),
  "walk-front-2": poseSuffix(
    "now in a mid-walk-stride pose facing the camera/front direction (true front-facing view, not profile) — left foot forward and right foot back, the opposite stride phase from the previous frame, natural walking motion, arms swinging naturally in opposition to the legs (right arm forward, left arm back)."
  ),
  "walk-back-1": poseSuffix(
    `now walking directly AWAY from the camera, ${BACK_NO_FACE_CLAUSE} Mid-walking-stride pose, right foot forward and left foot back, arms swinging naturally in opposition to the legs.`
  ),
  "walk-back-2": poseSuffix(
    `now walking directly AWAY from the camera, ${BACK_NO_FACE_CLAUSE} Mid-walking-stride pose, left foot forward and right foot back, the opposite stride phase from the previous frame, arms swinging naturally in opposition to the legs.`
  ),
  "walk-left-1": poseSuffix(
    "now in a mid-walk-stride pose, true left profile — front leg forward and back leg trailing, natural walking motion, front arm swinging back and back arm swinging forward in opposition to the legs."
  ),
  "walk-left-2": poseSuffix(
    "now in a mid-walk-stride pose, true left profile — the opposite stride phase from the previous frame: the leg that was forward is now trailing back and the leg that was trailing is now forward, arms swinging to the opposite positions in opposition to the legs."
  ),
  "walk-right-1": poseSuffix(
    "now in a mid-walk-stride pose, true right profile — front leg forward and back leg trailing, natural walking motion, front arm swinging back and back arm swinging forward in opposition to the legs."
  ),
  "walk-right-2": poseSuffix(
    "now in a mid-walk-stride pose, true right profile — the opposite stride phase from the previous frame: the leg that was forward is now trailing back and the leg that was trailing is now forward, arms swinging to the opposite positions in opposition to the legs."
  ),
  "pat-front-1": poseSuffix(
    "now in a patting/waving gesture pose, facing the camera/front direction (true front-facing view, not profile) — one arm just beginning to raise up and forward in a patting/waving motion, elbow bent low, the other arm relaxed at the side."
  ),
  "pat-front-2": poseSuffix(
    "now in a patting/waving gesture pose, facing the camera/front direction (true front-facing view, not profile) — the same arm now at the peak of the patting/waving motion, raised higher than the previous frame, hand up near shoulder/head height, the other arm relaxed at the side."
  ),
  "pat-back-1": poseSuffix(
    `now in a patting/waving gesture pose, ${BACK_NO_FACE_CLAUSE} One arm just beginning to raise up in a patting/waving motion, elbow bent low, the other arm relaxed at the side, body standing still (not walking).`
  ),
  "pat-back-2": poseSuffix(
    `now in a patting/waving gesture pose, ${BACK_NO_FACE_CLAUSE} The same arm now at the peak of the patting/waving motion, raised higher than the previous frame, hand up near shoulder/head height, the other arm relaxed at the side, body standing still (not walking).`
  ),
  "pat-left-1": poseSuffix(
    "now in a patting/waving gesture pose, true left profile — body and head oriented toward the left side of the frame, one arm just beginning to raise up and forward in a patting/waving motion, elbow bent low, the other arm relaxed at the side."
  ),
  "pat-left-2": poseSuffix(
    "now in a patting/waving gesture pose, true left profile — body and head oriented toward the left side of the frame, the same arm now at the peak of the patting/waving motion, raised higher than the previous frame, hand up near shoulder/head height, the other arm relaxed at the side."
  ),
  "pat-right-1": poseSuffix(
    "now in a patting/waving gesture pose, true right profile — body and head oriented toward the right side of the frame, one arm just beginning to raise up and forward in a patting/waving motion, elbow bent low, the other arm relaxed at the side."
  ),
  "pat-right-2": poseSuffix(
    "now in a patting/waving gesture pose, true right profile — body and head oriented toward the right side of the frame, the same arm now at the peak of the patting/waving motion, raised higher than the previous frame, hand up near shoulder/head height, the other arm relaxed at the side."
  ),
};

const BACK_SLOTS = new Set([
  "idle-back",
  "walk-back-1",
  "walk-back-2",
  "pat-back-1",
  "pat-back-2",
]);

const SLOT_NAMES = Object.keys(SLOTS);

const EMPLOYEES = [
  { name: "bon", portrait: path.join(APP_ROOT, "src/assets/office/characters/bon.png") },
  { name: "alex", portrait: path.join(APP_ROOT, "src/assets/office/characters/alex.png") },
  { name: "micah", portrait: path.join(APP_ROOT, "src/assets/office/characters/micah.png") },
];

const REFINE_PROMPT =
  "Make this character fully back-facing — directly away from the camera, showing only the back of the head and hair with no face, ears, or facial features visible at all. Keep everything else (identity, clothing, pose, art style, lighting) exactly the same, just correct the camera/body orientation to a true straight-on back view.";

// --- HTTP helpers ---

async function callImagesEdit(apiKey, form, label) {
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    const msg = redact(String(err?.message ?? err), apiKey);
    throw new Error(`Network error calling OpenAI (${label}): ${msg}`);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const msg = redact(bodyText, apiKey);
    throw new Error(`OpenAI API error ${res.status} (${label}): ${msg}`);
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(`OpenAI response missing data[0].b64_json (${label})`);
  }
  return Buffer.from(b64, "base64");
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.error(`  [retry ${attempt}/${MAX_RETRIES}] ${label} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

async function generateOneShot(apiKey, prompt, identityBlob, identityFilename, exemplarBlob, label) {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", identityBlob, identityFilename);
  form.append("image[]", exemplarBlob, "left-1.png");
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", "1024x1024");
  return callImagesEdit(apiKey, form, label);
}

async function refineBackShot(apiKey, inputBuffer, label) {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", new Blob([inputBuffer], { type: "image/png" }), "input.png");
  form.append("prompt", REFINE_PROMPT);
  form.append("n", "1");
  form.append("size", "1024x1024");
  return callImagesEdit(apiKey, form, label);
}

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  if (!existsSync(EXEMPLAR_IMAGE)) {
    throw new Error(`Camera-angle exemplar image not found at ${EXEMPLAR_IMAGE}`);
  }
  for (const emp of EMPLOYEES) {
    if (!existsSync(emp.portrait)) {
      throw new Error(`Portrait not found for ${emp.name} at ${emp.portrait}`);
    }
  }

  mkdirSync(OUTPUT_ROOT, { recursive: true });

  const exemplarBuffer = readFileSync(EXEMPLAR_IMAGE);
  const exemplarBlob = new Blob([exemplarBuffer], { type: "image/png" });

  let consecutiveFailures = 0;
  const failures = [];
  let successCount = 0;
  let refineFailures = 0;
  let refineAttempts = 0;

  const startedAt = Date.now();

  for (const emp of EMPLOYEES) {
    const identityBuffer = readFileSync(emp.portrait);
    const identityBlob = new Blob([identityBuffer], { type: "image/png" });
    const identityFilename = `${emp.name}.png`;

    console.log(`\n=== ${emp.name}: starting 20 slots ===`);

    for (const slotName of SLOT_NAMES) {
      const slotDir = path.join(OUTPUT_ROOT, emp.name, slotName);
      mkdirSync(slotDir, { recursive: true });
      const prompt = SLOTS[slotName];
      const isBack = BACK_SLOTS.has(slotName);

      console.log(`-- ${emp.name}/${slotName} (${isBack ? "back-facing, refine pass" : "one-shot"}) --`);

      const rawBuffers = [];

      for (let i = 1; i <= NUM_CANDIDATES; i++) {
        const label = `${emp.name}/${slotName} candidate ${i}/${NUM_CANDIDATES}`;
        console.log(`  generating ${label}...`);
        try {
          const buf = await withRetry(
            () => generateOneShot(apiKey, prompt, identityBlob, identityFilename, exemplarBlob, label),
            label
          );
          rawBuffers.push(buf);
          successCount++;
          consecutiveFailures = 0;

          if (isBack) {
            const rawPath = path.join(slotDir, `raw-candidate-${i}.png`);
            writeFileSync(rawPath, buf);
          } else {
            const outPath = path.join(slotDir, `candidate-${i}.png`);
            writeFileSync(outPath, buf);
          }
        } catch (err) {
          consecutiveFailures++;
          const msg = redact(err.message, apiKey);
          console.error(`  FAILED (persistent): ${label}: ${msg}`);
          failures.push({ employee: emp.name, slot: slotName, candidate: i, stage: "one-shot", error: msg });
          rawBuffers.push(null);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(
              `\nABORTING: ${consecutiveFailures} consecutive failures detected — this looks systemic, not transient. Stopping run.`
            );
            printSummary();
            process.exit(1);
          }
        }
      }

      if (isBack) {
        for (let i = 1; i <= NUM_CANDIDATES; i++) {
          const rawBuf = rawBuffers[i - 1];
          const label = `${emp.name}/${slotName} refine ${i}/${NUM_CANDIDATES}`;
          if (!rawBuf) {
            console.error(`  skipping refine for ${label} (no raw candidate to refine)`);
            failures.push({ employee: emp.name, slot: slotName, candidate: i, stage: "refine-skipped", error: "no raw candidate" });
            continue;
          }
          refineAttempts++;
          console.log(`  refining ${label}...`);
          try {
            const refinedBuf = await withRetry(() => refineBackShot(apiKey, rawBuf, label), label);
            const outPath = path.join(slotDir, `candidate-${i}.png`);
            writeFileSync(outPath, refinedBuf);
            successCount++;
            consecutiveFailures = 0;
          } catch (err) {
            consecutiveFailures++;
            refineFailures++;
            const msg = redact(err.message, apiKey);
            console.error(`  REFINE FAILED (persistent): ${label}: ${msg}`);
            failures.push({ employee: emp.name, slot: slotName, candidate: i, stage: "refine", error: msg });
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              console.error(
                `\nABORTING: ${consecutiveFailures} consecutive failures detected — this looks systemic, not transient. Stopping run.`
              );
              printSummary();
              process.exit(1);
            }
          }
        }
      }
    }
  }

  function printSummary() {
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`\n=== PRODUCTION RUN SUMMARY (${elapsedMin} min) ===`);
    console.log(`Total successful writes: ${successCount}`);
    console.log(`Total failures: ${failures.length}`);
    console.log(`Refine attempts: ${refineAttempts}, refine failures: ${refineFailures}`);
    if (failures.length) {
      console.log(`Failure detail:`);
      for (const f of failures) {
        console.log(`  ${f.employee}/${f.slot} candidate ${f.candidate} [${f.stage}]: ${f.error}`);
      }
    }
    console.log(`Output root: ${OUTPUT_ROOT}`);
  }

  printSummary();
  if (failures.length > 0) {
    process.exitCode = 2; // partial completion, non-fatal but flagged
  }
}

main().catch((err) => {
  console.error(`Production run FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
