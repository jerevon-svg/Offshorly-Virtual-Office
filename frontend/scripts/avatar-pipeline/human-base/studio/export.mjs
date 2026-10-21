// studio/export.mjs — EXPORT a validated avatar package (never production/, never the runtime roster): the gated candidate head file, its
// gate report (incl. the gate-validated head mount the runtime wears it with), the build record with the identity-correction plan, the
// trace + pipeline sheets, and a manifest with hashes. Promotion stays the separate, human-gated build-employees --promote path.
//   node scripts/avatar-pipeline/human-base/studio/export.mjs <who> [tag]
// VERSIONED (candidate-versions.mjs): the newest corrected version (or the tag named) into its own export folder; an existing export is
// refused, never overwritten.
import fs from "node:fs";
import crypto from "node:crypto";
import { assertFresh, productionCandidate, newestSheet, resolveVersion } from "../candidate-versions.mjs";
const who = process.argv[2], O = "scripts/avatar-pipeline/output/human-base", A = process.argv[3] ? resolveVersion(who, process.argv[3]) : productionCandidate(who);
if (!A) { console.error("no corrected candidate"); process.exit(1); }
const rep = A.report, file = rep.candidate, X = A.exportDir; if (!file || !fs.existsSync(file)) { console.error("no corrected candidate"); process.exit(1); }
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
if (sha(file) !== rep.artifactHash) { console.error("refused: the candidate changed after its gate"); process.exit(1); }
try { assertFresh([`${X}/manifest.json`, `${X}/${who}-head.glb`, `${X}/gate-report.json`, `${X}/build-record.json`, `${X}/${who}-trace.png`]); } catch (e) { console.error(e.message); process.exit(1); }
fs.mkdirSync(X, { recursive: true }); const sheet = newestSheet(X, who), copy = (src, name) => { if (src && fs.existsSync(src)) { fs.copyFileSync(src, `${X}/${name}`); return name; } return null; };
const files = [copy(file, `${who}-head.glb`), copy(A.reportFile, "gate-report.json"), copy(`${file.slice(0, file.lastIndexOf("/"))}/record.json`, "build-record.json"), copy(`${O}/studio/${who}-trace.png`, `${who}-trace.png`), sheet ? sheet.slice(sheet.lastIndexOf("/") + 1) : null].filter(Boolean);
const manifest = { who, tag: A.tag, exportedAt: new Date().toISOString(), status: rep.automatedPass ? (rep.signoffRequired?.length ? "automated PASS — visual sign-off required before promotion" : "automated PASS") : `automated FAIL (${rep.failed.join(", ")})`,
  promoted: false, note: "export package only — production/ and the runtime roster are untouched; promotion is build-employees --promote after sign-off",
  artifactHash: rep.artifactHash, pipelineVersion: rep.pipelineVersion, validatedMount: rep.validatedMount, bindingHash: rep.bindingHash, identityCorrection: rep.identityCorrection ?? null,
  preview: `http://localhost:5173/virtual-office/human-base-lineup.html?humanbase=1&ids=bon,${who}&candidate=${who}:${file}&mode=walk`, files };
fs.writeFileSync(`${X}/manifest.json`, JSON.stringify(manifest, null, 1)); console.log(`exported → ${X} (${files.length} files) · ${manifest.status}`);
