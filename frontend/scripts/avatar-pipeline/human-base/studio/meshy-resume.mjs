// studio/meshy-resume.mjs — RESUME an already-submitted Meshy head task after an interruption: READ-ONLY GETs (status polls + downloads),
// never a new submission, never credits. The task id is in the job log / task record.
//   node scripts/avatar-pipeline/human-base/studio/meshy-resume.mjs <who> <taskId>
import fs from "node:fs";
import path from "node:path";
import { loadEnvKey } from "../../generate-production-v2.mjs";
const [who, taskId] = process.argv.slice(2), NAME = `${who}-head-v1`, OUT = `scripts/avatar-pipeline/output/meshy-employees/${NAME}/raw-untouched`, API = "https://api.meshy.ai/openapi";
if (!who || !taskId) { console.error("usage: meshy-resume.mjs <who> <taskId>"); process.exit(2); }
const KEY = loadEnvKey(path.resolve(".env"), "MESHY_API_KEY"), get = async (p) => { const r = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${KEY}` } }); const j = await r.json(); if (!r.ok) throw new Error(`GET ${p}: ${r.status} ${j.message ?? ""}`); return j; };
let task; const deadline = Date.now() + 20 * 60_000;
while (Date.now() < deadline) { try { task = await get(`/v1/image-to-3d/${taskId}`); console.log(`[resume] ${task.status} ${task.progress ?? ""}`); if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) break; } catch (e) { console.log(`[resume] poll error (read-only): ${e.message}`); } await new Promise((r) => setTimeout(r, 10_000)); }
if (task?.status !== "SUCCEEDED") { console.error(`[resume] task ${task?.status ?? "unknown"}`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true }); const grab = async (label, url, ext) => { if (!url) return; const r = await fetch(url); if (!r.ok) return; fs.writeFileSync(path.join(OUT, `${NAME}-raw-${label}.${ext}`), Buffer.from(await r.arrayBuffer())); console.log(`  ${label}`); };
for (const [fmt, url] of Object.entries(task.model_urls ?? {})) await grab(fmt === "glb" ? "model" : fmt, url, fmt === "pre_remeshed_glb" ? "glb" : fmt);
for (const [i, t] of (task.texture_urls ?? []).entries()) for (const [kind, url] of Object.entries(t ?? {})) await grab(`tex${i}-${kind}`, url, "png");
fs.writeFileSync(path.join(OUT, `${NAME}-image-to-3d.task.json`), JSON.stringify({ step: "image-to-3d (resumed, read-only)", employee: NAME, task_id: taskId, status: task.status, consumed_credits: task.consumed_credits ?? null, finished_at: new Date().toISOString() }, null, 2));
console.log(`[resume] done → ${OUT}`);
