// vo3d rooms — THE LIFT: a compact entrance on every floor, and ONE isolated cabin they all share.
//
// ============================= THE ILLUSION, STATED PLAINLY =====================================
// A lift is two things that look like one, and this file keeps them apart on purpose:
//
//   THE ENTRANCE (per floor). A shallow lift bay built into the floor's own wall — plaster, a slim metal
//   portal, two dark brushed leaves, a small indicator, a small call plate. Its inside is a VESTIBULE
//   just big enough to walk into, turn round in, and have a camera behind you. It contains no world
//   geometry of any kind, which is what makes it safe to stand in with the doors open and the real room
//   visible behind them.
//
//   THE CABIN (one, for the whole building). A real premium lift car, standing alone at x 9000 where
//   nothing else in this world reaches. It is 130 wide and 140 deep — room for ten — and its FRONT BAY is
//   an exact copy of a vestibule: same width, same height, same doorway, same doors, same read-out, same
//   panel, and the standing mark the same distance back from the doors.
//
// ============================= WHY THAT MAKES THE SWAP FREE =====================================
// Because the bay and a vestibule are identical, moving the body from one to the other is a TRANSLATION
// that changes no pixel: every surface in frame is the same surface at the same distance. It is done on
// the frame the leaves finish closing, so the only thing on screen is a sealed box that does not change.
// The floor swap then happens while the body is in the cabin, 9,000 units from any floor, behind a shut
// door — there is nothing to see and nothing to hide.
//
// The previous build tried to make ONE physical car 340 units long reach from the Meeting Room out past
// the building. That is what put the room's own west wall, the lawn and its bushes inside the cabin, and
// what showed sky through its seams. No volume here crosses anything.
//
// ============================= WHERE THE GROUND ENTRANCE STANDS =================================
// The Meeting Room's north-west corner, doors facing EAST into the room's circulation — the way people
// arrive in that corner. Bounded by the north wall (z 890), the west wall (x 22), the north chair row's
// own stand cell at (104, 952) and the west credenza at z 992.
import { pointInRect, type Rect, type Vec2 } from "../core/coords";
import type { Entity, WorldRegion } from "../world/WorldState";

/** THE ENTRANCE'S FOOTPRINT on the ground floor, offset by each floor's origin above it. */
export const CORE_LOCAL: Rect = { x: 22, z: 896, w: 68, d: 82 };

/** Shell thickness. A lift bay is a lining set into a wall, not structure of its own — thin, so the
 *  visible box stays shallow and the vestibule keeps the depth the camera needs. */
export const WALL_T = 4;
/** Interior height, and the cap over it. 56 + 4 puts the bay's head 14 above the room's 46-unit walls —
 *  a lift overrun, which is what a real one does, and the only way a 36-unit body gets real headroom out
 *  of an entrance this shallow. It is capped in the room's OWN plaster with a thin shadow reveal, not
 *  the black slab the first build put on it. */
export const CEILING_H = 56;
export const SLAB_T = 4;
/** The clear opening, and the leaves that pocket inside the 20-unit piers either side of it. */
export const DOOR_W = 34;
export const LEAF_T = 2.5;
export const DOOR_H = 38;

/** THE RIDE'S CLOCK. */
export const RIDE = {
  doorMs: 900,
  dwellMs: 320,
  turnMs: 500,
  /** long enough that the read-out's step is a beat you watch rather than one you catch */
  travelMs: 3200,
  settleMs: 760,
  walkSpeed: 44,
  frameMs: 450,
} as const;

/** How far back from the inner door face a single rider stands. The SAME number in a vestibule and in
 *  the cabin's bay — it is what makes the two interchangeable. */
export const MARK_SETBACK = 28;
/** …AND HOW FAR OFF THE DOOR AXIS IT STANDS. Dead centre puts the body — and the camera directly behind
 *  it — square in front of the opening, so the arrival reveal is the back of a head. Twelve to one side
 *  leaves most of the doorway clear to see the new floor through, and is what a person waiting for a
 *  lift does anyway. Applied identically in a vestibule and in the cabin's bay, so the two still match. */
export const MARK_OFFSET = 12;

export interface ElevatorSpec {
  id: string;
  /** the entrance's outer footprint: the box you see from the room */
  outer: Rect;
  /** the vestibule: where you stand, turn, and wait */
  interior: Rect;
  /** the clear opening through the EAST wall */
  doorway: Rect;
  /** the wall runs, as world rects, for the floor's own navigation */
  solids: Rect[];
  /** the leaves at REST, and how far the NORTH one travels to open (the south one mirrors it) */
  leaf: { north: Rect; south: Rect; slideDistance: number };
  /** where a body waits outside, facing the doors */
  boarding: Vec2;
  boardingYaw: number;
  boardingLook: Vec2;
  /** where it stands inside, facing back out through them */
  mark: Vec2;
  standLook: Vec2;
  standYaw: number;
  /** the centre of the opening — every walk in and out is routed through it */
  threshold: Vec2;
  /** the apron in front of the doors: a REGION, so PLAYER mode has a room to scope the call plate to */
  lobbyRect: Rect;
  call: { x: number; z: number; y: number };
  /** the read-out over the doors, outside and in */
  indicator: { x: number; z: number; y: number };
  origin: Vec2;
}

/** Build one floor's entrance from that floor's world ORIGIN. */
export function defineElevator(id: string, origin: Vec2 = { x: 0, z: 0 }): ElevatorSpec {
  const outer: Rect = { x: CORE_LOCAL.x + origin.x, z: CORE_LOCAL.z + origin.z, w: CORE_LOCAL.w, d: CORE_LOCAL.d };
  const T = WALL_T;
  const x0 = outer.x, x1 = outer.x + outer.w, z0 = outer.z, z1 = outer.z + outer.d;
  const interior: Rect = { x: x0 + T, z: z0 + T, w: outer.w - 2 * T, d: outer.d - 2 * T };
  const cz = z0 + outer.d / 2;
  const doorway: Rect = { x: x1 - T, z: cz - DOOR_W / 2, w: T, d: DOOR_W };
  const pierD = doorway.z - z0;
  const solids: Rect[] = [
    { x: x0, z: z0, w: T, d: outer.d }, //                      back (west)
    { x: x0, z: z0, w: outer.w, d: T }, //                      north
    { x: x0, z: z1 - T, w: outer.w, d: T }, //                  south
    { x: x1 - T, z: z0, w: T, d: pierD }, //                    front, north of the opening
    { x: x1 - T, z: doorway.z + DOOR_W, w: T, d: pierD }, //    front, south of the opening
  ];
  const leafD = DOOR_W / 2;
  const leafX = x1 - T + (T - LEAF_T) / 2;
  return {
    id,
    outer,
    interior,
    doorway,
    solids,
    leaf: {
      north: { x: leafX, z: doorway.z, w: LEAF_T, d: leafD },
      south: { x: leafX, z: cz, w: LEAF_T, d: leafD },
      slideDistance: leafD,
    },
    boarding: { x: x1 + 18, z: cz },
    // YAWS ARE DERIVED FROM THE LOOK VECTOR, never from core/coords FACING_YAW: this world's two yaw
    // conventions are MIRRORED on the east-west axis, and this lift is the first thing in the building
    // to face east. The table would turn the body away from its own doors.
    boardingYaw: Math.atan2(-1, 0),
    boardingLook: { x: -1, z: 0 },
    mark: { x: x1 - T - MARK_SETBACK, z: cz - MARK_OFFSET },
    standLook: { x: 1, z: 0 },
    standYaw: Math.atan2(1, 0),
    threshold: { x: x1 - T / 2, z: cz },
    // DELIBERATELY NARROWER THAN THE DOORWAY. The north chair row's stand cell is at (104, 952); an apron
    // that swallowed it would scope PLAYER's "[E]" there to the lift and take the chair off the person
    // standing at it.
    lobbyRect: { x: x1, z: doorway.z + 2, w: 22, d: DOOR_W - 6 },
    call: { x: x1 + 0.6, z: doorway.z + DOOR_W + pierD / 2, y: 22 },
    indicator: { x: x1 + 0.8, z: cz, y: DOOR_H + (CEILING_H - DOOR_H) * 0.72 },
    origin: { x: origin.x, z: origin.z },
  };
}

/** THE GROUND FLOOR'S ENTRANCE — created here, once, so rooms/meeting.ts (which declares it solid so the
 *  room's derived navigation knows the corner is built on) and app/worldContents.ts read the same object. */
export const GROUND_ELEVATOR: ElevatorSpec = defineElevator("elevator-1");

// ============================= THE CABIN ========================================================

/** Where the one cabin stands. Nothing else in this world is within thousands of units of it: the V1
 *  frame ends at 1440, the Cave at 3174, floor 2 at 7440, and the campus roads run out at 5400. */
export const CABIN_ORIGIN: Vec2 = { x: 9000, z: 400 };

/** The bay is an exact copy of a vestibule; the volume behind it is the car proper. */
export const CABIN = (() => {
  const v = GROUND_ELEVATOR.interior; //                        60 deep x 74 wide, the shape to match
  const T = WALL_T;
  const bay: Rect = { x: CABIN_ORIGIN.x, z: CABIN_ORIGIN.z, w: v.w, d: v.d };
  const cz = bay.z + bay.d / 2;
  /** the car proper, BEHIND the bay: wider, and deep enough for a group */
  const volume: Rect = { x: bay.x - 80, z: cz - 65, w: 80, d: 130 };
  const interiorX0 = volume.x, interiorX1 = bay.x + bay.w;
  const outer: Rect = { x: interiorX0 - T, z: volume.z - T, w: interiorX1 - interiorX0 + 2 * T, d: volume.d + 2 * T };
  const doorway: Rect = { x: interiorX1, z: cz - DOOR_W / 2, w: T, d: DOOR_W };
  const leafD = DOOR_W / 2;
  const leafX = interiorX1 + (T - LEAF_T) / 2;
  /** the rider's mark, the SAME setback from the inner door face a vestibule uses */
  const mark: Vec2 = { x: interiorX1 - MARK_SETBACK, z: cz - MARK_OFFSET };
  /** TEN PLACES for the group journey that comes later: five abreast, two rows deep, every centre 24
   *  from its neighbours and 12 clear of a wall — a lift-load of people, not a queue in a corridor. */
  const group: Vec2[] = [];
  for (const x of [volume.x + 30, volume.x + 54]) for (let i = 0; i < 5; i++) group.push({ x, z: cz - 48 + i * 24 });
  return { bay, volume, outer, doorway, mark, group, centreZ: cz, leaf: { north: { x: leafX, z: doorway.z, w: LEAF_T, d: leafD }, south: { x: leafX, z: cz, w: LEAF_T, d: leafD }, slideDistance: leafD } };
})();

/** Is `p` inside the cabin's own volume? Asked before any floor's test — the cabin is nowhere near one. */
export const inCabin = (p: Vec2): boolean => pointInRect(p, CABIN.outer);

/** Can a body of `radius` stand at `p` in the cabin? It answers for its own space: it is a room that is
 *  not on any floor, so no lattice describes it and its shell genuinely stops a body. */
export function cabinStandTest(p: Vec2, radius: number): boolean {
  const inRect = (r: Rect): boolean => p.x >= r.x + radius && p.x <= r.x + r.w - radius && p.z >= r.z + radius && p.z <= r.z + r.d - radius;
  return inRect(CABIN.volume) || inRect(CABIN.bay);
}

/** THE VECTOR that carries a body from `spec`'s vestibule mark to the cabin's bay mark, and back. Because
 *  the two are identical, applying it to the body AND the camera changes nothing on screen. */
export const toCabin = (spec: ElevatorSpec): Vec2 => ({ x: CABIN.mark.x - spec.mark.x, z: CABIN.mark.z - spec.mark.z });

// ============================= FLOOR PLUMBING ===================================================

/** Is `p` inside this floor's vestibule (or its doorway)? */
export const inVestibule = (spec: ElevatorSpec, p: Vec2): boolean =>
  pointInRect(p, spec.interior) || pointInRect(p, spec.doorway);

/** Can a body of `radius` stand in the vestibule? */
export function vestibuleStandTest(spec: ElevatorSpec, p: Vec2, radius: number): boolean {
  const v = spec.interior;
  if (p.x >= v.x + radius && p.x <= v.x + v.w - radius && p.z >= v.z + radius && p.z <= v.z + v.d - radius) return true;
  const d = spec.doorway;
  return p.z >= d.z + radius && p.z <= d.z + d.d - radius && p.x >= d.x - radius * 2 && p.x <= d.x + d.w + radius * 2;
}

/** THE REGIONS ONE FLOOR'S ENTRANCE CONTRIBUTES, in priority order. The box is NOT walkable — it is a
 *  wall recess, and while the cinematic has somebody in it the cinematic owns them — and the apron in
 *  front of it IS. MUST be registered before the floor's own plate: priority is registration order. */
export function elevatorRegions(spec: ElevatorSpec): WorldRegion[] {
  return [
    { id: `elevator:lobby:${spec.id}`, kind: "room-floor", rect: spec.lobbyRect, walkable: true, roomId: spec.id },
    { id: `elevator:shaft:${spec.id}`, kind: "room-floor", rect: spec.outer, walkable: false, roomId: spec.id },
  ];
}

export const elevatorFrameRect = (spec: ElevatorSpec): Rect => ({
  x: spec.outer.x, z: spec.outer.z, w: spec.outer.w + spec.lobbyRect.w, d: spec.outer.d,
});

/** Does a body of `radius` centred on `p` clear every wall of this entrance? */
export function clearsElevator(spec: ElevatorSpec, p: Vec2, radius: number): boolean {
  for (const s of spec.solids) {
    const nx = Math.max(s.x, Math.min(p.x, s.x + s.w));
    const nz = Math.max(s.z, Math.min(p.z, s.z + s.d));
    if (Math.hypot(p.x - nx, p.z - nz) < radius) return false;
  }
  return true;
}

/** THE CALL CONTROL, as an ordinary `approach` entity. */
export function elevatorCallEntity(spec: ElevatorSpec, label: string): Entity {
  return {
    id: `${spec.id}/call`,
    kind: "solid",
    roomId: spec.id,
    transform: { pos: { x: spec.call.x, z: spec.call.z }, yaw: 0 },
    capabilities: { approach: { point: { ...spec.boarding }, yaw: spec.boardingYaw, label, action: "call-elevator" } },
    props: { pick: `elevator-call:${spec.id}` },
    source: { baked: true },
  };
}
