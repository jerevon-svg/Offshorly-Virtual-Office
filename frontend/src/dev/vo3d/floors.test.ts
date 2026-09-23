// vo3d — THE MULTI-FLOOR MILESTONE, held to what it claims.
//
//   1. WHERE THE LIFT STANDS: the Meeting Room's north-west corner, clear of everything the room
//      authored — table, chairs, credenza, west artwork, kiosk, glass walls, glass entrance.
//   2. WHAT THE CAR IS: one room, 70 x 200 inside a 90 x 66 box, with a standing layout for ten.
//   3. WHAT FLOOR 2 IS: exactly 1440 x 1244, clear of every other volume, with its own bounded floor.
//   4. THE RULES: which views a floor offers, which view an arrival restores, which peers are drawn.
//   5. THE CINEMATIC: phase order, the doors, and the translation that makes the floor swap invisible.
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); the source
// guard at the bottom reads world.ts off disk, exactly as the other source guards in this repo do.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import {
  CHAIR_ROWS, CHAIR_W, CHAIR_XS, KIOSK, MEETING_ROOM, MEETING_WALLS, TABLE, WEST_CREDENZA,
  DOOR as MEETING_DOOR, EAST_GLASS_FACE, meetingRoomEntities,
} from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, OPEN_BANDS as HUB_OPEN_BANDS, centralHubEntities } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import { CORRIDOR_BANDS, registerGroundFloor } from "./rooms/ground-floor";
import { openedLayer, v2Static } from "./nav/v2Open";
import { DerivedNav } from "./nav/derived";
import { FRAME as V1_FRAME, v1Rooms } from "./adapters/v1Floor";
import { v1Static } from "./adapters/v1Grid";
import { Walkability, composeStatic } from "./nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "./nav/clearance";
import { Connectivity, HALL_ANCHOR } from "./nav/connectivity";
import { pointInRect, type Rect, type Vec2 } from "./core/coords";
import {
  CABIN, CEILING_H, CORE_LOCAL, GROUND_ELEVATOR, MARK_SETBACK, RIDE, cabinStandTest, clearsElevator,
  elevatorCallEntity, elevatorRegions, inCabin, inVestibule, toCabin, vestibuleStandTest,
} from "./rooms/elevator";
import {
  ELEVATOR as FLOOR2_ELEVATOR, FLOOR_RECT as FLOOR2_FLOOR, FRAME as FLOOR2_FRAME, FLOOR2_ID,
  floor2Regions, floor2StandTest, onFloor2,
} from "./rooms/floor2";
import { OUTER_RECT as CAVE_OUTER } from "./rooms/cave";
import { FALLBACK_VIEW_MODE, FLOORS, GROUND_FLOOR_ID, arrivalViewMode, coworkersOnFloor, floorOfPlace, supportsViewMode } from "./app/floors";
import { FloorTransition, walkLegs, type FloorPhase } from "./interact/FloorTransition";

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;

const ROOMS = [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM];
const ALL_ENTITIES = () => [
  ...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(),
  ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(),
  ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities(),
];

/** THE SAME WIRING app/worldContents.ts uses, minus THREE. */
function rig() {
  const world = new WorldState();
  for (const r of ROOMS) world.addRoom(r);
  for (const e of ALL_ENTITIES()) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) =>
    world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }));
  world.addEntity(elevatorCallEntity(GROUND_ELEVATOR, "Call the elevator"));
  for (const r of elevatorRegions(GROUND_ELEVATOR)) world.addRegion(r);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const wk = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_OPEN_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set(ROOMS.map((r) => r.id)) });
  wk.attachDerived(derived, world);
  return { world, plan, wk, derived };
}

describe("the lift entrance stands in the Meeting Room's north-west corner", () => {
  it("is inside the Meeting Room, and inside no other room", () => {
    expect(GROUND_ELEVATOR.outer).toEqual({ ...CORE_LOCAL });
    const meeting = v1Rooms().find((r) => r.id === MEETING_ROOM.id)!;
    expect(overlaps(GROUND_ELEVATOR.outer, meeting.rect)).toBe(true);
    for (const r of v1Rooms()) if (r.id !== MEETING_ROOM.id) expect(overlaps(GROUND_ELEVATOR.outer, r.rect), r.id).toBe(false);
  });

  it("is SHALLOW: a lift bay built into the wall, not a room inserted into the room", () => {
    const e = GROUND_ELEVATOR;
    // the box you see is 68 deep and 82 wide — under a fifteenth of the room's floor…
    expect(e.outer.w * e.outer.d).toBeLessThan(MEETING_ROOM.floorRect.w * MEETING_ROOM.floorRect.d / 12);
    // …and the walls are a LINING, not structure: 4 units, so the vestibule keeps the depth the camera needs
    expect(e.interior.w).toBe(e.outer.w - 8);
    expect(e.interior.d).toBe(e.outer.d - 8);
  });

  it("its DOORS face east, square to the way people arrive in this corner", () => {
    const e = GROUND_ELEVATOR;
    expect(e.doorway.x + e.doorway.w).toBe(e.outer.x + e.outer.w);
    expect(e.lobbyRect.x).toBe(e.outer.x + e.outer.w);
    expect(e.boarding.x).toBeGreaterThan(e.outer.x + e.outer.w);
    expect(e.boardingLook).toEqual({ x: -1, z: 0 });
    expect(e.standLook).toEqual({ x: 1, z: 0 });
  });

  it("disturbs NOTHING the room authored", () => {
    const core = GROUND_ELEVATOR.outer;
    expect(overlaps(core, TABLE)).toBe(false);
    for (const row of CHAIR_ROWS)
      for (const x of CHAIR_XS)
        expect(overlaps(core, { x: x - CHAIR_W / 2, z: row.z - CHAIR_W / 2, w: CHAIR_W, d: CHAIR_W }), `chair ${x},${row.z}`).toBe(false);
    expect(overlaps(core, { x: WEST_CREDENZA.x, z: WEST_CREDENZA.z, w: WEST_CREDENZA.w, d: WEST_CREDENZA.d })).toBe(false);
    expect(overlaps(core, { x: KIOSK.x - KIOSK.w / 2, z: KIOSK.z - KIOSK.d / 2, w: KIOSK.w, d: KIOSK.d })).toBe(false);
    expect(core.x + core.w).toBeLessThan(EAST_GLASS_FACE);
    expect(overlaps(core, { x: EAST_GLASS_FACE, z: MEETING_DOOR.z0, w: 4, d: MEETING_DOOR.z1 - MEETING_DOOR.z0 })).toBe(false);
    // the north chair row's own stand cell is clear of the core AND of its apron
    expect(pointInRect({ x: 104, z: 952 }, core)).toBe(false);
    expect(pointInRect({ x: 104, z: 952 }, GROUND_ELEVATOR.lobbyRect)).toBe(false);
  });

  it("THE VESTIBULE CONTAINS NO WORLD GEOMETRY — the fix for everything the live ride leaked", () => {
    // The first build ran a 340-unit car out through the room's west wall and into the campus, so the
    // wall, the lawn and its bushes stood INSIDE the cabin and the sky showed through its seams. The
    // vestibule is inside the room's own footprint and touches none of it.
    const v = GROUND_ELEVATOR.interior;
    for (const w of MEETING_WALLS) expect(overlaps(v, w), `${w.x},${w.z}`).toBe(false);
    for (const e of meetingRoomEntities()) {
      const fp = e.footprint;
      if (!fp || fp.shape !== "rect") continue;
      const p = e.transform.pos;
      expect(overlaps(v, { x: p.x - fp.w / 2, z: p.z - fp.d / 2, w: fp.w, d: fp.d }), e.id).toBe(false);
    }
    // …and it is inside the V1 frame, so nothing of the exterior world can reach it either
    expect(pointInRect({ x: v.x, z: v.z }, V1_FRAME)).toBe(true);
    expect(pointInRect({ x: v.x + v.w, z: v.z + v.d }, V1_FRAME)).toBe(true);
  });

  it("the room's own navigation knows the corner is built on, and the apron is standable", () => {
    const { derived } = rig();
    expect(MEETING_ROOM.wallSolids).toEqual(expect.arrayContaining(GROUND_ELEVATOR.solids));
    for (const s of GROUND_ELEVATOR.solids) {
      const mid = { x: s.x + s.w / 2, z: s.z + s.d / 2 };
      if (inVestibule(GROUND_ELEVATOR, mid)) continue;
      expect(derived.clearanceAtPoint(mid), `${s.x},${s.z}`).toBeLessThan(NAV_RADIUS);
    }
    expect(derived.clearanceAtPoint(GROUND_ELEVATOR.boarding)).toBeGreaterThanOrEqual(NAV_RADIUS);
  });

  it("the Meeting Room is still reachable, and so is the lift", () => {
    const { wk } = rig();
    const conn = new Connectivity(wk.walkable, HALL_ANCHOR, wk.edgeOk);
    expect(conn.at(GROUND_ELEVATOR.boarding)).toBe(true);
    for (const room of ROOMS) {
      const f = room.floorRect;
      let reachable = false;
      for (let z = f.z + 8; z < f.z + f.d && !reachable; z += 16)
        for (let x = f.x + 8; x < f.x + f.w && !reachable; x += 16) if (conn.at({ x, z })) reachable = true;
      expect(reachable, room.id).toBe(true);
    }
  });

  it("NOBODY CAN WALK INTO IT. The bay is a wall recess until the cinematic puts them there", () => {
    const { world } = rig();
    const call = world.get(`${GROUND_ELEVATOR.id}/call`);
    expect(call.capabilities.approach?.point).toEqual(GROUND_ELEVATOR.boarding);
    expect(world.regionAt(GROUND_ELEVATOR.boarding)?.roomId).toBe(GROUND_ELEVATOR.id);
    expect(world.walkableAt(GROUND_ELEVATOR.boarding)).toBe(true);
    // every corner of the box, and its middle, refuse a body
    const o = GROUND_ELEVATOR.outer;
    for (const p of [
      { x: o.x + 2, z: o.z + 2 }, { x: o.x + o.w - 2, z: o.z + 2 },
      { x: o.x + 2, z: o.z + o.d - 2 }, { x: o.x + o.w - 2, z: o.z + o.d - 2 },
      GROUND_ELEVATOR.mark,
    ]) expect(world.walkableAt(p), `${p.x},${p.z}`).toBe(false);
  });
});

describe("the cabin: one car, standing alone", () => {
  it("is ISOLATED — nothing in this world is anywhere near it", () => {
    for (const box of [V1_FRAME, CAVE_OUTER, FLOOR2_FRAME]) expect(overlaps(CABIN.outer, box), `${box.x}`).toBe(false);
    // and clear of the campus's own reach (its roads run out at 5,400)
    expect(CABIN.outer.x).toBeGreaterThan(Math.max(FLOOR2_FRAME.x + FLOOR2_FRAME.w, 5400));
  });

  it("its BAY is an exact copy of a vestibule — which is what makes the swap free", () => {
    const v = GROUND_ELEVATOR.interior;
    expect(CABIN.bay.w).toBe(v.w);
    expect(CABIN.bay.d).toBe(v.d);
    // same setback from the inner door face, so the body and the camera land identically
    expect(CABIN.doorway.x - CABIN.mark.x).toBe(MARK_SETBACK);
    expect(GROUND_ELEVATOR.doorway.x - GROUND_ELEVATOR.mark.x).toBe(MARK_SETBACK);
    // same door width, same centre offset within the interior
    expect(CABIN.doorway.d).toBe(GROUND_ELEVATOR.doorway.d);
    expect(CABIN.mark.z - CABIN.bay.z).toBeCloseTo(GROUND_ELEVATOR.mark.z - v.z);
  });

  it("the translation between a vestibule and the bay preserves every relative position", () => {
    for (const spec of [GROUND_ELEVATOR, FLOOR2_ELEVATOR]) {
      const t = toCabin(spec);
      expect(spec.mark.x + t.x).toBe(CABIN.mark.x);
      expect(spec.mark.z + t.z).toBe(CABIN.mark.z);
      // …and the doors move with it
      expect(spec.doorway.x + t.x).toBe(CABIN.doorway.x);
    }
  });

  it("is a lift, not a corridor: wider than it is deep behind the bay, with a real ceiling", () => {
    expect(CABIN.volume.d).toBeGreaterThan(CABIN.volume.w); //  130 across, 80 back
    expect(CEILING_H).toBe(56); //                              20 clear over a 36-unit body
  });

  it("holds ten standing places, none of them overlapping, all of them inside", () => {
    expect(CABIN.group).toHaveLength(10);
    const all = [CABIN.mark, ...CABIN.group];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z), `${i}/${j}`).toBeGreaterThanOrEqual(2 * NAV_RADIUS);
    for (const m of all) expect(cabinStandTest(m, NAV_RADIUS), `${m.x},${m.z}`).toBe(true);
  });

  it("its shell stops a body, and nowhere outside it is the cabin", () => {
    const o = CABIN.outer;
    for (const p of [
      { x: o.x - 6, z: CABIN.centreZ }, { x: o.x + o.w + 6, z: CABIN.centreZ },
      { x: CABIN.volume.x + 20, z: o.z - 6 }, { x: CABIN.volume.x + 20, z: o.z + o.d + 6 },
    ]) expect(cabinStandTest(p, NAV_RADIUS), `${p.x},${p.z}`).toBe(false);
    expect(inCabin(GROUND_ELEVATOR.mark)).toBe(false);
    expect(inCabin(CABIN.mark)).toBe(true);
  });

  it("every floor's entrance is the SAME entrance, offset by that floor's origin", () => {
    expect(FLOOR2_ELEVATOR.outer.w).toBe(GROUND_ELEVATOR.outer.w);
    expect(FLOOR2_ELEVATOR.outer.d).toBe(GROUND_ELEVATOR.outer.d);
    expect(FLOOR2_ELEVATOR.outer.x - GROUND_ELEVATOR.outer.x).toBe(FLOOR2_FRAME.x);
    expect(FLOOR2_ELEVATOR.outer.z - GROUND_ELEVATOR.outer.z).toBe(FLOOR2_FRAME.z);
  });

  it("the doorway is centred and the leaves pocket inside the piers", () => {
    const e = GROUND_ELEVATOR;
    expect(e.doorway.z + e.doorway.d / 2).toBeCloseTo(e.outer.z + e.outer.d / 2);
    expect(e.leaf.north.z - e.leaf.slideDistance).toBeGreaterThanOrEqual(e.outer.z);
    expect(e.leaf.south.z + e.leaf.south.d + e.leaf.slideDistance).toBeLessThanOrEqual(e.outer.z + e.outer.d);
  });

  it("a body fits in a vestibule with the camera behind it, and cannot leave one", () => {
    const e = GROUND_ELEVATOR;
    expect(vestibuleStandTest(e, e.mark, NAV_RADIUS)).toBe(true);
    // PlayerCamera's boom floor is 0.8 body heights = 28.8; the camera lands inside the vestibule
    expect(e.mark.x - 28.8).toBeGreaterThan(e.interior.x);
    for (const p of [{ x: e.interior.x - 4, z: e.mark.z }, { x: e.mark.x, z: e.interior.z - 4 }])
      expect(vestibuleStandTest(e, p, NAV_RADIUS), `${p.x},${p.z}`).toBe(false);
  });
});


describe("floor 2 — a deliberately empty second storey", () => {
  it("is EXACTLY 1440 x 1244", () => {
    expect(FLOOR2_FRAME.w).toBe(1440);
    expect(FLOOR2_FRAME.d).toBe(1244);
    expect({ w: FLOOR2_FRAME.w, d: FLOOR2_FRAME.d }).toEqual({ w: V1_FRAME.w, d: V1_FRAME.d });
  });

  it("stands clear of the V1 frame and of the Championship Cave", () => {
    expect(overlaps(FLOOR2_FRAME, V1_FRAME)).toBe(false);
    expect(overlaps(FLOOR2_FRAME, CAVE_OUTER)).toBe(false);
    expect(FLOOR2_FRAME.x).toBeGreaterThan(CAVE_OUTER.x + CAVE_OUTER.w);
  });

  it("carries ONLY its own plate: no rooms, no furniture, and NOT the lift core standing on it", () => {
    // The core is the BUILDING's, registered once per floor by app/worldContents.ts. A floor that also
    // answered for it is what registered `elevator-2/call` twice and stopped the office starting.
    expect(floor2Regions().map((r) => r.id)).toEqual([`floor:${FLOOR2_ID}`]);
  });

  it("a body cannot leave the floor's safe bounds", () => {
    expect(floor2StandTest({ x: FLOOR2_FLOOR.x + NAV_RADIUS + 2, z: FLOOR2_FLOOR.z + NAV_RADIUS + 2 }, NAV_RADIUS)).toBe(true);
    for (const p of [
      { x: FLOOR2_FRAME.x - 1, z: FLOOR2_FRAME.z + 600 },
      { x: FLOOR2_FRAME.x + FLOOR2_FRAME.w + 1, z: FLOOR2_FRAME.z + 600 },
      { x: FLOOR2_FRAME.x + 700, z: FLOOR2_FRAME.z - 1 },
      { x: FLOOR2_FRAME.x + 700, z: FLOOR2_FRAME.z + FLOOR2_FRAME.d + 1 },
      { x: FLOOR2_FLOOR.x + 1, z: FLOOR2_FLOOR.z + 600 },
    ]) expect(floor2StandTest(p, NAV_RADIUS), `${p.x},${p.z}`).toBe(false);
  });

  it("the lift core stops a body upstairs exactly as it does downstairs", () => {
    expect(floor2StandTest(FLOOR2_ELEVATOR.boarding, NAV_RADIUS)).toBe(true);
    const back = FLOOR2_ELEVATOR.solids[0];
    expect(floor2StandTest({ x: back.x + back.w / 2, z: back.z + back.d / 2 }, NAV_RADIUS)).toBe(false);
    expect(clearsElevator(FLOOR2_ELEVATOR, FLOOR2_ELEVATOR.boarding, NAV_RADIUS)).toBe(true);
  });

  it("onFloor2 answers for the floor and for nowhere else", () => {
    expect(onFloor2(FLOOR2_ELEVATOR.boarding)).toBe(true);
    expect(onFloor2(GROUND_ELEVATOR.boarding)).toBe(false);
    expect(onFloor2({ x: 2700, z: 500 })).toBe(false);
  });
});

describe("the floor registry — view rules and floor identity", () => {
  it("the ground floor offers all three views; floor 2 withholds 3D", () => {
    expect(FLOORS[GROUND_FLOOR_ID].viewModes).toEqual(["office", "explore", "player"]);
    expect(FLOORS[FLOOR2_ID].viewModes).toEqual(["office", "player"]);
    expect(supportsViewMode(FLOOR2_ID, "explore")).toBe(false);
  });

  it("the arrival mapping is exactly the one the brief states", () => {
    expect(arrivalViewMode("office", FLOOR2_ID)).toBe("office");
    expect(arrivalViewMode("player", FLOOR2_ID)).toBe("player");
    expect(arrivalViewMode("explore", FLOOR2_ID)).toBe("player");
    expect(FALLBACK_VIEW_MODE).toBe("player");
    for (const m of ["office", "explore", "player"] as const) expect(arrivalViewMode(m, GROUND_FLOOR_ID)).toBe(m);
  });

  it("a floor is a PLACE on the movement wire, and the ground floor needs no word for itself", () => {
    expect(FLOORS[GROUND_FLOOR_ID].placeId).toBeNull();
    expect(FLOORS[FLOOR2_ID].placeId).toBe("floor-2");
    expect(floorOfPlace("floor-2")).toBe(FLOOR2_ID);
    expect(floorOfPlace(null)).toBe(GROUND_FLOOR_ID);
    expect(floorOfPlace("championship-cave")).toBe(GROUND_FLOOR_ID);
  });

  it("draws the people on the floor you are on, and nobody else", () => {
    const roster = [{ email: "down@x", place: undefined }, { email: "room@x", place: "meeting-room" }, { email: "up@x", place: "floor-2" }];
    expect(coworkersOnFloor(roster, GROUND_FLOOR_ID).map((c) => c.email)).toEqual(["down@x", "room@x"]);
    expect(coworkersOnFloor(roster, FLOOR2_ID).map((c) => c.email)).toEqual(["up@x"]);
  });
});

describe("the cinematic — ordering, the seal, and the invisible swap", () => {
  function harness(opts: { placeFails?: boolean } = {}) {
    const log: string[] = [];
    const door: Record<string, number> = { "floor-1": 0, "floor-2": 0, cabin: 0 };
    const ind: Record<string, string> = { "floor-1": "01", "floor-2": "02", cabin: "01" };
    let owned = false, cabinVisible = false, boom = "near";
    let pos: Vec2 = { ...GROUND_ELEVATOR.boarding };
    let yaw = 0;
    let floor: "floor-1" | "floor-2" = GROUND_FLOOR_ID as "floor-1";
    const specOf = (f: string) => (f === FLOOR2_ID ? FLOOR2_ELEVATOR : GROUND_ELEVATOR);
    const t = new FloorTransition({
      specOf: (f) => specOf(f),
      coreOf: (f) => ({
        group: null as never, callPickName: "", dispose: () => {},
        setOpen: (v) => { door[f] = v; }, setIndicator: (x) => { ind[f] = x; }, setLight: () => {},
      }),
      cabin: {
        group: { get visible() { return cabinVisible; }, set visible(v: boolean) { cabinVisible = v; } } as never,
        setOpen: (v) => { door.cabin = v; }, setIndicator: (x) => { ind.cabin = x; }, setLight: () => {},
        dispose: () => {},
      },
      indicatorOf: (f) => FLOORS[f].indicator,
      bodyPos: () => pos,
      bodyYaw: () => yaw,
      stepWalk: (legs, dt) => { const r = walkLegs(pos, legs, RIDE.walkSpeed, dt); pos = r.pos; return r.arrived; },
      setYaw: (y) => { yaw = y; },
      place: (p, look) => {
        if (opts.placeFails && floor !== GROUND_FLOOR_ID) return false;
        pos = { ...p };
        yaw = Math.atan2(look.x, look.z);
        return true;
      },
      translateBody: (dx, dz) => { pos = { x: pos.x + dx, z: pos.z + dz }; log.push(`move:${dx},${dz}`); },
      takeAvatar: () => { owned = true; log.push("take"); return true; },
      releaseAvatar: () => { owned = false; log.push("release"); },
      beginCinematic: () => log.push("begin"),
      endCinematic: (f) => log.push(`end:${f}`),
      applyFloor: (to) => { floor = to; log.push(`apply:${to}`); },
      setBoom: (wide) => { boom = wide ? "wide" : "near"; },
      onWhere: (to) => log.push(`where:${to}`),
      invalidateShadows: () => {},
    }, GROUND_FLOOR_ID);
    const run = (ms: number, step = 16): void => { for (let e = 0; e < ms; e += step) t.update(step); };
    return { t, run, log, door, ind, pos: () => pos, floor: () => floor, owned: () => owned, cabinVisible: () => cabinVisible, boom: () => boom };
  }

  it("refuses to start from anywhere but the lift, and frames before it takes the avatar", () => {
    const h = harness();
    expect(h.t.canBoardFrom({ x: 500, z: 790 })).toBe(false);
    expect(h.t.canBoardFrom(GROUND_ELEVATOR.boarding)).toBe(true);
    expect(h.t.start(FLOOR2_ID)).toBe(true);
    expect(h.log.slice(0, 2)).toEqual(["begin", "take"]);
  });

  it("runs the phases in the order the brief describes", () => {
    const h = harness();
    h.t.start(FLOOR2_ID);
    const seen: FloorPhase[] = [];
    for (let e = 0; e < 40000; e += 16) {
      h.t.update(16);
      if (seen[seen.length - 1] !== h.t.currentPhase) seen.push(h.t.currentPhase);
      if (h.t.currentPhase === "idle" && e > 100) break;
    }
    expect(seen).toEqual(["framing", "approach", "opening", "boarding", "aligning", "closing", "riding", "settle", "arriving", "leaving", "shutting", "idle"]);
  });

  it("THE SEAL: the cabin is entered and left only with every leaf shut", () => {
    const h = harness();
    h.t.start(FLOOR2_ID);
    let enteredAt = -1, leftAt = -1;
    const frames: { sealed: boolean; d1: number; d2: number; dc: number; phase: FloorPhase }[] = [];
    for (let e = 0, i = 0; e < 40000; e += 16, i++) {
      const was = h.t.sealed;
      h.t.update(16);
      if (!was && h.t.sealed) enteredAt = i;
      if (was && !h.t.sealed) leftAt = i;
      frames.push({ sealed: h.t.sealed, d1: h.door["floor-1"], d2: h.door["floor-2"], dc: h.door.cabin, phase: h.t.currentPhase });
      if (h.t.currentPhase === "idle" && e > 100) break;
    }
    expect(enteredAt).toBeGreaterThan(0);
    expect(leftAt).toBeGreaterThan(enteredAt);
    for (const i of [enteredAt, leftAt]) expect(frames[i].d1 + frames[i].d2 + frames[i].dc, `frame ${i}`).toBe(0);
    // and EVERY sealed frame has every leaf shut — there is no frame in which the outside could be seen
    for (const f of frames) if (f.sealed) expect(f.d1 + f.d2 + f.dc, f.phase).toBe(0);
    // the cabin is only drawn while sealed
    expect(h.cabinVisible()).toBe(false);
  });

  it("the floor swap happens INSIDE the cabin, 9,000 units from any floor", () => {
    const h = harness();
    h.t.start(FLOOR2_ID);
    let swapSealed: boolean | null = null, swapPos: Vec2 | null = null;
    for (let e = 0; e < 40000; e += 16) {
      const before = h.floor();
      h.t.update(16);
      if (swapSealed === null && h.floor() !== before) { swapSealed = h.t.sealed; swapPos = { ...h.pos() }; }
      if (h.t.currentPhase === "idle" && e > 100) break;
    }
    expect(swapSealed).toBe(true);
    expect(inCabin(swapPos!)).toBe(true);
    // the body and the camera moved there together, by the vestibule-to-bay vector and back
    const v = toCabin(GROUND_ELEVATOR);
    expect(h.log).toContain(`move:${v.x},${v.z}`);
  });

  it("the read-out steps on its OWN beat, inside the cabin, and never on the swap frame", () => {
    const h = harness();
    h.t.start(FLOOR2_ID);
    let swapFrame = -1, stepFrame = -1;
    for (let e = 0, i = 0; e < 40000; e += 16, i++) {
      const beforeFloor = h.floor(), beforeInd = h.ind.cabin;
      h.t.update(16);
      if (swapFrame < 0 && h.floor() !== beforeFloor) swapFrame = i;
      if (stepFrame < 0 && h.ind.cabin !== beforeInd) stepFrame = i;
      if (h.t.currentPhase === "idle" && e > 100) break;
    }
    expect(stepFrame).toBeGreaterThan(swapFrame);
    expect(h.ind.cabin).toBe("02");
    expect(h.ind["floor-1"]).toBe("02");
  });

  it("boards to the vestibule mark, faces the doors, and walks out onto the destination", () => {
    const h = harness();
    h.t.start(FLOOR2_ID);
    let onMark = false;
    for (let e = 0; e < 40000; e += 16) {
      h.t.update(16);
      if (h.t.currentPhase === "aligning" && Math.hypot(h.pos().x - GROUND_ELEVATOR.mark.x, h.pos().z - GROUND_ELEVATOR.mark.z) < 1) onMark = true;
      if (h.t.currentPhase === "idle" && e > 100) break;
    }
    expect(onMark).toBe(true);
    expect(h.t.floor).toBe(FLOOR2_ID);
    expect(h.pos().x).toBeCloseTo(FLOOR2_ELEVATOR.boarding.x, 1);
    expect(h.pos().z).toBeCloseTo(FLOOR2_ELEVATOR.boarding.z, 1);
    expect(h.owned()).toBe(false);
    expect(h.log.filter((e) => e === "release")).toHaveLength(1);
    expect(h.log.filter((e) => e.startsWith("end:"))).toEqual(["end:floor-2"]);
  });

  it("a second activation during a journey is REFUSED, not queued", () => {
    const h = harness();
    expect(h.t.start(FLOOR2_ID)).toBe(true);
    for (let i = 0; i < 30; i++) expect(h.t.start(FLOOR2_ID)).toBe(false);
    h.run(40000);
    expect(h.log.filter((e) => e === "take")).toHaveLength(1);
    expect(h.log.filter((e) => e.startsWith("apply:"))).toEqual([`apply:${FLOOR2_ID}`]);
  });

  it("comes back down under the identical rule", () => {
    const h = harness();
    h.t.start(FLOOR2_ID);
    h.run(40000);
    expect(h.t.start(GROUND_FLOOR_ID)).toBe(true);
    let sealedWhenSwapped: boolean | null = null;
    for (let e = 0; e < 40000; e += 16) {
      const before = h.floor();
      h.t.update(16);
      if (sealedWhenSwapped === null && h.floor() !== before) sealedWhenSwapped = h.t.sealed;
      if (h.t.currentPhase === "idle" && e > 100) break;
    }
    expect(sealedWhenSwapped).toBe(true);
    expect(h.t.floor).toBe(GROUND_FLOOR_ID);
    expect(h.pos().x).toBeCloseTo(GROUND_ELEVATOR.boarding.x, 1);
    expect(h.ind["floor-1"]).toBe("01");
    expect(h.log.filter((e) => e.startsWith("end:"))).toEqual(["end:floor-2", "end:floor-1"]);
  });

  it("a restore is not a journey: no doors, no ownership, no cinematic", () => {
    const h = harness();
    expect(h.t.restoreOn(FLOOR2_ID)).toBe(true);
    expect(h.t.floor).toBe(FLOOR2_ID);
    expect(h.log).toEqual([`where:${FLOOR2_ID}`, `apply:${FLOOR2_ID}`]);
    expect(h.door["floor-2"]).toBe(0);
    expect(h.owned()).toBe(false);
  });
});

describe("the scripted walk", () => {
  it("runs the legs in order and goes THROUGH the doorway, never through a pier", () => {
    const legs = [{ ...GROUND_ELEVATOR.threshold }, { ...GROUND_ELEVATOR.mark }];
    let p = { ...GROUND_ELEVATOR.boarding };
    let arrived = false;
    for (let i = 0; i < 600 && !arrived; i++) {
      const r = walkLegs(p, legs, RIDE.walkSpeed, 1 / 60);
      p = r.pos;
      arrived = r.arrived;
      if (pointInRect(p, GROUND_ELEVATOR.outer)) expect(inVestibule(GROUND_ELEVATOR, p), `${p.x},${p.z}`).toBe(true);
    }
    expect(arrived).toBe(true);
    expect(p).toEqual(GROUND_ELEVATOR.mark);
  });
});

describe("app/world.ts wires the floors in", () => {
  const src = readFileSync("src/dev/vo3d/app/world.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("moves the OFFICE camera fence with the floor and never exposes 3D above the ground one", () => {
    expect(src).toContain("cameraModes.setOfficeBounds(floorFrameOf(to));");
    expect(src).toContain("supportsViewMode(currentFloor, m as Vo3dViewMode) ? m : FALLBACK_VIEW_MODE");
    expect(src).toContain(".onChange(requestViewMode)");
  });

  it("keeps the CABIN out of the floor swap, and never hides a floor to cover one", () => {
    const vis = src.slice(src.indexOf("function applyWorldVisibility"), src.indexOf("function applyFloor"));
    expect(vis).toContain("mirror.root.visible");
    expect(vis).toContain("floor2Root.visible");
    expect(vis).not.toContain("cabinBuild");
    // the seal is geometry, not a visibility trick: nothing in here switches the world off for a ride
    expect(src).not.toContain("setWorldHidden");
  });

  it("puts the floor on the movement wire through the feed that already exists — no second system", () => {
    expect(src).toContain("onWhere: (to) => selfFeed?.entering(FLOORS[to].placeId),");
    expect(src).toContain("coworkersOnFloor(coworkersInSameVolume(rosterList, rosterInsideCave), currentFloor)");
    expect(src).not.toContain("floor_changed");
  });

  it("the step between a vestibule and the cabin is SILENT on the wire", () => {
    const t = src.slice(src.indexOf("translateBody: (dx, dz)"), src.indexOf("takeAvatar:"));
    expect(t).toContain("selfFeed?.placed(p)");
  });
});

