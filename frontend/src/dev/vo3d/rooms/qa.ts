// vo3d rooms — QA ROOM definition (data only, WORLD coordinates).
//
// Phase 11, and the LAST room on the floor. The office's south-west corner room, below the Design Room and
// west of the north–south hall. ONE entrance: a bi-parting glass door in the EAST wall.
//
// THIS ROOM IS THE STRONGEST TEST OF THE FLAT-REFERENCE PIPELINE, because it is the only room with NO
// separated production art at all — one PNG, a manifest rect, a walkability grid and a seat-direction
// table, and nothing else. Two things make that workable rather than guesswork:
//
//   1. rooms/qa-room.png is drawn very close to TOP-DOWN (unlike Dev's or AI's obliques), so its plan is
//      almost literally a plan. Every position below is read off it at 0.12499 units/px in x and 0.12495
//      in z, and stated as a world number so a later reader can re-measure it.
//   2. V1's own grid and seatDirections agree with that plan to within a cell nearly everywhere, which is
//      what lets the two be cross-checked instead of either being trusted alone.
//
// Where they disagree the reason is always the same one every prior room met — the painting cannot be
// physically right at Player scale — and the correction is documented at the constant that carries it.
//
//   • rect      → the READ-ONLY V1 asset manifest ("qa-room": x 8.08, z 596.5, 320.217 × 258.649)
//   • door      → the grid's '+' cells, cols 19–20 × rows 41–44 (z 656…720), with 's' stands at col 18
//                 (inside, x 296) and col 21 (out in the hall, x 344)
//   • seats     → the grid's 'o' cells, which are exactly data/seatDirections.ts "qa-room": ONE lead chair
//                 at (160, 648) facing "front" = south into its desk; TWO visitor chairs at (152 | 184,
//                 696) facing "back" = north; FOUR bench chairs at (120, 720 | 768) facing "right" = east
//                 and (224, 720 | 768) facing "left" = west; and the lounge, whose nine merged cells
//                 V1 reduces to ONE seat at (59.56, 740.44) facing "right" = east.
//                 8 seats, which is exactly what data/roomSeats counts for this room.
//   • the rest  → measured off rooms/qa-room.png
//
// The flat reference is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, DoorCapability, Entity, LoungeSeatSlot, RoomDef, SeatCapability } from "../world/WorldState";
import type { MatKey } from "../render/Materials";
import { CELL } from "../adapters/v1Grid";
import { v1RoomRect } from "../adapters/v1Manifest";
import { STRUCT } from "./reception";
import { SOFA_ARM_W, SOFA_CUSHION_GAP, SOFA_CUSHION_MARGIN, sofaCushionZ } from "../build/furniture";
import { QA_LEAD_CHAIR, QA_POUF, QA_SOFA, QA_TASK_CHAIR, SCREEN_D } from "../build/qa-furniture";
import { kindFootprint } from "./footprint";

export const QA_ROOM_ID = "qa-room";
export const RECT: Rect = v1RoomRect(QA_ROOM_ID); // x 8.08, z 596.5, w 320.217, d 258.649

// ============================= THEME ============================================================
/** ROOM-LEVEL COLOUR TABLE, the same seam Gaming, the Central Hub, Executive, CMS, AI and Dev use. The QA
 *  room is the office's CALM STUDIO and its only GREEN space — a soft mint floor, cream linen seating,
 *  light oak and white worktops, with one deep TEAL running through every accent. Nothing here is
 *  borrowed: it is the newest palette on the floor precisely BECAUSE the room has no separated art to
 *  inherit, and copying another room's colours is the one failure mode that was actually available. */
export const THEME = {
  /** the signature accent: the pouf, the storage boxes, the bench screens and rails, every book cover */
  teal: "qaTeal",
  tealDeep: "qaTealDeep",
  /** light oak: the credenza carcass, the lounge shelf, the coffee table, the lead desk's apron */
  oak: "qaOak",
  oakDark: "qaOakDark",
  /** every desk top and the credenza worktop */
  white: "qaWhite",
  /** the sofa and all seven task chairs */
  linen: "qaLinen",
  linenDeep: "qaLinenDeep",
  /** chair frames, five-star bases, desk legs */
  frame: "qaFrame",
  /** walls */
  plaster: "qaPlaster",
  /** the lounge rug */
  rug: "qaRug",
  rugBorder: "qaRugBorder",
  /** the north whiteboard's face */
  board: "qaBoard",
  /** the dark UI ground the room's few displays are drawn on */
  screen: "qaScreenUi",
} satisfies Record<string, MatKey>;

// ============================= ARCHITECTURE =====================================================
// THE SAME CORRECTION EVERY ROOM SINCE GAMING HAS MADE. V1 blocks rows 37–39 across the whole north of
// this room (z 592…640) and cols 0–2 down the west (x 0…48). Neither is wall: the north band is the drawn
// depth of the storage credenza standing against the wall, and the west columns are the window wall's
// mullion run plus the lounge behind it. Rebuilt as mass they would eat the room's north lane and its
// whole lounge pocket.
//
// So every wall here is a REAL 12-unit wall on the art box, the credenza run is real furniture with a real
// footprint, the whiteboard is a hung panel with none, and navigation comes from that geometry
// (DERIVED_ROOM_IDS) rather than from the painting. The V1 grid file itself is untouched.
export const WALL_T = 12;
export const WEST_OUTER_X = 8, WEST_X = 20;
export const EAST_X = 316, EAST_OUTER_X = 328;
/** The art box's north edge is 596.5. Rounding the wall's outer face to 596 (half a unit out, the only
 *  fractional edge on the floor) keeps every derived number in this file whole AND lands NORTH_Z exactly
 *  on grid row 38's boundary, which is where V1's own painted floor starts. */
export const NORTH_OUTER_Z = 596, NORTH_Z = 608;
export const SOUTH_Z = 843, SOUTH_OUTER_Z = 855;

/** The V1 '+' door band is cols 19–20 × rows 41–44 — z 656…720, 64 units, exactly the CMS room's width.
 *  Taken verbatim: nothing stands near either jamb, so no correction is needed. 64 is two leaves wide, so
 *  it is rebuilt BI-PARTING on Reception's own entrance controller, as CMS's and Executive's are. */
export const DOOR = { z0: 656, z1: 720 };
/** V1's own authored stand cells either side of it: col 18 inside the room and col 21 out in the hall. */
export const DOOR_STANDS = { inside: { x: 296, z: 688 }, outside: { x: 344, z: 688 } };

/** Walkable floor region: inside all four walls. 296 × 235. */
export const FLOOR_RECT: Rect = { x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z };
/** The tiled plate, run to the walls' OUTER faces so no void is left under them. */
export const TILE_RECT: Rect = { x: WEST_OUTER_X, z: NORTH_OUTER_Z, w: EAST_OUTER_X - WEST_OUTER_X, d: SOUTH_OUTER_Z - NORTH_OUTER_Z };

export const NORTH_WALL = { x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: NORTH_Z, h: STRUCT.wallHeight };
export const SOUTH_WALL = { x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: SOUTH_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
/** WEST ELEVATION. The reference glazes the WHOLE west side — a mullioned window wall from floor to head,
 *  which is the room's best feature and the only exterior glazing on this side of the building. It is
 *  still a sealed boundary: this is the office's west face, and there is nothing beyond it to walk to. */
export const WEST_GLASS = { x0: WEST_OUTER_X, x1: WEST_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight, bays: 9 };
/** EAST ELEVATION: solid either side of the entrance, which sits in the middle of it. */
export const EAST_WALL_N = { x0: EAST_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: DOOR.z0, h: STRUCT.wallHeight };
export const EAST_WALL_S = { x0: EAST_X, x1: EAST_OUTER_X, z0: DOOR.z1, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
/** shoe height for the window wall: enough to read as architecture, low enough to stay under a sightline */
export const GLASS_SPANDREL = 8;

// ============================= THE NORTH STORAGE RUN ============================================
// The reference's north elevation is one long low run of storage: a white worktop over light oak carcasses
// with teal box files in them, carrying books, two framed prints and four small plants.
//
// DEPTH IS SET BY CIRCULATION, not by the painting. The flat unit reads ~32 deep because the render draws
// its front face; at 32 the lane between it and the lead workstation closes to 10. 20 is a real credenza
// and leaves that lane 22 — which is what makes the room's north side usable.
export const RUN_D = 20;
export const CREDENZA: Rect & { h: number; modules: number } = { x: 46, z: NORTH_Z, w: 154, d: RUN_D, h: 22, modules: 5 };
export const CREDENZA_FRONT = NORTH_Z + RUN_D; // 628
/** The framed "EXCELLENCE THROUGH FOCUS & IMPACT" print and the pair of botanical prints on the worktop. */
export const PRINT_X = 94, PRINT_PAIR_X = 150;

// THE NORTH WALL EAST OF THE CREDENZA IS LEFT BARE. The flat reference hangs a work-rate board there
// ("ALWAYS GIVE A 100% AT WORK", over a MON–FRI percentage list); it is deliberately NOT reconstructed,
// and nothing replaces it — no board, sign, screen or artwork. That stretch of wall is plain plaster with
// the north-east plant standing in front of it, which is what the room reads as now.
export const PANEL_D = 3;

// ============================= THE EAST CREDENZA ================================================
/** The white supply unit down the east wall south of the entrance, with teal trays and two plants on it. */
export const EAST_CREDENZA: Rect & { h: number; modules: number } = { x: 296, z: 720, w: EAST_X - 296, d: 66, h: 24, modules: 3 };

// ============================= WORKSTATIONS =====================================================
/** THE LEAD DESK. The reference draws it at z 650…680; it is built 6 south of that, at 656…686, and that
 *  is the room's ONE architectural correction. At the drawn position the lead chair (which faces south
 *  into the desk and therefore rolls back NORTH) has 4.7 units between its own back and the credenza —
 *  less than a chair needs to leave. Six south gives it 10.7, which is a real roll-back, and the chair
 *  still lands inside V1's own seat cell. */
export const LEAD_DESK: Rect & { h: number } = { x: 128, z: 656, w: 60, d: 30, h: 24 };

/** V1 seat cell (160, 648) — the lead chair NORTH of its desk, facing "front" = south into it. One unit
 *  south of the cell centre, which is all the desk's own move costs it. */
export const LEAD_CHAIR = { id: "lead-chair", x: 160, z: 647 };
export const LEAD_CHAIR_SIZE = 18;

/** V1 seat cells (152, 696) and (184, 696) — the two visitor chairs, facing "back" = north into the lead
 *  desk. Two units north of their cell centres so they clear both the desk in front and the bench pods
 *  behind; still inside grid row 43 (z 688…704). */
export const VISITOR_CHAIR_Z = 694;
export const VISITOR_CHAIR_SIZE = 17;
export const VISITOR_CHAIRS = [
  { id: "visitor-chair-west", x: 152, z: VISITOR_CHAIR_Z },
  { id: "visitor-chair-east", x: 184, z: VISITOR_CHAIR_Z },
];

/** THE TWO BENCH PODS. Each is one white bench two places long with a TEAL privacy screen on its INNER
 *  edge, so the two mirror each other across the central aisle — which is exactly what the reference
 *  draws. Measured x 128…156 (+ screen) and 186…214 (+ screen); built 129…160 and 183…214 so the chairs
 *  on V1's own cells clear them.
 *
 *  Z is 704…788, two units south of the drawn 702…785, for the same reason the visitor chairs moved: it
 *  is what leaves them a lane. `screen` names the side the privacy panel stands on. */
export const BENCH_D = 84, BENCH_Z = 746, BENCH_H = 24, BENCH_W = 31;
export const BENCHES = [
  { id: "bench-west", x: 129, screen: "east" as const },
  { id: "bench-east", x: 183, screen: "west" as const },
];
/** V1 seat cells (120 | 224, 720 | 768) — four bench chairs, facing "right"/"left" = east/west INTO the
 *  bench they flank. Every one on its V1 cell centre exactly. `dir` is the pull direction in x. */
export const BENCH_CHAIR_SIZE = 18;
export const BENCH_ROWS_Z = [720, 768];
export const BENCH_CHAIRS = BENCHES.flatMap((_b, bi) =>
  BENCH_ROWS_Z.map((z, ri) => ({
    id: `bench-chair-${bi === 0 ? "w" : "e"}${ri + 1}`,
    x: bi === 0 ? 120 : 224,
    z,
    dir: (bi === 0 ? -1 : 1) as -1 | 1, // the west pod's chairs roll back west, the east pod's east
  })));

/** THE LANES. West 102 and east 248 are the two north–south aisles the bench chairs are reached from;
 *  the centre aisle at 171.5 is the slot between the two privacy screens, open to the south lane.
 *  North 639 is the credenza's apron, middle 695 the gap between the lead desk and the pods, and south
 *  810 the room's whole open southern half.
 *
 *  TWO of these are deliberately NOT continuous, and the reference is why:
 *   • the NORTH lane is interrupted at x 144…176 by the lead chair, which stands in it exactly as the
 *     render draws it tucked under the credenza. A body goes round the lead workstation, not through it.
 *   • the MIDDLE lane is interrupted at x 136…200 by the two visitor chairs, for the same reason.
 *  Both are reachable from either end, and the room's circulation is the big southern space — which is
 *  what the reference's own composition is. qa.test.ts asserts the open spans rather than pretending
 *  otherwise. */
export const WEST_LANE = 102, EAST_LANE = 248, CENTRE_AISLE = 171.5;
export const NORTH_LANE_Z = 639, MIDDLE_LANE_Z = 695, SOUTH_LANE_Z = 810;

// ============================= THE LOUNGE =======================================================
// The reference's west side, along the window wall: an oak shelf unit, the cream sofa facing the room, a
// teal pouf and a round oak coffee table on an oatmeal rug, with a big plant at its south corner.

/** THE SOFA. Drawn x 31.8…57.1, z 715.3…775.3, facing EAST into the room. Its LENGTH comes from the shared
 *  cushion arithmetic so the cushions land where a sitter expects them. */
export const SOFA_SEATS = 3, SOFA_DEPTH = 25, SOFA_LEN = 60;
export const SOFA_CUSH_D = (SOFA_LEN - 2 * SOFA_ARM_W - (SOFA_SEATS - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / SOFA_SEATS;
export const SOFA_X = 44, SOFA_Z = 745;
export const SOFA_CUSHION_X = SOFA_X + QA_SOFA.cushionLocalX;
/** THE POUF and THE COFFEE TABLE, at their drawn centres. */
export const POUF = { id: "lounge-pouf", x: 82, z: 730, r: 10 };
export const COFFEE_TABLE = { id: "coffee-table", x: 73, z: 766, r: 12 };
/** THE OAK SHELF UNIT at the lounge's head, with the framed print and two plants the render puts on it. */
export const LOUNGE_SHELF: Rect & { h: number; shelves: number } = { x: 34, z: 694, w: 28, d: 17, h: 22, shelves: 2 };
/** The oatmeal rug the whole pocket stands on. Floor dressing: walked straight over. */
export const RUG: Rect = { x: 33, z: 696, w: 60, d: 100 };
/** The lounge's one stand point, at the east side of its pocket — everything in it is reached by walking
 *  down the lane between the sofa and the pouf, the same device the CMS lounge uses. */
export const LOUNGE_APPROACH: Vec2 = { x: WEST_LANE, z: 745 };
export const LOUNGE_LANE_X = 66;

// ============================= PLANTING =========================================================
/** The four floor plants the reference stands in pale pots: one each side of the storage run, one at the
 *  lounge's south corner and one at the supply credenza's south end. Heights are capped by the 46-unit
 *  wall exactly as every other room's are. */
export const PLANTS = [
  { id: "plant-nw", x: 36, z: 628, r: 8, h: 27 },
  { id: "plant-ne", x: 288, z: 628, r: 8, h: 27 },
  { id: "plant-lounge", x: 40, z: 792, r: 8, h: 28 },
  { id: "plant-supply", x: 304, z: 800, r: 7, h: 25 },
];

// ============================= WALLS AS DATA ====================================================
/** THE ROOM'S PHYSICAL WALLS for derived navigation (nav/solids.ts) — the same runs build/qa.ts extrudes,
 *  as world rects. The V1 '+' door band is the ONE gap and nothing is declared inside it. */
export const QA_WALLS: Rect[] = [
  { x: NORTH_WALL.x0, z: NORTH_WALL.z0, w: NORTH_WALL.x1 - NORTH_WALL.x0, d: NORTH_WALL.z1 - NORTH_WALL.z0 },
  { x: SOUTH_WALL.x0, z: SOUTH_WALL.z0, w: SOUTH_WALL.x1 - SOUTH_WALL.x0, d: SOUTH_WALL.z1 - SOUTH_WALL.z0 },
  { x: WEST_GLASS.x0, z: WEST_GLASS.z0, w: WEST_GLASS.x1 - WEST_GLASS.x0, d: WEST_GLASS.z1 - WEST_GLASS.z0 },
  { x: EAST_WALL_N.x0, z: EAST_WALL_N.z0, w: EAST_WALL_N.x1 - EAST_WALL_N.x0, d: EAST_WALL_N.z1 - EAST_WALL_N.z0 },
  { x: EAST_WALL_S.x0, z: EAST_WALL_S.z0, w: EAST_WALL_S.x1 - EAST_WALL_S.x0, d: EAST_WALL_S.z1 - EAST_WALL_S.z0 },
];

const rectOf = (r: Rect): Rect => ({ x: r.x, z: r.z, w: r.w, d: r.d });

/** The FIXED fit-out — the north storage run, the east supply credenza and the lounge shelf. Drawn by
 *  build/qa.ts and registered as footprint-only entities so derived navigation sees exactly what the
 *  camera does. The hung quality board is deliberately absent: it starts 18 above the floor. */
export const QA_SOLIDS: (Rect & { id: string })[] = [
  { id: "credenza", ...rectOf(CREDENZA) },
  { id: "east-credenza", ...rectOf(EAST_CREDENZA) },
  { id: "lounge-shelf", ...rectOf(LOUNGE_SHELF) },
];

export const QA_ROOM: RoomDef = {
  id: QA_ROOM_ID,
  name: "QA Room",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: QA_WALLS,
  // no `shell`: solid north/south, a glazed west window wall and a split east elevation with a bi-parting
  // entrance — its own static builder, exactly as every reconstructed room since Reception has.
};

// ============================= INTERACTIONS =====================================================
// Nothing below adds geometry or a new system. Movable chairs use SeatCapability, fixed lounge seating
// uses LoungeSeatCapability, walk-ups use ApproachCapability and the entrance uses the SAME bi-parting
// SlidingDoor Reception, Executive and CMS drive.

/** How far a chair rolls back off its desk. The lead chair has the credenza behind it and takes 6; the
 *  visitor chairs are wedged between the lead desk and the bench pods and take 4 — which is what the
 *  reference's own spacing allows, and is stated here rather than pretended away. The bench chairs open
 *  onto the two main aisles and take 8. */
export const LEAD_PULL = 6, VISITOR_PULL = 4, BENCH_PULL = 8;
/** How far the chair stays out from rest WHILE OCCUPIED (SeatCapability.seatedTuck). 3 is a real chair
 *  under a real desk and still leaves the roll-back the pull provides — the figure CMS settled on. */
export const SEATED_TUCK = 3;

/** ONE desk chair, on either axis. `axis` is the pull axis; `dir` its sign (away from the desk). preSeat
 *  is the spot in the gap the pulled chair vacates, 4 units back toward the desk. */
function deskChairSeat(
  chair: { x: number; z: number }, approach: Vec2, axis: "x" | "z", dir: -1 | 1, pull: number,
  metrics: { cushionTop: number; cushionLocalZ: number }, yaw: number,
): SeatCapability {
  const preSeat: Vec2 = axis === "x" ? { x: chair.x - dir * 4, z: chair.z } : { x: chair.x, z: chair.z - dir * 4 };
  return {
    approach,
    preSeat,
    approachToSeat: axis === "x" ? [{ x: approach.x, z: preSeat.z }, preSeat] : [{ x: preSeat.x, z: approach.z }, preSeat],
    pullDir: axis === "x" ? { x: dir, z: 0 } : { x: 0, z: dir },
    pullDistance: pull,
    seatedTuck: SEATED_TUCK,
    cushionTopY: metrics.cushionTop,
    cushionLocal: { x: 0, z: metrics.cushionLocalZ },
    sitDepth: 3.5,
    seatedYaw: yaw,
    timings: { pullMs: 860, sitMs: 650, slideMs: 760, standMs: 650, returnMs: 860 },
  };
}

/** The LEAD chair, approached from the credenza's apron 26 west of it — the north lane is blocked at the
 *  chair's own x by the chair, so the body walks up beside the workstation rather than into it. */
export const LEAD_SEAT: SeatCapability =
  deskChairSeat(LEAD_CHAIR, { x: 134, z: NORTH_LANE_Z }, "z", -1, LEAD_PULL, QA_LEAD_CHAIR, FACING_YAW.south);

/** The two VISITOR chairs, approached from the ends of the middle lane for the same reason. */
export const VISITOR_SEATS: SeatCapability[] = [
  deskChairSeat(VISITOR_CHAIRS[0], { x: 134, z: MIDDLE_LANE_Z }, "z", 1, VISITOR_PULL, QA_TASK_CHAIR, FACING_YAW.north),
  deskChairSeat(VISITOR_CHAIRS[1], { x: 202, z: MIDDLE_LANE_Z }, "z", 1, VISITOR_PULL, QA_TASK_CHAIR, FACING_YAW.north),
];

/** The four BENCH chairs, each approached from the aisle it backs onto, at its own z. */
export const BENCH_SEATS: SeatCapability[] = BENCH_CHAIRS.map((c) =>
  deskChairSeat(c, { x: c.dir === -1 ? WEST_LANE : EAST_LANE, z: c.z }, "x", c.dir, BENCH_PULL, QA_TASK_CHAIR,
    c.dir === -1 ? FACING_YAW.east : FACING_YAW.west));

export const LEAD_CHAIR_ID = `${QA_ROOM_ID}/${LEAD_CHAIR.id}`;
export const VISITOR_CHAIR_IDS = VISITOR_CHAIRS.map((c) => `${QA_ROOM_ID}/${c.id}`);
export const BENCH_CHAIR_IDS = BENCH_CHAIRS.map((c) => `${QA_ROOM_ID}/${c.id}`);
/** every MOVABLE chair in the room, in GUI order — 1 lead + 2 visitor + 4 bench = 7, which with the
 *  lounge's merged V1 cell is exactly the 8 seats V1 counts. EVERY one of these must be reachable by the
 *  per-frame SeatInteraction tick in app/bootstrap.ts, which is the Executive-chair bug qa.test.ts
 *  exists to prevent. */
export const QA_SEAT_IDS = [LEAD_CHAIR_ID, ...VISITOR_CHAIR_IDS, ...BENCH_CHAIR_IDS];

// ---- FIXED lounge seating ------------------------------------------------------------------------
/** 1.5 forward of the cushion centre: the sitter lands ON the cushion instead of wedged into the back. */
const SOFA_CONTACT_FORWARD = 1.5;
export const SOFA_ID = `${QA_ROOM_ID}/lounge-sofa`;
export const POUF_ID = `${QA_ROOM_ID}/${POUF.id}`;
export const QA_LOUNGE_IDS = [SOFA_ID, POUF_ID];

export function sofaSlots(): LoungeSeatSlot[] {
  return [0, 1, 2].map((i) => {
    const lz = sofaCushionZ(i, SOFA_SEATS, SOFA_CUSH_D);
    return {
      id: `sofa-${["north", "centre", "south"][i]}`,
      contactLocal: { x: QA_SOFA.cushionLocalX + SOFA_CONTACT_FORWARD, y: QA_SOFA.cushionTop, z: lz },
      seatedYaw: FACING_YAW.east, // V1 "right": the sofa's back is the window wall; its sitters look in
      approach: { ...LOUNGE_APPROACH },
      approachToSeat: [{ x: LOUNGE_LANE_X, z: LOUNGE_SHELF.z + LOUNGE_SHELF.d }, { x: LOUNGE_LANE_X, z: SOFA_Z + lz }],
      sink: 0,
      timings: { sitMs: 780, standMs: 720 },
    };
  });
}

/** The pouf is a seat too — V1's merged lounge blob covers it, and the reference draws an ottoman, not an
 *  ornament. It looks WEST, back across the coffee table toward the sofa and the window. */
export function poufSlot(): LoungeSeatSlot {
  return {
    id: "pouf-seat",
    contactLocal: { x: 0, y: QA_POUF.cushionTop, z: QA_POUF.contactLocalZ },
    seatedYaw: FACING_YAW.west,
    approach: { ...LOUNGE_APPROACH },
    approachToSeat: [{ x: 96, z: POUF.z }],
    sink: 1.4,
    timings: { sitMs: 780, standMs: 720 },
  };
}

// ---- walk-up points ------------------------------------------------------------------------------
// Physical anchors only: somewhere to stand and something to face. Each point is a body-clear spot on the
// derived floor, checked against every solid within NAV_RADIUS of it (qa.test.ts asserts that).
export const STORAGE_APPROACH: ApproachCapability = { point: { x: 102, z: 640 }, yaw: FACING_YAW.north, label: "Team storage", action: "Open a box file" };
export const SUPPLY_APPROACH: ApproachCapability = { point: { x: 284, z: 752 }, yaw: FACING_YAW.east, label: "Supply station", action: "Collect a report" };
export const SHELF_APPROACH: ApproachCapability = { point: { x: 80, z: 700 }, yaw: FACING_YAW.west, label: "Reading shelf", action: "Pick up a book" };
export const WINDOW_APPROACH: ApproachCapability = { point: { x: 40, z: 660 }, yaw: FACING_YAW.west, label: "The window wall", action: "Look outside" };

export const STORAGE_INTERACTION_ID = `${QA_ROOM_ID}/storage-interaction`;
export const SUPPLY_INTERACTION_ID = `${QA_ROOM_ID}/supply-interaction`;
export const SHELF_INTERACTION_ID = `${QA_ROOM_ID}/shelf-interaction`;
export const WINDOW_INTERACTION_ID = `${QA_ROOM_ID}/window-interaction`;
export const QA_APPROACH_IDS = [
  STORAGE_INTERACTION_ID, SUPPLY_INTERACTION_ID, SHELF_INTERACTION_ID, WINDOW_INTERACTION_ID,
];

// ---- the east entrance ---------------------------------------------------------------------------
/** Bi-parting glass, on the SAME SlidingDoor controller Reception's, Executive's and CMS's entrances use:
 *  the north panel drives and the south one is its `opposed` mirror, so both derive from one `t` and
 *  neither can drift. */
export const DOOR_LEAF_W = (DOOR.z1 - DOOR.z0) / 2; // 32
export const DOOR_X = EAST_OUTER_X - WALL_T / 2; //   322 — the wall's centre plane
export const DOOR_LEAF_CLOSED = {
  north: { x: DOOR_X, z: DOOR.z0 + DOOR_LEAF_W / 2 }, // 672
  south: { x: DOOR_X, z: DOOR.z1 - DOOR_LEAF_W / 2 }, // 704
};
export const DOOR_NORTH_ID = `${QA_ROOM_ID}/entry-door-north`;
export const DOOR_SOUTH_ID = `${QA_ROOM_ID}/entry-door-south`;
const BODY_RADIUS = 10.5; // Bon's widest walking extent, as every other V2 door measures it

export const ENTRY_DOOR: DoorCapability = {
  slide: { x: 0, z: -1 },
  slideDistance: DOOR_LEAF_W,
  automatic: true,
  leaf: { x: DOOR_X - STRUCT.wallThickness / 2, z: DOOR.z0, w: STRUCT.wallThickness, d: DOOR_LEAF_W },
  leafOpposed: { x: DOOR_X - STRUCT.wallThickness / 2, z: DOOR.z0 + DOOR_LEAF_W, w: STRUCT.wallThickness, d: DOOR_LEAF_W },
  /** the doorway itself: while a body overlaps this the door must be open and may not close */
  crossing: { x: EAST_X - 6, z: DOOR.z0 - 4, w: WALL_T + 12, d: DOOR.z1 - DOOR.z0 + 8 },
  /** both approach aprons — the room's east lane inside and the hall lane outside */
  trigger: { x: EAST_X - 68, z: DOOR.z0 - 40, w: 148, d: DOOR.z1 - DOOR.z0 + 80 },
  clearance: {
    bodyRadius: BODY_RADIUS,
    band: { x: 19 * CELL, z: DOOR.z0, w: 2 * CELL, d: DOOR.z1 - DOOR.z0 }, // the V1 '+' cells, verbatim
    solids: [], // nothing stands in the band: the jambs are the opening's own reveals
  },
  timings: { openMs: 900, closeMs: 1100, holdMs: 700 },
};

// ============================= ENTITIES =========================================================
function furniture(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, props: Record<string, string | number | boolean> = {}): Entity {
  return {
    id: `${QA_ROOM_ID}/${id}`,
    kind,
    roomId: QA_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    capabilities: {},
    props: { w, d, facing, mirrored: false, ...props },
  };
}
function plantEntity(p: (typeof PLANTS)[number]): Entity {
  return {
    id: `${QA_ROOM_ID}/${p.id}`,
    kind: "plant",
    roomId: QA_ROOM_ID,
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
    id: `${QA_ROOM_ID}/solid-${s.id}`,
    kind: "solid",
    roomId: QA_ROOM_ID,
    transform: { pos: { x: s.x + s.w / 2, z: s.z + s.d / 2 }, yaw: 0 },
    footprint: { shape: "rect", w: s.w, d: s.d },
    capabilities: {},
    props: {},
    source: { baked: true },
  };
}
function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: QA_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** The room's furniture as world entities. The architecture, the two credenza runs and the lounge shelf
 *  are static (build/qa.ts) and appear here only as footprint-only solids. */
export function qaRoomEntities(): Entity[] {
  const out: Entity[] = [];
  // floor dressing first: the lounge rug is walked straight over (kindFootprint gives it solid: false)
  out.push(furniture("lounge-rug", "qa-rug", RUG.x + RUG.w / 2, RUG.z + RUG.d / 2, RUG.w, RUG.d, "north",
    { color: THEME.rug, accent: THEME.rugBorder }));
  // the lead workstation
  out.push(furniture("lead-desk", "qa-lead-desk", LEAD_DESK.x + LEAD_DESK.w / 2, LEAD_DESK.z + LEAD_DESK.d / 2,
    LEAD_DESK.w, LEAD_DESK.d, "south", { color: THEME.white, accent: THEME.oak, h: LEAD_DESK.h }));
  // the two bench pods, screens to the aisle
  for (const b of BENCHES)
    out.push(furniture(b.id, "qa-bench-desk", b.x + BENCH_W / 2, BENCH_Z, BENCH_W, BENCH_D, "north",
      { color: THEME.white, accent: THEME.teal, frame: THEME.frame, h: BENCH_H, places: 2, screen: b.screen }));
  // the seven MOVABLE chairs
  out.push(furniture(LEAD_CHAIR.id, "qa-lead-chair", LEAD_CHAIR.x, LEAD_CHAIR.z, LEAD_CHAIR_SIZE, LEAD_CHAIR_SIZE, "south",
    { color: THEME.linen, colorSeat: THEME.linenDeep, frame: THEME.frame }));
  for (const c of VISITOR_CHAIRS)
    out.push(furniture(c.id, "qa-task-chair", c.x, c.z, VISITOR_CHAIR_SIZE, VISITOR_CHAIR_SIZE, "north",
      { color: THEME.linen, colorSeat: THEME.linenDeep, frame: THEME.frame }));
  for (const c of BENCH_CHAIRS)
    out.push(furniture(c.id, "qa-task-chair", c.x, c.z, BENCH_CHAIR_SIZE, BENCH_CHAIR_SIZE, c.dir === -1 ? "east" : "west",
      { color: THEME.linen, colorSeat: THEME.linenDeep, frame: THEME.frame }));
  // the lounge
  out.push(furniture("lounge-sofa", "qa-sofa", SOFA_X, SOFA_Z, SOFA_DEPTH, SOFA_LEN, "north",
    { color: THEME.linen, colorSeat: THEME.linen, seats: SOFA_SEATS }));
  out.push(furniture(POUF.id, "qa-pouf", POUF.x, POUF.z, POUF.r * 2, POUF.r * 2, "west", { color: THEME.teal, r: POUF.r }));
  out.push(furniture(COFFEE_TABLE.id, "qa-round-table", COFFEE_TABLE.x, COFFEE_TABLE.z, COFFEE_TABLE.r * 2, COFFEE_TABLE.r * 2, "north",
    { color: THEME.oak, accent: THEME.oakDark, r: COFFEE_TABLE.r }));
  for (const p of PLANTS) out.push(plantEntity(p));
  for (const s of QA_SOLIDS) out.push(solidEntity(s));
  return withQaInteractions(out);
}

/** Hang the capabilities on the entities above: MOVABLE seating on all seven chairs, FIXED lounge seating
 *  on the sofa and the pouf, five walk-up points and the bi-parting east entrance. No geometry, no
 *  transform and no id changes. */
export function withQaInteractions(entities: Entity[]): Entity[] {
  const find = (id: string): Entity => {
    const e = entities.find((x) => x.id === id);
    if (!e) throw new Error(`qa: no entity ${id}`);
    return e;
  };
  find(LEAD_CHAIR_ID).capabilities = { ...find(LEAD_CHAIR_ID).capabilities, seat: LEAD_SEAT };
  VISITOR_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: VISITOR_SEATS[i] }; });
  BENCH_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: BENCH_SEATS[i] }; });
  find(SOFA_ID).capabilities = { lounge: { slots: sofaSlots() } };
  find(POUF_ID).capabilities = { ...find(POUF_ID).capabilities, lounge: { slots: [poufSlot()] } };
  entities.push(approachEntity(STORAGE_INTERACTION_ID, "qa-credenza", STORAGE_APPROACH));
  entities.push(approachEntity(SUPPLY_INTERACTION_ID, "qa-supply", SUPPLY_APPROACH));
  entities.push(approachEntity(SHELF_INTERACTION_ID, "qa-lounge-shelf", SHELF_APPROACH));
  entities.push(approachEntity(WINDOW_INTERACTION_ID, "qa-window-wall", WINDOW_APPROACH));
  const leaf = { kind: "glass-door-leaf", roomId: QA_ROOM_ID, source: { baked: true } as const };
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

/** exported for build/qa.ts: the bench's privacy-screen depth, so the static builder and the furniture
 *  builder cannot disagree about how wide a pod is. */
export { SCREEN_D };
