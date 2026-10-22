// approve.mjs — record a HASH-BOUND VISUAL SIGN-OFF for one candidate (only for classes no reliable detector covers yet).
//   node scripts/avatar-pipeline/human-base/approve.mjs <who> --reviewer=<name> --classes=FC-EAR-BOUNDARY,FC-HAIR-SPIKE,FC-NAPE-ROUGH [--tag=corr-v2]
// (the candidate = the version named by --tag, else the newest corrected version, else the newest uncorrected one)
// Refuses unless the candidate's report shows EVERY automated class passing. The approval is bound to the candidate's exact
// artifact hash + pipeline version: any rebuild / artifact change invalidates it. It names classes explicitly — there is
// no generic approval, and it can never pass an automated class.
import fs from "node:fs";
import { APPROVABLE_CLASSES } from "./failure-registry.mjs";
import { productionCandidate, resolveVersion } from "./candidate-versions.mjs";
import { assertPromotable } from "./studio/provenance.mjs";
const [who, ...rest] = process.argv.slice(2), opt = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const V = opt("tag") ? resolveVersion(who, opt("tag")) : productionCandidate(who); if (!V) { console.error(`refused: no built candidate for ${who}`); process.exit(1); }
const rep = V.report;
const classes = (opt("classes") ?? "").split(",").filter(Boolean), reviewer = opt("reviewer");
try { assertPromotable(who); } catch (e) { console.error(e.message); process.exit(1); }   // a SIMULATED stage (fixture for a paid generation) is never signed off
if (!rep.automatedPass) { console.error(`refused: ${who} has automated failures (${rep.failed.join(", ")}) — visual sign-off cannot bypass them`); process.exit(1); }
if (!reviewer) { console.error("refused: --reviewer is required"); process.exit(1); }
const bad = classes.filter((c) => !APPROVABLE_CLASSES.includes(c) || !(rep.signoffRequired ?? []).includes(c)); if (bad.length || !classes.length) { console.error(`refused: approvable now are the classes this report needs signed off (${(rep.signoffRequired ?? []).join(", ") || "none"}) (got ${classes.join(", ") || "none"})`); process.exit(1); }
if (!rep.bindingHash || !rep.validatedMount) { console.error(`refused: ${who}'s report carries no validated mount binding — rebuild it`); process.exit(1); }
const a = { who, tag: V.tag, artifactHash: rep.artifactHash, validatedMount: rep.validatedMount, bindingHash: rep.bindingHash, pipelineVersion: rep.pipelineVersion, classes, reviewer, timestamp: new Date().toISOString() };
fs.mkdirSync("scripts/avatar-pipeline/human-base/approvals", { recursive: true }); fs.writeFileSync(`scripts/avatar-pipeline/human-base/approvals/${who}.json`, JSON.stringify(a, null, 1));
console.log(`approval recorded for ${who} (${V.tag}): ${classes.join(", ")} @ ${a.artifactHash.slice(0, 12)} / pipeline ${a.pipelineVersion}`);
