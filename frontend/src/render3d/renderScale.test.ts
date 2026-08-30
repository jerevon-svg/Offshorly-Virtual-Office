import { describe, expect, it } from "vitest";
import { MAX_EFFECTIVE_DPR, RENDER_SCALE_BUCKETS, resolveRenderScale, scaledRenderSize } from "./renderScale";

describe("resolveRenderScale (DPR-aware CharacterCanvas render size)", () => {
  it("falls back to the base size (scale 1) when the canvas has no layout size yet", () => {
    expect(resolveRenderScale(0, 298, 2)).toBe(1);
    expect(resolveRenderScale(NaN, 298, 2)).toBe(1);
  });

  it("picks the smallest bucket that covers on-screen device pixels (bon 298 base): 37css@1x -> 0.5, 92css@2x -> 0.75, 185css@2x -> 1.5", () => {
    expect(resolveRenderScale(37, 298, 1)).toBe(0.5);
    expect(resolveRenderScale(92, 298, 2)).toBe(0.75);
    expect(resolveRenderScale(185, 298, 2)).toBe(1.5);
    expect(resolveRenderScale(298, 298, 1)).toBe(1);
  });

  it("caps the effective device pixel ratio at 2 and never exceeds the top bucket", () => {
    expect(MAX_EFFECTIVE_DPR).toBe(2);
    expect(resolveRenderScale(298, 298, 3)).toBe(resolveRenderScale(298, 298, 2));
    expect(resolveRenderScale(5000, 298, 3)).toBe(RENDER_SCALE_BUCKETS[RENDER_SCALE_BUCKETS.length - 1]);
    expect(resolveRenderScale(298, 298, 0)).toBe(1); // bogus dpr treated as 1
  });

  it("scales width and height together so the calibrated aspect/framing is preserved", () => {
    expect(scaledRenderSize(210, 298, 1.5)).toEqual({ width: 315, height: 447 });
    expect(scaledRenderSize(172, 276, 0.5)).toEqual({ width: 86, height: 138 });
    const a = scaledRenderSize(160, 276, 2);
    expect(a.width / a.height).toBeCloseTo(160 / 276, 3);
  });
});
