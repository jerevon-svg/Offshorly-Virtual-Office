#!/usr/bin/env node
/**
 * Local avatar-generation server (Track 2: wiring the validated pipeline
 * into the app's real "Add Employee" flow).
 *
 * No external HTTP dependency — Node built-ins only (mirrors
 * review-server.mjs). Uses `sharp` (already a devDependency) only for the
 * post-generation frame-normalize step.
 *
 * Holds the OpenAI API key server-side ONLY. The browser never sees it —
 * it talks to this server through the Vite dev proxy (/avatar-api -> here).
 *
 * Run: node scripts/avatar-pipeline/gen-server.mjs   (or: npm run gen-server)
 *
 * Pipeline per job (real per-click API cost — approved by user, ~20-21
 * generations):
 *   1. ONE images/edits call: raw uploaded photo -> this employee's own
 *      "walk-left" anchor image (OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE +
 *      WALK_LEFT_ANCHOR_SUFFIX). This is the untested step in this build —
 *      flagged explicitly, and protected downstream by the app's existing
 *      Review step (the human eyeballs the result before it's saved).
 *   2. The validated 20-slot loop against that anchor (generateOne/SLOTS,
 *      reused verbatim from generate-production-v2.mjs). walk-left-1 is the
 *      anchor image itself, not regenerated (matches the validated recipe).
 *   3. Each output frame is normalized (background-keyed to transparent,
 *      trimmed, and letterboxed) to the app's real sprite frame size
 *      (191x240) so generated frames render cleanly on the map next to
 *      Bon's hand-authored sprites.
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY / the loaded key.
 * Any caught error is redacted before being written to stdout/stderr or
 * returned in an HTTP response.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  loadEnvKey,
  redact,
  generateOne,
  OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE,
  WALK_LEFT_ANCHOR_SUFFIX,
  SLOTS,
  SLOT_NAMES,
} from "./generate-production-v2.mjs";
import { normalizeFrame } from "./frame-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_ROOT = path.join(__dirname, "output", "local-test");
// review-server.mjs already owns 4747 — pick a different free port.
const PORT = 4748;
// Real uploaded-photo data URLs (base64) can be several MB; the
// review-server's 1MB cap is far too low here.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

let apiKey;
try {
  apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
} catch (err) {
  console.error(`Failed to read .env: ${err && err.message ? err.message : err}`);
}
if (!apiKey) {
  console.error("WARNING: OPENAI_API_KEY not found/empty in app/.env — /generate will fail until set.");
}

// In-memory job registry — single local user, process-lifetime only.
const jobs = new Map();

// ---- safety helpers --------------------------------------------------

function isSafeSegment(seg) {
  return typeof seg === "string" && seg.length > 0 && !seg.includes("..") && !seg.includes("/") && !seg.includes("\\");
}

// ---- HTTP plumbing -----------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---- job pipeline --------------------------------------------------------

function jobDir(jobId) {
  return path.join(OUTPUT_ROOT, jobId);
}

async function runJob(jobId, photoBuffer, employeeName) {
  const job = jobs.get(jobId);
  const dir = jobDir(jobId);
  fs.mkdirSync(dir, { recursive: true });

  console.log(`[gen-server] job ${jobId} started (name: ${employeeName || "(unnamed)"})`);

  try {
    // Step 1 (untested/experimental, gated by the app's Review step):
    // raw photo -> this employee's own walk-left anchor.
    job.currentSlot = "anchor";
    const anchorPrompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${WALK_LEFT_ANCHOR_SUFFIX}`;
    const rawPhotoBlob = new Blob([photoBuffer], { type: "image/png" });
    const anchorBuffer = await generateOne(apiKey, anchorPrompt, rawPhotoBlob, `${jobId}/anchor`);

    // Every subsequent edit call re-uses this SAME anchor buffer (validated
    // recipe: never chain pose-to-pose).
    const anchorEditBlob = new Blob([anchorBuffer], { type: "image/png" });

    for (const slot of SLOT_NAMES) {
      job.currentSlot = slot;
      let frameBuffer;
      if (slot === "walk-left-1") {
        // Anchor copy, no extra generation spent — matches the validated
        // production-v2 recipe exactly.
        frameBuffer = anchorBuffer;
      } else {
        const prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${SLOTS[slot]}`;
        frameBuffer = await generateOne(apiKey, prompt, anchorEditBlob, `${jobId}/${slot}`);
      }
      const normalized = await normalizeFrame(frameBuffer);
      fs.writeFileSync(path.join(dir, `${slot}.png`), normalized);
      job.done += 1;
    }

    job.state = "done";
    job.currentSlot = null;
    console.log(`[gen-server] job ${jobId} done (${job.done}/${job.total} slots)`);
  } catch (err) {
    job.state = "error";
    job.error = redact(String(err && err.message ? err.message : err), apiKey);
    console.error(`[gen-server] job ${jobId} FAILED: ${job.error}`);
  }
}

// ---- server --------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // POST /generate {photoDataUrl, employeeName} -> {jobId}
    if (req.method === "POST" && url.pathname === "/generate") {
      if (!apiKey) {
        sendJson(res, 500, { error: "OPENAI_API_KEY not configured on server (check app/.env)" });
        return;
      }

      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }

      const { photoDataUrl, employeeName } = body || {};
      const match =
        typeof photoDataUrl === "string"
          ? /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(photoDataUrl.trim())
          : null;
      if (!match) {
        sendJson(res, 400, { error: "photoDataUrl must be a base64 image data URL (png/jpeg/webp)" });
        return;
      }

      const photoBuffer = Buffer.from(match[1], "base64");
      if (photoBuffer.length === 0) {
        sendJson(res, 400, { error: "photoDataUrl decoded to an empty image" });
        return;
      }

      const jobId = crypto.randomUUID();
      jobs.set(jobId, {
        state: "running",
        done: 0,
        total: SLOT_NAMES.length,
        currentSlot: "anchor",
        error: null,
      });

      // Fire-and-forget — client polls /status/:jobId for progress. Any
      // rejection not already caught inside runJob still marks the job
      // errored rather than hanging it forever.
      runJob(jobId, photoBuffer, typeof employeeName === "string" ? employeeName : "").catch((err) => {
        const job = jobs.get(jobId);
        if (job) {
          job.state = "error";
          job.error = redact(String(err && err.message ? err.message : err), apiKey);
        }
      });

      sendJson(res, 200, { jobId });
      return;
    }

    // GET /status/:jobId -> {state, done, total, currentSlot, error}
    const statusMatch = req.method === "GET" && /^\/status\/([^/]+)$/.exec(url.pathname);
    if (statusMatch) {
      const jobId = decodeURIComponent(statusMatch[1]);
      if (!isSafeSegment(jobId)) {
        sendJson(res, 400, { error: "invalid jobId" });
        return;
      }
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { error: "job not found" });
        return;
      }
      sendJson(res, 200, {
        state: job.state,
        done: job.done,
        total: job.total,
        currentSlot: job.currentSlot,
        error: job.error,
      });
      return;
    }

    // GET /result/:jobId -> {avatarId, previewUrl, spriteSet}
    const resultMatch = req.method === "GET" && /^\/result\/([^/]+)$/.exec(url.pathname);
    if (resultMatch) {
      const jobId = decodeURIComponent(resultMatch[1]);
      if (!isSafeSegment(jobId)) {
        sendJson(res, 400, { error: "invalid jobId" });
        return;
      }
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { error: "job not found" });
        return;
      }
      if (job.state !== "done") {
        sendJson(res, 409, { error: `job not done (state: ${job.state})` });
        return;
      }

      const imgUrl = (slot) => `/image/${encodeURIComponent(jobId)}?slot=${encodeURIComponent(slot)}`;
      const spriteSet = {
        walk: {
          left: [imgUrl("walk-left-1"), imgUrl("walk-left-2")],
          right: [imgUrl("walk-right-1"), imgUrl("walk-right-2")],
          front: [imgUrl("walk-front-1"), imgUrl("walk-front-2")],
          back: [imgUrl("walk-back-1"), imgUrl("walk-back-2")],
        },
        idle: {
          left: imgUrl("idle-left"),
          right: imgUrl("idle-right"),
          front: imgUrl("idle-front"),
          back: imgUrl("idle-back"),
        },
        pat: {
          left: [imgUrl("pat-left-1"), imgUrl("pat-left-2")],
          right: [imgUrl("pat-right-1"), imgUrl("pat-right-2")],
          front: [imgUrl("pat-front-1"), imgUrl("pat-front-2")],
          back: [imgUrl("pat-back-1"), imgUrl("pat-back-2")],
        },
      };

      sendJson(res, 200, {
        avatarId: `avatar-${jobId}`,
        previewUrl: imgUrl("idle-front"),
        spriteSet,
      });
      return;
    }

    // GET /image/:jobId?slot=.. -> serve the normalized PNG
    const imageMatch = req.method === "GET" && /^\/image\/([^/]+)$/.exec(url.pathname);
    if (imageMatch) {
      const jobId = decodeURIComponent(imageMatch[1]);
      const slot = url.searchParams.get("slot") || "";

      if (!isSafeSegment(jobId) || !SLOT_NAMES.includes(slot)) {
        sendJson(res, 400, { error: "invalid params" });
        return;
      }

      const filePath = path.join(OUTPUT_ROOT, jobId, `${slot}.png`);
      if (!filePath.startsWith(OUTPUT_ROOT) || !fs.existsSync(filePath)) {
        sendJson(res, 404, { error: "not found" });
        return;
      }

      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": stat.size,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 500, { error: redact(String(err && err.message ? err.message : err), apiKey) });
  }
});

server.listen(PORT, () => {
  console.log(`Avatar generation server running at http://localhost:${PORT}`);
});
