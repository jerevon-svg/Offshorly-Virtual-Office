#!/usr/bin/env node
/**
 * E2-v3 experiment (Track 1, avatar-generation feature): follow-up to E2-v2
 * (generate-pose-e2v2.mjs). E2-v2 kept converging on near-eye-level/3-4-front
 * framing instead of the reference's true high-overhead near-orthographic
 * angle, even with a visual camera exemplar image. Fix under test: swap the
 * camera-description wording from "isometric"/"near-orthographic" language
 * to more explicit, forceful TRUE ORTHOGRAPHIC / PARALLEL PROJECTION
 * language (the wording the user has had success with directly in ChatGPT's
 * UI). Nothing else changes: same two-reference-image identity/camera split,
 * same style-bible content.
 *
 * Sends TWO reference images to OpenAI images/edits (gpt-image-1):
 *   1. bon.png            - front portrait, identity source
 *   2. bon-walk-norm/left-1.png - real production walk frame, camera/angle/
 *      proportion/lighting exemplar
 * via two `image[]` form fields (multi-image input is supported by the
 * images/edits endpoint).
 *
 * Generates 3 candidates (quick confirmation test, not a full 4-candidate
 * sweep like E2-v2) via 3 independent calls.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-pose-e2v3.mjs
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
const PORTRAIT_IMAGE = path.join(
  APP_ROOT,
  "src/assets/office/characters/bon.png"
);
const EXEMPLAR_IMAGE = path.join(
  APP_ROOT,
  "src/assets/office/characters/bon-walk-norm/left-1.png"
);
const OUTPUT_DIR = path.join(__dirname, "output");
const NUM_CANDIDATES = 3;

// --- minimal .env parser (no new dependency; file is 2 KEY=VALUE lines + comments) ---
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

const OFFSHORLY_CHIBI_PROMPT = `Transform the uploaded avatar into OffshorlyChibi.

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
The SECOND reference image shows the EXACT correct camera angle, character scale, proportions, and shading style to match — a true orthographic parallel-projection camera at a fixed 50-60 degree downward angle, crown of the head clearly visible, character shown small within the frame with generous padding on all sides, true left-profile walking silhouette, flat matte shading, soft ground shadow. Match the SECOND image's camera angle, scale, framing, and shading exactly. Do not use the SECOND image's face or identity — only its camera/pose/scale/style.

Camera
Use a TRUE ORTHOGRAPHIC CAMERA with PARALLEL PROJECTION — NOT a perspective or isometric camera. All parallel lines in the scene must remain perfectly parallel with zero vanishing-point convergence. Camera positioned directly overhead at a fixed 50-60° downward angle, viewing the character as if through a true architectural orthographic/parallel-projection lens, not a perspective lens. This is a technical CAD-style parallel projection, not artistic perspective. The character remains standing naturally. The character is NOT looking at the camera — looking naturally forward into the world; the camera creates the angle. The head must NOT tilt upward. Avoid the "looking up at viewer" look. Avoid eye-level or 3/4-front framing entirely — this is the single most common failure mode, do not repeat it.

Perspective
The top of the head should be clearly visible. Show a noticeable amount of crown of the head, hair volume, shoulders. The character should feel viewed from directly above through a true orthographic/parallel-projection lens, with zero perspective convergence — not an artistic perspective camera. Never use eye-level, low-angle, or dramatic perspective. The character must appear small within the frame, matching the SECOND reference image's scale and padding — not zoomed in close on the face/torso.

Consistency Rules
Every future OffshorlyChibi character must preserve: identical proportions, head size, body size, camera height, camera rotation, lighting, floor shadow, rendering quality, material style, scale, framing. Different characters should feel like they belong to the exact same game.

Important
When generating OffshorlyChibi, always prioritize preserving the facial likeness (from the FIRST reference image) over making the face generically cute, while keeping the camera angle, scale, and framing locked to what the SECOND reference image shows. The identity of the original person should remain immediately recognizable, and the camera/scale/shading must visually match the SECOND reference image exactly.

Generate this exact same character, in the exact same OffshorlyChibi style, camera, and proportions as the SECOND reference image, but with the identity of the FIRST reference image, now in a mid-walk-stride pose — one foot forward, one foot back, natural walking motion, true left profile. Everything about camera, lighting, scale, and background must match the SECOND reference image exactly; everything about face/hair/identity must match the FIRST reference image.`;

async function generateOne(apiKey, portraitBlob, exemplarBlob, index) {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", portraitBlob, "bon.png");
  form.append("image[]", exemplarBlob, "left-1.png");
  form.append("prompt", OFFSHORLY_CHIBI_PROMPT);
  form.append("n", "1");
  form.append("size", "1024x1024");

  console.log(
    `E2-v3: calling OpenAI images/edits (gpt-image-1) candidate ${index}/${NUM_CANDIDATES} with 2 reference images...`
  );

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
    throw new Error(`Network error calling OpenAI (candidate ${index}): ${msg}`);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const msg = redact(bodyText, apiKey);
    throw new Error(`OpenAI API error ${res.status} (candidate ${index}): ${msg}`);
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error(
      `OpenAI response did not contain expected data[0].b64_json field (candidate ${index})`
    );
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
  if (!existsSync(PORTRAIT_IMAGE)) {
    throw new Error(`Portrait reference image not found at ${PORTRAIT_IMAGE}`);
  }
  if (!existsSync(EXEMPLAR_IMAGE)) {
    throw new Error(`Camera-angle exemplar image not found at ${EXEMPLAR_IMAGE}`);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const portraitBuffer = readFileSync(PORTRAIT_IMAGE);
  const portraitBlob = new Blob([portraitBuffer], { type: "image/png" });
  const exemplarBuffer = readFileSync(EXEMPLAR_IMAGE);
  const exemplarBlob = new Blob([exemplarBuffer], { type: "image/png" });

  const results = [];
  for (let i = 1; i <= NUM_CANDIDATES; i++) {
    const buf = await generateOne(apiKey, portraitBlob, exemplarBlob, i);
    const outPath = path.join(OUTPUT_DIR, `bon-walk-left-e2v3-${i}.png`);
    writeFileSync(outPath, buf);
    console.log(`E2-v3: wrote candidate ${i} to ${outPath}`);
    results.push(outPath);
  }

  console.log(`E2-v3: done. Generated ${results.length} candidates in ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(`E2-v3 FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
