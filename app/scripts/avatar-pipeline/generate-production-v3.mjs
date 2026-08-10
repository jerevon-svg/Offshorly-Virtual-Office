#!/usr/bin/env node
/**
 * PRODUCTION-V3 run: Stage 2 of the formalized two-stage architecture
 * (see masters/README.txt) — full 20-slot pose set for the 4 existing
 * employees with locked Stage-1 Masters, generated ONLY from each person's
 * own masters/{Name}_Master.png. One-hop edits only: every pose is a single
 * images/edits call against the SAME Master image. No chaining pose-to-pose,
 * no re-referencing the original raw upload, no cross-referencing another
 * person's Master.
 *
 * Reuses OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE / SLOTS / SLOT_NAMES /
 * generateOne / loadEnvKey / redact from generate-production-v2.mjs
 * unmodified (same prompt/pose wording, same single-image-edit recipe).
 *
 * Slot-reuse judgment call: all 4 Masters were generated as a moderate
 * front-left 3/4 turn, standing idle pose (see
 * output/consistency-test-from-upload/{name}.png). That is a reasonable
 * direct stand-in for idle-front (3/4-front-ish standing idle, per the
 * established judgment-call precedent) — so idle-front is copied directly
 * from the Master with no extra generation spent. The other 19 slots do not
 * cleanly match the Master's exact 3/4 angle (true front/back/left/right
 * profiles, walk strides, pat gestures) and are generated fresh, one
 * generation each, no extra candidates.
 *
 * Output: output/production-v3/{bon,alex,micah,lui}/{slot}.png
 * Does NOT touch app/src/assets/office/characters/... (live app assets) —
 * review-then-swap is a separate follow-up step.
 *
 * Standalone script. Not part of the Vite build. Run manually with:
 *   node scripts/avatar-pipeline/generate-production-v3.mjs
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Any caught error is
 * sanitized before being written to stdout/stderr so a header/request dump
 * can't leak the key.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import {
  loadEnvKey,
  redact,
  generateOne,
  OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE,
  SLOTS,
  SLOT_NAMES,
} from "./generate-production-v2.mjs";

// BUGFIX (found during resume): generate-production-v2.mjs's SLOTS object has
// NO "walk-left-1" entry — in v2 that slot is anchor-copied (the v2 anchor
// IS a walk-left pose), so the missing entry is harmless there. In v3 the
// Master is a 3/4-front idle pose, NOT a walk-left pose, so there is no
// equivalent free copy for walk-left-1. Before this fix, v3's main loop did
// `${BASE}${SLOTS["walk-left-1"]}` -> `${BASE}undefined`, producing a
// malformed prompt. Verified against output/production-v3/bon/walk-left-1.png:
// it came back as a front-facing idle pose (near-duplicate of idle-front.png),
// not a walk-left stride at all. Fix: define an explicit walk-left-1 prompt
// (mirrors walk-right-1's wording) and force-regenerate any existing
// walk-left-1.png regardless of skip-existing logic, since prior output
// under that filename is known-bad.
// Local copies of generate-production-v2.mjs's (unexported) poseSuffix()
// helper and BACK_NO_FACE_CLAUSE text — v2 doesn't export them, and this
// file must not modify v2 (v2's own SLOTS/output stay as-is; only v3 changes
// per this bugfix pass). Wording matches v2 verbatim.
function poseSuffix(text) {
  return `Now, ${text} Keep everything else (identity, clothing, art style, lighting, camera, scale) exactly the same as the input image.`;
}
const BACK_NO_FACE_CLAUSE =
  "true back view (not a profile, not a 3/4 view) — the character's back is fully toward the camera, showing the back/crown of the head, with NO face, eyes, nose, mouth, or ears visible anywhere in the image. The head covering must exactly match the input reference image: if the reference shows a bald head, this back view must also show a bald head/scalp — do NOT add hair that isn't in the reference. If the reference shows hair, show that exact hairstyle, hair color, and hair volume as it would appear from directly behind. Because no facial features are visible in this pose, identity must instead be conveyed through the correct head covering (bald scalp or matching hairstyle), build, and clothing/shoe details matching the input image.";

const WALK_LEFT_1_PROMPT_SUFFIX =
  "Now, put this character in a mid-walk-stride pose, true left profile — front leg forward and back leg trailing, natural walking motion, front arm swinging back and back arm swinging forward in opposition to the legs. Keep everything else (identity, clothing, art style, lighting, camera, scale) exactly the same as the input image.";

// BUGFIX (walk-1/walk-2 not alternating, found in the just-completed v3
// batch): visually comparing output/production-v3/{bon,alex}/walk-front-1.png
// vs walk-front-2.png shows the SAME leg forward in both frames instead of
// the opposite stride phase. Checked whether v3 weakened the wording v2 used
// — it did NOT: v3 imports generate-production-v2.mjs's SLOTS object
// unmodified (see this file's header comment), so walk-front-1/2,
// walk-back-1/2, and walk-left-2 already carry the exact same "right foot
// forward .../left foot forward..., the opposite stride phase from the
// previous frame" wording as v2. Confirmed the same failure mode exists in
// the OLDER v2 output too (output/production-v2/bon/walk-front-1/candidate-
// 1.png vs walk-front-2/candidate-1.png also show the same forward leg in
// both frames) — so there is no v2 "proven wording" state to restore; this
// wording was already unreliable in v2, not something v3 broke.
// Root cause: each walk-N call is a fresh one-hop edit of the SAME static
// Master (which isn't even mid-stride), with no image of "the other frame"
// to contrast against — the model has only abstract text ("right foot
// forward" vs "left foot forward") to tell the two calls apart, and
// gpt-image-1 doesn't reliably honor that lateral distinction from a
// standing-still reference. Mitigation (best available within the "one-hop
// edit off the Master only" constraint — chaining frame-2 off frame-1's own
// output, which would let the model literally see-and-invert the prior
// pose, is out of scope per this script's header): make the two prompts
// maximally concrete and mutually exclusive (name the exact leg bend/ground
// contact instead of relying on "opposite of the previous frame," which the
// model can't verify without seeing it) and add an explicit anti-duplicate
// instruction.
function walkFrame1(direction, extra = "") {
  return poseSuffix(
    `put this character in a mid-walk-stride pose${direction} — the leg closer to the camera's left side of the frame is planted forward with the knee slightly bent and heel touching down, the other leg is trailing behind with only the toe touching the ground; the arm on the same side as the forward leg swings back, the opposite arm swings forward. ${extra}This is walk frame 1 of a 2-frame walk cycle.`
  );
}
function walkFrame2(direction, extra = "") {
  return poseSuffix(
    `put this character in a mid-walk-stride pose${direction} — this is walk frame 2 of a 2-frame walk cycle and MUST show the reverse leg/arm configuration of frame 1: the leg that was trailing in frame 1 is now planted forward with the knee slightly bent and heel touching down, and the leg that was forward in frame 1 is now trailing behind with only the toe touching the ground; the arms swing to the opposite sides as well. Do not reuse frame 1's leg positions — the forward leg must visibly swap sides. ${extra}`
  );
}
const SLOTS_V3 = {
  ...SLOTS,
  "walk-left-1": WALK_LEFT_1_PROMPT_SUFFIX,
  "walk-front-1": walkFrame1(", facing the camera/front direction (true front-facing view, not profile)"),
  "walk-front-2": walkFrame2(", facing the camera/front direction (true front-facing view, not profile)"),
  "walk-back-1": walkFrame1(
    `, walking directly AWAY from the camera, ${BACK_NO_FACE_CLAUSE}`
  ),
  "walk-back-2": walkFrame2(
    `, walking directly AWAY from the camera, ${BACK_NO_FACE_CLAUSE}`
  ),
  "walk-left-2":
    "put this character in a mid-walk-stride pose, true left profile — this is walk frame 2 of a 2-frame walk cycle and MUST show the reverse leg/arm configuration of walk-left-1: the leg that was forward is now trailing back, and the leg that was trailing is now forward, arms swinging to the opposite positions as well. Do not reuse walk-left-1's leg positions — the forward leg must visibly swap. Keep everything else (identity, clothing, art style, lighting, camera, scale) exactly the same as the input image.",
};

// BUGFIX (found in the just-completed v3 batch): every "-right" slot
// (idle-right, walk-right-1, walk-right-2, pat-right-1, pat-right-2) was
// independently AI-generated from the Master via its own text prompt, same
// as every "-left" slot. Two AI calls with mirrored *wording* do not
// guarantee mirrored *geometry* — gpt-image-1 has no cross-call state, so
// each "-right" call is free to reinterpret pose/orientation on its own, and
// visually inspecting output/production-v3/*/idle-left.png vs idle-right.png
// confirms it: both came back facing/oriented almost identically instead of
// as true opposite profiles. (Note for the record: neither generate-
// production-v2.mjs nor any other script in this repo actually contains a
// sharp().flop()-based mirror step — grepped the whole tree, none exists.
// There was no prior "restore" to do here; this is a new fix.)
// Fix: keep AI generation for every "-left" slot only (already reliable —
// see idle-left/walk-left/pat-left output), then derive each "-right"
// counterpart deterministically by mirroring the already-generated left
// image with sharp().flop(). This guarantees a true opposite-facing profile
// by construction instead of hoping two independent AI calls agree.
const RIGHT_FROM_LEFT = {
  "idle-right": "idle-left",
  "walk-right-1": "walk-left-1",
  "walk-right-2": "walk-left-2",
  "pat-right-1": "pat-left-1",
  "pat-right-2": "pat-left-2",
};

// BUGFIX (walk-2 chaining, master-approved fix): walk-front-2/walk-left-2
// were previously one-hop edits of the SAME static Master image as every
// other slot, meaning frame 2 never actually saw frame 1 — "reverse the
// stride" was pure guesswork from text alone, which is why front/left walk
// alternation stayed unreliable even after the wording tightened above.
// Fix: for ONLY these two slots, use the freshly-generated frame-1 PNG
// (walk-front-1.png / walk-left-1.png) as the API image input instead of the
// Master, with a prompt that literally shows the model frame 1 and asks it
// to invert the stride. walk-front-1/walk-left-1 themselves stay
// Master-sourced (unchanged); walk-back-1/2 already alternate correctly
// (left untouched); walk-right-1/2 stay mirror-derived from walk-left-1/2 via
// sharp().flop() (left untouched, and now inherits this fix for free).
const CHAIN_FROM_PRIOR_FRAME = {
  "walk-front-2": "walk-front-1",
  "walk-left-2": "walk-left-1",
};
const WALK_FRAME2_CHAIN_PROMPT =
  "Here is frame 1 of this character's walk cycle. Generate frame 2: swap the stride exactly — the forward leg goes back, the trailing leg comes forward, arms swing to the opposite positions. Keep identity, clothing, art style, camera angle, scale, and lighting exactly identical to this frame — only the leg/arm positions change to the opposite stride phase.";

// BUGFIX (walk-left-2 still not alternating after the chain-off-frame-1 fix
// above, master-approved targeted fix): WALK_FRAME2_CHAIN_PROMPT's generic
// "forward/trailing" wording worked for walk-front-2 (visually confirmed)
// but not for walk-left-2 — a left-profile stride swap needs concrete
// screen-edge anchors (matching how WALK_LEFT_1_PROMPT_SUFFIX/walkFrame1
// already anchor left-profile poses via "leg closer to the camera's left
// side of frame is planted forward") plus an explicit license for a large
// change, since gpt-image-1's edit-mode preservation bias is suppressing the
// swap for this profile angle specifically. Used ONLY for walk-left-2; does
// NOT touch WALK_FRAME2_CHAIN_PROMPT (walk-front-2 keeps its working prompt
// unchanged).
const WALK_LEFT_FRAME2_CHAIN_PROMPT =
  "Here is frame 1 of a LEFT-facing walk cycle (character faces the LEFT edge of the image). In this frame one leg reaches FORWARD toward the LEFT edge (knee bent, heel down) and the other trails BACK toward the RIGHT edge (toe only). Generate frame 2, the opposite stride phase: the leg now reaching toward the LEFT edge must swing BACK toward the RIGHT edge, and the leg now trailing toward the RIGHT edge must swing FORWARD toward the LEFT edge; swap the arms to match. This is a LARGE, deliberate change to leg and arm positions — they MUST clearly differ from frame 1, not a copy. Keep ONLY identity, face, clothing, colors, art style, camera angle, and scale identical; the pose itself must change.";

// Force-regenerate ONLY walk-front-2/walk-left-2 (the two slots this chaining
// fix touches) and the mirrored "-right" slots (free sharp().flop() derives,
// no API cost — walk-right-2 must be rebuilt since its walk-left-2 source
// just changed; the other mirrors are harmless/idempotent to redo too).
// walk-front-1, walk-left-1, walk-back-1/2, and every idle/pat slot are
// already valid on disk from the earlier (completed, verified) wording-fix
// pass and must NOT be force-regenerated again here — walk-front-1/walk-left-1
// stay Master-sourced anchors per this fix's scope, and walk-back-1/2 already
// alternate correctly. This keeps the run small (2 API generations/person +
// free mirrors) instead of redoing the full walk set.
const FORCE_REGENERATE_SLOTS = new Set([
  "walk-front-2",
  "walk-left-2",
  ...Object.keys(RIGHT_FROM_LEFT),
]);

// Cheap validity check for a resumed output file: must exist, be non-trivially
// sized (rules out empty/truncated writes), and decode as a real PNG with
// square-ish chibi-render dimensions. Does not (and cannot) detect wrong-pose
// content bugs like the walk-left-1 one above — that's why that slot is
// force-regenerated separately rather than relying on this check alone.
async function isValidExistingImage(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    const stat = statSync(filePath);
    if (stat.size < 20000) return false; // real renders are >1MB; anything this small is corrupt/placeholder
    const meta = await sharp(filePath).metadata();
    return Boolean(meta.width && meta.height && meta.width > 100 && meta.height > 100);
  } catch {
    return false;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_ROOT = path.join(__dirname, "output", "production-v3");
const MASTERS_DIR = path.join(__dirname, "masters");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 6;

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

const PEOPLE = [
  { name: "bon", master: path.join(MASTERS_DIR, "Bon_Master.png") },
  { name: "alex", master: path.join(MASTERS_DIR, "Alex_Master.png") },
  { name: "micah", master: path.join(MASTERS_DIR, "Micah_Master.png") },
  { name: "lui", master: path.join(MASTERS_DIR, "Lui_Master.png") },
];

// idle-front is a direct copy of the Master (see header note); every other
// slot is generated fresh, one-hop edit off the SAME Master.
const MASTER_COPY_SLOT = "idle-front";

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  for (const person of PEOPLE) {
    if (!existsSync(person.master)) throw new Error(`Master not found for ${person.name} at ${person.master}`);
  }

  mkdirSync(OUTPUT_ROOT, { recursive: true });

  let consecutiveFailures = 0;
  const failures = [];
  let successCount = 0;
  let skippedCount = 0;
  const generated = [];
  const skipped = [];

  for (const person of PEOPLE) {
    const masterBuffer = readFileSync(person.master);
    const personDir = path.join(OUTPUT_ROOT, person.name);
    mkdirSync(personDir, { recursive: true });

    console.log(`\n=== ${person.name}: starting 20 slots (Master-only anchor, 1 generation/slot, resume-aware) ===`);

    for (const slotName of SLOT_NAMES) {
      const outPath = path.join(personDir, `${slotName}.png`);

      if (slotName === MASTER_COPY_SLOT) {
        // Free (no API call) — always (re)do to guarantee freshness/validity.
        copyFileSync(person.master, outPath);
        console.log(`-- ${person.name}/${slotName}: copied directly from Master (3/4-front-ish idle already matches) --`);
        generated.push({ person: person.name, slot: slotName, mode: "master-copy" });
        continue;
      }

      if (RIGHT_FROM_LEFT[slotName]) {
        // Mirror path (no API call): derive this "-right" frame from the
        // already-generated "-left" counterpart via sharp().flop(), which
        // guarantees a true opposite-facing profile by construction. The
        // left source must already exist on disk — SLOT_NAMES always lists
        // the "-left" variant of a pair before its "-right" counterpart, so
        // within a single run it's generated earlier in this same loop.
        const leftSlot = RIGHT_FROM_LEFT[slotName];
        const leftPath = path.join(personDir, `${leftSlot}.png`);
        const label = `${person.name}/${slotName}`;
        try {
          if (!(await isValidExistingImage(leftPath))) {
            throw new Error(
              `Cannot mirror ${slotName}: source ${leftSlot}.png missing/invalid at ${leftPath}. ` +
                `Ensure ${leftSlot} is generated (and appears earlier in SLOT_NAMES) before ${slotName}.`,
            );
          }
          const mirrored = await sharp(leftPath).flop().toBuffer();
          writeFileSync(outPath, mirrored);
          console.log(`-- ${label}: mirrored from ${leftSlot}.png via sharp().flop() (no API call) --`);
          generated.push({ person: person.name, slot: slotName, mode: "mirrored" });
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures++;
          console.error(`  FAILED (mirror): ${label}: ${err.message}`);
          failures.push({ person: person.name, slot: slotName, error: err.message });
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(`\nABORTING: ${consecutiveFailures} consecutive failures — systemic, stopping run.`);
            printSummary();
            process.exit(1);
          }
        }
        continue;
      }

      if (!FORCE_REGENERATE_SLOTS.has(slotName) && (await isValidExistingImage(outPath))) {
        console.log(`-- ${person.name}/${slotName}: SKIPPED (already present, valid) --`);
        skippedCount++;
        skipped.push({ person: person.name, slot: slotName });
        continue;
      }

      const label = `${person.name}/${slotName}`;

      try {
        // walk-front-2/walk-left-2 chain off their own frame-1 output
        // instead of the Master — see CHAIN_FROM_PRIOR_FRAME above.
        // SLOT_NAMES orders walk-front-1 before walk-front-2 and
        // walk-left-1 before walk-left-2, so the frame-1 file for this
        // person is already on disk (either freshly generated earlier in
        // this same loop, or a valid pre-existing file that was skipped
        // above) by the time we get here.
        let anchorBlob;
        let prompt;
        const priorFrameSlot = CHAIN_FROM_PRIOR_FRAME[slotName];
        if (priorFrameSlot) {
          const priorPath = path.join(personDir, `${priorFrameSlot}.png`);
          if (!(await isValidExistingImage(priorPath))) {
            throw new Error(
              `Cannot chain ${slotName}: source ${priorFrameSlot}.png missing/invalid at ${priorPath}. ` +
                `Ensure ${priorFrameSlot} is generated (and appears earlier in SLOT_NAMES) before ${slotName}.`,
            );
          }
          const priorFrameBuffer = readFileSync(priorPath);
          anchorBlob = new Blob([priorFrameBuffer], { type: "image/png" });
          prompt = slotName === "walk-left-2" ? WALK_LEFT_FRAME2_CHAIN_PROMPT : WALK_FRAME2_CHAIN_PROMPT;
          console.log(`-- ${label} (chained off ${priorFrameSlot}.png) --`);
        } else {
          // Fresh Blob per call — some fetch/FormData implementations
          // consume the underlying stream, so reuse the buffer, not a
          // shared Blob.
          anchorBlob = new Blob([masterBuffer], { type: "image/png" });
          prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${SLOTS_V3[slotName]}`;
          console.log(`-- ${label} --`);
        }

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
    console.log(`Successful (incl. Master copies): ${generated.length}`);
    console.log(`API generations: ${successCount}`);
    console.log(`Skipped (already present/valid): ${skippedCount}`);
    for (const s of skipped) {
      console.log(`  SKIPPED ${s.person}/${s.slot}`);
    }
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) {
      console.log(`  ${f.person}/${f.slot}: ${f.error}`);
    }
  }

  printSummary();
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`Production-v3 run FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
