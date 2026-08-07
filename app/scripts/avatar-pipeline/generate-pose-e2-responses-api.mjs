#!/usr/bin/env node
/**
 * E2-Responses-API experiment (Track 1, avatar-generation feature): final
 * test in the camera-angle series. Prior 3 attempts via OpenAI's
 * images/edits endpoint (gpt-image-1) all converged on the same wrong
 * near-eye-level framing (8 generations, 0 successes on camera angle).
 *
 * Hypothesis under test: images/edits is a thin pixel-transform path that
 * doesn't reason over the reference images. OpenAI's Responses API with the
 * image_generation TOOL is architecturally different: images are attached as
 * conversation input, the model reasons about them, then calls the
 * image-generation tool. Closer analog to ChatGPT's own UI behavior.
 *
 * Single generation. Pass/fail only. Same E2-v3 prompt verbatim, same two
 * reference images, only the API path changes.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-pose-e2-responses-api.mjs
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
const OUTPUT_PATH = path.join(OUTPUT_DIR, "bon-walk-left-e2-responses-api.png");

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

/** Recursively search a parsed JSON value for the first base64 image-like string field. */
function findImageBase64(node) {
  if (node == null) return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImageBase64(item);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node === "object") {
    // Common candidate field names across OpenAI response shapes.
    const candidateKeys = ["result", "b64_json", "image_base64", "data"];
    for (const key of candidateKeys) {
      const val = node[key];
      if (typeof val === "string" && val.length > 1000) {
        return val;
      }
    }
    for (const key of Object.keys(node)) {
      const found = findImageBase64(node[key]);
      if (found) return found;
    }
  }
  return undefined;
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

  const portraitB64 = readFileSync(PORTRAIT_IMAGE).toString("base64");
  const exemplarB64 = readFileSync(EXEMPLAR_IMAGE).toString("base64");

  const requestBody = {
    model: "gpt-4o",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: OFFSHORLY_CHIBI_PROMPT },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${portraitB64}`,
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${exemplarB64}`,
          },
        ],
      },
    ],
    tools: [{ type: "image_generation" }],
  };

  console.log(
    "E2-Responses-API: calling OpenAI Responses API (POST /v1/responses) with image_generation tool, 2 reference images, single generation..."
  );

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    const msg = redact(String(err?.message ?? err), apiKey);
    throw new Error(`Network error calling OpenAI Responses API: ${msg}`);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const msg = redact(bodyText, apiKey);
    throw new Error(
      `OpenAI Responses API error ${res.status}: ${msg}\n\n` +
        `This may indicate the Responses API / image_generation tool is not available for this ` +
        `API key or account tier. Report this honestly rather than falling back to images/edits.`
    );
  }

  const json = await res.json();

  // Locate the image_generation_call output item and extract its result (base64 image).
  let b64;
  const output = json?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item?.type === "image_generation_call" && typeof item?.result === "string") {
        b64 = item.result;
        break;
      }
    }
  }
  // Fallback: generic recursive search in case the field name/location differs.
  if (!b64) {
    b64 = findImageBase64(output ?? json);
  }

  if (!b64) {
    const debugPath = path.join(OUTPUT_DIR, "e2-responses-api-raw-response.json");
    writeFileSync(debugPath, redact(JSON.stringify(json, null, 2), apiKey));
    throw new Error(
      `OpenAI Responses API returned no extractable image data. Full response JSON ` +
        `(redacted) saved to ${debugPath} for inspection. This likely means the ` +
        `image_generation tool did not produce an image_generation_call output item ` +
        `(check for refusal, incomplete status, or unsupported tool).`
    );
  }

  const buf = Buffer.from(b64, "base64");
  writeFileSync(OUTPUT_PATH, buf);
  console.log(`E2-Responses-API: wrote result to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(`E2-Responses-API FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
