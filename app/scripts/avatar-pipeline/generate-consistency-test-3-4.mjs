#!/usr/bin/env node
/**
 * Consistency test: ONE 3/4-view (front-left, moderate turn) pose per person
 * for Bon, Alex, Micah, Lui — 4 total generations, single-image edit each,
 * using each person's OWN approved anchor only (no cross-reference).
 *
 * Reuses OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE from generate-production-v2.mjs
 * (the current production base prompt, including the eye-construction rule
 * added this session) rather than hand-writing a new prompt.
 *
 * Lesson applied from the prior size-mismatch bug: output size is set to
 * match each anchor's OWN dimensions/aspect as closely as gpt-image-1's
 * allowed size enum permits (1024x1024 | 1024x1536 | 1536x1024), not a
 * fixed size copied from another script. Where the anchor's exact pixel
 * dimensions aren't square (Lui: 191x240), the closest-aspect enum size is
 * requested, then center-cropped + resized down to the anchor's exact
 * original pixel dimensions as a post-process (documented, not silent).
 *
 * Output: output/consistency-test-3-4/{bon,alex,micah,lui}.png
 *
 * SECURITY: never log/print process.env.OPENAI_API_KEY. Errors are
 * redacted before printing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEnvKey, redact, OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE } from "./generate-production-v2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(APP_ROOT, ".env");
const OUTPUT_DIR = path.join(__dirname, "output", "consistency-test-3-4");
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

const THREE_QUARTER_POSE = `Now, put this character in a standard moderate front-left 3/4 turned pose: the body and head are turned partially toward the camera's left, showing a partial profile view (not a full side profile, and not a steep overhead or back-facing angle) — a normal moderate 3/4 turn from the character's current pose. Keep everything else (identity, clothing, art style, lighting, camera, scale) exactly the same as the input image.`;

function getPixelDims(filePath) {
  const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], {
    encoding: "utf8",
  });
  const w = Number(out.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const h = Number(out.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!w || !h) throw new Error(`Could not parse pixel dimensions for ${filePath}`);
  return { width: w, height: h };
}

// gpt-image-1 images/edits only accepts a fixed enum of output sizes.
// Pick whichever enum size has the closest aspect ratio to the anchor.
function pickApiSize({ width, height }) {
  const targetAspect = width / height;
  const candidates = [
    { size: "1024x1024", aspect: 1024 / 1024 },
    { size: "1024x1536", aspect: 1024 / 1536 },
    { size: "1536x1024", aspect: 1536 / 1024 },
  ];
  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(c.aspect - targetAspect);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best.size;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callImagesEdit(apiKey, form, label) {
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    const msg = redact(String(err?.message ?? err), apiKey);
    throw new Error(`Network error calling OpenAI (${label}): ${msg}`);
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    const msg = redact(bodyText, apiKey);
    throw new Error(`OpenAI API error ${res.status} (${label}): ${msg}`);
  }
  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI response missing data[0].b64_json (${label})`);
  return Buffer.from(b64, "base64");
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

async function generateOne(apiKey, prompt, anchorBlob, apiSize, label) {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image[]", anchorBlob, "anchor.png");
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", apiSize);
  return callImagesEdit(apiKey, form, label);
}

const PEOPLE = [
  {
    name: "bon",
    anchor: path.join(__dirname, "output", "bon-walk-left-e2v2-3.png"),
  },
  {
    name: "alex",
    anchor: path.join(__dirname, "output", "alex-walk-left-e2v2-1.png"),
  },
  {
    name: "micah",
    anchor: path.join(__dirname, "output", "micah-walk-left-e2v2-1.png"),
  },
  {
    name: "lui",
    anchor: path.join(
      __dirname,
      "output",
      "local-test",
      "daf6e744-78fd-46a6-919a-6d41d5bb5239",
      "idle-front.png"
    ),
  },
];

async function main() {
  if (!existsSync(ENV_PATH)) throw new Error(`.env not found at ${ENV_PATH}`);
  const apiKey = loadEnvKey(ENV_PATH, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not found/empty in .env");
  for (const person of PEOPLE) {
    if (!existsSync(person.anchor)) throw new Error(`Anchor not found for ${person.name} at ${person.anchor}`);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const results = [];

  for (const person of PEOPLE) {
    const anchorDims = getPixelDims(person.anchor);
    const apiSize = pickApiSize(anchorDims);
    const exactMatch = apiSize === `${anchorDims.width}x${anchorDims.height}`;
    console.log(
      `-- ${person.name}: anchor ${anchorDims.width}x${anchorDims.height}, requesting API size ${apiSize}${
        exactMatch ? " (exact match)" : " (closest allowed aspect, will crop/resize to exact anchor dims)"
      } --`
    );

    const anchorBuffer = readFileSync(person.anchor);
    const anchorBlob = new Blob([anchorBuffer], { type: "image/png" });
    const prompt = `${OFFSHORLY_CHIBI_PROMPT_BASE_SINGLE}${THREE_QUARTER_POSE}`;
    const label = `${person.name}/three-quarter`;
    const outPath = path.join(OUTPUT_DIR, `${person.name}.png`);

    const buf = await withRetry(() => generateOne(apiKey, prompt, anchorBlob, apiSize, label), label);
    writeFileSync(outPath, buf);

    let finalDims = null;
    if (!exactMatch) {
      // Center-crop to the anchor's aspect ratio, then resize down to its
      // exact pixel dimensions, so the saved file matches the anchor size.
      const [apiW, apiH] = apiSize.split("x").map(Number);
      const targetAspect = anchorDims.width / anchorDims.height;
      let cropW = apiW;
      let cropH = Math.round(apiW / targetAspect);
      if (cropH > apiH) {
        cropH = apiH;
        cropW = Math.round(apiH * targetAspect);
      }
      execFileSync("sips", ["-c", String(cropH), String(cropW), outPath]);
      execFileSync("sips", ["-z", String(anchorDims.height), String(anchorDims.width), outPath]);
      finalDims = getPixelDims(outPath);
    } else {
      finalDims = getPixelDims(outPath);
    }

    console.log(`   saved ${outPath} (final dims ${finalDims.width}x${finalDims.height})`);
    results.push({ person: person.name, anchorDims, apiSize, finalDims, outPath });
  }

  console.log(`\n=== SUMMARY ===`);
  for (const r of results) {
    console.log(
      `${r.person}: anchor ${r.anchorDims.width}x${r.anchorDims.height} -> api ${r.apiSize} -> saved ${r.finalDims.width}x${r.finalDims.height}`
    );
  }
}

main().catch((err) => {
  console.error(`Consistency test FAILED: ${err?.message ?? err}`);
  process.exit(1);
});
