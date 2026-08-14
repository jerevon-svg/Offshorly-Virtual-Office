#!/usr/bin/env node
/**
 * PROBE run (avatar-pipeline, blank/faceless placeholder chibi): generates
 * ONE new anchor ("BaseChibi_Master.png") plus 4 probe pose slots for the
 * separate, unrelated blank/featureless placeholder chibi figure used on the
 * map before a real employee's own avatar finishes generating.
 *
 * This is NOT a real person. There is no identity to preserve — the explicit
 * goal is the opposite: stay fully faceless/hairless/clothesless (no face,
 * no eyes, no nose, no mouth, no hair, no clothing) while matching the same
 * style TREATMENT (camera angle, lighting, proportions, chroma-key magenta
 * background, one-hop-edit technique) as the real employees' masters.
 *
 * Reuses generate-production-v2.mjs's loadEnvKey/redact/generateOne (same
 * OpenAI images/edits plumbing, retry, and .env key loading) — does not
 * reinvent the call/auth/retry logic.
 *
 * PROBE SCOPE ONLY (human-approved decision D): anchor + 4 slots
 * (idle-front, idle-back, walk-front-1, walk-front-2), ~5 paid calls total.
 * Do NOT add more slots to this file without a separate explicit go-ahead —
 * see the task instructions this script was written against.
 *
 * Output:
 *   masters/BaseChibi_Master.png (new anchor, separate from any real
 *     person's master — does not touch Bon/Alex/Micah/Lui masters)
 *   output/production-v3/base-chibi-probe/{slot}.png (separate from
 *     output/production-v3/{bon,alex,micah,lui}/ — does not touch those)
 *
 * Does NOT touch live src/assets/... or placeholder.ts — that swap only
 * happens after a full batch is separately approved.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-blank-chibi-probe.mjs
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Any caught error is
 * sanitized before being written to stdout/stderr so a header/request dump
 * can't leak the key.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { loadEnvKey, redact, generateOne } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const MASTERS_DIR = path.join(__dirname, "masters");
const PROBE_OUTPUT_DIR = path.join(__dirname, "output", "production-v3", "base-chibi-probe");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

// Reference-only input for the anchor call: an existing real-person Master,
// used SOLELY to give the model a pose/camera/proportion/style framing
// target (since gpt-image-1's images/edits endpoint requires an input
// image). The prompt below explicitly instructs the model to discard this
// reference's identity, face, hair, and clothing entirely — the reference
// contributes structure/composition only, never identity.
const STRUCTURE_REFERENCE = path.join(MASTERS_DIR, "Bon_Master.png");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Blank-preserving style-bible variant of OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE
// (generate-production-v2.mjs). Keeps the shared style/camera/perspective/
// framing/background/consistency clauses verbatim in spirit, but REMOVES
// Face Preservation, Eye Construction, and Clothing clauses entirely (this
// figure has no identity to preserve) and replaces them with an explicit
// Featureless Surface clause.
export const OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE = `Create OffshorlyChibi-Blank: a completely faceless, featureless, clothesless placeholder chibi figure — a neutral stand-in body silhouette, NOT a specific character or person.

Character Style
Create a premium soft-3D chibi character with a collectible designer-toy aesthetic, same proportions and material quality as the reference image's chibi figure. The character should have: Very large rounded head (approximately 55–60% of total height), Extremely squishy proportions, Tiny compact torso, Very short legs, Very short arms, Small rounded hands, Chunky oversized shoes, Almost no visible neck, Rounded soft silhouette everywhere, Matte plastic / vinyl style material, Soft ambient occlusion, Studio-quality lighting, NO cast/drop/ground shadow of any kind — the character must appear to float free of any shadow beneath or around it, Solid flat chroma-key background in pure magenta (#FF00FF), completely uniform with zero gradient, zero vignette, and no shadow of any kind cast onto it.
The character should feel like a premium collectible figure rather than an anime character or a specific person.

Background & Shadow (Highest Priority)
Render the character against a completely flat, solid, uniform pure magenta (#FF00FF) background — a chroma-key color that never appears anywhere on the body surface. Do NOT render any drop shadow, cast shadow, contact shadow, or ambient-occlusion shading on the ground/floor beneath or around the character. The character should read as floating cleanly over the flat color with no shadow artifact of any kind.

Featureless Surface (Highest Priority — this is the entire point of this figure)
This character must NOT have a face. Do NOT render eyes, eyebrows, a nose, a mouth, ears, or any facial feature of any kind — the entire head must be a smooth, blank, featureless dome, uniform in color and material, exactly like the rest of the body surface. Do NOT render hair, a hairline, or any hair volume/texture — the head is completely bald/smooth. Do NOT render clothing, clothing seams, fabric texture, buttons, logos, shoes-as-separate-objects, or any garment of any kind — the entire figure is a single continuous, uniform, matte, featureless body surface (like an unpainted collectible-toy blank/prototype), including the hands and feet, which should read as simple rounded shapes with no fingers, toes, or shoe details. Do NOT let any face, eyes, hair, or clothing appear anywhere in the image, even faintly or implied. Use one single uniform light neutral color (soft off-white or light gray) for the entire body surface, with no color variation between "skin," "hair," or "clothing" zones since none of those zones exist on this figure.

Camera
Keep the fixed high-overhead isometric camera. Approximately 50–60° downward. The character remains standing naturally. The character is NOT looking at the camera — facing naturally forward into the world; the camera creates the angle. The head must NOT tilt upward. Avoid the "looking up at viewer" look. Avoid eye-level or 3/4-front framing entirely unless explicitly requested below.

Perspective
Keep the top of the head clearly visible where the pose allows. Show a noticeable amount of crown of the head, shoulders. The character should feel viewed from above. Almost approaching an orthographic camera while still retaining a small amount of perspective. Never use eye-level, low-angle, or dramatic perspective. The character must appear small within the frame, matching the reference image's scale and padding — not zoomed in close on the head/torso.

Framing (Highest Priority)
The ENTIRE character must be fully inside the frame with a clearly visible margin of empty background on all four sides — top, bottom, left, right. The full crown/top of the head and both feet must be completely visible, never touching, clipped, or cropped by any edge of the image. Leave generous headroom above the crown and footroom below the feet. If the pose would otherwise run close to an edge, shrink the character slightly within the frame rather than letting any part leave the visible image area.

Consistency Rules
Preserve identical proportions, head size, body size, camera height, camera rotation, lighting, rendering quality, material style, scale, and framing across every generation of this same figure. Do not preserve or reintroduce any ground/cast shadow.

Important
The reference image shown is used ONLY for body proportion, camera angle, and material-style framing. Completely IGNORE and DISCARD that reference's face, eyes, hairstyle, hair color, clothing, colors, and identity — none of that should appear in the output. The output must be a generic, anonymous, fully featureless blank figure, not a recognizable person.

`;

function poseSuffix(text) {
  return `Now, ${text} Keep everything else (proportions, art style, lighting, camera, scale, and the fully featureless/faceless/hairless/clothesless surface) exactly the same.`;
}

const ANCHOR_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}Now, using the reference image ONLY for pose/camera/proportion framing (ignore its identity entirely), render this featureless blank chibi figure in a relaxed standing idle pose, facing the camera/front direction — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, true front-facing view (not profile). This is the master anchor image for this blank figure.`;

const IDLE_FRONT_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character in a relaxed standing idle pose, facing the camera/front direction — both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, true front-facing view (not profile)."
)}`;

const IDLE_BACK_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character in a relaxed standing idle pose, true back view (not a profile, not a 3/4 view) — the character's back is fully toward the camera, showing the back/crown of the smooth featureless head. Both feet planted on the ground, weight even, arms relaxed and hanging naturally at the sides, standing still (not walking). No face, eyes, hair, or clothing anywhere, same as every other view of this figure."
)}`;

const WALK_FRONT_1_PROMPT = `${OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE}${poseSuffix(
  "put this character in a mid-walk-stride pose facing the camera/front direction (true front-facing view, not profile) — the leg closer to the camera's left side of the frame is planted forward with the knee slightly bent and heel touching down, the other leg is trailing behind with only the toe touching the ground; the arm on the same side as the forward leg swings back, the opposite arm swings forward. This is walk frame 1 of a 2-frame walk cycle."
)}`;

const WALK_FRONT_2_CHAIN_PROMPT =
  "Here is frame 1 of this featureless blank chibi figure's walk cycle. Generate frame 2: swap the stride exactly — the forward leg goes back, the trailing leg comes forward, arms swing to the opposite positions. Keep proportions, art style, camera angle, scale, lighting, and the fully featureless/faceless/hairless/clothesless surface exactly identical to this frame — only the leg/arm positions change to the opposite stride phase. Do not add any face, eyes, hair, or clothing.";

async function callAndSave({ apiKey, prompt, refPath, label, outPath }) {
  const refBuffer = readFileSync(refPath);
  const refBlob = new Blob([refBuffer], { type: "image/png" });
  console.log(`-- ${label} --`);
  const buf = await withRetry(() => generateOne(apiKey, prompt, refBlob, label), label);
  writeFileSync(outPath, buf);
  console.log(`   saved -> ${outPath}`);
  return outPath;
}

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  if (!existsSync(STRUCTURE_REFERENCE)) {
    throw new Error(`Structure reference not found at ${STRUCTURE_REFERENCE}`);
  }

  mkdirSync(MASTERS_DIR, { recursive: true });
  mkdirSync(PROBE_OUTPUT_DIR, { recursive: true });

  const anchorPath = path.join(MASTERS_DIR, "BaseChibi_Master.png");
  const results = [];
  const failures = [];

  try {
    // 1) Anchor: new 1024x1024 magenta-background blank chibi, using an
    // existing real master ONLY as pose/camera/proportion reference.
    await callAndSave({
      apiKey,
      prompt: ANCHOR_PROMPT,
      refPath: STRUCTURE_REFERENCE,
      label: "base-chibi-probe/anchor",
      outPath: anchorPath,
    });
    results.push({ slot: "anchor", path: anchorPath });

    // 2) idle-front: one-hop edit of the new anchor.
    const idleFrontPath = path.join(PROBE_OUTPUT_DIR, "idle-front.png");
    await callAndSave({
      apiKey,
      prompt: IDLE_FRONT_PROMPT,
      refPath: anchorPath,
      label: "base-chibi-probe/idle-front",
      outPath: idleFrontPath,
    });
    results.push({ slot: "idle-front", path: idleFrontPath });

    // 3) idle-back: one-hop edit of the new anchor.
    const idleBackPath = path.join(PROBE_OUTPUT_DIR, "idle-back.png");
    await callAndSave({
      apiKey,
      prompt: IDLE_BACK_PROMPT,
      refPath: anchorPath,
      label: "base-chibi-probe/idle-back",
      outPath: idleBackPath,
    });
    results.push({ slot: "idle-back", path: idleBackPath });

    // 4) walk-front-1: one-hop edit of the new anchor.
    const walkFront1Path = path.join(PROBE_OUTPUT_DIR, "walk-front-1.png");
    await callAndSave({
      apiKey,
      prompt: WALK_FRONT_1_PROMPT,
      refPath: anchorPath,
      label: "base-chibi-probe/walk-front-1",
      outPath: walkFront1Path,
    });
    results.push({ slot: "walk-front-1", path: walkFront1Path });

    // 5) walk-front-2: chained off walk-front-1's own output (same chaining
    // technique as generate-production-v3.mjs's CHAIN_FROM_PRIOR_FRAME),
    // NOT the anchor, so frame 2 can literally see-and-invert frame 1.
    const walkFront2Path = path.join(PROBE_OUTPUT_DIR, "walk-front-2.png");
    await callAndSave({
      apiKey,
      prompt: WALK_FRONT_2_CHAIN_PROMPT,
      refPath: walkFront1Path,
      label: "base-chibi-probe/walk-front-2 (chained off walk-front-1)",
      outPath: walkFront2Path,
    });
    results.push({ slot: "walk-front-2", path: walkFront2Path });
  } catch (err) {
    const msg = redact(err.message, apiKey);
    console.error(`  FAILED: ${msg}`);
    failures.push(msg);
  }

  console.log(`\n=== PROBE SUMMARY ===`);
  console.log(`Successful calls: ${results.length}/5`);
  for (const r of results) console.log(`  ${r.slot}: ${r.path}`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log(`\nSTOP HERE — probe only. Do not run the remaining full batch without separate human review + go-ahead.`);
}

// Guard: only auto-run main() when this file is executed directly (node
// generate-blank-chibi-probe.mjs), not when imported as a module by a
// downstream script (e.g. generate-blank-chibi-full.mjs, which reuses
// OFFSHORLY_CHIBI_PROMPT_BLANK_SINGLE from this file and must NOT trigger a
// re-run of the already-approved anchor+4-slot probe just by importing it).
// Same guard pattern already used in generate-production-v2.mjs.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Blank-chibi probe run FAILED: ${err?.message ?? err}`);
    process.exit(1);
  });
}
