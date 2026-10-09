// studio/server.mjs — HUMANBASE STUDIO: the local, click-through avatar pipeline (DEV-ONLY, localhost, zero credits unless the user
// approves a Meshy generation on the page). From frontend/:
//   node scripts/avatar-pipeline/human-base/studio/server.mjs        → http://localhost:8094
// (the animated preview uses the running Vite dev server: http://localhost:5173/virtual-office/human-base-lineup.html)
//
// Steps per employee (each is an existing pipeline script, run as a background job with a persisted log — the page can be closed
// and re-opened, a restarted server marks unfinished jobs "interrupted" and the step can be re-run):
//   1 reference  pick an approved illustration (Stage 0 population) or upload one
//   2 identity   Stage 0 trace (reused if present; new uploads need the local MediaPipe model)  → trace sheet
//   3 meshy      reuse the employee's raw Meshy head; a NEW generation (≈30 credits) runs ONLY after the page's explicit approval
//   4 build      chibify → AUTOMATIC IDENTITY CORRECTION → accessories → optimise → fail-closed gate (build-employees --correct)
//   5 preview    the gated candidate on the production HumanBase body (lineup page, idle / walk / run / sit)
//   6 export     candidate + reports + comparison sheet → output/human-base/exports/<who>/ (never production/)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
const PORT = Number(process.env.STUDIO_PORT ?? 8094), ROOT = process.cwd(), H = "scripts/avatar-pipeline/human-base", O = "scripts/avatar-pipeline/output/human-base", S = `${O}/studio`;
if (!fs.existsSync(`${ROOT}/package.json`) || !fs.existsSync(`${ROOT}/${H}`)) { console.error("run from frontend/"); process.exit(2); }
fs.mkdirSync(`${S}/logs`, { recursive: true }); fs.mkdirSync(`${S}/uploads`, { recursive: true });
const JOBS = `${S}/jobs.json`, jobs = fs.existsSync(JOBS) ? JSON.parse(fs.readFileSync(JOBS, "utf8")) : [];
for (const j of jobs) if (j.status === "running") { j.status = "interrupted"; j.note = "server restarted while running — re-run the step"; }
const save = () => fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1));
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const POP = `${O}/stage1-proof/population`, S0 = `${O}/stage0-identity`;

/** what we know about every person: illustration, Stage 0 record, raw Meshy head, recipe, corrected candidate, export */
function people() { const pop = read(`${POP}/identity.json`)?.results ?? {}, s0 = read(`${S0}/identity.json`)?.results ?? {}, up = read(`${S}/uploads.json`) ?? {}, rec = read(`${H}/employees.json`)?.employees ?? {};
  const ids = [...new Set([...Object.keys(rec), ...Object.keys(pop), ...Object.keys(up)])].sort(), out = [];
  for (const id of ids) { const key = pop[id] || s0[id] ? id : id === "bon" && pop.jerevon ? "jerevon" : id, ill = up[id]?.file ?? (fs.existsSync(`${POP}/${key}-canonical.png`) ? `${POP}/${key}-canonical.png` : null);
    const raw = `scripts/avatar-pipeline/output/meshy-employees/${id}-head-v1/raw-untouched/${id}-head-v1-raw-model.glb`, rep = read(`${O}/candidates/${id}/report.corrected.json`), cand = ["corr-pass2", "corr-pass1"].map((t) => `${O}/candidates/${id}/${t}/${id}-v1.glb`).find((f) => fs.existsSync(f)) ?? null;
    const upS0 = fs.existsSync(`${S}/stage0/${id}/identity.json`) && !!read(`${S}/stage0/${id}/identity.json`)?.results?.[id]?.contour;
    out.push({ id, illustration: ill, stage0: !!(pop[key] || s0[key] || upS0), stage0Key: key, rawMeshy: fs.existsSync(raw) ? raw : null, recipe: rec[id] ?? null, frozen: ["bon", "micah", "angelo", "clang", "france"].includes(id),
      candidate: cand, gate: rep ? { automatedPass: rep.automatedPass, failed: rep.failed, signoff: rep.signoffRequired, mount: rep.validatedMount, correction: rep.identityCorrection } : null,
      sheet: fs.existsSync(`${O}/exports/${id}/${id}-pipeline-sheet.png`) ? `${O}/exports/${id}/${id}-pipeline-sheet.png` : null, exported: fs.existsSync(`${O}/exports/${id}/manifest.json`),
      jobs: jobs.filter((j) => j.who === id).slice(-8) }); }
  return out; }

/** one background job (an existing pipeline script), log persisted */
function startJob(who, step, cmd, args, env = {}) { const id = `${who}-${step}-${Date.now()}`, log = `${S}/logs/${id}.log`, j = { id, who, step, status: "running", startedAt: new Date().toISOString(), log, cmd: [cmd, ...args].join(" ") }; jobs.push(j); save();
  const out = fs.openSync(log, "a"), p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", out, out] });
  p.on("exit", (code) => { j.status = code === 0 ? "done" : "failed"; j.exitCode = code; j.endedAt = new Date().toISOString(); save(); });
  return j; }
const running = (who) => jobs.some((j) => j.who === who && j.status === "running");

const STEPS = {
  identity: (who, p) => { if (p.stage0) return startJob(who, "identity", "node", [`${H}/studio/trace-sheet.mjs`, who]);
    if (!p.illustration) return { error: "upload an illustration first" };   // a NEW upload: the approved Stage 0 extractor on it (needs the free local model once)
    return startJob(who, "identity", "sh", ["-c", `node ${H}/studio/setup-mediapipe.mjs && node ${H}/studio/identity-upload.mjs ${who} "${p.illustration}"`]); },
  meshy: (who, p, body) => { if (p.rawMeshy) return { reused: p.rawMeshy, credits: 0, note: "existing Meshy head reused — zero credits" };
    if (!body.approveCredits) return { needsApproval: true, estimate: "≈30 Meshy credits (one image-to-3D head; no remesh, rig or animation needed — HumanBase provides the body + rig)" };
    if (!p.illustration) return { error: "no illustration" };
    return startJob(who, "meshy", "sh", ["-c", `node ${H}/prep-reference.mjs "${p.illustration}" ${O}/meshy-ref/${who} ${who}-head-ref && node ${H}/meshy-head-image-to-3d.mjs ${who}-head-v1 ${O}/meshy-ref/${who}/${who}-head-ref.png && node ${H}/studio/meshy-file-raw.mjs ${who}`]); },
  build: (who, p) => { if (!p.rawMeshy) return { error: "no raw Meshy head yet (step 3)" }; if (!p.recipe) return { error: `no recipe for ${who} in employees.json (hair / accessories) — add one` }; if (!p.stage0) return { error: "no Stage 0 identity (step 2)" };
    return startJob(who, "build", "node", ["--max-old-space-size=3072", `${H}/build-employees.mjs`, `--only=${who}`, "--correct"]); },
  sheet: (who) => startJob(who, "sheet", "node", ["--max-old-space-size=3072", `${H}/studio/pipeline-sheet.mjs`, who]),
  export: (who, p) => { if (!p.candidate || !p.gate) return { error: "build first (step 4)" };
    return startJob(who, "export", "node", [`${H}/studio/export.mjs`, who]); },
};

const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".glb": "model/gltf-binary", ".log": "text/plain", ".html": "text/html" };
http.createServer(async (req, res) => { const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname === "/") return send(res, 200, fs.readFileSync(`${H}/studio/index.html`), "text/html");
    if (u.pathname === "/api/people") return send(res, 200, people());
    if (u.pathname === "/file") { const f = path.resolve(ROOT, u.searchParams.get("path") ?? ""); if (!f.startsWith(path.resolve(ROOT, "scripts/avatar-pipeline/output")) || !fs.existsSync(f)) return send(res, 404, { error: "not found" }); return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] ?? "application/octet-stream"); }
    if (u.pathname === "/api/log") { const j = jobs.find((x) => x.id === u.searchParams.get("id")); return send(res, 200, j && fs.existsSync(j.log) ? fs.readFileSync(j.log, "utf8").slice(-6000) : "", "text/plain"); }
    if (u.pathname === "/api/upload" && req.method === "POST") { const who = (u.searchParams.get("name") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, ""); if (!who) return send(res, 400, { error: "name required" });
      const chunks = []; for await (const c of req) chunks.push(c); const f = `${S}/uploads/${who}.png`; fs.writeFileSync(f, Buffer.concat(chunks)); const up = read(`${S}/uploads.json`) ?? {}; up[who] = { file: f, at: new Date().toISOString() }; fs.writeFileSync(`${S}/uploads.json`, JSON.stringify(up, null, 1));
      // the employee's appearance recipe (hair length / motion / accessories) — the one documented place, a default the user can edit
      const R = read(`${H}/employees.json`), hair = ["natural", "chin", "shoulder", "upperBack"].includes(u.searchParams.get("hair")) ? u.searchParams.get("hair") : "natural";
      if (R && !R.employees[who]) { R.employees[who] = { ruleset: "v3", hair, ...(hair === "upperBack" || hair === "shoulder" ? { motion: "long" } : {}), headTris: 60000, accessories: [] }; fs.writeFileSync(`${H}/employees.json`, JSON.stringify(R, null, 1) + "\n"); }
      return send(res, 200, { ok: true, who }); }
    if (u.pathname === "/api/run" && req.method === "POST") { let b = ""; for await (const c of req) b += c; const body = JSON.parse(b || "{}"), who = body.who, step = body.step, p = people().find((x) => x.id === who);
      if (!p) return send(res, 404, { error: "unknown person" }); if (!STEPS[step]) return send(res, 400, { error: "unknown step" }); if (running(who)) return send(res, 409, { error: "a step is already running for this person" });
      return send(res, 200, STEPS[step](who, p, body)); }
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, 500, { error: String(e?.message ?? e) }); }
}).listen(PORT, "127.0.0.1", () => console.log(`HumanBase Studio → http://localhost:${PORT}  (preview needs the Vite dev server on :5173)`));
