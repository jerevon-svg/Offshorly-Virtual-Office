// vo3d rooms — AN EMPTY STOREY: a real, reachable floor plate with nothing built on it yet (data only,
// WORLD coordinates).
//
// Floors 3 (Compass University) and 4 (Gaming & Social Hub) are this today. Each is the building's own
// plate — the ground floor's 1440 x 1244 footprint, floor 2's perimeter wall, the same lift entrance at the
// same place on the west wall as floor 2's — standing in its own world space for exactly the reason
// rooms/floor2.ts gives (V1's lattice is read-only and covers the ground floor alone; nothing here has a y).
//
// WHERE THEY STAND. In a column with floor 2 at x 6000, a storey's depth apart in z: clear of the V1
// frame (x <= 1440), the campus (|x| <= 5400), the Cave (x <= 3174), floor 2 (z <= 1304 with its margin)
// and the one lift cabin (x 9000). app/floorPlates.test.ts asserts every one of those separations.
//
// When a floor gets its real content, it keeps this plate and adds what stands on it through its registry
// row's `registerContents` — the way floor 2's meeting rooms are registered.
import { growRect, pointInRect, type Rect, type Vec2 } from "../core/coords";
import type { RoomDef, WorldRegion } from "../world/WorldState";
import { CORE_LOCAL, clearsClosedElevator, defineElevator, type ElevatorSpec } from "./elevator";
import { WALL_T } from "./floor2";

export interface PlainFloorPlan {
  id: string;
  origin: Vec2;
  /** the plate's footprint — the ground floor's, exactly */
  frame: Rect;
  /** the walkable floor inside the perimeter wall */
  floorRect: Rect;
  /** the perimeter, as four world rects */
  walls: Rect[];
  /** the floor plus a margin: "am I on this floor?" and the world bounds */
  outer: Rect;
  elevator: ElevatorSpec;
  room: RoomDef;
  /** where a body lands on arrival: the apron in front of the lift */
  spawn: Vec2;
  standTest(p: Vec2, radius: number): boolean;
  regions(): WorldRegion[];
}

/** THE PLATE'S FOOTPRINT — the building's, on every storey */
const PLATE_W = 1440;
const PLATE_D = 1244;

/** One empty storey whose north-west corner stands at `origin`. */
export function definePlainFloor(id: string, name: string, elevatorId: string, origin: Vec2): PlainFloorPlan {
  const frame: Rect = { x: origin.x, z: origin.z, w: PLATE_W, d: PLATE_D };
  const floorRect = growRect(frame, -WALL_T);
  const walls: Rect[] = [
    { x: frame.x, z: frame.z, w: frame.w, d: WALL_T },
    { x: frame.x, z: frame.z + frame.d - WALL_T, w: frame.w, d: WALL_T },
    { x: frame.x, z: frame.z, w: WALL_T, d: frame.d },
    { x: frame.x + frame.w - WALL_T, z: frame.z, w: WALL_T, d: frame.d },
  ];
  // THE LIFT where floor 2's is: centred on the west wall, so the shaft stands in one line up the building
  const elevator = defineElevator(elevatorId, { x: origin.x, z: origin.z + frame.d / 2 - (CORE_LOCAL.z + CORE_LOCAL.d / 2) });
  const inner = (radius: number): Rect => growRect(floorRect, -radius);
  return {
    id,
    origin: { ...origin },
    frame,
    floorRect,
    walls,
    outer: growRect(frame, 60),
    elevator,
    room: { id, name, rect: frame, floorRect, wallSolids: walls },
    spawn: elevator.boarding,
    // the perimeter and the lift entrance with its doors SHUT are the only things on an empty plate
    standTest: (p, radius) => pointInRect(p, inner(radius)) && clearsClosedElevator(elevator, p, radius),
    regions: () => [{ id: `floor:${id}`, kind: "room-floor", rect: floorRect, walkable: true, roomId: id }],
  };
}

export const FLOOR3: PlainFloorPlan = definePlainFloor("floor-3", "Compass University", "elevator-3", { x: 6000, z: 2000 });
export const FLOOR4: PlainFloorPlan = definePlainFloor("floor-4", "Gaming & Social Hub", "elevator-4", { x: 6000, z: 4000 });
