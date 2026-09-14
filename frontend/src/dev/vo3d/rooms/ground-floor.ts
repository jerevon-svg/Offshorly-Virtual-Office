// vo3d rooms — the GROUND FLOOR definition (data only): every V1 room footprint at its manifest rect,
// the shared floor (frame minus rooms), the sidewalk, and the hand-painted door openings. The Design Room
// and Reception are reconstructed; the other rooms are footprints/boundaries awaiting their own phases.
import { growRect, type Rect } from "../core/coords";
import type { OpenBand } from "../nav/v2Open";
import { CELL } from "../adapters/v1Grid";
import type { WorldRegion, WorldState } from "../world/WorldState";
import { FACADE_Z, FRAME, FRONT_ROW_ROOM_IDS, v1DoorOpenings, v1Rooms, v1Sidewalk, type DoorOpening, type V1Room } from "../adapters/v1Floor";
import { DESIGN_ROOM, SHELL } from "./design-room";
import { RECEPTION_ROOM } from "./reception";
import { MEETING_ROOM } from "./meeting";
import { PROJECT_ROOM } from "./project";
import { GAMING_ROOM } from "./gaming";
import { CENTRAL_HUB } from "./central-hub";
import { EXECUTIVE_ROOM } from "./executive";
import { CMS_ROOM } from "./cms";

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
  /** the shared street-façade plane of the front row (Meeting → Reception → Project) */
  facadeZ: number;
}

export const RECONSTRUCTED_ROOM_IDS = new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id]);
/** The Central Hub is a wall-less atrium: V1 draws it as an open lounge on the hall floor, with no wall
 *  ring and no door cells. It STAYS wall-less after reconstruction (Phase 6B) — `walls: false` is what
 *  keeps build/floorplan.ts from ever ringing it, and the hub's own static builder owns its floor plate. */
const WALL_LESS_ROOM_IDS = new Set(["central-hub"]);

/** PLACEHOLDER FAÇADE ALIGNMENT (Phase 3B). A front-row room's placeholder plate + south wall are derived
 *  from its ART bounding box, and the three boxes disagree about where the street is by up to 115 units
 *  (Meeting ends at z 1199.4, Project at 1238.1 — out on the sidewalk). The V1 grid says the façade is one
 *  continuous band for all 90 columns, so front-row placeholders are clamped to that plane and Reception
 *  builds its real glass on it. This moves PLACEHOLDER GEOMETRY ONLY: room rects, regions, the walkability
 *  grid and room identity are untouched, and Meeting/Project stay unreconstructed. */
/** PLACEHOLDER CORRIDOR CLAMP (Phase 8). An unreconstructed room's placeholder is drawn at its ART
 *  bounding box, and the Dev room's box runs to z 331.5 — 13.5 units from the CMS room's north wall face
 *  at 345. That is not a corridor: Bon's collision radius alone is 8, so the east–west lane that serves
 *  the Dev room's own south entrance had NO legal standing point in it once CMS was built.
 *
 *  V1 itself says where that room ends: its south wall band is rows 19–20 (z 304…336), the same doubled
 *  band every other room paints, and the room interior stops at 304. The placeholder is therefore clamped
 *  to 304 — its own V1 line — which opens a 41-unit corridor between it and CMS.
 *
 *  This moves PLACEHOLDER GEOMETRY AND ITS REGION ONLY, exactly as the front-row façade clamp above does.
 *  The V1 grid file is untouched, the Dev room's rect, room identity and door openings are untouched, and
 *  CMS does not move by a unit. The two cell rows the clamp gives back are declared as an OpenBand
 *  (CORRIDOR_BANDS) so the walkable grid and the built geometry say the same thing — there is no
 *  player-only opening here.
 *
 *  When the Dev room is reconstructed it builds its own real walls and this entry is deleted. */
export const PLACEHOLDER_SOUTH_CLAMP: Record<string, number> = { "dev-room": 304 };

export function roomSouthZ(room: V1Room, plan: Pick<GroundFloor, "facadeZ" | "shell">): number {
  const clamp = PLACEHOLDER_SOUTH_CLAMP[room.id];
  if (clamp !== undefined) return clamp;
  return FRONT_ROW_ROOM_IDS.has(room.id) ? plan.facadeZ + plan.shell.wallThickness : room.rect.z + room.rect.d;
}

/** The rect a clamped placeholder actually occupies — geometry, footprint region and shared-floor hole all
 *  read this, so nothing claims floor the placeholder no longer stands on. */
export function placeholderRect(room: V1Room): Rect {
  const clamp = PLACEHOLDER_SOUTH_CLAMP[room.id];
  return clamp === undefined ? room.rect : { ...room.rect, d: clamp - room.rect.z };
}

/** The cells a clamp gives back, declared so navigation agrees with the geometry. V1 paints the Dev
 *  room's south wall 32 units deep (rows 19–20) because the flat render draws its elevation; the clamped
 *  placeholder occupies none of it. Cols 69–89 is the run between the north–south hall and the east wall,
 *  which is the whole corridor. The Dev door's own '+' cells are already walkable and unaffected. */
export const CORRIDOR_BANDS: OpenBand[] = [
  { id: "dev-cms-corridor", rect: { x: 69 * CELL, z: 19 * CELL, w: 21 * CELL, d: 2 * CELL }, solids: [] },
];

export function groundFloor(): GroundFloor {
  const rooms = v1Rooms().map((r) => ({ ...r, reconstructed: RECONSTRUCTED_ROOM_IDS.has(r.id), walls: !WALL_LESS_ROOM_IDS.has(r.id) }));
  return {
    frame: FRAME,
    rooms,
    sidewalk: v1Sidewalk(),
    openings: v1DoorOpenings(rooms),
    shell: { wallHeight: SHELL.wallHeight, wallThickness: SHELL.wallThickness, frontWallHeight: SHELL.frontWallHeight, capRadius: SHELL.capRadius, doorHeight: 30, plateLift: 0.5 },
    facadeZ: FACADE_Z,
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
  // A clamped placeholder's footprint and hole use the rect it ACTUALLY occupies, or the corridor it gave
  // back would still be claimed as unwalkable room interior and the clamp would be cosmetic.
  const claimed = (r: FloorRoom): Rect => interiorRect(placeholderRect(r));
  for (const r of plan.rooms) if (!r.reconstructed) regions.push({ id: `footprint:${r.id}`, kind: "room-floor", rect: claimed(r), walkable: false, roomId: r.id });
  regions.push({ id: "shared:ground-floor", kind: "shared-floor", rect: plan.frame, holes: plan.rooms.map(claimed), walkable: true });
  // 5. DOORWAY THRESHOLDS — registered LAST, so they claim only what nothing above them claimed.
  //
  //  Two different rects describe "where a room is": the shared floor's HOLE is `interiorRect(rect)` (the
  //  manifest rect shrunk by half a cell), while the room's walkable area is its own `floorRect`. Where a
  //  room's floorRect is INSET from that hole — the Gaming Room declares its floor at the inner wall faces,
  //  4.72 units inside the hole on its west side — the difference belongs to NO region at all: the hole
  //  excludes it from the shared floor, and the floorRect does not reach it. That ring is wall almost
  //  everywhere, so nothing noticed. At a DOORWAY it is the threshold, and it is a continuous unowned strip
  //  across the whole opening: measured at Gaming's west door, x 1119.28…1124 over the full z 720…752, which
  //  is why direct player movement could not enter the room while A* could. A* only ever samples cell
  //  CENTRES (1112 and 1128 here), and both of those fall outside the strip.
  //
  //  So a declared doorway says it is floor. The rect is the door's OWN `clearance.band` — the V1 '+' cells,
  //  already authored, already the definition of where the opening is — so no geometry is invented, no wall
  //  moves and no radius changes. Being a walkable REGION only answers "is this floor"; whether a body fits
  //  is still decided by the derived clearance field or the V1 grid exactly as before.
  for (const e of world.entities.values()) {
    const door = e.capabilities.door;
    if (!door) continue;
    regions.push({ id: `threshold:${e.id}`, kind: "room-floor", rect: door.clearance.band, walkable: true, roomId: e.roomId });
  }
  return regions;
}

export function registerGroundFloor(world: WorldState, plan: GroundFloor = groundFloor()): GroundFloor {
  world.bounds = plan.frame;
  for (const r of groundFloorRegions(plan, world)) world.addRegion(r);
  return plan;
}
