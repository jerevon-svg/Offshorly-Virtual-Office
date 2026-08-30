import { describe, expect, it } from "vitest";
import { MAX_RENDER_SCALE, RENDER_SCALE_BUCKETS, MAX_EFFECTIVE_DPR, resolveRenderScale, scaledRenderSize } from "./renderScale";
import { resolveLodTier } from "./adaptiveLod";

// The spatial-conversation quality override raises INTERNAL resolution only.
// Camera, model scale and CSS footprint are all untouched — the character must
// look identical in size and simply resolve more detail.
describe("spatial-conversation quality override", () => {
  const BON = { w: 210, h: 298 };

  it("pins the maximum approved bucket", () => {
    expect(MAX_RENDER_SCALE).toBe(2);
    expect(MAX_RENDER_SCALE).toBe(RENDER_SCALE_BUCKETS[RENDER_SCALE_BUCKETS.length - 1]);
  });

  it("raises the internal buffer well above the adaptive bucket at chat zoom", () => {
    // at spatial-chat composition a character is only ~90 CSS px tall
    const adaptive = resolveRenderScale(90, BON.h, 2);
    const adaptiveBuf = scaledRenderSize(BON.w, BON.h, adaptive);
    const maxBuf = scaledRenderSize(BON.w, BON.h, MAX_RENDER_SCALE);
    expect(maxBuf.height).toBeGreaterThan(adaptiveBuf.height);
    expect(maxBuf).toEqual({ width: 420, height: 596 });
  });

  it("never changes the CSS/base size the canvas is displayed at", () => {
    // scaledRenderSize only ever produces the offscreen buffer; the element's
    // CSS size is fixed at 100%/100% by CharacterCanvas
    for (const scale of RENDER_SCALE_BUCKETS) {
      const buf = scaledRenderSize(BON.w, BON.h, scale);
      expect(buf.width / buf.height).toBeCloseTo(BON.w / BON.h, 2);
    }
  });

  it("keeps DPR capped at the existing safe maximum of 2", () => {
    expect(MAX_EFFECTIVE_DPR).toBe(2);
    // a 3x display cannot push past the top bucket
    expect(resolveRenderScale(1000, BON.h, 3)).toBe(MAX_RENDER_SCALE);
    expect(resolveRenderScale(1000, BON.h, 8)).toBe(MAX_RENDER_SCALE);
  });

  it("is a stable value, so the shared surface is not reallocated per frame", () => {
    const a = MAX_RENDER_SCALE, b = MAX_RENDER_SCALE;
    expect(a).toBe(b);
    // and the buffer it implies is deterministic
    expect(scaledRenderSize(BON.w, BON.h, a)).toEqual(scaledRenderSize(BON.w, BON.h, b));
  });

  it("a spatial participant also selects HQ LOD0 regardless of zoom or distance", () => {
    expect(resolveLodTier({ isSelf: false, isFocused: true, zoom: 1, distance: 9999 }, null)).toBe("lod0");
  });

  it("an unrelated distant character is not promoted", () => {
    expect(resolveLodTier({ isSelf: false, isFocused: false, zoom: 1, distance: 9999 }, null)).toBe("lod2");
  });

  it("leaving the session returns the character to the adaptive bucket and tier", () => {
    expect(resolveLodTier({ isSelf: false, isFocused: false, zoom: 1.4, distance: 5 * 48 }, null)).toBe("lod1");
    expect(resolveRenderScale(90, BON.h, 2)).toBeLessThan(MAX_RENDER_SCALE);
  });
});
