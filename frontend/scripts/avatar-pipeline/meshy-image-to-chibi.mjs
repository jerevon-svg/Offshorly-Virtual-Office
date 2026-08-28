#!/usr/bin/env node
/**
 * Phase 1 of the Meshy end-to-end avatar pipeline — TWO GATED IMAGE STAGES,
 * both via Meshy's Image-to-Image API (Nano Banana Pro). The approved output
 * of Stage B is the ONLY input to the later Image-to-3D step
 * (meshy-generate-employee-3d.mjs).
 *
 * Why two stages (revised 2026-08-28 after the single-stage cross-employee
 * test FAILED): feeding the head-to-shoulder identity avatar and the
 * full-body style reference in ONE call let the style image's face/hair/
 * scale bleed into a different employee (eyes enlarged, skin warmed, hair
 * thickened, head oversized). Identity conversion and body expansion are
 * therefore separated, with a human approval gate between them.
 *
 * STAGE A — identity conversion ("identity"):
 *   input : ONLY the employee's own head-to-shoulder avatar (no style ref,
 *           no other employee, no full-body image of anyone).
 *   output: the same head-and-shoulders composition re-rendered as soft
 *           polished 3D — nothing else changes. STAGE_A_RULES below.
 *   file  : <employee>-identity-3d[-suffix].png   -> HUMAN APPROVAL GATE
 *
 * STAGE B — full-body expansion ("fullbody"):
 *   input : image 1 = the APPROVED Stage-A image (identity; face and hair
 *           must remain unchanged), image 2 = the fixed global style/
 *           proportion reference (body, pose, clothing completion, framing,
 *           lighting, background ONLY).
 *   file  : <employee>-chibi-ref[-suffix].png     -> HUMAN APPROVAL GATE -> 3D
 *
 * The prompt blocks are kept separate: STAGE_A_RULES (per-person identity,
 * no style), STAGE_B_IDENTITY_RULES (image-role lock + clothing completion)
 * and GLOBAL_STYLE_RULES (fixed house style for everyone). Edit the global
 * block to change house style; never encode a person into it.
 *
 * Endpoint (docs.meshy.ai/en/api/image-to-image, read 2026-08-28):
 *   POST /openapi/v1/image-to-image
 *     { ai_model, prompt, reference_image_urls[1..5], aspect_ratio, remove_background }
 *   GET  /openapi/v1/image-to-image/:id  -> { status, progress, image_urls[], consumed_credits, expires_at }
 *   Result URLs expire (3-day retention) — downloaded immediately below.
 *
 * Run:
 *   node scripts/avatar-pipeline/meshy-image-to-chibi.mjs identity <employeeName> <headshotPath> [outputSuffix]
 *   node scripts/avatar-pipeline/meshy-image-to-chibi.mjs fullbody <employeeName> <approvedStageAPath> [outputSuffix] [styleRefImagePath]
 *     outputSuffix      — optional, e.g. "v2" -> ...-v2.png (never overwrites an existing candidate)
 *     styleRefImagePath — Stage B only; defaults to STYLE_REFERENCE_DEFAULT below.
 *
 * Output: scripts/avatar-pipeline/output/meshy-employees/<employeeName>/
 *   <base>.png        (candidate — needs human visual approval)
 *   <base>.task.json  (stage, task id, credits, timestamps — no secrets)
 * Deliberately NOT written anywhere under public/avatars/.
 *
 * SECURITY: never log/print MESHY_API_KEY. Errors are redacted before output.
 * COST: one real, paid Meshy task per run (~9 credits for nano-banana-pro).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvKey, redact } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");

const API_BASE = "https://api.meshy.ai/openapi";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const AI_MODEL = "nano-banana-pro";
// 3:4 portrait: matches the head-and-shoulders sources (Stage A) and leaves
// headroom + floor room for a full standing figure (Stage B).
const ASPECT_RATIO = "3:4";

// The one canonical GLOBAL BODY BASE shared by every employee (approved
// 2026-08-28: bon-chibi-ref-v2.png). Stage B only. Approved for geometry,
// silhouette, proportions, framing and soft-3D finish ONLY — it depicts Bon,
// and Bon's identity must never transfer to anyone else (see
// STAGE_B_IDENTITY_RULES). Supersedes the earlier Chibi_Reference.jpeg.
const STYLE_REFERENCE_DEFAULT = path.join(
  __dirname, "output", "meshy-employees", "bon", "bon-chibi-ref-v2.png",
);

// ---------------------------------------------------------------------------
// PROMPT TEMPLATES
// ---------------------------------------------------------------------------

// STAGE A — identity conversion. Single input image. Only the rendering
// medium changes; everything that identifies the person is frozen.
export const STAGE_A_RULES = `Re-render the reference image as a polished soft 3D render. This is a MEDIUM CONVERSION ONLY: flat vector illustration -> soft 3D. It is NOT a redesign, stylization, or character interpretation.

KEEP IDENTICAL TO THE REFERENCE (trace them, do not reinterpret):
- Face shape and facial proportions (jaw, cheeks, chin, forehead) — same width, same length.
- Eye SHAPE and eye SIZE exactly as drawn (if the eyes are narrow or almond-shaped, keep them narrow and almond-shaped; do not enlarge or round them), same eyelid lines, same gaze.
- Eyebrow shape, thickness, and position.
- Nose shape and size. Mouth shape and the same expression.
- Skin tone: sample the exact skin color from the reference and reproduce it; do not warm, tan, lighten, or shift the hue.
- Hairstyle exactly: same parting position, same hairline, same hair length, same hair volume and thickness, same straightness or wave, same strand grouping, same color. Do not thicken, puff up, add waves to, or restyle the hair.
- Glasses: same frame shape, size, thickness, and color, worn in the same position. No glasses if the reference has none.
- Any visible accessories exactly as shown; add none.
- Visible clothing: same garment, same colors, same pattern (e.g. keep stripes if present), same neckline.
- Cheek blush or other facial coloring if present.

COMPOSITION: keep the same head-and-shoulders framing, same camera angle (front-facing), same crop, same head position and size within the frame as the reference. Plain white or off-white background. Soft, even studio lighting.

RENDERING: smooth soft 3D surfaces with gentle shading, like a high-quality matte vinyl figure — apply this surface treatment to the existing shapes only.

DO NOT: beautify, idealize, make cuter, enlarge the eyes, round or shorten the face, add volume to the hair, change skin color, change age or gender presentation, change expression, add or remove any feature, add text, logos, props, or background objects, or impose any generic "chibi" or doll face. The person must be immediately recognizable as the exact same individual from the reference.`;

// STAGE B — image-role lock + clothing completion. Image 1 is the approved
// Stage-A identity render; image 2 is the fixed global style reference.
export const STAGE_B_IDENTITY_RULES = `IMAGE ROLES — READ FIRST:
Image 1 is the ONLY identity reference: it defines WHO this character is. Its face, hair, and clothing identity are FINAL.
Image 2 is the canonical BODY TEMPLATE: it defines ONLY body geometry, silhouette, proportions, framing, camera, lighting, background, and soft-3D finish. Image 2 shows a DIFFERENT person (a man with narrow eyes, spiky black hair, black rectangular glasses, a smile, a plain black shirt and black pants). None of those are part of this character unless image 1 has them too. Do not copy image 2's face, eye shape, hair, glasses, skin tone, expression, shirt, pants, or any identity feature. Do not average or blend the two people: transfer the person from image 1 INTO the body geometry of image 2.

IDENTITY (from image 1, reproduce exactly):
- Face length, width, jaw, cheeks, and chin — same face shape, not rounder or shorter.
- Eye shape, size, spacing, and iris color exactly as in image 1 — do not enlarge, round, or narrow the eyes.
- Eyebrow shape, thickness, and color.
- Nose and mouth shape; the exact same expression as image 1.
- Skin tone — the exact same color as image 1; do not warm, tan, or lighten it.
- Hair (or bald scalp) exactly: hairstyle, parting, hairline, length, volume, color — do not thicken, enlarge, or restyle.
- Facial hair: exactly the same shape, coverage, and density as image 1 — if image 1 shows light stubble, render light stubble, never a fuller or darker beard; if image 1 has none, add none.
- Glasses (exact frame shape, thickness, color, position) if present; none if image 1 has none.
- Visible accessories exactly as in image 1; add none.
- Visible clothing: same garment type, same colors, and the same pattern in the SAME placement and density as image 1 (e.g. a single row of shapes along the hem stays a single row along the hem — do not scatter it, repeat it, or redesign it). If the top is plain, keep it plain.

CLOTHING COMPLETION:
- Where the lower body is not visible in image 1, complete it with simple, plain, coordinated full-length pants in a neutral color that matches image 1's top, plus large rounded sneakers.
- The waist, hips, and legs must always be fully clothed.
- Do not invent text, logos, prints, patterns, accessories, or elaborate clothing details.`;

// Fixed house-style block. Identical for all employees; refers to "image 2"
// for proportions/pose/framing only.
export const GLOBAL_STYLE_RULES = `CANONICAL GEOMETRY LOCK (match image 2 as closely as possible for ALL of the following, identically for every character):
- Polished soft 3D chibi, premium collectible-toy look; smooth matte-soft surfaces with subtle soft shading — the same finish as image 2.
- Head (including hair or scalp) is approximately 46–48% of the total character height — exactly the same head-to-body ratio as image 2, for every character.
- Compact toy-like body beneath the head, the same body height and width as image 2. Shoulders visibly NARROWER than the head.
- Very short, wide, nearly invisible neck. The jaw, neck, shoulders, shirt, and torso blend into ONE continuous soft-3D sculpt — no narrow cylindrical neck, no neck stem, no seam, no gap, no floating head, no abrupt scale change. The character is sculpted as one piece, never a finished head placed onto a separate body.
- Rounded compact torso; short thick arms and legs with the same thickness as image 2; rounded mitten-like hands.
- Large chunky rounded sneakers, the same size and style as image 2.
- Pose: standing upright, front-facing, perfectly symmetrical, relaxed A-pose with both arms straight and angled about 30 degrees outward from the torso (slightly wider than image 2's arms) with clear gaps between each arm and the torso; feet slightly apart with a small gap between the legs and between the shoes.
- Alignment: head center, neck center, torso center, leg gap, and shoe gap all lie on one vertical centerline.
- Framing: identical to image 2 — same canvas, same character height, same top margin, same ground baseline, same camera distance; full body from top of head to bottom of shoes; both hands and both shoes fully visible; nothing cropped.
- Background and lighting: identical to image 2 — plain off-white studio background, soft even studio lighting, subtle soft ground shadow directly under the feet.

DO NOT include: text, letters, numbers, logos, graphics, props, extra accessories, side or three-quarter angle, tilted or dynamic pose, crossed arms, hands on hips, cropped limbs, multiple characters, or background objects.`;

export function buildStageAPrompt() {
  return STAGE_A_RULES;
}

export function buildStageBPrompt() {
  return `Create a full-body soft 3D chibi character of the person in image 1, keeping image 1's face, hair, and clothing identity unchanged, sculpted into exactly the body geometry, proportions, pose, framing, lighting, and background of image 2.

${STAGE_B_IDENTITY_RULES}

${GLOBAL_STYLE_RULES}`;
}

const STAGES = {
  identity: {
    label: "Stage A (identity conversion)",
    outputBase: (name) => `${name}-identity-3d`,
    prompt: buildStageAPrompt,
    usesStyleRef: false,
  },
  fullbody: {
    label: "Stage B (full-body expansion)",
    outputBase: (name) => `${name}-chibi-ref`,
    prompt: buildStageBPrompt,
    usesStyleRef: true,
  },
};

// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error(`Unsupported image extension "${ext}" — Meshy supports .jpg/.jpeg/.png only`);
}

function toDataUri(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:${mimeTypeFor(filePath)};base64,${buf.toString("base64")}`;
}

async function meshyFetch(apiKey, method, urlPath, body) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const message = (json && (json.message || json.error)) || `HTTP ${res.status}`;
    const err = new Error(`Meshy API error (${method} ${urlPath}): ${res.status} ${message}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function checkBalance(apiKey) {
  const data = await meshyFetch(apiKey, "GET", "/v1/balance");
  if (typeof data.balance !== "number") {
    throw new Error("Balance endpoint returned an unexpected shape (no numeric 'balance' field)");
  }
  console.log(`[meshy-chibi] Auth OK. Credit balance: ${data.balance}`);
  return data.balance;
}

async function submitImageToImage(apiKey, stage, identityPath, stylePath) {
  console.log(`[meshy-chibi] submitting ${stage.label} via Image-to-Image (${AI_MODEL})`);
  console.log(`[meshy-chibi]   image 1 (identity): ${identityPath}`);
  const refs = [toDataUri(identityPath)];
  if (stage.usesStyleRef) {
    console.log(`[meshy-chibi]   image 2 (style):    ${stylePath}`);
    refs.push(toDataUri(stylePath));
  }
  console.log("[meshy-chibi] COST WARNING: real, paid Meshy API call.");
  const result = await meshyFetch(apiKey, "POST", "/v1/image-to-image", {
    ai_model: AI_MODEL,
    prompt: stage.prompt(),
    // Order matters: the prompt refers to these as image 1 / image 2.
    reference_image_urls: refs,
    aspect_ratio: ASPECT_RATIO,
    remove_background: false,
  });
  if (!result.result) throw new Error("Image-to-Image submit response missing 'result' (task id) field");
  console.log(`[meshy-chibi] task submitted. task_id = ${result.result}`);
  return result.result;
}

async function pollImageToImage(apiKey, taskId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const task = await meshyFetch(apiKey, "GET", `/v1/image-to-image/${taskId}`);
    console.log(`[meshy-chibi]   status=${task.status} progress=${task.progress ?? "?"}`);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const msg = (task.task_error && task.task_error.message) || `task ended with status ${task.status}`;
      throw new Error(`Meshy image-to-image task ${task.status}: ${msg}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for image-to-image task ${taskId}`);
}

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${outPath}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

function usageAndExit() {
  console.error(
    [
      "Usage:",
      "  node scripts/avatar-pipeline/meshy-image-to-chibi.mjs identity <employeeName> <headshotPath> [outputSuffix]",
      "  node scripts/avatar-pipeline/meshy-image-to-chibi.mjs fullbody <employeeName> <approvedStageAPath> [outputSuffix] [styleRefImagePath]",
    ].join("\n"),
  );
  process.exit(1);
}

async function main() {
  const stageName = process.argv[2];
  const employeeName = process.argv[3];
  const identityPath = process.argv[4];
  const suffix = process.argv[5] ? `-${process.argv[5]}` : "";
  const stylePath = process.argv[6] || STYLE_REFERENCE_DEFAULT;

  const stage = STAGES[stageName];
  if (!stage || !employeeName || !identityPath) return usageAndExit();
  const required = stage.usesStyleRef ? [identityPath, stylePath] : [identityPath];
  for (const p of required) {
    if (!fs.existsSync(p)) {
      console.error(`Image not found: ${p}`);
      return usageAndExit();
    }
  }

  const outDir = path.join(__dirname, "output", "meshy-employees", employeeName);
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = `${stage.outputBase(employeeName)}${suffix}`;
  const outPath = path.join(outDir, `${baseName}.png`);
  if (fs.existsSync(outPath)) {
    console.error(`Refusing to overwrite existing candidate: ${outPath} — pass a new outputSuffix.`);
    process.exit(1);
  }

  let apiKey;
  try {
    apiKey = loadEnvKey(ENV_PATH, "MESHY_API_KEY");
  } catch (err) {
    console.error(`Failed to read .env: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
  if (!apiKey) {
    console.error("MESHY_API_KEY not found/empty in frontend/.env — cannot proceed.");
    process.exit(1);
  }

  try {
    const balanceBefore = await checkBalance(apiKey);
    const taskId = await submitImageToImage(apiKey, stage, identityPath, stylePath);
    const task = await pollImageToImage(apiKey, taskId);

    const urls = Array.isArray(task.image_urls) ? task.image_urls : [];
    if (!urls.length) throw new Error("Succeeded task has no image_urls to download");

    const bytes = await downloadFile(urls[0], outPath);
    for (let i = 1; i < urls.length; i++) {
      await downloadFile(urls[i], path.join(outDir, `${baseName}-${i}.png`));
    }

    const balanceAfter = await checkBalance(apiKey);
    const record = {
      step: "image-to-image",
      stage: stageName,
      ai_model: AI_MODEL,
      aspect_ratio: ASPECT_RATIO,
      task_id: task.id,
      consumed_credits: task.consumed_credits ?? null,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      identity_image: identityPath,
      style_reference_image: stage.usesStyleRef ? stylePath : null,
      output: outPath,
      expires_at: task.expires_at ?? null,
      finished_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(outDir, `${baseName}.task.json`), JSON.stringify(record, null, 2));

    console.log("");
    console.log(`[meshy-chibi] SUCCESS task_id=${task.id} consumed_credits=${task.consumed_credits ?? "?"}`);
    console.log(`[meshy-chibi] saved ${outPath} (${bytes} bytes)`);
    console.log(`[meshy-chibi] ${stage.label} candidate requires human visual approval before the next stage.`);
  } catch (err) {
    console.error(`[meshy-chibi] FAILED: ${redact(String(err && err.message ? err.message : err), apiKey)}`);
    if (err && err.body) console.error("[meshy-chibi] response body:", redact(JSON.stringify(err.body, null, 2), apiKey));
    process.exit(1);
  }
}

// Run only when executed directly. argv[1] may be relative and the repo path
// contains a space, so compare proper file URLs (pathToFileURL encodes " " as
// "%20" exactly like import.meta.url does) rather than string-concatenating.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
