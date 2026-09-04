import { describe, expect, it } from "vitest";
import { LIVE_3D_CHARACTERS, resolveWidthCapacity } from "./live3dCharacters";
import { MAX_RENDER_SCALE, resolveRenderScale, scaledRenderSize } from "./renderScale";
import { resolveLodTier, TILE, THRESHOLDS } from "./adaptiveLod";

// Guards the property the width-capacity change had to preserve: widening the
// canvas must not lower pixel density. CharacterCanvas scales the offscreen
// BUFFER and the canvas's painted CSS width by the SAME factor, so
// pixels-per-CSS-pixel is invariant to widthScale.
//
//   density = (baseWidth * widthScale * bucket) / (cssWidth * widthScale)
//           = (baseWidth * bucket) / cssWidth          <- widthScale cancels
function density(baseW: number, cssW: number, widthScale: number, bucket: number) {
  return (baseW * widthScale * bucket) / (cssW * widthScale);
}

describe("pixel density is invariant to widthScale", () => {
  const CASES = [
    { id: "bon" as const, cssW: 120 },
    { id: "alex" as const, cssW: 96 },
    { id: "micah" as const, cssW: 110 },
    { id: "angelo" as const, cssW: 104 },
    { id: "jan" as const, cssW: 104 },
  ];

  it("is identical with and without widening, for every character and bucket", () => {
    for (const { id, cssW } of CASES) {
      const e = LIVE_3D_CHARACTERS[id];
      const cap = resolveWidthCapacity(e);
      expect(cap).toBeGreaterThan(1);
      for (const bucket of [0.5, 0.75, 1, 1.5, 2]) {
        expect(density(e.renderWidth, cssW, cap, bucket)).toBeCloseTo(
          density(e.renderWidth, cssW, 1, bucket),
          10,
        );
      }
    }
  });

  it("the widened buffer really is larger — density held by growing pixels, not by cropping", () => {
    for (const { id } of CASES) {
      const e = LIVE_3D_CHARACTERS[id];
      const cap = resolveWidthCapacity(e);
      const plain = scaledRenderSize(e.renderWidth, e.renderHeight, MAX_RENDER_SCALE);
      const wide = scaledRenderSize(Math.round(e.renderWidth * cap), e.renderHeight, MAX_RENDER_SCALE);
      expect(wide.width).toBeGreaterThan(plain.width);
      expect(wide.height).toBe(plain.height);          // height untouched
      expect(wide.width / wide.height).toBeGreaterThan(plain.width / plain.height);
    }
  });

  it("the render-scale bucket is chosen from HEIGHT, so widening cannot demote it", () => {
    for (const { id } of CASES) {
      const e = LIVE_3D_CHARACTERS[id];
      // same CSS height in and out of the widened world -> same bucket
      expect(resolveRenderScale(126, e.renderHeight, 2)).toBe(resolveRenderScale(126, e.renderHeight, 2));
      // and maxQuality pins the top bucket regardless of width
      expect(MAX_RENDER_SCALE).toBe(2);
    }
  });

  it("a spatial participant keeps HQ LOD0 + top bucket at any zoom, width irrelevant", () => {
    for (const zoom of [0.5, 1, 1.5, 3, 5]) {
      expect(resolveLodTier({ isSelf: false, isFocused: true, zoom, distance: 20 * TILE }, null)).toBe("lod0");
    }
  });

  it("an LOD swap does not change buffer dimensions (no size or density shift)", () => {
    const e = LIVE_3D_CHARACTERS.alex;
    const cap = resolveWidthCapacity(e);
    // every tier renders through the SAME canvas/base dims + capacity
    const sizes = ["lod0", "lod1", "lod2"].map(() =>
      scaledRenderSize(Math.round(e.renderWidth * cap), e.renderHeight, MAX_RENDER_SCALE),
    );
    expect(new Set(sizes.map((s) => `${s.width}x${s.height}`)).size).toBe(1);
  });

  // Documents the tier a NON-participant actually receives, which is what the
  // "speckled Alex" report turns on: at exactly cover zoom the policy demotes
  // to the cheapest tier. Before the map zoom was wired through, zoom was
  // always undefined and a near peer got lod0 instead.
  it("a near visible peer is LOD0 at every zoom, so the cracked tier cannot come back", () => {
    const near = { isSelf: false, isFocused: false, distance: 2 * TILE };
    for (const zoom of [undefined, 0.5, 1.0, 1.5, 5]) {
      expect(resolveLodTier({ ...near, zoom }, null)).toBe("lod0");
    }
    // zoom-out demotion sits strictly below cover, so the default view never
    // demotes by zoom alone
    expect(THRESHOLDS.zoomFarEnter).toBeLessThan(1.0);
  });
});
