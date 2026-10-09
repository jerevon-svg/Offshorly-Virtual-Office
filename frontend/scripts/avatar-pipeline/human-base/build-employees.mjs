// build-employees.mjs — V2 FAIL-CLOSED HUMANBASE BUILD (2026-10-06). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-employees.mjs --only=jona,kael [--promote]
//
// Per employee, ALWAYS from the immutable raw Meshy head (never from a previous output):
//   pass 1  chibify (no build-loop repairs) → accessories → optimise → candidate
//           → evidence (record + artifact + MOUNTED final avatar) → failure registry → repairs its detectors ask for
//   pass 2  (only if a detector fired) rebuild from the SAME raw with exactly those repairs → evidence again
//   gate    every automated class must pass AND every sign-off class needs an approval bound to the artifact hash
//           (approvals/<who>.json) — otherwise the candidate stays in output/human-base/candidates/<who>/ with report.json
//   promote only with --promote AND a passing gate AND not a frozen approved fixture → production/<who>-v1.glb + manifest
//
// Repairs are decided by failure-registry.mjs detectors on THIS build's evidence — employees.json carries only the
// employee's appearance recipe (hair length / tie / accessories / budget), never a repair switch.
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { FROZEN, REGISTRY, repairsFor } from "./failure-registry.mjs";
import { gate, sha256, pipelineVersion, PIPELINE_FILES, bindingHashOf, canonicalMount } from "./gate.mjs";
export { pipelineVersion, PIPELINE_FILES };

const H = "scripts/avatar-pipeline/human-base", OUT = "scripts/avatar-pipeline/output/human-base/v1.2-release", ID = "public/avatars/human-base-v1/identity", PROD = "public/avatars/human-base-v1/production";
const CAND = "scripts/avatar-pipeline/output/human-base/candidates", MANIFEST = "scripts/avatar-pipeline/output/human-base/production-manifest.json";
/** the runtime's validated-head records (avatar/humanBodyRoster VALIDATED_HEADS) — written here and nowhere else */
export const MOUNTS = "src/dev/vo3d/avatar/humanMounts.generated.json";
const args = process.argv.slice(2), opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const R = JSON.parse(fs.readFileSync(`${H}/employees.json`, "utf8"));

const configHash = (who) => crypto.createHash("sha256").update(JSON.stringify({ recipe: R.employees[who], raw: R.raw, registry: REGISTRY.map((c) => [c.id, c.repairFlag ?? null, String(c.validate ?? ""), String(c.fired ?? "")]) })).digest("hex").slice(0, 16);

const run = (dir, log, script, a, env = {}) => { const t0 = Date.now(); process.stdout.write(`  ${log} … `);
  const out = execFileSync("node", [script, ...a], { env: { ...process.env, ...env }, maxBuffer: 1 << 28, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  fs.writeFileSync(`${dir}/${log}.log`, out); console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s`); return out; };
const sub = (s, who) => s.replaceAll("{who}", who).replaceAll("{ref}", R.ref.replaceAll("{who}", who));
const accessory = (dir, who, a) => { const idf = `${ID}/${who}-meshy-chibi-v1.glb`;
  if (a.build === "glasses") run(dir, a.id, `${H}/build-glasses.mjs`, [idf, `${H}/${a.style}`, a.id]);
  if (a.build === "flower") run(dir, a.id, `${H}/build-hair-flower.mjs`, [idf, sub(a.prep, who), a.id, sub(a.sprite, who)]);
  if (a.build === "tail") run(dir, a.id, `${H}/build-hair-tail.mjs`, [idf, a.id, `--tie=${a.tie ?? "low"}`, `--length=${a.length ?? "upperBack"}`, `--volume=${a.volume ?? 1}`, `--style=${a.style ?? "pony"}`]); };

/** ONE deterministic build pass from the clean raw → candidate file + record (returns their paths) */
export function buildPass(who, repairs, tag, { correct = false } = {}) {
  const e = R.employees[who], dir = `${CAND}/${who}/${tag}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const raw = sub(R.raw, who); if (!fs.existsSync(raw)) throw new Error(`raw identity missing: ${raw}`);
  const rp = ["rimTuck", "jawClosureClip", "collarCull", "hairAsSkinRelabel", "neckHairClear", "crownSkinRelabel", "keepOwnUnderside"].map((k) => `${k}:${repairs.includes(k) ? 1 : 0}`).join(",");
  const chibArgs = [raw, `${who}-meshy-chibi-v1`, `--ruleset=${e.ruleset}`, `--hair=${e.hair}`, ...(e.motion ? [`--motion=${e.motion}`] : []), ...(e.tie ? [`--tie=${e.tie}`] : []), `--repairs=${rp}`];
  run(dir, "chibify", `${H}/chibify.mjs`, chibArgs);
  // AUTOMATIC IDENTITY CORRECTION (identity-correct.mjs, opt-in --correct): the chibified Meshy head measured with the calibration's own
  // definitions vs the person's style-translated Stage 0 target; ONE smooth warp of every head part where a relation is out of tolerance
  if (correct) { const recF = `scripts/avatar-pipeline/output/human-base/${who}-meshy-chibi-v1-chibify.json`, idf = `${ID}/${who}-meshy-chibi-v1.glb`, env = { NODE_OPTIONS: "--max-old-space-size=3072" };
    // (a) LENGTH: the traced face height drives chibify's own long-face retention (one re-run from the same raw)
    const lp = JSON.parse(run(dir, "identity-length", `${H}/identity-correct.mjs`, [who, idf, "--plan-length", `--record=${recF}`], env).match(/LENGTH_PLAN (.*)/)[1]);
    if (lp.apply) run(dir, "chibify-identity-length", `${H}/chibify.mjs`, [...chibArgs, `--faceLenBoost=${lp.boost}`]);
    { const R2 = JSON.parse(fs.readFileSync(recF, "utf8")); R2.identityCorrection = { length: lp }; fs.writeFileSync(recF, JSON.stringify(R2, null, 1)); }
    // (b) WIDTHS below the eye line, face front only (skull + ears locked)
    run(dir, "identity-correct", `${H}/identity-correct.mjs`, [who, idf, `--record=${recF}`], env); }
  for (const a of e.accessories) accessory(dir, who, a);
  run(dir, "optimize", `${H}/optimize-identity.mjs`, [`${ID}/${who}-meshy-chibi-v1.glb`, `${OUT}/optim`], { TARGETS: String(e.headTris), TEXS: "2048", PREFIX: who, TAG: `-${who}` });
  const file = `${dir}/${who}-v1.glb`, record = `${dir}/record.json`;
  fs.copyFileSync(`${OUT}/optim/${who}-tri${Math.round(e.headTris / 1000)}k-tex2048.glb`, file);
  fs.copyFileSync(`scripts/avatar-pipeline/output/human-base/${who}-meshy-chibi-v1-chibify.json`, record);
  return { file, record, raw };
}

/** THE ONLY WAY INTO production/: the gate must have passed (automated + sign-off), must carry MOUNTED evidence, and must
 *  have been computed on THIS exact file (no optimisation / mounting / edit can happen between gate and promotion); a
 *  frozen approved fixture is never overwritten. Throws — never warns — on any violation. */
export function promoteCandidate({ who, file, gateResult, prodDir = PROD, manifest = null, manifestFile = MANIFEST, mountsFile = MOUNTS }) {
  if (FROZEN.has(who)) throw new Error(`refused: ${who} is a frozen approved fixture`);
  if (!gateResult?.pass) throw new Error(`refused: gate did not pass (${[...(gateResult?.failed ?? []), ...(gateResult?.signoffRequired ?? [])].join(", ") || "no gate result"})`);
  if (!gateResult.evidence?.mounted) throw new Error("refused: no mounted / dressed validation in the gate result");
  if (sha256(file) !== gateResult.artifactHash) throw new Error("refused: the file changed after the gate measured it");
  const mount = canonicalMount(gateResult.validatedMount);
  if (!mount || JSON.stringify(mount) !== JSON.stringify(canonicalMount(gateResult.evidence.mounted.mount)) || bindingHashOf(gateResult.artifactHash, mount) !== gateResult.bindingHash)
    throw new Error("refused: the head mount is not the one the mounted gate validated with this artifact");
  fs.copyFileSync(file, `${prodDir}/${who}-v1.glb`);
  if (mountsFile) { const all = fs.existsSync(mountsFile) ? JSON.parse(fs.readFileSync(mountsFile, "utf8")) : {};
    all[who] = { artifactHash: gateResult.artifactHash, pipelineVersion: gateResult.pipelineVersion, mount, bindingHash: gateResult.bindingHash, validatedAt: new Date().toISOString() };
    fs.writeFileSync(mountsFile, JSON.stringify(all, null, 1) + "\n"); }
  if (manifest && manifestFile) { const all = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {}; all[who] = manifest; fs.writeFileSync(manifestFile, JSON.stringify(all, null, 1)); }
  return true;
}

export async function buildEmployee(who, { promote = false, correct = false } = {}) {
  const T1 = correct ? "corr-pass1" : "pass1", T2 = correct ? "corr-pass2" : "pass2", REPORT = correct ? "report.corrected.json" : "report.json";   // corrected builds never overwrite the V2 candidates
  if (!R.employees[who]) throw new Error(`no recipe for ${who}`);
  console.log(`\n== ${who}${FROZEN.has(who) ? " (FROZEN approved fixture — candidate only, never promoted)" : ""}`);
  const p1 = buildPass(who, [], T1, { correct }); const g1 = await gate({ appearanceId: who, identityFile: p1.file, recordFile: p1.record, approvalFile: `${H}/approvals/${who}.json`, mountSpec: "auto" });
  const ev1 = g1.evidence, repairs = repairsFor(ev1); let final = { ...p1, g: g1 };
  console.log(`  pass 1: automated ${g1.automatedPass ? "PASS" : "FAIL"} (${g1.failed.join(", ") || "—"}) · repairs its detectors ask for: ${repairs.join(", ") || "none"}`);
  if (repairs.length) { const p2 = buildPass(who, repairs, T2, { correct }); const g2 = await gate({ appearanceId: who, identityFile: p2.file, recordFile: p2.record, approvalFile: `${H}/approvals/${who}.json`, mountSpec: "auto" }); final = { ...p2, g: g2 };
    console.log(`  pass 2 (${repairs.join(", ")}): automated ${g2.automatedPass ? "PASS" : "FAIL"} (${g2.failed.join(", ") || "—"})`); }
  const g = final.g, manifest = { who, pipelineVersion: pipelineVersion(), sourceHash: sha256(final.raw), configHash: configHash(who), artifactHash: g.artifactHash, validatedMount: g.validatedMount, bindingHash: g.bindingHash, builtAt: new Date().toISOString(), repairsAttempted: repairs, pass1Failed: g1.failed, headMount: g.validatedMount };
  const report = { ...manifest, pass: g.pass, automatedPass: g.automatedPass, failed: g.failed, signoffRequired: g.signoffRequired,
    classes: g.classes.map((c) => { const r = REGISTRY.find((x) => x.id === c.id), flags = r?.repairFlags ?? (r?.repairFlag ? [r.repairFlag] : []); return { ...c, repairAttempted: flags.length ? flags.some((f) => repairs.includes(f)) : null }; }),
    failedViews: g.evidence.mounted?.closure?.views ?? null, candidate: final.file };
  report.identityCorrection = correct ? (JSON.parse(fs.readFileSync(final.record, "utf8")).identityCorrection ?? "within tolerance — unchanged") : null; fs.writeFileSync(`${CAND}/${who}/${REPORT}`, JSON.stringify(report, null, 1));
  let promoted = false;
  if (promote) { try { promoted = promoteCandidate({ who, file: final.file, gateResult: g, manifest }); } catch (e) { console.log(`  ${e.message}`); } }
  console.log(`  GATE ${g.pass ? "PASS" : "FAIL"} · failed: ${g.failed.join(", ") || "—"} · sign-off: ${g.signoffRequired.join(", ") || "—"} · ${promoted ? "PROMOTED to production" : "NOT promoted — candidate + report in " + CAND + "/" + who}`);
  return { ...report, promoted };
}

if (process.argv[1]?.endsWith("build-employees.mjs")) {
  const only = opt("only")?.split(",").filter(Boolean); if (!only?.length) { console.error("--only=<who,…> is required (no implicit rebuild of the whole roster)"); process.exit(2); }
  let bad = 0; for (const who of only) { try { const r = await buildEmployee(who, { promote: args.includes("--promote"), correct: args.includes("--correct") }); if (!r.pass) bad++; } catch (e) { bad++; console.error(`  BUILD ERROR ${who}: ${e.message}`); } }
  process.exitCode = bad ? 1 : 0;
}
