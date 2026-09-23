// vo3d rooms — AI ROOM definition (data only, WORLD coordinates).
//
// Phase 9. The office's NORTH-WEST corner room, above the Design Room and west of the north corridor that
// runs down to the Executive Room. ONE entrance: a single sliding glass leaf at the EAST end of the SOUTH
// wall, opening onto the north–south hall.
//
// Every number below is DERIVED from production, never invented:
//   • rect      → the READ-ONLY V1 asset manifest ("ai-room": x 7.87, z 8.19, 336 × 291.648)
//   • door      → the grid's '+' cells, cols 19–20 × rows 17–18 (x 304…336, z 272…304), with 's' stands
//                 at (19,16) inside the room and (20,19) out in the hall
//   • desks     → the manifest's OWN ai-team furniture layer: three ai-member-desk-1 boxes at x 79.87 /
//                 159.61 / 239.35, z 146.83, each 30.204 × 115.623, and the ai-lead-desk at x 146.17,
//                 z 80.01, 59.654 × 33.838
//   • seats     → the grid's 'o' cells, which are exactly data/seatDirections.ts "ai-room": ONE lead chair
//                 at (176, 70.12) facing "front" = south into its desk; TWO visitor chairs at (163 | 189,
//                 118.86) facing "back" = north into the same desk; and EIGHTEEN member chairs in six
//                 columns (x 72.87 | 117.08 | 152.61 | 196.82 | 232.35 | 276.56) × three rows (z 172.01 |
//                 203.98 | 235.94), each facing "right"/"left" = east/west INTO the bench it flanks.
//                 21 seats, which is exactly what data/roomSeats counts for this room.
//   • stands    → V1 authored 's' cells around every pod: row 9 above each chair column, and cols 3 / 8 /
//                 13 / 18 down the four aisles at rows 12 and 14. Those aisles ARE the approach lanes.
//   • the rest  → measured off rooms/ai-room.png at 0.24889 units/px in x and 0.25034 in z
//
// The flat reference is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, DoorCapability, Entity, RoomDef, SeatCapability } from "../world/WorldState";
import type { MatKey } from "../render/Materials";
import { CELL } from "../adapters/v1Grid";
import { v1RoomRect } from "../adapters/v1Manifest";
import { STRUCT } from "./reception";
import { AI_LEAD_CHAIR, AI_TASK_CHAIR, AI_VISITOR_CHAIR } from "../build/ai-furniture";
import { kindFootprint } from "./footprint";

export const AI_ROOM_ID = "ai-room";
export const RECT: Rect = v1RoomRect(AI_ROOM_ID); // x 7.87, z 8.19, w 336, d 291.648

// ============================= THEME ============================================================
/** ROOM-LEVEL COLOUR TABLE, the same seam Gaming, the Central Hub, Executive and CMS use. The AI Room is
 *  the office's one COOL-TECH space — near-black carbon joinery and an ELECTRIC BLUE LED line running
 *  through every piece of it, over the coolest, palest floor in the building, with white-and-silver
 *  seating. No builder below names a palette key directly. */
export const THEME = {
  /** bench and lead desk tops: the mid charcoal the desk art is rendered in */
  charcoal: "aiCharcoal",
  /** the north tech wall band, the rack carcasses, screen bezels */
  carbon: "aiCarbon",
  /** every reveal, plinth and recess in the carbon joinery */
  carbonDeep: "aiCarbonDeep",
  /** THE ROOM'S SIGNATURE: the blue LED line in the desk spines, the plinth glow, every wall strip */
  led: "aiLed",
  ledDeep: "aiLedDeep",
  /** the eighteen member task chairs: warm white upholstery */
  seat: "aiSeat",
  /** the lead chair's light grey hide */
  seatLead: "aiSeatLead",
  /** the two visitor tub chairs, a shade lighter again */
  seatVisitor: "aiSeatVisitor",
  /** brushed-silver arms, five-star bases, counter shoe */
  frame: "aiFrame",
  /** the east wall's white lacquer counter run */
  counter: "aiCounter",
  /** walls: the coolest white in the office */
  plaster: "aiPlaster",
  /** the dark UI ground every display in the room is drawn on */
  screen: "aiScreenUi",
  /** the service robot's shell */
  robot: "aiRobot",
} satisfies Record<string, MatKey>;

// ============================= ARCHITECTURE =====================================================
// THE SAME CORRECTION GAMING MADE IN 5A, EXECUTIVE IN 7 AND CMS IN 8. V1 blocks rows 0–2 across the WHOLE
// north of this room (z 0…48) and two whole columns down the west (x 0…32). None of that is wall: it is
// the flat render's baked perspective — the north elevation is drawn as a tall dark band because the
// camera sees the FRONT of the server racks and the display wall, and the west columns are the drawn
// thickness of three wall-mounted screens. Rebuilt as mass it would eat the room's north lane and its
// west circulation entirely.
//
// So every wall here is a REAL 12-unit wall sitting on the art bounding box, the rack run and the east
// counter are real furniture with real footprints, the wall displays are 3-unit panels hung ABOVE floor
// level with no footprint at all, and navigation comes from that geometry (DERIVED_ROOM_IDS) rather than
// from the painting. The V1 grid file itself is untouched.
export const WALL_T = 12;
export const WEST_OUTER_X = 8, WEST_X = 20;
export const EAST_X = 332, EAST_OUTER_X = 344;
export const NORTH_OUTER_Z = 8, NORTH_Z = 20;
export const SOUTH_Z = 288, SOUTH_OUTER_Z = 300;

/** The V1 '+' door band is cols 19–20 × rows 17–18, i.e. x 304…336, and the east wall's inner face is at
 *  332 — so an opening laid straight on the band is clipped to 28, and its west jamb pilaster eats 4 more.
 *  MEASURED, that left only EIGHT units of legal body-centre freedom crossing the threshold: half the
 *  sixteen the Gaming Room's own 32-unit entrance gives, and the tightest doorway in the building. It is
 *  what makes this door snag in Player View.
 *
 *  So the opening is pushed 8 WEST — x 296…332, 36 clear between the jamb reveal and the east wall — which
 *  restores ~21 units of centre freedom through the doorway AND in the apron outside it, comfortably past
 *  the house standard. The V1 '+' cells are unchanged and stay the door's clearance band below; the V1
 *  door art (x 302.52, 31.5 wide) still falls inside the opening. This is the AI Room's one door
 *  correction, and it touches nothing outside this room. */
export const DOOR = { x0: 296, x1: 332 };
/** V1's own authored stand cells either side of it: (19,16) inside the room and (20,19) out in the hall. */
export const DOOR_STANDS = { inside: { x: 312, z: 264 }, outside: { x: 328, z: 312 } };

/** Walkable floor region: inside all four walls. 312 × 268. */
export const FLOOR_RECT: Rect = { x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z };
/** The tiled plate, run to the walls' OUTER faces so no void is left under them. Grout stays phased to the
 *  WORLD by tiledFloor(), so this floor reads continuous with the hall through the doorway. */
export const TILE_RECT: Rect = { x: WEST_OUTER_X, z: NORTH_OUTER_Z, w: EAST_OUTER_X - WEST_OUTER_X, d: SOUTH_OUTER_Z - NORTH_OUTER_Z };

export const NORTH_WALL = { x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: NORTH_Z, h: STRUCT.wallHeight };
export const WEST_WALL = { x0: WEST_OUTER_X, x1: WEST_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
export const EAST_WALL = { x0: EAST_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
/** SOUTH ELEVATION. The reference glazes the whole south side — a framed screen over a low solid spandrel,
 *  with a blue LED line washing its shoe, and the entrance at its east end. Built as ONE glazed run from
 *  the west corner to the door band; nothing is declared inside the band. */
export const SOUTH_GLASS = { x0: WEST_OUTER_X, x1: DOOR.x0, z0: SOUTH_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight, bays: 8 };
/** shoe height for the screen: enough to read as architecture, low enough to stay under every sightline */
export const GLASS_SPANDREL = 9;

// ============================= NORTH TECH RUN ===================================================
// The reference's north-west corner is the room's machine end: the white service robot on its charging
// pad in the very corner, then three server racks with their blue indicator columns. East of x 98 the
// north wall carries NOTHING on the floor — it is all hung display — which is what leaves the lead
// workstation its 60-unit lane.
//
// DEPTH IS SET BY CIRCULATION, not by the painting. V1's flat band reads 48 deep because the render draws
// the racks' FRONT faces in perspective; at 48 the lane past them closes to nothing. 24 is a real rack
// (0.7 m at this room's scale) and leaves the west aisle its full width.
export const RUN_D = 24;
export const RUN_Z = NORTH_Z;
export const RUN_FRONT = NORTH_Z + RUN_D; // 44

/** CORNER — the robot's charging pad. Slightly deeper than the racks, as the render draws it. */
export const ROBOT_DOCK: Rect & { h: number } = { x: WEST_X, z: RUN_Z, w: 26, d: 26, h: 3.5 };
/** The white service robot standing on it — the single most recognisable object in this room. */
export const ROBOT = { x: 33, z: 33, r: 8.5, h: 34 };
/** THE SERVER RACKS: three bays of dark cabinet with blue indicator columns down every one. */
export const RACKS: Rect & { h: number; bays: number } = { x: 46, z: RUN_Z, w: 52, d: RUN_D, h: 36, bays: 3 };

// ============================= THE MISSION WALL =================================================
// The north wall east of the racks is the room's IDENTITY: a continuous carbon band with vertical blue LED
// strips between four hung panels — the team's strapline, the neural-network dashboard, the mission list
// and the global-deployment map. All of it is hung ABOVE the floor: 3 units proud of the wall face, no
// footprint, nothing to walk into.
export const WALL_BAND = { x0: 98, x1: 318, y0: 17, y1: 45 };
export const PANEL_D = 3;
export const PANELS = [
  { id: "strapline", x0: 100, x1: 136, y0: 22, y1: 42, kind: "text" },
  { id: "neural-dash", x0: 138, x1: 214, y0: 20, y1: 43, kind: "brain" },
  { id: "mission", x0: 216, x1: 256, y0: 22, y1: 42, kind: "mission" },
  { id: "deploy-map", x0: 258, x1: 316, y0: 21, y1: 43, kind: "map" },
] as const;

// ============================= THE WEST DISPLAY STACK ===========================================
/** Three tall schematic displays stacked down the west wall — SYSTEM ARCHITECTURE over DATA PIPELINE
 *  OVERVIEW over the model schematic. Same treatment as the mission wall: hung, 3 proud, no footprint. */
export const WEST_PANELS = [
  { id: "system-architecture", z0: 82, z1: 136, title: "SYSTEM\nARCHITECTURE" },
  { id: "data-pipeline", z0: 138, z1: 175, title: "DATA\nPIPELINE\nOVERVIEW" },
  { id: "model-schematic", z0: 177, z1: 234, title: "" },
] as const;
export const WEST_PANEL_Y = { y0: 12, y1: 42 };

// ============================= THE EAST COUNTER =================================================
/** The white lacquer run down the east wall, with a blue LED line under its lip: the tea point at its
 *  north end, a plant, and the lab printer at its south end. The flat box straddles the wall because the
 *  render draws the counter's TOP; built 22 deep against the inner face it leaves the east pod a
 *  25-unit lane, which is what makes that side of the room usable. */
export const COUNTER: Rect & { h: number; modules: number } = { x: 310, z: 86, w: EAST_X - 310, d: 148, h: 26, modules: 4 };
export const COFFEE_Z = 126, PRINTER_Z = 212;

// ============================= WORKSTATIONS =====================================================
// V1's own manifest draws the cluster: THREE identical bench desks running north–south, each flanked by a
// column of three chairs on either side. That is the whole floor plan, and it is what makes this an AI
// team room rather than a room of private desks.
//
// THE BENCH IS KEPT AT ITS V1 WIDTH. 30.2 units is a compact laptop bench (about 0.9 m across, two 0.45 m
// places back to back over a shared cable spine), and the art agrees — the desks carry laptops, not deep
// workstations. Widening them is NOT affordable: the pod-to-pod aisles are 19.7 units and NAV_RADIUS is 8,
// so every unit added to a bench comes straight out of the only circulation this room has. The desk's
// SPINE is what the extra depth would have bought anyway, and it is built as real geometry.
export const BENCH_W = 30, BENCH_D = 116, BENCH_H = 24;
/** manifest z 146.83 + 115.623 / 2 */
export const BENCH_Z = 204.64;
/** manifest x + 30.204 / 2, verbatim */
export const BENCH_XS = [94.97, 174.71, 254.45];

/** THE LEAD WORKSTATION, verbatim from the manifest's ai-lead-desk box (x 146.17, z 80.01, 59.654 wide).
 *  Depth is squared to 34 — the flat box's 33.838 carries the PNG's drop shadow. */
export const LEAD_DESK = { x: 176, z: 97, w: 60, d: 34, h: 24 };

/** V1 seat cell (176, 70.12): the lead chair NORTH of its desk, facing "front" = south into it. */
export const LEAD_CHAIR = { id: "lead-chair", x: 176, z: 70, w: 18, d: 30 };

// VISITOR CHAIRS — THE ONE SEAT CORRECTION IN THIS ROOM. V1 puts both at z 118.86, where their plan
// circles overlap the lead desk's own south edge (114) by 2.7 units and leave only 15.8 to the bench
// row behind them — a body at NAV_RADIUS does not fit in that lane. Moved to z 122 they clear the desk
// by half a unit and open the lane to 17.2, and both stay inside V1's own cell (row 7, z 112…128).
export const VISITOR_CHAIRS = [
  { id: "visitor-chair-west", x: 163, z: 122 },
  { id: "visitor-chair-east", x: 189, z: 122 },
] as const;
export const VISITOR_SIZE = { w: 18, d: 16 };

/** The six member chair COLUMNS. `dir` is the pull axis in x: −1 = the bench is EAST of the chair, so it
 *  faces east and rolls back west; +1 is its mirror. Every x is the manifest chair-box centre verbatim. */
export const MEMBER_COLS = [
  { x: 72.87, dir: -1 as const, aisle: 0 },
  { x: 117.08, dir: 1 as const, aisle: 1 },
  { x: 152.61, dir: -1 as const, aisle: 1 },
  { x: 196.82, dir: 1 as const, aisle: 2 },
  { x: 232.35, dir: -1 as const, aisle: 2 },
  { x: 276.56, dir: 1 as const, aisle: 3 },
];
/** the three chair ROWS, manifest centres verbatim */
export const MEMBER_ROWS_Z = [172.01, 203.98, 235.94];
export const MEMBER_SIZE = { w: 16, d: 24 };

/** THE FOUR AISLES. Each is the centre line of a lane V1 itself authored 's' cells down (cols 3 / 8 / 13 /
 *  18 at rows 12 and 14), nudged to the true midpoint between the two chair circles that define it, so a
 *  body at NAV_RADIUS clears both. West lane 48, pod aisles 135 and 215, east lane 296. */
export const AISLES = [48, 135, 215, 296];

// ============================= PLANTING =========================================================
/** The two floor plants the reference stands in white pots: one in the north-east corner beside the
 *  counter's head, one in the south-west corner under the display stack. Heights are capped by the
 *  46-unit wall exactly as every other room's are. */
export const PLANTS = [
  { id: "plant-ne", x: 320, z: 56, r: 7.5, h: 26 },
  // x is capped at 32.35 and z at 264 by the WEST AISLE and the SOUTH CROSS-LANE either side of it — the
  // art stands this plant at (30.9, 259), so it goes in its corner without narrowing a lane
  { id: "plant-sw", x: 30, z: 262, r: 8.5, h: 28 },
];

// ============================= WALLS AS DATA ====================================================
/** THE ROOM'S PHYSICAL WALLS for derived navigation (nav/solids.ts) — the same runs build/ai.ts extrudes,
 *  as world rects. The V1 '+' door band is the ONE gap and nothing is declared inside it. */
export const AI_WALLS: Rect[] = [
  { x: NORTH_WALL.x0, z: NORTH_WALL.z0, w: NORTH_WALL.x1 - NORTH_WALL.x0, d: NORTH_WALL.z1 - NORTH_WALL.z0 },
  { x: WEST_WALL.x0, z: WEST_WALL.z0, w: WEST_WALL.x1 - WEST_WALL.x0, d: WEST_WALL.z1 - WEST_WALL.z0 },
  { x: EAST_WALL.x0, z: EAST_WALL.z0, w: EAST_WALL.x1 - EAST_WALL.x0, d: EAST_WALL.z1 - EAST_WALL.z0 },
  { x: SOUTH_GLASS.x0, z: SOUTH_GLASS.z0, w: SOUTH_GLASS.x1 - SOUTH_GLASS.x0, d: SOUTH_GLASS.z1 - SOUTH_GLASS.z0 },
];

const rectOf = (r: Rect): Rect => ({ x: r.x, z: r.z, w: r.w, d: r.d });

/** The FIXED fit-out — the robot's dock, the rack run and the east counter. Drawn by build/ai.ts and
 *  registered as footprint-only entities so derived navigation sees exactly what the camera does. The
 *  hung display panels are deliberately absent: they start 12 above the floor and no body meets them. */
export const AI_SOLIDS: (Rect & { id: string })[] = [
  { id: "robot-dock", ...rectOf(ROBOT_DOCK) },
  { id: "racks", ...rectOf(RACKS) },
  { id: "counter", ...rectOf(COUNTER) },
];

export const AI_ROOM: RoomDef = {
  id: AI_ROOM_ID,
  name: "AI Room",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: AI_WALLS,
  // no `shell`: solid north/west/east plus a glazed south elevation with a single sliding entrance — its
  // own static builder, exactly as Reception, Gaming, the Central Hub, Executive and CMS do.
};

// ============================= INTERACTIONS =====================================================
// Nothing below adds geometry or a new system. Every movable chair uses SeatCapability, every walk-up uses
// ApproachCapability and the entrance uses the SAME SlidingDoor controller the Gaming Room's west door
// runs on. There is no fixed lounge seating in this room — V1 gives it none.

/** How far a chair rolls back off its bench. The member chairs open onto a 19.7-unit aisle and take 9;
 *  the lead and visitor chairs have the room's deepest lanes behind them and take the full 11. */
export const MEMBER_PULL = 9, LEAD_PULL = 11, VISITOR_PULL = 10;
/** How far the chair stays out from rest WHILE OCCUPIED (SeatCapability.seatedTuck). 3 is a real chair
 *  under a real desk and still leaves the roll-back the pull provides — the figure CMS settled on. */
export const SEATED_TUCK = 3;

/** ONE desk chair, on either axis. `axis` is the pull axis; `dir` its sign (away from the desk). preSeat
 *  is the spot in the gap the pulled chair vacates, 4 units back toward the desk, exactly as CMS derives
 *  it — sit-down starts there. */
function deskChairSeat(
  chair: { x: number; z: number }, approach: Vec2, axis: "x" | "z", dir: -1 | 1, pull: number,
  metrics: { cushionTop: number; cushionLocalZ: number }, yaw: number,
): SeatCapability {
  const preSeat: Vec2 = axis === "x" ? { x: chair.x - dir * 4, z: chair.z } : { x: chair.x, z: chair.z - dir * 4 };
  return {
    approach,
    preSeat,
    // the approach cell and the preSeat share the chair's OTHER coordinate, so the walk into the gap is
    // one straight leg down the aisle's cross-axis
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

/** The EIGHTEEN member chairs, in column-major order (column 0 rows 0–2, column 1 rows 0–2, …) — which is
 *  also the order the GUI lists them in. Each one's approach is the aisle cell beside it. */
export const MEMBER_CHAIRS = MEMBER_COLS.flatMap((col, ci) =>
  MEMBER_ROWS_Z.map((z, ri) => ({
    id: `member-chair-${ci + 1}-${ri + 1}`,
    x: col.x,
    z,
    dir: col.dir,
    approach: { x: AISLES[col.aisle], z } as Vec2,
  })));

export const MEMBER_SEATS: SeatCapability[] = MEMBER_CHAIRS.map((c) =>
  deskChairSeat(c, { ...c.approach }, "x", c.dir, MEMBER_PULL, AI_TASK_CHAIR,
    c.dir === -1 ? FACING_YAW.east : FACING_YAW.west));

/** The LEAD chair. V1 authored 's' cells either side of its pair of 'o' cells (row 4, cols 9 and 12); the
 *  WEST one is taken, pulled 4 north of the cell centre so a body at NAV_RADIUS clears the lead desk. */
export const LEAD_SEAT: SeatCapability =
  deskChairSeat(LEAD_CHAIR, { x: 152, z: 68 }, "z", -1, LEAD_PULL, AI_LEAD_CHAIR, FACING_YAW.south);

/** The two VISITOR chairs, approached from V1's own 's' cells at row 7 (cols 8 and 13), which sit clear of
 *  both the lead desk's ends and the chairs themselves. */
export const VISITOR_SEATS: SeatCapability[] = [
  deskChairSeat(VISITOR_CHAIRS[0], { x: 136, z: 122 }, "z", 1, VISITOR_PULL, AI_VISITOR_CHAIR, FACING_YAW.north),
  deskChairSeat(VISITOR_CHAIRS[1], { x: 216, z: 122 }, "z", 1, VISITOR_PULL, AI_VISITOR_CHAIR, FACING_YAW.north),
];

export const LEAD_CHAIR_ID = `${AI_ROOM_ID}/${LEAD_CHAIR.id}`;
export const VISITOR_CHAIR_IDS = VISITOR_CHAIRS.map((c) => `${AI_ROOM_ID}/${c.id}`);
export const MEMBER_CHAIR_IDS = MEMBER_CHAIRS.map((c) => `${AI_ROOM_ID}/${c.id}`);
/** every MOVABLE chair in the room, in GUI order — 1 lead + 2 visitor + 18 member = the 21 seats V1 counts.
 *  EVERY one of these must be reachable by the per-frame SeatInteraction tick in app/bootstrap.ts, which
 *  is the Executive-chair bug this list and ai.test.ts exist to prevent. */
export const AI_SEAT_IDS = [LEAD_CHAIR_ID, ...VISITOR_CHAIR_IDS, ...MEMBER_CHAIR_IDS];

// ---- walk-up points ------------------------------------------------------------------------------
// Physical anchors only: somewhere to stand and something to face. Each point is a body-clear spot on the
// derived floor, checked against every solid within NAV_RADIUS of it (ai.test.ts asserts that).
export const ROBOT_APPROACH: ApproachCapability = { point: { x: 36, z: 60 }, yaw: FACING_YAW.north, label: "Ops robot", action: "Wake the robot" };
export const RACKS_APPROACH: ApproachCapability = { point: { x: 70, z: 60 }, yaw: FACING_YAW.north, label: "Compute cluster", action: "Check the racks" };
export const MISSION_APPROACH: ApproachCapability = { point: { x: 216, z: 46 }, yaw: FACING_YAW.north, label: "Mission wall", action: "Read the mission" };
export const ARCHITECTURE_APPROACH: ApproachCapability = { point: { x: 40, z: 158 }, yaw: FACING_YAW.west, label: "System architecture", action: "Study the diagram" };
export const COUNTER_APPROACH: ApproachCapability = { point: { x: 297, z: 126 }, yaw: FACING_YAW.east, label: "Tech bar", action: "Make a coffee" };
export const PRINTER_APPROACH: ApproachCapability = { point: { x: 297, z: 212 }, yaw: FACING_YAW.east, label: "Lab printer", action: "Collect a print" };

export const ROBOT_INTERACTION_ID = `${AI_ROOM_ID}/robot-interaction`;
export const RACKS_INTERACTION_ID = `${AI_ROOM_ID}/racks-interaction`;
export const MISSION_INTERACTION_ID = `${AI_ROOM_ID}/mission-interaction`;
export const ARCHITECTURE_INTERACTION_ID = `${AI_ROOM_ID}/architecture-interaction`;
export const COUNTER_INTERACTION_ID = `${AI_ROOM_ID}/counter-interaction`;
export const PRINTER_INTERACTION_ID = `${AI_ROOM_ID}/printer-interaction`;
export const AI_APPROACH_IDS = [
  ROBOT_INTERACTION_ID, RACKS_INTERACTION_ID, MISSION_INTERACTION_ID,
  ARCHITECTURE_INTERACTION_ID, COUNTER_INTERACTION_ID, PRINTER_INTERACTION_ID,
];

// ---- the south entrance --------------------------------------------------------------------------
/** A SINGLE sliding leaf, on the SAME SlidingDoor controller the Gaming Room's west door runs on — V1's
 *  own ai-door.png is one panel, not a bi-parting pair, so this one is too. It fills the opening exactly
 *  and parks entirely clear of it, sliding WEST behind the glazed screen. */
export const DOOR_LEAF_W = DOOR.x1 - DOOR.x0; // 36
export const DOOR_Z = (SOUTH_Z + SOUTH_OUTER_Z) / 2; // 294 — the wall's centre plane
export const DOOR_LEAF_ID = `${AI_ROOM_ID}/south-door`;
export const DOOR_LEAF_CLOSED: Vec2 = { x: DOOR.x0 + DOOR_LEAF_W / 2, z: DOOR_Z }; // 314, 294
const BODY_RADIUS = 10.5; // Bon's widest walking extent, as every other V2 door measures it

export const ENTRY_DOOR: DoorCapability = {
  slide: { x: -1, z: 0 },
  slideDistance: DOOR_LEAF_W,
  automatic: true,
  leaf: { x: DOOR.x0, z: DOOR_Z - STRUCT.wallThickness / 2, w: DOOR_LEAF_W, d: STRUCT.wallThickness },
  /** the doorway itself: while a body overlaps this the door must be open and may not close */
  crossing: { x: DOOR.x0 - 4, z: SOUTH_Z - 6, w: DOOR_LEAF_W + 8, d: WALL_T + 12 },
  /** both approach aprons — the room's south lane inside and the hall lane outside */
  trigger: { x: DOOR.x0 - 40, z: SOUTH_Z - 68, w: DOOR_LEAF_W + 80, d: WALL_T + 148 },
  clearance: {
    bodyRadius: BODY_RADIUS,
    // The SAME shape Gaming's and CMS's bands have: the door's own span ALONG the wall × the V1 '+' band's
    // two cell rows ACROSS it. Both V1 '+' cell centres — (312, 280) and (328, 280) — fall inside it, so
    // A* still crosses on the cells V1 painted; it is the region that now covers the whole opening rather
    // than only the 28 units of it the two cells happened to bound.
    band: { x: DOOR.x0, z: 17 * CELL, w: DOOR.x1 - DOOR.x0, d: 2 * CELL },
    solids: [], // nothing stands in the band: the jambs are the opening's own reveals
  },
  timings: { openMs: 900, closeMs: 1100, holdMs: 700 },
};

// ============================= ENTITIES =========================================================
function furniture(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, props: Record<string, string | number | boolean> = {}): Entity {
  return {
    id: `${AI_ROOM_ID}/${id}`,
    kind,
    roomId: AI_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    capabilities: {},
    props: { w, d, facing, mirrored: false, ...props },
  };
}
function plantEntity(p: (typeof PLANTS)[number]): Entity {
  return {
    id: `${AI_ROOM_ID}/${p.id}`,
    kind: "plant",
    roomId: AI_ROOM_ID,
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
    id: `${AI_ROOM_ID}/solid-${s.id}`,
    kind: "solid",
    roomId: AI_ROOM_ID,
    transform: { pos: { x: s.x + s.w / 2, z: s.z + s.d / 2 }, yaw: 0 },
    footprint: { shape: "rect", w: s.w, d: s.d },
    capabilities: {},
    props: {},
    source: { baked: true },
  };
}
function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: AI_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** The room's furniture as world entities. The architecture, the north tech run and the east counter are
 *  static (build/ai.ts) and appear here only as footprint-only solids. */
export function aiRoomEntities(): Entity[] {
  const out: Entity[] = [];
  // the three bench desks: identical, north–south, each serving three places a side
  BENCH_XS.forEach((x, i) => out.push(furniture(`bench-${i + 1}`, "ai-bench-desk", x, BENCH_Z, BENCH_W, BENCH_D, "north",
    { color: THEME.charcoal, accent: THEME.carbonDeep, led: THEME.led, h: BENCH_H })));
  // the lead workstation
  out.push(furniture("lead-desk", "ai-lead-desk", LEAD_DESK.x, LEAD_DESK.z, LEAD_DESK.w, LEAD_DESK.d, "south",
    { color: THEME.charcoal, accent: THEME.carbonDeep, led: THEME.led, h: LEAD_DESK.h }));
  // the twenty-one MOVABLE chairs
  out.push(furniture(LEAD_CHAIR.id, "ai-lead-chair", LEAD_CHAIR.x, LEAD_CHAIR.z, LEAD_CHAIR.w, LEAD_CHAIR.d, "south",
    { color: THEME.seatLead, frame: THEME.frame }));
  for (const c of VISITOR_CHAIRS)
    out.push(furniture(c.id, "ai-visitor-chair", c.x, c.z, VISITOR_SIZE.w, VISITOR_SIZE.d, "north",
      { color: THEME.seatVisitor, frame: THEME.frame }));
  for (const c of MEMBER_CHAIRS)
    out.push(furniture(c.id, "ai-task-chair", c.x, c.z, MEMBER_SIZE.w, MEMBER_SIZE.d, c.dir === -1 ? "east" : "west",
      { color: THEME.seat, frame: THEME.frame }));
  for (const p of PLANTS) out.push(plantEntity(p));
  for (const s of AI_SOLIDS) out.push(solidEntity(s));
  return withAiInteractions(out);
}

/** Hang the capabilities on the entities above: MOVABLE seating on all twenty-one chairs, six walk-up
 *  points and the single-leaf south entrance. No geometry, no transform and no id changes. */
export function withAiInteractions(entities: Entity[]): Entity[] {
  const find = (id: string): Entity => {
    const e = entities.find((x) => x.id === id);
    if (!e) throw new Error(`ai: no entity ${id}`);
    return e;
  };
  find(LEAD_CHAIR_ID).capabilities = { ...find(LEAD_CHAIR_ID).capabilities, seat: LEAD_SEAT };
  VISITOR_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: VISITOR_SEATS[i] }; });
  MEMBER_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: MEMBER_SEATS[i] }; });
  entities.push(approachEntity(ROBOT_INTERACTION_ID, "ai-robot", ROBOT_APPROACH));
  entities.push(approachEntity(RACKS_INTERACTION_ID, "ai-racks", RACKS_APPROACH));
  entities.push(approachEntity(MISSION_INTERACTION_ID, "ai-mission-wall", MISSION_APPROACH));
  entities.push(approachEntity(ARCHITECTURE_INTERACTION_ID, "ai-west-displays", ARCHITECTURE_APPROACH));
  entities.push(approachEntity(COUNTER_INTERACTION_ID, "ai-counter", COUNTER_APPROACH));
  entities.push(approachEntity(PRINTER_INTERACTION_ID, "ai-printer", PRINTER_APPROACH));
  entities.push({
    id: DOOR_LEAF_ID,
    kind: "glass-door-leaf",
    roomId: AI_ROOM_ID,
    // a leaf in a NORTH/SOUTH wall is the builder's own authoring plane, so yaw stays 0
    transform: { pos: { ...DOOR_LEAF_CLOSED }, yaw: 0 },
    capabilities: { door: ENTRY_DOOR },
    props: { w: DOOR_LEAF_W, h: STRUCT.wallHeight, handle: -1 }, // handle on the leading (west) stile
    source: { baked: true },
  });
  return entities;
}
