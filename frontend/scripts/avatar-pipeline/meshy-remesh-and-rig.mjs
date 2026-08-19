#!/usr/bin/env node
/**
 * THROWAWAY remesh+rig test — the original chibi 3D model
 * (task_id 01a01881-8433-7eb5-ae1e-bbc115cbe858) has 1,995,394 faces, which
 * exceeds Meshy's 320,000-face rigging limit (confirmed via a live HTTP 400
 * from meshy-rig-test.mjs). This script:
 *
 *   1. Remeshes that model down to target_polycount=300000 via
 *      POST /openapi/v2/remesh, polls to completion, downloads the result.
 *   2. Feeds the REMESHED task's own id (not the original) into a Rigging
 *      call (POST /openapi/v1/rigging), polls to completion, downloads the
 *      rigged GLB plus any bundled basic_animations GLB(s).
 *
 * This is a proof-of-pipeline only: no wiring into gen-server.mjs or the
 * live app. Do not import this file from anywhere else in the app.
 *
 * Run:
 *   node scripts/avatar-pipeline/meshy-remesh-and-rig.mjs
 *
 * SECURITY: never log/print process.env.MESHY_API_KEY / the loaded key.
 * Any caught error is redacted before being written to stdout/stderr.
 *
 * COST WARNING: this submits ONE real, paid Remesh task and — only if that
 * remesh clearly SUCCEEDED — ONE real, paid Rigging task. If either step
 * comes back FAILED or errors unexpectedly, the script stops immediately
 * and does not proceed/retry. Credits are real money.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvKey, redact } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const REMESH_OUTPUT_DIR = path.join(__dirname, "output", "meshy-test", "remesh");
const RIG_OUTPUT_DIR = path.join(__dirname, "output", "meshy-test", "rig");

const API_BASE = "https://api.meshy.ai/openapi";
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Original over-limit chibi model (1,995,394 faces > 320,000 rigging cap).
// Do NOT rig this directly — must be remeshed first.
const INPUT_TASK_ID = "01a01881-8433-7eb5-ae1e-bbc115cbe858";
const TARGET_POLYCOUNT = 300_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  console.log("[remesh-rig] Step 1: checking auth via GET /openapi/v1/balance ...");
  const data = await meshyFetch(apiKey, "GET", "/v1/balance");
  if (typeof data.balance !== "number") {
    throw new Error("Balance endpoint returned an unexpected shape (no numeric 'balance' field)");
  }
  console.log(`[remesh-rig] Auth OK. Current credit balance: ${data.balance}`);
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

// ---------- Remesh ----------

async function submitRemesh(apiKey, inputTaskId) {
  console.log(`[remesh-rig] Step 2: submitting ONE Remesh task for input_task_id=${inputTaskId} ...`);
  console.log("[remesh-rig] COST WARNING: this is a real, paid Meshy API call.");

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
      console.log("[remesh-rig] /v2/remesh 404'd — falling back to /v1/remesh ...");
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

  if (!result.result) {
    throw new Error("Remesh submit response missing 'result' (task id) field");
  }
  console.log(`[remesh-rig] Remesh task submitted (${versionUsed}). task_id = ${result.result}`);
  return { taskId: result.result, versionUsed };
}

async function pollRemesh(apiKey, taskId, versionUsed) {
  console.log("[remesh-rig] Step 3: polling remesh task status (every 8s, 10min timeout) ...");
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
        console.log(`[remesh-rig] poll path ${path_} 404'd — trying ${otherVersion} instead ...`);
        path_ = `/${otherVersion}/remesh/${taskId}`;
        triedFallback = true;
        continue;
      }
      throw err;
    }
    console.log(`[remesh-rig]   status=${task.status} progress=${task.progress ?? "?"} (path=${path_})`);

    if (task.status === "SUCCEEDED") {
      console.log(`[remesh-rig] Confirmed working poll path: ${path_}`);
      return task;
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const msg = (task.task_error && task.task_error.message) || `task ended with status ${task.status}`;
      const err = new Error(`Meshy remesh task ${task.status}: ${msg}`);
      err.body = task;
      throw err;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for remesh task ${taskId} to finish`);
}

async function downloadRemeshResult(task) {
  console.log("[remesh-rig] Step 4: downloading remeshed GLB ...");
  const glbUrl = task.model_urls && task.model_urls.glb;
  if (!glbUrl) {
    throw new Error("Succeeded remesh task has no model_urls.glb to download");
  }
  const outPath = path.join(REMESH_OUTPUT_DIR, "alex-remeshed.glb");
  return downloadFile(glbUrl, outPath);
}

// ---------- Rigging (mirrors meshy-rig-test.mjs) ----------

async function submitRigging(apiKey, inputTaskId) {
  console.log(`[remesh-rig] Step 5: submitting ONE Rigging task for input_task_id=${inputTaskId} ...`);
  console.log("[remesh-rig] COST WARNING: this is a real, paid Meshy API call.");

  const result = await meshyFetch(apiKey, "POST", "/v1/rigging", {
    input_task_id: inputTaskId,
  });

  if (!result.result) {
    throw new Error("Rigging submit response missing 'result' (task id) field");
  }
  console.log(`[remesh-rig] Rigging task submitted. task_id = ${result.result}`);
  return result.result;
}

async function pollRigging(apiKey, taskId) {
  console.log("[remesh-rig] Step 6: polling rigging task status (every 8s, 10min timeout) ...");
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const task = await meshyFetch(apiKey, "GET", `/v1/rigging/${taskId}`);
    console.log(`[remesh-rig]   status=${task.status} progress=${task.progress ?? "?"}`);

    if (task.status === "SUCCEEDED") {
      return task;
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const msg = (task.task_error && task.task_error.message) || `task ended with status ${task.status}`;
      const err = new Error(`Meshy rigging task ${task.status}: ${msg}`);
      err.body = task;
      throw err;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for rigging task ${taskId} to finish`);
}

async function downloadRiggingResults(task) {
  console.log("[remesh-rig] Step 7: downloading rigged model + basic animation variant(s) ...");
  const result = task.result || {};
  const downloaded = [];

  const rigGlbUrl = result.rigged_character_glb_url;
  if (!rigGlbUrl) {
    throw new Error("Succeeded rigging task has no result.rigged_character_glb_url to download");
  }
  const rigOut = path.join(RIG_OUTPUT_DIR, "alex-rigged.glb");
  downloaded.push({ label: "rigged_character_glb_url", ...(await downloadFile(rigGlbUrl, rigOut)) });

  const basicAnimations = result.basic_animations;
  console.log("[remesh-rig] result.basic_animations (full structure):");
  console.log(JSON.stringify(basicAnimations, null, 2));

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
        const outPath = path.join(RIG_OUTPUT_DIR, `alex-basic-${safeKey}.glb`);
        downloaded.push({ label: `basic_animations.${key}`, ...(await downloadFile(url, outPath)) });
      }
    }
  }

  return downloaded;
}

// ---------- Main ----------

async function main() {
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

  let remeshTask;
  try {
    await checkBalance(apiKey);

    // --- Remesh phase ---
    const { taskId: remeshTaskId, versionUsed } = await submitRemesh(apiKey, INPUT_TASK_ID);
    remeshTask = await pollRemesh(apiKey, remeshTaskId, versionUsed);

    console.log("");
    console.log("[remesh-rig] Full REMESH task payload on SUCCEEDED:");
    console.log(JSON.stringify(remeshTask, null, 2));

    const remeshDownload = await downloadRemeshResult(remeshTask);

    console.log("");
    console.log("[remesh-rig] REMESH SUCCESS");
    console.log(`[remesh-rig] remesh task_id: ${remeshTask.id}`);
    console.log(`[remesh-rig] remesh consumed_credits: ${remeshTask.consumed_credits ?? "?"}`);
    console.log(
      `[remesh-rig] remesh reported polycount/face fields: ${JSON.stringify({
        polycount: remeshTask.polycount,
        target_polycount: remeshTask.target_polycount,
      })}`,
    );
    console.log(`[remesh-rig] downloaded remeshed GLB -> ${remeshDownload.outPath} (${remeshDownload.bytes} bytes)`);
  } catch (err) {
    const message = redact(String(err && err.message ? err.message : err), apiKey);
    console.error(`[remesh-rig] REMESH FAILED: ${message}`);
    if (err && err.body) {
      console.error("[remesh-rig] response body:", JSON.stringify(err.body, null, 2));
    }
    console.error("[remesh-rig] Stopping — not proceeding to rigging.");
    process.exit(1);
  }

  // --- Rigging phase — only reached if remesh clearly SUCCEEDED above ---
  try {
    const riggingTaskId = await submitRigging(apiKey, remeshTask.id);
    const riggingTask = await pollRigging(apiKey, riggingTaskId);

    console.log("");
    console.log("[remesh-rig] Full RIGGING task payload on SUCCEEDED:");
    console.log(JSON.stringify(riggingTask, null, 2));

    const downloaded = await downloadRiggingResults(riggingTask);

    console.log("");
    console.log("[remesh-rig] RIGGING SUCCESS");
    console.log(`[remesh-rig] rigging task_id: ${riggingTask.id}`);
    console.log(`[remesh-rig] rigging consumed_credits: ${riggingTask.consumed_credits ?? "?"}`);
    for (const d of downloaded) {
      console.log(`[remesh-rig] downloaded ${d.label} -> ${d.outPath} (${d.bytes} bytes)`);
    }

    console.log("");
    console.log("[remesh-rig] PIPELINE COMPLETE (remesh + rig both succeeded).");
  } catch (err) {
    const message = redact(String(err && err.message ? err.message : err), apiKey);
    console.error(`[remesh-rig] RIGGING FAILED: ${message}`);
    if (err && err.body) {
      console.error("[remesh-rig] response body:", JSON.stringify(err.body, null, 2));
    }
    process.exit(1);
  }
}

main();
