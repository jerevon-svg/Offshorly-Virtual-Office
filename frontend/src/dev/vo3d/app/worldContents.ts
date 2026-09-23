// vo3d app — WHAT IS IN THE WORLD, assembled once, with no THREE anywhere near it.
//
// WHY THIS FILE EXISTS, and it is worth being blunt about it: the logical world used to be assembled
// inline at the top of createVo3dWorld, in the middle of a file that cannot be imported without a WebGL
// context. That put the single most duplication-prone code in the project — sixty-odd lines of "register
// this room, these entities, these regions" — in the one place no test could run.
//
// It went wrong exactly the way that arrangement always goes wrong. Floor 2's lift core was registered
// twice: once by the vertical-core loop (which registers the core on EVERY floor) and once again by a
// `floor2Entities()` helper that also returned it. WorldState refused the second one, correctly, and the
// whole 3D office failed to start with `duplicate entity id elevator-2/call`. Nearly five thousand tests
// passed, because every one of them re-listed the registrations by hand instead of running these.
//
// So the assembly is a PURE FUNCTION now, and worldContents.test.ts calls the very same one the product
// calls. A duplicate can no longer hide behind a renderer.
//
// ============================= THE OWNERSHIP RULE ===============================================
// EXACTLY ONE AUTHORITATIVE REGISTRATION PER THING, and the owner is whoever the thing BELONGS to:
//
//   a room        owns its own RoomDef and its own entities            (rooms/<room>.ts)
//   the building  owns the vertical core: one RoomDef, one call control and one set of regions PER
//                 FLOOR, all of it in the loop below and nowhere else  (rooms/elevator.ts supplies them)
//   a floor       owns its plate and its bounds, and NOT the core standing on it (rooms/floor2.ts)
//
// The lift core is the building's, not the floor's. That is the distinction the bug was: a floor that
// hands back "the entities on me" will sooner or later hand back something the building already placed.
//
// ============================= THE ORDERING RULE ================================================
// Regions resolve in REGISTRATION ORDER (WorldState.regionAt), so each floor's core has to be registered
// immediately BEFORE the plate that would otherwise claim the floor its shaft stands on. Get that wrong
// and a body walks through the core's walls. Stated once here, asserted in the test.
import { WorldState, type Entity } from "../world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, designRoomEntities } from "../rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "../rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "../rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "../rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "../rooms/gaming";
import { CENTRAL_HUB, centralHubEntities } from "../rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "../rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "../rooms/cms";
import { AI_ROOM, aiRoomEntities } from "../rooms/ai";
import { DEV_ROOM, devRoomEntities } from "../rooms/dev";
import { QA_ROOM, qaRoomEntities } from "../rooms/qa";
import { registerGroundFloor, type GroundFloor } from "../rooms/ground-floor";
import {
  CAVE_ID, CAVE_ROOM, FLOOR_RECT as CAVE_FLOOR_RECT, OUTER_RECT as CAVE_OUTER_RECT,
  VESTIBULE_RECT as CAVE_VESTIBULE_RECT, caveEntities,
} from "../rooms/cave";
import { ELEVATOR as FLOOR2_ELEVATOR, FLOOR2_ROOM, OUTER_RECT as FLOOR2_OUTER, floor2Regions } from "../rooms/floor2";
import { GROUND_ELEVATOR, elevatorCallEntity, elevatorFrameRect, elevatorRegions, type ElevatorSpec } from "../rooms/elevator";
import { FLOOR_ORDER, GROUND_FLOOR_ID, type Vo3dFloorId } from "./floors";
import type { Rect } from "../core/coords";

/** THE ONE PLACE A LIFT CORE IS CREATED, per floor. Both specs are created by the room files that own
 *  the floor they stand on — the ground floor's by rooms/elevator.ts (the Meeting Room's own walls
 *  declare it as solid, so the two must be the same object), floor 2's by rooms/floor2.ts. */
export const ELEVATORS: Record<Vo3dFloorId, ElevatorSpec> = {
  "floor-1": GROUND_ELEVATOR,
  "floor-2": FLOOR2_ELEVATOR,
};

/** The lift cores' room ids, for the handful of places that have to know a region is a lift rather than a
 *  room (Room Discovery, the Toucan's stops, Room Details). Derived, never listed. */
export const ELEVATOR_ROOM_IDS: ReadonlySet<string> = new Set(FLOOR_ORDER.map((f) => ELEVATORS[f].id));

export interface Vo3dWorldContents {
  world: WorldState;
  plan: GroundFloor;
  elevators: Record<Vo3dFloorId, ElevatorSpec>;
  elevatorRoomIds: ReadonlySet<string>;
}

/** The ground floor's baked decor solids: visual comes from the shell builder, so these participate in
 *  placement as footprint-only entities. */
const designSolidEntities = (): Entity[] =>
  DESIGN_SOLIDS.map((r, i) => ({
    id: `${DESIGN_ROOM.id}/solid-${i}`,
    kind: "solid",
    roomId: DESIGN_ROOM.id,
    transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 },
    footprint: { shape: "rect", w: r.w, d: r.d },
    capabilities: {},
    props: {},
    source: { baked: true },
  }));

/** THE WHOLE LOGICAL WORLD: every room, every entity, every region and the bounds that cover them.
 *
 *  Returns a FRESH world on every call and holds no module state, so two calls cannot interfere — which
 *  is what lets a test build one, a second test build another, and the product build its own. */
export function buildWorldContents(): Vo3dWorldContents {
  const world = new WorldState();

  // ---- the eleven reconstructed rooms ----------------------------------------------------------
  for (const room of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(room);
  for (const make of [designRoomEntities, receptionEntities, meetingRoomEntities, projectRoomEntities, gamingRoomEntities, centralHubEntities, executiveRoomEntities, cmsRoomEntities, aiRoomEntities, devRoomEntities, qaRoomEntities, designSolidEntities])
    for (const e of make()) world.addEntity(e);

  // ---- THE VERTICAL CORE, one registration per floor and nowhere else --------------------------
  // Where the ground floor's core stands, and why that spot: rooms/elevator.ts CORE_LOCAL.
  for (const floor of FLOOR_ORDER) {
    const spec = ELEVATORS[floor];
    world.addRoom({ id: spec.id, name: "Elevator", rect: elevatorFrameRect(spec), floorRect: elevatorFrameRect(spec), wallSolids: spec.solids });
    world.addEntity(elevatorCallEntity(spec, "Call the elevator"));
  }

  // ---- FLOOR 1: the core's regions, then the ground floor's plate ------------------------------
  // Core first — the shaft has to be refused before the shared hall claims the floor it stands on.
  for (const r of elevatorRegions(ELEVATORS[GROUND_FLOOR_ID])) world.addRegion(r);
  // every V1 room footprint, the shared floor, the sidewalk and the hand-painted door openings
  const plan = registerGroundFloor(world);

  // ---- FLOOR 2: the same two steps, in the same order ------------------------------------------
  // A second storey in its own world space, registered on exactly the terms the Cave is. It cannot touch
  // a cell of the read-only V1 grid — it is 4,560 units east of the frame — so the ground floor's
  // navigation is provably unaffected.
  world.addRoom(FLOOR2_ROOM);
  for (const r of elevatorRegions(ELEVATORS["floor-2"])) world.addRegion(r);
  for (const r of floor2Regions()) world.addRegion(r);

  // ---- the Championship Cave: a second interior volume, outside the V1 frame --------------------
  // The immersive theatre reached through the hub monument's portal, 1,146 units clear of the frame.
  world.addRoom(CAVE_ROOM);
  for (const e of caveEntities()) world.addEntity(e);
  world.addRegion({ id: `floor:${CAVE_ID}`, kind: "room-floor", rect: CAVE_FLOOR_RECT, walkable: true, roomId: CAVE_ID });
  // the threshold pocket is south of the floor rect and is its own region: PlayerMode scopes interaction
  // candidates by the region's roomId, so a body standing in an unclaimed recess targets nothing — and the
  // way out lives in that recess (rooms/cave.ts VESTIBULE_RECT)
  world.addRegion({ id: `threshold:${CAVE_ID}`, kind: "room-floor", rect: CAVE_VESTIBULE_RECT, walkable: true, roomId: CAVE_ID });

  // ---- the bounds ------------------------------------------------------------------------------
  // They cover every volume this world models. `regionAt` refuses a point outside them before it even
  // looks at a region, so a volume the bounds do not reach is a volume nothing can stand in. Growing them
  // changes nothing inside the office: a point that belongs to no region is still not walkable, it is now
  // merely asked.
  world.bounds = coveringBounds([plan.frame, CAVE_OUTER_RECT, FLOOR2_OUTER]);

  return { world, plan, elevators: ELEVATORS, elevatorRoomIds: ELEVATOR_ROOM_IDS };
}

/** the smallest rect containing all of `boxes` */
export function coveringBounds(boxes: readonly Rect[]): Rect {
  const x = Math.min(...boxes.map((b) => b.x)), z = Math.min(...boxes.map((b) => b.z));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), z1 = Math.max(...boxes.map((b) => b.z + b.d));
  return { x, z, w: x1 - x, d: z1 - z };
}
