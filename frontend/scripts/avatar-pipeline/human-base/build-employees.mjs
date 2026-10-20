// build-employees.mjs — V2 FAIL-CLOSED HUMANBASE BUILD (2026-10-06). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-employees.mjs --only=jona,kael [--correct] [--tag=corr-v3] [--promote] [--head=v2] [--experimental]
//   --head=vN builds from another head version as an EXPERIMENT (xbase / xcorr candidates; never current, never promoted);
//   --experimental does the same for the accepted head (a diagnostic build that must not become the current candidate).
//   --integrate (opt-in development experiment): the generated head kept as made — fit, neck seal, closure, uniform head-size mount
//   (auto-head) and the same strict checks; always experimental, never identity-corrected.
//
// NON-DESTRUCTIVE (2026-10-10): every build writes a NEW version (candidate-versions.mjs: <kind>-v<N>-pass1|2/ + report.<tag>.json,
// the next free version unless --tag names one) and refuses to start when that version already exists — no earlier candidate,
// report, review sheet or export is ever deleted or overwritten. The legacy pass*/corr-pass* folders are version 1.
//
// Per employee, ALWAYS from the immutable raw Meshy head (never from a previous output):
//   pass 1  chibify (no build-loop repairs) → accessories → optimise → candidate
//           → evidence (record + artifact + MOUNTED final avatar) → failure registry → repairs its detectors ask for
//   pass 2  (only if a detector fired) rebuild from the SAME raw with exactly those repairs → evidence again
//   pass 3  (only if pass 2's detectors ask for a repair not applied yet) the union, from the SAME raw — the last pass
//   finish  (passing builds) the same artifact WITHOUT the hair base cap is gated; kept only if nothing gets worse (<tag>-pass4/)
//   gate    every automated class must pass AND every sign-off class needs an approval bound to the artifact hash
//           (approvals/<who>.json) — otherwise the candidate stays in output/human-base/candidates/<who>/ with its version's report
//   promote only with --promote AND a passing gate AND not a frozen approved fixture → production/<who>-v1.glb + manifest
//
// Repairs are decided by failure-registry.mjs detectors on THIS build's evidence — employees.json carries only the
// employee's appearance recipe (hair length / tie / accessories / budget), never a repair switch.
import { assertPromotable } from "./studio/provenance.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { FROZEN, REGISTRY, repairsFor } from "./failure-registry.mjs";
import { gate, sha256, pipelineVersion, PIPELINE_FILES, bindingHashOf, canonicalMount } from "./gate.mjs";
import { assertFresh, layout, nextTag } from "./candidate-versions.mjs";
import { headName, headVersion, rawHeadDir, rawHeadFile } from "./head-version.mjs";
export { pipelineVersion, PIPELINE_FILES };

const H = "scripts/avatar-pipeline/human-base", OUT = "scripts/avatar-pipeline/output/human-base/v1.2-release", ID = "public/avatars/human-base-v1/identity", PROD = "public/avatars/human-base-v1/production";
const MANIFEST = "scripts/avatar-pipeline/output/human-base/production-manifest.json";
/** the runtime's validated-head records (avatar/humanBodyRoster VALIDATED_HEADS) — written here and nowhere else */
export const MOUNTS = "src/dev/vo3d/avatar/humanMounts.generated.json";
const args = process.argv.slice(2), opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const R = JSON.parse(fs.readFileSync(`${H}/employees.json`, "utf8"));

const configHash = (who, head = null) => crypto.createHash("sha256").update(JSON.stringify({ recipe: head ? { ...R.employees[who], head } : R.employees[who], raw: R.raw, registry: REGISTRY.map((c) => [c.id, c.repairFlag ?? null, String(c.validate ?? ""), String(c.fired ?? "")]) })).digest("hex").slice(0, 16);

const run = (dir, log, script, a, env = {}) => { const t0 = Date.now(); process.stdout.write(`  ${log} … `);
  const out = execFileSync("node", [script, ...a], { env: { ...process.env, ...env }, maxBuffer: 1 << 28, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  fs.writeFileSync(`${dir}/${log}.log`, out); console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s`); return out; };
const sub = (s, who) => s.replaceAll("{who}", who).replaceAll("{ref}", R.ref.replaceAll("{who}", who));
const accessory = (dir, who, a) => { const idf = `${ID}/${who}-meshy-chibi-v1.glb`;
  if (a.build === "glasses") run(dir, a.id, `${H}/build-glasses.mjs`, [idf, `${H}/${a.style}`, a.id]);
  if (a.build === "flower") run(dir, a.id, `${H}/build-hair-flower.mjs`, [idf, sub(a.prep, who), a.id, sub(a.sprite, who)]);
  if (a.build === "tail") run(dir, a.id, `${H}/build-hair-tail.mjs`, [idf, a.id, `--tie=${a.tie ?? "low"}`, `--length=${a.length ?? "upperBack"}`, `--volume=${a.volume ?? 1}`, `--style=${a.style ?? "pony"}`]); };

/** ONE deterministic build pass from the clean raw into a NEW pass folder (refused if it exists) → candidate file + record */
export function buildPass(who, repairs, dir, { correct = false, head = null, integrate = false } = {}) {
  const e = R.employees[who]; assertFresh([dir]); fs.mkdirSync(dir, { recursive: true });
  // the head version (head-version.mjs): the recipe's ACCEPTED head unless an experimental build names another; v1 = the original
  // raw template, a newer paid head is its own version folder
  const hv = head ?? headVersion(e), raw = hv === "v1" ? sub(R.raw, who) : rawHeadFile(who, hv); if (!fs.existsSync(raw)) throw new Error(`raw identity missing: ${raw}`);
  // a FULL-BODY raw is reduced to its head (isolate-head.mjs — detector-gated, generic; a derived file beside the paid raw, never over
  // it); a head-only raw, like every raw head that came before, is used exactly as it is
  const iso = JSON.parse(run(dir, "isolate-head", `${H}/isolate-head.mjs`, [raw, `${rawHeadDir(who, hv)}/derived/${headName(who, hv)}-isolated.glb`]).trim().split("\n").at(-1));
  if (iso.fullBody && !iso.out) throw new Error(`full-body raw, but its head could not be isolated: ${iso.error ?? "no neck"}`);
  const src = iso.fullBody ? iso.out : raw;
  const rp = ["rimTuck", "jawClosureClip", "collarCull", "hairAsSkinRelabel", "neckHairClear", "crownSkinRelabel", "keepOwnUnderside"].map((k) => `${k}:${repairs.includes(k) ? 1 : 0}`).join(",");
  // INTEGRATION MODE (opt-in experiment): chibify keeps the generated head as made (--integrate: rigid hair, no tie / motion chains)
  const chibArgs = [src, `${who}-meshy-chibi-v1`, `--ruleset=${e.ruleset}`, `--hair=${e.hair}`, ...(integrate ? ["--integrate"] : [...(e.motion ? [`--motion=${e.motion}`] : []), ...(e.tie ? [`--tie=${e.tie}`] : [])]), `--repairs=${rp}`];
  run(dir, "chibify", `${H}/chibify.mjs`, chibArgs);
  // AUTOMATIC IDENTITY CORRECTION (identity-correct.mjs, opt-in --correct): the chibified Meshy head measured with the calibration's own
  // definitions vs the person's style-translated Stage 0 target; ONE smooth warp of every head part where a relation is out of tolerance
  if (correct) { const recF = `scripts/avatar-pipeline/output/human-base/${who}-meshy-chibi-v1-chibify.json`, idf = `${ID}/${who}-meshy-chibi-v1.glb`, env = { NODE_OPTIONS: "--max-old-space-size=3072" };
    // (a) LENGTH: the traced face height drives chibify's own long-face retention (one re-run from the same raw)
    const lp = JSON.parse(run(dir, "identity-length", `${H}/identity-correct.mjs`, [who, idf, "--plan-length", `--record=${recF}`], env).match(/LENGTH_PLAN (.*)/)[1]);
    if (lp.apply) run(dir, "chibify-identity-length", `${H}/chibify.mjs`, [...chibArgs, `--faceLenBoost=${lp.boost}`]);
    { const R2 = JSON.parse(fs.readFileSync(recF, "utf8")); R2.identityCorrection = { length: lp }; fs.writeFileSync(recF, JSON.stringify(R2, null, 1)); }
    // (b) WIDTHS below the eye line, face front only (skull + ears locked)
    run(dir, "identity-correct", `${H}/identity-correct.mjs`, [who, idf, `--record=${recF}`, `--report-out=${dir}/identity-correction.json`], env); }   // the plan stays with THIS version (never next to the shared identity file)
  for (const a of e.accessories) accessory(dir, who, a);
  run(dir, "optimize", `${H}/optimize-identity.mjs`, [`${ID}/${who}-meshy-chibi-v1.glb`, `${OUT}/optim`], { TARGETS: String(e.headTris), TEXS: "2048", PREFIX: who, TAG: `-${who}` });
  const file = `${dir}/${who}-v1.glb`, record = `${dir}/record.json`;
  fs.copyFileSync(`${OUT}/optim/${who}-tri${Math.round(e.headTris / 1000)}k-tex2048.glb`, file);
  fs.copyFileSync(`scripts/avatar-pipeline/output/human-base/${who}-meshy-chibi-v1-chibify.json`, record);
  return { file, record, raw, isolated: iso.fullBody ? iso : null };
}

/** a copy of the artifact without its hair base cap (null when it has none) — the input file is untouched */
async function dropCap(file, dir, who) {
  const { NodeIO } = await import("@gltf-transform/core"), { ALL_EXTENSIONS } = await import("@gltf-transform/extensions"), draco3d = (await import("draco3dgltf")).default;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule(), "draco3d.encoder": await draco3d.createEncoderModule() });
  const doc = await io.read(file); let n = 0;
  for (const node of doc.getRoot().listNodes()) { const m = node.getMesh(); if (m && /identity_hair_base/.test(`${node.getName()}|${m.getName()}`)) { node.setMesh(null); n++; } }
  if (!n) return null; fs.mkdirSync(dir, { recursive: true }); const out = `${dir}/${who}-v1.glb`; await io.write(out, doc); return out;
}
/** keep the cap-free copy only if nothing gets worse: every class keeps its status (or improves) and the closure / pocket measures
 *  do not grow beyond measurement noise (0.25 % overall, 1 % worst view, 2 pocket cells) */
export function capFreeVerdict(withCap, noCap) {
  const rank = { PASS: 0, GRANDFATHERED: 1, "SIGNOFF-REQUIRED": 1, FAIL: 2 }, st = (g, id) => g.classes.find((c) => c.id === id);
  if (!noCap.automatedPass) return { ok: false, why: `fails ${noCap.failed.join(", ")}` };
  for (const c of withCap.classes) { const n = st(noCap, c.id); if (!n || rank[n.status] > rank[c.status]) return { ok: false, why: `${c.id} ${c.status} → ${n?.status ?? "missing"}` }; }
  for (const id of ["FC-CLOSURE-EXPOSED", "FC-CLOSURE-EXPOSED-IN-MOTION"]) { const a = st(withCap, id)?.value, b = st(noCap, id)?.value;
    if (a?.pct != null && b?.pct != null && (b.pct > a.pct + 0.25 || b.worstPct > a.worstPct + 1)) return { ok: false, why: `${id} ${a.pct}/${a.worstPct} → ${b.pct}/${b.worstPct}` }; }
  const pa = st(withCap, "FC-BALD-POCKET")?.value, pb = st(noCap, "FC-BALD-POCKET")?.value; if (typeof pa === "number" && typeof pb === "number" && pb > pa + 2) return { ok: false, why: `FC-BALD-POCKET ${pa} → ${pb}` };
  return { ok: true, why: "no class or closure measure worse" };
}

/** THE ONLY WAY INTO production/: the gate must have passed (automated + sign-off), must carry MOUNTED evidence, and must
 *  have been computed on THIS exact file (no optimisation / mounting / edit can happen between gate and promotion); a
 *  frozen approved fixture is never overwritten. Throws — never warns — on any violation. */
export function promoteCandidate({ who, file, gateResult, prodDir = PROD, manifest = null, manifestFile = MANIFEST, mountsFile = MOUNTS }) {
  if (FROZEN.has(who)) throw new Error(`refused: ${who} is a frozen approved fixture`);
  assertPromotable(who);   // never promote a person built from SIMULATED stages (studio/provenance.mjs)
  if (!gateResult?.pass) throw new Error(`refused: gate did not pass (${[...(gateResult?.failed ?? []), ...(gateResult?.signoffRequired ?? [])].join(", ") || "no gate result"})`);
  if (!gateResult.evidence?.mounted) throw new Error("refused: no mounted / dressed validation in the gate result");
  if (sha256(file) !== gateResult.artifactHash) throw new Error("refused: the file changed after the gate measured it");
  const mount = canonicalMount(gateResult.validatedMount);
  if (!mount || JSON.stringify(mount) !== JSON.stringify(canonicalMount(gateResult.evidence.mounted.mount)) || bindingHashOf(gateResult.artifactHash, mount) !== gateResult.bindingHash)
    throw new Error("refused: the head mount is not the one the mounted gate validated with this artifact");
  fs.copyFileSync(file, `${prodDir}/${who}-v1.glb`);
  if (mountsFile) { const all = fs.existsSync(mountsFile) ? JSON.parse(fs.readFileSync(mountsFile, "utf8")) : {};
    all[who] = { artifactHash: gateResult.artifactHash, pipelineVersion: gateResult.pipelineVersion, mount, bindingHash: gateResult.bindingHash, validatedAt: new Date().toISOString(), ...(R.employees[who]?.body === "feminine" ? { bodyPreset: "feminine" } : {}) };
    fs.writeFileSync(mountsFile, JSON.stringify(all, null, 1) + "\n"); }
  if (manifest && manifestFile) { const all = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {}; all[who] = manifest; fs.writeFileSync(manifestFile, JSON.stringify(all, null, 1)); }
  return true;
}

export async function buildEmployee(who, { promote = false, correct = false, tag = null, head = null, experiment = false, integrate = false } = {}) {
  if (!R.employees[who]) throw new Error(`no recipe for ${who}`);
  // EXPERIMENTAL (head = a version other than the recipe's accepted one): its own candidate kinds (xbase / xcorr), never selected as
  // current, never promoted, and the recipe is not touched — accepting a head is a separate, gated step (prepare-head-version --accept)
  const accepted = headVersion(R.employees[who]), hv = head ? headVersion({ head }) : accepted, experimental = hv !== accepted || experiment || integrate;
  if (integrate && correct) throw new Error("refused: integration mode keeps the generated head — it is never identity-corrected (drop --correct)");
  if (experimental && promote) throw new Error(`refused: an experimental build (head ${hv}, accepted ${accepted}) is never promoted`);
  // a NEW version for every build (the next free one unless a tag is named); refused before any work if any of its files exist
  const kind = `${experimental ? "x" : ""}${correct ? "corr" : "base"}`, L = layout(who, tag ?? nextTag(who, kind)); if (L.kind !== kind) throw new Error(`tag ${L.tag} is not a ${kind} build`);
  assertFresh([...L.passes, L.report]); const [T1, T2, T3, T4] = L.passes, REPORT = L.report;
  console.log(`\n== ${who}${FROZEN.has(who) ? " (FROZEN approved fixture — candidate only, never promoted)" : ""}`);
  const mountSpec = integrate ? "auto-head" : "auto";   // integration: ONE uniform scale toward the approved skull height / body
  const p1 = buildPass(who, [], T1, { correct, head: hv, integrate }); const g1 = await gate({ appearanceId: who, identityFile: p1.file, recordFile: p1.record, approvalFile: `${H}/approvals/${who}.json`, mountSpec });
  const ev1 = g1.evidence; let repairs = repairsFor(ev1), final = { ...p1, g: g1 };
  console.log(`  pass 1: automated ${g1.automatedPass ? "PASS" : "FAIL"} (${g1.failed.join(", ") || "—"}) · repairs its detectors ask for: ${repairs.join(", ") || "none"}`);
  if (repairs.length) { const p2 = buildPass(who, repairs, T2, { correct, head: hv, integrate }); const g2 = await gate({ appearanceId: who, identityFile: p2.file, recordFile: p2.record, approvalFile: `${H}/approvals/${who}.json`, mountSpec }); final = { ...p2, g: g2 };
    console.log(`  pass 2 (${repairs.join(", ")}): automated ${g2.automatedPass ? "PASS" : "FAIL"} (${g2.failed.join(", ") || "—"})`);
    // CONVERGENCE (2026-10-19): a repair can expose a class pass 1 never showed (Kael: rimTuck → closure seen in motion). When pass 2's
    // own detectors ask for repairs not applied yet, ONE more pass from the same raw with the union — bounded, never a loop
    const more = repairsFor(g2.evidence).filter((r) => !repairs.includes(r));
    if (more.length && T3) { repairs = [...repairs, ...more]; const p3 = buildPass(who, repairs, T3, { correct, head: hv, integrate }); const g3 = await gate({ appearanceId: who, identityFile: p3.file, recordFile: p3.record, approvalFile: `${H}/approvals/${who}.json`, mountSpec }); final = { ...p3, g: g3 };
      console.log(`  pass 3 (+${more.join(", ")}): automated ${g3.automatedPass ? "PASS" : "FAIL"} (${g3.failed.join(", ") || "—"})`); } }
  // CAP-FREE FINISHING (2026-10-19): the hair base cap (identity_hair_base) is the sole cause of the dark strips across the ears
  // (2026-10-13: removed, Lui's ears were clean and every closure check passed). It stays only where it is load-bearing: a passing
  // build is gated again WITHOUT it, and the cap-free copy is kept only when no class gets worse and no closure / pocket measure grows
  let capFree = null;
  if (final.g.automatedPass && T4 && !integrate) { const nc = await dropCap(final.file, T4, who);
    if (nc) { const gN = await gate({ appearanceId: who, identityFile: nc, recordFile: final.record, approvalFile: `${H}/approvals/${who}.json`, mountSpec }), cmp = capFreeVerdict(final.g, gN);
      capFree = { tried: true, kept: cmp.ok, why: cmp.why }; console.log(`  cap-free finishing: ${cmp.ok ? "KEPT" : "rejected"} (${cmp.why})`);
      if (cmp.ok) { fs.copyFileSync(final.record, `${T4}/record.json`); final = { ...final, file: nc, record: `${T4}/record.json`, g: gN }; } } }
  const g = final.g, manifest = { who, tag: L.tag, pipelineVersion: pipelineVersion(), sourceHash: sha256(final.raw), ...(hv !== "v1" || experimental ? { head: hv, source: final.raw } : {}), ...(experimental ? { experimental: true, acceptedHead: accepted } : {}), ...(integrate ? { mode: "integration", mountSpec } : {}), ...(final.isolated ? { isolated: { file: final.isolated.out, sha256: final.isolated.outSha256, neckAt: final.isolated.neckAt } } : {}), configHash: configHash(who, experimental ? hv : null), artifactHash: g.artifactHash, validatedMount: g.validatedMount, bindingHash: g.bindingHash, builtAt: new Date().toISOString(), repairsAttempted: repairs, pass1Failed: g1.failed, headMount: g.validatedMount };
  const report = { ...manifest, bodyPreset: R.employees[who].body === "feminine" ? "feminine" : "standard", pass: g.pass, automatedPass: g.automatedPass, failed: g.failed, signoffRequired: g.signoffRequired,
    classes: g.classes.map((c) => { const r = REGISTRY.find((x) => x.id === c.id), flags = r?.repairFlags ?? (r?.repairFlag ? [r.repairFlag] : []); return { ...c, repairAttempted: flags.length ? flags.some((f) => repairs.includes(f)) : null }; }),
    failedViews: g.evidence.mounted?.closure?.views ?? null, reportOnly: g.reportOnly ?? [], candidate: final.file };   // reportOnly: findings outside the verdict
  report.capFree = capFree;
  report.identityCorrection = correct ? (JSON.parse(fs.readFileSync(final.record, "utf8")).identityCorrection ?? "within tolerance — unchanged") : null; assertFresh([REPORT]); fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
  let promoted = false;
  if (promote) { try { promoted = promoteCandidate({ who, file: final.file, gateResult: g, manifest }); } catch (e) { console.log(`  ${e.message}`); } }
  console.log(`  GATE ${g.pass ? "PASS" : "FAIL"} · failed: ${g.failed.join(", ") || "—"} · sign-off: ${g.signoffRequired.join(", ") || "—"} · ${promoted ? "PROMOTED to production" : "NOT promoted — candidate + report " + REPORT}`);
  return { ...report, promoted };
}

if (process.argv[1]?.endsWith("build-employees.mjs")) {
  const only = opt("only")?.split(",").filter(Boolean); if (!only?.length) { console.error("--only=<who,…> is required (no implicit rebuild of the whole roster)"); process.exit(2); }
  let bad = 0; for (const who of only) { try { const r = await buildEmployee(who, { promote: args.includes("--promote"), correct: args.includes("--correct"), tag: opt("tag") ?? null, head: opt("head") ?? null, experiment: args.includes("--experimental"), integrate: args.includes("--integrate") }); if (!r.pass) bad++; } catch (e) { bad++; console.error(`  BUILD ERROR ${who}: ${e.message}`); } }
  process.exitCode = bad ? 1 : 0;
}
