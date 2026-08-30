#!/usr/bin/env node
/**
 * Reusable per-employee Meshy 3D pipeline: Image-to-3D -> Remesh -> Rigging.
 *
 * Generalizes the throwaway single-purpose scripts (meshy-connection-test.mjs,
 * meshy-remesh-and-rig.mjs, both hardcoded to Alex's task) into one script
 * parameterized by employee name + input chibi master image, now that a
 * second real employee (Jerevon/"Bon") is going through this pipeline.
 *
 * Run:
 *   node scripts/avatar-pipeline/meshy-generate-employee-3d.mjs <employeeName> <imagePath> [--stop-after=image-to-3d]
 *
 *   --from-image-to-3d-task=<taskId>  (added 2026-08-28) RESUME from an already
 *   SUCCEEDED Image-to-3D task: Phase 1 is skipped entirely (no 30-credit
 *   call), the task is fetched read-only and fed to Phase 2.
 *   --stop-after=remesh  run through Phase 2 only (5 credits), download every
 *   returned remesh artifact and write <employeeName>-remesh.task.json, then
 *   exit before Rigging. Combine with --from-image-to-3d-task for a pure
 *   remesh validation run.
 *
 *   --from-remesh-task=<taskId>  (added 2026-08-28) RESUME from an already
 *   SUCCEEDED Remesh task: Phases 1 and 2 are skipped entirely (no 30+5
 *   credit calls), the task is fetched read-only and fed to Phase 3
 *   (Rigging, 5 credits). Rig outputs are named <name>-rigged.glb/.fbx,
 *   <name>-rigged-walking.glb, <name>-rigged-running.glb (+ -armature / .fbx
 *   variants) and a <name>-rig.task.json is written.
 *
 *   --stop-after=image-to-3d  (added 2026-08-28) run ONLY Phase 1 (30 credits),
 *   download every returned artifact (all model_urls, texture_urls,
 *   thumbnails) and write <employeeName>-image-to-3d.task.json, then exit
 *   before Remesh/Rigging so the raw model can be human-reviewed first.
 *   Phase 1 now sends ai_model:"latest", pose_mode:"a-pose",
 *   texture_resolution:"2k", should_remesh:false (remesh stays a separate,
 *   proven phase) and multi_view_thumbnails:true (free preview renders).
 *
 * Flow (mirrors the already-validated Alex run, same endpoints/fields):
 *   1. GET /openapi/v1/balance - confirm key valid before spending credits.
 *   2. POST /openapi/v1/image-to-3d with the chibi master image (base64 data
 *      URI), poll to SUCCEEDED, download model_urls.glb.
 *   3. POST /openapi/v2/remesh (falls back to v1 on 404) with
 *      input_task_id = the image-to-3d task, target_polycount=300000 (under
 *      Meshy's 320k rigging face-limit), poll, download.
 *   4. POST /openapi/v1/rigging with input_task_id = the REMESHED task,
 *      poll, download rigged_character_glb_url + any bundled
 *      basic_animations GLB(s) (walk/run come free with rigging).
 *
 * Output: scripts/avatar-pipeline/output/meshy-employees/<employeeName>/
 *   {employeeName}-raw.glb, {employeeName}-remeshed.glb,
 *   {employeeName}-rigged.glb, {employeeName}-basic-<animName>.glb
 *
 * SECURITY: never log/print process.env.MESHY_API_KEY / the loaded key.
 * Any caught error is redacted before being written to stdout/stderr.
 *
 * COST WARNING: this submits THREE real, paid Meshy tasks in sequence
 * (Image-to-3D, Remesh, Rigging) — roughly ~40 credits total based on the
 * Alex run (30 + 5 + 5). Each phase only proceeds if the previous phase
 * clearly SUCCEEDED; on FAILED/CANCELED/error the script stops immediately
 * and does not retry or proceed to the next phase.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvKey, redact } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");

const API_BASE = "https://api.meshy.ai/openapi";
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
// 280k leaves margin under Meshy's 300,000-face rigging cap (docs re-read
// 2026-08-28; the earlier 300k target produced 301,293 tris).
const TARGET_POLYCOUNT = 280_000;
// Meshy's image-to-3d pose_mode enum. "a-pose" was the proven Alex/Bon-v2/
// Micah-v2 setting; --pose-mode=t-pose (added 2026-08-30) is required when the
// source master is itself a true horizontal T-pose (bon-v3 onward), since
// asking for a-pose from a T-pose reference makes Meshy re-pose the arms.
const POSE_MODES = ["a-pose", "t-pose", "default"];
const DEFAULT_POSE_MODE = "a-pose";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  throw new Error(`Unsupported image extension "${ext}" — Meshy supports .jpg/.jpeg/.png only`);
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
  console.log("[meshy-employee] checking auth via GET /openapi/v1/balance ...");
  const data = await meshyFetch(apiKey, "GET", "/v1/balance");
  if (typeof data.balance !== "number") {
    throw new Error("Balance endpoint returned an unexpected shape (no numeric 'balance' field)");
  }
  console.log(`[meshy-employee] Auth OK. Current credit balance: ${data.balance}`);
  return data.balance;
}

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${outPath}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { outPath, bytes: buf.length };
}

// ---------- Phase 1: Image-to-3D ----------

// Request contract per docs.meshy.ai/en/api/image-to-3d (read 2026-08-28).
// Kept as a function so the exact settings can be logged to the task JSON
// without the (large) base64 image.
const IMAGE_TO_3D_SETTINGS = (imageUrl, poseMode = DEFAULT_POSE_MODE) => ({
  image_url: imageUrl,
  ai_model: "latest",
  pose_mode: poseMode,
  should_texture: true,
  texture_resolution: "2k",
  should_remesh: false, // remesh is a separate, proven phase (Phase 2)
  target_formats: ["glb"],
  multi_view_thumbnails: true,
});

async function submitImageTo3D(apiKey, imagePath, poseMode = DEFAULT_POSE_MODE) {
  console.log(`[meshy-employee] Phase 1: submitting Image-to-3D for ${imagePath} ...`);
  console.log("[meshy-employee] COST WARNING: real, paid Meshy API call.");

  const mime = mimeTypeFor(imagePath);
  const buf = fs.readFileSync(imagePath);
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;

  console.log(`[meshy-employee] pose_mode = ${poseMode}`);
  const result = await meshyFetch(apiKey, "POST", "/v1/image-to-3d", IMAGE_TO_3D_SETTINGS(dataUri, poseMode));

  if (!result.result) throw new Error("Image-to-3D submit response missing 'result' (task id) field");
  console.log(`[meshy-employee] Image-to-3D task submitted. task_id = ${result.result}`);
  return result.result;
}

async function pollImageTo3D(apiKey, taskId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const task = await meshyFetch(apiKey, "GET", `/v1/image-to-3d/${taskId}`);
    console.log(`[meshy-employee]   image-to-3d status=${task.status} progress=${task.progress ?? "?"}`);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const msg = (task.task_error && task.task_error.message) || `task ended with status ${task.status}`;
      throw new Error(`Meshy image-to-3d task ${task.status}: ${msg}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for image-to-3d task ${taskId}`);
}

async function downloadImageTo3DArtifacts(task, outDir, employeeName) {
  const downloaded = [];
  const grab = async (label, url, ext) => {
    if (typeof url !== "string" || !url) return;
    const out = path.join(outDir, `${employeeName}-raw-${label}.${ext}`);
    downloaded.push({ label, ...(await downloadFile(url, out)) });
  };
  const models = task.model_urls || {};
  for (const [fmt, url] of Object.entries(models)) {
    if (fmt === "glb") await grab("model", url, "glb");
    else await grab(fmt, url, fmt === "pre_remeshed_glb" ? "glb" : fmt);
  }
  const textures = Array.isArray(task.texture_urls) ? task.texture_urls : [];
  for (let i = 0; i < textures.length; i++) {
    for (const [kind, url] of Object.entries(textures[i] || {})) {
      await grab(`tex${i}-${kind}`, url, "png");
    }
  }
  await grab("thumbnail", task.thumbnail_url, "png");
  for (const [view, url] of Object.entries(task.thumbnail_urls || {})) {
    await grab(`thumb-${view}`, url, "png");
  }
  return downloaded;
}

async function downloadRemeshArtifacts(task, outDir, employeeName) {
  const downloaded = [];
  const grab = async (label, url, ext) => {
    if (typeof url !== "string" || !url) return;
    const out = path.join(outDir, `${employeeName}-remeshed-${label}.${ext}`);
    downloaded.push({ label, url, ...(await downloadFile(url, out)) });
  };
  for (const [fmt, url] of Object.entries(task.model_urls || {})) {
    if (fmt !== "glb") await grab(fmt, url, fmt); // glb itself is saved as <name>-remeshed.glb by main()
  }
  const textures = Array.isArray(task.texture_urls) ? task.texture_urls : [];
  for (let i = 0; i < textures.length; i++) {
    for (const [kind, url] of Object.entries(textures[i] || {})) await grab(`tex${i}-${kind}`, url, "png");
  }
  await grab("thumbnail", task.thumbnail_url, "png");
  return downloaded;
}

// ---------- Phase 2: Remesh ----------

async function submitRemesh(apiKey, inputTaskId) {
  console.log(`[meshy-employee] Phase 2: submitting Remesh for input_task_id=${inputTaskId} ...`);
  console.log("[meshy-employee] COST WARNING: real, paid Meshy API call.");

  let result;
  let versionUsed = "v2";
  try {
    result = await meshyFetch(apiKey, "POST", "/v2/remesh", {
      input_task_id: inputTaskId,
      target_polycount: TARGET_POLYCOUNT,
      target_formats: ["glb"],
    });
  } catch (err) {
    if (err && err.status === 404) {
      versionUsed = "v1";
      result = await meshyFetch(apiKey, "POST", "/v1/remesh", {
        input_task_id: inputTaskId,
        target_polycount: TARGET_POLYCOUNT,
        target_formats: ["glb"],
      });
    } else {
      throw err;
    }
  }

  if (!result.result) throw new Error("Remesh submit response missing 'result' (task id) field");
  console.log(`[meshy-employee] Remesh task submitted (${versionUsed}). task_id = ${result.result}`);
  return { taskId: result.result, versionUsed };
}

async function pollRemesh(apiKey, taskId, versionUsed) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let path_ = `/${versionUsed}/remesh/${taskId}`;
  let triedFallback = false;

  while (Date.now() < deadline) {
    let task;
    try {
      task = await meshyFetch(apiKey, "GET", path_);
    } catch (err) {
      if (err && err.status === 404 && !triedFallback) {
        const otherVersion = versionUsed === "v2" ? "v1" : "v2";
        path_ = `/${otherVersion}/remesh/${taskId}`;
        triedFallback = true;
        continue;
      }
      throw err;
    }
    console.log(`[meshy-employee]   remesh status=${task.status} progress=${task.progress ?? "?"}`);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const msg = (task.task_error && task.task_error.message) || `task ended with status ${task.status}`;
      throw new Error(`Meshy remesh task ${task.status}: ${msg}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for remesh task ${taskId}`);
}

// ---------- Phase 3: Rigging ----------

async function submitRigging(apiKey, inputTaskId) {
  console.log(`[meshy-employee] Phase 3: submitting Rigging for input_task_id=${inputTaskId} ...`);
  console.log("[meshy-employee] COST WARNING: real, paid Meshy API call.");

  const result = await meshyFetch(apiKey, "POST", "/v1/rigging", { input_task_id: inputTaskId });
  if (!result.result) throw new Error("Rigging submit response missing 'result' (task id) field");
  console.log(`[meshy-employee] Rigging task submitted. task_id = ${result.result}`);
  return result.result;
}

async function pollRigging(apiKey, taskId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const task = await meshyFetch(apiKey, "GET", `/v1/rigging/${taskId}`);
    console.log(`[meshy-employee]   rigging status=${task.status} progress=${task.progress ?? "?"}`);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const msg = (task.task_error && task.task_error.message) || `task ended with status ${task.status}`;
      throw new Error(`Meshy rigging task ${task.status}: ${msg}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for rigging task ${taskId}`);
}

async function downloadRiggingResults(task, outDir, employeeName) {
  const result = task.result || {};
  const downloaded = [];
  const grab = async (label, url, outName) => {
    if (typeof url !== "string" || !url) return;
    const outPath = path.join(outDir, outName);
    if (fs.existsSync(outPath)) throw new Error(`Refusing to overwrite existing file: ${outPath}`);
    downloaded.push({ label, url, ...(await downloadFile(url, outPath)) });
  };

  if (!result.rigged_character_glb_url) {
    throw new Error("Succeeded rigging task has no result.rigged_character_glb_url to download");
  }
  await grab("rigged_character_glb_url", result.rigged_character_glb_url, `${employeeName}-rigged.glb`);
  await grab("rigged_character_fbx_url", result.rigged_character_fbx_url, `${employeeName}-rigged.fbx`);

  // basic_animations per docs (2026-08-28): flat keys like walking_glb_url,
  // walking_fbx_url, walking_armature_glb_url, running_* — map to
  // <name>-rigged-walking.glb, -walking.fbx, -walking-armature.glb, etc.
  // Older responses nested {glb_url} objects; both shapes handled.
  const basic = result.basic_animations;
  if (basic && typeof basic === "object") {
    for (const [key, value] of Object.entries(basic)) {
      const urls = typeof value === "string" ? { [key]: value }
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [`${key}_${k}`, v])) : {};
      for (const [k, url] of Object.entries(urls)) {
        if (typeof url !== "string") continue;
        const m = k.match(/^(.+?)_(armature_)?(glb|fbx)_url$/i);
        const clip = m ? m[1] : k.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
        const ext = m ? m[3].toLowerCase() : "glb";
        const suffix = m && m[2] ? "-armature" : "";
        await grab(`basic_animations.${k}`, url, `${employeeName}-rigged-${clip}${suffix}.${ext}`);
      }
    }
  }
  await grab("thumbnail_url", task.thumbnail_url, `${employeeName}-rigged-thumbnail.png`);
  for (const [view, url] of Object.entries(task.thumbnail_urls || {})) {
    await grab(`thumbnail_urls.${view}`, url, `${employeeName}-rigged-thumb-${view}.png`);
  }
  const textures = Array.isArray(task.texture_urls) ? task.texture_urls : [];
  for (let i = 0; i < textures.length; i++) {
    for (const [kind, url] of Object.entries(textures[i] || {})) {
      await grab(`texture_urls[${i}].${kind}`, url, `${employeeName}-rigged-tex${i}-${kind}.png`);
    }
  }
  return downloaded;
}

// ---------- Main ----------

function usageAndExit() {
  console.error(
    "Usage: node scripts/avatar-pipeline/meshy-generate-employee-3d.mjs <employeeName> <imagePath>",
  );
  process.exit(1);
}

async function main() {
  const employeeName = process.argv[2];
  const imagePath = process.argv[3];
  const flags = process.argv.slice(4);
  const flagValue = (name) => (flags.find((a) => a.startsWith(`${name}=`)) || "").slice(name.length + 1) || null;
  const stopAfter = flagValue("--stop-after");
  const poseMode = flagValue("--pose-mode") || DEFAULT_POSE_MODE;
  const resumeTaskId = flagValue("--from-image-to-3d-task");
  const resumeRemeshTaskId = flagValue("--from-remesh-task");
  if (resumeRemeshTaskId && (resumeTaskId || stopAfter)) {
    console.error("--from-remesh-task runs Phase 3 only and cannot be combined with --from-image-to-3d-task or --stop-after");
    return usageAndExit();
  }
  if (!employeeName || !imagePath) return usageAndExit();
  if (!POSE_MODES.includes(poseMode)) {
    console.error(`Unsupported --pose-mode value "${poseMode}" (supported: ${POSE_MODES.join(", ")})`);
    return usageAndExit();
  }
  if (stopAfter && !["image-to-3d", "remesh"].includes(stopAfter)) {
    console.error(`Unsupported --stop-after value "${stopAfter}" (supported: image-to-3d, remesh)`);
    return usageAndExit();
  }
  if (resumeTaskId && stopAfter === "image-to-3d") {
    console.error("--from-image-to-3d-task cannot be combined with --stop-after=image-to-3d (nothing would run)");
    return usageAndExit();
  }
  if (!fs.existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    return usageAndExit();
  }

  const outDir = path.join(__dirname, "output", "meshy-employees", employeeName);
  fs.mkdirSync(outDir, { recursive: true });

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

    if (resumeRemeshTaskId) {
      // ---- Phase 3 only: resume from an existing SUCCEEDED remesh task ----
      console.log(`[meshy-employee] Phases 1+2 SKIPPED — resuming from existing remesh task ${resumeRemeshTaskId} (read-only GET, no credits).`);
      const remeshTask = await meshyFetch(apiKey, "GET", `/v1/remesh/${resumeRemeshTaskId}`);
      if (remeshTask.status !== "SUCCEEDED") throw new Error(`Cannot resume: remesh task has status ${remeshTask.status}, expected SUCCEEDED`);
      if (!(remeshTask.model_urls && remeshTask.model_urls.glb)) throw new Error("Cannot resume: remesh task has no model_urls.glb (expired?)");
      const rigStartedAt = new Date().toISOString();
      const rigTaskId = await submitRigging(apiKey, remeshTask.id);
      const rigTask = await pollRigging(apiKey, rigTaskId);
      const downloaded = await downloadRiggingResults(rigTask, outDir, employeeName);
      const balanceAfter = await checkBalance(apiKey);
      const record = {
        step: "rigging",
        employee: employeeName,
        source_remesh_task_id: remeshTask.id,
        resumed_from_existing_task: true,
        endpoint: "POST /openapi/v1/rigging",
        request_settings: { input_task_id: remeshTask.id },
        task_id: rigTask.id,
        consumed_credits: rigTask.consumed_credits ?? null,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        started_at: rigStartedAt,
        finished_at: new Date().toISOString(),
        meshy_created_at: rigTask.created_at ?? null,
        meshy_finished_at: rigTask.finished_at ?? null,
        expires_at: rigTask.expires_at ?? null,
        result_keys: Object.keys(rigTask.result || {}),
        basic_animation_keys: Object.keys((rigTask.result || {}).basic_animations || {}),
        artifacts: downloaded,
      };
      fs.writeFileSync(path.join(outDir, `${employeeName}-rig.task.json`), JSON.stringify(record, null, 2));
      console.log(`[meshy-employee] Phase 3 SUCCESS. task_id=${rigTask.id} consumed_credits=${rigTask.consumed_credits ?? "?"}`);
      for (const d of downloaded) console.log(`[meshy-employee]   ${d.label} -> ${d.outPath} (${d.bytes} bytes)`);
      return;
    }

    // Phase 1: Image-to-3D (or resume from an existing SUCCEEDED task)
    const startedAt = new Date().toISOString();
    let imageTask;
    if (resumeTaskId) {
      console.log(`[meshy-employee] Phase 1 SKIPPED — resuming from existing image-to-3d task ${resumeTaskId} (read-only GET, no credits).`);
      imageTask = await meshyFetch(apiKey, "GET", `/v1/image-to-3d/${resumeTaskId}`);
      if (imageTask.status !== "SUCCEEDED") {
        throw new Error(`Cannot resume: task ${resumeTaskId} has status ${imageTask.status}, expected SUCCEEDED`);
      }
      if (!(imageTask.model_urls && imageTask.model_urls.glb)) {
        throw new Error(`Cannot resume: task ${resumeTaskId} has no model_urls.glb (expired?)`);
      }
      // Never touch <name>-raw.glb on resume — it is the reviewed artifact.
    } else {
      const imageTaskId = await submitImageTo3D(apiKey, imagePath, poseMode);
      imageTask = await pollImageTo3D(apiKey, imageTaskId);
      const rawGlbUrl = imageTask.model_urls && imageTask.model_urls.glb;
      if (rawGlbUrl) {
        await downloadFile(rawGlbUrl, path.join(outDir, `${employeeName}-raw.glb`));
      }
      console.log(`[meshy-employee] Phase 1 SUCCESS. task_id=${imageTask.id} consumed_credits=${imageTask.consumed_credits ?? "?"}`);
    }

    if (stopAfter === "image-to-3d") {
      const artifacts = await downloadImageTo3DArtifacts(imageTask, outDir, employeeName);
      const balanceAfter = await checkBalance(apiKey);
      const { image_url: _omit, ...settings } = IMAGE_TO_3D_SETTINGS("", poseMode);
      const record = {
        step: "image-to-3d",
        employee: employeeName,
        source_image: imagePath,
        request_settings: settings,
        task_id: imageTask.id,
        consumed_credits: imageTask.consumed_credits ?? null,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        meshy_created_at: imageTask.created_at ?? null,
        meshy_finished_at: imageTask.finished_at ?? null,
        expires_at: imageTask.expires_at ?? null,
        artifacts: [{ label: "glb", outPath: path.join(outDir, `${employeeName}-raw.glb`) }, ...artifacts],
      };
      fs.writeFileSync(path.join(outDir, `${employeeName}-image-to-3d.task.json`), JSON.stringify(record, null, 2));
      console.log("");
      console.log("[meshy-employee] STOPPED after Phase 1 (--stop-after=image-to-3d). No remesh/rig submitted.");
      for (const a of record.artifacts) console.log(`[meshy-employee]   ${a.label} -> ${a.outPath}${a.bytes ? ` (${a.bytes} bytes)` : ""}`);
      return;
    }

    // Phase 2: Remesh
    const remeshStartedAt = new Date().toISOString();
    const { taskId: remeshTaskId, versionUsed } = await submitRemesh(apiKey, imageTask.id);
    const remeshTask = await pollRemesh(apiKey, remeshTaskId, versionUsed);
    const remeshGlbUrl = remeshTask.model_urls && remeshTask.model_urls.glb;
    const remeshedOut = path.join(outDir, `${employeeName}-remeshed.glb`);
    if (remeshGlbUrl) {
      await downloadFile(remeshGlbUrl, remeshedOut);
    }
    console.log(`[meshy-employee] Phase 2 SUCCESS. task_id=${remeshTask.id} consumed_credits=${remeshTask.consumed_credits ?? "?"}`);

    if (stopAfter === "remesh") {
      const extra = await downloadRemeshArtifacts(remeshTask, outDir, employeeName);
      const balanceAfter = await checkBalance(apiKey);
      const record = {
        step: "remesh",
        employee: employeeName,
        source_image_to_3d_task_id: imageTask.id,
        resumed_from_existing_task: Boolean(resumeTaskId),
        endpoint: `POST /openapi/${versionUsed}/remesh`,
        request_settings: { input_task_id: imageTask.id, target_polycount: TARGET_POLYCOUNT, target_formats: ["glb"] },
        task_id: remeshTask.id,
        consumed_credits: remeshTask.consumed_credits ?? null,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        started_at: remeshStartedAt,
        finished_at: new Date().toISOString(),
        meshy_created_at: remeshTask.created_at ?? null,
        meshy_finished_at: remeshTask.finished_at ?? null,
        expires_at: remeshTask.expires_at ?? null,
        artifacts: [
          { label: "glb", url: remeshGlbUrl || null, outPath: remeshedOut, bytes: remeshGlbUrl ? fs.statSync(remeshedOut).size : null },
          ...extra,
        ],
      };
      fs.writeFileSync(path.join(outDir, `${employeeName}-remesh.task.json`), JSON.stringify(record, null, 2));
      console.log("");
      console.log("[meshy-employee] STOPPED after Phase 2 (--stop-after=remesh). No rigging submitted.");
      for (const a of record.artifacts) console.log(`[meshy-employee]   ${a.label} -> ${a.outPath}${a.bytes ? ` (${a.bytes} bytes)` : ""}`);
      return;
    }

    // Phase 3: Rigging
    const rigTaskId = await submitRigging(apiKey, remeshTask.id);
    const rigTask = await pollRigging(apiKey, rigTaskId);
    const downloaded = await downloadRiggingResults(rigTask, outDir, employeeName);
    console.log(`[meshy-employee] Phase 3 SUCCESS. task_id=${rigTask.id} consumed_credits=${rigTask.consumed_credits ?? "?"}`);

    console.log("");
    console.log("[meshy-employee] ALL PHASES SUCCEEDED");
    for (const d of downloaded) {
      console.log(`[meshy-employee]   ${d.label} -> ${d.outPath} (${d.bytes} bytes)`);
    }
    console.log(`[meshy-employee] Output directory: ${outDir}`);
  } catch (err) {
    const message = redact(String(err && err.message ? err.message : err), apiKey);
    console.error(`[meshy-employee] FAILED: ${message}`);
    if (err && err.body) {
      console.error("[meshy-employee] response body:", JSON.stringify(err.body, null, 2));
    }
    process.exit(1);
  }
}

main();
