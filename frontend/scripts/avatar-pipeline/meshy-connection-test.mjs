#!/usr/bin/env node
/**
 * THROWAWAY connection test — proves we can authenticate to the Meshy AI
 * REST API and generate exactly ONE textured 3D model from ONE photo.
 *
 * This is a connection-proof only: no rigging, no animation, no wiring
 * into gen-server.mjs or the live app. Do not import this file from
 * anywhere else in the app.
 *
 * Run:
 *   node scripts/avatar-pipeline/meshy-connection-test.mjs [imagePath]
 *
 * If [imagePath] is omitted, falls back to an existing raw photo already
 * in the repo's avatar-pipeline test corpus (see DEFAULT_TEST_IMAGE below)
 * if present, otherwise exits with a usage message.
 *
 * Flow:
 *   1. Load MESHY_API_KEY from frontend/.env (same loadEnvKey/redact
 *      helpers gen-server.mjs uses for OPENAI_API_KEY/GEMINI_API_KEY).
 *   2. Cheap authenticated call first: GET /openapi/v1/balance. Confirms
 *      the key is valid (200) BEFORE spending credits on a generation call.
 *   3. Submit ONE Image-to-3D task (POST /openapi/v1/image-to-3d) using the
 *      chosen photo as a base64 data URI.
 *   4. Poll GET /openapi/v1/image-to-3d/:id every 8s, up to a 10-minute
 *      timeout, until status is SUCCEEDED or FAILED.
 *   5. On SUCCEEDED, download model_urls.glb to
 *      output/meshy-test/<taskId>.glb and print the task id + local path.
 *
 * SECURITY: never log/print process.env.MESHY_API_KEY / the loaded key.
 * Any caught error is redacted before being written to stdout/stderr.
 *
 * COST WARNING: step 3 is a REAL, PAID Meshy Image-to-3D call (this repo's
 * key already has credits — verified non-empty in frontend/.env). This
 * script intentionally submits exactly one generation task per run. Do not
 * loop this script in a retry harness without re-reading this warning.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvKey, redact } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_DIR = path.join(__dirname, "output", "meshy-test");

const API_BASE = "https://api.meshy.ai/openapi";
const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Existing raw photo already in the repo's avatar-pipeline test corpus —
// used only if no CLI arg is given. Falls through to a usage message if
// this path isn't reachable in the current environment (e.g. a different
// machine than Bon's).
const DEFAULT_TEST_IMAGE = "/Users/lekoffshorly/Downloads/Employee Sprite/Raw/alex.jpg";

function usageAndExit() {
  console.error(
    [
      "Usage: node scripts/avatar-pipeline/meshy-connection-test.mjs [imagePath]",
      "",
      `No imagePath given, and the default test photo was not found at:`,
      `  ${DEFAULT_TEST_IMAGE}`,
      "Pass a path to a .jpg/.jpeg/.png photo to test with instead.",
    ].join("\n"),
  );
  process.exit(1);
}

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
  console.log("[meshy-test] Step 1/4: checking auth via GET /openapi/v1/balance ...");
  const data = await meshyFetch(apiKey, "GET", "/v1/balance");
  if (typeof data.balance !== "number") {
    throw new Error("Balance endpoint returned an unexpected shape (no numeric 'balance' field)");
  }
  console.log(`[meshy-test] Auth OK. Current credit balance: ${data.balance}`);
  return data.balance;
}

async function submitImageTo3D(apiKey, imagePath) {
  console.log(`[meshy-test] Step 2/4: submitting ONE Image-to-3D task for ${imagePath} ...`);
  console.log("[meshy-test] COST WARNING: this is a real, paid Meshy API call.");

  const mime = mimeTypeFor(imagePath);
  const buf = fs.readFileSync(imagePath);
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;

  const result = await meshyFetch(apiKey, "POST", "/v1/image-to-3d", {
    image_url: dataUri,
    should_texture: true,
    target_formats: ["glb"],
  });

  if (!result.result) {
    throw new Error("Image-to-3D submit response missing 'result' (task id) field");
  }
  console.log(`[meshy-test] Task submitted. task_id = ${result.result}`);
  return result.result;
}

async function pollUntilDone(apiKey, taskId) {
  console.log("[meshy-test] Step 3/4: polling task status (every 8s, 10min timeout) ...");
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const task = await meshyFetch(apiKey, "GET", `/v1/image-to-3d/${taskId}`);
    console.log(`[meshy-test]   status=${task.status} progress=${task.progress ?? "?"}`);

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

async function downloadModel(task) {
  console.log("[meshy-test] Step 4/4: downloading resulting GLB ...");
  const glbUrl = task.model_urls && task.model_urls.glb;
  if (!glbUrl) {
    throw new Error("Succeeded task has no model_urls.glb to download");
  }

  const res = await fetch(glbUrl);
  if (!res.ok) {
    throw new Error(`Failed to download model file: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `${task.id}.glb`);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

async function main() {
  const imagePathArg = process.argv[2];
  const imagePath = imagePathArg || DEFAULT_TEST_IMAGE;

  if (!imagePath || !fs.existsSync(imagePath)) {
    usageAndExit();
    return;
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
    await checkBalance(apiKey);
    const taskId = await submitImageTo3D(apiKey, imagePath);
    const task = await pollUntilDone(apiKey, taskId);
    const outPath = await downloadModel(task);

    console.log("");
    console.log("[meshy-test] SUCCESS");
    console.log(`[meshy-test] task_id: ${task.id}`);
    console.log(`[meshy-test] model saved to: ${outPath}`);
  } catch (err) {
    const message = redact(String(err && err.message ? err.message : err), apiKey);
    console.error(`[meshy-test] FAILED: ${message}`);
    process.exit(1);
  }
}

main();
