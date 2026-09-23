// vo3d rooms — CMS ROOM definition (data only, WORLD coordinates).
//
// Phase 8. The east-side content-team room, below the Dev room (which ends z 331.5) and above the Gaming
// room (which starts z 622). ONE entrance: a bi-parting glass door in the WEST wall onto the north–south
// corridor that also serves Dev and Gaming.
//
// Every number below is DERIVED from production, never invented:
//   • rect      → the READ-ONLY V1 asset manifest ("cms-room": x 1141, z 344.86, 291 × 257.113)
//   • door      → the grid's '+' cells, cols 71–72 × rows 27–30 (z 432…496), with 's' stands at col 70
//                 (hall, x 1128) and col 73 (inside, x 1176)
//   • desks     → the manifest's OWN cms-team furniture layer: two cms-lead-desk boxes at x 1219.7 /
//                 1314.58, z 415.97, 41.71 × 27.77, and the cms-member-desk grid at z 462.92 / 512.09
//   • seats     → the grid's 'o' cells, which are exactly data/seatDirections.ts "cms-team":
//                 two lead chairs at (1240 | 1336, 408) facing south into their desks; a front member row
//                 at (1208 | 1256 | 1320 | 1368, 504) and a back row at (1256 | 1320 | 1368, 552), all
//                 facing north into their desks; the lounge pouf at (1216, 536); and the sofa, whose two
//                 cells (1176, 536) and (1176, 552) seatDirections merges to (1176, 544) facing east
//   • stands    → V1 authored one 's' cell beside EVERY 'o' cell in this room (rows 25 / 31 / 34). Those
//                 cells ARE the seats' approach points and are used verbatim wherever a body fits on them
//   • the rest  → measured off rooms/cms-room.png at 0.22699 units/px in x and 0.22693 in z
//
// The flat reference is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, DoorCapability, Entity, LoungeSeatSlot, RoomDef, SeatCapability } from "../world/WorldState";
import type { MatKey } from "../render/Materials";
import { CELL } from "../adapters/v1Grid";
import { v1RoomRect } from "../adapters/v1Manifest";
import { STRUCT } from "./reception";
import { SOFA_ARM_W, SOFA_CUSHION_GAP, SOFA_CUSHION_MARGIN, sofaCushionZ } from "../build/furniture";
import { CMS_LEAD_CHAIR, CMS_POUF, CMS_SOFA, CMS_TASK_CHAIR } from "../build/cms-furniture";
import { kindFootprint } from "./footprint";

export const CMS_ROOM_ID = "cms-room";
export const RECT: Rect = v1RoomRect(CMS_ROOM_ID); // x 1141, z 344.86, w 291, d 257.113

// ============================= THEME ============================================================
/** ROOM-LEVEL COLOUR TABLE, the same seam Gaming, the Central Hub and Executive use. The CMS room is the
 *  office's one BLUE space — blue joinery, blue upholstery, blue rug — against light oak and a cooler
 *  white than the rest of the floor. No builder below names a palette key directly. */
export const THEME = {
  /** the content credenza band, the library carcass, the east credenza's front panel */
  blue: "cmsBlue",
  /** drawer pedestals, the lead desks' base, every reveal in the blue joinery */
  blueDeep: "cmsBlueDeep",
  /** light oak: every desk top, the coffee table, the counter and the east credenza top */
  oak: "cmsOak",
  oakDark: "cmsOakDark",
  /** walls */
  plaster: "cmsPlaster",
  /** sofa body + its cushions */
  sofa: "cmsSofa",
  sofaSeat: "cmsSofaSeat",
  /** task-chair and lead-chair upholstery */
  seat: "cmsSeat",
  seatLead: "cmsSeatLead",
  /** the lounge pouf — the deepest blue in the room */
  navy: "cmsNavy",
  /** the lounge rug */
  rug: "cmsRug",
  rugBorder: "cmsRugBorder",
  /** the member desks' privacy screens */
  screen: "cmsScreen",
  /** the whiteboard / sticky-wall face */
  board: "cmsBoard",
  /** chair frames, arms, casters */
  frame: "cmsFrame",
} satisfies Record<string, MatKey>;

// ============================= ARCHITECTURE =====================================================
// THE SAME CORRECTION GAMING MADE IN 5A AND EXECUTIVE IN 7. V1 blocks rows 22–24 across the whole north of
// this room (z 352…400, 48 units) and rows 36–37 across the south (z 576…608, 32 units). None of that is
// wall: it is the flat render's baked perspective plus the clearance V1 painted around the storage run
// standing against the north wall. Rebuilt as mass it would eat the room's main east–west circulation lane.
//
// So every wall here is a REAL 12-unit wall sitting on the art bounding box, the storage run is real
// furniture with a real footprint, and navigation comes from that geometry (DERIVED_ROOM_IDS) rather than
// from the painting. The V1 grid file itself is untouched.
export const WALL_T = 12;
export const WEST_OUTER_X = 1141, WEST_X = 1153;
export const EAST_X = 1420, EAST_OUTER_X = 1432;
export const NORTH_OUTER_Z = 345, NORTH_Z = 357;
export const SOUTH_Z = 590, SOUTH_OUTER_Z = 602;

/** The V1 '+' door band, cols 71–72 × rows 27–30. The wall opening is exactly this z span and NOTHING may
 *  stand inside it. 64 units is two leaves wide, so it is rebuilt BI-PARTING on Reception's own entrance
 *  controller — the same one the Executive Room's entrance runs on. */
export const DOOR = { z0: 432, z1: 496 };
/** V1's own authored stand cells either side of it: col 70 (hall) and col 73 (inside). */
export const DOOR_STANDS = { outside: { x: 1128, z: 464 }, inside: { x: 1176, z: 464 } };

/** Walkable floor region: inside all four walls. 267 × 233. */
export const FLOOR_RECT: Rect = { x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z };
/** The tiled plate, run to the walls' OUTER faces so no void is left under them. Grout stays phased to the
 *  WORLD by tiledFloor(), so this floor reads continuous with the corridor through the doorway. */
export const TILE_RECT: Rect = { x: WEST_OUTER_X, z: NORTH_OUTER_Z, w: EAST_OUTER_X - WEST_OUTER_X, d: SOUTH_OUTER_Z - NORTH_OUTER_Z };

export const NORTH_WALL = { x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: NORTH_Z, h: STRUCT.wallHeight };
export const SOUTH_WALL = { x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: SOUTH_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
export const EAST_WALL = { x0: EAST_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
/** WEST ELEVATION. The reference glazes the whole west side — a framed glass partition onto the corridor,
 *  running floor to head, with the entrance in the middle of it. Built as two glazed screens either side
 *  of the V1 door band over a low solid spandrel, so the corridor floor is never seen through the glass at
 *  ankle height. Nothing is declared inside the band. */
export const WEST_GLASS_N = { x0: WEST_OUTER_X, x1: WEST_X, z0: NORTH_Z, z1: DOOR.z0, h: STRUCT.wallHeight, bays: 3 };
export const WEST_GLASS_S = { x0: WEST_OUTER_X, x1: WEST_X, z0: DOOR.z1, z1: SOUTH_Z, h: STRUCT.wallHeight, bays: 4 };
/** shoe height for both screens: enough to read as architecture, low enough to stay under every sightline */
export const GLASS_SPANDREL = 9;

// ============================= NORTH STORAGE RUN ================================================
// The reference's whole north elevation is one continuous run of storage: a blue-and-oak library at the
// west end, the long content-planning wall in the middle, and the tea point at the east end, with a tall
// plant standing in each of the two gaps.
//
// DEPTH IS SET BY CIRCULATION, not by the painting. V1's flat boxes read ~30 deep because the render draws
// the FRONT of each unit in perspective; at 30 the east–west lane between the run and the lead chairs
// (whose cells V1 fixes at z 408) closes to 13 units and a body does not fit. 22 leaves a 20.7-unit lane,
// which is what makes the room's main circulation real.
export const RUN_D = 22;
export const RUN_Z = NORTH_Z; //           its back is the wall's inner face
export const RUN_FRONT = NORTH_Z + RUN_D; // 379

/** WEST END — the team library: an oak open-shelf carcass on a blue closed base, binders on the shelves. */
export const LIBRARY: Rect & { h: number; shelves: number } = { x: 1158, z: RUN_Z, w: 32, d: RUN_D, h: 40, shelves: 3 };

/** CENTRE — the CONTENT PLANNING WALL, this room's identity: a long low blue credenza with open filing
 *  bays, under a full-width whiteboard carrying the team's Content Ideas / Publishing Schedule / To Do
 *  columns and a block of coloured sticky notes. */
export const CONTENT_CREDENZA: Rect & { h: number; modules: number } = { x: 1228, z: RUN_Z, w: 108, d: RUN_D, h: 26, modules: 3 };
/** The board above it. Its height comes from the 46-unit wall: 27→44 clears the credenza top and dies
 *  two units under the wall head, which is where the reference puts it. */
export const WHITEBOARD = { x0: 1228, x1: 1336, y0: 27, y1: 44 };

/** EAST END — the tea point: an oak counter with the coffee machine, canisters and a plant on top, and a
 *  glass-fronted under-counter fridge in its east module. */
export const COUNTER: Rect & { h: number } = { x: 1348, z: RUN_Z, w: 44, d: RUN_D, h: 26 };
export const FRIDGE: Rect & { h: number } = { x: 1370, z: RUN_Z + 2, w: 22, d: RUN_D - 4, h: 20 };

// ============================= EAST WALL ========================================================
/** The colourful STICKY WALL — the reference's pinned board of blue/yellow/red notes, mounted on the east
 *  wall opposite the entrance. Measured z 432…500; it is the first thing seen on walking in. */
export const STICKY_WALL = { z0: 432, z1: 500, y0: 16, y1: 40 };
/** The print station: an oak-topped credenza on a blue plinth running south along the east wall, with the
 *  multifunction printer at its north end and a small plant on it. */
export const PRINT_CREDENZA: Rect & { h: number; modules: number } = { x: 1404, z: 500, w: EAST_X - 1404, d: 63, h: 26, modules: 2 };

// ============================= LEAD WORKSTATIONS ================================================
/** The two lead desks, VERBATIM from the manifest's cms-lead-desk boxes (x 1219.7 / 1314.58, z 415.97,
 *  41.71 wide). Depth is squared to 28 — the flat box's 27.77 carries the PNG's drop shadow. */
export const LEAD_DESK_W = 41.71, LEAD_DESK_D = 28, LEAD_DESK_H = 24, LEAD_DESK_Z = 416;
export const LEAD_DESKS = [
  { id: "lead-desk-west", x: 1219.7 },
  { id: "lead-desk-east", x: 1314.58 },
];
/** V1 seat cells: the two lead chairs, NORTH of their desks and facing "front" = south, into the desk —
 *  the identical topology the Executive Room's two desks have. */
export const LEAD_CHAIR_SIZE = 18;
export const LEAD_CHAIR_Z = 408;
export const LEAD_CHAIRS = [
  { id: "lead-chair-west", x: 1240, z: LEAD_CHAIR_Z, size: LEAD_CHAIR_SIZE },
  { id: "lead-chair-east", x: 1336, z: LEAD_CHAIR_Z, size: LEAD_CHAIR_SIZE },
];

// ============================= MEMBER WORKSTATIONS ==============================================
// V1's own grid draws the cluster: a FRONT row of four desks and a BACK row of three, split by a
// north–south aisle (the grid keeps col 80 — x 1280…1296 — open through every desk row), with every
// member facing NORTH into their screen.
//
// The two rows' FLAT boxes (z 462.92 and 512.09, each 33.17 deep) overlap the chair cells between them:
// a chair at V1's z 504 with the back desks starting at 512 has nowhere to roll. The physical reading
// keeps both V1 seat CELLS and squares the desks to 26 deep + a 3-deep screen, which opens a real
// roll-back gap between the rows. The back row shifts 12 south and its chairs 7, both still inside the
// V1 cells they came from (rows 32–33 and row 34).
export const DESK_W = 32, DESK_D = 26, DESK_H = 24;
/** the slate privacy screen standing on the desk's NORTH edge — the member-desk art's signature part */
export const DESK_SCREEN_D = 3, DESK_SCREEN_H = 14;
// CHAIR DISTANCE IS A 3D CORRECTION, not a V1 number. V1's cell for a front-row chair is row 31
// (z 496…512) and its centre, 504, put the chair 4 units clear of its own desk AND parked it 6 further
// out again while occupied — so in Player View every member sat a desk-width back from their screen.
// The chairs move IN to z 500 (still inside V1's own cell) so a resting chair just touches the desk edge,
// which is what a working position looks like; the back row follows by the same 4 and its desks with it.
// Nothing leaves the V1 cell it came from, and each row keeps a full roll-back gap — see FRONT_PULL.
export const MEMBER_ROWS = [
  { id: "front", deskZ: 466, chairZ: 500, xs: [1208, 1256, 1320, 1368] },
  { id: "back", deskZ: 520, chairZ: 554, xs: [1256, 1320, 1368] },
] as const;
export const MEMBER_CHAIR_SIZE = 16;

/** the central aisle the grid keeps open through both desk rows */
export const AISLE = { x0: 1272, x1: 1304 };

// ============================= LOUNGE ===========================================================
// The reference's south-west corner: a square blue rug carrying a three-seat sofa against the glass, a
// deep navy barrel chair, and a round oak coffee table between them.
export const RUG: Rect = { x: 1163, z: 512, w: 72, d: 73 };

/** The sofa is authored back-to-WEST with its long axis in local z, so it needs no rotation: furniture
 *  local +x is world +x, which is the direction its sitters face. Its LENGTH is derived from the shared
 *  cushion arithmetic, so the cushions land where V1's own cells are. */
export const SOFA_SEATS = 3, SOFA_CUSH_D = 14, SOFA_DEPTH = 19;
export const SOFA_LEN = SOFA_SEATS * SOFA_CUSH_D + (SOFA_SEATS - 1) * SOFA_CUSHION_GAP + 2 * SOFA_CUSHION_MARGIN + 2 * SOFA_ARM_W; // 59.2
export const SOFA_X = 1162 + SOFA_DEPTH / 2; //  1171.5 — body centre
export const SOFA_Z = 516 + SOFA_LEN / 2; //     545.6 — body centre
/** The cushion line therefore lands at x 1176.5 — V1's own sofa seat cells are at x 1176. */
export const SOFA_CUSHION_X = SOFA_X + CMS_SOFA.cushionLocalX;

/** The deep navy barrel chair. V1 cell (1216, 536) facing "front" = south, at the reference's own centre. */
export const POUF = { id: "lounge-pouf", x: 1216, z: 524, r: 12 };
/** The round oak coffee table, between the sofa and the pouf. */
export const COFFEE_TABLE = { id: "coffee-table", x: 1208, z: 552, r: 10 };
/** The lounge's circulation lane, between the sofa's front edge and the table/pouf. 17 units clear — this
 *  is how the sofa is reached and why the table sits 10 east of where the flat render draws it. */
export const LOUNGE_LANE_X = 1190;

// ============================= PLANTING =========================================================
/** The three floor plants the reference stands in white pots: one in each gap of the north storage run,
 *  and one beside the sofa. Heights are capped by the 46-unit wall exactly as the Executive Room's are —
 *  build/plants' large tier throws its canopy about 1.56× its nominal height. */
export const PLANTS = [
  { id: "plant-nw", x: 1204, z: 370, r: 8, h: 27 },
  { id: "plant-ne", x: 1408, z: 370, r: 8, h: 27 },
  { id: "plant-lounge", x: 1164, z: 583, r: 6.5, h: 24 },
];

// ============================= WALLS AS DATA ====================================================
/** THE ROOM'S PHYSICAL WALLS for derived navigation (nav/solids.ts) — the same runs build/cms.ts extrudes,
 *  as world rects. The V1 '+' door band is the ONE gap and nothing is declared inside it. */
export const CMS_WALLS: Rect[] = [
  { x: NORTH_WALL.x0, z: NORTH_WALL.z0, w: NORTH_WALL.x1 - NORTH_WALL.x0, d: NORTH_WALL.z1 - NORTH_WALL.z0 },
  { x: SOUTH_WALL.x0, z: SOUTH_WALL.z0, w: SOUTH_WALL.x1 - SOUTH_WALL.x0, d: SOUTH_WALL.z1 - SOUTH_WALL.z0 },
  { x: EAST_WALL.x0, z: EAST_WALL.z0, w: EAST_WALL.x1 - EAST_WALL.x0, d: EAST_WALL.z1 - EAST_WALL.z0 },
  { x: WEST_OUTER_X, z: NORTH_OUTER_Z, w: WALL_T, d: DOOR.z0 - NORTH_OUTER_Z },
  { x: WEST_OUTER_X, z: DOOR.z1, w: WALL_T, d: SOUTH_OUTER_Z - DOOR.z1 },
];

const rectOf = (r: Rect): Rect => ({ x: r.x, z: r.z, w: r.w, d: r.d });

/** The FIXED fit-out — the north storage run and the east print credenza. Drawn by build/cms.ts and
 *  registered as footprint-only entities so derived navigation sees exactly what the camera does. */
export const CMS_SOLIDS: (Rect & { id: string })[] = [
  { id: "library", ...rectOf(LIBRARY) },
  { id: "content-credenza", ...rectOf(CONTENT_CREDENZA) },
  { id: "counter", ...rectOf(COUNTER) },
  { id: "print-credenza", ...rectOf(PRINT_CREDENZA) },
];

export const CMS_ROOM: RoomDef = {
  id: CMS_ROOM_ID,
  name: "CMS Room",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: CMS_WALLS,
  // no `shell`: solid north/east/south plus a glazed west elevation with a bi-parting entrance — its own
  // static builder, exactly as Reception, Gaming, the Central Hub and Executive do.
};

// ============================= INTERACTIONS =====================================================
// Nothing below adds geometry or a new system. Movable chairs use SeatCapability, fixed lounge seating
// uses LoungeSeatCapability, walk-ups use ApproachCapability and the entrance uses the SAME bi-parting
// SlidingDoor Reception and Executive drive.

/** How far a chair rolls back off its desk. The member rows differ because the space between them does:
 *  a front-row chair has the back row's desk behind it and 9 is what fits; the back row opens onto the
 *  room's south lane and takes the full 10. */
export const LEAD_PULL = 11, FRONT_PULL = 9, BACK_PULL = 10;
/** How far the chair stays out from rest WHILE OCCUPIED (SeatCapability.seatedTuck: the chair parks this
 *  far short of rest). This is what actually sets the sitter's distance from the desk, and deriving it
 *  from the pull (0.62 × pull, i.e. 6–7 units) is what left every CMS member visibly reclined away from
 *  their screen. 3 is a real chair under a real desk and still leaves the roll-back the pull provides. */
export const SEATED_TUCK = 3;

function deskChairSeat(
  chair: { x: number; z: number }, approach: Vec2, preSeatZ: number,
  dir: -1 | 1, pull: number, metrics: { cushionTop: number; cushionLocalZ: number },
): SeatCapability {
  const preSeat: Vec2 = { x: chair.x, z: preSeatZ };
  return {
    approach,
    preSeat,
    approachToSeat: [{ x: approach.x, z: preSeatZ }, preSeat],
    pullDir: { x: 0, z: dir }, // away from the desk, into the room
    pullDistance: pull,
    seatedTuck: SEATED_TUCK,
    cushionTopY: metrics.cushionTop,
    cushionLocal: { x: 0, z: metrics.cushionLocalZ },
    sitDepth: 3.5,
    seatedYaw: dir === -1 ? FACING_YAW.south : FACING_YAW.north,
    timings: { pullMs: 860, sitMs: 650, slideMs: 760, standMs: 650, returnMs: 860 },
  };
}

/** The two LEAD chairs. V1 authored an 's' cell each side of both ('o' cells at cols 76/78 and 82/84,
 *  row 25); the OUTER one of each pair is taken, nudged 4 units inside its cell so a body at NAV_RADIUS
 *  clears the chair it is walking up to. */
export const LEAD_SEATS: SeatCapability[] = [
  deskChairSeat(LEAD_CHAIRS[0], { x: 1220, z: 406 }, 412, -1, LEAD_PULL, CMS_LEAD_CHAIR),
  deskChairSeat(LEAD_CHAIRS[1], { x: 1356, z: 406 }, 412, -1, LEAD_PULL, CMS_LEAD_CHAIR),

];

/** The seven MEMBER chairs, in row order. Every approach is V1's own 's' cell beside the chair's 'o' cell
 *  (row 31: cols 74/79/81/84; row 34: cols 77/81/84). The back row's stands move 10 south of the cell
 *  centre — V1 paints them tight against the desks its own flat boxes overlap — and stay on floor the
 *  room's geometry makes walkable. */
export const MEMBER_CHAIRS = [
  { id: "member-chair-f1", x: 1208, z: 500, row: 0, approach: { x: 1192, z: 504 }, preSeatZ: 496 },
  { id: "member-chair-f2", x: 1256, z: 500, row: 0, approach: { x: 1272, z: 504 }, preSeatZ: 496 },
  { id: "member-chair-f3", x: 1320, z: 500, row: 0, approach: { x: 1304, z: 504 }, preSeatZ: 496 },
  { id: "member-chair-f4", x: 1368, z: 500, row: 0, approach: { x: 1352, z: 504 }, preSeatZ: 496 },
  { id: "member-chair-b1", x: 1256, z: 554, row: 1, approach: { x: 1240, z: 558 }, preSeatZ: 550 },
  { id: "member-chair-b2", x: 1320, z: 554, row: 1, approach: { x: 1304, z: 558 }, preSeatZ: 550 },
  { id: "member-chair-b3", x: 1368, z: 554, row: 1, approach: { x: 1352, z: 558 }, preSeatZ: 550 },
] as const;

export const MEMBER_SEATS: SeatCapability[] = MEMBER_CHAIRS.map((c) =>
  deskChairSeat(c, { ...c.approach }, c.preSeatZ, 1, c.row === 0 ? FRONT_PULL : BACK_PULL, CMS_TASK_CHAIR));

export const leadChairId = (i: number): string => `${CMS_ROOM_ID}/${LEAD_CHAIRS[i].id}`;
export const memberChairId = (i: number): string => `${CMS_ROOM_ID}/${MEMBER_CHAIRS[i].id}`;
export const LEAD_CHAIR_IDS = LEAD_CHAIRS.map((_, i) => leadChairId(i));
export const MEMBER_CHAIR_IDS = MEMBER_CHAIRS.map((_, i) => memberChairId(i));
/** every MOVABLE chair in the room, in GUI order. EVERY one of these must be reachable by the per-frame
 *  SeatInteraction tick in app/bootstrap.ts — cms.test.ts asserts that wiring, as executive.test.ts does. */
export const CMS_SEAT_IDS = [...LEAD_CHAIR_IDS, ...MEMBER_CHAIR_IDS];

// ---- FIXED lounge seating ------------------------------------------------------------------------
/** 1.5 forward of the cushion centre: the sitter lands ON the cushion instead of wedged into the back. */
const SOFA_CONTACT_FORWARD = 1.5;
export const SOFA_ID = `${CMS_ROOM_ID}/lounge-sofa`;
export const POUF_ID = `${CMS_ROOM_ID}/${POUF.id}`;
export const CMS_LOUNGE_IDS = [SOFA_ID, POUF_ID];
/** The lounge's one stand point, at the north end of its lane. Everything in the pocket is reached from
 *  here by walking DOWN the lane, which is the only body-clear route through a corner this dense. */
export const LOUNGE_APPROACH: Vec2 = { x: 1191, z: 506 };

export function sofaSlots(): LoungeSeatSlot[] {
  return [0, 1, 2].map((i) => {
    const lz = sofaCushionZ(i, SOFA_SEATS, SOFA_CUSH_D);
    return {
      id: `sofa-${["north", "centre", "south"][i]}`,
      contactLocal: { x: CMS_SOFA.cushionLocalX + SOFA_CONTACT_FORWARD, y: CMS_SOFA.cushionTop, z: lz },
      seatedYaw: FACING_YAW.east, // the sofa's back is the glass; its sitters look into the room
      approach: { ...LOUNGE_APPROACH },
      approachToSeat: [{ x: LOUNGE_LANE_X, z: SOFA_Z + lz }],
      sink: 0,
      timings: { sitMs: 780, standMs: 720 },
    };
  });
}

export function poufSlot(): LoungeSeatSlot {
  return {
    id: "pouf-seat",
    contactLocal: { x: 0, y: CMS_POUF.cushionTop, z: CMS_POUF.contactLocalZ },
    seatedYaw: FACING_YAW.south, // V1 "front": the barrel chair looks south, across the coffee table
    approach: { ...LOUNGE_APPROACH },
    approachToSeat: [{ x: 1196, z: 518 }],
    sink: 1.6,
    timings: { sitMs: 780, standMs: 720 },
  };
}

// ---- walk-up points ------------------------------------------------------------------------------
// Physical anchors only: somewhere to stand and something to face. Each point is a body-clear spot on the
// derived floor, checked against every solid within NAV_RADIUS of it.
export const BOARD_APPROACH: ApproachCapability = { point: { x: 1282, z: 396 }, yaw: FACING_YAW.north, label: "Content board", action: "Read the content plan" };
export const COUNTER_APPROACH: ApproachCapability = { point: { x: 1370, z: 396 }, yaw: FACING_YAW.north, label: "Tea point", action: "Make a coffee" };
export const LIBRARY_APPROACH: ApproachCapability = { point: { x: 1174, z: 398 }, yaw: FACING_YAW.north, label: "Team library", action: "Browse the shelf" };
export const STICKY_APPROACH: ApproachCapability = { point: { x: 1393, z: 466 }, yaw: FACING_YAW.east, label: "Sticky wall", action: "Read the notes" };
export const PRINTER_APPROACH: ApproachCapability = { point: { x: 1393, z: 512 }, yaw: FACING_YAW.east, label: "Print station", action: "Collect a printout" };

export const BOARD_INTERACTION_ID = `${CMS_ROOM_ID}/board-interaction`;
export const COUNTER_INTERACTION_ID = `${CMS_ROOM_ID}/counter-interaction`;
export const LIBRARY_INTERACTION_ID = `${CMS_ROOM_ID}/library-interaction`;
export const STICKY_INTERACTION_ID = `${CMS_ROOM_ID}/sticky-interaction`;
export const PRINTER_INTERACTION_ID = `${CMS_ROOM_ID}/printer-interaction`;
export const CMS_APPROACH_IDS = [BOARD_INTERACTION_ID, COUNTER_INTERACTION_ID, LIBRARY_INTERACTION_ID, STICKY_INTERACTION_ID, PRINTER_INTERACTION_ID];

// ---- the west entrance ---------------------------------------------------------------------------
/** Bi-parting glass, on the SAME SlidingDoor controller Reception's and Executive's entrances use: the
 *  north panel drives and the south one is its `opposed` mirror, so both derive from one `t` and neither
 *  can drift. */
export const DOOR_LEAF_W = (DOOR.z1 - DOOR.z0) / 2; // 32
export const DOOR_X = WEST_OUTER_X + WALL_T / 2; //   1147 — the wall's centre plane
export const DOOR_LEAF_CLOSED = {
  north: { x: DOOR_X, z: DOOR.z0 + DOOR_LEAF_W / 2 }, // 448
  south: { x: DOOR_X, z: DOOR.z1 - DOOR_LEAF_W / 2 }, // 480
};
export const DOOR_NORTH_ID = `${CMS_ROOM_ID}/entry-door-north`;
export const DOOR_SOUTH_ID = `${CMS_ROOM_ID}/entry-door-south`;
const BODY_RADIUS = 10.5; // Bon's widest walking extent, as every other V2 door measures it

export const ENTRY_DOOR: DoorCapability = {
  slide: { x: 0, z: -1 },
  slideDistance: DOOR_LEAF_W,
  automatic: true,
  leaf: { x: DOOR_X - STRUCT.wallThickness / 2, z: DOOR.z0, w: STRUCT.wallThickness, d: DOOR_LEAF_W },
  leafOpposed: { x: DOOR_X - STRUCT.wallThickness / 2, z: DOOR.z0 + DOOR_LEAF_W, w: STRUCT.wallThickness, d: DOOR_LEAF_W },
  /** the doorway itself: while a body overlaps this the door must be open and may not close */
  crossing: { x: WEST_OUTER_X - 6, z: DOOR.z0 - 4, w: WALL_T + 12, d: DOOR.z1 - DOOR.z0 + 8 },
  /** both approach aprons — the corridor lane outside and the room's west lane inside */
  trigger: { x: WEST_OUTER_X - 68, z: DOOR.z0 - 40, w: 148, d: DOOR.z1 - DOOR.z0 + 80 },
  clearance: {
    bodyRadius: BODY_RADIUS,
    band: { x: 71 * CELL, z: DOOR.z0, w: 2 * CELL, d: DOOR.z1 - DOOR.z0 }, // the V1 '+' cells, verbatim
    solids: [], // nothing stands in the band: the jambs are the opening's own reveals
  },
  timings: { openMs: 900, closeMs: 1100, holdMs: 700 },
};

// ============================= ENTITIES =========================================================
function furniture(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, props: Record<string, string | number | boolean> = {}): Entity {
  return {
    id: `${CMS_ROOM_ID}/${id}`,
    kind,
    roomId: CMS_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    capabilities: {},
    props: { w, d, facing, mirrored: false, ...props },
  };
}
function plantEntity(p: (typeof PLANTS)[number]): Entity {
  return {
    id: `${CMS_ROOM_ID}/${p.id}`,
    kind: "plant",
    roomId: CMS_ROOM_ID,
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
    id: `${CMS_ROOM_ID}/solid-${s.id}`,
    kind: "solid",
    roomId: CMS_ROOM_ID,
    transform: { pos: { x: s.x + s.w / 2, z: s.z + s.d / 2 }, yaw: 0 },
    footprint: { shape: "rect", w: s.w, d: s.d },
    capabilities: {},
    props: {},
    source: { baked: true },
  };
}
function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: CMS_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** The room's furniture as world entities. The architecture, the north storage run and the east print
 *  credenza are static (build/cms.ts) and appear here only as footprint-only solids. */
export function cmsRoomEntities(): Entity[] {
  const out: Entity[] = [];
  // floor dressing first: the lounge rug is walked straight over (kindFootprint gives it solid: false)
  out.push(furniture("lounge-rug", "cms-rug", RUG.x + RUG.w / 2, RUG.z + RUG.d / 2, RUG.w, RUG.d, "north",
    { color: THEME.rug, accent: THEME.rugBorder }));
  // the two lead workstations
  for (const d of LEAD_DESKS)
    out.push(furniture(d.id, "cms-lead-desk", d.x + LEAD_DESK_W / 2, LEAD_DESK_Z + LEAD_DESK_D / 2, LEAD_DESK_W, LEAD_DESK_D, "south",
      { color: THEME.oak, accent: THEME.blueDeep, h: LEAD_DESK_H }));
  // the seven member workstations, screens to the north
  for (const row of MEMBER_ROWS)
    row.xs.forEach((x, i) => out.push(furniture(`member-desk-${row.id}${i + 1}`, "cms-member-desk", x, row.deskZ + DESK_D / 2, DESK_W, DESK_D, "north",
      { color: THEME.oak, accent: THEME.blueDeep, screen: THEME.screen, h: DESK_H })));
  // the nine MOVABLE chairs
  for (const c of LEAD_CHAIRS)
    out.push(furniture(c.id, "cms-lead-chair", c.x, c.z, c.size, c.size, "south", { color: THEME.seatLead, frame: THEME.frame }));
  for (const c of MEMBER_CHAIRS)
    out.push(furniture(c.id, "cms-task-chair", c.x, c.z, MEMBER_CHAIR_SIZE, MEMBER_CHAIR_SIZE, "north", { color: THEME.seat, frame: THEME.frame }));
  // the lounge
  out.push(furniture("lounge-sofa", "cms-sofa", SOFA_X, SOFA_Z, SOFA_DEPTH, SOFA_LEN, "north",
    { color: THEME.sofa, colorSeat: THEME.sofaSeat, seats: SOFA_SEATS }));
  out.push(furniture(POUF.id, "cms-pouf", POUF.x, POUF.z, POUF.r * 2, POUF.r * 2, "south", { color: THEME.navy, r: POUF.r }));
  out.push(furniture(COFFEE_TABLE.id, "cms-round-table", COFFEE_TABLE.x, COFFEE_TABLE.z, COFFEE_TABLE.r * 2, COFFEE_TABLE.r * 2, "north",
    { color: THEME.oak, accent: THEME.oakDark, r: COFFEE_TABLE.r }));
  for (const p of PLANTS) out.push(plantEntity(p));
  for (const s of CMS_SOLIDS) out.push(solidEntity(s));
  return withCmsInteractions(out);
}

/** Hang the capabilities on the entities above: MOVABLE seating on the nine task chairs, FIXED lounge
 *  seating on the sofa and the pouf, five walk-up points and the bi-parting west entrance. No geometry,
 *  no transform and no id changes. */
export function withCmsInteractions(entities: Entity[]): Entity[] {
  const find = (id: string): Entity => {
    const e = entities.find((x) => x.id === id);
    if (!e) throw new Error(`cms: no entity ${id}`);
    return e;
  };
  LEAD_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: LEAD_SEATS[i] }; });
  MEMBER_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: MEMBER_SEATS[i] }; });
  find(SOFA_ID).capabilities = { lounge: { slots: sofaSlots() } };
  find(POUF_ID).capabilities = { ...find(POUF_ID).capabilities, lounge: { slots: [poufSlot()] } };
  entities.push(approachEntity(BOARD_INTERACTION_ID, "cms-content-board", BOARD_APPROACH));
  entities.push(approachEntity(COUNTER_INTERACTION_ID, "cms-counter", COUNTER_APPROACH));
  entities.push(approachEntity(LIBRARY_INTERACTION_ID, "cms-library", LIBRARY_APPROACH));
  entities.push(approachEntity(STICKY_INTERACTION_ID, "cms-sticky-wall", STICKY_APPROACH));
  entities.push(approachEntity(PRINTER_INTERACTION_ID, "cms-print-credenza", PRINTER_APPROACH));
  const leaf = { kind: "glass-door-leaf", roomId: CMS_ROOM_ID, source: { baked: true } as const };
  entities.push({
    ...leaf, id: DOOR_NORTH_ID,
    transform: { pos: { ...DOOR_LEAF_CLOSED.north }, yaw: -Math.PI / 2 },
    capabilities: { door: ENTRY_DOOR },
    props: { w: DOOR_LEAF_W, h: STRUCT.wallHeight, handle: 1 }, // handle on the leading (south) stile
  });
  entities.push({
    ...leaf, id: DOOR_SOUTH_ID,
    transform: { pos: { ...DOOR_LEAF_CLOSED.south }, yaw: -Math.PI / 2 },
    capabilities: {},
    props: { w: DOOR_LEAF_W, h: STRUCT.wallHeight, handle: -1 },
  });
  return entities;
}
