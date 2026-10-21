// vo3d app — THE PLATE REGISTRY: where each floor of the building STANDS in world space, and what answers
// for it. app/floors.ts says which floors exist and what they are called; this file says where they are.
//
// WHY A SECOND TABLE. floors.ts is a leaf that imports one type, so the React overlay can read it without
// dragging room geometry along. A plate is geometry — a footprint, a lift entrance, a stand test — so it
// lives here, keyed by the same ids, and the world, its assembly and the lift read THIS instead of naming
// a floor in an `if`.
//
// THE GROUND FLOOR HAS NO ROW, deliberately. It is V1's own frame: its walkability is V1's lattice, its
// footprint is the ground-floor plan's, and every test that answers for it already exists. A row here is
// a floor in its OWN world space beyond that frame, answering from its own geometry — the way floor 2
// does, and the way any floor above it will.
//
// ADDING A FLOOR = a row in app/floors.ts + a row in UPPER_PLATES + its geometry. Region priority is
// registration order, so `register` keeps each plate's own rule: the lift core's regions first (the
// building's, app/worldContents.ts), then whatever stands ON the plate, then the plate's floor.
import { pointInRect, type Rect, type Vec2 } from "../core/coords";
import type { RoomDef, WorldRegion, WorldState } from "../world/WorldState";
import { GROUND_ELEVATOR, inCabin, type ElevatorSpec } from "../rooms/elevator";
import {
  ELEVATOR as FLOOR2_ELEVATOR, FLOOR2_ID, FLOOR2_ROOM, FLOOR_RECT as FLOOR2_FLOOR_RECT, FRAME as FLOOR2_FRAME,
  OUTER_RECT as FLOOR2_OUTER, floor2Regions, floor2StandTest,
} from "../rooms/floor2";
import { MEETING_ROOM_DEFS, meetingFloorEntities, meetingRoomRegions } from "../rooms/floor2Meeting";
import { FLOOR3, FLOOR4, type PlainFloorPlan } from "../rooms/plainFloor";
import { FLOOR_ORDER, GROUND_FLOOR_ID, STOREY_H, exteriorDrop, type Vo3dFloorId } from "./floors";

export interface UpperFloorPlate {
  id: Vo3dFloorId;
  /** the plate's RoomDef — the room every point of its floor that no other room claims belongs to */
  room: RoomDef;
  /** this floor's lift entrance (rooms/elevator defineElevator, offset by the floor's origin) */
  elevator: ElevatorSpec;
  /** the plate's footprint: OFFICE's camera fence and the exterior's anchor */
  frame: Rect;
  /** the walkable floor inside the perimeter: what the plate's router samples */
  floorRect: Rect;
  /** "is this point on this floor at all?" — and what the world's bounds must cover */
  outer: Rect;
  /** can a body of `radius` stand at `p`? The ONLY place that is decided for this floor. */
  standTest(p: Vec2, radius: number): boolean;
  /** what stands ON the plate (its rooms, entities and their regions), registered between the lift core's
   *  regions and the plate's own floor — priority is registration order */
  registerContents?(world: WorldState): void;
  /** the plate's own floor region(s), registered last */
  regions(): WorldRegion[];
}

/** Bottom to top, every floor ABOVE the ground one. */
export const UPPER_PLATES: readonly UpperFloorPlate[] = [
  {
    id: FLOOR2_ID,
    room: FLOOR2_ROOM,
    elevator: FLOOR2_ELEVATOR,
    frame: FLOOR2_FRAME,
    floorRect: FLOOR2_FLOOR_RECT,
    outer: FLOOR2_OUTER,
    standTest: floor2StandTest,
    // THE MEETING ROOMS: each a room of its own, owning its seats and its display walk-up; the Commons'
    // soft seating belongs to the plate. Their floors are regions BEFORE the plate's.
    registerContents: (world) => {
      for (const room of MEETING_ROOM_DEFS) world.addRoom(room);
      for (const e of meetingFloorEntities()) world.addEntity(e);
      for (const r of meetingRoomRegions()) world.addRegion(r);
    },
    regions: floor2Regions,
  },
  plainPlate("floor-3", FLOOR3),
  plainPlate("floor-4", FLOOR4),
];

/** an EMPTY storey's row (rooms/plainFloor): the plate, its lift, nothing standing on it yet */
function plainPlate(id: Vo3dFloorId, plan: PlainFloorPlan): UpperFloorPlate {
  return { id, room: plan.room, elevator: plan.elevator, frame: plan.frame, floorRect: plan.floorRect, outer: plan.outer, standTest: plan.standTest, regions: plan.regions };
}

const PLATE_BY_ID: ReadonlyMap<Vo3dFloorId, UpperFloorPlate> = new Map(UPPER_PLATES.map((p) => [p.id, p]));

/** this floor's plate, or null for the ground floor (V1's own frame) */
export const upperPlate = (id: Vo3dFloorId): UpperFloorPlate | null => PLATE_BY_ID.get(id) ?? null;

/** THE PLATE `p` STANDS ON, or null — on the ground floor, in the Cave, the cabin, the campus. */
export function upperPlateAt(p: Vec2): UpperFloorPlate | null {
  for (const plate of UPPER_PLATES) if (pointInRect(p, plate.outer)) return plate;
  return null;
}

/** is `p` on any floor above the ground one? */
export const onUpperFloor = (p: Vec2): boolean => upperPlateAt(p) !== null;

/** the stand test of the plate `p` is on; false off every plate (callers ask `onUpperFloor` first) */
export function upperFloorStand(p: Vec2, radius: number): boolean {
  const plate = upperPlateAt(p);
  return plate !== null && plate.standTest(p, radius);
}

/** IS `p` ON A FLAT FLOOR OF THE BUILDING THAT STANDS OUTSIDE V1'S FRAME — an upper plate, or the lift's
 *  one cabin? Both are interiors at y 0. The cabin is on NO floor and NOT on the campus: asked of the
 *  campus ground model, x 9000 is open terrain at GRADE, and a rider stood there sinks into the car's floor. */
export const onDetachedBuildingFloor = (p: Vec2): boolean => inCabin(p) || onUpperFloor(p);

/** THE ONE PLACE A LIFT ENTRANCE IS NAMED, per floor: the ground floor's by rooms/elevator.ts (the Meeting
 *  Room's own walls declare it solid, so the two must be the same object), every other by its plate. */
export const ELEVATORS: Readonly<Record<Vo3dFloorId, ElevatorSpec>> = Object.fromEntries(
  FLOOR_ORDER.map((f) => [f, f === GROUND_FLOOR_ID ? GROUND_ELEVATOR : PLATE_BY_ID.get(f)?.elevator]),
) as Record<Vo3dFloorId, ElevatorSpec>;

/** the call control's entity id on each floor's lift */
export const ELEVATOR_CALL_IDS: ReadonlySet<string> = new Set(FLOOR_ORDER.map((f) => `${ELEVATORS[f].id}/call`));

/** the plates' own room ids — not rooms anybody discovers or details */
export const UPPER_PLATE_ROOM_IDS: ReadonlySet<string> = new Set(UPPER_PLATES.map((p) => p.room.id));

/** WHERE THE ONE SHARED EXTERIOR (the campus, its traffic, the AI Lab) STANDS WHILE `floor` IS SHOWN: moved by
 *  that plate's offset from the ground floor's frame, so every road, car, tree and the Lab keep their exact
 *  place relative to the building, and dropped by the floor's storeys (app/floors STOREY_H) so the view out
 *  of each storey's windows is from its real height — 0 / 96 / 192 / 288. One campus, never a copy. */
export function exteriorAnchorFor(floor: Vo3dFloorId, groundFrame: Rect, storey: number = STOREY_H): { x: number; y: number; z: number } {
  const f = upperPlate(floor)?.frame ?? groundFrame;
  return { x: f.x - groundFrame.x, y: -exteriorDrop(floor, storey), z: f.z - groundFrame.z };
}
