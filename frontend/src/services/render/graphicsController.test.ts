// The controller: mode → engine calls, and the guarantees that only hold if the wiring is right.
//
// The engine is a fake that records every call. That is deliberate — the assertions worth making here
// are about WHICH switches are touched and WHEN, and a real WebGL renderer would hide all of it.
import { describe, expect, it, vi } from "vitest";
import { GraphicsController, isFullGraphics, type GraphicsEngine } from "./graphicsController";
import { DEGRADE_SUSTAIN_MS, WARMUP_MS } from "./adaptiveQuality";
import { FULL_GRAPHICS, SMOOTH_LADDER, type GraphicsMode } from "./graphicsQuality";

function fakeEngine() {
  const calls: [string, unknown][] = [];
  const rec = (name: string) => (v: unknown) => calls.push([name, v]);
  const engine: GraphicsEngine = {
    setRenderScale: rec("renderScale"),
    setAmbientOcclusion: rec("ambientOcclusion"),
    setAoResolutionScale: rec("aoResolutionScale"),
    setShadows: rec("shadows"),
    setShadowMapSize: rec("shadowMapSize"),
    setWeatherEffects: rec("weatherEffects"),
    setEffectsDetail: rec("effectsDetail"),
    setFoliageSway: rec("foliageSway"),
    setAvatarDetail: rec("avatarDetail"),
  };
  return { engine, calls, of: (name: string) => calls.filter(([n]) => n === name).map(([, v]) => v) };
}

/** A controller over a preference this test owns outright, so nothing touches localStorage. */
function rig(initial: { mode: GraphicsMode; custom?: Record<string, unknown> }) {
  const pref = { mode: initial.mode, custom: initial.custom ?? {} };
  let notify = () => {};
  const f = fakeEngine();
  const controller = new GraphicsController({
    engine: f.engine,
    readPreference: () => pref,
    subscribe: (listener) => {
      notify = listener;
      return () => {
        notify = () => {};
      };
    },
    startedAtMs: 0,
  });
  return {
    ...f,
    controller,
    set(next: Partial<typeof pref>) {
      Object.assign(pref, next);
      notify();
    },
  };
}

function starve(controller: GraphicsController, durationMs: number, from = 0): number {
  let t = from;
  const end = from + durationMs;
  while (t < end) {
    t += 33;
    controller.frame(33, t);
  }
  return t;
}

describe("on startup", () => {
  it("pushes the whole resolved state at the engine once", () => {
    const r = rig({ mode: "full" });
    expect(r.of("renderScale")).toEqual([1]);
    expect(r.of("ambientOcclusion")).toEqual([true]);
    expect(r.of("shadowMapSize")).toEqual([2048]);
    expect(r.of("avatarDetail")).toEqual(["high"]);
    expect(r.calls).toHaveLength(9); // every switch, exactly once
  });

  it("starts Smooth at the approved look and earns its way down", () => {
    const r = rig({ mode: "smooth" });
    expect(r.controller.level).toBe(3);
    expect(isFullGraphics(r.controller.settings)).toBe(true);
  });
});

describe("Full Graphics never secretly adapts", () => {
  it("does not measure at all", () => {
    const r = rig({ mode: "full" });
    starve(r.controller, 120000);
    expect(r.controller.status().medianFrameMs).toBeNull();
    expect(r.controller.status().lastAdaptation).toBeNull();
  });

  it("does not move a single switch, however bad the frames get", () => {
    const r = rig({ mode: "full" });
    const before = r.calls.length;
    starve(r.controller, 120000);
    expect(r.calls).toHaveLength(before);
    expect(r.controller.settings).toEqual(FULL_GRAPHICS);
  });

  it("is equally inert in Custom", () => {
    const r = rig({ mode: "custom", custom: { shadows: false } });
    const before = r.calls.length;
    starve(r.controller, 120000);
    expect(r.calls).toHaveLength(before);
    expect(r.controller.status().medianFrameMs).toBeNull();
  });
});

describe("Smooth", () => {
  it("lowers quality on the engine once performance is sustained-poor", () => {
    const r = rig({ mode: "smooth" });
    const before = r.calls.length;
    starve(r.controller, WARMUP_MS + DEGRADE_SUSTAIN_MS + 500);
    expect(r.controller.level).toBe(2);
    expect(r.calls.length).toBeGreaterThan(before);
    // rung 2 is a resolution trim — the render scale moved and no effect was switched off
    expect(r.of("renderScale").at(-1)).toBe(SMOOTH_LADDER[2].renderScale);
    expect(r.of("ambientOcclusion")).toEqual([true]); // never re-pushed, because it never changed
    expect(r.of("shadows")).toEqual([true]);
  });

  it("only pushes the switches that actually changed", () => {
    const r = rig({ mode: "smooth" });
    starve(r.controller, WARMUP_MS + DEGRADE_SUSTAIN_MS + 500);
    // 3 → 2 spends SECONDARY cost only — the AO buffer and the effects budget. Render scale is
    // deliberately NOT in this list: the first response to a struggling machine must not blur characters.
    const changed = r.calls.slice(9).map(([n]) => n);
    expect(changed.sort()).toEqual(["aoResolutionScale", "effectsDetail"]);
    expect(changed).not.toContain("renderScale");
  });

  it("never touches avatar detail while adapting", () => {
    const r = rig({ mode: "smooth" });
    starve(r.controller, 200000);
    expect(r.controller.level).toBe(0);
    expect(r.of("avatarDetail")).toEqual(["high"]); // the startup push, and never again
  });
});

describe("switching mode", () => {
  it("restores the full benchmark when Smooth had already adapted down", () => {
    const r = rig({ mode: "smooth" });
    starve(r.controller, 200000);
    expect(r.controller.level).toBe(0);
    r.set({ mode: "full" });
    expect(r.controller.settings).toEqual(FULL_GRAPHICS);
    expect(r.of("renderScale").at(-1)).toBe(1);
    expect(r.of("ambientOcclusion").at(-1)).toBe(true);
  });

  it("re-entering Smooth starts from the top rung again, not from the old verdict", () => {
    const r = rig({ mode: "smooth" });
    starve(r.controller, 200000);
    r.set({ mode: "full" });
    r.set({ mode: "smooth" });
    expect(r.controller.level).toBe(3);
    expect(isFullGraphics(r.controller.settings)).toBe(true);
  });

  it("only ever reaches the nine graphics switches — nothing else is wired to it", () => {
    const r = rig({ mode: "smooth" });
    starve(r.controller, 200000);
    r.set({ mode: "custom", custom: { shadows: false, avatarDetail: "standard" } });
    const names = new Set(r.calls.map(([n]) => n));
    expect([...names].sort()).toEqual(
      ["aoResolutionScale", "ambientOcclusion", "avatarDetail", "effectsDetail", "foliageSway", "renderScale",
        "shadowMapSize", "shadows", "weatherEffects"].sort(),
    );
  });
});

describe("the measurement pin (dev performance harness only)", () => {
  it("forces Full without disturbing the stored preference, and releases back to it", () => {
    const r = rig({ mode: "smooth" });
    starve(r.controller, 200000);
    expect(r.controller.level).toBe(0);
    r.controller.pinMode("full");
    expect(r.controller.settings).toEqual(FULL_GRAPHICS);
    r.controller.pinMode(null);
    expect(r.controller.status().mode).toBe("smooth");
    expect(r.controller.level).toBe(3); // a fresh window, not the pre-pin verdict
  });
});

describe("lifecycle", () => {
  it("stops listening when disposed", () => {
    const unsubscribe = vi.fn();
    const f = fakeEngine();
    const controller = new GraphicsController({
      engine: f.engine,
      readPreference: () => ({ mode: "full", custom: {} }),
      subscribe: () => unsubscribe,
    });
    controller.dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
