#!/usr/bin/env node
/**
 * ONE-SHOT calibration test #2 for Alex (avatar-generation feature).
 *
 * This script generates EXACTLY ONE image, then stops. It does NOT loop over
 * poses/candidates, does NOT retry, does NOT chain into further generation.
 * Refined prompt after test-1 failed camera-angle calibration. The prompt
 * text is passed to the API verbatim, unmodified.
 *
 * Input: single reference image — Alex's approved 8-view turnaround sheet
 * (passed WHOLE, not pre-cropped; prompt refers to quadrants via text).
 * Output: single image written to output/alex-calibration-test-2.png.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-alex-calibration-test-2.mjs
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
const OUTPUT_PATH = path.join(OUTPUT_DIR, "alex-calibration-test-2.png");

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

// User's refined calibration prompt, verbatim. Do not paraphrase, shorten,
// or "improve" this text.
const CALIBRATION_PROMPT = `We are recalibrating the OffshorlyChibi character generation.

IMPORTANT:
Use the supplied APPROVED 8-view Alex turnaround sheet as an IMAGE REFERENCE.
Do NOT generate Alex purely from the text description.

The turnaround sheet is the source of truth.

Generate ONLY ONE Alex character for this test.

==================================================
PRIMARY REFERENCE RULE
==================================================

Use TWO views from the approved turnaround for different purposes:

TOP-LEFT ALEX:
Use as the primary reference for:
- facial identity
- eyes
- glasses
- eyebrows
- beard/stubble
- skin tone
- clothing details

BOTTOM-LEFT ALEX:
Use as the primary reference for:
- CAMERA ANGLE
- head-to-body proportions
- overhead appearance
- body compression
- visible top surfaces
- overall OffshorlyChibi silhouette

The new image should look like the SAME 3D character model from the
turnaround sheet, simply isolated and rendered individually.

Do NOT redesign Alex.

==================================================
CAMERA — COPY THE REFERENCE, DON'T INTERPRET IT
==================================================

Do NOT invent a camera angle from the words "top-down",
"orthographic", or numerical camera degrees.

VISUALLY MATCH THE CAMERA GEOMETRY OF THE BOTTOM-LEFT ALEX.

This is critical.

The final image must show approximately the same amount of:

- top/crown of Alex's bald head
- forehead from above
- top surfaces of the shoulders
- upper torso beneath the head
- tops of the shoes
- floor surrounding the character

The oversized head should visually dominate the composition,
with the tiny body compressed underneath it.

Alex himself remains standing naturally upright.

DO NOT tilt his head downward.

CAMERA IS ABOVE THE CHARACTER.
CHARACTER IS NOT BENDING TOWARD THE FLOOR.

His eyes continue looking naturally forward into the world,
not upward toward the camera.

The bottom-left reference is the CAMERA TEMPLATE.

If the result resembles a normal eye-level character portrait,
the result is WRONG.

If very little of the bald crown is visible, the result is WRONG.

If the face is presented straight-on like an ID photo,
the result is WRONG.

==================================================
OFFSHORLYCHIBI PROPORTIONS
==================================================

Copy the proportions from the approved turnaround.

Alex must be:

- extremely compact
- squishy
- toy-like
- oversized rounded head
- tiny compressed body
- almost no visible neck
- tiny torso
- very short rounded arms
- small hands
- extremely short legs
- chunky oversized shoes

The head should visually account for roughly 55–60% of the
character's overall height.

DO NOT use realistic adult proportions.

DO NOT make the torso long.

DO NOT make the legs long.

DO NOT make the hands large.

DO NOT make Alex look like a realistic person with a large head.

He should look like a premium squishy collectible game avatar.

==================================================
FACE / IDENTITY LOCK
==================================================

Match TOP-LEFT Alex from the turnaround.

Preserve:

- completely bald head
- same head shape
- same complexion
- same rectangular black glasses
- same glasses thickness
- same eyebrows
- same relaxed/slightly tired expression
- same beard/moustache/stubble design
- same simplified nose
- same mouth

EYES ARE IMPORTANT.

His eyes MUST contain:

- clearly visible WHITE sclera
- dark iris/pupil inside the sclera
- same relaxed eyelid position
- same eye size
- same eye spacing
- same gaze character

DO NOT generate solid-black chibi eyes.

Do not change the eye construction between poses.

==================================================
SIMPLIFICATION / STYLE LOCK
==================================================

Match the approved OffshorlyChibi turnaround.

Premium soft 3D collectible character.

Use:

- rounded geometry
- soft squishy forms
- matte-to-soft-satin materials
- simplified facial construction
- simplified beard
- smooth skin
- soft studio lighting
- gentle ambient occlusion
- subtle floor/contact shadow
- clean white/light-neutral background

IMPORTANT:

Do NOT increase realism.

NO realistic pores.
NO detailed skin texture.
NO individual beard follicles.
NO realistic adult anatomy.
NO photorealistic facial rendering.

The approved turnaround is more stylized and toy-like than the
previous failed generation.

Match THAT level of simplification.

==================================================
OUTFIT LOCK
==================================================

Preserve:

- dark navy short-sleeve shirt
- four teal triangle graphics
- dark pants
- black sneakers
- light/cream shoe soles and details

Do not redesign the outfit.

==================================================
POSE
==================================================

For this calibration:

ONE neutral standing pose only.

- arms naturally relaxed
- feet planted
- no walking
- no sitting
- no hand gesture
- no leaning
- no head tilt

We are testing CHARACTER + CAMERA only.

==================================================
OUTPUT
==================================================

Generate exactly ONE Alex.

Full body.
Centered.
High resolution.
White/light neutral background.
No text.
No labels.
No additional views.
No sprite sheet.
No additional characters.

MOST IMPORTANT PRIORITY ORDER:

1. Match BOTTOM-LEFT reference camera geometry
2. Match approved OffshorlyChibi proportions
3. Match TOP-LEFT Alex facial identity
4. Maintain eye construction with visible sclera
5. Preserve outfit
6. Preserve soft simplified 3D style

DO NOT use the previously failed eye-level Alex generation as a reference.

Use the APPROVED 8-VIEW TURNAROUND as the source of truth.

Generate ONE calibration image and STOP.
Do not automatically generate another attempt.`;

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

  console.log("Calibration test 2: calling OpenAI images/edits (gpt-image-1), ONE image only...");

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
  console.log(`Calibration test 2: wrote single image to ${OUTPUT_PATH}`);
  console.log("Calibration test 2: DONE. Stopping here for review — no further generations.");
}

main().catch((err) => {
  console.error(`Calibration test 2 FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
