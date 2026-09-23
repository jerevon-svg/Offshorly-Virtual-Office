// vo3d rooms — MEETING ROOM definition (data only, WORLD coordinates).
//
// Phase 4B: architecture + furniture + materials + detail in one pass. The room is the WEST end of the
// front architectural bar: Meeting ← Reception → Project.
//
// Every number below is DERIVED, never invented:
//   • rect          → the READ-ONLY V1 asset manifest (x 8, z 863.21, 324.453 × 336.2)
//   • interior      → the V1 walkability grid: cols 5–15 × rows 60–69 is the ONLY walkable interior, so the
//                     north wall face is z 960 and the west wall face is x ≈ 22
//   • table/chairs  → the grid's blocked table block (cols 7–14 × rows 62–64) and its 'o' seat cells,
//                     cross-checked against the artwork (the two agree to within 2 units)
//   • façade plane  → FACADE_Z, shared with Reception and Project
//   • everything else → measured off src/assets/office/rooms/meeting-room.png at 0.125 units/px
//
// The flat PNG is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, type Rect } from "../core/coords";
import type { ApproachCapability, DoorCapability, Entity, RoomDef, SeatCapability } from "../world/WorldState";
import { CELL } from "../adapters/v1Grid";
import { v1RoomRect } from "../adapters/v1Manifest";
import { FACADE_Z } from "../adapters/v1Floor";
import { GATE, RECT as RECEPTION_RECT, STRUCT } from "./reception";
import { GROUND_ELEVATOR } from "./elevator";
import { kindFootprint } from "./footprint";

export const MEETING_ROOM_ID = "meeting-room";
export const RECT: Rect = v1RoomRect(MEETING_ROOM_ID); // x 8, z 863.21, w 324.453, d 336.2

/** The room's east limit for every piece of GEOMETRY it builds.
 *
 *  The art bounding box ends at 332.453 but Reception's rect starts at 332.33 — a 0.123-unit overlap that
 *  would leave two coplanar tiled floor slabs fighting along the whole seam. Meeting therefore stops at
 *  Reception's own west edge, exactly: the two floors meet, never overlap. The V1 grid is untouched. */
export const EAST_EDGE = RECEPTION_RECT.x; // 332.33

/** NORTH WALL — corrected in 4C.
 *
 *  4B read the artwork's cove wall as a solid MASS running from the room's art bounding box (z 863.21) all
 *  the way to z 960. That is 97 units of solid cream behind the chairs, and it is simply wrong: the depth
 *  in the flat render is the wall's own baked perspective, not its thickness. A wall is a wall.
 *
 *  So the wall is now a real 12-unit wall. Its inner (south) face sits at 948 rather than 960, which is
 *  what the removed mass gives back: the artwork paints ~12 units of clear floor between the chair backs
 *  and the wall, and that strip is what makes the north row's pull-out and the north circulation lane
 *  physically work. Furniture, the cove/LED design and the slat panel are all unchanged. */
export const WALL_T = 12;
/** ALIGNED TO RECEPTION. Reception's own north architectural line is its glass balustrade plane, GATE.z —
 *  the only wall-like element it builds at that end, and a measured V1-derived coordinate (rooms/reception).
 *  Both neighbours put their north wall's INNER face on exactly that line, so the three rooms end on one
 *  continuous architectural line instead of three arbitrary depths, and each gains its full usable depth. */
export const WALL_Z = GATE.z; // 890 — Reception's balustrade plane
export const WALL_OUTER_Z = WALL_Z - WALL_T; // 878
/** West wall face, measured off the art (the framed picture hangs on it at x 12…22). */
export const WEST_WALL_X = 22;

/** Walkable floor region. Generous on purpose: the V1 grid alone decides which cells are open (see
 *  nav/Walkability), and the region only has to CONTAIN them. It stops at the façade plane — Meeting has
 *  no street door in the grid, so nothing north of the sidewalk hands off to it.
 *  The EAST edge is left completely open: no wall, no region boundary trick — the tile simply runs on
 *  into Reception, which builds nothing at its own west edge (reception.test.ts locks that). */
export const FLOOR_RECT: Rect = { x: RECT.x, z: WALL_Z, w: EAST_EDGE - RECT.x, d: FACADE_Z - WALL_Z };
/** The tiled interior plate. It runs to the wall's OUTER face so the plate fills the ground floor's
 *  footprint hole completely (no void under the wall). tiledFloor() phases its grout to the WORLD, so this
 *  plate's grout lines continue Reception's without a seam no matter where the north wall sits. */
export const TILE_RECT: Rect = { x: FLOOR_RECT.x, z: WALL_OUTER_Z, w: FLOOR_RECT.w, d: FACADE_Z - WALL_OUTER_Z };

/** THE EAST GLAZED FRONTAGE onto Reception.
 *
 *  4B left this side completely open, because the production artwork paints no boundary there. It is now a
 *  real enclosure: a frameless glass partition on the shared line, with the room's entrance in it.
 *
 *  WHY 3 UNITS AND NOT THE 6 EVERY OTHER PARTITION USES. The partition has to live entirely inside
 *  Meeting's own footprint (nothing may cross into Reception — frontbar.test.ts locks that), so its
 *  thickness is taken off the room's east lane, and that lane is the only floor from which the kiosk is
 *  reachable: the terminal's walk-up cell (20, 65) holds a body of NAV_RADIUS only while the glass stays
 *  east of x 328. 3 gives it 1.3 units of margin; 6 would close the cell and take the terminal with it.
 *  It is also simply what a frameless interior screen is — the glazing, not the masonry. */
export const GLASS_T = 3;
/** the partition plane's centre line, and the inner (room-side) face derived from it */
export const EAST_GLASS_X = EAST_EDGE - GLASS_T / 2; // 330.83
export const EAST_GLASS_FACE = EAST_EDGE - GLASS_T; // 329.33

/** THE ENTRANCE. Placed in the NORTH third of the elevation, where both sides are open floor: Meeting's
 *  own east lane north of the kiosk, and — across the line — Reception's circulation band between the
 *  speed gates and the west lounge (whose sofa starts at z 949). 48 units of clear opening is two body
 *  widths, and the two 24-unit leaves park inside the run at either end rather than sliding past it.
 *  MIRRORED IN PROJECT about Reception's own composition axis, so the bar reads as one piece. */
export const DOOR = { z0: 914, z1: 962 };
export const DOOR_LEAF_W = (DOOR.z1 - DOOR.z0) / 2; // 24

/** MEETING'S PHYSICAL WALLS, as pure data for derived navigation (7C) — the same runs build/meeting.ts
 *  extrudes, as world rects. Solid north + solid west, glass south on the façade plane, and a GLAZED EAST
 *  frontage broken only by the entrance: the two runs below are the boundary, and the opening between them
 *  is the one way in. */
export const MEETING_WALLS: Rect[] = [
  { x: RECT.x, z: WALL_OUTER_Z, w: EAST_EDGE - RECT.x, d: WALL_T }, // north
  { x: RECT.x, z: WALL_Z, w: WEST_WALL_X - RECT.x, d: FACADE_Z - WALL_Z }, // west
  { x: WEST_WALL_X, z: FACADE_Z, w: EAST_EDGE - WEST_WALL_X, d: STRUCT.wallThickness }, // south façade glazing
  { x: EAST_GLASS_FACE, z: WALL_Z, w: GLASS_T, d: DOOR.z0 - WALL_Z }, // east glazing, north of the entrance
  { x: EAST_GLASS_FACE, z: DOOR.z1, w: GLASS_T, d: FACADE_Z - DOOR.z1 }, // east glazing, south of it
];

/** THE LIFT CORE'S WALLS, as this room's own solids.
 *
 *  The core is built into the room's north-west corner (rooms/elevator.ts CORE_LOCAL explains why that
 *  corner), so as far as this room's DERIVED navigation is concerned it is simply more wall: a body
 *  cannot walk into it, and the floor in front of it is the apron the call plate is pressed from. The
 *  rects come from the core's own spec — nothing is re-measured here, so the two can never disagree. */
export const MEETING_CORE_SOLIDS: Rect[] = GROUND_ELEVATOR.solids;

export const MEETING_ROOM: RoomDef = {
  id: MEETING_ROOM_ID,
  name: "Meeting Room",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: [...MEETING_WALLS, ...MEETING_CORE_SOLIDS],
  // no `shell`: ShellSpec describes the Design Room's arrangement. Meeting is solid north + solid west,
  // glass south and a glazed east frontage with its own entrance — its own static builder (build/meeting.ts).
};

// ============================= ARCHITECTURE =====================================================

/** The cream plaster wall that closes the north end, carrying the artwork's recessed LED cove on its
 *  south face. A REAL wall of WALL_T thickness — see WALL_Z for why 4B's solid mass was wrong. */
export const NORTH_WALL = { x0: RECT.x, x1: EAST_EDGE, z0: WALL_OUTER_Z, z1: WALL_Z, h: STRUCT.wallHeight };
/** West wall mass, from the north wall down to the façade. */
export const WEST_WALL = { x0: RECT.x, x1: WEST_WALL_X, z0: WALL_Z, z1: FACADE_Z, h: STRUCT.wallHeight };

/** THE WOOD-SLAT FEATURE PANEL IS GONE, and this note is what is left of it.
 *
 *  It was mounted on the north wall's south face at x 28…75 — which is inside the lift core's footprint
 *  (rooms/elevator.ts CORE_LOCAL: x 22…112, z 890…956). The core is built joinery standing on that wall,
 *  so the panel is not hidden by it, it is REPLACED by it. This is the one authored piece the lift
 *  displaced; the table, the chairs, the credenza, the west artwork, the kiosk, the glass walls and the
 *  glass entrance are all clear of it and are untouched. */

/** The painted bi-parting glass door in the street façade. It has NO '+' cells in the V1 grid, so it is
 *  reconstructed as STATIC glass for art fidelity only — see build/frontbar.ts facadeSection. */
export const FACADE_DOOR = { x0: 188, x1: 257 };

/** V2-LOCAL walkability addition (see nav/v2Open.ts): the strip the 4B wall mass used to swallow. It is
 *  real tiled floor between the corrected wall's inner face (948) and V1's own north lane (960), and the
 *  only thing standing on it is the west wall. Nothing else about the grid changes. */
export const NORTH_STRIP = {
  id: "meeting-north-strip",
  // …EAST OF THE LIFT CORE. The corner the core now stands in was part of this strip; what is left
  // of it is the floor between the core's east face and Reception's line, which is still real floor.
  rect: { x: GROUND_ELEVATOR.outer.x + GROUND_ELEVATOR.outer.w, z: WALL_Z, w: EAST_EDGE - (GROUND_ELEVATOR.outer.x + GROUND_ELEVATOR.outer.w), d: 60 * 16 - WALL_Z } as Rect, // up to V1's own lane at 960
  solids: [] as Rect[], // the west wall bounds the band rather than standing in it
};

// ============================= FURNITURE ========================================================

/** THE HERO: the conference table. The V1 grid blocks cols 7–14 × rows 62–64 exactly, and the artwork's
 *  top measures x 110.6…240 — the two agree, so the grid rect is used verbatim. */
export const TABLE: Rect = { x: 112, z: 992, w: 128, d: 48 };

/** Six green task chairs, three a side. The grid's 'o' seat cells sit at cols 8 / 10–11 / 13 and V1's
 *  seatDirections anchors them at x 128 / 176 / 216 — an uneven 48 / 40 pitch. The artwork puts them at
 *  136.6 / 175.2 / 214.8, i.e. evenly under the table's three modules, which is what reads correctly in
 *  3D. The SILHOUETTE follows the artwork (module centres) and the grid keeps deciding navigation; the
 *  largest deviation from a seat anchor is 5.3 units, well inside one V1 cell.
 *  North row z 976 (art 965.7…987.6); south row z 1050 (art 1033…1068 — tucked under the table edge). */
export const CHAIR_W = 30;
export const CHAIR_XS = [0, 1, 2].map((i) => TABLE.x + (TABLE.w * (i + 0.5)) / 3); // 133.33 / 176 / 218.67
export const CHAIR_ROWS = [
  { z: 976, facing: "south" as const }, // north row, looking south across the table
  { z: 1050, facing: "north" as const }, // south row, looking north
];

/** The self-service terminal on the east side. Dark totem head over a cream base cabinet, with a slatted
 *  plant wall to its west. Measured off the art; the grid blocks cols 16–19 × rows 61–69 around it. */
export const KIOSK = { x: 287.5, z: 1008, w: 30, d: 68, h: 32 };
export const KIOSK_BASE = { x: 272.6, z: 1042, w: 34.4, d: 63, h: 20 };
export const KIOSK_SLATS = { at: 272, from: 982, to: 1080, y0: 7, y1: 40 };

/** The tall dark-walnut unit against the west wall. The art reads it as a backboard carrying a framed
 *  poster and a wall tablet, with a credenza in front of it and objects on top. */
export const WEST_BACKBOARD = { x: 22, z: 992, w: 5, d: 112, h: 44 };
export const WEST_CREDENZA = { x: 27, z: 992, w: 25, d: 112, h: 26, modules: 4 };
/** THE FRAMED ARTWORK ON THE WEST WALL IS GONE, and this is what is left of it.
 *
 *  It hung at z 962…990 on the wall's inner face — inside the lift core's footprint once the core was
 *  turned to face east and grew south to take the room's unused north-west corner (rooms/elevator.ts
 *  CORE_LOCAL: x 22…90, z 890…984). The core is built joinery standing on that wall, so the picture is
 *  not hidden by it, it is REPLACED by it. With the wood-slat panel, that is the whole of what the lift
 *  displaced: the table, the chairs, the credenza, the terminal, the glass enclosure and the glass
 *  entrance are all clear of it and untouched.
 *
 *  The span is KEPT as a constant because the west wall's cornice still has to route around what stands
 *  on that elevation, and the core occupies exactly this stretch of it (build/meeting.ts). */
export const WEST_FRAME = { z0: 890, z1: 984, y0: 16, y1: 44 };
/** the two screens on the backboard's east face */
export const WEST_POSTER = { z0: 998, z1: 1016, y0: 28, y1: 42 };
export const WEST_TABLET = { z0: 1026, z1: 1050, y0: 24, y1: 40 };

/** Exterior planters standing on the shared front ledge, south of the façade (art x ≈ 36…63 and
 *  139…169, pulled north out of the render's baked southward projection onto the ledge itself). */
export const LEDGE_PLANTERS = [
  { x: 50, z: 1143, r: 12, h: 22 },
  { x: 154, z: 1143, r: 12, h: 22 },
];

// ============================= ENTITIES =========================================================

function furnitureEntity(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, tone?: string): Entity {
  return {
    id: `${MEETING_ROOM_ID}/${id}`,
    kind,
    roomId: MEETING_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    // no navBlocker: the V1 grid already blocks these cells and stays the single source of truth
    capabilities: {},
    props: { w, d, facing, mirrored: false, ...(tone ? { tone } : {}) },
  };
}

function plantEntity(id: string, x: number, z: number, r: number, h: number, y = 0, lush?: number, pot = true): Entity {
  return {
    id: `${MEETING_ROOM_ID}/${id}`,
    kind: "plant",
    roomId: MEETING_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    // 7B: a plant standing ON THE FLOOR is a logical obstacle; one on a shelf or in a planter box is not.
    // Radius is the pot, not the canopy — a body brushes past leaves. Inert until this room runs derived
    // navigation; authored now so the rollout is one less thing to remember.
    footprint: y === 0 ? { shape: "circle", r: r * 0.9 } : undefined,
    capabilities: { sway: true },
    props: { r, h, hanging: false, y, ...(lush ? { lush } : {}), ...(pot ? {} : { pot: false }) },
    source: { baked: true },
  };
}

/** Meeting's furniture and planting as world entities, so Phase 4C can hang seat/approach capabilities off
 *  them without touching geometry. Architecture, the kiosk and the credenza run are static
 *  (build/meeting.ts) — exactly the split Reception uses. */
export function meetingRoomEntities(): Entity[] {
  const out: Entity[] = [
    furnitureEntity("conference-table", "conference-table", TABLE.x + TABLE.w / 2, TABLE.z + TABLE.d / 2, TABLE.w, TABLE.d, "north"),
  ];
  for (const row of CHAIR_ROWS)
    CHAIR_XS.forEach((x, i) => out.push(furnitureEntity(`chair-${row.facing}-${i}`, "chair-b", x, row.z, CHAIR_W, CHAIR_W, row.facing)));
  // planting: two floor plants flanking the west unit, two on the credenza top, and the ledge palms
  // MOVED 4 EAST AND SLIMMED, to stand beside the lift's doors instead of in front of them: the core
  // (rooms/elevator.ts) opens onto this corner and its approach lane runs where the pot used to be.
  // MOVED OUT OF THE LIFT'S CORNER — and out of the north strip as well. The core occupies the whole of
  // the room's north-west corner, and the strip in front of its doors is both the boarding lane and the
  // room's own north circulation (NORTH_STRIP): a pot standing anywhere in it closes a cell that the
  // retired open-band evidence says is real floor. It joins the other west-side planting instead.
  out.push(plantEntity("plant-nw", 72, 1086, 9, 28));
  out.push(plantEntity("plant-sw", 36, 1112, 9, 22));
  out.push(plantEntity("plant-credenza-0", 40, 1066, 7.5, 17, WEST_CREDENZA.h));
  out.push(plantEntity("plant-credenza-1", 40, 1090, 5.5, 12, WEST_CREDENZA.h));
  out.push(plantEntity("plant-kiosk-0", 264, 1000, 5, 13, 22));
  out.push(plantEntity("plant-kiosk-1", 264, 1062, 5, 13, 14));
  LEDGE_PLANTERS.forEach((p, i) => out.push(plantEntity(`ledge-palm-${i}`, p.x, p.z, 11, 26, p.h - 1.5, 1.5, false)));
  return withMeetingInteractions(out);
}

// ============================= 4C GAMEPLAY ======================================================
// Nothing below changes a single piece of 4B geometry. Every approach and stand point is a REAL
// V1-walkable cell, and the chairs reuse the Design Room's MOVABLE seat pattern unchanged.

/** The V1 stand-here cells authored for this table: cols 7 / 11 / 14 on rows 60 and 66. They are kept as
 *  the room's authored seating intent, and the south row's chairs still sit square on them. */
export const STAND_XS = [7, 11, 14].map((c) => c * CELL + CELL / 2); // 120 / 184 / 232
export const STAND_Z = { north: 60 * CELL + CELL / 2, south: 66 * CELL + CELL / 2 }; // 968 / 1064

/** Chair-b geometry, taken from the builder so the metadata can never drift from the mesh: seat pan at 13,
 *  cushion 3.4 tall based at seatH-2 → cushion TOP at 14.4 (the figure the Design Room chair uses too). */
export const CHAIR_CUSHION_TOP = 14.4;
/** the chair-b silhouette is ~13 deep from its centre (five legs at 0.97 × 12.48, plus a caster) */
const CHAIR_R = 13;

/** THE PULL-OUT, and how far each row can actually go.
 *
 *  SOUTH row: 55 units of open circulation behind it, so it takes the Design Room's full gesture — the
 *  chair rolls 20 units clear of the table and the sitter steps into the gap it leaves.
 *  NORTH row: the corrected 12-unit wall gives the room back the strip 4B's mass had swallowed, so there
 *  are now 28 units between the wall face (948) and the chair front. The chair rolls 12 units back into
 *  that strip — visibly, and without ever touching the wall (its backrest reaches 951).
 *
 *  Neither row is approached from directly behind: a 21-unit body does not fit behind a 26-deep chair in
 *  a 28-unit strip. The sitter walks the aisle, stops BESIDE the chair, the chair rolls back, and the
 *  sitter steps across into the gap — which is how you actually sit at a conference table. */
export const CHAIR_PULL = { north: 12, south: 20 };
/** where the sitter stands beside each chair before pulling it: a real cell centre, clear of the chair */
const APPROACH_XS = [6, 9, 15].map((c) => c * CELL + CELL / 2); // 104 / 152 / 248
const APPROACH_Z = { north: 59 * CELL + CELL / 2, south: 68 * CELL + CELL / 2 }; // 952 (opened) / 1096

function chairSeat(i: number, row: "north" | "south"): SeatCapability {
  const cx = CHAIR_XS[i];
  const cz = CHAIR_ROWS[row === "north" ? 0 : 1].z;
  const dir = row === "north" ? -1 : 1;
  const pull = CHAIR_PULL[row];
  const ax = APPROACH_XS[i];
  // in the gap the pulled chair leaves, between it and the table
  const seatFrom = { x: cx, z: row === "north" ? cz + 8 : cz - 2 };
  return {
    approach: { x: ax, z: APPROACH_Z[row] },
    preSeat: seatFrom,
    approachToSeat: [{ x: ax, z: seatFrom.z }, seatFrom],
    pullDir: { x: 0, z: dir },
    pullDistance: pull,
    seatedTuck: 7, // the chair tucks back in under the sitter, exactly as the Design Room's does
    cushionTopY: CHAIR_CUSHION_TOP,
    cushionLocal: { x: 0, z: 0.3 },
    sitDepth: 3.5,
    seatedYaw: row === "north" ? FACING_YAW.south : FACING_YAW.north,
    timings: { pullMs: 800, sitMs: 650, slideMs: 700, standMs: 650, returnMs: 800 },
  };
}
export const chairId = (row: "north" | "south", i: number): string => `${MEETING_ROOM_ID}/chair-${row === "north" ? "south" : "north"}-${i}`;
/** the six conference chairs, north row first — ids match the entities built in 4B */
export const MEETING_CHAIR_IDS = (["north", "south"] as const).flatMap((row) => [0, 1, 2].map((i) => chairId(row, i)));

/** the clearance the pulled chair keeps from the wall / the south circulation strip (tests read this) */
export const CHAIR_CLEARANCE = {
  northBackAtFullPull: CHAIR_ROWS[0].z - CHAIR_PULL.north - CHAIR_R, // 951, wall face is 948
  southFrontAtFullPull: CHAIR_ROWS[1].z + CHAIR_PULL.south + CHAIR_R, // 1083, façade is 1120
};

// ---- the east self-service terminal ------------------------------------------------------------
/** Walk-up point for the terminal: the open floor east of the kiosk's base cabinet, in cell (20, 65).
 *
 *  CENTRED IN THE LANE RATHER THAN ON THE CELL, and the east glazing is why. 4C put this point on the cell
 *  centre (328, 1048), which left 21 units of clearance to the cabinet's east face at x 307 and nothing at
 *  all to the east, because the room had no east boundary. It has one now, and the lane between the
 *  cabinet and the glass is 22.3 wide — a 21-unit body fits in it exactly once, centred. So the point
 *  moves 10 units west onto the lane's own centre line: 11.0 clear of the cabinet, 11.3 clear of the
 *  glass. It is the same cell, the same machine and the same facing; only the sub-cell position changed,
 *  which is precisely the freedom derived navigation already gives every stand point (nav/derived pointOf).
 *
 *  The alternative was to move the kiosk, and the kiosk is the room's authored composition. */
export const KIOSK_APPROACH: ApproachCapability = {
  point: { x: 318, z: 65 * CELL + CELL / 2 }, // (318, 1048)
  yaw: FACING_YAW.west,
  label: "Meeting room terminal",
  action: "Use terminal",
};
export const KIOSK_INTERACTION_ID = `${MEETING_ROOM_ID}/kiosk-interaction`;

/** Proximity volume for the terminal's BLUE→GREEN status light. Read-only: it drives a colour, never
 *  navigation, geometry or the grid — exactly like Reception's gate and entrance scanners. */
export const KIOSK_SCANNER_ID = "meeting-kiosk";
export const KIOSK_ZONE: Rect = { x: 308, z: 1022, w: 38, d: 66 };

// ---- the east entrance ------------------------------------------------------------------------
/** Bi-parting glass on the SAME SlidingDoor controller Reception's, Executive's, CMS's and QA's entrances
 *  run on: the north panel drives and the south one is its `opposed` mirror, so both derive from one `t`
 *  and neither can drift. AUTOMATIC, so navigation models it PARKED and the room can never seal itself
 *  (see DoorCapability.automatic). */
export const DOOR_LEAF_CLOSED = {
  north: { x: EAST_GLASS_X, z: DOOR.z0 + DOOR_LEAF_W / 2 }, // 926
  south: { x: EAST_GLASS_X, z: DOOR.z1 - DOOR_LEAF_W / 2 }, // 950
};
export const DOOR_NORTH_ID = `${MEETING_ROOM_ID}/entry-door-north`;
export const DOOR_SOUTH_ID = `${MEETING_ROOM_ID}/entry-door-south`;
const BODY_RADIUS = 10.5; // Bon's widest walking extent, as every other V2 door measures it

export const ENTRY_DOOR: DoorCapability = {
  slide: { x: 0, z: -1 },
  slideDistance: DOOR_LEAF_W,
  automatic: true,
  leaf: { x: EAST_GLASS_FACE, z: DOOR.z0, w: GLASS_T, d: DOOR_LEAF_W },
  leafOpposed: { x: EAST_GLASS_FACE, z: DOOR.z0 + DOOR_LEAF_W, w: GLASS_T, d: DOOR_LEAF_W },
  /** the doorway itself: while a body overlaps this the door must be open and may not close */
  crossing: { x: EAST_GLASS_X - 12, z: DOOR.z0 - 4, w: 24, d: DOOR.z1 - DOOR.z0 + 8 },
  /** both approach aprons — the room's east lane inside and Reception's circulation band outside */
  trigger: { x: EAST_GLASS_X - 74, z: DOOR.z0 - 40, w: 148, d: DOOR.z1 - DOOR.z0 + 80 },
  clearance: {
    bodyRadius: BODY_RADIUS,
    band: { x: EAST_EDGE - CELL, z: DOOR.z0, w: 2 * CELL, d: DOOR.z1 - DOOR.z0 },
    solids: [], // nothing stands in the opening: the jambs are the reveal's own posts
  },
  timings: { openMs: 900, closeMs: 1100, holdMs: 700 },
};

/** The two leaves as world entities, so SceneMirror gives each a view the door controller can slide. */
function entryDoorEntities(): Entity[] {
  const leaf = { kind: "glass-door-leaf", roomId: MEETING_ROOM_ID, source: { baked: true } as const };
  return [
    {
      ...leaf, id: DOOR_NORTH_ID,
      transform: { pos: { ...DOOR_LEAF_CLOSED.north }, yaw: -Math.PI / 2 },
      capabilities: { door: ENTRY_DOOR },
      props: { w: DOOR_LEAF_W, h: STRUCT.wallHeight, handle: 1 }, // handle on the leading (south) stile
    },
    {
      ...leaf, id: DOOR_SOUTH_ID,
      transform: { pos: { ...DOOR_LEAF_CLOSED.south }, yaw: -Math.PI / 2 },
      capabilities: {},
      props: { w: DOOR_LEAF_W, h: STRUCT.wallHeight, handle: -1 },
    },
  ];
}

function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: MEETING_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** 4C: attach the movable seat capability to the six chairs and add the terminal's walk-up point.
 *  Called by meetingRoomEntities — geometry, ids and transforms are untouched. */
export function withMeetingInteractions(entities: Entity[]): Entity[] {
  for (const row of ["north", "south"] as const)
    for (let i = 0; i < 3; i++) {
      const e = entities.find((x) => x.id === chairId(row, i));
      if (!e) throw new Error(`meeting: no chair entity ${chairId(row, i)}`);
      e.capabilities = { ...e.capabilities, seat: chairSeat(i, row) };
    }
  entities.push(approachEntity(KIOSK_INTERACTION_ID, "meeting-kiosk-assembly", KIOSK_APPROACH));
  entities.push(...entryDoorEntities());
  return entities;
}
