// runtime-avatars.test.mjs — an approved head reaches the office at runtime ONLY through promotion's own checks. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/studio/runtime-avatars.test.mjs
import { describe, expect, it } from "vitest";
import { bindingHashOf } from "../gate.mjs";
import { SIGNOFF_CLASSES } from "../failure-registry.mjs";
import { runtimeAvatars, runtimeRecord } from "./runtime-avatars.mjs";

const artifactHash = "f".repeat(64), mount = { scale: 0.91, pitchDeg: 0 }, bindingHash = bindingHashOf(artifactHash, mount);
const report = (over = {}) => ({ automatedPass: true, failed: [], signoffRequired: [...SIGNOFF_CLASSES], artifactHash, pipelineVersion: "pv1", bindingHash, validatedMount: mount, builtAt: "2026-10-13T00:00:00Z", bodyPreset: "standard", ...over });
const version = (over) => ({ tag: "corr-v1", file: "cand.glb", report: report(over) });
const approval = (over = {}) => ({ artifactHash, pipelineVersion: "pv1", bindingHash, classes: [...SIGNOFF_CLASSES], reviewer: "Bon", timestamp: "2026-10-13T01:00:00Z", ...over });
const io = { hashFile: () => artifactHash, exists: () => true };

describe("runtime avatars (studio/runtime-avatars.mjs)", () => {
  it("delivers an approved, unpromoted head with the record promotion would write — and copies nothing", () => {
    const r = runtimeRecord("kael", { version: version(), approval: approval(), email: "kael@offshorly.com", ...io });
    expect(r.refused).toBeUndefined();
    expect(r).toMatchObject({ castId: "kael", email: "kael@offshorly.com", file: "cand.glb", head: { artifactHash, pipelineVersion: "pv1", mount, bindingHash } });
  });
  it("refuses without every visual sign-off, or with one bound to another artifact or pipeline", () => {
    expect(runtimeRecord("kael", { version: version(), approval: null, ...io }).refused).toMatch(/sign-off missing/);
    expect(runtimeRecord("kael", { version: version(), approval: approval({ classes: ["FC-EAR-BOUNDARY"] }), ...io }).refused).toMatch(/FC-HAIR-SPIKE/);
    expect(runtimeRecord("kael", { version: version(), approval: approval({ artifactHash: "0".repeat(64) }), ...io }).refused).toMatch(/sign-off missing/);
    expect(runtimeRecord("kael", { version: version(), approval: approval({ pipelineVersion: "old" }), ...io }).refused).toMatch(/sign-off missing/);
  });
  it("refuses frozen and promoted characters, simulated builds, automated failures, a tampered file and a broken mount binding", () => {
    expect(runtimeRecord("bon", { version: version(), approval: approval(), ...io }).refused).toMatch(/frozen/);
    expect(runtimeRecord("kael", { version: version(), approval: approval(), promoted: { kael: {} }, ...io }).refused).toMatch(/promoted/);
    expect(runtimeRecord("kael", { version: version(), approval: approval(), simulated: ["meshy"], ...io }).refused).toMatch(/simulated/);
    expect(runtimeRecord("kael", { version: version({ automatedPass: false, failed: ["FC-SKIN-FLAP"] }), approval: approval(), ...io }).refused).toMatch(/automated/);
    expect(runtimeRecord("kael", { version: version(), approval: approval(), hashFile: () => "0".repeat(64), exists: () => true }).refused).toMatch(/file changed/);
    expect(runtimeRecord("kael", { version: version({ validatedMount: { scale: 1.2, pitchDeg: 0 } }), approval: approval(), ...io }).refused).toMatch(/binding/);
    expect(runtimeRecord("kael", { version: null, approval: approval(), ...io }).refused).toMatch(/no built candidate/);
  });
  it("lists every person's verdict", () => {
    const out = runtimeAvatars(["kael", "lui"], { versionOf: () => version(), approvalOf: (w) => (w === "kael" ? approval() : null), simulatedOf: () => [], promoted: {}, emailOf: () => null, ...io });
    expect(out.avatars.map((a) => a.castId)).toEqual(["kael"]);
    expect(out.refused.lui).toMatch(/sign-off missing/);
  });
});
