// approve.mjs — record a HASH-BOUND VISUAL SIGN-OFF for one candidate (only for classes no reliable detector covers yet).
//   node scripts/avatar-pipeline/human-base/approve.mjs <who> --reviewer=<name> --classes=FC-EAR-BOUNDARY,FC-HAIR-SPIKE,FC-NAPE-ROUGH
// Refuses unless the candidate's report shows EVERY automated class passing. The approval is bound to the candidate's exact
// artifact hash + pipeline version: any rebuild / artifact change invalidates it. It names classes explicitly — there is
// no generic approval, and it can never pass an automated class.
import fs from "node:fs";
import { SIGNOFF_CLASSES } from "./failure-registry.mjs";
const [who, ...rest] = process.argv.slice(2), opt = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const rep = JSON.parse(fs.readFileSync(`scripts/avatar-pipeline/output/human-base/candidates/${who}/report.json`, "utf8"));
const classes = (opt("classes") ?? "").split(",").filter(Boolean), reviewer = opt("reviewer");
if (!rep.automatedPass) { console.error(`refused: ${who} has automated failures (${rep.failed.join(", ")}) — visual sign-off cannot bypass them`); process.exit(1); }
if (!reviewer) { console.error("refused: --reviewer is required"); process.exit(1); }
const bad = classes.filter((c) => !SIGNOFF_CLASSES.includes(c)); if (bad.length || !classes.length) { console.error(`refused: approvable classes are ${SIGNOFF_CLASSES.join(", ")} (got ${classes.join(", ") || "none"})`); process.exit(1); }
if (!rep.bindingHash || !rep.validatedMount) { console.error(`refused: ${who}'s report carries no validated mount binding — rebuild it`); process.exit(1); }
const a = { who, artifactHash: rep.artifactHash, validatedMount: rep.validatedMount, bindingHash: rep.bindingHash, pipelineVersion: rep.pipelineVersion, classes, reviewer, timestamp: new Date().toISOString() };
fs.mkdirSync("scripts/avatar-pipeline/human-base/approvals", { recursive: true }); fs.writeFileSync(`scripts/avatar-pipeline/human-base/approvals/${who}.json`, JSON.stringify(a, null, 1));
console.log(`approval recorded for ${who}: ${classes.join(", ")} @ ${a.artifactHash.slice(0, 12)} / pipeline ${a.pipelineVersion}`);
