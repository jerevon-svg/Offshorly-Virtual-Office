// meshy-head-image-to-3d.mjs — ONE Meshy image-to-3D call for the approved Bon HEAD proof (HumanBase). PAID: 30 credits.
//
//   node scripts/avatar-pipeline/human-base/meshy-head-image-to-3d.mjs --dry-run   (prints the payload, no network)
//   node scripts/avatar-pipeline/human-base/meshy-head-image-to-3d.mjs             (the single paid submission)
//
// Why this exists: meshy-generate-employee-3d.mjs (protected, not modified) always sends `pose_mode`, and Meshy accepts
// only "a-pose" | "t-pose" — both full-body settings. A head-only reference must omit the field entirely.
// Same settings as the approved plan otherwise. Image-to-3D ONLY: there is no remesh, rig or animation code here.
// NO RETRY: the POST is made exactly once; a rejection or network error stops the script. After a task id exists, only
// read-only GETs (status polls, downloads, balance) are made.
import fs from "node:fs";
import path from "node:path";
import { loadEnvKey } from "../generate-production-v2.mjs";

// usage: meshy-head-image-to-3d.mjs [name] [image.png] [--dry-run]   (defaults: the approved Bon proof)
const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const NAME = POS[0] ?? "bon-head-v1";
const IMAGE = POS[1] ?? "scripts/avatar-pipeline/output/human-base/meshy-ref/bon-head-ref-final.png";
const OUT = `scripts/avatar-pipeline/output/meshy-employees/${NAME}`;
const API = "https://api.meshy.ai/openapi";
const DRY = process.argv.includes("--dry-run");
// NEVER OVERWRITE A PAID HEAD (2026-10-13): the target folder must hold no download, task record or filed raw head — a new head is a
// new version folder (head-version.mjs). Checked before anything else, the dry run included.
const taken = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((f) => f.startsWith(`${NAME}-raw-`) || f.endsWith(".task.json") || f === "raw-untouched") : [];
if (taken.length) { console.error(`[head] REFUSED: ${OUT} already holds a paid head (${taken.slice(0, 3).join(", ")}) — a new head needs a new version folder`); process.exit(1); }
console.log(`[head] target ${OUT} holds no paid head — nothing can be overwritten`);

// the request, exactly as approved — NO pose_mode key
const SETTINGS = {
  ai_model: "latest",
  should_texture: true,
  texture_resolution: "2k",
  should_remesh: false,
  target_formats: ["glb"],
  multi_view_thumbnails: true,
};

const img = fs.readFileSync(IMAGE);
const body = { image_url: `data:image/png;base64,${img.toString("base64")}`, ...SETTINGS };
// safety: the pose field must be genuinely absent, and nothing but image-to-3D may be requested
if (Object.prototype.hasOwnProperty.call(body, "pose_mode")) throw new Error("pose_mode present — refusing");
if (body.should_remesh !== false) throw new Error("remesh requested — refusing");
console.log(`[bon-head] image ${IMAGE} (${img.length} bytes, sha-prefix ${(await import("node:crypto")).createHash("sha1").update(img).digest("hex").slice(0, 12)})`);
console.log(`[bon-head] payload keys: ${Object.keys(body).join(", ")}`);
console.log(`[bon-head] settings: ${JSON.stringify(SETTINGS)}`);
console.log(`[bon-head] pose_mode present: ${"pose_mode" in body}`);
if (DRY) { console.log("[bon-head] DRY RUN — nothing sent."); process.exit(0); }

const key = loadEnvKey(path.resolve(".env"), "MESHY_API_KEY");
if (!key) throw new Error("MESHY_API_KEY missing");
async function call(method, p, b) {
  const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${key}`, ...(b ? { "Content-Type": "application/json" } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const text = await res.text(); let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) { const e = new Error(`${method} ${p}: ${res.status} ${json.message ?? ""}`); e.body = json; throw e; }
  return json;
}
const balance = async () => (await call("GET", "/v1/balance")).balance;

fs.mkdirSync(OUT, { recursive: true });
const startedAt = new Date().toISOString();
const balanceBefore = await balance();
console.log(`[bon-head] balance before: ${balanceBefore}`);
if (balanceBefore < 30) throw new Error("balance below 30 — not submitting");

// ---- THE single paid submission (never repeated) ----
let taskId;
try { taskId = (await call("POST", "/v1/image-to-3d", body)).result; }
catch (e) { console.error(`[bon-head] SUBMIT FAILED — stopping, no retry: ${e.message}`); if (e.body) console.error(JSON.stringify(e.body)); process.exit(1); }
if (!taskId) { console.error("[bon-head] submit returned no task id — stopping"); process.exit(1); }
console.log(`[bon-head] task ${taskId} submitted`);

// ---- read-only status polls (a failed GET is retried as a GET; nothing is ever re-submitted) ----
let task; const deadline = Date.now() + 15 * 60_000;
while (Date.now() < deadline) {
  try { task = await call("GET", `/v1/image-to-3d/${taskId}`); } catch (e) { console.log(`[bon-head] poll error (read-only, continuing): ${e.message}`); task = null; }
  if (task) { console.log(`[bon-head] status ${task.status} ${task.progress ?? ""}`); if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break; }
  await new Promise((r) => setTimeout(r, 8000));
}
if (!task || task.status !== "SUCCEEDED") { console.error(`[bon-head] task ended ${task?.status ?? "unknown"}: ${task?.task_error?.message ?? ""}`); }

// ---- download every artifact untouched ----
const got = [];
const grab = async (label, url, ext) => { if (typeof url !== "string" || !url) return; const res = await fetch(url); if (!res.ok) { console.log(`[bon-head] download ${label} HTTP ${res.status}`); return; }
  const buf = Buffer.from(await res.arrayBuffer()), out = path.join(OUT, `${NAME}-raw-${label}.${ext}`); fs.writeFileSync(out, buf); got.push({ label, outPath: out, bytes: buf.length }); };
if (task?.status === "SUCCEEDED") {
  for (const [fmt, url] of Object.entries(task.model_urls ?? {})) await grab(fmt === "glb" ? "model" : fmt, url, fmt === "pre_remeshed_glb" ? "glb" : fmt);
  for (const [i, t] of (task.texture_urls ?? []).entries()) for (const [kind, url] of Object.entries(t ?? {})) await grab(`tex${i}-${kind}`, url, "png");
  await grab("thumbnail", task.thumbnail_url, "png");
  for (const [view, url] of Object.entries(task.thumbnail_urls ?? {})) await grab(`thumb-${view}`, url, "png");
}
const balanceAfter = await balance().catch(() => null);
const record = { step: "image-to-3d", employee: NAME, source_image: IMAGE, request_settings: SETTINGS, pose_mode: "omitted", task_id: taskId, status: task?.status ?? null,
  consumed_credits: task?.consumed_credits ?? null, balance_before: balanceBefore, balance_after: balanceAfter, started_at: startedAt, finished_at: new Date().toISOString(),
  expires_at: task?.expires_at ?? null, artifacts: got };
fs.writeFileSync(path.join(OUT, `${NAME}-image-to-3d.task.json`), JSON.stringify(record, null, 2));
console.log(`[bon-head] DONE status=${record.status} consumed_credits=${record.consumed_credits} balance ${balanceBefore} → ${balanceAfter}`);
for (const a of got) console.log(`  ${a.label} → ${a.outPath} (${a.bytes} bytes)`);
