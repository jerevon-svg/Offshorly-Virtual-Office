#!/usr/bin/env node
/**
 * E2 experiment (Track 1, avatar-generation feature): can gpt-image-1 generate a NEW pose
 * (left-facing walk frame) for an EXISTING chibi portrait, matching the OffshorlyChibi
 * style/camera/proportions used to make the original portraits?
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-pose-e2.mjs
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Any caught error is sanitized
 * before being written to stdout/stderr so a header/request dump can't leak the key.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const REFERENCE_IMAGE = path.join(
  APP_ROOT,
  "src/assets/office/characters/bon.png"
);
const OUTPUT_DIR = path.join(__dirname, "output");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "bon-walk-left-e2.png");

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

Camera
Use a fixed high-overhead isometric camera. Approximately 50–60° downward. The character remains standing naturally. The character is NOT looking at the camera — looking naturally forward into the world; the camera creates the angle. The head must NOT tilt upward. Avoid the "looking up at viewer" look.

Perspective
The top of the head should be clearly visible. Show a noticeable amount of crown of the head, hair volume, shoulders. The character should feel viewed from above. Almost approaching an orthographic camera while still retaining a small amount of perspective. Never use eye-level, low-angle, or dramatic perspective.

Consistency Rules
Every future OffshorlyChibi character must preserve: identical proportions, head size, body size, camera height, camera rotation, lighting, floor shadow, rendering quality, material style, scale, framing. Different characters should feel like they belong to the exact same game.

Animation Ready
The character should be clean enough for sprite generation. Future poses (walking, idle, patting, waving, sitting, coffee, etc.) must preserve: identical proportions, camera angle, rendering, lighting, scale. Only the pose should change.

Important
When generating OffshorlyChibi, always prioritize preserving the facial likeness over making the face generically cute. The identity of the original person should remain immediately recognizable, while keeping the same premium, soft 3D collectible aesthetic and the fixed high-overhead camera used across the entire OffshorlyChibi style.

Generate this exact same character, in the exact same OffshorlyChibi style, camera, and proportions as described above, but now in a mid-walk-stride pose — one foot forward, one foot back, natural walking motion, facing left. Everything else (identity, camera, lighting, scale, background) must remain identical to the reference image.`;

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

  const imageBuffer = readFileSync(REFERENCE_IMAGE);
  const imageBlob = new Blob([imageBuffer], { type: "image/png" });

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image", imageBlob, "bon.png");
  form.append("prompt", OFFSHORLY_CHIBI_PROMPT);
  form.append("n", "1");
  form.append("size", "1024x1024");

  console.log("E2: calling OpenAI images/edits (gpt-image-1) with bon.png reference...");

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
    throw new Error(
      "OpenAI response did not contain expected data[0].b64_json field"
    );
  }

  writeFileSync(OUTPUT_PATH, Buffer.from(b64, "base64"));
  console.log(`E2: wrote generated frame to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(`E2 FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
