#!/usr/bin/env node
/**
 * Anchor-image verification test (Track 1, avatar-generation feature).
 *
 * Supersedes the old "fixed Bon exemplar for everyone" approach that caused a
 * real bug: Alex's back-facing pose rendered with Bon's hairstyle instead of
 * Alex's own bald head, because the recipe cross-referenced a second image
 * (bon-walk-norm/left-1.png) for camera/pose exemplar on every employee.
 *
 * REVISED recipe under test:
 *   - Anchor image per person = that person's own approved good front-facing
 *     walk pose (single image, no second reference image at all).
 *   - Every new pose = ONE single-image images/edits call directly from that
 *     same anchor. Not chained from any other generated pose.
 *   - Prompt = target angle/pose instruction only, keeping the existing
 *     OffshorlyChibi style-bible wording for style/material/lighting
 *     consistency, but with the "Two Reference Images" / camera-exemplar
 *     paragraphs dropped entirely (no longer relevant, single image only).
 *
 * This script generates exactly 3 test images from the SAME anchor
 * (production/alex/walk-front-1/candidate-1.png), each an independent edit
 * call (not chained from each other):
 *   1. alex-anchor-test-back-facing.png      (the exact pose that broke before)
 *   2. alex-anchor-test-right-profile.png
 *   3. alex-anchor-test-3-4-back-right.png
 *
 * Output: scripts/avatar-pipeline/output/anchor-test/
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-anchor-test.mjs
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
const ANCHOR_IMAGE = path.join(
  __dirname,
  "output",
  "production",
  "alex",
  "walk-front-1",
  "candidate-1.png"
);
const OUTPUT_DIR = path.join(__dirname, "output", "anchor-test");

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

// Style-bible base, single-image variant: identical wording to the
// production OFFSHORLY_CHIBI_PROMPT_BASE for style/material/lighting
// consistency, but the "Two Reference Images" paragraph and all references
// to a SECOND reference image / camera exemplar are dropped (single image
// only — no cross-reference).
const OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE = `Transform the uploaded avatar into OffshorlyChibi.

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

Camera
Keep the fixed high-overhead isometric camera. Approximately 50–60° downward. The character remains standing naturally. The character is NOT looking at the camera — looking naturally forward into the world; the camera creates the angle. The head must NOT tilt upward. Avoid the "looking up at viewer" look. Avoid eye-level or 3/4-front framing entirely unless explicitly requested below.

Perspective
Keep the top of the head clearly visible where the pose allows. Show a noticeable amount of crown of the head, hair volume, shoulders. The character should feel viewed from above. Almost approaching an orthographic camera while still retaining a small amount of perspective. Never use eye-level, low-angle, or dramatic perspective. The character must appear small within the frame, matching the input image's scale and padding — not zoomed in close on the face/torso.

Consistency Rules
Preserve identical proportions, head size, body size, camera height, camera rotation, lighting, floor shadow, rendering quality, material style, scale, framing as the input image.

Important
Prioritize preserving the facial/build/clothing likeness of the input image over making the character generically cute. The identity of the original person should remain immediately recognizable in every pose where the pose itself allows it.

`;

const TEST_CASES = [
  {
    name: "alex-anchor-test-back-facing",
    pose: "make this character fully back-facing, showing only the back of the head and hair with no face, ears, or facial features visible at all — keep everything else (identity, clothing, art style, lighting) exactly the same.",
  },
  {
    name: "alex-anchor-test-right-profile",
    pose: "make this character in a full right-side profile view, walking, facing right — keep everything else (identity, clothing, art style, lighting) exactly the same.",
  },
  {
    name: "alex-anchor-test-3-4-back-right",
    pose: "make this character in a 3/4 back-right view (partially turned away from camera, mostly showing the back/side of the head) — keep everything else (identity, clothing, art style, lighting) exactly the same.",
  },
];

async function generateOne(apiKey, prompt, inputBlob, name) {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", inputBlob, "candidate-1.png");
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", "1024x1024");

  console.log(`Anchor test: calling OpenAI images/edits (gpt-image-1) for ${name}...`);

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
    throw new Error(`Network error calling OpenAI (${name}): ${msg}`);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const msg = redact(bodyText, apiKey);
    throw new Error(`OpenAI API error ${res.status} (${name}): ${msg}`);
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(`OpenAI response did not contain expected data[0].b64_json field (${name})`);
  }
  return Buffer.from(b64, "base64");
}

async function main() {
  if (!existsSync(ENV_PATH)) {
    throw new Error(`.env not found at ${ENV_PATH}`);
  }
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not found/empty in .env");
  }
  if (!existsSync(ANCHOR_IMAGE)) {
    throw new Error(`Anchor image not found at ${ANCHOR_IMAGE}`);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const inputBuffer = readFileSync(ANCHOR_IMAGE);
  const inputBlob = new Blob([inputBuffer], { type: "image/png" });

  const results = [];
  for (const testCase of TEST_CASES) {
    const fullPrompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}Now, ${testCase.pose}`;
    const buf = await generateOne(apiKey, fullPrompt, inputBlob, testCase.name);
    const outPath = path.join(OUTPUT_DIR, `${testCase.name}.png`);
    writeFileSync(outPath, buf);
    console.log(`Anchor test: wrote ${testCase.name} to ${outPath}`);
    results.push(outPath);
  }

  console.log(`Anchor test: done. Generated ${results.length} images in ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(`Anchor test FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
