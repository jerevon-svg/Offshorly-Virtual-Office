#!/usr/bin/env node
/**
 * PRODUCTION-V2 run (Track 1, avatar-generation feature): single-anchor,
 * single-generation-per-slot recipe, per user's explicit correction of the
 * earlier two-image (portrait + fixed camera exemplar) recipe.
 *
 * Corrected recipe (user-validated via generate-anchor-test.mjs):
 *   - ONE anchor image per person (their own approved walk-left pose).
 *     Bon:  output/bon-walk-left-e2v2-3.png
 *     Alex: output/alex-walk-left-e2v2-1.png
 *   - Every pose = ONE single-image images/edits call, direct edit of the
 *     anchor. No second/cross-reference image. Not chained pose-to-pose —
 *     always edits the SAME anchor file.
 *   - Prompt = OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE (style-bible wording minus
 *     the "Two Reference Images" paragraph, since there is no second image)
 *     + one target pose/angle instruction.
 *   - Exactly ONE generation per slot (n=1). No candidate variants. Per
 *     user's explicit instruction not to over-generate samples.
 *
 * 20 slots per person: idle-{front,back,left,right},
 * walk-{front,back,left,right}-{1,2}, pat-{front,back,left,right}-{1,2}.
 *
 * walk-left-1 / walk-left-2 special case: the anchor image itself IS a
 * walk-left pose, so walk-left-1 = anchor copied directly (no generation
 * spent recreating what already exists); walk-left-2 = one generation for
 * the opposite stride-phase frame.
 *
 * Output:
 *   Bon:  output/production-v2/bon/{slot}/candidate-1.png   (ambiguity: see
 *         report — Bon already has a full production/bon set built with the
 *         OLD two-image recipe; this is a NEW anchor + NEW recipe, written
 *         to a new location rather than overwriting).
 *   Alex: output/production-v2/alex/{slot}/candidate-1.png  (redo of
 *         production/alex, which had the back-facing hair-bleed bug).
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-production-v2.mjs
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Any caught error is
 * sanitized before being written to stdout/stderr so a header/request dump
 * can't leak the key.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_ROOT = path.join(__dirname, "output", "production-v2");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 6;

export function loadEnvKey(envPath, key) {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    if (k === key) return trimmed.slice(eq + 1).trim();
  }
  return undefined;
}

export function redact(str, secret) {
  if (!secret) return str;
  return str.split(secret).join("[REDACTED]");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single-image style-bible base (same wording as generate-anchor-test.mjs;
// "Two Reference Images" / camera-exemplar paragraphs dropped entirely).
export const OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE = `Transform the uploaded avatar into OffshorlyChibi.

Character Style
Create a premium soft-3D chibi character with a collectible designer-toy aesthetic.
Maintain the exact identity of the original avatar while simplifying it into a cute stylized character.
The character should have: Very large rounded head (approximately 55–60% of total height), Extremely squishy proportions, Tiny compact torso, Very short legs, Very short arms, Small rounded hands, Chunky oversized shoes, Almost no visible neck, Rounded soft silhouette everywhere, Slightly padded clothing, Matte plastic / vinyl style material, Soft ambient occlusion, Studio-quality lighting, NO cast/drop/ground shadow of any kind — the character must appear to float free of any shadow beneath or around it, Solid flat chroma-key background in pure magenta (#FF00FF), completely uniform with zero gradient, zero vignette, and no shadow of any kind cast onto it.
The character should feel like a premium collectible figure rather than an anime character.

Background & Shadow (Highest Priority)
Render the character against a completely flat, solid, uniform pure magenta (#FF00FF) background — a chroma-key color that never appears in skin, hair, or clothing. Do NOT render any drop shadow, cast shadow, contact shadow, or ambient-occlusion shading on the ground/floor beneath or around the character. The character should read as floating cleanly over the flat color with no shadow artifact of any kind.

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

Framing (Highest Priority)
The ENTIRE character must be fully inside the frame with a clearly visible margin of empty background on all four sides — top, bottom, left, right. The full crown/top of the head and both feet must be completely visible, never touching, clipped, or cropped by any edge of the image. Leave generous headroom above the crown and footroom below the feet. If the pose would otherwise run close to an edge, shrink the character slightly within the frame rather than letting any part leave the visible image area.

Consistency Rules
Preserve identical proportions, head size, body size, camera height, camera rotation, lighting, rendering quality, material style, scale, framing as the input image. Do not preserve or reintroduce any ground/cast shadow.

Important
Prioritize preserving the facial/build/clothing likeness of the input image over making the character generically cute. The identity of the original person should remain immediately recognizable in every pose where the pose itself allows it.

`;

const BACK_NO_FACE_CLAUSE =
  "true back view (not a profile, not a 3/4 view) — the character's back is fully toward the camera, showing the back/crown of the head, with NO face, eyes, nose, mouth, or ears visible anywhere in the image. The head covering must exactly match the input reference image: if the reference shows a bald head, this back view must also show a bald head/scalp — do NOT add hair that isn't in the reference. If the reference shows hair, show that exact hairstyle, hair color, and hair volume as it would appear from directly behind. Because no facial features are visible in this pose, identity must instead be conveyed through the correct head covering (bald scalp or matching hairstyle), build, and clothing/shoe details matching the input image.";

function poseSuffix(text) {
  return `Now, ${text} Keep everything else (identity, clothing, art style, lighting, camera, scale) exactly the same as the input image.`;
}

// 20 slots. walk-left-1 is handled separately (anchor copy, no generation).
export const SLOTS = {
  "idle-front": poseSuffix(
    "put this character in a relaxed standing idle pose, facing the camera/front direction — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, true front-facing view (not profile)."
  ),
  "idle-back": poseSuffix(
    `put this character in a relaxed standing idle pose, ${BACK_NO_FACE_CLAUSE} Both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, standing still (not walking).`
  ),
  "idle-left": poseSuffix(
    "put this character in a relaxed standing idle pose, true left profile — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, body and head oriented toward the left side of the frame."
  ),
  "idle-right": poseSuffix(
    "put this character in a relaxed standing idle pose, true right profile — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, body and head oriented toward the right side of the frame."
  ),
  "walk-front-1": poseSuffix(
    "put this character in a mid-walk-stride pose facing the camera/front direction (true front-facing view, not profile) — right foot forward and left foot back, natural walking motion, arms swinging naturally in opposition to the legs (left arm forward, right arm back)."
  ),
  "walk-front-2": poseSuffix(
    "put this character in a mid-walk-stride pose facing the camera/front direction (true front-facing view, not profile) — left foot forward and right foot back, the opposite stride phase from the previous frame, natural walking motion, arms swinging naturally in opposition to the legs (right arm forward, left arm back)."
  ),
  "walk-back-1": poseSuffix(
    `put this character walking directly AWAY from the camera, ${BACK_NO_FACE_CLAUSE} Mid-walking-stride pose, right foot forward and left foot back, arms swinging naturally in opposition to the legs.`
  ),
  "walk-back-2": poseSuffix(
    `put this character walking directly AWAY from the camera, ${BACK_NO_FACE_CLAUSE} Mid-walking-stride pose, left foot forward and right foot back, the opposite stride phase from the previous frame, arms swinging naturally in opposition to the legs.`
  ),
  // walk-left-1: anchor copy, no prompt needed.
  "walk-left-2": poseSuffix(
    "keep this character in the exact same true left-profile walking pose and camera angle as shown, but change to the opposite stride phase: the leg that is forward should now be trailing back and the leg that is trailing should now be forward, arms swinging to the opposite positions in opposition to the legs."
  ),
  "walk-right-1": poseSuffix(
    "put this character in a mid-walk-stride pose, true right profile — front leg forward and back leg trailing, natural walking motion, front arm swinging back and back arm swinging forward in opposition to the legs."
  ),
  "walk-right-2": poseSuffix(
    "put this character in a mid-walk-stride pose, true right profile — the opposite stride phase from the previous frame: the leg that was forward is now trailing back and the leg that was trailing is now forward, arms swinging to the opposite positions in opposition to the legs."
  ),
  "pat-front-1": poseSuffix(
    "put this character in a patting/waving gesture pose, facing the camera/front direction (true front-facing view, not profile) — one arm just beginning to raise up and forward in a patting/waving motion, elbow bent low, the other arm relaxed at the side."
  ),
  "pat-front-2": poseSuffix(
    "put this character in a patting/waving gesture pose, facing the camera/front direction (true front-facing view, not profile) — the same arm now at the peak of the patting/waving motion, raised higher than the previous frame, hand up near shoulder/head height, the other arm relaxed at the side."
  ),
  "pat-back-1": poseSuffix(
    `put this character in a patting/waving gesture pose, ${BACK_NO_FACE_CLAUSE} One arm just beginning to raise up in a patting/waving motion, elbow bent low, the other arm relaxed at the side, body standing still (not walking).`
  ),
  "pat-back-2": poseSuffix(
    `put this character in a patting/waving gesture pose, ${BACK_NO_FACE_CLAUSE} The same arm now at the peak of the patting/waving motion, raised higher than the previous frame, hand up near shoulder/head height, the other arm relaxed at the side, body standing still (not walking).`
  ),
  "pat-left-1": poseSuffix(
    "put this character in a patting/waving gesture pose, true left profile — body and head oriented toward the left side of the frame, one arm just beginning to raise up and forward in a patting/waving motion, elbow bent low, the other arm relaxed at the side."
  ),
  "pat-left-2": poseSuffix(
    "put this character in a patting/waving gesture pose, true left profile — body and head oriented toward the left side of the frame, the same arm now at the peak of the patting/waving motion, raised higher than the previous frame, hand up near shoulder/head height, the other arm relaxed at the side."
  ),
  "pat-right-1": poseSuffix(
    "put this character in a patting/waving gesture pose, true right profile — body and head oriented toward the right side of the frame, one arm just beginning to raise up and forward in a patting/waving motion, elbow bent low, the other arm relaxed at the side."
  ),
  "pat-right-2": poseSuffix(
    "put this character in a patting/waving gesture pose, true right profile — body and head oriented toward the right side of the frame, the same arm now at the peak of the patting/waving motion, raised higher than the previous frame, hand up near shoulder/head height, the other arm relaxed at the side."
  ),
};

export const SLOT_NAMES = [
  "idle-front",
  "idle-back",
  "idle-left",
  "idle-right",
  "walk-front-1",
  "walk-front-2",
  "walk-back-1",
  "walk-back-2",
  "walk-left-1", // handled via anchor copy, not generation
  "walk-left-2",
  "walk-right-1",
  "walk-right-2",
  "pat-front-1",
  "pat-front-2",
  "pat-back-1",
  "pat-back-2",
  "pat-left-1",
  "pat-left-2",
  "pat-right-1",
  "pat-right-2",
];

const BACK_SLOTS = new Set(["idle-back", "walk-back-1", "walk-back-2", "pat-back-1", "pat-back-2"]);

// Pose instruction for the ONE untested step in the real (Track 2) app
// pipeline: converting a raw uploaded photo directly into that employee's
// own "walk-left" anchor image, mirroring the wording style already used for
// walk-right-1 above (there is no walk-left-1 entry in SLOTS because that
// slot is always an anchor-copy in the validated 20-slot recipe below).
// Gated downstream by the app's existing Review step as a safety check —
// see gen-server.mjs.
export const WALK_LEFT_ANCHOR_SUFFIX = poseSuffix(
  "put this character in a mid-walk-stride pose, true left profile — front leg forward and back leg trailing, natural walking motion, front arm swinging back and back arm swinging forward in opposition to the legs."
);

const PEOPLE = [
  {
    name: "bon",
    anchor: path.join(__dirname, "output", "bon-walk-left-e2v2-3.png"),
  },
  {
    name: "alex",
    anchor: path.join(__dirname, "output", "alex-walk-left-e2v2-1.png"),
  },
];

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
  if (!b64) throw new Error(`OpenAI response missing data[0].b64_json (${label})`);
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
      if (attempt < MAX_RETRIES) await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

export async function generateOne(apiKey, prompt, anchorBlob, label) {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", anchorBlob, "anchor.png");
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", "1024x1024");
  return callImagesEdit(apiKey, form, label);
}

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  for (const person of PEOPLE) {
    if (!existsSync(person.anchor)) throw new Error(`Anchor not found for ${person.name} at ${person.anchor}`);
  }

  mkdirSync(OUTPUT_ROOT, { recursive: true });

  let consecutiveFailures = 0;
  const failures = [];
  let successCount = 0;
  const generated = [];

  for (const person of PEOPLE) {
    const anchorBuffer = readFileSync(person.anchor);
    const anchorBlob = new Blob([anchorBuffer], { type: "image/png" });

    console.log(`\n=== ${person.name}: starting 20 slots (single-anchor, 1 generation/slot) ===`);

    for (const slotName of SLOT_NAMES) {
      const slotDir = path.join(OUTPUT_ROOT, person.name, slotName);
      mkdirSync(slotDir, { recursive: true });
      const outPath = path.join(slotDir, "candidate-1.png");

      if (slotName === "walk-left-1") {
        copyFileSync(person.anchor, outPath);
        console.log(`-- ${person.name}/${slotName}: copied directly from anchor (already a walk-left pose) --`);
        generated.push({ person: person.name, slot: slotName, mode: "anchor-copy" });
        continue;
      }

      const prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${SLOTS[slotName]}`;
      const label = `${person.name}/${slotName}`;
      const isBack = BACK_SLOTS.has(slotName);
      console.log(`-- ${label} (${isBack ? "back-facing" : "one-shot"}) --`);

      try {
        const buf = await withRetry(() => generateOne(apiKey, prompt, anchorBlob, label), label);
        writeFileSync(outPath, buf);
        successCount++;
        consecutiveFailures = 0;
        generated.push({ person: person.name, slot: slotName, mode: "generated" });
      } catch (err) {
        consecutiveFailures++;
        const msg = redact(err.message, apiKey);
        console.error(`  FAILED (persistent): ${label}: ${msg}`);
        failures.push({ person: person.name, slot: slotName, error: msg });
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
    console.log(`Successful generations (incl. anchor copies): ${generated.length}`);
    console.log(`API generations: ${successCount}`);
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) {
      console.log(`  ${f.person}/${f.slot}: ${f.error}`);
    }
  }

  printSummary();
  if (failures.length > 0) process.exit(1);
}

// Guard: only auto-run main() when this file is executed directly (node
// generate-production-v2.mjs), not when imported as a module by a targeted
// one-off regen script (e.g. regen-alex-back.mjs).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Production-v2 run FAILED: ${err?.message ?? err}`);
    process.exit(1);
  });
}
