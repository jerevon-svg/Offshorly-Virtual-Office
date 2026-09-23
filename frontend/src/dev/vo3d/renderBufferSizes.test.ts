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
import { TARGET_RENDER_DENSITY, renderBufferSizes } from "./render/Renderer";
import { SMOOTH_LADDER } from "../../services/render/graphicsQuality";

const CSS_W = 1280;
const CSS_H = 720;
/** The Full Graphics AO fraction (Renderer's AO_SCALE). */
const AO = 0.5;

const at = (scale: number, dpr = 1, ao = AO) => renderBufferSizes(CSS_W, CSS_H, dpr, scale, ao);

describe("Full Graphics is the SAME on every display", () => {
  // THE REGRESSION THIS PINS. The ratio used to be `Math.min(devicePixelRatio, 2)`, so Full Graphics
  // rendered at density 2 on a Retina panel and density 1 on an external monitor — and since the
  // composer bypasses the canvas' `antialias: true` and every target is `samples: 0`, that ratio is
  // V2's only antialiasing. The same build, same setting and same avatar measured 2.81% strong-speckle
  // pixels on the hair at density 1 against 0.48% at density 2. Nobody chose that; the monitor did.
  it("renders at the target density whatever the display reports", () => {
    for (const dpr of [1, 1.25, 1.5, 2, 3, 4]) {
      const full = at(1, dpr);
      expect(full.pixelRatio).toBe(TARGET_RENDER_DENSITY);
      expect(full.beauty).toEqual({
        width: Math.round(CSS_W * TARGET_RENDER_DENSITY),
        height: Math.round(CSS_H * TARGET_RENDER_DENSITY),
      });
      // AO stays a fraction of the CSS size, as it always has been — this fix does not re-derive it.
      expect(full.ao).toEqual({ width: CSS_W * AO, height: CSS_H * AO });
    }
  });

  it("supersamples a low-DPR display UP to the target", () => {
    expect(at(1, 1).pixelRatio).toBe(2);
    expect(at(1, 1.5).pixelRatio).toBe(2);
  });

  it("is a CAP as well as a target — a high-DPR display never doubles past it", () => {
    // The failure mode on the other side: multiplying DPR by 2 would put a Retina panel at 4 and
    // quadruple its fragment cost for no visible gain.
    for (const dpr of [2, 2.5, 3, 4]) expect(at(1, dpr).pixelRatio).toBe(2);
    expect(at(1, 2).beauty.width).toBe(CSS_W * 2);
    expect(at(1, 2).beauty.width).not.toBe(CSS_W * 4);
  });

  it("leaves the DPR-2 allocation byte-for-byte what the 70-avatar validation measured", () => {
    // The stress harness forces deviceScaleFactor 2, so every approved V2 capture was taken here.
    const validated = renderBufferSizes(1440, 810, 2, 1, AO);
    expect(validated.pixelRatio).toBe(2);
    expect(validated.beauty).toEqual({ width: 2880, height: 1620 });
  });

  it("gives a DPR-1 display the identical allocation to a DPR-2 one", () => {
    expect(at(1, 1)).toEqual(at(1, 2));
  });
});

describe("every Smooth rung genuinely reduces the internal resolution", () => {
  // The ladder's own values, not copies of them — retuning the ladder retunes this test with it.
  const scales = SMOOTH_LADDER.map((r) => r.renderScale);

  it("matches the ladder this test is written against", () => {
    expect(scales).toEqual([0.65, 0.75, 1, 1]);
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

  it("pins the exact dimensions at 1280x720 — rung by rung, on ANY display", () => {
    // Density 2 throughout: these are now the numbers a DPR-1 machine allocates as well as a DPR-2 one.
    for (const dpr of [1, 2]) {
      expect(at(1, dpr)).toEqual({ pixelRatio: 2, beauty: { width: 2560, height: 1440 }, ao: { width: 640, height: 360 } });
      expect(at(0.75, dpr)).toEqual({ pixelRatio: 1.5, beauty: { width: 1920, height: 1080 }, ao: { width: 480, height: 270 } });
      expect(at(0.65, dpr)).toEqual({ pixelRatio: 1.3, beauty: { width: 1664, height: 936 }, ao: { width: 416, height: 234 } });
    }
  });

  it("keeps even the Smooth FLOOR above the density the old DPR-1 build gave Full", () => {
    // The floor rung now renders at 1.3x where a DPR-1 display used to give Full itself 1.0x.
    expect(at(0.65, 1).pixelRatio).toBeGreaterThan(1);
  });

  it("drops real pixel count — the thing the lever is actually spending", () => {
    const px = (s: number) => at(s).beauty.width * at(s).beauty.height;
    const fullPx = px(1);
    // ~56% / ~42% of the fragments at the two rungs that do spend density (1 and 0).
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
    // rung 2 lowers the AO fraction 0.5 -> 0.35 WITHOUT touching render scale; still composes cleanly.
    expect(at(1, 1, 0.35).ao).toEqual({ width: Math.round(1280 * 0.35), height: Math.round(720 * 0.35) });
    expect(at(0.75, 1, 0.35).ao).toEqual({ width: Math.round(1280 * 0.35 * 0.75), height: Math.round(720 * 0.35 * 0.75) });
  });
});

describe("the renderer and the composer are told the SAME ratio", () => {
  it("exposes one pixelRatio for both — the bug was two of them disagreeing", () => {
    for (const scale of [1, 0.75, 0.65]) {
      const s = at(scale, 2);
      expect(s.pixelRatio).toBeCloseTo(TARGET_RENDER_DENSITY * scale, 10);
      expect(s.beauty.width).toBe(Math.round(CSS_W * s.pixelRatio));
    }
  });
});
