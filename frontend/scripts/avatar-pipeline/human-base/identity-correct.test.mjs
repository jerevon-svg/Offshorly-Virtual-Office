// identity-correct.test.mjs — the OFFSHORLY STYLE GUARDS on automatic identity correction (2026-10-13 regression audit). From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/identity-correct.test.mjs
import { describe, expect, it } from "vitest";
import { planCorrection, planLength } from "./identity-plan.mjs";

const rel = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v, flag: "OBSERVED" }]));
const g3 = { eyeY: 1, chinY: 0, noseY: 0.6, mouthY: 0.35 };

describe("the face is never shortened (a shorter face reads wider)", () => {
  it("a target shorter than the head keeps the long-face band's length (Jona ×0.861, Nicole ×0.938, Bon's photo ×0.885)", () => {
    const L = planLength(rel({ "frame.faceH_IOD": 1.33, "h.IOD_cheekW": 0.40 }), rel({ "frame.faceH_IOD": 1.02, "h.IOD_cheekW": 0.448 }));
    expect(L.mul).toBeLessThan(1); expect(L.apply).toBe(false); expect(L.why).toMatch(/never shortened/);
  });
  it("lengthening the too-wide Meshy face still applies (Kael ×1.12)", () => {
    const L = planLength(rel({ "frame.faceH_IOD": 1.108, "h.IOD_cheekW": 0.46 }), rel({ "frame.faceH_IOD": 1.244, "h.IOD_cheekW": 0.46 }));
    expect(L.apply).toBe(true); expect(L.mul).toBeCloseTo(1.1227, 3);
  });
  it("converts the target with the true eye ratio, so a narrower-eyed target does not lengthen a face that is already right (Lui)", () => {
    const L = planLength(rel({ "frame.faceH_IOD": 1.044, "h.IOD_cheekW": 0.52 }), rel({ "frame.faceH_IOD": 1.128, "h.IOD_cheekW": 0.4785 }));
    expect(L.eyeK).toBeCloseTo(0.9202, 3); expect(L.apply).toBe(false);
  });
});

describe("the eyes are never moved closer", () => {
  const m = rel({ "h.IOD_cheekW": 0.52, "frame.cheekW_IOD": 1.957, "frame.jawW_IOD": 1.136 });
  it("a narrower-eyed target is not applied — but still converts the widths, so the face keeps its absolute proportions (Lui)", () => {
    const P = planCorrection(m, rel({ "h.IOD_cheekW": 0.4785, "frame.cheekW_IOD": 2.1268, "frame.jawW_IOD": 1.1388 }), g3);
    expect(P.eyeK).toBeCloseTo(0.9202, 3); expect(P.eyeMove).toBe(1);
    expect(P.levels.find((l) => l[0] === "eyeSpacing")[2]).toMatch(/never moved closer/);
    expect(P.levels.find((l) => l[0] === "cheek")[1]).toBeCloseTo(1.0, 2);     // cheek already right in absolute terms
  });
  it("a wider-eyed target still moves the eyes apart (up to the clamp)", () => {
    const P = planCorrection(rel({ "h.IOD_cheekW": 0.36, "frame.cheekW_IOD": 2.76 }), rel({ "h.IOD_cheekW": 0.448, "frame.cheekW_IOD": 2.398 }), g3);
    expect(P.eyeMove).toBeCloseTo(1.12, 5); expect(P.apply).toBe(true);
  });
});
