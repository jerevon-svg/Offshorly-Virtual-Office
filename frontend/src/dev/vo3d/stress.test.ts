// vo3d — PERFORMANCE STRESS PHASE 1. Covers the deterministic half of the harness: the scenario matrix
// the phase requires, and the placement planner that has to genuinely put N bodies on legal ground
// (a planner that quietly places 12 of 70 would make every CAVE number a lie).
import { describe, expect, it } from "vitest";
import { CENTRAL_HUB } from "./rooms/central-hub";
import { DESIGN_ROOM } from "./rooms/design-room";
import { RECEPTION_ROOM } from "./rooms/reception";
import { GAMING_ROOM } from "./rooms/gaming";
import { FLOOR_RECT as CAVE_FLOOR_RECT } from "./rooms/cave";
import {
  STRESS_MATRIX, candidatesIn, markdownTable, mulberry32, planPlacements, shuffled, spreadOver,
  type PlacementDeps, type ScenarioResult,
} from "./devtools/Stress";
import type { Rect, Vec2 } from "./core/coords";

const OPEN = () => true;
const deps = (canStand: (p: Vec2) => boolean = OPEN): PlacementDeps => ({
  roomRects: [DESIGN_ROOM, RECEPTION_ROOM, GAMING_ROOM, CENTRAL_HUB].map((r) => ({ id: r.id, rect: r.rect })),
  hubRect: CENTRAL_HUB.rect,
  caveRect: CAVE_FLOOR_RECT,
  canStand,
});

describe("stress matrix", () => {
  it("keeps the eight phase-1 scenarios, in order, as the first eight", () => {
    expect(STRESS_MATRIX.slice(0, 8).map((s) => s.count + 1)).toEqual([1, 10, 25, 50, 70, 70, 70, 70]);
    expect(STRESS_MATRIX.slice(0, 8).map((s) => s.layout)).toEqual([
      "distributed", "distributed", "distributed", "distributed", "distributed", "hub", "cave", "cave",
    ]);
    // the CAVE worst case is mandatory, and the second of the two is the movement/animation burst
    expect(STRESS_MATRIX.filter((s) => s.layout === "cave")).toHaveLength(2);
    expect(STRESS_MATRIX.find((s) => s.id === "s8-70-cave-motion")!.motion).toBe(true);
    expect(new Set(STRESS_MATRIX.map((s) => s.id)).size).toBe(STRESS_MATRIX.length);
  });
  it("carries the distributed-motion scenario the shadow phase needs", () => {
    // The office is the only scenario where a shadow redraw drags ~2,800 STATIC casters with it, so it
    // is the one that separates "the avatars are expensive" from "the world is expensive".
    const s9 = STRESS_MATRIX.find((s) => s.id === "s9-70-distributed-motion");
    expect(s9).toBeDefined();
    expect(s9!.layout).toBe("distributed");
    expect(s9!.motion).toBe(true);
    expect(s9!.count + 1).toBe(70);
  });
  it("pairs every motion scenario with a static one of the same layout and size", () => {
    for (const m of STRESS_MATRIX.filter((s) => s.motion)) {
      const twin = STRESS_MATRIX.find((s) => !s.motion && s.layout === m.layout && s.count === m.count);
      expect(twin, `${m.id} has no idle twin to A/B against`).toBeDefined();
    }
  });
});

describe("mulberry32", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe("candidatesIn", () => {
  it("lays points inside the rect, respecting the inset", () => {
    const rect: Rect = { x: 100, z: 200, w: 300, d: 200 };
    const pts = candidatesIn(rect, 30, OPEN, mulberry32(1), 20);
    expect(pts.length).toBeGreaterThan(20);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(rect.x);
      expect(p.x).toBeLessThan(rect.x + rect.w);
      expect(p.z).toBeGreaterThan(rect.z);
      expect(p.z).toBeLessThan(rect.z + rect.d);
    }
  });
  it("drops every point the world refuses to stand on", () => {
    const rect: Rect = { x: 0, z: 0, w: 200, d: 200 };
    const westHalf = (p: Vec2) => p.x < 100;
    const pts = candidatesIn(rect, 20, westHalf, mulberry32(2));
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every((p) => p.x < 100)).toBe(true);
  });
  it("returns nothing when the inset eats the rect", () => {
    expect(candidatesIn({ x: 0, z: 0, w: 30, d: 30 }, 10, OPEN, mulberry32(3), 20)).toEqual([]);
  });
});

describe("shuffled", () => {
  it("permutes without losing or duplicating members", () => {
    const src = Array.from({ length: 40 }, (_, i) => i);
    const out = shuffled(src, mulberry32(5));
    expect(out).toHaveLength(src.length);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
    expect(out).not.toEqual(src);
  });
});

describe("spreadOver", () => {
  it("fills every area round-robin rather than saturating the first", () => {
    const areas = [
      [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }],
      [{ x: 0, z: 1 }, { x: 1, z: 1 }, { x: 2, z: 1 }],
    ];
    const out = spreadOver(areas, 4, 10);
    expect(out).toHaveLength(4);
    expect(out.filter((s) => s.home.z === 0)).toHaveLength(2);
    expect(out.filter((s) => s.home.z === 1)).toHaveLength(2);
    expect(out.every((s) => s.roam === 10)).toBe(true);
  });
  it("stops cleanly when the areas run dry instead of looping forever", () => {
    const out = spreadOver([[{ x: 0, z: 0 }]], 70, 5);
    expect(out).toHaveLength(1);
  });
});

describe("planPlacements", () => {
  it("places the full 70-body crowd in each of the three layouts", () => {
    for (const layout of ["distributed", "hub", "cave"] as const) {
      expect(planPlacements(layout, 69, deps())).toHaveLength(69);
    }
  });
  it("keeps every CAVE body inside the CAVE floor — the worst case must genuinely be in the room", () => {
    const spawns = planPlacements("cave", 69, deps());
    for (const s of spawns) {
      expect(s.home.x).toBeGreaterThanOrEqual(CAVE_FLOOR_RECT.x);
      expect(s.home.x).toBeLessThanOrEqual(CAVE_FLOOR_RECT.x + CAVE_FLOOR_RECT.w);
      expect(s.home.z).toBeGreaterThanOrEqual(CAVE_FLOOR_RECT.z);
      expect(s.home.z).toBeLessThanOrEqual(CAVE_FLOOR_RECT.z + CAVE_FLOOR_RECT.d);
    }
  });
  it("clusters the hub crowd tightly on the hub centre", () => {
    const spawns = planPlacements("hub", 69, deps());
    const cx = CENTRAL_HUB.rect.x + CENTRAL_HUB.rect.w / 2;
    const cz = CENTRAL_HUB.rect.z + CENTRAL_HUB.rect.d / 2;
    for (const s of spawns) {
      expect(Math.abs(s.home.x - cx)).toBeLessThanOrEqual(125);
      expect(Math.abs(s.home.z - cz)).toBeLessThanOrEqual(95);
    }
  });
  it("spreads the distributed crowd over more than one room", () => {
    const spawns = planPlacements("distributed", 40, deps());
    const rooms = [DESIGN_ROOM, RECEPTION_ROOM, GAMING_ROOM, CENTRAL_HUB];
    const hit = new Set<string>();
    for (const s of spawns) {
      for (const r of rooms) {
        if (s.home.x >= r.rect.x && s.home.x <= r.rect.x + r.rect.w && s.home.z >= r.rect.z && s.home.z <= r.rect.z + r.rect.d) hit.add(r.id);
      }
    }
    expect(hit.size).toBeGreaterThanOrEqual(3);
  });
  it("is deterministic for a given seed and differs for another", () => {
    const a = planPlacements("cave", 20, deps(), 7);
    const b = planPlacements("cave", 20, deps(), 7);
    const c = planPlacements("cave", 20, deps(), 99);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it("returns nothing for the 1-avatar baseline", () => {
    expect(planPlacements("distributed", 0, deps())).toEqual([]);
  });
});

describe("markdownTable", () => {
  it("renders one row per scenario with the required per-scenario metrics", () => {
    const r: ScenarioResult = {
      config: {
        id: "s7-70-cave", label: "70 avatars — inside the CAVE (worst case)", avatars: 70, layout: "cave",
        motion: false, seconds: 20, lod: 1, labels: true, preset: "A", ssao: true, ssaoDepthReuse: true,
        shadows: true, roomCulling: true, staticBatching: true, pixelRatio: 2, drawingBuffer: "2880×1620",
        camera: "player · inside CAVE", placed: 69,
      },
      frame: { seconds: 20, frames: 900, avgFps: 45, avgFrameMs: 22.2, medianFrameMs: 21, p95FrameMs: 30, p99FrameMs: 38, worstFrameMs: 51, onePercentLowFps: 26.3, avgDrawCalls: 1200, avgTriangles: 4500000 },
      scene: { visibleMeshes: 900, drawCalls: 1200, triangles: 4500000, geometries: 700, textures: 120, programs: 40 },
      memory: { jsHeapMb: 800, totalHeapMb: 900, limitMb: 4096 },
      avatarCost: null, shadowCost: null, errors: [], startedAt: "2026-09-15T00:00:00.000Z", durationMs: 41000,
    };
    const md = markdownTable([r]);
    expect(md.split("\n")).toHaveLength(3);
    expect(md).toContain("70 avatars — inside the CAVE (worst case)");
    expect(md).toContain("| 45 |"); // avg fps
    expect(md).toContain("| 26.3 |"); // 1% low
    expect(md).toContain("| 38 |"); // p99
  });
});
