// vo3d rooms — DEV ROOM definition (data only, WORLD coordinates).
//
// Phase 10. The office's NORTH-EAST corner room, above the CMS room and east of the Executive Room. ONE
// entrance: a single sliding glass leaf in the middle of the SOUTH wall, opening onto the east–west
// corridor that runs between this room and CMS.
//
// This is the room with the RICHEST separated production art on the floor — eight furniture PNGs and
// twenty-eight manifest boxes — so almost nothing here is inferred:
//   • rect      → the READ-ONLY V1 asset manifest ("dev-room": x 1111.14, z 8, 320.86 × 320.86)
//   • door      → the grid's '+' cells, cols 78–80 × rows 19–20 (x 1248…1296), with 's' stands at
//                 (79,18) inside the room and (79,21) out in the corridor
//   • desks     → the manifest's OWN dev-team furniture layer, verbatim: two dev-lead-desk boxes at
//                 x 1176.19 / 1303.71, z 78.41, 63.239 × 37.961; two dev-bay-desk boxes at x 1154.63 /
//                 1282.15, z 159.95, 106.363 × 66.315; the dev-side-desk at x 1168.15, z 251.73
//   • seats     → the grid's 'o' cells, which are exactly data/seatDirections.ts "dev-team": TWO lead
//                 chairs at (1207.81 | 1335.33, 75.02) facing "front" = south into their desks; FOUR
//                 visitor chairs at (1196.41 | 1219.21 | 1323.93 | 1346.73, 118.49) facing "back" =
//                 north; EIGHT bay chairs at z 156.47 facing "front" = south and EIGHT more at z 232.78
//                 facing "back" = north, four to a bench either side; and the lounge sofa, whose three
//                 cushions V1 lists at (1144.47, 252.71 | 273.50 | 294.28) facing "right" = east.
//                 25 seats, which is exactly what data/roomSeats counts for this room.
//   • stands    → V1 authored 's' cells at both ends of every chair row (cols 72 / 78 / 80 / 86) and
//                 either side of each lead chair. Those rows ARE the approach lanes.
//   • the rest  → measured off rooms/dev-room.png at 0.25587 units/px in both axes
//
// The flat reference is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, DoorCapability, Entity, LoungeSeatSlot, RoomDef, SeatCapability } from "../world/WorldState";
import type { MatKey } from "../render/Materials";
import { CELL } from "../adapters/v1Grid";
import { v1RoomRect } from "../adapters/v1Manifest";
import { STRUCT } from "./reception";
import { SOFA_ARM_W, SOFA_CUSHION_GAP, SOFA_CUSHION_MARGIN, sofaCushionZ } from "../build/furniture";
import { DEV_EXEC_CHAIR, DEV_SOFA, DEV_TASK_CHAIR } from "../build/dev-furniture";
import { kindFootprint } from "./footprint";

export const DEV_ROOM_ID = "dev-room";
export const RECT: Rect = v1RoomRect(DEV_ROOM_ID); // x 1111.14, z 8, w 320.86, d 320.86

// ============================= THEME ============================================================
/** ROOM-LEVEL COLOUR TABLE, the same seam Gaming, the Central Hub, Executive, CMS and AI use. The Dev
 *  Room is the office's NIGHT WORKSHOP — espresso walnut joinery and black leather seating under a cold
 *  blue neon line, against the brightest white walls in the building. It deliberately shares NO palette
 *  key with the AI Room: that room is carbon + silver + LED, this one is dark WOOD + leather + NEON, and
 *  that is what keeps two blue-lit rooms reading as two different rooms. No builder names a key directly. */
export const THEME = {
  /** every desk top, the wall units, the pantry counter */
  walnut: "devWalnut",
  /** their plinths, toe kicks and reveals */
  walnutDark: "devWalnutDark",
  /** rack carcasses, screen bezels, the bay desks' base rail */
  ink: "devInk",
  inkDeep: "devInkDeep",
  /** THE ROOM'S SIGNATURE: the cove line, the sign tubes, the desk underglow */
  neon: "devNeon",
  neonDeep: "devNeonDeep",
  /** the ten black leather chairs */
  leather: "devLeather",
  leatherSeat: "devLeatherSeat",
  /** the lounge sofa and its grey bolsters */
  sofa: "devSofa",
  sofaSeat: "devSofaSeat",
  /** chair arms, five-star bases, counter shoe */
  frame: "devFrame",
  /** walls */
  plaster: "devPlaster",
  /** the dark UI ground every display in the room is drawn on */
  screen: "devScreenUi",
  /** the lounge rug */
  rug: "devMat",
  rugBorder: "devMatBorder",
} satisfies Record<string, MatKey>;

// ============================= ARCHITECTURE =====================================================
// THE SAME CORRECTION GAMING MADE IN 5A, EXECUTIVE IN 7, CMS IN 8 AND AI IN 9. V1 blocks rows 0–2 across
// the WHOLE north of this room (z 0…48), cols 69–71 down the west (x 1104…1168) and cols 86–89 down the
// east. None of that is wall: it is the flat render's baked perspective — the north elevation is drawn as
// a tall band because the camera sees the FRONTS of the bookcase, the build board and the server rack,
// and the side columns are the drawn depth of the west tool wall and the east tea shelf. Rebuilt as mass
// it would eat this room's west circulation entirely.
//
// So every wall here is a REAL 12-unit wall, the wall units are real furniture with real footprints, the
// hung boards and posters are panels with NO footprint at all, and navigation comes from that geometry
// (DERIVED_ROOM_IDS) rather than from the painting. The V1 grid file itself is untouched.
export const WALL_T = 12;
export const WEST_OUTER_X = 1111, WEST_X = 1123;
export const EAST_X = 1420, EAST_OUTER_X = 1432;
export const NORTH_OUTER_Z = 8, NORTH_Z = 20;

/** THE SOUTH WALL IS CLAMPED TO V1'S OWN LINE, and this is the one number in the room that is not the art
 *  box. The art box runs to z 328.86; the CMS room's north wall outer face is at 345. A wall built on the
 *  art box would leave a 16.14-unit corridor between the two rooms whose ONLY cell row (row 20, centres at
 *  z 328) falls inside this room's own wall — i.e. no corridor at all.
 *
 *  V1 itself says where the room ends: its south wall band is rows 19–20 (z 304…336), the same doubled
 *  band every other room paints, and the interior stops at 304. That is exactly the line Phase 8 clamped
 *  the Dev PLACEHOLDER to (rooms/ground-floor PLACEHOLDER_SOUTH_CLAMP, now retired), and the real wall
 *  inherits it: 304…316. Row 20's centres then sit 12 clear of this wall and 17 clear of CMS's, which is
 *  what makes the corridor a corridor. Nothing about CMS moves, and the V1 grid is untouched. */
export const SOUTH_Z = 304, SOUTH_OUTER_Z = 316;

/** The V1 '+' door band is cols 78–80 × rows 19–20 — x 1248…1296, 48 units, the widest single opening in
 *  the building and 16 wider than the Gaming Room's house-standard 32. Taken verbatim: no correction is
 *  needed here, because nothing stands near either jamb. */
export const DOOR = { x0: 1248, x1: 1296 };
/** V1's own authored stand cells either side of it: (79,18) inside the room and (79,21) out in the
 *  corridor. The INSIDE one is pulled 4 north of its cell centre (296 → 292) so a body at NAV_RADIUS
 *  clears the new south wall rather than touching it; the OUTSIDE one takes row 20's centre instead of
 *  row 21's, because row 21's centre (z 344) is inside the CMS room's north wall. */
export const DOOR_STANDS = { inside: { x: 1272, z: 292 }, outside: { x: 1272, z: 328 } };

/** Walkable floor region: inside all four walls. 297 × 284. */
export const FLOOR_RECT: Rect = { x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z };
/** The tiled plate, run to the walls' OUTER faces so no void is left under them. Grout stays phased to the
 *  WORLD by tiledFloor(), so this floor reads continuous with the corridor through the doorway. */
export const TILE_RECT: Rect = { x: WEST_OUTER_X, z: NORTH_OUTER_Z, w: EAST_OUTER_X - WEST_OUTER_X, d: SOUTH_OUTER_Z - NORTH_OUTER_Z };

export const NORTH_WALL = { x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: NORTH_Z, h: STRUCT.wallHeight };
export const WEST_WALL = { x0: WEST_OUTER_X, x1: WEST_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
export const EAST_WALL = { x0: EAST_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
/** SOUTH ELEVATION. The reference glazes the whole south side — a framed screen over a low solid spandrel
 *  with a blue neon line washing its shoe, and the entrance in the middle of it. Built as TWO glazed runs
 *  either side of the V1 door band; nothing is declared inside the band. */
export const SOUTH_GLASS_W = { x0: WEST_OUTER_X, x1: DOOR.x0, z0: SOUTH_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight, bays: 6 };
export const SOUTH_GLASS_E = { x0: DOOR.x1, x1: EAST_OUTER_X, z0: SOUTH_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight, bays: 6 };
/** shoe height for both screens: the art draws a waist-high white parapet under full-height glass */
export const GLASS_SPANDREL = 14;

// ============================= THE NORTH RUN ====================================================
// The reference's north elevation is the room's identity: the team bookcase in the west corner, the neon
// CODE / BUILD / TEST / REPEAT sign, the long build board with its pipeline diagrams over a low media
// console, a neon cloud, and the build-server rack in the east corner — all under one blue cove line.
//
// DEPTH IS SET BY CIRCULATION, not by the painting. V1's flat band reads 48 deep because the render draws
// the FRONTS of the cabinets in perspective; at 48 the north lane closes against the lead chairs. 24 is a
// real cabinet (0.85 m at this room's scale) and leaves the lead workstations their 34-unit lane.
export const RUN_D = 24;
export const RUN_Z = NORTH_Z;
export const RUN_FRONT = NORTH_Z + RUN_D; // 44

/** WEST CORNER — the team bookcase: a dark walnut carcass of open shelves, books and small pots. */
export const BOOKCASE: Rect & { h: number; shelves: number } = { x: WEST_X, z: RUN_Z, w: 34, d: RUN_D, h: 40, shelves: 3 };
/** CENTRE — the low media console under the build board, with the room's cove line along its head. */
export const MEDIA: Rect & { h: number; modules: number } = { x: 1235, z: RUN_Z, w: 77, d: 20, h: 16, modules: 3 };
/** EAST CORNER — the build servers: a dark rack whose face is a grid of blue status text. */
export const SERVERS: Rect & { h: number; bays: number } = { x: 1385, z: RUN_Z, w: 34, d: RUN_D, h: 40, bays: 2 };

/** THE BUILD BOARD, hung ABOVE the media console: the wide whiteboard the render fills with pipeline
 *  diagrams. 3 units proud of the wall face, no footprint, nothing to walk into. */
export const BUILD_BOARD = { x0: 1210, x1: 1334, y0: 20, y1: 42 };
/** The two neon signs either side of it — "CODE / BUILD / TEST / REPEAT </>" and the cloud glyph. */
export const NEON_SIGN = { x0: 1180, x1: 1216, y0: 22, y1: 42 };
export const NEON_CLOUD = { x: 1351, y: 32, w: 22, h: 12 };
export const PANEL_D = 3;

// ============================= THE WEST TOOL WALL ===============================================
/** The reference's west elevation: a tall walnut board of cable loops, adaptors and dev hardware under a
 *  neon "</>" glyph. V1 draws it 64 deep because it is drawn in perspective; 14 is a real wall unit and
 *  is what leaves the west aisle its 17.6-unit lane past the bay bench. */
export const TOOL_WALL: Rect & { h: number } = { x: WEST_X, z: 64, w: 14, d: 84, h: 42 };
/** The three framed prints below it — BUGS ARE JUST FEATURES / STAY FOCUSED / CODE LIKE A BOSS. Hung:
 *  3 proud of the wall face, no footprint. */
export const POSTERS = [
  { id: "poster-bugs", z0: 167, z1: 190, lines: ["BUGS", "are just", "features"] },
  { id: "poster-focus", z0: 190, z1: 213, lines: ["STAY", "FOCUSED"] },
  { id: "poster-boss", z0: 213, z1: 236, lines: ["CODE", "LIKE A", "BOSS"] },
] as const;
export const POSTER_Y = { y0: 20, y1: 38 };

// ============================= THE EAST WALL ====================================================
/** The tea shelf: a walnut unit with plants on top, the neon EAT / SLEEP / CODE / REPEAT sign and mugs
 *  on its lower shelves. Same depth correction as the tool wall opposite. */
export const TEA_SHELF: Rect & { h: number } = { x: 1406, z: 64, w: 14, d: 84, h: 42 };
/** The big blue systems schematic hung below it. Hung, 3 proud, no footprint. */
export const SCHEMATIC = { z0: 168, z1: 237, y0: 14, y1: 42 };

// ============================= THE PANTRY COUNTER ===============================================
/** The south-east run: the espresso machine, the cup shelf, the green ">_ git push" sign and the glass-
 *  fronted drinks fridge. The flat box straddles the wall because the render draws the counter's TOP;
 *  built 24 deep against the inner face it leaves the room's south lane its full width. */
export const PANTRY: Rect & { h: number; modules: number } = { x: 1298, z: SOUTH_Z - 24, w: 97, d: 24, h: 26, modules: 4 };
export const ESPRESSO_X = 1318, CUPS_X = 1348, SIGN_X = 1368, FRIDGE_X = 1387;

// ============================= WORKSTATIONS =====================================================
// V1's own manifest draws the whole plan: TWO lead workstations across the north, and TWO back-to-back
// bay benches below them, four places a side. Every box below is the manifest's, verbatim in x.

/** THE TWO LEAD DESKS, x verbatim from the manifest's dev-lead-desk boxes. Depth is squared from 37.961
 *  to 31 — the flat box's extra 7 is the PNG's drop shadow, and squaring it is what lets the four visitor
 *  chairs stay on V1's own cell centres instead of being pushed into the bay row behind them. */
export const LEAD_DESK_W = 63.239, LEAD_DESK_D = 31, LEAD_DESK_H = 24, LEAD_DESK_Z0 = 78;
export const LEAD_DESKS = [
  { id: "lead-desk-west", x: 1176.19 },
  { id: "lead-desk-east", x: 1303.71 },
];

/** THE TWO BAY BENCHES. x is the manifest's dev-bay-desk box centre, verbatim; the DEPTH is V1's own
 *  grid line rather than the box, because the two disagree and the grid is the tighter, physical read: the
 *  manifest box runs z 159.95…226.27 while the grid blocks rows 10–13 = z 160…224 exactly, and the extra
 *  2.3 is the PNG's drop shadow. At 66 the row-2 chairs overlap their own bench by 1.5; at 64 they clear
 *  it. Each bench serves four places a side across a central planter trough — which is exactly the eight
 *  'o' cells V1 paints around each of them. */
export const BAY_W = 106, BAY_D = 64, BAY_H = 24, BAY_Z = 192;
export const BAY_DESKS = [
  { id: "bay-desk-west", x: 1207.81 },
  { id: "bay-desk-east", x: 1335.33 },
];

/** Chair plan sizes. The exec chair is the manifest's dev-chair box (15.705 × 22.554) squared; the task
 *  chair is its dev-visitor-chair box (17.68 × 20.149). */
export const EXEC_CHAIR_SIZE = { w: 16, d: 22 };
export const TASK_CHAIR_SIZE = { w: 18, d: 20 };

/** THE TWO LEAD CHAIRS. V1's cells put them at z 75.02, where their plan circles overlap their own desk's
 *  north edge (78) by 4.5. Moved 5.02 north to z 70 they clear it, and both stay inside V1's own cell
 *  (row 4, z 64…80). x is the manifest centre, verbatim. */
export const LEAD_CHAIR_Z = 70;
export const LEAD_CHAIRS = [
  { id: "lead-chair-west", x: 1207.81, z: LEAD_CHAIR_Z },
  { id: "lead-chair-east", x: 1335.33, z: LEAD_CHAIR_Z },
];

/** THE FOUR VISITOR CHAIRS, at V1's own cell centres with NO correction at all — squaring the lead desk's
 *  depth is what bought that. */
export const VISITOR_CHAIR_Z = 118.49;
export const VISITOR_CHAIRS = [
  { id: "visitor-chair-w1", x: 1196.41 },
  { id: "visitor-chair-w2", x: 1219.21 },
  { id: "visitor-chair-e1", x: 1323.93 },
  { id: "visitor-chair-e2", x: 1346.73 },
].map((c) => ({ ...c, z: VISITOR_CHAIR_Z }));

/** THE SIXTEEN BAY CHAIRS. Row 1 faces "front" = south into its bench and rolls back NORTH; row 2 faces
 *  "back" = north and rolls back SOUTH. Every x is the manifest chair-box centre, verbatim.
 *
 *  Row 1 is the room's ONE other chair correction: V1 puts it at z 156.47, where the exec chair's plan
 *  circle overlaps the bench's north edge (160) by 3.5. Moved 4.47 north to 152 it clears, and stays
 *  inside V1's own cell (row 9, z 144…160). Row 2 needs no correction: at V1's own 232.78 it already
 *  clears the bench's south edge by 1.5. */
export const BAY_ROW1_Z = 152, BAY_ROW2_Z = 232.78;
export const BAY_ROW1_XS = [1176.71, 1197.44, 1218.18, 1238.91, 1304.23, 1324.96, 1345.70, 1366.43];
export const BAY_ROW2_XS = [1174.68, 1196.46, 1218.23, 1240.00, 1302.20, 1323.98, 1345.75, 1367.52];

/** THE THREE LANES the room is navigated on, and the three cross-lanes that join them.
 *  West 1146 (wall → west bench), centre 1271 (between the benches), east 1397 (bench → tea shelf).
 *  North 54 (run front → lead chairs), middle 136 (visitor row → bay row 1), south 254 (bay row 2 →
 *  lounge). Each is the measured midpoint of the gap that defines it, not a painted cell.
 *
 *  THE NORTH LANE IS 54, NOT 58, and that is a live-driving correction: at 58 a body clears the north run
 *  by 14 but passes within 4.5 of the two lead chairs, so the lane is open at every x EXCEPT the two the
 *  chairs stand on — and a player walking it hits an invisible wall in front of each lead desk. 54 clears
 *  the run by 10 and the chairs by 8.5, which is a lane the whole way across. */
export const AISLES = [1146, 1271, 1397];
export const NORTH_LANE_Z = 54, MIDDLE_LANE_Z = 136, SOUTH_LANE_Z = 254;

// ============================= THE LOUNGE =======================================================
// The reference's south-west corner, and four separated V1 assets: the black sofa against the west wall,
// a grey rug under it, the walnut side table east of it and a big broadleaf plant beyond that.

/** THE SOFA, at the manifest's own box centre (1144.47, 273.50) — V1's three sofa seat cells sit on that
 *  same x. Authored back-to-WEST with its long axis in local z, so it needs no rotation. Its LENGTH is
 *  derived from the shared cushion arithmetic and trimmed to 61 so its south end lands exactly on the new
 *  south wall, which is where the art puts it. */
export const SOFA_SEATS = 3, SOFA_DEPTH = 27, SOFA_LEN = 61;
export const SOFA_CUSH_D = (SOFA_LEN - 2 * SOFA_ARM_W - (SOFA_SEATS - 1) * SOFA_CUSHION_GAP - 2 * SOFA_CUSHION_MARGIN) / SOFA_SEATS;
export const SOFA_X = 1144.47, SOFA_Z = 273.5;
export const SOFA_CUSHION_X = SOFA_X + DEV_SOFA.cushionLocalX;

/** THE SIDE TABLE. V1's box is x 1168.15, z 251.73, 28.31 × 44.18 — and its north edge sits 10 units
 *  behind the bay's row-2 chairs, which is less than the body that has to stand there to use them. It is
 *  squared to 40 deep (the 4.18 is the PNG shadow) and slid south against the wall, which opens that lane
 *  from 10 to 23.5. x is untouched, and this is the room's ONE furniture correction. */
export const SIDE_DESK: Rect & { h: number } = { x: 1168.15, z: 264, w: 28.31, d: 40, h: 20 };
/** The grey rug, at its manifest box clipped to the new south wall. Floor dressing: walked straight over. */
export const RUG: Rect = { x: 1142.12, z: 246, w: 67.27, d: 58 };
/** The lounge's one stand point, at the NORTH end of its lane — everything in the pocket is reached by
 *  walking down from here, which is the only body-clear route through a corner this dense (the same
 *  device the CMS lounge uses). */
export const LOUNGE_APPROACH: Vec2 = { x: 1144, z: 230 };
export const LOUNGE_LANE_Z = 236;

// ============================= PLANTING =========================================================
/** The five floor plants: two in the north run's gaps, one on the west wall, one in the pantry's corner,
 *  and the big broadleaf the manifest separates as dev-side-plant at the lounge's east end. Heights are
 *  capped by the 46-unit wall exactly as every other room's are. */
export const PLANTS = [
  { id: "plant-nw", x: 1171, z: 38, r: 7, h: 26 },
  { id: "plant-ne", x: 1368, z: 38, r: 7, h: 26 },
  // pushed 82 north of where the flat render draws it: that corner is where the separated SOFA asset
  // stands, and a separated furniture layer outranks the background it was lifted out of
  { id: "plant-west", x: 1130, z: 200, r: 6.5, h: 24 },
  { id: "plant-pantry", x: 1409, z: 292, r: 7.5, h: 26 },
  { id: "plant-lounge", x: 1224.99, z: 279.93, r: 9, h: 30 }, // dev-side-plant, manifest centre verbatim
];

// ============================= WALLS AS DATA ====================================================
/** THE ROOM'S PHYSICAL WALLS for derived navigation (nav/solids.ts) — the same runs build/dev.ts extrudes,
 *  as world rects. The V1 '+' door band is the ONE gap and nothing is declared inside it. */
export const DEV_WALLS: Rect[] = [
  { x: NORTH_WALL.x0, z: NORTH_WALL.z0, w: NORTH_WALL.x1 - NORTH_WALL.x0, d: NORTH_WALL.z1 - NORTH_WALL.z0 },
  { x: WEST_WALL.x0, z: WEST_WALL.z0, w: WEST_WALL.x1 - WEST_WALL.x0, d: WEST_WALL.z1 - WEST_WALL.z0 },
  { x: EAST_WALL.x0, z: EAST_WALL.z0, w: EAST_WALL.x1 - EAST_WALL.x0, d: EAST_WALL.z1 - EAST_WALL.z0 },
  { x: SOUTH_GLASS_W.x0, z: SOUTH_GLASS_W.z0, w: SOUTH_GLASS_W.x1 - SOUTH_GLASS_W.x0, d: SOUTH_GLASS_W.z1 - SOUTH_GLASS_W.z0 },
  { x: SOUTH_GLASS_E.x0, z: SOUTH_GLASS_E.z0, w: SOUTH_GLASS_E.x1 - SOUTH_GLASS_E.x0, d: SOUTH_GLASS_E.z1 - SOUTH_GLASS_E.z0 },
];

const rectOf = (r: Rect): Rect => ({ x: r.x, z: r.z, w: r.w, d: r.d });

/** The FIXED fit-out — the north run, the two wall units and the pantry counter. Drawn by build/dev.ts
 *  and registered as footprint-only entities so derived navigation sees exactly what the camera does. The
 *  hung boards and posters are deliberately absent: they start 14 above the floor and no body meets them. */
export const DEV_SOLIDS: (Rect & { id: string })[] = [
  { id: "bookcase", ...rectOf(BOOKCASE) },
  { id: "media", ...rectOf(MEDIA) },
  { id: "servers", ...rectOf(SERVERS) },
  { id: "tool-wall", ...rectOf(TOOL_WALL) },
  { id: "tea-shelf", ...rectOf(TEA_SHELF) },
  { id: "pantry", ...rectOf(PANTRY) },
];

export const DEV_ROOM: RoomDef = {
  id: DEV_ROOM_ID,
  name: "Dev Room",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: DEV_WALLS,
  // no `shell`: solid north/west/east plus a glazed south elevation with a single sliding entrance — its
  // own static builder, exactly as Reception, Gaming, the Central Hub, Executive, CMS and AI do.
};

// ============================= INTERACTIONS =====================================================
// Nothing below adds geometry or a new system. Every movable chair uses SeatCapability, the sofa uses
// LoungeSeatCapability, every walk-up uses ApproachCapability and the entrance uses the SAME SlidingDoor
// controller the Gaming Room's and the AI Room's doors run on.

/** How far a chair rolls back off its desk. The lead chairs open onto the room's widest lane and take 10;
 *  the bay rows share theirs with the row opposite and take 9. */
export const LEAD_PULL = 10, BAY_PULL = 9, VISITOR_PULL = 9;
/** How far the chair stays out from rest WHILE OCCUPIED (SeatCapability.seatedTuck). 3 is a real chair
 *  under a real desk and still leaves the roll-back the pull provides — the figure CMS settled on. */
export const SEATED_TUCK = 3;

/** ONE desk chair on the z axis, which is every chair in this room: `dir` is the pull direction (away from
 *  the desk). preSeat is the spot in the gap the pulled chair vacates, 4 units back toward the desk. */
function deskChairSeat(
  chair: { x: number; z: number }, approach: Vec2, dir: -1 | 1, pull: number,
  metrics: { cushionTop: number; cushionLocalZ: number },
): SeatCapability {
  const preSeat: Vec2 = { x: chair.x, z: chair.z - dir * 4 };
  return {
    approach,
    preSeat,
    approachToSeat: [{ x: preSeat.x, z: approach.z }, preSeat],
    pullDir: { x: 0, z: dir },
    pullDistance: pull,
    seatedTuck: SEATED_TUCK,
    cushionTopY: metrics.cushionTop,
    cushionLocal: { x: 0, z: metrics.cushionLocalZ },
    sitDepth: 3.5,
    seatedYaw: dir === -1 ? FACING_YAW.south : FACING_YAW.north,
    timings: { pullMs: 860, sitMs: 650, slideMs: 760, standMs: 650, returnMs: 860 },
  };
}

/** The two LEAD chairs, approached from the north lane 24 west of the chair — V1 authored 's' cells either
 *  side of each ('o' cells at cols 75 and 83, row 4), and the west one of each pair is taken. */
export const LEAD_SEATS: SeatCapability[] = LEAD_CHAIRS.map((c) =>
  deskChairSeat(c, { x: c.x - 24, z: NORTH_LANE_Z }, -1, LEAD_PULL, DEV_EXEC_CHAIR));

/** The four VISITOR chairs, approached from the middle lane, offset to the side so the body never stands
 *  in the gap the chair rolls into. */
export const VISITOR_SEATS: SeatCapability[] = VISITOR_CHAIRS.map((c, i) =>
  deskChairSeat(c, { x: c.x + (i % 2 === 0 ? -16 : 17), z: MIDDLE_LANE_Z }, 1, VISITOR_PULL, DEV_TASK_CHAIR));

/** The eight ROW 1 bay chairs (facing south into their bench, rolling back north into the middle lane). */
export const BAY_ROW1_CHAIRS = BAY_ROW1_XS.map((x, i) => ({ id: `bay-chair-n${i + 1}`, x, z: BAY_ROW1_Z }));
export const BAY_ROW1_SEATS: SeatCapability[] = BAY_ROW1_CHAIRS.map((c) =>
  deskChairSeat(c, { x: c.x, z: MIDDLE_LANE_Z }, -1, BAY_PULL, DEV_EXEC_CHAIR));

/** The eight ROW 2 bay chairs (facing north into their bench, rolling back south into the south lane). */
export const BAY_ROW2_CHAIRS = BAY_ROW2_XS.map((x, i) => ({ id: `bay-chair-s${i + 1}`, x, z: BAY_ROW2_Z }));
export const BAY_ROW2_SEATS: SeatCapability[] = BAY_ROW2_CHAIRS.map((c) =>
  deskChairSeat(c, { x: c.x, z: SOUTH_LANE_Z }, 1, BAY_PULL, DEV_TASK_CHAIR));

export const LEAD_CHAIR_IDS = LEAD_CHAIRS.map((c) => `${DEV_ROOM_ID}/${c.id}`);
export const VISITOR_CHAIR_IDS = VISITOR_CHAIRS.map((c) => `${DEV_ROOM_ID}/${c.id}`);
export const BAY_ROW1_IDS = BAY_ROW1_CHAIRS.map((c) => `${DEV_ROOM_ID}/${c.id}`);
export const BAY_ROW2_IDS = BAY_ROW2_CHAIRS.map((c) => `${DEV_ROOM_ID}/${c.id}`);
/** every MOVABLE chair in the room, in GUI order — 2 lead + 4 visitor + 8 + 8 = 22, which with the sofa's
 *  three cushions is exactly the 25 seats V1 counts. EVERY one of these must be reachable by the per-frame
 *  SeatInteraction tick in app/bootstrap.ts, which is the Executive-chair bug dev.test.ts exists to
 *  prevent. */
export const DEV_SEAT_IDS = [...LEAD_CHAIR_IDS, ...VISITOR_CHAIR_IDS, ...BAY_ROW1_IDS, ...BAY_ROW2_IDS];

// ---- FIXED lounge seating ------------------------------------------------------------------------
/** 1.5 forward of the cushion centre: the sitter lands ON the cushion instead of wedged into the back. */
const SOFA_CONTACT_FORWARD = 1.5;
export const SOFA_ID = `${DEV_ROOM_ID}/lounge-sofa`;
export const DEV_LOUNGE_IDS = [SOFA_ID];

export function sofaSlots(): LoungeSeatSlot[] {
  return [0, 1, 2].map((i) => {
    const lz = sofaCushionZ(i, SOFA_SEATS, SOFA_CUSH_D);
    return {
      id: `sofa-${["north", "centre", "south"][i]}`,
      contactLocal: { x: DEV_SOFA.cushionLocalX + SOFA_CONTACT_FORWARD, y: DEV_SOFA.cushionTop, z: lz },
      seatedYaw: FACING_YAW.east, // V1 "right": the sofa's back is the west wall; its sitters look into the room
      approach: { ...LOUNGE_APPROACH },
      approachToSeat: [{ x: SOFA_CUSHION_X + 12, z: LOUNGE_LANE_Z }, { x: SOFA_CUSHION_X + 12, z: SOFA_Z + lz }],
      sink: 0,
      timings: { sitMs: 780, standMs: 720 },
    };
  });
}

// ---- walk-up points ------------------------------------------------------------------------------
// Physical anchors only: somewhere to stand and something to face. Each point is a body-clear spot on the
// derived floor, checked against every solid within NAV_RADIUS of it (dev.test.ts asserts that).
export const BOOKCASE_APPROACH: ApproachCapability = { point: { x: 1146, z: NORTH_LANE_Z }, yaw: FACING_YAW.north, label: "Team bookshelf", action: "Browse the shelf" };
export const BOARD_APPROACH: ApproachCapability = { point: { x: 1272, z: NORTH_LANE_Z }, yaw: FACING_YAW.north, label: "Build board", action: "Read the build board" };
export const SERVERS_APPROACH: ApproachCapability = { point: { x: 1397, z: NORTH_LANE_Z }, yaw: FACING_YAW.north, label: "Build servers", action: "Check the build" };
export const TOOL_APPROACH: ApproachCapability = { point: { x: 1150, z: 106 }, yaw: FACING_YAW.west, label: "Hardware wall", action: "Grab a cable" };
export const TEA_APPROACH: ApproachCapability = { point: { x: 1395, z: 106 }, yaw: FACING_YAW.east, label: "Dev tea point", action: "Make a coffee" };
export const SCHEMATIC_APPROACH: ApproachCapability = { point: { x: 1397, z: 200 }, yaw: FACING_YAW.east, label: "Systems board", action: "Study the schematic" };
export const PANTRY_APPROACH: ApproachCapability = { point: { x: 1340, z: 268 }, yaw: FACING_YAW.south, label: "Pantry bar", action: "Grab a snack" };

export const BOOKCASE_INTERACTION_ID = `${DEV_ROOM_ID}/bookcase-interaction`;
export const BOARD_INTERACTION_ID = `${DEV_ROOM_ID}/board-interaction`;
export const SERVERS_INTERACTION_ID = `${DEV_ROOM_ID}/servers-interaction`;
export const TOOL_INTERACTION_ID = `${DEV_ROOM_ID}/tool-interaction`;
export const TEA_INTERACTION_ID = `${DEV_ROOM_ID}/tea-interaction`;
export const SCHEMATIC_INTERACTION_ID = `${DEV_ROOM_ID}/schematic-interaction`;
export const PANTRY_INTERACTION_ID = `${DEV_ROOM_ID}/pantry-interaction`;
export const DEV_APPROACH_IDS = [
  BOOKCASE_INTERACTION_ID, BOARD_INTERACTION_ID, SERVERS_INTERACTION_ID, TOOL_INTERACTION_ID,
  TEA_INTERACTION_ID, SCHEMATIC_INTERACTION_ID, PANTRY_INTERACTION_ID,
];

// ---- the south entrance --------------------------------------------------------------------------
/** A SINGLE sliding leaf on the SAME SlidingDoor controller the Gaming Room's west door and the AI Room's
 *  south door run on. It fills the 48-unit opening exactly and parks entirely clear of it, sliding WEST
 *  behind the glazed screen. */
export const DOOR_LEAF_W = DOOR.x1 - DOOR.x0; // 48
export const DOOR_Z = (SOUTH_Z + SOUTH_OUTER_Z) / 2; // 310 — the wall's centre plane
export const DOOR_LEAF_ID = `${DEV_ROOM_ID}/south-door`;
export const DOOR_LEAF_CLOSED: Vec2 = { x: DOOR.x0 + DOOR_LEAF_W / 2, z: DOOR_Z }; // 1272, 310
const BODY_RADIUS = 10.5; // Bon's widest walking extent, as every other V2 door measures it

export const ENTRY_DOOR: DoorCapability = {
  slide: { x: -1, z: 0 },
  slideDistance: DOOR_LEAF_W,
  automatic: true,
  leaf: { x: DOOR.x0, z: DOOR_Z - STRUCT.wallThickness / 2, w: DOOR_LEAF_W, d: STRUCT.wallThickness },
  /** the doorway itself: while a body overlaps this the door must be open and may not close */
  crossing: { x: DOOR.x0 - 4, z: SOUTH_Z - 6, w: DOOR_LEAF_W + 8, d: WALL_T + 12 },
  /** both approach aprons — the room's south lane inside and the corridor outside */
  trigger: { x: DOOR.x0 - 40, z: SOUTH_Z - 68, w: DOOR_LEAF_W + 80, d: WALL_T + 128 },
  clearance: {
    bodyRadius: BODY_RADIUS,
    // the SAME shape Gaming's, CMS's and AI's bands have: the door's own span ALONG the wall × the V1 '+'
    // band's two cell rows ACROSS it. All six V1 '+' cell centres fall inside it, so A* still crosses on
    // the cells V1 painted.
    band: { x: DOOR.x0, z: 19 * CELL, w: DOOR.x1 - DOOR.x0, d: 2 * CELL },
    solids: [], // nothing stands in the band: the jambs are the opening's own reveals
  },
  timings: { openMs: 900, closeMs: 1100, holdMs: 700 },
};

// ============================= ENTITIES =========================================================
function furniture(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, props: Record<string, string | number | boolean> = {}): Entity {
  return {
    id: `${DEV_ROOM_ID}/${id}`,
    kind,
    roomId: DEV_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    capabilities: {},
    props: { w, d, facing, mirrored: false, ...props },
  };
}
function plantEntity(p: (typeof PLANTS)[number]): Entity {
  return {
    id: `${DEV_ROOM_ID}/${p.id}`,
    kind: "plant",
    roomId: DEV_ROOM_ID,
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
    id: `${DEV_ROOM_ID}/solid-${s.id}`,
    kind: "solid",
    roomId: DEV_ROOM_ID,
    transform: { pos: { x: s.x + s.w / 2, z: s.z + s.d / 2 }, yaw: 0 },
    footprint: { shape: "rect", w: s.w, d: s.d },
    capabilities: {},
    props: {},
    source: { baked: true },
  };
}
function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: DEV_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** The room's furniture as world entities. The architecture, the north run, the two wall units and the
 *  pantry counter are static (build/dev.ts) and appear here only as footprint-only solids. */
export function devRoomEntities(): Entity[] {
  const out: Entity[] = [];
  // floor dressing first: the lounge rug is walked straight over (kindFootprint gives it solid: false)
  out.push(furniture("lounge-rug", "dev-rug", RUG.x + RUG.w / 2, RUG.z + RUG.d / 2, RUG.w, RUG.d, "north",
    { color: THEME.rug, accent: THEME.rugBorder }));
  // the two lead workstations
  for (const d of LEAD_DESKS)
    out.push(furniture(d.id, "dev-lead-desk", d.x + LEAD_DESK_W / 2, LEAD_DESK_Z0 + LEAD_DESK_D / 2, LEAD_DESK_W, LEAD_DESK_D, "south",
      { color: THEME.walnut, accent: THEME.ink, neon: THEME.neon, h: LEAD_DESK_H }));
  // the two bay benches, four places a side
  for (const d of BAY_DESKS)
    out.push(furniture(d.id, "dev-bay-desk", d.x, BAY_Z, BAY_W, BAY_D, "north",
      { color: THEME.walnut, accent: THEME.ink, neon: THEME.neon, h: BAY_H, places: 4 }));
  // the lounge side table
  out.push(furniture("side-desk", "dev-side-desk", SIDE_DESK.x + SIDE_DESK.w / 2, SIDE_DESK.z + SIDE_DESK.d / 2,
    SIDE_DESK.w, SIDE_DESK.d, "east", { color: THEME.walnut, h: SIDE_DESK.h }));
  // the twenty-two MOVABLE chairs
  for (const c of LEAD_CHAIRS)
    out.push(furniture(c.id, "dev-exec-chair", c.x, c.z, EXEC_CHAIR_SIZE.w, EXEC_CHAIR_SIZE.d, "south",
      { color: THEME.leather, colorSeat: THEME.leatherSeat, frame: THEME.frame }));
  for (const c of VISITOR_CHAIRS)
    out.push(furniture(c.id, "dev-task-chair", c.x, c.z, TASK_CHAIR_SIZE.w, TASK_CHAIR_SIZE.d, "north",
      { color: THEME.leather, colorSeat: THEME.leatherSeat, frame: THEME.frame }));
  for (const c of BAY_ROW1_CHAIRS)
    out.push(furniture(c.id, "dev-exec-chair", c.x, c.z, EXEC_CHAIR_SIZE.w, EXEC_CHAIR_SIZE.d, "south",
      { color: THEME.leather, colorSeat: THEME.leatherSeat, frame: THEME.frame }));
  for (const c of BAY_ROW2_CHAIRS)
    out.push(furniture(c.id, "dev-task-chair", c.x, c.z, TASK_CHAIR_SIZE.w, TASK_CHAIR_SIZE.d, "north",
      { color: THEME.leather, colorSeat: THEME.leatherSeat, frame: THEME.frame }));
  // the lounge sofa
  out.push(furniture("lounge-sofa", "dev-sofa", SOFA_X, SOFA_Z, SOFA_DEPTH, SOFA_LEN, "north",
    { color: THEME.sofa, colorSeat: THEME.sofaSeat, seats: SOFA_SEATS }));
  for (const p of PLANTS) out.push(plantEntity(p));
  for (const s of DEV_SOLIDS) out.push(solidEntity(s));
  return withDevInteractions(out);
}

/** Hang the capabilities on the entities above: MOVABLE seating on all twenty-two chairs, FIXED lounge
 *  seating on the sofa, seven walk-up points and the single-leaf south entrance. No geometry, no transform
 *  and no id changes. */
export function withDevInteractions(entities: Entity[]): Entity[] {
  const find = (id: string): Entity => {
    const e = entities.find((x) => x.id === id);
    if (!e) throw new Error(`dev: no entity ${id}`);
    return e;
  };
  LEAD_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: LEAD_SEATS[i] }; });
  VISITOR_CHAIR_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: VISITOR_SEATS[i] }; });
  BAY_ROW1_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: BAY_ROW1_SEATS[i] }; });
  BAY_ROW2_IDS.forEach((id, i) => { find(id).capabilities = { ...find(id).capabilities, seat: BAY_ROW2_SEATS[i] }; });
  find(SOFA_ID).capabilities = { lounge: { slots: sofaSlots() } };
  entities.push(approachEntity(BOOKCASE_INTERACTION_ID, "dev-bookcase", BOOKCASE_APPROACH));
  entities.push(approachEntity(BOARD_INTERACTION_ID, "dev-build-board", BOARD_APPROACH));
  entities.push(approachEntity(SERVERS_INTERACTION_ID, "dev-servers", SERVERS_APPROACH));
  entities.push(approachEntity(TOOL_INTERACTION_ID, "dev-tool-wall", TOOL_APPROACH));
  entities.push(approachEntity(TEA_INTERACTION_ID, "dev-tea-point", TEA_APPROACH));
  entities.push(approachEntity(SCHEMATIC_INTERACTION_ID, "dev-schematic", SCHEMATIC_APPROACH));
  entities.push(approachEntity(PANTRY_INTERACTION_ID, "dev-pantry", PANTRY_APPROACH));
  entities.push({
    id: DOOR_LEAF_ID,
    kind: "glass-door-leaf",
    roomId: DEV_ROOM_ID,
    // a leaf in a NORTH/SOUTH wall is the builder's own authoring plane, so yaw stays 0
    transform: { pos: { ...DOOR_LEAF_CLOSED }, yaw: 0 },
    capabilities: { door: ENTRY_DOOR },
    props: { w: DOOR_LEAF_W, h: STRUCT.wallHeight, handle: -1 }, // handle on the leading (west) stile
    source: { baked: true },
  });
  return entities;
}
