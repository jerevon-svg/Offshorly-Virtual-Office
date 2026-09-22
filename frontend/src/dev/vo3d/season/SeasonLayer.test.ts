import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvOverlay } from "../env/presets";
import type { EnvPhase } from "../env/timeOfDay";
import { createSeasonLayer, type SeasonRoom } from "./SeasonLayer";

// A stand-in for the real office: three rooms of plausible size, one of them a hero space.
const ROOMS: SeasonRoom[] = [
  { id: "central-hub", rect: { x: 600, z: 500, w: 220, d: 180 }, floorRect: { x: 610, z: 510, w: 200, d: 160 } },
  { id: "reception-room", rect: { x: 600, z: 900, w: 260, d: 200 }, floorRect: { x: 610, z: 910, w: 240, d: 180 } },
  { id: "dev-room", rect: { x: 100, z: 100, w: 200, d: 160 }, floorRect: { x: 110, z: 110, w: 180, d: 140 } },
];

function deps(scene: THREE.Object3D) {
  const setEnvOverlay = vi.fn<(g: Record<EnvPhase, EnvOverlay> | null, p: EnvPhase | null) => void>();
  return { scene, rooms: ROOMS, doors: [], setEnvOverlay, invalidateShadows: vi.fn() };
}

let scene: THREE.Scene;
beforeEach(() => { scene = new THREE.Scene(); });

describe("which themes build a layer", () => {
  it("builds nothing for the ordinary office", () => {
    const d = deps(scene);
    expect(createSeasonLayer("none", d)).toBeNull();
    expect(scene.children).toHaveLength(0);
    expect(d.setEnvOverlay).not.toHaveBeenCalled();
  });

  it("builds nothing for a season with no decoration layer", () => {
    // Christmas is a KNOWN identifier with no implementation. It must produce an undecorated office
    // rather than a half-decorated one.
    expect(createSeasonLayer("christmas", deps(scene))).toBeNull();
    expect(scene.children).toHaveLength(0);
  });

  it("builds and attaches Halloween, and hands the environment its grade", () => {
    const d = deps(scene);
    const layer = createSeasonLayer("halloween", d);
    expect(layer).not.toBeNull();
    expect(scene.getObjectByName("season:halloween")).toBeDefined();
    expect(layer!.stats.pieces).toBeGreaterThan(20);
    expect(layer!.stats.bats).toBeGreaterThan(20);
    const [grade, autoPhase] = d.setEnvOverlay.mock.calls[0];
    expect(grade).not.toBeNull();
    // AUTO gets the season's intended hour; a manual choice is never touched (see app/world.ts).
    expect(autoPhase).toBe("night");
  });
});

// ══ DISPOSAL IS THE WHOLE CONTRACT ══
//
// Switching season is a full-document reload in production, so the browser would free the GPU anyway.
// This is about the OTHER path — a React unmount (StrictMode, an error boundary, the host remounting)
// — where nothing but dispose() frees anything.
describe("disposal", () => {
  it("removes every object it added and frees every geometry it made", () => {
    const d = deps(scene);
    const layer = createSeasonLayer("halloween", d)!;
    const geometries: THREE.BufferGeometry[] = [];
    scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) geometries.push(m.geometry); });
    expect(geometries.length).toBeGreaterThan(20);
    const disposed = geometries.map((g) => vi.spyOn(g, "dispose"));

    layer.dispose();

    expect(scene.children).toHaveLength(0);
    expect(scene.getObjectByName("season:halloween")).toBeUndefined();
    for (const spy of disposed) expect(spy).toHaveBeenCalled();
  });

  it("clears the environment grade so the office is lit as it was", () => {
    const d = deps(scene);
    createSeasonLayer("halloween", d)!.dispose();
    expect(d.setEnvOverlay).toHaveBeenLastCalledWith(null, null);
  });

  it("is idempotent", () => {
    const layer = createSeasonLayer("halloween", deps(scene))!;
    layer.dispose();
    expect(() => layer.dispose()).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });

  it("stops billboarding after disposal — no work against a torn-down layer", () => {
    const layer = createSeasonLayer("halloween", deps(scene))!;
    layer.dispose();
    expect(() => layer.update(new THREE.PerspectiveCamera())).not.toThrow();
  });
});

describe("what the layer must never touch", () => {
  it("adds exactly one root to the scene and nothing else", () => {
    createSeasonLayer("halloween", deps(scene));
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0].name).toBe("season:halloween");
  });

  it("creates no real-time lights — every glow is emissive geometry plus an additive plane", () => {
    // The office's whole lighting budget depends on this: build/led.ts and build/exterior.ts both
    // state it, and a season full of candles is exactly where it would be tempting to break it.
    createSeasonLayer("halloween", deps(scene));
    let lights = 0;
    scene.traverse((o) => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
  });

  it("is deterministic — the same rooms decorate identically on every build", () => {
    const a = createSeasonLayer("halloween", deps(new THREE.Scene()))!;
    const b = createSeasonLayer("halloween", deps(new THREE.Scene()))!;
    expect(a.stats).toEqual(b.stats);
  });
});
