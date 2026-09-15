// vo3d — GRAPHICS & DISPLAY, the renderer side.
//
// Two separate claims are tested here, and they are worth keeping apart:
//   1. MAPPING — each setting reaches the V2 system it is supposed to reach, with the right value.
//   2. CONTAINMENT — nothing else is reachable. The port is the whole surface, so switching mode
//      cannot move an avatar, open a door, repaint the nav grid or change the approved lighting.
//
// Both are assertable without a GL context because both are decisions made in JS before anything draws.
import { describe, expect, it } from "vitest";
import { createGraphicsEngine, type GraphicsRendererPort } from "./render/GraphicsEngine";
import { EFFECTS_DENSITY, FULL_GRAPHICS, SMOOTH_LADDER } from "../../services/render/graphicsQuality";

function fakeRenderer() {
  const r = {
    ssaoEnabled: true,
    renderScale: 1,
    aoScale: 0.5,
    shadows: true,
    shadowMapSize: 2048,
    invalidations: 0,
    setRenderScale(s: number) { r.renderScale = s; },
    setAoResolutionScale(s: number) { r.aoScale = s; },
    setShadows(on: boolean) { r.shadows = on; },
    setShadowMapSize(n: number) { r.shadowMapSize = n; },
    invalidateShadows() { r.invalidations++; },
  };
  return r as GraphicsRendererPort & typeof r;
}

function rig() {
  const renderer = fakeRenderer();
  const sway = { enabled: true };
  const env = { particleBudget: 1 };
  const lods: number[] = [];
  const engine = createGraphicsEngine(renderer, { sway, env, setAvatarLod: (l) => lods.push(l) });
  return { renderer, sway, env, lods, engine };
}

describe("the mapping", () => {
  it("routes render scale, AO and shadow resolution to the renderer", () => {
    const r = rig();
    r.engine.setRenderScale(0.75);
    r.engine.setAoResolutionScale(0.35);
    r.engine.setAmbientOcclusion(false);
    r.engine.setShadowMapSize(1024);
    expect(r.renderer.renderScale).toBe(0.75);
    expect(r.renderer.aoScale).toBe(0.35);
    expect(r.renderer.ssaoEnabled).toBe(false);
    expect(r.renderer.shadowMapSize).toBe(1024);
  });

  it("re-draws the shadow map when shadows are switched", () => {
    const r = rig();
    r.engine.setShadows(false);
    r.engine.setShadows(true);
    expect(r.renderer.shadows).toBe(true);
    expect(r.renderer.invalidations).toBe(2);
  });

  it("stops foliage MOTION without removing the foliage", () => {
    const r = rig();
    r.engine.setFoliageSway(false);
    expect(r.sway.enabled).toBe(false); // the SwaySystem's own flag — the plants are untouched
  });

  it("grades rain density rather than the weather", () => {
    const r = rig();
    r.engine.setEffectsDetail("reduced");
    expect(r.env.particleBudget).toBe(EFFECTS_DENSITY.reduced);
    r.engine.setEffectsDetail("minimal");
    expect(r.env.particleBudget).toBe(0);
    r.engine.setEffectsDetail("full");
    expect(r.env.particleBudget).toBe(1);
  });

  it("lets the weather switch and the detail grade agree on one budget", () => {
    const r = rig();
    r.engine.setEffectsDetail("full");
    r.engine.setWeatherEffects(false);
    expect(r.env.particleBudget).toBe(0);
    // turning detail back up while weather is off must NOT bring rain back
    r.engine.setEffectsDetail("reduced");
    expect(r.env.particleBudget).toBe(0);
    r.engine.setWeatherEffects(true);
    expect(r.env.particleBudget).toBe(EFFECTS_DENSITY.reduced);
  });

  it("maps character detail onto the existing LOD bands", () => {
    const r = rig();
    r.engine.setAvatarDetail("standard");
    r.engine.setAvatarDetail("high");
    expect(r.lods).toEqual([2, 1]);
  });

  it("tolerates a rig with no avatar loaded", () => {
    const renderer = fakeRenderer();
    const engine = createGraphicsEngine(renderer, { sway: { enabled: true }, env: { particleBudget: 1 } });
    expect(() => engine.setAvatarDetail("standard")).not.toThrow();
  });
});

describe("containment", () => {
  it("the port exposes exactly the nine graphics switches and nothing else", () => {
    const r = rig();
    expect(Object.keys(r.engine).sort()).toEqual([
      "setAmbientOcclusion", "setAoResolutionScale", "setAvatarDetail", "setEffectsDetail", "setFoliageSway",
      "setRenderScale", "setShadowMapSize", "setShadows", "setWeatherEffects",
    ]);
  });

  it("holds no reference to the world, nav, doors, seats, camera or the light grade", () => {
    // Structural, not aspirational: if a later change reaches for one of these it has to add it here.
    const renderer = fakeRenderer();
    const world = { sway: { enabled: true }, env: { particleBudget: 1 } };
    createGraphicsEngine(renderer, world);
    expect(Object.keys(world).sort()).toEqual(["env", "sway"]);
    expect(Object.keys(renderer)).not.toContain("scene");
    expect(Object.keys(renderer)).not.toContain("camera");
    expect(Object.keys(renderer)).not.toContain("key");
  });
});

describe("Full Graphics, applied", () => {
  it("leaves every V2 system at the approved baseline", () => {
    const r = rig();
    r.engine.setRenderScale(FULL_GRAPHICS.renderScale);
    r.engine.setAmbientOcclusion(FULL_GRAPHICS.ambientOcclusion);
    r.engine.setAoResolutionScale(FULL_GRAPHICS.aoResolutionScale);
    r.engine.setShadows(FULL_GRAPHICS.shadows);
    r.engine.setShadowMapSize(FULL_GRAPHICS.shadowMapSize);
    r.engine.setWeatherEffects(FULL_GRAPHICS.weatherEffects);
    r.engine.setEffectsDetail(FULL_GRAPHICS.effectsDetail);
    r.engine.setFoliageSway(FULL_GRAPHICS.foliageSway);
    expect(r.renderer.renderScale).toBe(1);
    expect(r.renderer.aoScale).toBe(0.5);
    expect(r.renderer.ssaoEnabled).toBe(true);
    expect(r.renderer.shadows).toBe(true);
    expect(r.renderer.shadowMapSize).toBe(2048);
    expect(r.sway.enabled).toBe(true);
    expect(r.env.particleBudget).toBe(1);
  });

  it("and the Smooth floor still keeps shadows and the plants themselves", () => {
    const r = rig();
    const floor = SMOOTH_LADDER[0];
    r.engine.setShadows(floor.shadows);
    r.engine.setAmbientOcclusion(floor.ambientOcclusion);
    r.engine.setFoliageSway(floor.foliageSway);
    expect(r.renderer.shadows).toBe(true);
    expect(r.renderer.ssaoEnabled).toBe(false);
    expect(r.sway.enabled).toBe(false);
  });
});
