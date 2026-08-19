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
 *   node scripts/avatar-pipeline/meshy-generate-employee-3d.mjs <employeeName> <imagePath>
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
const TARGET_POLYCOUNT = 300_000;

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

async function submitImageTo3D(apiKey, imagePath) {
  console.log(`[meshy-employee] Phase 1: submitting Image-to-3D for ${imagePath} ...`);
  console.log("[meshy-employee] COST WARNING: real, paid Meshy API call.");

  const mime = mimeTypeFor(imagePath);
  const buf = fs.readFileSync(imagePath);
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;

  const result = await meshyFetch(apiKey, "POST", "/v1/image-to-3d", {
    image_url: dataUri,
    should_texture: true,
    target_formats: ["glb"],
  });

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

  const rigGlbUrl = result.rigged_character_glb_url;
  if (!rigGlbUrl) throw new Error("Succeeded rigging task has no result.rigged_character_glb_url to download");
  const rigOut = path.join(outDir, `${employeeName}-rigged.glb`);
  downloaded.push({ label: "rigged_character_glb_url", ...(await downloadFile(rigGlbUrl, rigOut)) });

  const basicAnimations = result.basic_animations;
  if (basicAnimations && typeof basicAnimations === "object") {
    for (const [key, value] of Object.entries(basicAnimations)) {
      let url;
      if (typeof value === "string" && value.toLowerCase().includes(".glb")) {
        url = value;
      } else if (value && typeof value === "object") {
        if (typeof value.glb_url === "string") url = value.glb_url;
        else if (typeof value.url === "string" && value.url.toLowerCase().includes(".glb")) url = value.url;
      }
      if (url) {
        const safeKey = key.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
        const outPath = path.join(outDir, `${employeeName}-basic-${safeKey}.glb`);
        downloaded.push({ label: `basic_animations.${key}`, ...(await downloadFile(url, outPath)) });
      }
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
  if (!employeeName || !imagePath) return usageAndExit();
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
    await checkBalance(apiKey);

    // Phase 1: Image-to-3D
    const imageTaskId = await submitImageTo3D(apiKey, imagePath);
    const imageTask = await pollImageTo3D(apiKey, imageTaskId);
    const rawGlbUrl = imageTask.model_urls && imageTask.model_urls.glb;
    if (rawGlbUrl) {
      await downloadFile(rawGlbUrl, path.join(outDir, `${employeeName}-raw.glb`));
    }
    console.log(`[meshy-employee] Phase 1 SUCCESS. task_id=${imageTask.id} consumed_credits=${imageTask.consumed_credits ?? "?"}`);

    // Phase 2: Remesh
    const { taskId: remeshTaskId, versionUsed } = await submitRemesh(apiKey, imageTask.id);
    const remeshTask = await pollRemesh(apiKey, remeshTaskId, versionUsed);
    const remeshGlbUrl = remeshTask.model_urls && remeshTask.model_urls.glb;
    if (remeshGlbUrl) {
      await downloadFile(remeshGlbUrl, path.join(outDir, `${employeeName}-remeshed.glb`));
    }
    console.log(`[meshy-employee] Phase 2 SUCCESS. task_id=${remeshTask.id} consumed_credits=${remeshTask.consumed_credits ?? "?"}`);

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
