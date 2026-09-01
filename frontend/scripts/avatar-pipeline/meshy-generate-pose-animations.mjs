#!/usr/bin/env node
/**
 * Reusable per-employee Meshy Animation-API pose generator.
 *
 * Calls Meshy's Animation Library endpoint against an already-RIGGED
 * character task_id to bake in extra preset poses (idle, shrug, thinking,
 * sit, ...) beyond whatever walk/run came bundled free with rigging.
 *
 * Endpoint confirmed live against this account (GET /openapi/v1/animations
 * lists prior "animate"-type tasks; GET /openapi/v1/animations/{id} returns
 * a single one) — POST /openapi/v1/animations submits a new one with body
 * { rig_task_id, action_id } (NOT "input_task_id" — confirmed via the API's
 * own 400 validation error naming the Go struct field RigTaskID). Result
 * nests the GLB under result.animation_glb_url (NOT top-level, NOT
 * "glb_url" — this bit a prior throwaway script). action_id values per
 * https://docs.meshy.ai/en/api/animation-library (confirmed by scraping
 * that page's table): Idle=0, Chair_Sit_Idle_M=33, Confused_Scratch=36,
 * Shrug=317.
 *
 * Run:
 *   node scripts/avatar-pipeline/meshy-generate-pose-animations.mjs <employeeName> <riggedTaskId> <poseName>:<actionId> [<poseName>:<actionId> ...]
 *
 * Example (bonv2, 3 poses):
 *   node scripts/avatar-pipeline/meshy-generate-pose-animations.mjs bonv2 01a01d64-68cb-7932-a9b5-91b39b60cf1e \
 *     idle:1 shrug:317 thinking:36 sit:33
 *
 * Output: scripts/avatar-pipeline/output/meshy-employees/<employeeName>/<employeeName>-<poseName>.glb
 *   (+ any returned .fbx / -armature.glb variants, and a per-task
 *   <employeeName>-<poseName>.task.json with task id, action id, credits,
 *   timestamps, result URLs and expiry — no secrets). Added 2026-08-28.
 *   Refuses to overwrite an existing <employeeName>-<poseName>.glb.
 *   Poses run strictly sequentially (one task in flight at a time).
 *
 * SECURITY: never log/print process.env.MESHY_API_KEY / the loaded key.
 * COST WARNING: each pose submitted here is a real, paid Meshy Animation
 * task (~3 credits each per this account's own task history).
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
  const data = await meshyFetch(apiKey, "GET", "/v1/balance");
  if (typeof data.balance !== "number") {
    throw new Error("Balance endpoint returned an unexpected shape (no numeric 'balance' field)");
  }
  return data.balance;
}

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${outPath}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { outPath, bytes: buf.length };
}

async function submitAnimation(apiKey, inputTaskId, actionId) {
  console.log(`[pose-anim] submitting POST /v1/animations input_task_id=${inputTaskId} action_id=${actionId} ...`);
  console.log("[pose-anim] COST WARNING: real, paid Meshy API call (~3 credits).");
  const result = await meshyFetch(apiKey, "POST", "/v1/animations", {
    rig_task_id: inputTaskId,
    action_id: actionId,
  });
  if (!result.result) throw new Error("Animation submit response missing 'result' (task id) field");
  console.log(`[pose-anim] Animation task submitted. task_id = ${result.result}`);
  return result.result;
}

async function pollAnimation(apiKey, taskId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const task = await meshyFetch(apiKey, "GET", `/v1/animations/${taskId}`);
    console.log(`[pose-anim]   status=${task.status} progress=${task.progress ?? "?"}`);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const msg = (task.task_error && task.task_error.message) || `task ended with status ${task.status}`;
      throw new Error(`Meshy animation task ${task.status}: ${msg}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for animation task ${taskId}`);
}

function usageAndExit() {
  console.error(
    "Usage: node scripts/avatar-pipeline/meshy-generate-pose-animations.mjs <employeeName> <riggedTaskId> <poseName>:<actionId> [...]",
  );
  process.exit(1);
}

async function main() {
  const employeeName = process.argv[2];
  const riggedTaskId = process.argv[3];
  const poseArgs = process.argv.slice(4);
  if (!employeeName || !riggedTaskId || poseArgs.length === 0) return usageAndExit();

  const poses = poseArgs.map((arg) => {
    const [name, actionIdStr] = arg.split(":");
    const actionId = Number(actionIdStr);
    if (!name || !Number.isFinite(actionId)) {
      console.error(`Bad pose arg "${arg}" — expected <poseName>:<actionId>`);
      process.exit(1);
    }
    return { name, actionId };
  });

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
    console.log(`[pose-anim] Auth OK. Credit balance before: ${balanceBefore}`);

    const downloaded = [];
    for (const { name } of poses) {
      const p = path.join(outDir, `${employeeName}-${name}.glb`);
      if (fs.existsSync(p)) throw new Error(`Refusing to overwrite existing clip: ${p} — use a different pose name`);
    }
    for (const { name, actionId } of poses) {
      const submittedAt = new Date().toISOString();
      const taskId = await submitAnimation(apiKey, riggedTaskId, actionId);
      const task = await pollAnimation(apiKey, taskId);
      const url = task.result && task.result.animation_glb_url;
      if (!url) {
        console.error(`[pose-anim] SUCCEEDED task ${task.id} has no result.animation_glb_url — full result:`);
        console.error(JSON.stringify(task.result, null, 2));
        throw new Error(`pose "${name}" (action_id=${actionId}) succeeded but produced no downloadable GLB`);
      }
      const outPath = path.join(outDir, `${employeeName}-${name}.glb`);
      const d = await downloadFile(url, outPath);
      console.log(`[pose-anim] ${name}: SUCCESS task_id=${task.id} consumed_credits=${task.consumed_credits ?? "?"} -> ${d.outPath} (${d.bytes} bytes)`);
      downloaded.push({ name, actionId, taskId: task.id, ...d });
      // Extra artifacts (fbx / armature-only glb) when the API returns them.
      const extras = [];
      for (const [k, v] of Object.entries(task.result || {})) {
        if (k === "animation_glb_url" || typeof v !== "string" || !/^https?:/.test(v)) continue;
        const ext = /fbx/i.test(k) ? "fbx" : "glb";
        const suffix = /armature/i.test(k) ? "-armature" : "";
        const extraOut = path.join(outDir, `${employeeName}-${name}${suffix}.${ext}`);
        if (fs.existsSync(extraOut)) continue;
        extras.push({ key: k, url: v, ...(await downloadFile(v, extraOut)) });
      }
      fs.writeFileSync(path.join(outDir, `${employeeName}-${name}.task.json`), JSON.stringify({
        step: "animation", employee: employeeName, clip: name, rig_task_id: riggedTaskId, action_id: actionId,
        endpoint: "POST /openapi/v1/animations", task_id: task.id, consumed_credits: task.consumed_credits ?? null,
        submitted_at: submittedAt, finished_at: new Date().toISOString(),
        meshy_created_at: task.created_at ?? null, meshy_finished_at: task.finished_at ?? null, expires_at: task.expires_at ?? null,
        result_urls: task.result || {}, output: outPath, bytes: d.bytes, extras,
      }, null, 2));
    }

    const balanceAfter = await checkBalance(apiKey);
    console.log("");
    console.log("[pose-anim] ALL POSES SUCCEEDED");
    for (const d of downloaded) {
      console.log(`[pose-anim]   ${d.name} (action_id=${d.actionId}) -> ${d.outPath} (${d.bytes} bytes)`);
    }
    console.log(`[pose-anim] Credit balance before=${balanceBefore} after=${balanceAfter} (spent ${balanceBefore - balanceAfter})`);
  } catch (err) {
    const message = redact(String(err && err.message ? err.message : err), apiKey);
    console.error(`[pose-anim] FAILED: ${message}`);
    if (err && err.body) {
      console.error("[pose-anim] response body:", JSON.stringify(err.body, null, 2));
    }
    process.exit(1);
  }
}

main();
