// studio/preflight.mjs — IS THIS PERSON READY FOR A REAL (PAID) RUN? Read-only; spends nothing, records nothing. From frontend/:
//   node scripts/avatar-pipeline/human-base/studio/preflight.mjs <who>      (exit 0 = ready, 1 = not ready)
// Also served by HumanBase Studio at GET /api/preflight?who=<who>.
//
// Checks, every one reported: the raw photo · consent for THAT exact photo · the VO account identity it is tied to (and that
// the id is the one the app derives from that email) · not frozen / not already approved · nothing simulated or borrowed ·
// the API keys exist (never printed) · the Meshy balance covers the head above the reserve · free disk · the local spend rules
// (no job in flight, no spent attempt on these inputs) · the backend authority's dry-run verdict when one is configured.
import fs from "node:fs";
import { ESTIMATE, MESHY_RESERVE, authorityConfig, authorize, budget, loadEnvKey, localGuard, meshyBalance, readLedger } from "./spend-authority.mjs";
import { parseAvatarRegistry, personIdForEmail } from "./self-auth.mjs";
import { sha256File, simulatedStages } from "./provenance.mjs";
import { plan, stateOf } from "./orchestrator.mjs";
import { approvedSource } from "./approved-source.mjs";
import { recordFile, referenceRefusals } from "../prepare-head-version.mjs";
import { rawHeadFile } from "../head-version.mjs";

const S = "scripts/avatar-pipeline/output/human-base/studio";
const GiB = 1024 ** 3, DISK_RECOMMENDED = 6 * GiB, DISK_MINIMUM = 3 * GiB;
const FROZEN = ["bon", "micah", "angelo", "clang", "france"];
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

export function defaultDeps() {
  return {
    upload: (who) => read(`${S}/uploads.json`)?.[who] ?? null,
    owners: () => read(`${S}/owners.json`) ?? {},
    registry: () => parseAvatarRegistry(fs.existsSync("src/data/avatarRegistry.ts") ? fs.readFileSync("src/data/avatarRegistry.ts", "utf8") : ""),
    promoted: () => read("src/dev/vo3d/avatar/humanMounts.generated.json") ?? {},
    simulated: (who) => simulatedStages(who),
    pipelineOpts: (who) => read(`${S}/pipelines.json`)?.[who]?.opts ?? {},
    state: (who) => stateOf(who),
    planFor: (st, opts) => plan(st, opts),
    sha: (f) => (f && fs.existsSync(f) ? sha256File(f) : null),
    exists: (f) => !!f && fs.existsSync(f),
    keys: () => ({ openai: !!(loadEnvKey(".env", "OPENAI_API_KEY") || loadEnvKey("../backend/.env", "OPENAI_API_KEY")), meshy: !!loadEnvKey(".env", "MESHY_API_KEY") }),
    balance: () => meshyBalance(),
    diskFree: () => { const s = fs.statfsSync("/"); return s.bavail * s.bsize; },
    ledger: () => readLedger(`${S}/spend-ledger.json`),
    authority: () => authorityConfig(),
    authorizeDry: (cfg, req) => authorize(cfg, { ...req, dryRun: true }),
    budget: (cfg) => budget(cfg),
    source: (who) => approvedSource(who),
    headRecord: (who) => read(recordFile(who, "v1")),
    rawHead: (who) => fs.existsSync(rawHeadFile(who, "v1")),
    recipe: (who) => read("scripts/avatar-pipeline/human-base/employees.json")?.employees?.[who] ?? null,
  };
}

export async function preflight(who, d = defaultDeps()) {
  const up0 = d.upload(who) ?? {};
  if (!up0.photo && d.source?.(who)) return preflightIllustration(who, d);   // the release path: an approved illustration, no photo
  const checks = [], add = (id, ok, detail, critical = true) => checks.push({ id, ok: !!ok, critical, detail });
  const up = d.upload(who) ?? {}, photoSha = d.exists(up.photo) ? d.sha(up.photo) : null;
  add("photo", !!photoSha, photoSha ? `${up.photo} (sha256 ${photoSha.slice(0, 12)}…)` : "no raw photo uploaded for this person");
  const consentOk = !!(photoSha && up.consent?.photoSha256 === photoSha);
  add("consent", consentOk, consentOk ? `${up.consent.statement} — ${up.consent.attestedBy ? `attested by ${up.consent.attestedBy}` : `given by ${up.consent.by}`} at ${up.consent.at}` : up.consent ? "the consent on record is for a different photo" : "no consent recorded");
  const owners = d.owners(), email = owners[who] ?? up.email ?? null, derived = email ? personIdForEmail(email, d.registry()) : null;
  const identityOk = !!email && derived === who && (!owners[who] || owners[who] === email);
  add("identity", identityOk, !email ? "not tied to a VO account email" : derived !== who ? `${email} maps to "${derived}", not "${who}"` : `${who} ⇐ ${email}${owners[who] ? " (owner ledger)" : ""}`);
  const approved = FROZEN.includes(who) || !!d.promoted()[who];
  add("no_existing_character", !approved, approved ? "already has an approved character — regeneration is an admin decision" : "no approved character yet");
  const st = d.state(who), sim = d.simulated(who), mock = Object.values(d.pipelineOpts(who).mock ?? {}).filter(Boolean);
  const illustrationUploaded = st.illustration?.exists && st.illustration.mode === "uploaded";
  add("not_simulated", !sim.length && !mock.length && !illustrationUploaded,
    sim.length ? `simulated stage(s): ${sim.join(", ")}` : mock.length ? "the last pipeline ran with SIMULATED paid steps" : illustrationUploaded ? "the illustration was uploaded, not generated from this photo" : "every stage will run for real");
  const k = d.keys();
  add("keys", k.openai && k.meshy, `OpenAI ${k.openai ? "found" : "MISSING"} · Meshy ${k.meshy ? "found" : "MISSING"} (values never printed)`);
  const bal = await d.balance(), need = ESTIMATE.meshy.amount + MESHY_RESERVE;
  add("meshy_balance", bal != null && bal >= need, bal == null ? "the Meshy balance could not be read" : `${bal} credits (needs ${ESTIMATE.meshy.amount} + reserve ${MESHY_RESERVE})`);
  const free = d.diskFree();
  add("disk", free >= DISK_MINIMUM, `${(free / GiB).toFixed(1)} GiB free${free < DISK_RECOMMENDED ? ` — below the recommended ${DISK_RECOMMENDED / GiB} GiB (the build may grow swap by 1–3 GiB)` : ""}`);
  const ledger = d.ledger(), illSha = st.illustration?.exists ? d.sha(`${S}/uploads/${who}.png`) : null;
  const rules = [...(photoSha ? localGuard(ledger, { who, stage: "illustrate", inputSha256: photoSha, balance: bal }) : []), ...(illSha ? localGuard(ledger, { who, stage: "meshy", inputSha256: illSha, balance: bal }) : [])]
    .filter((f) => f.code !== "balance_unknown" && f.code !== "low_balance");
  add("spend_rules", !rules.some((f) => f.code !== "already_generated"), rules.length ? rules.map((f) => f.message).join("; ") : "no paid job in flight and no paid attempt on these inputs");
  const cfg = d.authority();
  if (cfg && photoSha && email) {
    const r = await d.authorizeDry(cfg, { email, personId: who, stage: "illustrate", inputSha256: photoSha, photoSha256: photoSha, estimate: ESTIMATE.illustrate.amount, mode: "manual", approvedBy: "preflight", providerBalance: null, hasApprovedCharacter: approved, consentAttestedBy: up.consent?.attestedBy ?? null });
    const b = await d.budget(cfg);
    add("authority", r.allowed, `${r.allowed ? "a named approval would be accepted" : r.failures.map((f) => f.code).join(", ")} · auto-spend ${b?.autospendEnabled ? "ON" : "off"}`, true);
  } else add("authority", true, cfg ? "configured (needs a photo + email to ask)" : "not configured — local spend rules + a named human approval", false);
  const pl = d.planFor(st, d.pipelineOpts(who));
  return { who, email, ready: checks.every((c) => c.ok || !c.critical), checks, next: pl, paid: { illustrate: ESTIMATE.illustrate, meshy: ESTIMATE.meshy } };
}

/** THE APPROVED-ILLUSTRATION PATH (2026-10-20): an approved Stage A sprite → ONE Meshy head (prepare-head-version.mjs) → build. No
 *  photo, so no photo consent and no OpenAI step; the account email is reported (not critical: the head is keyed by cast id). */
export async function preflightIllustration(who, d) {
  const checks = [], add = (id, ok, detail, critical = true) => checks.push({ id, ok: !!ok, critical, detail });
  const src = d.source(who), rec = d.headRecord(who), st = d.state(who);
  add("illustration", !!src, src ? `${src} (sha256 ${d.sha(src)?.slice(0, 12)}…)` : "no approved Stage A illustration");
  const refOk = !!rec && rec.status === "prepared" && d.sha(rec.reference?.path) === rec.reference?.sha256 && rec.illustration?.sha256 === d.sha(src), refBad = rec?.prep ? referenceRefusals(rec.prep) : [];
  if (!rec) add("reference", true, "not prepared yet — prepared (free) when the paid step is approved, refused there if it is not a clean sprite", false);
  else add("reference", refOk && !refBad.length, rec.status !== "prepared" ? `${who}-head-v1 is ${rec.status} — one paid attempt per head` : !refOk ? "the prepared reference or its illustration changed since it was recorded" : refBad.length ? refBad.join("; ") : `${rec.reference.path} (sha256 ${rec.reference.sha256.slice(0, 12)}…, ${rec.prep?.art ?? "?"})`);
  add("illustration_qa", !!st.qa?.done && !!st.qa?.pass, st.qa?.done ? (st.qa.pass ? "Stage 0 input gate + flat house style passed" : `failed: ${(st.qa.failed ?? []).join(", ")}`) : "not run yet (the pipeline runs it before the paid step)");
  const owners = d.owners(), byId = Object.fromEntries(Object.entries(d.registry()).map(([e, id]) => [id, e])), email = owners[who] ?? byId[who] ?? `${who}@offshorly.com`, how = owners[who] ? "owner ledger" : byId[who] ? "registry" : "localpart rule — confirm it is their real login";
  add("identity", personIdForEmail(email, d.registry()) === who, `${who} ⇐ ${email} (${how})`, false);
  const approved = FROZEN.includes(who) || !!d.promoted()[who];
  add("no_existing_character", !approved && !d.rawHead(who), approved ? "already has an approved character" : d.rawHead(who) ? "a v1 Meshy head already exists — a new head is a new version (prepare-head-version.mjs)" : "no approved character and no paid head yet");
  add("recipe", !!d.recipe(who), d.recipe(who) ? `employees.json: ${JSON.stringify(d.recipe(who))}` : "no recipe in employees.json — the build refuses");
  add("not_simulated", !d.simulated(who).length, d.simulated(who).length ? `simulated stage(s): ${d.simulated(who).join(", ")}` : "every stage will run for real");
  const k = d.keys(); add("keys", k.meshy, `Meshy ${k.meshy ? "found" : "MISSING"} (value never printed)`);
  const bal = await d.balance(), need = ESTIMATE.meshy.amount + MESHY_RESERVE;
  add("meshy_balance", bal != null && bal >= need, bal == null ? "the Meshy balance could not be read" : `${bal} credits (needs ${ESTIMATE.meshy.amount} + reserve ${MESHY_RESERVE})`);
  const free = d.diskFree(); add("disk", free >= DISK_MINIMUM, `${(free / GiB).toFixed(1)} GiB free${free < DISK_RECOMMENDED ? ` — below the recommended ${DISK_RECOMMENDED / GiB} GiB` : ""}`);
  const rules = (rec?.reference?.sha256 ? localGuard(d.ledger(), { who, stage: "meshy", inputSha256: rec.reference.sha256, balance: bal }) : []).filter((f) => f.code !== "balance_unknown" && f.code !== "low_balance");
  add("spend_rules", !rules.length, rules.length ? rules.map((f) => f.message).join("; ") : "no paid job in flight and no paid attempt on this reference");
  const cfg = d.authority(); add("authority", !cfg, cfg ? "the backend authority is configured — prepare-head-version refuses until the illustration path is wired to it" : "not configured — local spend rules + a named human approval", !!cfg);
  return { who, email, path: "approved-illustration", ready: checks.every((c) => c.ok || !c.critical), checks, next: d.planFor(st, d.pipelineOpts(who)), paid: { illustrate: ESTIMATE.illustrate, meshy: ESTIMATE.meshy } };
}

if (process.argv[1]?.endsWith("preflight.mjs")) {
  const who = String(process.argv[2] ?? "").toLowerCase();
  if (!who) { console.error("usage: node scripts/avatar-pipeline/human-base/studio/preflight.mjs <who>"); process.exit(2); }
  const r = await preflight(who);
  console.log(`PREFLIGHT ${who}${r.email ? ` <${r.email}>` : ""} — ${r.ready ? "READY for one real run" : "NOT READY"}`);
  for (const c of r.checks) console.log(` ${c.ok ? "✓" : c.critical ? "✗" : "·"} ${c.id.padEnd(22)} ${c.detail}`);
  console.log(` next: ${r.next?.stage ?? "—"} (${r.next?.action ?? "—"}) · paid: ${r.path === "approved-illustration" ? "" : `illustrate ≈ US$${r.paid.illustrate.amount}, `}meshy ≈ ${r.paid.meshy.amount} credits — each needs a named approval`);
  process.exit(r.ready ? 0 : 1);
}
