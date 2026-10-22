// delivery-candidate.test.mjs — what runtime delivery selects (candidate-versions deliveryCandidate, 2026-10-21): the exact version a
// recorded human approval names while its artifact still matches, else the production candidate — so an approved experimental
// (--meshy-first xbase) build can be delivered without a rebuild, and nothing is delivered without that approval. Temp roots only.
//   npx vitest run scripts/avatar-pipeline/human-base/delivery-candidate.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { deliveryCandidate, layout } from "./candidate-versions.mjs";
import { runtimeRecord } from "./studio/runtime-avatars.mjs";

const made = []; afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function root() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "dlv-")); made.push(r);
  for (const [tag, hash, extra] of [["base-v1", "aaa", {}], ["xbase-v1", "bbb", { experimental: true }]]) {
    const L = layout("zz", tag, r); fs.mkdirSync(L.passes[0], { recursive: true }); fs.writeFileSync(`${L.passes[0]}/zz-v1.glb`, tag);
    fs.writeFileSync(L.report, JSON.stringify({ builtAt: new Date().toISOString(), head: "v1", artifactHash: hash, automatedPass: true, failed: [], signoffRequired: ["FC-EAR-BOUNDARY"], ...extra })); }
  return r;
}

describe("deliveryCandidate", () => {
  it("no approval → the production candidate (base), exactly as before", () => {
    expect(deliveryCandidate("zz", null, root()).tag).toBe("base-v1");
  });
  it("an approval naming a version whose artifact it is bound to → that exact version (an approved experimental build)", () => {
    expect(deliveryCandidate("zz", { tag: "xbase-v1", artifactHash: "bbb" }, root()).tag).toBe("xbase-v1");
  });
  it("a stale approval (artifact no longer matches) or a missing version → the production candidate, never the named one", () => {
    const r = root();
    expect(deliveryCandidate("zz", { tag: "xbase-v1", artifactHash: "changed" }, r).tag).toBe("base-v1");
    expect(deliveryCandidate("zz", { tag: "xbase-v9", artifactHash: "bbb" }, r).tag).toBe("base-v1");
  });
  it("selection never bypasses the sign-off: the selected base version without its own approval is still refused", () => {
    const r = root(), v = deliveryCandidate("zz", { tag: "xbase-v1", artifactHash: "changed" }, r);
    expect(runtimeRecord("zz", { version: v, approval: { tag: "xbase-v1", artifactHash: "changed", classes: ["FC-EAR-BOUNDARY"] }, exists: () => true, hashFile: () => "aaa" }).refused).toMatch(/sign-off missing|binding/);
  });
});
