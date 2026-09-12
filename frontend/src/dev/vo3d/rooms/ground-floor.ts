// vo3d rooms — the GROUND FLOOR definition (data only): every V1 room footprint at its manifest rect,
// the shared floor (frame minus rooms), the sidewalk, and the hand-painted door openings. Only the
// Design Room is reconstructed; the other rooms are footprints/boundaries awaiting their own phases.
import { growRect, type Rect } from "../core/coords";
import { CELL } from "../adapters/v1Grid";
import type { WorldRegion, WorldState } from "../world/WorldState";
import { FRAME, v1DoorOpenings, v1Rooms, v1Sidewalk, type DoorOpening, type V1Room } from "../adapters/v1Floor";
import { DESIGN_ROOM } from "./design-room";

export type FloorRoom = V1Room & {
  /** true = full interior modelled (walkable floor region + furniture); false = footprint/boundary only */
  reconstructed: boolean;
  /** V1 draws the central hub as an open lounge on the hall floor: no walls, footprint only */
  walls: boolean;
};

export interface GroundFloor {
  frame: Rect;
  rooms: FloorRoom[];
  sidewalk: Rect;
  openings: DoorOpening[];
  /** placeholder shell language shared by every unreconstructed room (matches the Design Room shell) */
  shell: { wallHeight: number; wallThickness: number; frontWallHeight: number; capRadius: number; doorHeight: number; plateLift: number };
}

export const RECONSTRUCTED_ROOM_IDS = new Set([DESIGN_ROOM.id]);
const WALL_LESS_ROOM_IDS = new Set(["central-hub"]);

export function groundFloor(): GroundFloor {
  const rooms = v1Rooms().map((r) => ({ ...r, reconstructed: RECONSTRUCTED_ROOM_IDS.has(r.id), walls: !WALL_LESS_ROOM_IDS.has(r.id) }));
  return {
    frame: FRAME,
    rooms,
    sidewalk: v1Sidewalk(),
    openings: v1DoorOpenings(rooms),
    shell: { wallHeight: DESIGN_ROOM.shell.wallHeight, wallThickness: DESIGN_ROOM.shell.wallThickness, frontWallHeight: DESIGN_ROOM.shell.frontWallHeight, capRadius: DESIGN_ROOM.shell.capRadius, doorHeight: 30, plateLift: 0.5 },
  };
}

/** A room "owns" the cells that lie FULLY inside its manifest bounding rect. Cells straddling the rect edge
 *  (the art's bounding box overshoots the V1 corridor cells by a few units, e.g. the Executive outside-stand
 *  row) belong to the hall — the V1 grid alone decides whether they are walkable. */
export const interiorRect = (r: Rect): Rect => growRect(r, -CELL / 2);

/** World-region contract for the ground floor, in priority order:
 *   1. reconstructed room floors (walkable)          — the room's own floorRect
 *   2. sidewalk (exterior, walkable)                  — V1 rows 73–76; reachable only through the reception later
 *   3. unreconstructed room footprints (NOT walkable) — interiorRect: the V1 grid knows the interior, we have no geometry yet
 *   4. shared floor (walkable)                        — the frame minus every room's interiorRect
 *  Bounds = the frame. */
export function groundFloorRegions(plan: GroundFloor, world: WorldState): WorldRegion[] {
  const regions: WorldRegion[] = [];
  for (const r of plan.rooms) {
    if (!r.reconstructed) continue;
    const def = world.rooms.get(r.id);
    if (!def) throw new Error(`ground floor: reconstructed room ${r.id} has no RoomDef in the world`);
    regions.push({ id: `floor:${r.id}`, kind: "room-floor", rect: def.floorRect, walkable: true, roomId: r.id });
  }
  regions.push({ id: "exterior:sidewalk", kind: "exterior", rect: plan.sidewalk, walkable: true });
  for (const r of plan.rooms) if (!r.reconstructed) regions.push({ id: `footprint:${r.id}`, kind: "room-floor", rect: interiorRect(r.rect), walkable: false, roomId: r.id });
  regions.push({ id: "shared:ground-floor", kind: "shared-floor", rect: plan.frame, holes: plan.rooms.map((r) => interiorRect(r.rect)), walkable: true });
  return regions;
}

export function registerGroundFloor(world: WorldState, plan: GroundFloor = groundFloor()): GroundFloor {
  world.bounds = plan.frame;
  for (const r of groundFloorRegions(plan, world)) world.addRegion(r);
  return plan;
}
