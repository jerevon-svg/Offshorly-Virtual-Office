// prepare-head-version.mjs — A NEW, VERSIONED MESHY HEAD for a person, from a stronger reference (2026-10-13). Run from frontend/.
//
//   PREPARE (free):   node scripts/avatar-pipeline/human-base/prepare-head-version.mjs <who> <illustration.png> [--version=vN]
//     A person with no head yet gets their FIRST head as v1; anyone else the next free version (head-version.mjs). It gets the
//     illustration prepared by prep-reference.mjs exactly as the automated flow
//     prepares one (no per-person flags) into meshy-ref/<who>/head-vN/, a record <who>-head-vN.json (sources + hashes), and the
//     Meshy script's own --dry-run of the paid request. Nothing is sent and nothing is spent.
//   GENERATE (PAID, one image-to-3D call): node … prepare-head-version.mjs <who> --generate=vN --approved-by="<name>"
//     Refused unless the version was prepared, its reference is byte-identical to the recorded one, its Meshy folder is new and the
//     Studio's local spend rules allow it (one paid attempt per input, nothing in flight, the Meshy reserve). Then: ONE call
//     (meshy-head-image-to-3d.mjs), the raw head filed (studio/meshy-file-raw.mjs) and the Studio ledger settled. No retry, ever: a
//     failed attempt stays failed. The recipe is NOT touched: a new head is EXPERIMENTAL (build-employees --head=vN → xbase / xcorr
//     candidates) until it is accepted. Every older raw head and every build made from it stays where it is.
//   ACCEPT (free, gated): node … prepare-head-version.mjs <who> --accept=vN --approved-by="<name>"
//     Points the recipe's accepted head at vN — refused unless a finished build from vN PASSED the whole gate (automated checks +
//     every visual sign-off). A failed head can never become the accepted / current one.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MESHY_DIR, RECIPES, REF_ROOT, headName, headRefDir, headVersion, nextHeadVersion, rawHeadDir, rawHeadFile, recipeHeadVersion } from "./head-version.mjs";
import { ROOT, resolveVersion, versions } from "./candidate-versions.mjs";
import { ESTIMATE, appendLedger, authorityConfig, localGuard, meshyBalance, readLedger, settleLedger } from "./studio/spend-authority.mjs";
import { sha256File } from "./studio/provenance.mjs";

const H = "scripts/avatar-pipeline/human-base", LEDGER = "scripts/avatar-pipeline/output/human-base/studio/spend-ledger.json";
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
export const recordFile = (who, v, R = REF_ROOT) => `${headRefDir(who, v, R)}/${headName(who, v)}.json`;

/** which version a prepare writes: a person with NO head yet (no v1 Meshy folder, no v1 reference) gets their FIRST head as v1 —
 *  the version every recipe reads by default; anyone else gets the next free version above v1. Refuses any version in use. */
export function prepareVersion(who, version = null, { M = MESHY_DIR, R = REF_ROOT, exists = fs.existsSync } = {}) {
  const first = !exists(rawHeadDir(who, "v1", M)) && !exists(headRefDir(who, "v1", R));
  const v = version ? headVersion({ head: version }) : first ? "v1" : nextHeadVersion(who, { M, R, exists });
  if (v === "v1" && !first) throw new Error("v1 is the original head — a rebuild is v2 or later");
  if (exists(rawHeadDir(who, v, M)) || exists(headRefDir(who, v, R))) throw new Error(`${headName(who, v)} is already in use — never overwritten`);
  return v;
}
/** FAIL CLOSED before any spend: a prepared reference that prep-reference had to rebuild is not a Stage A sprite (2026-10-20: the
 *  Stage 0 population CANONICAL crop read as a 0.85 Mpx "frame" + glasses and was inpainted over 1 Mpx — a destroyed face). The
 *  approved Meshy references of the five and later heads stay under 18k frame px and 111k inpainted px. */
export const REF_LIMITS = { framePx: 100000, inpaintedPx: 300000 };
export function referenceRefusals(prep) {
  const no = [], frame = prep?.frame?.pixels ?? 0, inp = prep?.inpainted ?? 0;
  if (frame > REF_LIMITS.framePx) no.push(`prep-reference found a ${frame} px backdrop/frame (limit ${REF_LIMITS.framePx}) — use the original Stage A sprite, not a crop or composite`);
  if (inp > REF_LIMITS.inpaintedPx) no.push(`prep-reference inpainted ${inp} px (limit ${REF_LIMITS.inpaintedPx}) — the reference would not be the illustration`);
  return no;
}

/** FREE: prepare version v (a first head is v1, else the next free one, unless given) of who's head from an illustration */
export function prepare(who, illustration, { version = null, run = execFileSync } = {}) {
  if (!fs.existsSync(illustration)) throw new Error(`no illustration at ${illustration}`);
  const v = prepareVersion(who, version);
  const dir = headRefDir(who, v), name = headName(who, v);
  run("node", [`${H}/prep-reference.mjs`, illustration, dir, name], { stdio: ["ignore", "pipe", "inherit"] });
  const ref = `${dir}/${name}-ref-final.png`, prep = read(`${dir}/${name}-prep.json`);
  if (!fs.existsSync(ref) || !prep) throw new Error("prep-reference produced no reference");
  const bad = referenceRefusals(prep);
  if (bad.length) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`REFUSED — ${bad.join("; ")}`); }   // this call made dir (it was free before): nothing else lives there
  const copy = `${dir}/${name}-source${path.extname(illustration).toLowerCase() || ".png"}`; fs.copyFileSync(illustration, copy);   // the version is self-contained
  let previous = null; try { const pv = recipeHeadVersion(who); previous = { version: pv, raw: fs.existsSync(rawHeadFile(who, pv)) ? rawHeadFile(who, pv) : null }; } catch { /* invalid recipe */ }
  const rec = { who, version: v, status: "prepared", preparedAt: new Date().toISOString(),
    illustration: { path: path.resolve(illustration), copy, sha256: sha256File(illustration) }, reference: { path: ref, sha256: sha256File(ref) }, prep, previous,
    paid: { stage: "meshy", calls: 1, estimate: ESTIMATE.meshy, command: `node ${H}/prepare-head-version.mjs ${who} --generate=${v} --approved-by="<name>"` } };
  fs.writeFileSync(recordFile(who, v), JSON.stringify(rec, null, 1));
  return rec;
}

/** the reasons a prepared version may NOT be generated now (empty = it may, once) */
export function generateRefusals(who, v, { approvedBy, ledger, balance, authority, R = REF_ROOT, M = MESHY_DIR }) {
  const no = [], rec = read(recordFile(who, v, R));
  if (!String(approvedBy ?? "").trim()) no.push("a paid head needs a named approver (--approved-by)");
  if (authority) no.push("the backend spend authority is configured — run paid stages through the Studio so it is asked");
  if (!rec) return [...no, `${headName(who, v)} was never prepared`];
  if (rec.status !== "prepared") no.push(`${headName(who, v)} is ${rec.status} — one paid attempt per version, never a retry`);
  if (!fs.existsSync(rec.reference.path) || sha256File(rec.reference.path) !== rec.reference.sha256) no.push("the prepared reference changed since it was recorded — prepare a new version");
  if (fs.existsSync(rawHeadDir(who, v, M))) no.push(`${rawHeadDir(who, v, M)} already exists — a paid head is never overwritten`);
  for (const f of localGuard(ledger, { who, stage: "meshy", inputSha256: rec.reference.sha256, approvedBy, balance })) no.push(f.message);
  return no;
}

/** PAID: the one image-to-3D call for a prepared version (refusals first; nothing is retried) */
export async function generate(who, v, { approvedBy, run = execFileSync } = {}) {
  const ledger = readLedger(LEDGER), balance = await meshyBalance();
  const no = generateRefusals(who, v, { approvedBy, ledger, balance, authority: authorityConfig() });
  if (no.length) throw new Error(`REFUSED — ${no.join("; ")}`);
  const rec = read(recordFile(who, v)), name = headName(who, v), id = `${who}-meshy-${v}-${Date.now()}`;
  appendLedger(LEDGER, { id, who, stage: "meshy", inputSha256: rec.reference.sha256, mode: "manual", approvedBy, recordId: null, estimate: ESTIMATE.meshy, version: v, at: new Date().toISOString(), outcome: null });
  rec.status = "generating"; rec.approvedBy = approvedBy; rec.balanceBefore = balance; fs.writeFileSync(recordFile(who, v), JSON.stringify(rec, null, 1));
  let ok = false, error = null;
  try { run("node", [`${H}/meshy-head-image-to-3d.mjs`, name, rec.reference.path], { stdio: "inherit" }); run("node", [`${H}/studio/meshy-file-raw.mjs`, who, v], { stdio: "inherit" }); ok = fs.existsSync(rawHeadFile(who, v)); }
  catch (e) { error = String(e?.message ?? e).slice(0, 500); }
  const task = read(`${rawHeadDir(who, v)}/raw-untouched/${name}-image-to-3d.task.json`) ?? read(`${rawHeadDir(who, v)}/${name}-image-to-3d.task.json`);
  settleLedger(LEDGER, id, { outcome: ok ? "succeeded" : "failed", endedAt: new Date().toISOString(), actual: task?.consumed_credits ?? null, evidence: ok ? null : { error, taskStatus: task?.status ?? null } });
  Object.assign(rec, { status: ok ? "generated" : "failed", generatedAt: new Date().toISOString(), taskId: task?.task_id ?? null, consumedCredits: task?.consumed_credits ?? null, balanceAfter: task?.balance_after ?? null, ...(ok ? { raw: rawHeadFile(who, v) } : { error }) });
  fs.writeFileSync(recordFile(who, v), JSON.stringify(rec, null, 1));
  return rec;   // the recipe is untouched: the new head is experimental until acceptHead()
}

/** the finished builds made from head v (any kind), newest first — a head is accepted only on a build that PASSED the whole gate */
export function buildsFromHead(who, v, root = ROOT) {
  const out = []; for (const kind of ["xcorr", "corr", "xbase", "base"]) for (const L of versions(who, kind, root)) { const r = resolveVersion(who, L.tag, root); if (r && (r.report.head ?? "v1") === v) out.push(r); }
  return out.sort((a, b) => Date.parse(b.report.builtAt ?? 0) - Date.parse(a.report.builtAt ?? 0));
}
/** the reasons head v may NOT become the accepted head (empty = it may) */
export function acceptRefusals(who, v, { approvedBy, root = ROOT } = {}) {
  const no = []; if (!String(approvedBy ?? "").trim()) no.push("accepting a head needs a named approver (--approved-by)");
  const passing = buildsFromHead(who, v, root).filter((b) => b.report.pass === true && b.report.automatedPass === true && !(b.report.failed ?? []).length && !(b.report.signoffRequired ?? []).length);
  if (!passing.length) no.push(`no build from ${headName(who, v)} has passed the whole gate (automated checks + every visual sign-off) — a failed head is never accepted`);
  return no;
}
export function acceptHead(who, v, { approvedBy, file = RECIPES, root = ROOT } = {}) {
  const no = acceptRefusals(who, v, { approvedBy, root }); if (no.length) throw new Error(`REFUSED — ${no.join("; ")}`);
  const R = JSON.parse(fs.readFileSync(file, "utf8")); if (!R.employees?.[who]) throw new Error(`${who} has no recipe`);
  if (v === "v1") delete R.employees[who].head; else R.employees[who].head = v; fs.writeFileSync(file, `${JSON.stringify(R, null, 1)}\n`); return v;
}

if (process.argv[1]?.endsWith("prepare-head-version.mjs")) {
  const [whoArg, ill] = process.argv.slice(2), opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const who = String(whoArg ?? "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(who)) { console.error("usage: prepare-head-version.mjs <who> <illustration.png> [--version=vN] | <who> --generate=vN --approved-by=<name>"); process.exit(2); }
  try {
    if (opt("generate")) { const r = await generate(who, headVersion({ head: opt("generate") }), { approvedBy: opt("approved-by") });
      console.log(`${headName(who, r.version)}: ${r.status}${r.consumedCredits != null ? ` · ${r.consumedCredits} credits` : ""}${r.status === "generated" ? r.version === "v1" ? ` · first head — next: build-employees.mjs --only=${who}` : ` · EXPERIMENTAL until accepted — next: build-employees.mjs --only=${who} --head=${r.version}` : ""}`);
      process.exit(r.status === "generated" ? 0 : 1); }
    if (opt("accept")) { const v = acceptHead(who, headVersion({ head: opt("accept") }), { approvedBy: opt("approved-by") }); console.log(`${who}: accepted head ${v}`); process.exit(0); }
    const r = prepare(who, ill, { version: opt("version") });
    console.log(`PREPARED ${headName(who, r.version)} (free) — reference ${r.reference.path} (sha256 ${r.reference.sha256.slice(0, 12)}…, ${r.prep.art}, crop ${JSON.stringify(r.prep.crop)})`);
    execFileSync("node", [`${H}/meshy-head-image-to-3d.mjs`, headName(who, r.version), r.reference.path, "--dry-run"], { stdio: "inherit" });
    const no = generateRefusals(who, r.version, { approvedBy: "(the approver)", ledger: readLedger(LEDGER), balance: await meshyBalance(), authority: authorityConfig() });
    console.log(no.length ? `generation would be REFUSED now: ${no.join("; ")}` : `PAID STEP AWAITING APPROVAL: 1 Meshy image-to-3D call ≈ ${ESTIMATE.meshy.amount} credits — ${r.paid.command}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
