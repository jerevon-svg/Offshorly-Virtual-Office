// studio/spend-authority.mjs — EVERY PAID STAGE GOES THROUGH HERE (2026-10-13). Run from frontend/.
//
// Two layers, strictest wins:
//   1. LOCAL RULES (always on, no configuration): one paid job at a time per person + stage; never pay twice for the same
//      input; ONE paid attempt per input — a reroll needs a named approver; Meshy credits are never spent below the reserve.
//      The Studio's own ledger (spend-ledger.json) is their memory and the audit trail of every paid attempt it started.
//   2. THE VO BACKEND AUTHORITY (backend/app/routers/avatar_generation.py), when configured (HB_SPEND_AUTHORITY_URL + the
//      executor key — HB_EXECUTOR_KEY, else AVATAR_EXECUTOR_KEY from backend/.env, never printed): eligibility, consent,
//      per-employee limits, the company budget and the spending ledger. Configured but unreachable = the paid stage does
//      not start (fail closed). Auto-spend stays OFF until it is switched on in the backend; until then every paid stage
//      needs a named human approver.
import fs from "node:fs";

export const ESTIMATE = { illustrate: { amount: 0.2, unit: "usd" }, meshy: { amount: 30, unit: "meshy_credits" } };
export const STALE_MS = 6 * 3600 * 1000;
export const MESHY_RESERVE = Number(process.env.HB_MESHY_RESERVE ?? 100);

export function loadEnvKey(file, key) {
  try { const m = fs.readFileSync(file, "utf8").match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; } catch { return null; }
}

/** the backend authority, or null when this Studio runs without one */
export function authorityConfig({ env = process.env, backendEnvFile = "../backend/.env" } = {}) {
  const url = String(env.HB_SPEND_AUTHORITY_URL ?? "").trim().replace(/\/+$/, "");
  const key = env.HB_EXECUTOR_KEY || loadEnvKey(backendEnvFile, "AVATAR_EXECUTOR_KEY") || "";
  return url && key ? { url, key } : null;
}

// ---- the local ledger -----------------------------------------------------------------------------------------------
export function readLedger(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } }
export function appendLedger(file, entry) { const all = readLedger(file); all.push(entry); fs.writeFileSync(file, JSON.stringify(all, null, 1)); return entry; }
export function settleLedger(file, id, patch) { const all = readLedger(file), e = all.find((x) => x.id === id); if (!e || e.outcome) return null; Object.assign(e, patch); fs.writeFileSync(file, JSON.stringify(all, null, 1)); return e; }

/** the local rules — a list of { code, message }, empty when the spend may go ahead */
export function localGuard(ledger, { who, stage, inputSha256, approvedBy = null, allowReroll = false, balance = null, now = Date.now() }) {
  const fail = [], mine = ledger.filter((e) => e.who === who && e.stage === stage), same = mine.filter((e) => e.inputSha256 === inputSha256);
  const reroll = allowReroll && !!String(approvedBy ?? "").trim();
  if (!ESTIMATE[stage]) fail.push({ code: "unknown_stage", message: `${stage} is not a paid stage` });
  if (mine.some((e) => !e.outcome && now - Date.parse(e.at) < STALE_MS)) fail.push({ code: "in_flight", message: `a paid ${stage} job for ${who} is already running` });
  if (same.some((e) => e.outcome === "succeeded") && !reroll) fail.push({ code: "already_generated", message: `this exact input already produced a paid ${stage} result — it is reused, never paid twice` });
  if (same.filter((e) => e.outcome === "failed").length >= 1 && !reroll) fail.push({ code: "retry_cap", message: `${stage} already had its one paid attempt on this input — a reroll needs a named approver` });
  if (stage === "meshy") {
    if (balance == null) fail.push({ code: "balance_unknown", message: "the Meshy balance could not be read" });
    else if (balance - ESTIMATE.meshy.amount < MESHY_RESERVE) fail.push({ code: "low_balance", message: `Meshy balance ${balance} − ${ESTIMATE.meshy.amount} would fall below the reserve ${MESHY_RESERVE}` });
  }
  return fail;
}

// ---- providers and the authority ------------------------------------------------------------------------------------
async function call(fetchFn, url, init, timeoutMs = 8000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
  try { const r = await fetchFn(url, { ...init, signal: ac.signal }); const body = await r.json().catch(() => null); return { ok: r.ok, status: r.status, body }; }
  catch (e) { return { ok: false, status: 0, body: null, error: String(e?.message ?? e) }; }
  finally { clearTimeout(t); }
}
/** the Meshy balance (a free call), or null when it cannot be read */
export async function meshyBalance({ fetchFn = fetch, key = loadEnvKey(".env", "MESHY_API_KEY") } = {}) {
  if (!key) return null; const r = await call(fetchFn, "https://api.meshy.ai/openapi/v1/balance", { headers: { Authorization: `Bearer ${key}` } });
  return r.ok && typeof r.body?.balance === "number" ? r.body.balance : null;
}
const exec = (cfg, path, method, body, fetchFn) => call(fetchFn, `${cfg.url}${path}`, { method, headers: { "content-type": "application/json", "x-avatar-executor-key": cfg.key }, ...(body ? { body: JSON.stringify(body) } : {}) });
/** ask the authority: { allowed, recordId, failures } — or { allowed: false, failures: [unreachable] } (fail closed) */
export async function authorize(cfg, req, { fetchFn = fetch } = {}) {
  const r = await exec(cfg, "/avatar/generation/authorize", "POST", req, fetchFn);
  if (!r.ok || !r.body) return { allowed: false, recordId: null, failures: [{ code: "authority_unreachable", message: `the spend authority answered ${r.status || r.error}` }] };
  return { allowed: !!r.body.allowed, recordId: r.body.recordId ?? null, failures: r.body.failures ?? [] };
}
export const settle = async (cfg, recordId, outcome, { actual = null, evidence = null, fetchFn = fetch } = {}) => (await exec(cfg, "/avatar/generation/settle", "POST", { recordId, outcome, actual, evidence }, fetchFn)).ok;
export const reportRun = async (cfg, event, { fetchFn = fetch } = {}) => (await exec(cfg, "/avatar/generation/runs", "POST", event, fetchFn)).ok;
export async function budget(cfg, { fetchFn = fetch } = {}) { const r = await exec(cfg, "/avatar/generation/budget", "GET", null, fetchFn); return r.ok ? r.body : null; }

/** the evidence a failed job leaves: its exit code and log tail (bounded), and for a build the gate's own verdict */
export function failureEvidence({ exitCode, log, report = null }) {
  let tail = ""; try { tail = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).slice(-20).join("\n").slice(-3000); } catch { /* no log */ }
  return { exitCode, logTail: tail, ...(report ? { report: { automatedPass: !!report.automatedPass, failed: report.failed ?? [], signoffRequired: report.signoffRequired ?? [], failedViews: report.failedViews ?? null } } : {}) };
}
