// studio/runtime-avatars.mjs — APPROVED HEADS AT RUNTIME (dev-only, 2026-10-13). Lets the Virtual Office draw an employee's
// approved HumanBase head WITHOUT promoting it: no file is copied, humanMounts.generated.json is not touched, nothing needs a
// redeploy. A head is delivered only when it passes exactly the checks build-employees promoteCandidate makes before it copies
// a file — frozen fixtures and promoted heads are left to the bundle, simulated stages are refused, every automated class must
// pass, every sign-off class the report requires must be covered by an approval bound to this exact artifact + pipeline +
// mount, the mount binding must verify, and the file on disk must still hash to what the gate measured. Run from frontend/.
import fs from "node:fs";
import { approvalCovers, FROZEN } from "../failure-registry.mjs";
import { bindingHashOf, canonicalMount, sha256 } from "../gate.mjs";

/** one person's runtime record, or { refused } naming the first check that failed */
export function runtimeRecord(who, { version, approval = null, simulated = [], promoted = {}, email = null, hashFile = sha256, exists = fs.existsSync }) {
  if (FROZEN.has(who)) return { refused: "a frozen approved character (already in production)" };
  if (promoted[who]) return { refused: "already promoted (the bundle serves it)" };
  if (simulated.length) return { refused: `built from simulated stage(s): ${simulated.join(", ")}` };
  const rep = version?.report;
  if (!rep || !version.file || !exists(version.file)) return { refused: "no built candidate" };
  if (!rep.automatedPass || (rep.failed ?? []).length) return { refused: "the automated checks did not pass" };
  const need = rep.signoffRequired ?? [];
  const bound = { artifactHash: rep.artifactHash, pipelineVersion: rep.pipelineVersion, bindingHash: rep.bindingHash };
  const missing = need.filter((c) => !approvalCovers(approval, c, bound));
  if (missing.length) return { refused: `visual sign-off missing: ${missing.join(", ")}` };
  const mount = canonicalMount(rep.validatedMount);
  if (!mount || !rep.bindingHash || bindingHashOf(rep.artifactHash, mount) !== rep.bindingHash) return { refused: "the head mount binding does not verify" };
  if (hashFile(version.file) !== rep.artifactHash) return { refused: "the file changed after the gate measured it" };
  return {
    castId: who, email, file: version.file, tag: version.tag,
    head: { artifactHash: rep.artifactHash, pipelineVersion: rep.pipelineVersion, mount, bindingHash: rep.bindingHash, validatedAt: rep.builtAt, ...(rep.bodyPreset === "feminine" ? { bodyPreset: "feminine" } : {}) },
  };
}

/** every person's verdict: { avatars: [delivered records], refused: { who: reason } } */
export function runtimeAvatars(ids, { versionOf, approvalOf, simulatedOf, promoted, emailOf, hashFile, exists }) {
  const avatars = [], refused = {};
  for (const who of ids) {
    const r = runtimeRecord(who, { version: versionOf(who), approval: approvalOf(who), simulated: simulatedOf(who), promoted, email: emailOf(who), hashFile, exists });
    if (r.refused) refused[who] = r.refused; else avatars.push(r);
  }
  return { avatars, refused };
}
