// vo3d app — THE REAL BOOTSTRAP, run.
//
// This file exists because of a specific failure. The 3D office refused to start with
//
//     duplicate entity id elevator-2/call
//
// while 4,884 tests were green. Every one of them re-listed the world's registrations by hand, because
// the registrations themselves lived inside createVo3dWorld — a function that cannot be called without a
// WebGL context. A hand-written copy of a list cannot catch a duplicate in the original.
//
// So these tests call `buildWorldContents()` — THE SAME FUNCTION createVo3dWorld calls, the one the
// browser runs at localhost:5174/virtual-office/. If the office cannot assemble, this goes red first.
import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); the source
// guard at the bottom reads world.ts off disk, exactly as the other source guards in this repo do.
import { readFileSync } from "node:fs";
import { buildWorldContents, ELEVATORS, ELEVATOR_ROOM_IDS } from "./worldContents";
import { FLOOR_ORDER, GROUND_FLOOR_ID, type Vo3dFloorId } from "./floors";
import { FLOOR2_ID, FRAME as FLOOR2_FRAME } from "../rooms/floor2";
import { OUTER_RECT as CAVE_OUTER } from "../rooms/cave";
import { pointInRect } from "../core/coords";

describe("the world assembles at all — the check the office's startup actually depends on", () => {
  it("builds without throwing", () => {
    // WorldState.addEntity / addRoom / addRegion all THROW on a duplicate id, by design. So this single
    // assertion is the whole duplicate-registration guard for every room, entity and region in the
    // building — and it is the assertion that was missing when `elevator-2/call` shipped twice.
    expect(() => buildWorldContents()).not.toThrow();
  });

  it("builds a FRESH world every time, so nothing leaks between callers", () => {
    const a = buildWorldContents();
    const b = buildWorldContents();
    expect(a.world).not.toBe(b.world);
    expect(a.world.entities.size).toBe(b.world.entities.size);
    expect(a.world.regions.length).toBe(b.world.regions.length);
    // …and the second build is not a duplicate registration into the first
    expect(() => buildWorldContents()).not.toThrow();
  });

  it("registers every entity, room and region id EXACTLY once", () => {
    const { world } = buildWorldContents();
    const entityIds = [...world.entities.keys()];
    expect(new Set(entityIds).size).toBe(entityIds.length);
    const regionIds = world.regions.map((r) => r.id);
    expect(new Set(regionIds).size).toBe(regionIds.length);
    const roomIds = [...world.rooms.keys()];
    expect(new Set(roomIds).size).toBe(roomIds.length);
    expect(entityIds.length).toBeGreaterThan(100); // it really did build the office, not an empty world
  });
});

describe("the vertical core is registered once per floor, by the building", () => {
  it("every floor has exactly one lift core, one call control and one RoomDef", () => {
    const { world } = buildWorldContents();
    for (const floor of FLOOR_ORDER) {
      const spec = ELEVATORS[floor];
      const calls = [...world.entities.keys()].filter((id) => id === `${spec.id}/call`);
      expect(calls, `${floor} call control`).toEqual([`${spec.id}/call`]);
      expect(world.rooms.has(spec.id), `${floor} RoomDef`).toBe(true);
    }
    // …and no OTHER call control exists: exactly one per floor in the registry, never more
    const allCalls = [...world.entities.keys()].filter((id) => id.endsWith("/call"));
    expect(allCalls.sort()).toEqual(FLOOR_ORDER.map((f) => `${ELEVATORS[f].id}/call`).sort());
  });

  it("the floor 2 core is `elevator-2/call`, once — the exact id that broke startup", () => {
    const { world } = buildWorldContents();
    expect(world.entities.has("elevator-2/call")).toBe(true);
    expect([...world.entities.keys()].filter((id) => id === "elevator-2/call")).toHaveLength(1);
  });

  it("a floor never answers for the core standing on it", async () => {
    // rooms/floor2.ts must not hand back the building's entities: that second answer IS the bug.
    const floor2 = await import("../rooms/floor2");
    expect("floor2Entities" in floor2).toBe(false);
    // its regions are the PLATE only — the core's are registered by the building, just before them
    expect(floor2.floor2Regions().map((r) => r.id)).toEqual([`floor:${FLOOR2_ID}`]);
  });

  it("the core ids are derived from the registry, never listed twice", () => {
    expect([...ELEVATOR_ROOM_IDS].sort()).toEqual(FLOOR_ORDER.map((f) => ELEVATORS[f].id).sort());
  });
});

describe("registration ORDER, which is region priority", () => {
  const indexOf = (ids: string[], id: string): number => ids.indexOf(id);

  it("each floor's shaft is refused BEFORE that floor's plate claims it", () => {
    const { world } = buildWorldContents();
    const ids = world.regions.map((r) => r.id);
    // floor 1: the core, then the shared hall the core stands on
    expect(indexOf(ids, `elevator:shaft:${ELEVATORS[GROUND_FLOOR_ID].id}`)).toBeLessThan(indexOf(ids, "shared:ground-floor"));
    // floor 2: the core, then the plate
    expect(indexOf(ids, `elevator:shaft:${ELEVATORS[FLOOR2_ID as Vo3dFloorId].id}`)).toBeLessThan(indexOf(ids, `floor:${FLOOR2_ID}`));
  });

  it("and the apron in front of the doors wins over the core's own box, on every floor", () => {
    const { world } = buildWorldContents();
    const ids = world.regions.map((r) => r.id);
    for (const floor of FLOOR_ORDER) {
      const id = ELEVATORS[floor].id;
      expect(indexOf(ids, `elevator:lobby:${id}`), floor).toBeLessThan(indexOf(ids, `elevator:shaft:${id}`));
    }
    // the outcome that order buys: you can stand in front of the doors, and never inside the core. The
    // core is a wall recess until a car is standing in it, and while one is, the cinematic owns the body.
    for (const floor of FLOOR_ORDER) {
      expect(world.walkableAt(ELEVATORS[floor].boarding), floor).toBe(true);
      const inner = ELEVATORS[floor].interior;
      expect(world.walkableAt({ x: inner.x + 4, z: inner.z + 4 }), floor).toBe(false);
    }
  });
});

describe("the bounds cover every volume the world models", () => {
  it("the office frame, the Cave and floor 2 are all inside them", () => {
    const { world, plan } = buildWorldContents();
    const b = world.bounds!;
    expect(b).not.toBeNull();
    for (const box of [plan.frame, CAVE_OUTER, FLOOR2_FRAME]) {
      expect(pointInRect({ x: box.x, z: box.z }, b)).toBe(true);
      expect(pointInRect({ x: box.x + box.w, z: box.z + box.d }, b)).toBe(true);
    }
  });
});

describe("app/world.ts assembles the world through this module and nowhere else", () => {
  const src = readFileSync("src/dev/vo3d/app/world.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("calls buildWorldContents instead of registering anything itself", () => {
    expect(src).toContain("buildWorldContents()");
    // THE STRUCTURAL GUARD. Every room / entity / region registration now lives in a module a test can
    // run; a new one added back here would be invisible to that test again, which is exactly how
    // `elevator-2/call` got registered twice. (The room EDITOR adds entities through a WorldTx, never
    // through these methods, so it is unaffected.)
    expect(src).not.toMatch(/\bworld\.addEntity\(/);
    expect(src).not.toMatch(/\bworld\.addRoom\(/);
    expect(src).not.toMatch(/\bworld\.addRegion\(/);
    expect(src).not.toMatch(/\bworld\.bounds\s*=/);
  });
});
