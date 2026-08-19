#!/usr/bin/env node
/**
 * THROWAWAY rigging test — submits exactly ONE Meshy Rigging task against an
 * already-approved chibi 3D model (input_task_id below), polls it, and
 * downloads the result. Mirrors meshy-connection-test.mjs's structure.
 *
 * This is a rig-proof only: no animation step, no wiring into
 * gen-server.mjs or the live app. Do not import this file from anywhere
 * else in the app.
 *
 * Run:
 *   node scripts/avatar-pipeline/meshy-rig-test.mjs
 *
 * Flow:
 *   1. Load MESHY_API_KEY from frontend/.env (same loadEnvKey/redact
 *      helpers gen-server.mjs uses for OPENAI_API_KEY/GEMINI_API_KEY).
 *   2. Cheap authenticated call first: GET /openapi/v1/balance. Confirms
 *      the key is valid (200) BEFORE spending credits on a rigging call.
 *   3. Submit ONE Rigging task (POST /openapi/v1/rigging) against the
 *      approved chibi model's task_id (INPUT_TASK_ID below).
 *   4. Poll GET /openapi/v1/rigging/:id every 8s, up to a 10-minute
 *      timeout, until status is SUCCEEDED, FAILED, or CANCELED.
 *   5. On SUCCEEDED, download result.rigged_character_glb_url and, if
 *      present, a walk/run GLB variant from result.basic_animations, to
 *      output/meshy-test/rig/. Prints the full result payload structure.
 *
 * SECURITY: never log/print process.env.MESHY_API_KEY / the loaded key.
 * Any caught error is redacted before being written to stdout/stderr.
 *
 * COST WARNING: step 3 is a REAL, PAID Meshy Rigging call (~5 credits per
 * Meshy's docs example; actual cost may vary). This script intentionally
 * submits exactly one rigging task per run. Do not loop this script in a
 * retry harness without re-reading this warning.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvKey, redact } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_DIR = path.join(__dirname, "output", "meshy-test", "rig");

const API_BASE = "https://api.meshy.ai/openapi";
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Approved master-derived chibi model (see task description). Do NOT rig
// 01a01871... — that was an earlier rejected raw-photo-realistic attempt.
const INPUT_TASK_ID = "01a01881-8433-7eb5-ae1e-bbc115cbe858";

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
  console.log("[meshy-rig-test] Step 1/4: checking auth via GET /openapi/v1/balance ...");
  const data = await meshyFetch(apiKey, "GET", "/v1/balance");
  if (typeof data.balance !== "number") {
    throw new Error("Balance endpoint returned an unexpected shape (no numeric 'balance' field)");
  }
  console.log(`[meshy-rig-test] Auth OK. Current credit balance: ${data.balance}`);
  return data.balance;
}

async function submitRigging(apiKey, inputTaskId) {
  console.log(`[meshy-rig-test] Step 2/4: submitting ONE Rigging task for input_task_id=${inputTaskId} ...`);
  console.log("[meshy-rig-test] COST WARNING: this is a real, paid Meshy API call.");

  const result = await meshyFetch(apiKey, "POST", "/v1/rigging", {
    input_task_id: inputTaskId,
  });

  if (!result.result) {
    throw new Error("Rigging submit response missing 'result' (task id) field");
  }
  console.log(`[meshy-rig-test] Task submitted. task_id = ${result.result}`);
  return result.result;
}

async function pollUntilDone(apiKey, taskId) {
  console.log("[meshy-rig-test] Step 3/4: polling task status (every 8s, 10min timeout) ...");
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const task = await meshyFetch(apiKey, "GET", `/v1/rigging/${taskId}`);
    console.log(`[meshy-rig-test]   status=${task.status} progress=${task.progress ?? "?"}`);

    if (task.status === "SUCCEEDED") {
      return task;
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const msg = (task.task_error && task.task_error.message) || `task ended with status ${task.status}`;
      throw new Error(`Meshy task ${task.status}: ${msg}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out after ${POLL_TIMEOUT_MS / 1000}s waiting for task ${taskId} to finish`);
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

async function downloadResults(task) {
  console.log("[meshy-rig-test] Step 4/4: downloading rigged model + basic animation variant(s) ...");
  const result = task.result || {};
  const downloaded = [];

  const rigGlbUrl = result.rigged_character_glb_url;
  if (!rigGlbUrl) {
    throw new Error("Succeeded task has no result.rigged_character_glb_url to download");
  }
  const rigOut = path.join(OUTPUT_DIR, "alex-rigged.glb");
  downloaded.push({ label: "rigged_character_glb_url", ...(await downloadFile(rigGlbUrl, rigOut)) });

  // basic_animations structure is not fully known ahead of time — log it in
  // full, then walk it looking for any GLB URL(s) so we can save whichever
  // walk/run variant Meshy actually bundled, under a name derived from its
  // real key.
  const basicAnimations = result.basic_animations;
  console.log("[meshy-rig-test] result.basic_animations (full structure):");
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
        const outPath = path.join(OUTPUT_DIR, `alex-basic-${safeKey}.glb`);
        downloaded.push({ label: `basic_animations.${key}`, ...(await downloadFile(url, outPath)) });
      }
    }
  }

  return downloaded;
}

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

  try {
    await checkBalance(apiKey);
    const taskId = await submitRigging(apiKey, INPUT_TASK_ID);
    const task = await pollUntilDone(apiKey, taskId);

    console.log("");
    console.log("[meshy-rig-test] Full task payload on SUCCEEDED:");
    console.log(JSON.stringify(task, null, 2));

    const downloaded = await downloadResults(task);

    console.log("");
    console.log("[meshy-rig-test] SUCCESS");
    console.log(`[meshy-rig-test] task_id: ${task.id}`);
    console.log(`[meshy-rig-test] consumed_credits: ${task.consumed_credits ?? "?"}`);
    for (const d of downloaded) {
      console.log(`[meshy-rig-test] downloaded ${d.label} -> ${d.outPath} (${d.bytes} bytes)`);
    }
  } catch (err) {
    const message = redact(String(err && err.message ? err.message : err), apiKey);
    console.error(`[meshy-rig-test] FAILED: ${message}`);
    if (err && err.body) {
      console.error("[meshy-rig-test] response body:", JSON.stringify(err.body, null, 2));
    }
    process.exit(1);
  }
}

main();
