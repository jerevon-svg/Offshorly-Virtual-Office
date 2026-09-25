// vo3d rooms — FLOOR 2, THE MEETING FLOOR (data only, WORLD coordinates).
//
// DELIBERATELY EMPTY. This milestone builds the multi-floor ARCHITECTURE — the elevator, the transition,
// the view rules and the floor identity on the wire — and proves it against a floor with nothing on it.
// No meeting rooms, no boardroom, no huddle rooms, no furniture pass. Everything that is here is here
// because the floor system could not be shown to work without it: a slab, safe outer bounds, the
// elevator's arrival architecture, a lobby clearance in front of it, and enough light to see by.
//
// ============================= WHY IT STANDS OUTSIDE THE V1 FRAME ===============================
// The same reason rooms/cave.ts gives, and it is not a stylistic choice:
//
//   • V1's walkability grid is 90 x 78 cells covering x 0…1440, z 0…1244 and is READ-ONLY. A second
//     storey cannot share those cells — they already describe the ground floor.
//   • WorldState's regions, the navigation lattice and every stand test are indexed on (x, z). There is
//     no y in any of them, so "above" is not a coordinate this world can express.
//
// So floor 2 stands in its own world space EAST of everything else — clear of the V1 frame, of the
// campus block and of the Championship Cave — and is NEVER DRAWN while nobody is on it, exactly as the
// Cave is never drawn while nobody is inside it. The separation is therefore unobservable in both
// directions, and the ground floor's navigation is provably untouched: nothing here can reach a cell of
// that grid.
//
// ============================= THE FOOTPRINT ====================================================
// EXACTLY 1440 x 1244 — the same plate as the ground floor, because it is the same building. The
// walkable floor is that footprint inset by the perimeter wall, which is what a storey of a building is.
import { growRect, pointInRect, type Rect, type Vec2 } from "../core/coords";
import type { RoomDef, WorldRegion } from "../world/WorldState";
import { clearsElevator, defineElevator, type ElevatorSpec } from "./elevator";

export const FLOOR2_ID = "floor-2";

/** North-west corner of floor 2's plate, in world space.
 *
 *  x 6000 is east of every other thing this world builds: the V1 frame ends at 1440, the campus block's
 *  east parcel at 3956, the Championship Cave at 3174, and the campus roads run out at 5400. Nothing
 *  overlaps and nothing has to move. */
export const ORIGIN: Vec2 = { x: 6000, z: 0 };

/** THE FLOOR'S FOOTPRINT: 1440 x 1244, the ground floor's plate exactly. */
export const FRAME: Rect = { x: ORIGIN.x, z: ORIGIN.z, w: 1440, d: 1244 };

/** Perimeter wall thickness and height — the building's own (rooms/ground-floor shell). */
export const WALL_T = 12;
export const WALL_H = 60;

/** THE WALKABLE FLOOR: the footprint inside the perimeter wall. This is the outer boundary an avatar can
 *  never cross — there is nothing beyond it and nothing to fall off into. */
export const FLOOR_RECT: Rect = growRect(FRAME, -WALL_T);

/** The perimeter, as four world rects, for the stand test and for the builder. */
export const WALLS: Rect[] = [
  { x: FRAME.x, z: FRAME.z, w: FRAME.w, d: WALL_T }, //                       north
  { x: FRAME.x, z: FRAME.z + FRAME.d - WALL_T, w: FRAME.w, d: WALL_T }, //    south
  { x: FRAME.x, z: FRAME.z, w: WALL_T, d: FRAME.d }, //                       west
  { x: FRAME.x + FRAME.w - WALL_T, z: FRAME.z, w: WALL_T, d: FRAME.d }, //    east
];

/** THE ELEVATOR, at the SAME plan position it occupies downstairs. The shaft is a straight line through
 *  the building: you step out of the car on the same side, on the same axis, into the same lobby
 *  geometry — which is what makes arriving read as arriving on another floor of one building. */
export const ELEVATOR: ElevatorSpec = defineElevator("elevator-2", ORIGIN);

/** Where a body lands on arrival, and where it leaves from: the apron in front of the lift's doors. */
export const SPAWN: Vec2 = ELEVATOR.boarding;

/** OUTER — the floor plus a margin, used as the "am I on this floor?" test and to grow the world bounds.
 *  Generous on purpose: `regionAt` refuses every point outside `world.bounds` before it looks at a
 *  region, so the bounds have to cover the plate and the walls standing on its edge. */
export const OUTER_RECT: Rect = growRect(FRAME, 60);

/** Is this point on floor 2 at all? The one question the world asks to know which stand test applies. */
export const onFloor2 = (p: Vec2): boolean => pointInRect(p, OUTER_RECT);

/** THIS FLOOR'S OWN "can a body stand here?".
 *
 *  Floor 2 is outside V1's lattice, so it is neither V1-governed nor DerivedNav-governed (both are
 *  indexed by that 90 x 78 grid) and it answers from its own geometry, exactly as the Cave does. It is a
 *  ROUTING of the question, not a relaxation: the perimeter wall and the lift core genuinely stop a body,
 *  and this is the only place that is decided. */
export function floor2StandTest(p: Vec2, radius: number): boolean {
  if (!pointInRect(p, growRect(FLOOR_RECT, -radius))) return false;
  return clearsElevator(ELEVATOR, p, radius);
}

export const FLOOR2_ROOM: RoomDef = {
  id: FLOOR2_ID,
  name: "Meeting Floor",
  rect: FRAME,
  floorRect: FLOOR_RECT,
  wallSolids: WALLS,
};

/** THE REGIONS THE FLOOR PLATE ITSELF CONTRIBUTES — and ONLY those.
 *
 *  THE LIFT CORE IS NOT THIS FLOOR'S. It is the BUILDING's: one vertical shaft through every storey,
 *  registered once per floor by app/worldContents.ts, which also supplies its RoomDef, its call control
 *  and its regions. This function used to return the core's regions too, and a companion
 *  `floor2Entities()` used to return the core's call control — which the building had already placed.
 *  That second registration is what made the 3D office refuse to start with `duplicate entity id
 *  elevator-2/call`. A floor that answers "what is on me" will sooner or later answer with something the
 *  building put there, so this floor answers only for its own plate.
 *
 *  The caller registers the core's regions immediately BEFORE these, because region priority is
 *  registration order and the plate would otherwise claim the floor the shaft stands on. */
export function floor2Regions(): WorldRegion[] {
  return [{ id: `floor:${FLOOR2_ID}`, kind: "room-floor", rect: FLOOR_RECT, walkable: true, roomId: FLOOR2_ID }];
}
