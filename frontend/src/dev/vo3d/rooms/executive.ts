// vo3d rooms — EXECUTIVE ROOM definition (data only, WORLD coordinates).
//
// Phase 7. The north-centre room of the ground floor, between the AI room (ends x 343.9) and the Dev room
// (starts x 1111.1). ONE entrance: a bi-parting glass door in the south wall onto the hall.
//
// Every number below is DERIVED, never invented:
//   • rect     → the READ-ONLY V1 asset manifest (x 493.7, z 8, 465 × 305.19)
//   • door     → the grid's '+' cells, cols 43–47 × rows 18–19, with 's' stands at row 17 / row 20
//   • seats    → data/seatDirections.ts "executive-team", whose nineteen entries ARE the room's
//                composition: two executive chairs at (588.41|864.22, 91.68) facing south, four visitors
//                each at z 162.22, two three-place sofas facing each other at x 680 / 769.78, armchairs
//                at (726.20, 158.69) and (726.20, 254.84), and the SE workstation at (880.95, 258.18)
//   • everything else → measured off the Executive Room V1 reference at 0.739 units/px in x, 0.725 in z
//
// The flat reference is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, DoorCapability, Entity, LoungeSeatSlot, RoomDef, SeatCapability } from "../world/WorldState";
import type { MatKey } from "../render/Materials";
import { CELL } from "../adapters/v1Grid";
import { v1RoomRect } from "../adapters/v1Manifest";
import { STRUCT } from "./reception";
import { SOFA_ARM_W, SOFA_CUSHION_GAP, SOFA_CUSHION_LOCAL_X, SOFA_CUSHION_MARGIN, SOFA_CUSHION_TOP, sofaCushionZ } from "../build/furniture";
import { EXEC_CHAIR, EXEC_LOUNGE_CHAIR, EXEC_TASK_CHAIR, EXEC_VISITOR } from "../build/exec-furniture";
import { kindFootprint } from "./footprint";

export const EXECUTIVE_ROOM_ID = "executive-room";
export const RECT: Rect = v1RoomRect(EXECUTIVE_ROOM_ID); // x 493.7, z 8, w 465, d 305.19

// ============================= THEME ============================================================
/** ROOM-LEVEL COLOUR TABLE, the same seam the Gaming Room and the Central Hub use: no builder in this
 *  room names a palette key directly, so re-skinning the executive suite is one object, not forty
 *  literals. The brief is PREMIUM, not corporate: dark stained walnut, warm plaster, cream upholstery,
 *  one olive accent on the lounge chairs and brass on the awards. */
export const THEME = {
  /** desks, cabinetry, the media console, the north feature wall */
  wood: "execWalnut",
  /** their reveals, grooves and backing boards */
  woodDark: "execWalnutDark",
  /** walls */
  plaster: "plaster",
  /** sofa upholstery + its cushions */
  upholstery: "execCream",
  upholsterySeat: "execCreamSeat",
  /** the two lounge armchairs — the room's one colour accent */
  accent: "execOlive",
  /** leather: executive chairs, visitor chairs, the workstation chair */
  leather: "execLeather",
  /** award metal, cabinet hardware, the display-wall trim */
  brass: "execBrass",
  /** every rug in the room */
  rug: "execRug",
} satisfies Record<string, MatKey>;

// ============================= ARCHITECTURE =====================================================
// THE SAME CORRECTION GAMING MADE IN 5A. V1 blocks a 64-unit band across the whole north of this room and
// a further row in the centre. None of it is wall: it is the flat render's baked perspective plus the
// clearance V1 painted around the display wall standing there. Rebuilt as mass it would eat the room's
// main east–west circulation lane and shove the media wall four feet into the room.
//
// So every wall here is a REAL 12-unit wall sitting on the art bounding box, the display wall is real
// furniture with a real footprint, and navigation comes from that geometry (DERIVED_ROOM_IDS) rather than
// from the painting. The V1 grid file itself is untouched.
export const WALL_T = 12;
export const NORTH_OUTER_Z = 8, NORTH_Z = 20;
export const SOUTH_Z = 301, SOUTH_OUTER_Z = 313;
export const WEST_OUTER_X = 494, WEST_X = 506;
export const EAST_X = 946, EAST_OUTER_X = 958;

/** The composition axis. V1's own seat table is symmetric about it to a fifth of a unit (the two
 *  executive chairs at 588.41 / 864.22 average 726.315, the two sofa runs 724.89), and the reference's
 *  whole identity is that symmetry — so every mirrored piece is placed with `mirrorX`, never re-measured. */
export const AXIS = 726.2;
export const mirrorX = (x: number): number => 2 * AXIS - x;

/** The V1 '+' door band, cols 43–47 × rows 18–19. The wall opening is exactly this span and NOTHING may
 *  stand inside it. Production draws the entrance as TWO leaves (manifest: executive-door-left /
 *  executive-door-right), so it is rebuilt bi-parting on Reception's own entrance controller. */
export const DOOR = { x0: 688, x1: 768 };
/** V1's own authored stand cells either side of it: row 17 (inside) and row 20 (hall). */
export const DOOR_STANDS = { inside: { x: 728, z: 280 }, outside: { x: 728, z: 328 } };

/** Walkable floor region: inside all four walls. 440 × 281. */
export const FLOOR_RECT: Rect = { x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z };
/** The tiled plate, run to the walls' OUTER faces so no void is left under them. Grout stays phased to the
 *  WORLD by tiledFloor(), so this floor reads continuous with the hall through the doorway. */
export const TILE_RECT: Rect = { x: WEST_OUTER_X, z: NORTH_OUTER_Z, w: EAST_OUTER_X - WEST_OUTER_X, d: SOUTH_OUTER_Z - NORTH_OUTER_Z };

export const NORTH_WALL = { x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: NORTH_Z, h: STRUCT.wallHeight };
export const WEST_WALL = { x0: WEST_OUTER_X, x1: WEST_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
export const EAST_WALL = { x0: EAST_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
/** SOUTH FAÇADE. The reference glazes the whole south elevation — the executive suite looks out over the
 *  hall — with the entrance centred in it. Built as a framed glass run in two spans either side of the
 *  V1 door band, over a low solid spandrel so the hall floor is never seen through the glass at ankle
 *  height. Nothing is declared inside the band. */
export const SOUTH_GLASS = {
  z0: SOUTH_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight,
  spandrel: 9, //  shoe height: enough to read as architecture, low enough to stay under every sightline
  panelPitch: 46,
};

// ============================= NORTH DISPLAY WALL ===============================================
/** The wood feature wall between the two award cabinets: a vertical batten panel carrying the display. */
export const FEATURE_WALL = { x0: 650, x1: mirrorX(650), y0: 0, y1: STRUCT.wallHeight };
/** The large centred display. Its width comes from the reference (0.215 of the room), its height from the
 *  46-unit wall: a 96-wide 16:9 set would be 54 tall and go straight through the ceiling, so this is the
 *  cinema-ratio panel the reference actually paints. */
export const TV = { cx: AXIS, w: 96, h: 34, y0: 8 };
/** The long low media console under it. */
export const MEDIA_CONSOLE: Rect & { h: number; modules: number } = { x: AXIS - 70, z: 22, w: 140, d: 28, h: 22, modules: 4 };
/** The symmetrical award cabinetry. Three lit glass shelves in a walnut carcass, one run each side. */
export const CABINET_L: Rect & { h: number; shelves: number } = { x: 528, z: NORTH_Z, w: 122, d: 26, h: 42, shelves: 3 };
export const CABINET_R: Rect & { h: number; shelves: number } = { ...CABINET_L, x: mirrorX(CABINET_L.x + CABINET_L.w) };

// ============================= EXECUTIVE DESKS ==================================================
/** The two large walnut desks. z is pinned between V1's own seat rows: the executive chair sits at
 *  z 91.68 and the visitor row at 162.22, so the desk has to live in the 40 units between them. */
export const DESK_L: Rect & { h: number } = { x: 533.89, z: 108, w: 109.03, d: 42, h: 26 };
export const DESK_R: Rect & { h: number } = { ...DESK_L, x: mirrorX(DESK_L.x + DESK_L.w) };
/** V1 seat cells: the executive chairs (facing "front" = south, into the room). */
export const EXEC_CHAIRS = [
  { id: "exec-chair-left", x: 588.41, z: 91.68, size: 26 },
  { id: "exec-chair-right", x: 864.22, z: 91.68, size: 26 },
];
/** V1 seat cells: four visitors per desk, facing "back" = north, at the desks' south edge. The 24.63 pitch
 *  is V1's, so the chairs are 22 wide — anything wider and neighbours interpenetrate. */
export const VISITOR_Z = 162.22;
export const VISITOR_W = 20, VISITOR_D = 23; // V1 exec-visitor-chair art box: 19.83 × 22.88
export const VISITORS_L = [551.46, 576.09, 600.72, 625.35];
export const VISITORS_R = [827.26, 851.90, 876.53, 901.16];
/** rugs under each desk group */
export const RUG_L: Rect = { x: 524, z: 76, w: 128, d: 112 };
export const RUG_R: Rect = { ...RUG_L, x: mirrorX(RUG_L.x + RUG_L.w) };

// ============================= CENTRE LOUNGE ====================================================
/** V1 puts three seat cells on each sofa at a 27.11 pitch, so the run's LENGTH is derived from the
 *  builder's own cushion arithmetic rather than measured off the reference — the cushions then land on
 *  V1's cells exactly. */
export const SOFA_SEATS = 3, SOFA_PITCH = 27.11, SOFA_DEPTH = 25.33; // V1 white-sofa box is 25.33 deep
export const SOFA_CUSH_D = SOFA_PITCH - SOFA_CUSHION_GAP;
export const SOFA_LEN = SOFA_SEATS * SOFA_CUSH_D + (SOFA_SEATS - 1) * SOFA_CUSHION_GAP + 2 * SOFA_CUSHION_MARGIN + 2 * SOFA_ARM_W;
export const LOUNGE_Z = 205.33; // the middle cushion of both runs
/** A sofa's BODY centre is its cushion line pulled back by the builder's cushion offset, so the seat
 *  cells (x 680 west, 769.78 east) are where a sitter actually lands. */
export const SOFA_W_SPEC = { id: "sofa-west", cushionX: 680, x: 680 - SOFA_CUSHION_LOCAL_X, z: LOUNGE_Z, mirrored: false };
export const SOFA_E_SPEC = { id: "sofa-east", cushionX: 769.78, x: 769.78 + SOFA_CUSHION_LOCAL_X, z: LOUNGE_Z, mirrored: true };
/** The two opposing armchairs, at V1's own cells. The SIZE is set by circulation, not by the reference:
 *  34 wide is the widest that still leaves an 8-unit body a lane down EACH side of the lounge pocket, and
 *  32 deep is what keeps the south chair clear of V1's own inside-the-door stand cell at z 280. A lounge
 *  you cannot walk into is a picture of a lounge. */
export const ARMCHAIR_W = 28, ARMCHAIR_D = 30;
export type ArmchairSpec = { id: string; x: number; z: number; facing: "north" | "south"; yaw: number };
export const ARMCHAIR_N: ArmchairSpec = { id: "armchair-north", x: AXIS, z: 158.69, facing: "south", yaw: FACING_YAW.south };
export const ARMCHAIR_S: ArmchairSpec = { id: "armchair-south", x: AXIS, z: 254.84, facing: "north", yaw: FACING_YAW.north };
/** The long central coffee table, between the sofa fronts and between the two armchairs. */
// V1's "center-desk" box is 709.29, 179.01, 33.82 × 56.85 — but its flat box butts straight into both
// lounge chairs, which the reference render clearly does not. Narrowed 4 units (so a body clears BOTH
// side lanes) and shortened 11 (so the chairs stand off it), centred on the composition axis.
export const COFFEE_TABLE: Rect = { x: AXIS - 15, z: 185, w: 30, d: 46 };
/** V1's FOUR small planters, one at each corner of the sofa pair (manifest: plant-small ×4 at
 *  671.14/762.61 × 152.32/245.60, 14.34 × 16.55). Nudged just clear of the sofa ends, which V1's flat
 *  boxes overlap because the painting draws them in front. These are the dark round pots the close
 *  reference shows — they replace the generic side tables an earlier pass put here. */
export const PLANTERS = [
  { id: "planter-nw", x: 680, z: 150, r: 7.2 },
  { id: "planter-ne", x: 769.78, z: 150, r: 7.2 },
  { id: "planter-sw", x: 680, z: 261, r: 7.2 },
  { id: "planter-se", x: 769.78, z: 261, r: 7.2 },
];
export const RUG_C: Rect = { x: 654, z: 134, w: 144, d: 146 };

// ============================= SOUTH ============================================================
/** Bottom-left display credenza: V1's own "bottom-left-desk" box (530.19, 257.89, 80.44 × 36.38). */
export const CREDENZA_SW: Rect & { h: number; modules: number } = { x: 530.19, z: 258, w: 80.44, d: 36, h: 26, modules: 3 };
/** Bottom-right HUMAN RESOURCES workstation, rebuilt from V1's three separated assets: the long desk
 *  (hr-ldesk, 830.99 × 246.61, 82.89 × 48.48), its short return (hr-sdesk, 832.05 × 223.97, 87.91 ×
 *  24.97) and the floor mat under both (hr-floormat, verbatim). V1's flat boxes overlap each other and
 *  the chair because the painting stacks them in perspective; the physical reading puts the work surface
 *  in the southern half of the long box, the return in the northern one, and V1's own seat cell between. */
export const DESK_SE: Rect & { h: number } = { x: 831, z: 272, w: 83, d: 26, h: 24 };
export const RETURN_SE: Rect & { h: number; modules: number } = { x: 832, z: 218, w: 88, d: 24, h: 24, modules: 3 };
export const WORKSTATION_CHAIR = { id: "workstation-chair", x: 880.95, z: 258.18, size: 26 };
export const MAT_SE: Rect = { x: 828.37, z: 229.32, w: 93.92, d: 68.95 };

// ============================= PLANTING =========================================================
/** Tall plants in the north corners, as the reference has them, plus one pair softening the lounge's
 *  south corners. Every one of them stands where no lane runs. */
//  HEIGHT IS CAPPED BY THE CEILING, not chosen. build/plants' large tier throws its canopy about 1.56×
//  its nominal height, so a 42-tall "tall plant" tops out at 65 and stands straight through a 46-unit
//  wall — invisible from the isometric camera and impossible to miss at eye level. 28 is the tallest
//  that still finishes under the wall head.
export const PLANTS = [
  { id: "plant-nw", x: 518, z: 36, r: 10, h: 28 },
  { id: "plant-ne", x: mirrorX(518), z: 36, r: 10, h: 28 },
  { id: "plant-sw", x: 518, z: 246, r: 9, h: 26 },
  { id: "plant-se", x: 812, z: 282, r: 8, h: 24 },
];

// ============================= WALLS AS DATA ====================================================
/** THE ROOM'S PHYSICAL WALLS for derived navigation (nav/solids.ts) — the same runs build/executive.ts
 *  extrudes, as world rects. The V1 '+' door band is the ONE gap and nothing is declared inside it. */
export const EXECUTIVE_WALLS: Rect[] = [
  { x: NORTH_WALL.x0, z: NORTH_WALL.z0, w: NORTH_WALL.x1 - NORTH_WALL.x0, d: NORTH_WALL.z1 - NORTH_WALL.z0 },
  { x: WEST_WALL.x0, z: WEST_WALL.z0, w: WEST_WALL.x1 - WEST_WALL.x0, d: WEST_WALL.z1 - WEST_WALL.z0 },
  { x: EAST_WALL.x0, z: EAST_WALL.z0, w: EAST_WALL.x1 - EAST_WALL.x0, d: EAST_WALL.z1 - EAST_WALL.z0 },
  { x: WEST_OUTER_X, z: SOUTH_Z, w: DOOR.x0 - WEST_OUTER_X, d: SOUTH_OUTER_Z - SOUTH_Z },
  { x: DOOR.x1, z: SOUTH_Z, w: EAST_OUTER_X - DOOR.x1, d: SOUTH_OUTER_Z - SOUTH_Z },
];

/** The FIXED fit-out — cabinetry, console, desks, credenza, storage. Drawn by build/executive.ts and
 *  registered as footprint-only entities so derived navigation sees exactly what the camera does. */
export const EXECUTIVE_SOLIDS: (Rect & { id: string })[] = [
  { id: "cabinet-left", ...rectOf(CABINET_L) },
  { id: "cabinet-right", ...rectOf(CABINET_R) },
  { id: "media-console", ...rectOf(MEDIA_CONSOLE) },
  { id: "desk-left", ...rectOf(DESK_L) },
  { id: "desk-right", ...rectOf(DESK_R) },
  { id: "credenza-sw", ...rectOf(CREDENZA_SW) },
  { id: "desk-se", ...rectOf(DESK_SE) },
  { id: "return-se", ...rectOf(RETURN_SE) },
];
function rectOf(r: Rect): Rect {
  return { x: r.x, z: r.z, w: r.w, d: r.d };
}

export const EXECUTIVE_ROOM: RoomDef = {
  id: EXECUTIVE_ROOM_ID,
  name: "Executive Room",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: EXECUTIVE_WALLS,
  // no `shell`: solid north/east/west plus a glazed south façade with a bi-parting entrance — its own
  // static builder, exactly as Reception, Gaming and the Central Hub do.
};

// ============================= INTERACTIONS =====================================================
// Nothing below adds geometry or a new system. Movable chairs use SeatCapability, fixed lounge seating
// uses LoungeSeatCapability, walk-ups use ApproachCapability and the entrance uses the SAME bi-parting
// SlidingDoor Reception drives. Every `approach` is a real, body-clear point on the derived floor.

/** The executive chairs' own cushion planes, read straight off build/exec-furniture so the seat data and
 *  the meshes can never drift. They are NOT the shared task-chair numbers — these are different chairs. */
export const CHAIR_CUSHION_TOP = EXEC_CHAIR.cushionTop;
/** How far a chair rolls back off the desk, and where the sitter stands once it has. */
export const CHAIR_PULL = 11;

function deskChairSeat(chair: { x: number; z: number }, approach: Vec2, preSeatZ: number, metrics = EXEC_CHAIR): SeatCapability {
  const preSeat: Vec2 = { x: chair.x, z: preSeatZ };
  return {
    approach,
    preSeat,
    approachToSeat: [{ x: approach.x, z: preSeatZ }, preSeat],
    pullDir: { x: 0, z: -1 }, // back off the desk, into the room
    pullDistance: CHAIR_PULL,
    seatedTuck: 7,
    cushionTopY: metrics.cushionTop,
    cushionLocal: { x: 0, z: metrics.cushionLocalZ },
    sitDepth: 3.5,
    seatedYaw: FACING_YAW.south, // every desk in this room is south of its chair
    timings: { pullMs: 860, sitMs: 650, slideMs: 760, standMs: 650, returnMs: 860 },
  };
}

/** The two executive chairs. Their stand points sit in the wide north lane between the display wall and
 *  the desks, offset in x so the body never stands where the chair rolls to. */
export const EXEC_SEATS: SeatCapability[] = [
  deskChairSeat(EXEC_CHAIRS[0], { x: 540, z: 84 }, 100),
  deskChairSeat(EXEC_CHAIRS[1], { x: mirrorX(540), z: 84 }, 100),
];
/** The HR workstation chair. Its desk group is an L — the long desk south of it and the return north —
 *  so the only free side is the WEST, which is where the stand point goes. */
export const WORKSTATION_SEAT: SeatCapability = deskChairSeat(WORKSTATION_CHAIR, { x: 816, z: 258 }, 266, EXEC_TASK_CHAIR);

export const execChairId = (i: number): string => `${EXECUTIVE_ROOM_ID}/${EXEC_CHAIRS[i].id}`;
export const EXEC_CHAIR_IDS = EXEC_CHAIRS.map((_, i) => execChairId(i));
export const WORKSTATION_CHAIR_ID = `${EXECUTIVE_ROOM_ID}/${WORKSTATION_CHAIR.id}`;
/** every MOVABLE chair in the room, in GUI order */
export const EXECUTIVE_SEAT_IDS = [...EXEC_CHAIR_IDS, WORKSTATION_CHAIR_ID];

// ---- FIXED lounge seating -----------------------------------------------------------------------
/** 1.5 forward of the cushion centre: the sitter lands ON the cushion instead of wedged into the back. */
const SOFA_CONTACT_FORWARD = 1.5;
/** The clear lane down each side of the coffee table, between it and the sofa in front of it. This is
 *  where you stand to sit down, and — at 23 and 21 units — it is also the lounge's circulation: the
 *  pocket can be walked end to end on both sides, which is the whole reason the table was narrowed a
 *  few units off V1's flat "center-desk" box. */
const LANE_WEST = 699, LANE_EAST = 752;

function sofaSlots(spec: typeof SOFA_W_SPEC, side: "west" | "east"): LoungeSeatSlot[] {
  const m = side === "west" ? 1 : -1; // furniture-local +x → world +x (west sofa) or −x (east, mirrored)
  const lane = side === "west" ? LANE_WEST : LANE_EAST;
  return [0, 1, 2].map((i) => {
    const lz = sofaCushionZ(i, SOFA_SEATS, SOFA_CUSH_D);
    const worldZ = spec.z + m * lz;
    return {
      id: `${spec.id}-${["north", "centre", "south"][side === "west" ? i : 2 - i]}`,
      contactLocal: { x: SOFA_CUSHION_LOCAL_X + SOFA_CONTACT_FORWARD, y: SOFA_CUSHION_TOP, z: lz },
      seatedYaw: side === "west" ? FACING_YAW.east : FACING_YAW.west,
      approach: { x: lane, z: 165 },
      approachToSeat: [{ x: lane, z: worldZ }],
      sink: 0,
      timings: { sitMs: 780, standMs: 720 },
    };
  });
}

function armchairSlot(a: ArmchairSpec): LoungeSeatSlot {
  // placed(rect, facing) points local −z at `facing`, so local +z is the chair's BACK
  const north = a.facing === "south";
  const standZ = north ? 126 : 288;
  return {
    id: `${a.id}-seat`,
    contactLocal: { x: 0, y: EXEC_LOUNGE_CHAIR.cushionTop, z: EXEC_LOUNGE_CHAIR.contactLocalZ },
    seatedYaw: a.yaw,
    approach: { x: a.x, z: standZ },
    approachToSeat: [{ x: a.x, z: north ? 136 : 278 }],
    sink: 1.2,
    timings: { sitMs: 780, standMs: 720 },
  };
}

/** The eight visitor chairs are FIXED: they are pulled up to the desk in the reference and stay there. */
function visitorSlot(id: string, x: number): LoungeSeatSlot {
  return {
    id: `${id}-seat`,
    contactLocal: { x: 0, y: EXEC_VISITOR.cushionTop, z: EXEC_VISITOR.contactLocalZ },
    seatedYaw: FACING_YAW.north, // V1 "back": the visitor looks north, at the desk
    approach: { x, z: 188 },
    approachToSeat: [{ x, z: 178 }],
    sink: 1.4,
    timings: { sitMs: 750, standMs: 700 },
  };
}

export const visitorId = (side: "l" | "r", i: number): string => `${EXECUTIVE_ROOM_ID}/visitor-${side}${i}`;
export const SOFA_SEAT_IDS = [SOFA_W_SPEC, SOFA_E_SPEC].map((s) => `${EXECUTIVE_ROOM_ID}/${s.id}`);
export const ARMCHAIR_SEAT_IDS = [ARMCHAIR_N, ARMCHAIR_S].map((a) => `${EXECUTIVE_ROOM_ID}/${a.id}`);
export const VISITOR_SEAT_IDS = [...VISITORS_L.map((_, i) => visitorId("l", i)), ...VISITORS_R.map((_, i) => visitorId("r", i))];
/** every FIXED lounge piece in the room, in GUI order */
export const EXECUTIVE_LOUNGE_IDS = [...SOFA_SEAT_IDS, ...ARMCHAIR_SEAT_IDS, ...VISITOR_SEAT_IDS];

// ---- walk-up points ------------------------------------------------------------------------------
// Physical anchors only: somewhere to stand and something to face.
export const CABINET_L_APPROACH: ApproachCapability = { point: { x: 540, z: 74 }, yaw: FACING_YAW.north, label: "Awards cabinet", action: "Read the awards" };
export const CABINET_R_APPROACH: ApproachCapability = { point: { x: mirrorX(540), z: 74 }, yaw: FACING_YAW.north, label: "Trophy cabinet", action: "Read the awards" };
export const MEDIA_APPROACH: ApproachCapability = { point: { x: AXIS, z: 88 }, yaw: FACING_YAW.north, label: "Executive display", action: "View the display" };
export const CREDENZA_APPROACH: ApproachCapability = { point: { x: 570, z: 240 }, yaw: FACING_YAW.south, label: "Display credenza", action: "Take a closer look" };

export const CABINET_L_INTERACTION_ID = `${EXECUTIVE_ROOM_ID}/cabinet-left-interaction`;
export const CABINET_R_INTERACTION_ID = `${EXECUTIVE_ROOM_ID}/cabinet-right-interaction`;
export const MEDIA_INTERACTION_ID = `${EXECUTIVE_ROOM_ID}/media-interaction`;
export const CREDENZA_INTERACTION_ID = `${EXECUTIVE_ROOM_ID}/credenza-interaction`;
export const EXECUTIVE_APPROACH_IDS = [CABINET_L_INTERACTION_ID, CABINET_R_INTERACTION_ID, MEDIA_INTERACTION_ID, CREDENZA_INTERACTION_ID];

// ---- the south entrance ---------------------------------------------------------------------------
/** Bi-parting glass, on the SAME SlidingDoor controller Reception's entrance uses: the west panel drives
 *  and the east one is its `opposed` mirror, so both derive from one `t` and neither can drift. */
export const DOOR_LEAF_W = (DOOR.x1 - DOOR.x0) / 2; // 40
export const DOOR_Z = SOUTH_Z + WALL_T / 2; // 307 — the wall's centre plane
export const DOOR_LEAF_CLOSED = {
  west: { x: DOOR.x0 + DOOR_LEAF_W / 2, z: DOOR_Z }, // 708
  east: { x: DOOR.x1 - DOOR_LEAF_W / 2, z: DOOR_Z }, // 748
};
export const DOOR_WEST_ID = `${EXECUTIVE_ROOM_ID}/entry-door-west`;
export const DOOR_EAST_ID = `${EXECUTIVE_ROOM_ID}/entry-door-east`;
const BODY_RADIUS = 10.5; // Bon's widest walking extent, as every other V2 door measures it

export const ENTRY_DOOR: DoorCapability = {
  slide: { x: -1, z: 0 },
  slideDistance: DOOR_LEAF_W,
  automatic: true,
  leaf: { x: DOOR.x0, z: DOOR_Z - STRUCT.wallThickness / 2, w: DOOR_LEAF_W, d: STRUCT.wallThickness },
  leafOpposed: { x: DOOR.x0 + DOOR_LEAF_W, z: DOOR_Z - STRUCT.wallThickness / 2, w: DOOR_LEAF_W, d: STRUCT.wallThickness },
  /** the doorway itself: while a body overlaps this the door must be open and may not close */
  crossing: { x: DOOR.x0 - 4, z: SOUTH_Z - 6, w: DOOR.x1 - DOOR.x0 + 8, d: WALL_T + 12 },
  /** both approach aprons — the room's south lane inside and the hall lane outside */
  trigger: { x: DOOR.x0 - 40, z: SOUTH_Z - 68, w: DOOR.x1 - DOOR.x0 + 80, d: 148 },
  clearance: {
    bodyRadius: BODY_RADIUS,
    band: { x: DOOR.x0, z: 18 * CELL, w: DOOR.x1 - DOOR.x0, d: 2 * CELL }, // the V1 '+' cells, verbatim
    solids: [], // nothing stands in the band: the jambs are the opening's own reveals
  },
  timings: { openMs: 900, closeMs: 1100, holdMs: 700 },
};

// ============================= ENTITIES =========================================================
const centreOf = (r: Rect): Vec2 => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });

function furniture(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, props: Record<string, string | number | boolean> = {}): Entity {
  return {
    id: `${EXECUTIVE_ROOM_ID}/${id}`,
    kind,
    roomId: EXECUTIVE_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    capabilities: {},
    props: { w, d, facing, mirrored: false, ...props },
  };
}
function rugEntity(id: string, r: Rect): Entity {
  const c = centreOf(r);
  return furniture(id, "exec-rug", c.x, c.z, r.w, r.d, "north", { color: THEME.rug, accent: "execRugBorder" });
}
function plantEntity(p: (typeof PLANTS)[number]): Entity {
  return {
    id: `${EXECUTIVE_ROOM_ID}/${p.id}`,
    kind: "plant",
    roomId: EXECUTIVE_ROOM_ID,
    transform: { pos: { x: p.x, z: p.z }, yaw: 0 },
    // radius is the POT, not the canopy — a body brushes past leaves (7B rule)
    footprint: { shape: "circle", r: p.r * 0.9 },
    capabilities: { sway: true },
    props: { r: p.r, h: p.h, hanging: false, y: 0 },
    source: { baked: true },
  };
}
function solidEntity(s: Rect & { id: string }): Entity {
  return {
    id: `${EXECUTIVE_ROOM_ID}/solid-${s.id}`,
    kind: "solid",
    roomId: EXECUTIVE_ROOM_ID,
    transform: { pos: centreOf(s), yaw: 0 },
    footprint: { shape: "rect", w: s.w, d: s.d },
    capabilities: {},
    props: {},
    source: { baked: true },
  };
}
function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: EXECUTIVE_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** The room's movable-in-principle furniture as world entities. Architecture, the display wall, the two
 *  desks, the credenza and the SE storage are static (build/executive.ts) and appear here only as
 *  footprint-only solids, exactly as the Design Room's baked decor does. */
export function executiveRoomEntities(): Entity[] {
  const out: Entity[] = [];
  // rugs first: floor dressing, walked straight over (kindFootprint gives them solid: false)
  out.push(rugEntity("rug-desk-left", RUG_L));
  out.push(rugEntity("rug-desk-right", RUG_R));
  out.push(rugEntity("rug-lounge", RUG_C));
  out.push(rugEntity("mat-workstation", MAT_SE));
  // the lounge. A sofa is authored back-to-WEST with its long axis in local z, so the WEST run needs no
  // rotation at all and the EAST run is the same piece `mirrored` — which is exactly the reference's
  // mirrored pair, built from one set of numbers.
  for (const spec of [SOFA_W_SPEC, SOFA_E_SPEC])
    out.push(furniture(spec.id, "exec-sofa", spec.x, spec.z, SOFA_DEPTH, SOFA_LEN, "north",
      { color: THEME.upholstery, colorSeat: THEME.upholsterySeat, seats: SOFA_SEATS, mirrored: spec.mirrored }));
  for (const a of [ARMCHAIR_N, ARMCHAIR_S])
    out.push(furniture(a.id, "exec-lounge-chair", a.x, a.z, ARMCHAIR_W, ARMCHAIR_D, a.facing, { color: THEME.accent, colorSeat: "execOliveSeat" }));
  out.push(furniture("coffee-table", "exec-coffee-table", COFFEE_TABLE.x + COFFEE_TABLE.w / 2, COFFEE_TABLE.z + COFFEE_TABLE.d / 2, COFFEE_TABLE.w, COFFEE_TABLE.d, "north", { color: THEME.wood }));
  for (const t of PLANTERS) out.push(furniture(t.id, "exec-planter", t.x, t.z, t.r * 2, t.r * 2, "north", { r: t.r }));
  // the three MOVABLE chairs
  for (const c of EXEC_CHAIRS) out.push(furniture(c.id, "exec-chair", c.x, c.z, c.size, c.size, "south", { color: THEME.leather, colorSeat: "execLeatherSeat" }));
  out.push(furniture(WORKSTATION_CHAIR.id, "exec-task-chair", WORKSTATION_CHAIR.x, WORKSTATION_CHAIR.z, WORKSTATION_CHAIR.size, WORKSTATION_CHAIR.size, "south", { color: THEME.leather, colorSeat: "execLeatherSeat" }));
  // the eight FIXED visitor chairs
  for (const [side, xs] of [["l", VISITORS_L], ["r", VISITORS_R]] as const)
    xs.forEach((x, i) => out.push(furniture(`visitor-${side}${i}`, "exec-visitor-chair", x, VISITOR_Z, VISITOR_W, VISITOR_D, "north", { color: THEME.leather, colorSeat: "execLeatherSeat" })));
  for (const p of PLANTS) out.push(plantEntity(p));
  for (const s of EXECUTIVE_SOLIDS) out.push(solidEntity(s));
  return withExecutiveInteractions(out);
}

/** Hang the capabilities on the entities above: MOVABLE seating on the three task chairs, FIXED lounge
 *  seating on the sofas / armchairs / visitor chairs, four walk-up points and the bi-parting entrance.
 *  No geometry, no transform and no id changes. */
export function withExecutiveInteractions(entities: Entity[]): Entity[] {
  const find = (id: string): Entity => {
    const e = entities.find((x) => x.id === id);
    if (!e) throw new Error(`executive: no entity ${id}`);
    return e;
  };
  EXEC_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: EXEC_SEATS[i] }; });
  find(WORKSTATION_CHAIR_ID).capabilities = { ...find(WORKSTATION_CHAIR_ID).capabilities, seat: WORKSTATION_SEAT };
  find(SOFA_SEAT_IDS[0]).capabilities = { lounge: { slots: sofaSlots(SOFA_W_SPEC, "west") } };
  find(SOFA_SEAT_IDS[1]).capabilities = { lounge: { slots: sofaSlots(SOFA_E_SPEC, "east") } };
  for (const a of [ARMCHAIR_N, ARMCHAIR_S]) {
    const e = find(`${EXECUTIVE_ROOM_ID}/${a.id}`);
    e.capabilities = { ...e.capabilities, lounge: { slots: [armchairSlot(a)] } };
  }
  [...VISITORS_L.map((x, i) => [visitorId("l", i), x] as const), ...VISITORS_R.map((x, i) => [visitorId("r", i), x] as const)]
    .forEach(([id, x]) => { find(id).capabilities = { ...find(id).capabilities, lounge: { slots: [visitorSlot(id.split("/")[1], x)] } }; });
  entities.push(approachEntity(CABINET_L_INTERACTION_ID, "exec-cabinet-left", CABINET_L_APPROACH));
  entities.push(approachEntity(CABINET_R_INTERACTION_ID, "exec-cabinet-right", CABINET_R_APPROACH));
  entities.push(approachEntity(MEDIA_INTERACTION_ID, "exec-media-wall", MEDIA_APPROACH));
  entities.push(approachEntity(CREDENZA_INTERACTION_ID, "exec-credenza-sw", CREDENZA_APPROACH));
  const leaf = { kind: "glass-door-leaf", roomId: EXECUTIVE_ROOM_ID, source: { baked: true } as const };
  entities.push({
    ...leaf, id: DOOR_WEST_ID,
    transform: { pos: { ...DOOR_LEAF_CLOSED.west }, yaw: 0 },
    capabilities: { door: ENTRY_DOOR },
    props: { w: DOOR_LEAF_W, h: STRUCT.wallHeight, handle: 1 }, // handle on the leading (east) stile
  });
  entities.push({
    ...leaf, id: DOOR_EAST_ID,
    transform: { pos: { ...DOOR_LEAF_CLOSED.east }, yaw: 0 },
    capabilities: {},
    props: { w: DOOR_LEAF_W, h: STRUCT.wallHeight, handle: -1 },
  });
  return entities;
}
