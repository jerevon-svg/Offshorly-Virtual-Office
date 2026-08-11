#!/usr/bin/env node
/**
 * ONE-SHOT calibration test #3 for Alex (avatar-generation feature).
 *
 * This script generates EXACTLY ONE image, then stops. It does NOT loop over
 * poses/candidates, does NOT retry, does NOT chain into further generation.
 *
 * This is a TARGETED EDIT, not a fresh generation. alex-calibration-test-2.png
 * is now the approved CHARACTER IDENTITY BASE and is edited/corrected; the
 * approved 8-view turnaround sheet is supplied as a SECONDARY reference for
 * camera angle, proportions, and OffshorlyChibi style. The prompt text is
 * passed to the API verbatim, unmodified.
 *
 * Inputs (both attached as real image inputs, image[] multipart array, in
 * this order — order matters, matching how the prompt refers to them):
 *   1. output/alex-calibration-test-2.png (PRIMARY identity base to edit)
 *   2. Alex_turnaround.png (SECONDARY reference — full 8-view sheet)
 * Output: single image written to output/alex-calibration-test-3.png.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-alex-calibration-test-3.mjs
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
const OUTPUT_DIR = path.join(__dirname, "output");
const IDENTITY_BASE_IMAGE = path.join(OUTPUT_DIR, "alex-calibration-test-2.png");
const TURNAROUND_REFERENCE_IMAGE = path.join(
  "/Users/lekoffshorly/Downloads/Employee Sprite",
  "Alex_turnaround.png"
);
const OUTPUT_PATH = path.join(OUTPUT_DIR, "alex-calibration-test-3.png");

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

// User's exact correction prompt, verbatim. Do not paraphrase, shorten,
// or "improve" this text.
const CALIBRATION_PROMPT = `Calibration Test 2 is MUCH closer and should now become the CHARACTER
IDENTITY BASE.

Do NOT regenerate Alex from scratch.

EDIT alex-calibration-test-2.png.

Also continue supplying the approved 8-view Alex turnaround as the
visual reference.

We are making targeted corrections to Calibration Test 2.

PRESERVE FROM TEST 2:
- exact Alex identity
- bald head
- glasses
- eye shape
- WHITE sclera + dark pupils
- eyebrows
- facial expression
- skin tone
- outfit
- four teal triangles
- shoes
- overall character identity

DO NOT redesign these.

==================================================
CORRECTION 1 — CAMERA MUST GO HIGHER
==================================================

The current camera is improved but STILL TOO LOW.

Move the virtual viewpoint substantially HIGHER ABOVE Alex.

Match the viewing geometry of the BOTTOM-LEFT character in the approved
8-view turnaround.

The result needs to feel like a character viewed from an overhead
virtual-office/game camera, NOT a portrait photographed slightly above
eye level.

SHOW MUCH MORE OF:
- the top/crown of the bald head
- top surfaces of shoulders
- top surface of torso
- tops of shoes

SHOW LESS OF:
- straight-on forehead
- straight-on face
- front vertical surfaces of the body

The bald crown should become one of the dominant visible surfaces.

IMPORTANT:

DO NOT make Alex bow his head.
DO NOT rotate his head downward.
DO NOT make his eyes look at the floor.

Keep Alex standing naturally and looking forward.

CHANGE THE VIEWPOINT, NOT THE CHARACTER'S HEAD POSE.

Use the BOTTOM-LEFT turnaround Alex as the visual camera target.

Do not rely on numeric camera terminology.
COPY ITS VISUAL VIEWING GEOMETRY.

==================================================
CORRECTION 2 — MAKE HIM SQUISHIER
==================================================

Calibration Test 2 is still slightly too human-proportioned.

Compress the body further.

Make:
- torso shorter
- arms shorter
- hands smaller
- legs significantly shorter
- shoulders slightly narrower
- shoes chunky but compact

Increase the visual dominance of the oversized head.

The body should feel tucked underneath the head.

Match the extreme compact proportions of the approved turnaround.

DO NOT change Alex's face to accomplish this.

==================================================
CORRECTION 3 — REDUCE REALISM
==================================================

Calibration Test 2 is too realistic compared with the approved
OffshorlyChibi turnaround.

Simplify Alex back toward the turnaround style.

Reduce:
- realistic beard follicles
- realistic skin texture
- anatomical facial detail
- realistic nose definition
- realistic wrinkles
- photographic shading

Use:
- smooth toy-like skin
- simplified beard/stubble shapes
- rounded facial geometry
- soft matte/satin material
- simplified nose
- simplified ears
- soft collectible-figure rendering

The result should look like a premium stylized 3D game avatar,
NOT a miniature realistic human.

==================================================
CRITICAL EYE LOCK
==================================================

DO NOT CHANGE THE CURRENT EYE CONSTRUCTION.

Keep:
- white sclera clearly visible
- dark pupils/irises
- relaxed eyelids
- current eye spacing
- current gaze

This is now part of Alex's locked identity.

==================================================
FINAL TARGET
==================================================

Think:

CALIBRATION TEST 2
= Alex's identity

APPROVED 8-VIEW TURNAROUND
= camera + proportions + OffshorlyChibi style

Combine them.

Do NOT invent a new Alex.

Generate ONE corrected neutral Alex only.

No sprite sheet.
No additional poses.
No walking.
No sitting.
No gestures.

STOP after generating ONE image for review.`;

async function main() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(`.env not found at ${ENV_PATH}`);
  }
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not found/empty in .env");
  }
  if (!existsSync(IDENTITY_BASE_IMAGE)) {
    throw new Error(`Identity base image not found at ${IDENTITY_BASE_IMAGE}`);
  }
  if (!existsSync(TURNAROUND_REFERENCE_IMAGE)) {
    throw new Error(`Turnaround reference image not found at ${TURNAROUND_REFERENCE_IMAGE}`);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const identityBuffer = readFileSync(IDENTITY_BASE_IMAGE);
  const identityBlob = new Blob([identityBuffer], { type: "image/png" });

  const turnaroundBuffer = readFileSync(TURNAROUND_REFERENCE_IMAGE);
  const turnaroundBlob = new Blob([turnaroundBuffer], { type: "image/png" });

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", identityBlob, "alex-calibration-test-2.png");
  form.append("image[]", turnaroundBlob, "Alex_turnaround.png");
  form.append("prompt", CALIBRATION_PROMPT);
  form.append("n", "1");
  form.append("size", "1024x1536");

  console.log("Calibration test 3: calling OpenAI images/edits (gpt-image-1), ONE image only...");

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
  console.log(`Calibration test 3: wrote single image to ${OUTPUT_PATH}`);
  console.log("Calibration test 3: DONE. Stopping here for review — no further generations.");
}

main().catch((err) => {
  console.error(`Calibration test 3 FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
