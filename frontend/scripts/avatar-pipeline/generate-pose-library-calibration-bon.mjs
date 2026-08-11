#!/usr/bin/env node
/**
 * Pose Library calibration run — Bon only (POSE_LIBRARY.md, calibration
 * phase). Generates the 11 non-idle poses from the Standard Pose Library,
 * each as ONE single-image images/edits call, ALWAYS from Bon's locked
 * master (masters/Bon_Master.png) — never chained pose-to-pose, never
 * cross-referencing another employee, never falling back to a raw upload.
 *
 * Prompt = OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE (imported from
 * generate-production-v2.mjs, already has the eye-construction rule) +
 * the pose's verbatim description from POSE_LIBRARY.md, worded so identity/
 * style/camera/proportions must be preserved exactly and only body/arm/
 * hand/leg position changes.
 *
 * One generation per pose (n=1). No retries across employees/batches per
 * calibration-phase instruction in POSE_LIBRARY.md — this script itself
 * still retries transient API failures per-call (existing MAX_RETRIES
 * pattern) but does not regenerate a pose that already produced output.
 *
 * Idle/Standing (pose 1) is skipped — it's the master pose itself.
 *
 * Output: output/pose-library-calibration/bon/{pose-slug}.png
 *
 * Standalone script. Run manually with:
 *   node scripts/avatar-pipeline/generate-pose-library-calibration-bon.mjs
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Errors sanitized
 * before stdout/stderr.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  loadEnvKey,
  redact,
  OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE,
  generateOne,
} from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const MASTER_PATH = path.join(__dirname, "masters", "Bon_Master.png");
const OUTPUT_DIR = path.join(__dirname, "output", "pose-library-calibration", "bon");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function poseSuffix(text) {
  return `Now, ${text} Keep everything else about this character — identity, face, eyes, hairstyle, glasses/facial hair, clothing, colors, body proportions, art style, lighting, and camera angle/framing — exactly the same as the input master image. Only the body/arm/hand/leg position described above should change.`;
}

// Verbatim pose descriptions from POSE_LIBRARY.md (poses 2-12; pose 1 Idle
// is the master itself and is skipped).
const POSES = [
  {
    slug: "walking-a",
    text:
      "put this character into Walking A: the first walk-cycle frame — one leg forward, opposite arm forward, small compact stride, front foot lifted/entering contact, mostly upright, no exaggerated running or torso rotation. A cute casual office step.",
  },
  {
    slug: "walking-b",
    text:
      "put this character into Walking B: the opposite frame from Walking A — reversed leg/arm positions, same stride length/height/posture/scale, so A and B alternate cleanly as one walking cycle.",
  },
  {
    slug: "sitting-neutral",
    text:
      "put this character into Sitting Neutral: upright-but-relaxed torso, hips as if resting on a seat, knees bent naturally, feet toward the floor, hands relaxed near the thighs/lap, neutral expression. Character only — do NOT generate any furniture (no chair, sofa, or bench) — the seated character will be composited onto seating objects later.",
  },
  {
    slug: "talking-a",
    text:
      "put this character into Talking A: standing, one arm slightly raised with a naturally bent elbow, open relaxed palm, casual \"explaining something\" gesture, other arm relaxed, slightly engaged/friendly expression. Keep it subtle.",
  },
  {
    slug: "talking-b",
    text:
      "put this character into Talking B: second conversational frame — both forearms slightly raised, elbows bent, hands slightly open/outward, relaxed shoulders, friendly expression, alternating with Talking A. Not a dramatic speech gesture.",
  },
  {
    slug: "shrug",
    text:
      "put this character into a Shrug: both elbows bent, forearms raised slightly outward, palms angled upward, shoulders subtly raised, small relaxed hands, optional very slight head movement, mild curious/uncertain expression. Keep cute and compact — do not exaggerate the arms/hands.",
  },
  {
    slug: "thinking",
    text:
      "put this character into Thinking: one elbow bent, hand gently near/touching the chin, other arm relaxed, head may tilt very slightly, eyes may look up/sideways subtly, thoughtful neutral expression. No dramatic face change — the character must stay immediately recognizable.",
  },
  {
    slug: "listening",
    text:
      "put this character into Listening: mostly neutral stand, arms relaxed, slightly attentive posture, very subtle forward attention, eyes focused toward an implied speaker off to the side, neutral/friendly listening expression. Intentionally very little movement from the idle pose.",
  },
  {
    slug: "greeting-wave",
    text:
      "put this character into Greeting/Wave: one arm raised beside the upper body/head, elbow bent naturally, open hand, palm facing outward, other arm relaxed, friendly expression. Keep the hand proportional to the master — do not enlarge it just to read more clearly as a wave.",
  },
  {
    slug: "pointing",
    text:
      "put this character into Pointing: one arm extends slightly outward (elbow may stay slightly bent), hand indicates a clear direction, other arm relaxed, mostly upright, small engaged expression. Do not stretch the arm — maintain the short chibi limb proportions.",
  },
  {
    slug: "coffee-hold",
    text:
      "put this character into Coffee/Object Hold: one elbow bent naturally, one hand at chest/upper-waist height shaped to hold a small coffee cup, other arm relaxed, upright and casual posture. Place a small coffee cup/mug naturally into the prepared hand position.",
  },
];

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  if (!existsSync(MASTER_PATH)) throw new Error(`Bon master not found at ${MASTER_PATH}`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const masterBuffer = readFileSync(MASTER_PATH);
  const masterBlob = new Blob([masterBuffer], { type: "image/png" });

  console.log(`=== Bon pose-library calibration: ${POSES.length} poses, single-hop from master ===`);

  const results = [];
  const failures = [];

  for (const pose of POSES) {
    const label = `bon/${pose.slug}`;
    const outPath = path.join(OUTPUT_DIR, `${pose.slug}.png`);
    const prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${poseSuffix(pose.text)}`;

    console.log(`-- ${label} --`);

    let lastErr;
    let done = false;
    for (let attempt = 1; attempt <= MAX_RETRIES && !done; attempt++) {
      try {
        // Always generate from the master blob directly (fresh one-hop
        // edit each time) — never chain from a previously generated pose.
        const buf = await generateOne(apiKey, prompt, masterBlob, label);
        writeFileSync(outPath, buf);
        results.push({ slug: pose.slug, outPath });
        done = true;
      } catch (err) {
        lastErr = err;
        const msg = redact(String(err?.message ?? err), apiKey);
        console.error(`  [retry ${attempt}/${MAX_RETRIES}] ${label} failed: ${msg}`);
        if (attempt < MAX_RETRIES) await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
    if (!done) {
      const msg = redact(String(lastErr?.message ?? lastErr), apiKey);
      console.error(`  FAILED (persistent): ${label}: ${msg}`);
      failures.push({ slug: pose.slug, error: msg });
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Generated: ${results.length}/${POSES.length}`);
  for (const r of results) console.log(`  ${r.slug} -> ${r.outPath}`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) console.log(`  ${f.slug}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Bon pose-library calibration run FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
