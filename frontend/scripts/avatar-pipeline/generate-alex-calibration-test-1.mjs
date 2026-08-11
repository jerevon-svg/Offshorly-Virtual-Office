#!/usr/bin/env node
/**
 * ONE-SHOT calibration test for Alex (avatar-generation feature).
 *
 * This script generates EXACTLY ONE image, then stops. It does NOT loop over
 * poses/candidates, does NOT retry, does NOT chain into further generation.
 * The user hand-wrote the calibration prompt below after a prior session
 * where camera-angle consistency (too-low camera reading as a normal 3/4
 * portrait instead of a high-overhead view) was the recurring hard problem.
 * The prompt text is passed to the API verbatim, unmodified.
 *
 * Input: single reference image — Alex's approved 8-view turnaround sheet.
 * Output: single image written to output/alex-calibration-test-1.png.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-alex-calibration-test-1.mjs
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
const REFERENCE_IMAGE = path.join(
  "/Users/lekoffshorly/Downloads/Employee Sprite",
  "Alex_turnaround.png"
);
const OUTPUT_DIR = path.join(__dirname, "output");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "alex-calibration-test-1.png");

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

// User's hand-crafted calibration prompt, verbatim. Do not paraphrase, shorten,
// or "improve" this text — it was deliberately written to fix a recurring
// camera-angle consistency problem from a prior session.
const CALIBRATION_PROMPT = `I want to try again and edit the avatar generation styling but this time instead of trying many poses or many characters lets try 1 first:

I want to CALIBRATE Alex before generating any more poses or sprite sheets.

Do NOT create a turnaround sheet.
Do NOT create multiple characters.
Do NOT create walking, sitting, or gestures yet.

Generate ONLY ONE full-body Alex character.

REFERENCE RULES:

The supplied Alex turnaround sheet is the CANONICAL MASTER for Alex.

Use it as the source of truth for:
- Alex's face
- skin tone
- bald head shape
- eyebrow shape
- eye construction
- glasses
- facial hair
- body proportions
- clothing
- shoes
- 3D material style
- squishiness
- camera treatment

Do NOT redesign Alex from scratch.

The goal is to reconstruct ONE character that looks as though the exact 3D model from the turnaround sheet was isolated and rendered by itself.

==================================================
IDENTITY LOCK — ALEX
==================================================

Preserve EXACTLY:

- completely bald head
- same head shape
- same skin complexion
- same rectangular black glasses
- same glasses thickness and proportions
- same eyebrow shape
- same calm/slightly tired eye expression
- same beard/moustache/stubble construction
- same nose and mouth treatment

EYES ARE CRITICAL:

Match the approved turnaround.

The eyes must have:
- clearly visible WHITE sclera
- dark iris/pupil inside the sclera
- same eyelid openness
- same slightly relaxed/tired gaze
- same eye spacing
- same eye size

DO NOT convert his eyes into solid black chibi eyes.
DO NOT eliminate the white area surrounding the pupils.

==================================================
OFFSHORLYCHIBI PROPORTIONS
==================================================

Match the turnaround sheet exactly.

Alex must be extremely compact and squishy.

- enormous rounded head
- head approximately 55–60% of total height
- almost no visible neck
- tiny compressed torso
- very short rounded arms
- tiny hands
- extremely short legs
- chunky oversized shoes
- soft vertically compressed silhouette

Do NOT make Alex taller or more normally proportioned.

He should look like the SAME collectible character model shown in the turnaround sheet.

==================================================
OUTFIT
==================================================

Preserve Alex's approved outfit exactly:

- dark navy/black short-sleeve shirt
- four teal triangle graphics across chest
- dark pants
- black sneakers
- light soles/details

Do not add or remove clothing details.

==================================================
CAMERA CALIBRATION — HIGHEST PRIORITY
==================================================

Create ONE neutral standing pose.

Use a VERY HIGH OVERHEAD 3/4 CAMERA.

The camera is physically ABOVE Alex and pointed steeply downward.

Target visual elevation:
approximately 60–70 degrees downward from horizontal.

Use weak perspective / near-orthographic projection.

The image must clearly show:

- a large amount of the TOP of Alex's bald head
- top surfaces of both shoulders
- the body compressed underneath the oversized head
- tops of the shoes
- floor visible around his feet

Alex remains standing completely upright.

DO NOT tilt his head downward to fake the angle.

DO NOT make him look at the floor.

DO NOT make him look upward at the camera.

His eyes look naturally FORWARD INTO THE WORLD while the CAMERA views him from above.

CAMERA MOVES.
CHARACTER DOES NOT TILT.

If the result looks like a normal 3/4 portrait of a figurine, the camera is too low.

If only the face/front of the head is visible and not a substantial amount of the bald crown, the camera is too low.

==================================================
POSE
==================================================

Neutral idle standing pose only.

- both feet planted
- arms relaxed naturally beside body
- no walking
- no waving
- no gestures
- no leaning
- no head tilt

I am testing CHARACTER + CAMERA consistency only.

==================================================
RENDERING
==================================================

Match the approved Alex turnaround:

- premium soft 3D collectible toy
- matte-to-soft-satin material
- soft rounded forms
- gentle ambient occlusion
- soft studio lighting
- subtle contact shadow
- white/light neutral background

Do not make it photorealistic.

==================================================
OUTPUT
==================================================

Generate ONE character only.

Full body.
Centered.
High resolution.
No text.
No labels.
No extra characters.
No sprite sheet.

This result will become the new ALEX MASTER CHARACTER if approved.

Do not proceed to other poses automatically.
Wait for me to approve the result first.`;

async function main() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(`.env not found at ${ENV_PATH}`);
  }
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not found/empty in .env");
  }
  if (!existsSync(REFERENCE_IMAGE)) {
    throw new Error(`Reference image not found at ${REFERENCE_IMAGE}`);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const inputBuffer = readFileSync(REFERENCE_IMAGE);
  const inputBlob = new Blob([inputBuffer], { type: "image/png" });

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", inputBlob, "Alex_turnaround.png");
  form.append("prompt", CALIBRATION_PROMPT);
  form.append("n", "1");
  form.append("size", "1024x1536");

  console.log("Calibration test: calling OpenAI images/edits (gpt-image-1), ONE image only...");

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });
  } catch (err) {
    const msg = redact(String(err?.message ?? err), apiKey);
    throw new Error(`Network error calling OpenAI: ${msg}`);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const msg = redact(bodyText, apiKey);
    throw new Error(`OpenAI API error ${res.status}: ${msg}`);
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI response did not contain expected data[0].b64_json field");
  }
  const buf = Buffer.from(b64, "base64");

  writeFileSync(OUTPUT_PATH, buf);
  console.log(`Calibration test: wrote single image to ${OUTPUT_PATH}`);
  console.log("Calibration test: DONE. Stopping here for review — no further generations.");
}

main().catch((err) => {
  console.error(`Calibration test FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
