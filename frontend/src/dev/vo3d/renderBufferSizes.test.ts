// REGRESSION — render scale must actually shrink the expensive buffers.
//
// WHAT WAS WRONG. EffectComposer samples renderer.getPixelRatio() once, in its constructor, and when it
// is handed a custom render target it does not sample it at all — it pins its ratio to 1. This build
// hands it one (the beauty buffer carries the depth texture SSAO reads). So Renderer.resize() moved the
// CANVAS pixel ratio and the composer ignored it: measured live, the canvas went 1088x612 → 960x540 →
// 1088x612 across rungs while the composer's beauty target sat at 1280x720 the whole time. The scene was
// still being rasterised at full resolution and blitted down at the end — Smooth's first and cheapest
// lever was buying essentially nothing.
//
// These assertions are on the ARITHMETIC, which is where the defect lived. They are paired with a live
// WebGL measurement of the real targets (reported separately); what belongs in the suite is the part
// that can be checked deterministically and will catch a future regression without a GPU.
import { describe, expect, it } from "vitest";
import { renderBufferSizes } from "./render/Renderer";
import { SMOOTH_LADDER } from "../../services/render/graphicsQuality";

const CSS_W = 1280;
const CSS_H = 720;
/** The Full Graphics AO fraction (Renderer's AO_SCALE). */
const AO = 0.5;

const at = (scale: number, dpr = 1, ao = AO) => renderBufferSizes(CSS_W, CSS_H, dpr, scale, ao);

describe("Full Graphics is untouched", () => {
  it("allocates exactly what the approved build allocated at scale 1", () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const full = at(1, dpr);
      const cap = Math.min(dpr, 2);
      expect(full.pixelRatio).toBe(cap);
      expect(full.beauty).toEqual({ width: Math.round(CSS_W * cap), height: Math.round(CSS_H * cap) });
      // AO stays a fraction of the CSS size, as it always has been — this fix does not re-derive it.
      expect(full.ao).toEqual({ width: CSS_W * AO, height: CSS_H * AO });
    }
  });

  it("still caps the device pixel ratio at 2", () => {
    expect(at(1, 4).pixelRatio).toBe(2);
  });
});

describe("every Smooth rung genuinely reduces the internal resolution", () => {
  // The ladder's own values, not copies of them — retuning the ladder retunes this test with it.
  const scales = SMOOTH_LADDER.map((r) => r.renderScale);

  it("matches the ladder this test is written against", () => {
    expect(scales).toEqual([0.65, 0.75, 0.85, 1]);
  });

  it("shrinks the beauty buffer at every rung below the top", () => {
    const full = at(1);
    for (const scale of scales.filter((s) => s < 1)) {
      const rung = at(scale);
      expect(rung.beauty.width).toBeLessThan(full.beauty.width);
      expect(rung.beauty.height).toBeLessThan(full.beauty.height);
    }
  });

  it("shrinks the AO buffer at every rung below the top", () => {
    const full = at(1);
    for (const scale of scales.filter((s) => s < 1)) {
      const rung = at(scale);
      expect(rung.ao.width).toBeLessThan(full.ao.width);
      expect(rung.ao.height).toBeLessThan(full.ao.height);
    }
  });

  it("pins the exact dimensions at 1280x720, dpr 1 — rung by rung", () => {
    expect(at(1)).toEqual({ pixelRatio: 1, beauty: { width: 1280, height: 720 }, ao: { width: 640, height: 360 } });
    expect(at(0.85)).toEqual({ pixelRatio: 0.85, beauty: { width: 1088, height: 612 }, ao: { width: 544, height: 306 } });
    expect(at(0.75)).toEqual({ pixelRatio: 0.75, beauty: { width: 960, height: 540 }, ao: { width: 480, height: 270 } });
    expect(at(0.65)).toEqual({ pixelRatio: 0.65, beauty: { width: 832, height: 468 }, ao: { width: 416, height: 234 } });
  });

  it("drops real pixel count — the thing the lever is actually spending", () => {
    const px = (s: number) => at(s).beauty.width * at(s).beauty.height;
    const fullPx = px(1);
    // ~28% / ~44% / ~58% of the fragments, which is why resolution is spent before any effect is cut.
    expect(px(0.85) / fullPx).toBeCloseTo(0.7225, 3);
    expect(px(0.75) / fullPx).toBeCloseTo(0.5625, 3);
    expect(px(0.65) / fullPx).toBeCloseTo(0.4225, 3);
  });

  it("is monotonic — a lower rung never allocates more", () => {
    for (let i = 1; i < scales.length; i++) {
      expect(at(scales[i - 1]).beauty.width).toBeLessThanOrEqual(at(scales[i]).beauty.width);
      expect(at(scales[i - 1]).ao.width).toBeLessThanOrEqual(at(scales[i]).ao.width);
    }
  });
});

describe("the AO fraction still means what it meant", () => {
  it("follows the ladder's own aoResolutionScale without the scale changing its meaning", () => {
    // rung 2 lowers the AO fraction 0.5 -> 0.35; that is a separate lever and still composes cleanly.
    expect(at(0.85, 1, 0.35).ao).toEqual({ width: Math.round(1280 * 0.35 * 0.85), height: Math.round(720 * 0.35 * 0.85) });
  });
});

describe("the renderer and the composer are told the SAME ratio", () => {
  it("exposes one pixelRatio for both — the bug was two of them disagreeing", () => {
    for (const scale of [1, 0.85, 0.75, 0.65]) {
      const s = at(scale, 2);
      expect(s.pixelRatio).toBe(2 * scale);
      expect(s.beauty.width).toBe(Math.round(CSS_W * s.pixelRatio));
    }
  });
});
