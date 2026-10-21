// THE PLATE REGISTRY (app/floorPlates.ts): every floor the elevator serves is described by it, the world's
// lookups read it, and a third floor is a row — so these pin the invariants a new row must keep.
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pointInRect, type Rect } from "../core/coords";
import { NAV_RADIUS } from "../nav/clearance";
import { makePlateRouter } from "../nav/plateRoute";
import { CABIN, GROUND_ELEVATOR, inCabin, vestibuleStandTest } from "../rooms/elevator";
import { OUTER_RECT as CAVE_OUTER } from "../rooms/cave";
import { ELEVATOR as FLOOR2_ELEVATOR, FLOOR2_ID, FRAME as FLOOR2_FRAME, SPAWN as FLOOR2_SPAWN, floor2StandTest } from "../rooms/floor2";
import { MEETING_ROOMS } from "../rooms/floor2Meeting";
import { exteriorGround } from "../world/exteriorGround";
import { FLOORS, FLOOR_ORDER, GROUND_FLOOR_ID, STOREY_H, elevatorFloorRows, exteriorDrop } from "./floors";
import { FLOOR3, FLOOR4 } from "../rooms/plainFloor";
import * as THREE from "three";
import { buildPlainFloor, buildFloor2 } from "../build/floor2";
import { buildStoreysBelow } from "../build/floor2Context";
import { GRADE, PARKING, PODIUM_TOP, ROADS } from "../world/campus";
import { LAB_OUTER } from "../world/ailab";
import { WALL_H } from "../rooms/floor2";
import {
  ELEVATORS, ELEVATOR_CALL_IDS, UPPER_PLATES, UPPER_PLATE_ROOM_IDS, exteriorAnchorFor,
  onDetachedBuildingFloor, onUpperFloor, upperFloorStand, upperPlate, upperPlateAt,
} from "./floorPlates";
import { LIFT_RIDER_SLOTS, slotPoint } from "./liftRiders";
import { buildWorldContents } from "./worldContents";

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const V1_FRAME: Rect = { x: 0, z: 0, w: 1440, d: 1244 };

describe("floor plate registry", () => {
  it("names a lift entrance for every floor, and a plate for every floor above the ground", () => {
    for (const f of FLOOR_ORDER) expect(ELEVATORS[f]).toBeDefined();
    expect(new Set(FLOOR_ORDER.map((f) => ELEVATORS[f].id)).size).toBe(FLOOR_ORDER.length);
    expect(upperPlate(GROUND_FLOOR_ID)).toBeNull();
    for (const f of FLOOR_ORDER) if (FLOORS[f].level > 0) expect(upperPlate(f)?.id).toBe(f);
    expect(UPPER_PLATES.map((p) => p.id)).toEqual(FLOOR_ORDER.filter((f) => f !== GROUND_FLOOR_ID));
    expect(ELEVATOR_CALL_IDS).toEqual(new Set(FLOOR_ORDER.map((f) => `${ELEVATORS[f].id}/call`)));
  });

  it("keeps floors 1 and 2 exactly where they were (same objects, same frame)", () => {
    expect(ELEVATORS[GROUND_FLOOR_ID]).toBe(GROUND_ELEVATOR);
    expect(ELEVATORS[FLOOR2_ID]).toBe(FLOOR2_ELEVATOR);
    expect(upperPlate(FLOOR2_ID)!.frame).toBe(FLOOR2_FRAME);
    expect(FLOOR2_FRAME).toEqual({ x: 6000, z: 0, w: 1440, d: 1244 });
    expect(UPPER_PLATE_ROOM_IDS).toEqual(new Set([FLOOR2_ID, "floor-3", "floor-4"]));
  });

  it("stands every plate in its own space: clear of V1's frame, the Cave, the cabin and each other", () => {
    UPPER_PLATES.forEach((a, i) => {
      expect(overlaps(a.outer, V1_FRAME)).toBe(false);
      expect(overlaps(a.outer, CAVE_OUTER)).toBe(false);
      expect(overlaps(a.outer, CABIN.outer)).toBe(false);
      for (const b of UPPER_PLATES.slice(i + 1)) expect(overlaps(a.outer, b.outer)).toBe(false);
    });
  });

  it("puts each plate's lift entrance on that plate, boardable from its apron", () => {
    for (const plate of UPPER_PLATES) {
      const e = plate.elevator;
      expect(pointInRect({ x: e.outer.x, z: e.outer.z }, plate.frame)).toBe(true);
      expect(pointInRect({ x: e.outer.x + e.outer.w, z: e.outer.z + e.outer.d }, plate.frame)).toBe(true);
      expect(upperPlateAt(e.boarding)).toBe(plate);
      expect(plate.standTest(e.boarding, NAV_RADIUS)).toBe(true);
      // the entrance's own walls stop a body (its hollow interior is NOT refused by the plate test — the
      // ground floor's shaft region does that downstairs; see the Step 1 report)
      expect(plate.standTest({ x: e.outer.x + 2, z: e.outer.z + e.outer.d / 2 }, NAV_RADIUS)).toBe(false);
    }
  });

  it("answers which plate a point is on — and NO plate for the ground floor, the Cave or the cabin", () => {
    expect(upperPlateAt(FLOOR2_SPAWN)?.id).toBe(FLOOR2_ID);
    expect(onUpperFloor(GROUND_ELEVATOR.boarding)).toBe(false);
    expect(onUpperFloor({ x: CAVE_OUTER.x + 10, z: CAVE_OUTER.z + 10 })).toBe(false);
    expect(onUpperFloor(CABIN.mark)).toBe(false);
    expect(upperFloorStand(GROUND_ELEVATOR.boarding, NAV_RADIUS)).toBe(false);
    expect(upperFloorStand(FLOOR2_SPAWN, NAV_RADIUS)).toBe(true);
  });

  it("registers core regions BEFORE each plate's floor: the shaft refuses, the apron and plate accept", () => {
    const { world } = buildWorldContents();
    for (const plate of UPPER_PLATES) {
      const e = plate.elevator;
      const shaft = world.regionAt({ x: e.outer.x + e.outer.w / 2, z: e.outer.z + e.outer.d / 2 });
      expect(shaft?.id).toBe(`elevator:shaft:${e.id}`);
      expect(shaft?.walkable).toBe(false);
      expect(world.regionAt({ x: e.lobbyRect.x + 2, z: e.lobbyRect.z + 2 })?.id).toBe(`elevator:lobby:${e.id}`);
      expect(world.walkableAt(e.boarding)).toBe(true);
      // the world's bounds cover the whole plate (regionAt refuses everything outside them)
      const b = world.bounds!;
      expect(pointInRect({ x: plate.outer.x, z: plate.outer.z }, b) && pointInRect({ x: plate.outer.x + plate.outer.w - 1, z: plate.outer.z + plate.outer.d - 1 }, b)).toBe(true);
    }
  });

  it("routes a plate on its own geometry: Floor 2's lift apron to every meeting room's door", () => {
    const plate = upperPlate(FLOOR2_ID)!;
    const router = makePlateRouter(plate.floorRect, (p) => plate.standTest(p, NAV_RADIUS));
    for (const r of MEETING_ROOMS) expect(router.route(plate.elevator.boarding, r.approach), r.id).not.toBeNull();
  });
});

describe("the lift cabin is a flat building floor (riders sank into it)", () => {
  it("is off every plate AND off the campus, where the ground model has only sunken terrain", () => {
    // WHY the bug happened: the world's ground height fell through to the campus model at x 9000
    expect(exteriorGround().groundAt(CABIN.mark).y).toBeLessThan(-1);
  });

  it("counts the mark, every group place and every rider slot as detached building floor", () => {
    expect(onDetachedBuildingFloor(CABIN.mark)).toBe(true);
    for (const g of CABIN.group) expect(onDetachedBuildingFloor(g)).toBe(true);
    for (const s of LIFT_RIDER_SLOTS) {
      const p = slotPoint(CABIN.mark, s);
      expect(inCabin(p)).toBe(true);
      expect(onDetachedBuildingFloor(p)).toBe(true);
    }
    expect(onDetachedBuildingFloor(FLOOR2_ELEVATOR.mark)).toBe(true);
    // the ground floor's own bay is the office's (inOfficeDomain answers 0 for it), not a detached floor
    expect(onDetachedBuildingFloor(GROUND_ELEVATOR.mark)).toBe(false);
  });

  it("the world's ground height reads the cabin as floor, for the player body and coworker riders alike", () => {
    const src = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
    expect(src).toContain("const groundYAt = (p: Vec2): number => (inCave(p) || onDetachedBuildingFloor(p) || inOfficeDomain(p) ? 0 : ground.groundAt(p).y);");
    expect(src).toContain("avatar.ground = groundYAt;");
    expect(src).toMatch(/new Coworkers\(\{[\s\S]{0,200}groundY: groundYAt,/);
  });
});

describe("closed lift doors stop a body; a ride still walks in and out", () => {
  it("Floor 2: nothing in the bay, its doorway or against its shut leaves is standable from the plate", () => {
    const e = FLOOR2_ELEVATOR;
    const x1 = e.outer.x + e.outer.w;
    for (const p of [e.mark, e.threshold, { x: e.outer.x + e.outer.w / 2, z: e.outer.z + e.outer.d / 2 }, { x: x1 + NAV_RADIUS - 1, z: e.threshold.z }])
      expect(floor2StandTest(p, NAV_RADIUS), JSON.stringify(p)).toBe(false);
    expect(floor2StandTest(e.boarding, NAV_RADIUS)).toBe(true);
    expect(floor2StandTest({ x: x1 + NAV_RADIUS + 0.5, z: e.threshold.z }, NAV_RADIUS)).toBe(true);
  });

  it("during a ride the bay answers for itself (the world asks vestibuleStandTest first), on every floor", () => {
    for (const f of FLOOR_ORDER) {
      const e = ELEVATORS[f];
      expect(vestibuleStandTest(e, e.mark, NAV_RADIUS)).toBe(true);
      expect(vestibuleStandTest(e, e.threshold, NAV_RADIUS)).toBe(true);
    }
    const src = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
    // the lift's own spaces outrank every plate, and only while a journey is running
    expect(src).toMatch(/vestibuleOf\(p\) !== null \? vestibuleStandTest\(vestibuleOf\(p\)!, p, NAV_RADIUS\)\s*: onUpperFloor\(p\) \? upperFloorStand\(p, NAV_RADIUS\)/);
    expect(src).toContain('const liftActive = (): boolean => floorTransition !== null && floorTransition.currentPhase !== "idle";');
  });

  it("Floor 1: the shaft region refuses the bay and its doorway; the apron stays walkable", () => {
    const { world } = buildWorldContents();
    const e = GROUND_ELEVATOR;
    expect(world.walkableAt(e.mark)).toBe(false);
    expect(world.walkableAt(e.threshold)).toBe(false);
    expect(world.walkableAt(e.boarding)).toBe(true);
  });
});

describe("floors 3 and 4: empty, reachable plates", () => {
  it("are registered bottom to top with their names, indicators and storey heights", () => {
    expect(FLOOR_ORDER).toEqual(["floor-1", "floor-2", "floor-3", "floor-4"]);
    expect([FLOORS["floor-3"].name, FLOORS["floor-3"].indicator, FLOORS["floor-3"].level]).toEqual(["Compass University", "03", 2]);
    expect([FLOORS["floor-4"].name, FLOORS["floor-4"].indicator, FLOORS["floor-4"].level]).toEqual(["Gaming & Social Hub", "04", 3]);
    expect(exteriorDrop("floor-3")).toBe(2 * STOREY_H);
    expect(exteriorDrop("floor-4")).toBe(3 * STOREY_H);
    expect(elevatorFloorRows("floor-1", FLOOR_ORDER, FLOORS).map((r) => r.indicator)).toEqual(["04", "03", "02", "01"]);
  });

  it("put their lift exactly where floor 2's is on its plate — one shaft up the building", () => {
    const f2 = upperPlate(FLOOR2_ID)!;
    for (const plan of [FLOOR3, FLOOR4]) {
      expect(plan.frame.w).toBe(f2.frame.w);
      expect(plan.frame.d).toBe(f2.frame.d);
      expect(plan.elevator.outer.x - plan.frame.x).toBe(f2.elevator.outer.x - f2.frame.x);
      expect(plan.elevator.outer.z - plan.frame.z).toBe(f2.elevator.outer.z - f2.frame.z);
      expect(upperPlate(plan.id as "floor-3")!.elevator).toBe(plan.elevator);
    }
  });

  it("are walkable wall to wall and routed from the lift to every corner, but not through the perimeter", () => {
    for (const plan of [FLOOR3, FLOOR4]) {
      const plate = upperPlate(plan.id as "floor-3")!;
      const F = plan.floorRect, m = NAV_RADIUS + 4;
      const corners = [{ x: F.x + m, z: F.z + m }, { x: F.x + F.w - m, z: F.z + m }, { x: F.x + m, z: F.z + F.d - m }, { x: F.x + F.w - m, z: F.z + F.d - m }];
      const router = makePlateRouter(plate.floorRect, (p) => plate.standTest(p, NAV_RADIUS));
      for (const c of corners) {
        expect(plate.standTest(c, NAV_RADIUS)).toBe(true);
        expect(router.route(plan.spawn, c), JSON.stringify(c)).not.toBeNull();
      }
      expect(plate.standTest({ x: plan.frame.x + 4, z: plan.frame.z + plan.frame.d / 2 + 200 }, NAV_RADIUS)).toBe(false);
      expect(plate.standTest(plan.elevator.mark, NAV_RADIUS)).toBe(false); // doors shut
      expect(plate.standTest(plan.spawn, NAV_RADIUS)).toBe(true);
    }
  });

  it("are a flat building floor (no sinking) and inside the office for presence", () => {
    for (const plan of [FLOOR3, FLOOR4]) {
      expect(onDetachedBuildingFloor(plan.spawn)).toBe(true);
      expect(upperPlateAt(plan.spawn)?.id).toBe(plan.id);
    }
  });
});

describe("window elevation: one campus, seen from each storey's real height", () => {
  const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

  it("anchors the shared exterior 0 / 96 / 192 / 288 below each floor, offset with its plate", () => {
    expect(FLOOR_ORDER.map((f) => exteriorAnchorFor(f, V1_FRAME))).toEqual([
      { x: 0, y: -0, z: 0 },
      { x: 6000, y: -96, z: 0 },
      { x: 6000, y: -192, z: 2000 },
      { x: 6000, y: -288, z: 4000 },
    ]);
  });

  it("keeps every road, the car park and the AI Lab in the same place relative to the building on every floor", () => {
    const landmarks = [{ x: LAB_OUTER.x, z: LAB_OUTER.z }, { x: PARKING.x, z: PARKING.z }, ...ROADS.map((r) => (r.axis === "x" ? { x: r.from, z: r.at } : { x: r.at, z: r.from }))];
    for (const f of FLOOR_ORDER) {
      const a = exteriorAnchorFor(f, V1_FRAME);
      const frame = upperPlate(f)?.frame ?? V1_FRAME;
      for (const l of landmarks) {
        // where it is drawn, measured from the plate the viewer stands on, is where it is from the ground floor's
        expect({ x: l.x + a.x - frame.x, z: l.z + a.z - frame.z }).toEqual({ x: l.x - V1_FRAME.x, z: l.z - V1_FRAME.z });
      }
      // and it lies a whole number of storeys below that plate's floor
      expect(-a.y).toBe(FLOORS[f].level * STOREY_H);
    }
  });

  it("stacks each plate on its storeys: shell 10 below to 60 above its floor, the mass up to just under it, belts at the storey lines", () => {
    const shell = box(buildFloor2());
    expect(shell.min.y).toBeCloseTo(-10, 0);
    expect(shell.max.y).toBeLessThanOrEqual(WALL_H + 1);
    // a storey's structure (plinth 10 + curtain wall 60) fits inside 96: no storey intersects the one above
    expect(WALL_H + 10).toBeLessThan(STOREY_H);
    for (const plan of [FLOOR3, FLOOR4]) {
      const level = FLOORS[plan.id as "floor-3"].level;
      const plate = box(buildPlainFloor(plan, "hallTile"));
      expect(plate.min.y).toBeCloseTo(shell.min.y, 3);
      expect(plate.max.y).toBeCloseTo(shell.max.y, 3);
      const drop = level * STOREY_H;
      const ctx = buildStoreysBelow(plan.frame, level, drop, "t");
      const meshes = ctx.group.children as THREE.Mesh[];
      const [podium, mass, ...belts] = meshes.map((m) => box(m));
      expect(podium.min.y).toBeCloseTo(GRADE - drop, 3);
      expect(podium.max.y).toBeCloseTo(PODIUM_TOP - drop, 3);
      expect(mass.min.y).toBeCloseTo(PODIUM_TOP - drop, 3);
      expect(mass.max.y).toBeLessThan(plate.min.y); // just under the plinth: no shared plane
      expect(mass.max.y).toBeGreaterThan(plate.min.y - 4);
      expect(belts.map((b) => Math.round(b.max.y + 4))).toEqual(Array.from({ length: level - 1 }, (_, i) => -(i + 1) * STOREY_H));
    }
    // floor 2's own context is what it always was: podium + mass, no belt
    expect(buildStoreysBelow(FLOOR2_FRAME, 1, STOREY_H, "t").group.children.length).toBe(2);
  });

  it("each storey looks down on the campus from higher than the one below it", () => {
    const eye = 30; // a standing eye above its own floor (36-unit people)
    const heights = FLOOR_ORDER.map((f) => eye - exteriorAnchorFor(f, V1_FRAME).y);
    for (let i = 1; i < heights.length; i++) expect(heights[i] - heights[i - 1]).toBe(STOREY_H);
    // the tallest things outside (street lamps ~132 above grade) are below a standing eye from floor 2 up
    for (const h of heights.slice(1)) expect(h - GRADE).toBeGreaterThan(132);
  });
});
