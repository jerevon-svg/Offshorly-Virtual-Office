// vo3d app — DND ROOM LOCKS: THE DOORWAY IS ACTUALLY SHUT, AND ONLY FOR THE PERSON OUTSIDE.
//
// Tested the way the exit and Reception's gates are (app/exit.test.ts, player/standTest.gate.test.ts):
// against the REAL rooms, the REAL V1 grid and the REAL derived navigation, through the player's own stand
// test and the router. The controller decides nothing about locks — it is handed a set of manifest rooms —
// so what is asserted here is the physical half V1's office never had: that a locked room's door refuses a
// body outside it in every movement mode, lets an occupant out, opens for one authorised entry and shuts
// again once that entry is spent.
import { describe, expect, it } from "vitest";
import { WorldState } from "../world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "../rooms/ground-floor";
import { makeStandTest } from "../player/standTest";
import { DESIGN_ROOM, DESIGN_ROOM_ID, DESIGN_SOLIDS, DOOR_ID, designRoomEntities } from "../rooms/design-room";
import { GATE, RECEPTION_ROOM, receptionEntities } from "../rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "../rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "../rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "../rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "../rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "../rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "../rooms/cms";
import { AI_ROOM, aiRoomEntities } from "../rooms/ai";
import { DEV_ROOM, devRoomEntities } from "../rooms/dev";
import { QA_ROOM, qaRoomEntities } from "../rooms/qa";
import { Walkability, composeStatic } from "../nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "../nav/clearance";
import { DerivedNav } from "../nav/derived";
import { openedLayer, v2Static } from "../nav/v2Open";
import { CELL, v1Static, type Cell } from "../adapters/v1Grid";
import { planWalk } from "../nav/planner";
import { gateRects } from "./access";
import { RoomLockController, ROOM_LOCK_RESERVATION, collectLockableDoors, type LockedDoor } from "./roomLocks";
import { flatRoomIdForRoomLayer } from "../../../data/office-layout";
import type { Vec2 } from "../core/coords";

const ROOMS = [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM];

function rig() {
  const world = new WorldState();
  for (const r of ROOMS) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }));
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set(ROOMS.map((r) => r.id)) });
  walkability.attachDerived(derived, world);
  const roomAt = (p: Vec2) => world.regionAt(p)?.roomId ?? null;
  const doors = collectLockableDoors(world);
  const locks = new RoomLockController(doors, walkability, roomAt, NAV_RADIUS);
  const stand = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS, allowExterior: true });
  const route = (from: Vec2, to: Vec2) => planWalk(from, to, walkability, inBounds);
  /** Does a planned walk actually END inside the Design Room? planWalk never fails for a reachable-ish
   *  target — it falls back to the nearest reachable cell — so "gets in" is where the path ends. */
  const entersDesign = (from: Vec2, to: Vec2): boolean => {
    const r = route(from, to);
    return r.ok && roomAt(r.path[r.path.length - 1]) === DESIGN_ROOM_ID;
  };
  return { world, walkability, derived, doors, locks, stand, route, entersDesign, roomAt, inBounds };
}

/** The Design Room's east door, and the two points either side of its threshold. */
function designDoor(doors: LockedDoor[]) {
  const door = doors.find((d) => d.entityId === DOOR_ID)!;
  const c = door.crossing;
  const centre = { x: c.x + c.w / 2, z: c.z + c.d / 2 };
  // The stand point is outside; the inside is the mirror of it across the crossing centre.
  const inside = { x: 2 * centre.x - door.standPoint.x, z: 2 * centre.z - door.standPoint.z };
  return { door, centre, outside: door.standPoint, inside };
}
/** Points across the threshold itself, found with the door open rather than assumed. */
function thresholdPoints(door: LockedDoor, stand: (p: Vec2) => boolean): Vec2[] {
  const c = door.crossing;
  const out: Vec2[] = [];
  const alongX = c.w < c.d;
  for (let t = 2; t < (alongX ? c.d : c.w) - 2; t += 2) {
    const p = alongX ? { x: c.x + c.w / 2, z: c.z + t } : { x: c.x + t, z: c.z + c.d / 2 };
    if (stand(p)) out.push(p);
  }
  return out;
}
const HALL_FAR: Vec2 = { x: 400, z: 400 };
const RECEPTION_PUBLIC: Vec2 = { x: 600, z: 1050 };

describe("the world's doors, as lockable thresholds", () => {
  it("every room that has a door contributes one, owned by that room, in the manifest namespace", () => {
    const { doors } = rig();
    const rooms = new Set(doors.map((d) => d.roomId));
    expect(rooms.has(DESIGN_ROOM_ID)).toBe(true);
    // Not a made-up table: each door's room is its entity's roomId, and V1's flat id for it comes from the
    // one existing bridge — the Design Room's does resolve, which is what a knock is posted against.
    expect(flatRoomIdForRoomLayer(DESIGN_ROOM_ID)).toBe("design-team");
    for (const d of doors) expect(d.cells.length).toBeGreaterThan(0);
  });

  it("works out which side of each door is OUTSIDE from the world's own regions", () => {
    const { doors, roomAt } = rig();
    const { door, outside, inside } = designDoor(doors);
    expect(roomAt(outside)).not.toBe(door.roomId);
    expect(roomAt(inside)).toBe(door.roomId);
  });
});

describe("a locked room refuses the body outside it — router, click-to-walk and PLAYER alike", () => {
  it("the threshold is crossable while nothing is locked — otherwise this proves nothing", () => {
    const { doors, stand, entersDesign } = rig();
    const { door, outside, inside } = designDoor(doors);
    expect(thresholdPoints(door, stand).length).toBeGreaterThan(2);
    expect(entersDesign(outside, inside)).toBe(true);
  });

  it("locked + body outside: NOTHING in the doorway is standable (PLAYER) and no route goes in (click-to-walk, approach)", () => {
    const { doors, locks, stand, entersDesign } = rig();
    const { door, outside, inside } = designDoor(doors);
    const points = thresholdPoints(door, stand);
    locks.setLocked([DESIGN_ROOM_ID]);
    expect(locks.apply(outside)).toBe(true);
    for (const p of points) expect(stand(p), `${p.x},${p.z}`).toBe(false);
    expect(entersDesign(outside, inside)).toBe(false);
    expect(locks.refuses(DESIGN_ROOM_ID, outside)).toBe(true);
    expect(locks.snapshot().held).toEqual([DOOR_ID]);
  });

  it("holds the doorway and nothing else — the hall beside it and the rest of the office stay open", () => {
    const { doors, locks, stand } = rig();
    const { outside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(outside);
    expect(stand(outside)).toBe(true);
    expect(stand(HALL_FAR)).toBe(true);
    expect(stand(RECEPTION_PUBLIC)).toBe(true);
  });

  it("the body standing at the shut door is reported as intercepted, for THAT room", () => {
    const { doors, locks } = rig();
    const { outside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(outside);
    expect(locks.interceptedAt(outside)).toBe(DESIGN_ROOM_ID);
    expect(locks.interceptedAt(HALL_FAR)).toBeNull();
  });

  it("a route already planned through the doorway is recognised, so a walk in flight can be stopped", () => {
    const { doors, locks, route, roomAt } = rig();
    const { outside, inside } = designDoor(doors);
    const planned = route(outside, inside);
    expect(planned.ok && roomAt(planned.path[planned.path.length - 1])).toBe(DESIGN_ROOM_ID);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(HALL_FAR);
    expect(locks.routeCrossesHeld(planned.ok ? [outside, ...planned.path] : [])).toBe(true);
    // A route that never touches the doorway is left alone.
    expect(locks.routeCrossesHeld([HALL_FAR, RECEPTION_PUBLIC])).toBe(false);
  });
});

describe("never a cage", () => {
  it("the occupant INSIDE a locked room is not held: their door stays open and they can walk out", () => {
    const { doors, locks, stand, route, roomAt } = rig();
    const { door, outside, inside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(inside);
    expect(locks.snapshot().held).toEqual([]);
    for (const p of thresholdPoints(door, stand)) expect(stand(p)).toBe(true);
    const out = route(inside, outside);
    expect(out.ok && roomAt(out.path[out.path.length - 1])).not.toBe(DESIGN_ROOM_ID);
    expect(locks.refuses(DESIGN_ROOM_ID, inside)).toBe(false);
  });

  it("…and the hold comes back the moment they have left, so a repeat entry needs a fresh knock", () => {
    const { doors, locks, stand } = rig();
    const { door, outside, inside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(inside);
    locks.apply(outside);
    expect(locks.snapshot().held).toEqual([DOOR_ID]);
    for (const p of thresholdPoints(door, stand)) expect(stand(p)).toBe(false);
  });

  it("a body already in the threshold is never clamped — the hold waits for it to finish crossing", () => {
    const { doors, locks } = rig();
    const { centre } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(centre);
    expect(locks.snapshot().held).toEqual([]);
  });
});

describe("one authorised entry", () => {
  it("authorising opens the door for the body outside, and the authorisation is SPENT once it is inside", () => {
    const { doors, locks, stand, entersDesign } = rig();
    const { door, outside, inside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(outside);
    locks.authorize(DESIGN_ROOM_ID);
    expect(locks.apply(outside)).toBe(true);
    expect(locks.snapshot()).toMatchObject({ authorized: DESIGN_ROOM_ID, held: [] });
    expect(entersDesign(outside, inside)).toBe(true);
    for (const p of thresholdPoints(door, stand)) expect(stand(p)).toBe(true);
    // They walk in: spent. Still open — because they are now the occupant, not because of the grant.
    locks.apply(inside);
    expect(locks.snapshot().authorized).toBeNull();
    // They leave again: shut, and the spent grant does not reopen it.
    locks.apply(outside);
    expect(locks.snapshot().held).toEqual([DOOR_ID]);
    expect(entersDesign(outside, inside)).toBe(false);
  });

  it("an authorisation for a room whose lock lifts is dropped rather than kept for a later lock", () => {
    const { doors, locks } = rig();
    const { outside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.authorize(DESIGN_ROOM_ID);
    locks.setLocked([]);
    expect(locks.snapshot().authorized).toBeNull();
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(outside);
    expect(locks.snapshot().held).toEqual([DOOR_ID]);
  });

  it("withdrawing an unspent authorisation shuts the door again", () => {
    const { doors, locks, entersDesign } = rig();
    const { outside, inside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.authorize(DESIGN_ROOM_ID);
    locks.apply(outside);
    expect(entersDesign(outside, inside)).toBe(true);
    locks.authorize(null);
    locks.apply(outside);
    expect(entersDesign(outside, inside)).toBe(false);
  });
});

describe("the lock follows DND and occupancy", () => {
  it("unlocking releases the doorway; re-locking holds it again; a different room's lock leaves this door alone", () => {
    const { doors, locks, entersDesign } = rig();
    const { outside, inside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(outside);
    expect(entersDesign(outside, inside)).toBe(false);
    locks.setLocked([]);
    expect(locks.apply(outside)).toBe(true);
    expect(entersDesign(outside, inside)).toBe(true);
    locks.setLocked([DEV_ROOM.id]);
    locks.apply(outside);
    expect(entersDesign(outside, inside)).toBe(true);
    expect(locks.snapshot().held.every((id) => id !== DOOR_ID)).toBe(true);
  });

  it("clear() releases every hold (dispose)", () => {
    const { doors, locks, entersDesign } = rig();
    const { outside, inside } = designDoor(doors);
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(outside);
    locks.clear();
    expect(entersDesign(outside, inside)).toBe(true);
  });
});

describe("it shares the mechanism with Reception's gate and the exit, and treads on neither", () => {
  function gateCells(): Cell[] {
    const out: Cell[] = [];
    for (const r of gateRects(GATE.lanes, { z0: GATE.bandZ0, z1: GATE.bandZ1 }))
      for (let cy = Math.floor(r.z / CELL); cy <= Math.floor((r.z + r.d - 0.001) / CELL); cy++)
        for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w - 0.001) / CELL); cx++) out.push({ cx, cy });
    return out;
  }

  it("the room lock's owners are its own, so releasing a room never opens the gate or the exit", () => {
    const { doors, locks, walkability } = rig();
    const { outside } = designDoor(doors);
    walkability.reserve("office-access-gate", gateCells());
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(outside);
    locks.setLocked([]);
    locks.apply(outside);
    // The gate lanes are still reserved: the lock released only `dnd-room-lock:<door>`.
    const lane = gateCells()[0];
    expect(walkability.isReserved(lane.cx, lane.cy)).toBe(true);
    for (const c of doors.find((d) => d.entityId === DOOR_ID)!.cells) expect(walkability.isReserved(c.cx, c.cy)).toBe(false);
  });

  it("…and the gate's own release never opens a locked room", () => {
    const { doors, locks, walkability, entersDesign } = rig();
    const { outside, inside } = designDoor(doors);
    walkability.reserve("office-access-gate", gateCells());
    locks.setLocked([DESIGN_ROOM_ID]);
    locks.apply(outside);
    walkability.release("office-access-gate");
    expect(entersDesign(outside, inside)).toBe(false);
    expect(locks.snapshot().held).toEqual([DOOR_ID]);
    expect(ROOM_LOCK_RESERVATION).toBe("dnd-room-lock");
  });
});
