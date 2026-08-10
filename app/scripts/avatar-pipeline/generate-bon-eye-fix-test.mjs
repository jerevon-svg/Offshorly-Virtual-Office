#!/usr/bin/env node
/**
 * ONE-SHOT eye-fix test for Bon (avatar-generation feature).
 *
 * This script generates EXACTLY ONE image, then stops. It does NOT loop over
 * poses/candidates, does NOT retry, does NOT chain into further generation.
 *
 * PURPOSE: Bon's existing anchor image predates the new permanent
 * eye-construction rule added to the production prompt template. His eyes
 * currently render as solid/dark almond shapes with only a tiny white
 * highlight dot — no visible white sclera around the dark iris/pupil. This
 * is a TARGETED, surface-level edit test (eyes only) to check feasibility
 * before committing to full-set regeneration for Bon and Lui.
 *
 * Input: output/bon-walk-left-e2v2-3.png (single image, images/edits call).
 * Output: single image written to output/bon-eye-fix-test-1.png.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-bon-eye-fix-test.mjs
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
const ANCHOR_IMAGE = path.join(OUTPUT_DIR, "bon-walk-left-e2v2-3.png");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "bon-eye-fix-test-1.png");

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

const EYE_FIX_PROMPT = `Edit this character's eyes only.

Currently his eyes render as solid dark almond shapes with only a tiny white
highlight dot near the top — there is no visible white sclera area around the
dark iris/pupil.

Give the eyes a clearly visible white sclera surrounding a dark iris/pupil,
with visible upper and lower eyelid boundaries, in the same soft simplified
chibi style as the rest of the character. Do not make the eyes solid
black/dark with no visible white area — there must be visible white sclera
around the dark pupil.

Keep the gaze direction, eye shape, eyelid shape, and eyebrow shape the same
as they currently are — only fix the sclera/pupil construction.

Do NOT change anything else about the character: keep the exact same face
shape, hair, glasses, facial hair, skin tone, clothing, body proportions,
pose, camera angle, lighting, and background exactly as they currently are.

This is a targeted eye-construction fix only.`;

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

  const anchorBuffer = readFileSync(ANCHOR_IMAGE);
  const anchorBlob = new Blob([anchorBuffer], { type: "image/png" });

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", anchorBlob, "bon-walk-left-e2v2-3.png");
  form.append("prompt", EYE_FIX_PROMPT);
  form.append("n", "1");
  form.append("size", "1024x1536");

  console.log("Eye-fix test: calling OpenAI images/edits (gpt-image-1), ONE image only...");

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
  console.log(`Eye-fix test: wrote single image to ${OUTPUT_PATH}`);
  console.log("Eye-fix test: DONE. Stopping here for review — no further generations.");
}

main().catch((err) => {
  console.error(`Eye-fix test FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
