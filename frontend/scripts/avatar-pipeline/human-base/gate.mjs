// gate.mjs — THE FINAL GATE: gather every piece of evidence for ONE candidate identity and let the failure registry decide.
// ZERO CREDITS. A candidate passes only when every automated class passes AND every sign-off class carries a visual
// approval bound to this exact artifact hash. A detector / validator that cannot run is a FAILURE, never a skip.
//   node scripts/avatar-pipeline/human-base/gate.mjs <appearance-id> <identity.glb> <chibify-record.json> [approval.json]
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { identityMetrics } from "./check-identity.mjs";
import { collarHair, neckHair, skinFlaps, hairAsSkin, hairSlivers, earResidue, earHairFragments, faceAspectGrowth, readIdentity } from "./failure-detectors.mjs";
import { evaluate, reportOnly } from "./failure-registry.mjs";

const canon = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/canonical-profile.json", "utf8"));
const recipe = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/employees.json", "utf8"));
/** the pipeline version = a hash of every source file that shapes an identity (code drift is visible in every manifest) */
export const PIPELINE_FILES = ["build-employees.mjs", "chibify.mjs", "eye-catchlight.mjs", "hair-layers.mjs", "head-closure.mjs", "eye-socket.mjs", "skin-clean.mjs", "lib.mjs", "optimize-identity.mjs", "scalp-backing.mjs", "closure-attachment.mjs", "visibility.mjs", "hair-debris.mjs", "boundary-fairing.mjs", "underside-sheet.mjs", "underside-weld.mjs", "underside-texture.mjs", "fringe-exact.mjs", "build-glasses.mjs", "build-hair-flower.mjs", "build-hair-tail.mjs", "failure-registry.mjs", "failure-detectors.mjs", "gate.mjs", "check-identity.mjs", "mounted-gate.run.ts", "canonical-profile.json"].map((f) => `scripts/avatar-pipeline/human-base/${f}`);
export const pipelineVersion = () => { const h = crypto.createHash("sha256"); for (const f of PIPELINE_FILES) h.update(f).update(fs.readFileSync(f)); return h.digest("hex").slice(0, 16); };
export const sha256 = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
/** the artifact and the mount it was VALIDATED with are one thing: change either and this hash — and every approval and
 *  promotion bound to it — no longer matches */
export const canonicalMount = (m) => (m ? { scale: +(+(m.scale ?? 1)).toFixed(3), pitchDeg: +(+(m.pitchDeg ?? 0)).toFixed(2) } : null);
export const bindingHashOf = (artifactHash, mount) => crypto.createHash("sha256").update(`${artifactHash}|${JSON.stringify(canonicalMount(mount))}`).digest("hex");

/** mounted evidence for several candidates in ONE runtime process (production appearance + the candidate identity) */
export function mountedEvidence(pairs) {
  const out = execFileSync("npx", ["vite-node", "scripts/avatar-pipeline/human-base/mounted-gate.run.ts", "--", ...pairs.flatMap((p) => [p[0], p[1], p[2] ?? "prod"])], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=3072" } });
  const line = out.split("\n").find((l) => l.startsWith("MOUNTED_GATE_JSON ")); if (!line) throw new Error("mounted gate produced no result");
  return JSON.parse(line.slice("MOUNTED_GATE_JSON ".length));
}

export async function gatherEvidence({ appearanceId, identityFile, recordFile, mounted, mountSpec = "prod" }) {
  const ev = { appearanceId, identityFile };
  try { const rec = JSON.parse(fs.readFileSync(recordFile, "utf8"));
    ev.record = { skullWidth: +(rec.abs.after.ears.half / canon.ears.half).toFixed(4), aspectGrowth: faceAspectGrowth(rec).growth, detections: rec.detections ?? null, repairs: rec.repairs ?? null };
  } catch (e) { ev.recordError = String(e.message); }
  try { const doc = await readIdentity(identityFile);
    ev.artifact = { ...(await identityMetrics(appearanceId, { file: identityFile, record: recordFile, accessories: recipe.employees[appearanceId]?.accessories ?? [] })),
      collarHair: collarHair(doc), neckHair: neckHair(doc), skinFlaps: await skinFlaps(doc), hairAsSkin: await hairAsSkin(doc),
      report: { hairSlivers: hairSlivers(doc), earResidue: await earResidue(doc), earHairFragments: await earHairFragments(doc) } };   // report-only (not separating — see the registry)
  } catch (e) { ev.artifactError = String(e.message); }
  const m = mounted ?? mountedEvidence([[appearanceId, identityFile, mountSpec]])[`${appearanceId}|${identityFile}`];
  if (m?.ok) { ev.mounted = m; ev.worn = m.worn; ev.wornAccessories = m.wornAccessories ?? []; } else ev.mountedError = m?.error ?? "mounted gate did not run";
  return ev;
}

export async function gate({ appearanceId, identityFile, recordFile, approvalFile = null, mounted, mountSpec = "prod" }) {
  const ev = await gatherEvidence({ appearanceId, identityFile, recordFile, mounted, mountSpec }), artifactHash = sha256(identityFile);
  const approval = approvalFile && fs.existsSync(approvalFile) ? JSON.parse(fs.readFileSync(approvalFile, "utf8")) : null;
  const version = pipelineVersion(), validatedMount = canonicalMount(ev.mounted?.mount), bindingHash = bindingHashOf(artifactHash, validatedMount);
  return { appearanceId, identityFile, artifactHash, pipelineVersion: version, validatedMount, bindingHash, ...evaluate(ev, { approval, artifactHash, pipelineVersion: version, bindingHash }), reportOnly: reportOnly(ev), evidence: ev };   // reportOnly never touches the verdict
}

if (process.argv[1]?.endsWith("gate.mjs")) {
  const [id, file, rec, appr] = process.argv.slice(2);
  const r = await gate({ appearanceId: id, identityFile: file, recordFile: rec, approvalFile: appr });
  for (const c of r.classes) console.log(`${c.status.padEnd(16)} ${c.id.padEnd(24)} ${JSON.stringify(c.value)?.slice(0, 120)}`);
  for (const c of r.reportOnly) console.log(`REPORT ${c.status.padEnd(9)} ${c.id.padEnd(24)} ${JSON.stringify(c.value)?.slice(0, 120)}`);
  console.log(`GATE ${r.pass ? "PASS" : "FAIL"} · failed: ${r.failed.join(", ") || "—"} · sign-off required: ${r.signoffRequired.join(", ") || "—"}`);
  process.exitCode = r.pass ? 0 : 1;
}
