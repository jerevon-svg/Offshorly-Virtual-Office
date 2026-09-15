// THE FULL GRAPHICS BENCHMARK, pinned.
//
// The point of these assertions is not that the numbers are right — that is a visual judgement someone
// made and approved. The point is that they cannot MOVE without somebody editing this file, so a later
// performance pass cannot lower the benchmark it is being measured against and then report a win.
import { describe, expect, it } from "vitest";
import {
  CUSTOM_CONTROLS,
  CUSTOM_CONTROL_IDS,
  FULL_GRAPHICS,
  MAX_QUALITY_LEVEL,
  SMOOTH_LADDER,
  isValidCustomValue,
  resolveGraphics,
  sameGraphics,
  type GraphicsSettings,
} from "./graphicsQuality";

describe("Full Graphics", () => {
  it("is exactly the approved baseline", () => {
    expect(FULL_GRAPHICS).toEqual({
      renderScale: 1,
      ambientOcclusion: true,
      aoResolutionScale: 0.5,
      shadows: true,
      shadowMapSize: 2048,
      weatherEffects: true,
      effectsDetail: "full",
      foliageSway: true,
      avatarDetail: "high",
    });
  });

  it("is what 'full' resolves to whatever the adaptive rung or the stored overrides say", () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(resolveGraphics("full", level, { renderScale: 0.65, shadows: false, ambientOcclusion: false })).toEqual(
        FULL_GRAPHICS,
      );
    }
  });

  it("is the top rung of the Smooth ladder, byte for byte", () => {
    expect(SMOOTH_LADDER[MAX_QUALITY_LEVEL]).toEqual(FULL_GRAPHICS);
    expect(resolveGraphics("smooth", MAX_QUALITY_LEVEL, {})).toEqual(FULL_GRAPHICS);
  });

  it("is frozen, so nothing can mutate the benchmark at runtime", () => {
    expect(Object.isFrozen(FULL_GRAPHICS)).toBe(true);
  });
});

describe("the Smooth ladder", () => {
  it("has four rungs, worst to best", () => {
    expect(SMOOTH_LADDER).toHaveLength(4);
  });

  it("never asks for MORE work as it goes down", () => {
    for (let i = 1; i < SMOOTH_LADDER.length; i++) {
      const lower = SMOOTH_LADDER[i - 1];
      const higher = SMOOTH_LADDER[i];
      expect(lower.renderScale).toBeLessThanOrEqual(higher.renderScale);
      expect(lower.shadowMapSize).toBeLessThanOrEqual(higher.shadowMapSize);
      expect(Number(lower.ambientOcclusion)).toBeLessThanOrEqual(Number(higher.ambientOcclusion));
      expect(Number(lower.foliageSway)).toBeLessThanOrEqual(Number(higher.foliageSway));
      expect(Number(lower.weatherEffects)).toBeLessThanOrEqual(Number(higher.weatherEffects));
    }
  });

  it("spends resolution before it gives up an effect", () => {
    // Rung 2 is a pure resolution trim: every system is still on, nothing has left the picture.
    const [, , second, full] = SMOOTH_LADDER;
    expect(second.renderScale).toBeLessThan(full.renderScale);
    expect(second.ambientOcclusion).toBe(true);
    expect(second.shadows).toBe(true);
    expect(second.foliageSway).toBe(true);
    expect(second.weatherEffects).toBe(true);
    expect(second.effectsDetail).toBe("full");
  });

  it("keeps shadows on at every rung, including the floor", () => {
    // Shadows carry more of the office's visual identity than any other single system, and the split
    // static/dynamic path made them comparatively cheap. SSAO is the cost that gets given up instead.
    for (const rung of SMOOTH_LADDER) expect(rung.shadows).toBe(true);
    expect(SMOOTH_LADDER[0].ambientOcclusion).toBe(false);
  });

  it("never moves avatar detail — that is an asset reload, not a render switch", () => {
    for (const rung of SMOOTH_LADDER) expect(rung.avatarDetail).toBe("high");
  });
});

describe("Custom", () => {
  it("only exposes safe switches — no authored art or debug parameters", () => {
    expect([...CUSTOM_CONTROL_IDS].sort()).toEqual(
      ["ambientOcclusion", "avatarDetail", "effectsDetail", "foliageSway", "renderScale", "shadows", "weatherEffects"].sort(),
    );
  });

  it("offers no control over lighting, AO tuning, shadow bias or internal flags", () => {
    const forbidden = ["keyIntensity", "ambientIntensity", "envIntensity", "exposure", "kernelRadius", "minDistance",
      "maxDistance", "bias", "normalBias", "shadowCache", "ssaoDepthReuse", "staticBatching", "roomCulling", "moonColor",
      "sunWarmth", "azimuth", "elevation"];
    for (const key of forbidden) expect(CUSTOM_CONTROL_IDS).not.toContain(key);
  });

  it("layers overrides on the Full baseline, leaving untouched settings at full quality", () => {
    const result = resolveGraphics("custom", 0, { shadows: false });
    expect(result.shadows).toBe(false);
    expect(result.ambientOcclusion).toBe(FULL_GRAPHICS.ambientOcclusion);
    expect(result.renderScale).toBe(FULL_GRAPHICS.renderScale);
    expect(result.foliageSway).toBe(FULL_GRAPHICS.foliageSway);
  });

  it("with nothing overridden is the Full baseline", () => {
    expect(resolveGraphics("custom", 0, {})).toEqual(FULL_GRAPHICS);
  });

  it("follows shadow map size down with render quality", () => {
    expect(resolveGraphics("custom", 0, { renderScale: 1 }).shadowMapSize).toBe(2048);
    expect(resolveGraphics("custom", 0, { renderScale: 0.85 }).shadowMapSize).toBe(2048);
    expect(resolveGraphics("custom", 0, { renderScale: 0.75 }).shadowMapSize).toBe(1024);
    expect(resolveGraphics("custom", 0, { renderScale: 0.65 }).shadowMapSize).toBe(1024);
  });

  it("rejects a value the control does not offer", () => {
    expect(isValidCustomValue("renderScale", 0.1)).toBe(false);
    expect(isValidCustomValue("renderScale", 0.75)).toBe(true);
    expect(isValidCustomValue("shadows", "yes")).toBe(false);
    // ...and a rejected value leaves that setting at the approved default rather than applying it.
    const out = resolveGraphics("custom", 0, { renderScale: 0.1 } as unknown as { renderScale: number });
    expect(out.renderScale).toBe(1);
  });

  it("maps every control to a real settings field", () => {
    const base: GraphicsSettings = { ...FULL_GRAPHICS };
    for (const control of CUSTOM_CONTROLS) {
      expect(Object.keys(base)).toContain(control.id);
      // every offered value is one resolveGraphics will actually honour
      for (const option of control.options) {
        const out = resolveGraphics("custom", 0, { [control.id]: option.value });
        expect(out[control.id as keyof GraphicsSettings]).toEqual(option.value);
      }
    }
  });
});

describe("sameGraphics", () => {
  it("compares every field", () => {
    expect(sameGraphics(FULL_GRAPHICS, { ...FULL_GRAPHICS })).toBe(true);
    for (const key of Object.keys(FULL_GRAPHICS) as (keyof GraphicsSettings)[]) {
      const changed = { ...FULL_GRAPHICS } as GraphicsSettings;
      const v = changed[key];
      Object.assign(changed, { [key]: typeof v === "boolean" ? !v : typeof v === "number" ? v + 1 : "reduced" });
      expect(sameGraphics(FULL_GRAPHICS, changed)).toBe(false);
    }
  });
});
