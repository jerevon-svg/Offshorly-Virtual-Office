// cap-free.test.mjs — the hair base cap is dropped only when the cap-free copy is no worse on any class or closure / pocket measure.
//   npx vitest run scripts/avatar-pipeline/human-base/cap-free.test.mjs
import { describe, expect, it } from "vitest";
import { capFreeVerdict } from "./build-employees.mjs";
const g = (over = {}, failed = []) => { const base = { "FC-CLOSURE-EXPOSED": ["PASS", { pct: 0.5, worstPct: 2.3 }], "FC-CLOSURE-EXPOSED-IN-MOTION": ["PASS", { pct: 0.55, worstPct: 2.7 }], "FC-BALD-POCKET": ["PASS", 3], "FC-EAR-BOUNDARY": ["SIGNOFF-REQUIRED", null] };
  const m = { ...base, ...over }; return { automatedPass: !failed.length, failed, classes: Object.entries(m).map(([id, [status, value]]) => ({ id, status, value })) }; };
describe("cap-free finishing verdict", () => {
  it("keeps the cap-free copy when nothing gets worse", () => { expect(capFreeVerdict(g(), g({ "FC-CLOSURE-EXPOSED": ["PASS", { pct: 0.6, worstPct: 2.9 }] })).ok).toBe(true); });
  it("rejects when a class newly fails or drops to review", () => {
    expect(capFreeVerdict(g(), g({ "FC-BALD-POCKET": ["FAIL", 40] }, ["FC-BALD-POCKET"])).ok).toBe(false);
    expect(capFreeVerdict(g(), g({ "FC-CLOSURE-EXPOSED-IN-MOTION": ["SIGNOFF-REQUIRED", { pct: 3, worstPct: 9 }] })).ok).toBe(false); });
  it("rejects when closure grows beyond noise even inside its tier, or pockets grow", () => {
    expect(capFreeVerdict(g(), g({ "FC-CLOSURE-EXPOSED": ["PASS", { pct: 0.9, worstPct: 2.3 }] })).ok).toBe(false);
    expect(capFreeVerdict(g(), g({ "FC-CLOSURE-EXPOSED-IN-MOTION": ["PASS", { pct: 0.55, worstPct: 4.1 }] })).ok).toBe(false);
    expect(capFreeVerdict(g(), g({ "FC-BALD-POCKET": ["PASS", 9] })).ok).toBe(false); });
});
