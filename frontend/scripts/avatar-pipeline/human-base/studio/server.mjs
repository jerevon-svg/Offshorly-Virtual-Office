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
//   4 build      chibify → accessories → optimise → fail-closed gate (build-employees: the production-five path, no identity warp)
//   5 preview    the gated candidate on the production HumanBase body (lineup page, idle / walk / run / sit)
//   6 export     candidate + reports + comparison sheet → output/human-base/exports/<who>/ (never production/)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { deliveryCandidate, productionCandidate, newestSheet } from "../candidate-versions.mjs";
import { PAID, plan, stateOf } from "./orchestrator.mjs";
import { readProvenance, recordStage, sha256File, simulatedStages } from "./provenance.mjs";
import { allowedApis, claimOwner, parseAvatarRegistry, personIdForEmail, resolveSelf } from "./self-auth.mjs";
import { ESTIMATE, appendLedger, authorityConfig, authorize, failureEvidence, localGuard, meshyBalance, readLedger, reportRun, settle, settleLedger } from "./spend-authority.mjs";
import { preflight } from "./preflight.mjs";
import { recipeRawHead, recipeHeadVersion } from "../head-version.mjs";
const preflightFor = (who) => preflight(who);
import { runtimeAvatars, runtimeRecord } from "./runtime-avatars.mjs";
import { approvedSource } from "./approved-source.mjs";
import { recordFile } from "../prepare-head-version.mjs";
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
  for (const id of ids) { const key = pop[id] || s0[id] ? id : id === "bon" && pop.jerevon ? "jerevon" : id, ill = up[id]?.file ?? (fs.existsSync(`${S}/uploads/${id}.png`) ? `${S}/uploads/${id}.png` : fs.existsSync(`${POP}/${key}-canonical.png`) ? `${POP}/${key}-canonical.png` : null);   // an illustration made from a photo is on disk even before it was registered
    let raw = null; try { raw = recipeRawHead(id); } catch { /* an invalid recipe head version: no raw head (the build refuses it too) */ }
    const V = productionCandidate(id), rep = V?.report ?? null, cand = V?.file ?? null;   // the current production VERSION (candidate-versions.mjs PRODUCTION_KIND)
    const upS0 = fs.existsSync(`${S}/stage0/${id}/identity.json`) && !!read(`${S}/stage0/${id}/identity.json`)?.results?.[id]?.contour;
    out.push({ id, illustration: ill, stage0: !!(pop[key] || s0[key] || upS0), stage0Key: key, rawMeshy: raw && fs.existsSync(raw) ? raw : null, recipe: rec[id] ?? null, frozen: ["bon", "micah", "angelo", "clang", "france"].includes(id),
      candidate: cand, tag: V?.tag ?? null, gate: rep ? { automatedPass: rep.automatedPass, failed: rep.failed, signoff: rep.signoffRequired, mount: rep.validatedMount, correction: rep.identityCorrection } : null,
      sheet: V ? newestSheet(V.exportDir, id) : null, exported: !!V && fs.existsSync(`${V.exportDir}/manifest.json`),
      jobs: jobs.filter((j) => j.who === id).slice(-8), photo: up[id]?.photo ?? null, simulated: simulatedStages(id, `${S}/provenance`),
      provenance: Object.fromEntries(Object.entries(readProvenance(id, `${S}/provenance`).stages).map(([k, v]) => [k, v.mode])), pipeline: pipes[id] ? { status: pipes[id].status, error: pipes[id].error ?? null, reason: pipes[id].reason ?? null, evidence: pipes[id].evidence ?? null, plan: (() => { try { return plan(stateOf(id), pipes[id].opts ?? {}); } catch { return pipes[id].plan ?? null; } })() } : null }); }   // the LIVE plan, not the one saved before the last stage ran
  return out; }

/** one background job (an existing pipeline script), log persisted */
function startJob(who, step, cmd, args, env = {}, meta = {}) { const id = `${who}-${step}-${Date.now()}`, log = `${S}/logs/${id}.log`, j = { id, who, step, status: "running", startedAt: new Date().toISOString(), log, cmd: [cmd, ...args].join(" "), ...meta }; jobs.push(j); save();
  const out = fs.openSync(log, "a"), p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", out, out] });
  p.on("exit", (code) => { j.status = code === 0 ? "done" : "failed"; j.exitCode = code; j.endedAt = new Date().toISOString();
    // a build whose AUTOMATED gate passed exits non-zero only because the visual sign-off is still pending: that is not a failed build
    // (the flow continues to sheet / export); promotion stays human-gated in build-employees --promote
    if (step === "meshy" && code === 0) { const ill = `${S}/uploads/${who}.png`; recordStage(who, "meshy", { mode: "real", illustrationSha256: fs.existsSync(ill) ? sha256File(ill) : null }, `${S}/provenance`); }
    if (step === "build" && code !== 0) { const V = productionCandidate(who); if (V?.report?.automatedPass && !(V.report.failed ?? []).length && Date.parse(V.report.builtAt ?? 0) >= Date.parse(j.startedAt) - 1000) j.status = "awaiting-signoff"; }
    // THE EXACT BLOCKER: a failed job keeps its exit code, log tail and (for a build) the gate's own verdict — never retried here
    if (j.status === "failed") j.evidence = failureEvidence({ exitCode: code, log, report: step === "build" ? productionCandidate(who)?.report ?? null : null });
    // a PAID job settles its spend: locally always, with the backend authority when it granted it
    if (j.spend) { const ok = j.status === "done" && (step !== "meshy" || fs.existsSync(`scripts/avatar-pipeline/output/meshy-employees/${who}-head-v1/raw-untouched/${who}-head-v1-raw-model.glb`));
      const outcome = ok ? "succeeded" : "failed", evidence = ok ? null : j.evidence ?? failureEvidence({ exitCode: code, log });
      settleLedger(LEDGER, j.spend.localId, { outcome, endedAt: new Date().toISOString(), evidence });
      if (AUTH && j.spend.recordId) void settle(AUTH, j.spend.recordId, outcome, { evidence }); }
    save(); });
  return j; }
const running = (who) => jobs.some((j) => j.who === who && j.status === "running");

const POPKEY = (w) => { const pop = read(`${POP}/identity.json`)?.results ?? {}; return pop[w] ? w : w === "bon" && pop.jerevon ? "jerevon" : w; };
const mockIllustration = (m) => (m && fs.existsSync(String(m)) ? String(m) : fs.existsSync(`${POP}/${POPKEY(String(m))}-canonical.png`) ? `${POP}/${POPKEY(String(m))}-canonical.png` : null);
// ---- THE SPEND GATE: every paid stage, manual or automatic, asks here first (spend-authority.mjs) -------------------------
const LEDGER = `${S}/spend-ledger.json`, AUTH = authorityConfig();
const ownerEmail = (who) => (read(`${S}/owners.json`) ?? {})[who] ?? read(`${S}/uploads.json`)?.[who]?.email ?? null;
function hasCharacter(who) { const mounts = read("src/dev/vo3d/avatar/humanMounts.generated.json") ?? {}; return ["bon", "micah", "angelo", "clang", "france"].includes(who) || !!mounts[who]; }
/** { ok, spend } to go ahead, or { ok: false, reason, codes, waitForHuman } — `dryRun` asks without recording anything */
async function spendGate(who, stage, { approvedBy = null, allowReroll = false, dryRun = false } = {}) {
  const mode = approvedBy ? "manual" : "auto", up = read(`${S}/uploads.json`)?.[who] ?? {}, refuse = (fails, waitForHuman = mode === "auto") => ({ ok: false, waitForHuman, codes: fails.map((f) => f.code), reason: fails.map((f) => f.message).join("; ") });
  if (mode === "auto" && !AUTH) return refuse([{ code: "no_authority", message: "no spend authority configured — an admin approves each paid step" }]);
  if (!up.photo || !fs.existsSync(up.photo)) return refuse([{ code: "no_photo", message: "no raw photo uploaded" }], false);
  const photoSha256 = sha256File(up.photo), ill = `${S}/uploads/${who}.png`, inputSha256 = stage === "illustrate" ? photoSha256 : fs.existsSync(ill) ? sha256File(ill) : null;
  if (!inputSha256) return refuse([{ code: "no_input", message: "no illustration to generate from" }], false);
  const consent = up.consent && up.consent.photoSha256 === photoSha256 ? up.consent : null;
  if (!consent) return refuse([{ code: "no_consent", message: "no consent recorded for this exact photo" }], false);
  const email = ownerEmail(who);
  if (!email) return refuse([{ code: "no_identity", message: "this person is not tied to a VO account email" }], false);
  const balance = stage === "meshy" ? await meshyBalance() : null;
  const local = localGuard(readLedger(LEDGER), { who, stage, inputSha256, approvedBy, allowReroll, balance });
  if (local.length) return refuse(local, local.some((f) => f.code === "retry_cap"));
  let recordId = null;
  if (AUTH) {
    const d = await authorize(AUTH, { email, personId: who, stage, inputSha256, photoSha256, estimate: ESTIMATE[stage].amount, mode, approvedBy, allowReroll,
      providerBalance: balance, hasApprovedCharacter: hasCharacter(who), consentAttestedBy: consent.attestedBy ?? null, dryRun });
    if (!d.allowed) return refuse(d.failures);
    recordId = d.recordId;
  }
  if (dryRun) return { ok: true, spend: null };
  const localId = `${who}-${stage}-${Date.now()}`;
  appendLedger(LEDGER, { id: localId, who, email, stage, inputSha256, photoSha256, mode, approvedBy, recordId, estimate: ESTIMATE[stage], at: new Date().toISOString(), outcome: null });
  return { ok: true, spend: { localId, recordId } };
}
const gateResult = (g, estimate) => (g.waitForHuman ? { needsApproval: true, estimate, reason: g.reason, codes: g.codes } : { error: `spend refused — ${g.reason}`, codes: g.codes });

const STEPS = {
  // 0 RAW PHOTO → the person's Offshorly illustration: PAID (one images/edits call) — runs only after explicit approval; a mock = SIMULATED
  illustrate: async (who, p, body) => { const up = read(`${S}/uploads.json`)?.[who]; if (!up?.photo || !fs.existsSync(up.photo)) return { error: "upload a raw photo first" };
    const st = stateOf(who); if (st.illustration.exists && st.illustration.fromCurrentPhoto && st.illustration.mode !== "uploaded") return { reused: `${S}/uploads/${who}.png`, credits: 0, note: "illustration already made from this photo" };
    if (body.mock) { const fx = mockIllustration(body.mock); if (!fx) return { error: `no fixture illustration for mock "${body.mock}"` }; return startJob(who, "illustrate", "node", [`${H}/studio/photo-illustration.mjs`, who, up.photo, `--mock=${fx}`], {}, { simulated: true }); }
    if (!body.approveCredits && !body.autoSpend) return { needsApproval: true, estimate: PAID.illustrate };
    const g = await spendGate(who, "illustrate", { approvedBy: body.approveCredits ? body.approvedBy || "studio-admin" : null, allowReroll: !!body.allowReroll });
    if (!g.ok) return gateResult(g, PAID.illustrate);
    return startJob(who, "illustrate", "node", [`${H}/studio/photo-illustration.mjs`, who, up.photo], {}, { spend: g.spend }); },
  // 2b automatic QA of the illustration (the Stage 0 input plausibility gate) — fail closed before any Meshy spend
  illustrationQA: (who) => startJob(who, "illustrationQA", "node", [`${H}/studio/illustration-qa.mjs`, who]),
  identity: (who, p) => { const up = read(`${S}/uploads.json`)?.[who], s0 = `${S}/stage0/${who}/identity.json`;
    const stale = !!up && (!fs.existsSync(s0) || fs.statSync(s0).mtimeMs < fs.statSync(up.file).mtimeMs);   // a NEW upload for this name: its identity must come from THIS image, never an earlier one
    if (p.stage0 && !stale) return startJob(who, "identity", "node", [`${H}/studio/trace-sheet.mjs`, who]);
    if (!p.illustration) return { error: "upload an illustration first" };   // a NEW upload: the approved Stage 0 extractor on it (needs the free local model once)
    return startJob(who, "identity", "sh", ["-c", `node ${H}/studio/setup-mediapipe.mjs && node ${H}/studio/identity-upload.mjs ${who} "${p.illustration}"`]); },
  meshy: async (who, p, body) => { const prov = readProvenance(who, `${S}/provenance`).stages.meshy;
    // NO HIDDEN FALLBACK, NO OVERWRITE: an existing head is reused only when it was made from THIS illustration; any other existing
    // head is a paid asset that a new generation would overwrite (the Meshy script writes in place), so the run stops and says so.
    if (p.rawMeshy && !stateOf(who).meshy.forCurrentIllustration) return { error: "a paid Meshy head made from a different illustration already exists for this person — it is never overwritten or reused for a new photo; a new head needs a new version folder (not automated yet)" };
    if (p.rawMeshy) return { reused: p.rawMeshy, credits: 0, mode: prov?.mode ?? "cached-own", note: prov?.mode === "SIMULATED" ? `SIMULATED head (fixture ${prov.from}) — not a generated identity` : "existing Meshy head reused — zero credits" };
    // a recipe naming a NEWER head version (head-version.mjs) is never generated or simulated here — prepare-head-version.mjs generates it under a named approval
    let hv = "v1"; try { hv = recipeHeadVersion(who); } catch (e) { return { error: e.message }; }
    if (hv !== "v1") return { error: `${who}'s recipe uses head ${hv}, which is not on disk — a versioned head is prepared and generated with prepare-head-version.mjs under a named approval, never from here` };
    if (body.mock) { const src = String(body.mock).toLowerCase().replace(/[^a-z0-9-]/g, ""), MD = "scripts/avatar-pipeline/output/meshy-employees", sd = `${MD}/${src}-head-v1/raw-untouched`, dd = `${MD}/${who}-head-v1/raw-untouched`;
      if (!fs.existsSync(`${sd}/${src}-head-v1-raw-model.glb`)) return { error: `no fixture head for mock "${src}"` }; fs.mkdirSync(dd, { recursive: true });
      for (const f of fs.readdirSync(sd)) { const t = `${dd}/${f.replace(`${src}-head-v1`, `${who}-head-v1`)}`; if (f.startsWith(`${src}-head-v1-raw-`) && !fs.existsSync(t)) fs.symlinkSync(path.resolve(sd, f), t); }
      recordStage(who, "meshy", { mode: "SIMULATED", from: `${src}-head-v1`, illustrationSha256: p.illustration && fs.existsSync(p.illustration) ? sha256File(p.illustration) : null, note: "a fixture head stands in for the paid image-to-3D generation — NOT this person's identity" }, `${S}/provenance`);
      return { simulated: true, from: `${src}-head-v1`, credits: 0 }; }
    const est = "≈30 Meshy credits (one image-to-3D head; no remesh, rig or animation needed — HumanBase provides the body + rig)";
    // THE APPROVED-ILLUSTRATION PATH (the release scope: approved Stage A sprite → Meshy, no photo, so no photo consent): never auto-
    // spent; the guarded prepare-head-version tool prepares the reference (fail closed on a non-sprite) and makes the ONE paid call
    // under the named approver and the local spend rules (one attempt per input, nothing in flight, the Meshy reserve, no overwrite)
    if (!p.photo) { const src = approvedSource(who);
      if (!src) return { error: `no approved Stage A illustration for ${who} (a Studio upload or the roster sprite) — the population trace crop is not a Meshy reference` };
      if (!body.approveCredits) return { needsApproval: true, estimate: est, source: src };
      const approvedBy = String(body.approvedBy ?? "").trim().slice(0, 80); if (!approvedBy) return { error: "name the approver — every paid step records who approved it" };
      const rec = read(recordFile(who, "v1")); if (rec && rec.status !== "prepared") return { error: `${who}-head-v1 is ${rec.status} — one paid attempt per head, never a retry here` };
      if (rec && rec.illustration?.sha256 !== sha256File(src)) return { error: `${who}-head-v1 was prepared from a different illustration — prepare a new version with prepare-head-version.mjs` };
      const prep = rec ? "" : `node ${H}/prepare-head-version.mjs ${who} "$HB_SRC" --version=v1 && `;
      return startJob(who, "meshy", "sh", ["-c", `${prep}node ${H}/prepare-head-version.mjs ${who} --generate=v1 --approved-by="$HB_APPROVER"`], { HB_SRC: src, HB_APPROVER: approvedBy }, { approvedBy, source: src }); }
    if (!body.approveCredits && !body.autoSpend) return { needsApproval: true, estimate: est };
    if (!p.illustration) return { error: "no illustration" };
    const g = await spendGate(who, "meshy", { approvedBy: body.approveCredits ? body.approvedBy || "studio-admin" : null, allowReroll: !!body.allowReroll });
    if (!g.ok) return gateResult(g, est);
    return startJob(who, "meshy", "sh", ["-c", `node ${H}/prep-reference.mjs "${p.illustration}" ${O}/meshy-ref/${who} ${who} && node ${H}/meshy-head-image-to-3d.mjs ${who}-head-v1 ${O}/meshy-ref/${who}/${who}-ref-final.png && node ${H}/studio/meshy-file-raw.mjs ${who}`], {}, { spend: g.spend }); },
  build: (who, p) => { if (!p.rawMeshy) return { error: "no raw Meshy head yet (step 3)" }; if (!p.recipe) return { error: `no recipe for ${who} in employees.json (hair / accessories) — add one` }; if (!p.stage0) return { error: "no Stage 0 identity (step 2)" };
    return startJob(who, "build", "node", ["--max-old-space-size=3072", `${H}/build-employees.mjs`, `--only=${who}`], { NODE_OPTIONS: "--max-old-space-size=3072" }); },   // the heap for every pipeline child too (chibify ran out on a dense 48 MB raw head at the ~2.2 GB default)
  sheet: (who) => startJob(who, "sheet", "node", ["--max-old-space-size=3072", `${H}/studio/pipeline-sheet.mjs`, who]),
  export: (who, p) => { if (!p.candidate || !p.gate) return { error: "build first (step 4)" };
    return startJob(who, "export", "node", [`${H}/studio/export.mjs`, who]); },
};

// THE CONNECTED WORKFLOW: the planner (orchestrator.mjs) decides each next stage from what is on disk; this runner executes it with the
// same STEPS, waits for the job, and stops at a paid approval, a failure (fail closed) or the visual sign-off. Restart-safe, resumable.
const PIPES = `${S}/pipelines.json`, pipes = fs.existsSync(PIPES) ? JSON.parse(fs.readFileSync(PIPES, "utf8")) : {};
for (const w of Object.keys(pipes)) if (pipes[w].status === "running") { pipes[w].status = "interrupted"; pipes[w].note = "server restarted while running — run the pipeline again to resume"; }
const savePipes = () => fs.writeFileSync(PIPES, JSON.stringify(pipes, null, 1)), now = () => new Date().toISOString();
async function runPipeline(who, opts) {
  const P = (pipes[who] = { status: "running", startedAt: now(), opts: { approve: opts.approve ?? {}, mock: opts.mock ?? {}, approvedBy: opts.approvedBy ?? null, allowReroll: opts.allowReroll ?? {} }, history: [] }); savePipes(); let last = null;
  try { for (let i = 0; i < 20; i++) {
    const pl = plan(stateOf(who), P.opts); P.plan = pl; P.history.push({ at: now(), ...pl }); savePipes();
    // AUTOMATIC PAID AUTHORIZATION: a paid stage nobody approved may still run if the backend policy allows it (auto-spend
    // is OFF until switched on — then every check of avatar_generation_policy applies). Asked as a dry run: nothing recorded.
    let autoSpend = false;
    if (pl.action === "needs-approval") { if (pl.stage === "meshy" && !people().find((x) => x.id === who)?.photo) P.reason = "approved illustration — an admin names themself and approves the one Meshy head (never auto-spent)";
      else { const g = await spendGate(who, pl.stage, { dryRun: true }); autoSpend = g.ok; P.reason = g.ok ? null : g.reason; } }
    if (pl.action !== "run" && !autoSpend) { P.status = pl.action === "complete" ? "complete" : pl.action === "needs-approval" ? `awaiting-approval:${pl.stage}` : `blocked:${pl.stage}`; break; }
    if (last === pl.stage) { P.status = `stuck:${pl.stage}`; break; } last = pl.stage;
    const p = people().find((x) => x.id === who), r = await STEPS[pl.stage](who, p, { approveCredits: !!P.opts.approve[pl.stage], approvedBy: P.opts.approvedBy, allowReroll: !!P.opts.allowReroll?.[pl.stage], autoSpend, mock: pl.mock ?? null });
    if (r?.error) { P.status = `failed:${pl.stage}`; P.error = r.error; P.evidence = r.codes ? { codes: r.codes } : null; void runEvent(who, pl.stage, "failed", { error: r.error }); break; }
    if (r?.needsApproval) { P.status = `awaiting-approval:${pl.stage}`; P.reason = r.reason ?? P.reason ?? null; void runEvent(who, pl.stage, "awaiting-approval"); break; }
    if (r?.id) { while (jobs.find((j) => j.id === r.id)?.status === "running") await new Promise((res) => setTimeout(res, 2000));
      const job = jobs.find((j) => j.id === r.id), st = job?.status; P.history.push({ at: now(), stage: pl.stage, job: r.id, status: st });
      if (st !== "done" && st !== "awaiting-signoff") { P.status = `failed:${pl.stage}`; P.evidence = job?.evidence ?? null;
        // the exact blocker, in words: a build names the gate classes that failed; anything else its last log line
        P.error = job?.evidence?.report?.failed?.length ? `automatic quality gate failed: ${job.evidence.report.failed.join(", ")}` : (job?.evidence?.logTail ?? "").split("\n").filter(Boolean).at(-1) ?? `${pl.stage} did not finish`;
        void runEvent(who, pl.stage, "failed", { error: P.error, evidence: P.evidence }); break; }
      void runEvent(who, pl.stage, st, { artifact: artifactOf(who, pl.stage) }); }
  } } catch (e) { P.status = "failed"; P.error = String(e?.message ?? e); }
  P.endedAt = now(); savePipes(); }
// ---- PROGRESS + ARTIFACTS TO THE VO BACKEND (when the authority is configured): the account-bound record of this run ----
function artifactOf(who, stage) {
  const f = stage === "illustrate" ? `${S}/uploads/${who}.png` : stage === "meshy" ? (() => { try { return recipeRawHead(who); } catch { return null; } })() : stage === "build" ? productionCandidate(who)?.file : null;
  return f && fs.existsSync(f) ? { sha256: sha256File(f), path: f.slice(0, 400) } : null; }
async function runEvent(who, stage, status, { artifact = null, error = null, evidence = null } = {}) {
  const up = read(`${S}/uploads.json`)?.[who], email = ownerEmail(who); if (!AUTH || !email || !up?.photo || !fs.existsSync(up.photo)) return false;
  return reportRun(AUTH, { email, personId: who, photoSha256: sha256File(up.photo), stage, status: String(status).slice(0, 32), ...(artifact ? { artifact } : {}), ...(error ? { error: String(error).slice(0, 500) } : {}), ...(evidence ? { evidence } : {}) }); }
// ---- THE VO BRIDGE (dev-only, localhost): /api/self/* acts ONLY on the person VO's own backend session names (self-auth.mjs) ----
const SELF = { allowed: allowedApis("."), devUser: process.env.HB_STUDIO_DEV_USER || null, registry: parseAvatarRegistry(fs.existsSync("src/data/avatarRegistry.ts") ? fs.readFileSync("src/data/avatarRegistry.ts", "utf8") : "") };
const FROZEN5 = ["bon", "micah", "angelo", "clang", "france"];
function selfStatus(who, email) { const p = people().find((x) => x.id === who) ?? null, mounts = read("src/dev/vo3d/avatar/humanMounts.generated.json") ?? {};
  const V = productionCandidate(who), trace = `${S}/${who}--photo-trace.png`, job = (step) => [...jobs].reverse().find((j) => j.who === who && j.step === step) ?? null;
  // approved = frozen, promoted, or delivered at runtime (an approved, unpromoted head that passes promotion's checks)
  const appr = read(`${H}/approvals/${who}.json`), runtimeApproved = !!p && !runtimeRecord(who, { version: deliveryCandidate(who, appr), approval: appr, simulated: simulatedStages(who), promoted: mounts }).refused;
  return { personId: who, email, approvedAvatar: FROZEN5.includes(who) || !!mounts[who] || runtimeApproved, records: !!p,
    photo: p?.photo ?? null, photoTrace: fs.existsSync(trace) ? trace : null, photoTraceJob: job("photoTrace")?.status ?? null,
    pipeline: pipes[who] ? { status: pipes[who].status, error: pipes[who].error ?? null, reason: pipes[who].reason ?? null } : null, plan: p ? plan(stateOf(who), pipes[who]?.opts ?? {}) : null,
    simulated: p?.simulated ?? [], gate: p?.gate ?? null,
    candidate: V?.file && V.report?.validatedMount ? { file: V.file, tag: V.tag, mount: V.report.validatedMount, bodyPreset: V.report.bodyPreset ?? "standard", automatedPass: !!V.report.automatedPass, artifactHash: V.report.artifactHash, pipelineVersion: V.report.pipelineVersion, bindingHash: V.report.bindingHash, builtAt: V.report.builtAt } : null }; }
async function selfRoute(req, res, u) {
  const me = await resolveSelf({ authorization: req.headers.authorization, voApi: req.headers["x-vo-api"] }, SELF); if (me.error) return send(res, me.status, { error: me.error });
  const who = me.personId, route = u.pathname.slice("/api/self/".length), L = read(`${S}/owners.json`) ?? {}, own = claimOwner(L, who, me.email);
  if (!own.ok) return send(res, 409, { error: "this character id already belongs to another account — an admin assigns yours in HumanBase Studio" });
  if (own.ledger !== L) fs.writeFileSync(`${S}/owners.json`, JSON.stringify(own.ledger, null, 1));
  const approved = () => selfStatus(who, me.email).approvedAvatar, KEEP = "you already have an approved character — regenerating it is an admin action in HumanBase Studio";
  if (route === "status" && req.method === "GET") return send(res, 200, selfStatus(who, me.email));
  if (route === "trace" && req.method === "GET") { const f = `${S}/${who}--photo-trace.png`; return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), "image/png") : send(res, 404, { error: "no trace yet" }); }
  if (route === "photo" && req.method === "POST") { const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    const isPng = body.length > 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), isJpg = body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
    if (body.length < 1024 || body.length > 15 << 20 || !(isPng || isJpg)) return send(res, 400, { error: "upload a PNG or JPEG photo (under 15 MB)" });
    if (u.searchParams.get("consent") !== "self-photo-v1") return send(res, 400, { error: "confirm this is a photo of you and that it may be used to create your character" });
    if (approved()) return send(res, 409, { error: KEEP });
    if (pipes[who]?.status === "running" || running(who)) return send(res, 409, { error: "your character is being generated — wait for it to finish" });
    const f = `${S}/uploads/${who}.photo.${isPng ? "png" : "jpg"}`; fs.writeFileSync(f, body); const up = read(`${S}/uploads.json`) ?? {};
    up[who] = { ...(up[who] ?? {}), photo: f, photoAt: new Date().toISOString(), email: me.email, consent: { statement: "self-photo-v1", by: me.email, at: new Date().toISOString(), photoSha256: sha256File(f) } }; fs.writeFileSync(`${S}/uploads.json`, JSON.stringify(up, null, 1));
    const R = read(`${H}/employees.json`), hair = ["natural", "chin", "shoulder", "upperBack"].includes(u.searchParams.get("hair")) ? u.searchParams.get("hair") : "natural", bodyPreset = u.searchParams.get("body") === "feminine" ? "feminine" : "standard";
    if (R && !R.employees[who]) { R.employees[who] = { ruleset: "v3", hair, body: bodyPreset, ...(hair === "upperBack" || hair === "shoulder" ? { motion: "long" } : {}), headTris: 60000, accessories: [] }; fs.writeFileSync(`${H}/employees.json`, JSON.stringify(R, null, 1) + "\n"); }
    startJob(who, "photoTrace", "sh", ["-c", `node ${H}/studio/setup-mediapipe.mjs && node ${H}/studio/identity-upload.mjs ${who}--photo "${f}"`]);   // FREE: the face read from the photo itself, for the person to see
    return send(res, 200, selfStatus(who, me.email)); }
  if (route === "pipeline" && req.method === "POST") { if (!people().find((x) => x.id === who)) return send(res, 409, { error: "upload your photo first" });
    if (approved()) return send(res, 409, { error: KEEP });
    if (pipes[who]?.status === "running" || running(who)) return send(res, 409, { error: "already running" });
    runPipeline(who, { approve: {}, mock: {} }); return send(res, 200, selfStatus(who, me.email)); }   // NEVER a paid approval from the VO side: paid stages wait for an admin in Studio
  return send(res, 404, { error: "not found" }); }
// ---- APPROVED HEADS AT RUNTIME (dev-only): what the office may draw without a promotion (runtime-avatars.mjs runs promotion's checks) ----
// Any verified VO session may read it — every employee sees these characters in the office anyway. The owner email comes from the
// owner ledger (a verified self-API session claimed the id) or the app's own registry; otherwise it is null and the office keys
// the head by cast id alone.
// RUNTIME-ONLY (HB_STUDIO_RUNTIME_ONLY=1, `npm run hb:runtime`): the normal mock VO's approved-avatar delivery and NOTHING else — no
// page, uploads, pipeline, paid steps or Character Studio self routes. The list is what every employee sees in the office anyway and
// the server listens on 127.0.0.1 only, so it needs no session (the mock VO runs with VITE_AUTH_GATE=off and has none).
const RUNTIME_ONLY = process.env.HB_STUDIO_RUNTIME_ONLY === "1";
async function runtimeRoute(req, res) {
  const me = RUNTIME_ONLY ? {} : await resolveSelf({ authorization: req.headers.authorization, voApi: req.headers["x-vo-api"] }, SELF); if (me.error) return send(res, me.status, { error: me.error });
  const ledger = read(`${S}/owners.json`) ?? {}, byId = Object.fromEntries(Object.entries(SELF.registry).map(([e, id]) => [id, e]));
  const out = runtimeAvatars(people().map((p) => p.id), { versionOf: (w) => deliveryCandidate(w, read(`${H}/approvals/${w}.json`)), approvalOf: (w) => read(`${H}/approvals/${w}.json`), simulatedOf: (w) => simulatedStages(w),
    promoted: read("src/dev/vo3d/avatar/humanMounts.generated.json") ?? {}, emailOf: (w) => ledger[w] ?? byId[w] ?? null });
  return send(res, 200, out); }
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".glb": "model/gltf-binary", ".log": "text/plain", ".html": "text/html" };
http.createServer(async (req, res) => { const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (RUNTIME_ONLY) return u.pathname === "/api/runtime/avatars" && req.method === "GET" ? await runtimeRoute(req, res) : send(res, 404, { error: "runtime-only Studio: approved-avatar delivery only" });
    if (u.pathname === "/") return send(res, 200, fs.readFileSync(`${H}/studio/index.html`), "text/html");
    if (u.pathname === "/api/people") return send(res, 200, people());
    if (u.pathname === "/file") { const f = path.resolve(ROOT, u.searchParams.get("path") ?? ""); if (!f.startsWith(path.resolve(ROOT, "scripts/avatar-pipeline/output")) || !fs.existsSync(f)) return send(res, 404, { error: "not found" }); return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] ?? "application/octet-stream"); }
    if (u.pathname === "/api/log") { const j = jobs.find((x) => x.id === u.searchParams.get("id")); return send(res, 200, j && fs.existsSync(j.log) ? fs.readFileSync(j.log, "utf8").slice(-6000) : "", "text/plain"); }
    if (u.pathname === "/api/upload" && req.method === "POST") {
      // A RAW PHOTO is a real person's: it is tied to their VO account (the id comes from the email by the app's own rule, so the
      // office, the self API and the ledger all agree) and needs a named consent attestation. An illustration keeps the name field.
      const isPhoto = u.searchParams.get("kind") === "photo", email = String(u.searchParams.get("email") ?? "").trim().toLowerCase(), attest = String(u.searchParams.get("attest") ?? "").trim().slice(0, 80);
      if (isPhoto && (!email || !attest)) return send(res, 400, { error: "a raw photo needs the person's VO email and your name confirming they consented" });
      const who = isPhoto ? personIdForEmail(email, SELF.registry) : (u.searchParams.get("name") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, ""); if (!who) return send(res, 400, { error: isPhoto ? "that email has no usable character id" : "name required" });
      if (isPhoto) { const L = read(`${S}/owners.json`) ?? {}, own = claimOwner(L, who, email); if (!own.ok) return send(res, 409, { error: `${who} already belongs to another account` }); if (own.ledger !== L) fs.writeFileSync(`${S}/owners.json`, JSON.stringify(own.ledger, null, 1)); }
      const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);   // fail closed on anything that is not a real image (an empty or broken upload must never reach Stage 0)
      const isPng = body.length > 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), isJpg = body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
      if (body.length < 1024 || !(isPng || isJpg)) return send(res, 400, { error: `not an image (${body.length} bytes): upload a PNG or JPEG illustration` });
      const kind = u.searchParams.get("kind") === "photo" ? "photo" : "illustration", up = read(`${S}/uploads.json`) ?? {};
      if (kind === "photo") { const f = `${S}/uploads/${who}.photo.${isPng ? "png" : "jpg"}`; fs.writeFileSync(f, body);
        up[who] = { ...(up[who] ?? {}), photo: f, photoAt: new Date().toISOString(), email, consent: { statement: "admin-attested-v1", attestedBy: attest, by: email, at: new Date().toISOString(), photoSha256: sha256File(f) } }; }   // a RAW PHOTO: the illustration comes from the paid, approval-gated illustrate step
      else { const f = `${S}/uploads/${who}.png`; fs.writeFileSync(f, body); up[who] = { ...(up[who] ?? {}), file: f, at: new Date().toISOString() }; }
      fs.writeFileSync(`${S}/uploads.json`, JSON.stringify(up, null, 1));
      // the employee's appearance recipe (hair length / motion / accessories) — the one documented place, a default the user can edit
      const R = read(`${H}/employees.json`), hair = ["natural", "chin", "shoulder", "upperBack"].includes(u.searchParams.get("hair")) ? u.searchParams.get("hair") : "natural", bodyPreset = u.searchParams.get("body") === "feminine" ? "feminine" : "standard";
      if (R && !R.employees[who]) { R.employees[who] = { ruleset: "v3", hair, body: bodyPreset, ...(hair === "upperBack" || hair === "shoulder" ? { motion: "long" } : {}), headTris: 60000, accessories: [] }; fs.writeFileSync(`${H}/employees.json`, JSON.stringify(R, null, 1) + "\n"); }
      return send(res, 200, { ok: true, who, ...(isPhoto ? { email } : {}) }); }
    if (u.pathname.startsWith("/api/self/")) return await selfRoute(req, res, u);
    if (u.pathname === "/api/runtime/avatars" && req.method === "GET") return await runtimeRoute(req, res);
    if (u.pathname === "/api/pipeline") { const who = (u.searchParams.get("who") ?? "").toLowerCase();
      if (req.method !== "POST") return send(res, 200, { pipeline: pipes[who] ?? null, plan: who ? plan(stateOf(who), pipes[who]?.opts ?? {}) : null });
      let b = ""; for await (const c of req) b += c; const body = JSON.parse(b || "{}"), id = body.who; if (!people().find((x) => x.id === id)) return send(res, 404, { error: "unknown person" });
      if (pipes[id]?.status === "running" || running(id)) return send(res, 409, { error: "already running for this person" });
      const opts = { approve: body.approve ?? {}, mock: body.mock ?? {}, approvedBy: String(body.approvedBy ?? "").trim().slice(0, 80) || null, allowReroll: body.allowReroll ?? {} };
      if (Object.values(opts.approve).some(Boolean) && !opts.approvedBy) return send(res, 400, { error: "name the approver — every paid step records who approved it" });
      runPipeline(id, opts); return send(res, 200, { started: true, plan: plan(stateOf(id), opts) }); }
    if (u.pathname === "/api/preflight" && req.method === "GET") { const who = (u.searchParams.get("who") ?? "").toLowerCase(); if (!people().find((x) => x.id === who)) return send(res, 404, { error: "unknown person" });
      return send(res, 200, await preflightFor(who)); }
    if (u.pathname === "/api/run" && req.method === "POST") { let b = ""; for await (const c of req) b += c; const body = JSON.parse(b || "{}"), who = body.who, step = body.step, p = people().find((x) => x.id === who);
      if (!p) return send(res, 404, { error: "unknown person" }); if (!STEPS[step]) return send(res, 400, { error: "unknown step" }); if (running(who)) return send(res, 409, { error: "a step is already running for this person" });
      return send(res, 200, await STEPS[step](who, p, body)); }
    send(res, 404, { error: "not found" });
  } catch (e) { send(res, 500, { error: String(e?.message ?? e) }); }
}).listen(PORT, "127.0.0.1", () => { if (RUNTIME_ONLY) return console.log(`HumanBase runtime avatars (RUNTIME-ONLY: approved-avatar delivery, nothing else) → http://127.0.0.1:${PORT}/api/runtime/avatars — the mock VO (npm run dev:mock) reads it via /hb-studio`);
  console.log(`HumanBase Studio → http://localhost:${PORT}  (preview needs the Vite dev server on :5173)`);
  console.log(AUTH ? `spend authority: ${AUTH.url} (executor key loaded; auto-spend is decided by the backend policy)` : "spend authority: not configured — every paid step needs a named human approver (local spend rules apply)");
  if (SELF.devUser) console.warn(`⚠ DEV-USER MODE: every Character Studio request acts as ${SELF.devUser} (HB_STUDIO_DEV_USER) — local testing only`); });
