// vo3d rooms — GAMING ROOM definition (data only, WORLD coordinates).
//
// Phase 5B. The east flank of the ground floor, between the CMS room (ends z 601.97) and the Project
// room (its own north wall face is at 878). ONE entrance: a west door onto the north–south corridor.
//
// Every number below is DERIVED, never invented:
//   • rect       → the READ-ONLY V1 asset manifest (x 1111.28, z 617.97, 320.718 × 236.872)
//   • interior   → the V1 walkability grid: cols 71–87 × rows 42–49 is the walkable interior
//   • door       → the grid's '+' cells, cols 69–70 × rows 45–46, with 's' stands at col 68 / col 71
//   • seats      → the grid's 'o' clusters, whose centroids match data/seatDirections.ts's nine
//                  "gaming-room" entries EXACTLY: (1200|1248|1296|1344, 792) desks, (1216|1328, 704)
//                  beanbags, (1272, 744) sofa, (1400, 688) + (1392, 744) nook poufs
//   • everything else → measured off src/assets/office/rooms/gaming-room.png at 0.125 units/px
//
// The flat PNG is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, DoorCapability, Entity, LoungeSeatSlot, RoomDef, SeatCapability } from "../world/WorldState";
import type { MatKey } from "../render/Materials";
import { CELL } from "../adapters/v1Grid";
import { v1RoomRect } from "../adapters/v1Manifest";
import { STRUCT } from "./reception";
import { GAMING_CHAIR, SOFA_CUSHION_LOCAL_X, SOFA_CUSHION_TOP, sofaCushionDepth, sofaCushionZ } from "../build/furniture";
import { kindFootprint } from "./footprint";

export const GAMING_ROOM_ID = "gaming-room";
export const RECT: Rect = v1RoomRect(GAMING_ROOM_ID); // x 1111.28, z 617.97, w 320.718, d 236.872

// ============================= THEME ============================================================
/** ROOM-LEVEL COLOUR TABLE (Phase 5B groundwork).
 *
 *  No builder in this room names a palette key directly — every upholstery, rug, accent and LED colour
 *  is read from here. That is the whole point: a future colour/material editor changes THIS object and
 *  the room re-skins, instead of hunting thirty literals through two build files. The keys are the ones
 *  5A identified as the pieces users will actually want to personalise.
 *
 *  NOT a customisation UI — that is explicitly out of scope for 5B. This is only the seam it will use. */
export const THEME = {
  /** primary: chair bolsters, west beanbag, rug inlay, sofa piping */
  accent: "gamingViolet",
  /** secondary: east beanbag, nook pouf, the alternate monitor wallpaper */
  accentAlt: "gamingBlue",
  /** every LED tape in the room */
  ledHue: "gamingLed",
  /** sofa / lounge upholstery */
  upholstery: "gamingSofa",
  upholsterySeat: "gamingSofaSeat",
  /** rug pile */
  rug: "gamingRug",
  /** desks, console carcasses, chair frames */
  shell: "gamingDark",
} satisfies Record<string, MatKey>;

// ============================= ARCHITECTURE =====================================================
// THE 5A CORRECTION. V1 blocks a 54-unit band across the north of this room and a 32-unit band down its
// west side. Neither is a wall: both are the flat render's baked perspective plus the clearance V1 painted
// around the furniture standing there. Rebuilt as solid mass (the mistake 4B made in Meeting and Project)
// they would swallow the whole north circulation lane and push the media wall into the room.
//
// So every wall here is a REAL 12-unit wall sitting on the art bounding box, and the floor the correction
// gives back is declared to navigation as a V2-local OpenBand (NORTH_STRIP / WEST_STRIP below).
// The V1 grid file itself is untouched.
export const WALL_T = 12;
export const NORTH_OUTER_Z = 618, NORTH_Z = 630;
export const SOUTH_Z = 840, SOUTH_OUTER_Z = 852;
export const WEST_OUTER_X = 1112, WEST_X = 1124;
export const EAST_X = 1420, EAST_OUTER_X = 1432;

/** The V1 '+' door band, cols 69–70 × rows 45–46. The wall opening is exactly this span and NOTHING —
 *  no leaf, no jamb return, no planter — may stand inside it. 5C hangs the door controller here. */
export const DOOR = { z0: 720, z1: 752 };
/** V1's own authored stand cells either side of it: col 68 (hall) and col 71 (room). */
export const DOOR_STANDS = { outside: { x: 1096, z: 736 }, inside: { x: 1144, z: 736 } };

/** Walkable floor region: inside all four walls. 296 × 210. */
export const FLOOR_RECT: Rect = { x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z };
/** The tiled plate, run to the walls' OUTER faces so no void is left under them. Grout stays phased to
 *  the WORLD by tiledFloor(), so this floor reads continuous with the hall outside the door. */
export const TILE_RECT: Rect = { x: WEST_OUTER_X, z: NORTH_OUTER_Z, w: EAST_OUTER_X - WEST_OUTER_X, d: SOUTH_OUTER_Z - NORTH_OUTER_Z };

export const NORTH_WALL = { x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: NORTH_Z, h: STRUCT.wallHeight };
export const EAST_WALL = { x0: EAST_X, x1: EAST_OUTER_X, z0: NORTH_OUTER_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight };
/** West side, NORTH of the door: solid plaster. */
export const WEST_WALL = { x0: WEST_OUTER_X, x1: WEST_X, z0: NORTH_Z, z1: DOOR.z0, h: STRUCT.wallHeight };
/** West side, SOUTH of the door: the artwork's black-framed glazed screen (measured z 728…843). */
export const WEST_GLASS = { x0: WEST_OUTER_X, x1: WEST_X, z0: DOOR.z1, z1: SOUTH_Z, h: STRUCT.wallHeight, bays: 3 };

/** SOUTH PARTITION (5B decision). The artwork paints a framed glass wall with an LED cove at its base.
 *  There is nothing behind it — z 855…878 is dead space before the Project room's own wall — so clear
 *  glass would look into a void. Built as the artwork's glazed screen over an OPAQUE spandrel: the glass
 *  character is preserved, the void is never exposed. */
export const SOUTH_PARTITION = {
  x0: WEST_OUTER_X, x1: EAST_OUTER_X, z0: SOUTH_Z, z1: SOUTH_OUTER_Z, h: STRUCT.wallHeight,
  spandrel: 25, // opaque base. Tuned against the LIVE render, not on paper. It has to clear the 24-high
  //               desk run (glazing lower looks past the desktops into the dead space it exists to hide)
  //               but every unit above that blinds the game camera: at pitch 52 an opaque band here hides
  //               everything on the desks behind it. 25 is the only value that does both.
  head: 3, //     the top rail the glass dies into
  bays: 6, //     mullion pitch ≈ 53, matching the artwork's bay count
};

// ============================= V2-LOCAL WALKABILITY =============================================
/** The lane the corrected NORTH wall gives back: between the media wall's fittings (z 654) and V1's own
 *  first open row (z 672). This is the room's main east–west circulation and the single most important
 *  correction in the room — without it the sofa/TV sightline has no floor behind it. */
export const NORTH_STRIP = {
  id: "gaming-north-strip",
  rect: { x: WEST_X, z: 654, w: EAST_X - WEST_X, d: 672 - 654 } as Rect,
  // the console, NW cabinet and dartboard are all north of 654 and never intrude; the two floor plants
  // that DO stand in the lane are declared here (5C fix — 5B declared none and opened their cells)
  solids: [
    { x: WEST_X, z: 656, w: 26, d: 32 }, // AV_CABINET — the west run reaches up into this lane too
    { x: 1151, z: 657, w: 18, d: 18 }, // plant-nw
    { x: 1353, z: 657, w: 18, d: 18 }, // plant-n
  ] as Rect[],
};
/** The matching 12-unit strip the corrected WEST wall gives back, from the north lane down to the desks.
 *  The AV cabinet and fridge stand in it and are declared. */
export const WEST_STRIP = {
  id: "gaming-west-strip",
  rect: { x: WEST_X, z: 672, w: 1136 - WEST_X, d: 800 - 672 } as Rect,
  // 5C FIX. 5B declared no solids here, so the band opened three cells that lie INSIDE the AV cabinet and
  // the drinks fridge — both of which stand against this very wall. A band may only hand back real floor.
  solids: [
    { x: WEST_X, z: 656, w: 26, d: 32 }, // AV_CABINET
    { x: WEST_X, z: 690, w: 26, d: 22 }, // FRIDGE
  ] as Rect[],
};
// NOTE: there is deliberately NO east band. The 12 units the east wall gives back (1408…1420) lie
// entirely under the nook rug, poufs and floor lamp — opening them would route the avatar through
// furniture for no circulation gain. "Where physically justified" cuts both ways.

// ============================= NORTH MEDIA WALL =================================================
/** The dark-walnut media run standing against the north wall (art x 1165…1373.5, 20.7 deep). */
export const MEDIA_CONSOLE = { x: 1186, z: NORTH_Z, w: 166, d: 24, h: 26, modules: 5 };
/** The big banner display above it. The artwork's screen measures 89 wide against a 46-high wall, so it
 *  is a cinema-ratio ultrawide, not a 16:9 set — building it 16:9 would put it through the ceiling. */
export const TV = { cx: 1270, w: 88, y0: 27, h: 18 };
/** The NW controller/display cabinet (art x 1119.8…1181, z 626.5…670.2), on the north wall. */
export const NW_CABINET = { x: 1128, z: NORTH_Z, w: 50, d: 20, h: 40, shelves: 4 };
/** The dartboard on its wood backing panel (art x 1358.8…1419.8). */
export const DARTBOARD = { cx: 1388, w: 56, y0: 11, h: 33 };
/** The two neon signs flanking the display, both mounted on the north wall face. */
export const NEON_CONTROLLER = { cx: 1201, w: 44, y0: 26, h: 19 };
export const NEON_PS = { cx: 1336, w: 34, y0: 31, h: 11 };

// ============================= WEST WALL ========================================================
// Both pieces stop at z 712 — eight clear units before the door band opens at 720. The artwork stacks
// them lower than this, over the doorway; that is the flat render's business, not a buildable layout.
export const AV_CABINET = { x: WEST_X, z: 656, w: 26, d: 32, h: 30, modules: 2 };
export const FRIDGE = { x: WEST_X, z: 690, w: 26, d: 22, h: 34 };

// ============================= CENTRE ===========================================================
/** The gamepad-print rug (art x 1181…1361, z 665…758). */
export const RUG = { x: 1184, z: 666, w: 176, d: 92 };
/** The sofa, back to the SOUTH, facing the display. w/d are FURNITURE-LOCAL (w = back→front depth,
 *  d = length), because build/furniture's sofa is authored with its long axis in local z. */
export const SOFA = { id: "sofa", x: 1272, z: 747, w: 35, d: 89, seats: 3 };
export const COFFEE_TABLE = { x: 1272, z: 706, r: 15 };
/** V1 seat cells (1216, 704) and (1328, 704) — the artwork's purple and blue bags, in that order. */
export const BEANBAGS = [
  { id: "beanbag-west", x: 1216, z: 704, r: 16, color: THEME.accent as MatKey },
  { id: "beanbag-east", x: 1328, z: 704, r: 16, color: THEME.accentAlt as MatKey },
];

// ============================= DESK RUN =========================================================
/** Four stations at a 48 pitch. The centres are V1's OWN seat centroids, not the artwork's — the grid is
 *  the gameplay authority and the two disagree by up to 8 units. Run ends land within 4 units of the
 *  artwork's painted end frames, so nothing visual is lost by deferring to the grid. */
export const STATIONS = [1200, 1248, 1296, 1344];
/** DEPTH SET BY SIGHTLINE, not by the artwork's painted footprint. The game camera looks north at pitch
 *  52 from beyond the south wall, so anything lower than ~46 units and further south than z ≈ 823 is
 *  hidden behind the partition. A 32-deep run backing onto the wall (the artwork's literal reading) put
 *  all four monitors, their rear lighting and the partition cove in that shadow — 20% of the room
 *  rendered as one dead dark band. At 28 deep with a 6-unit service gap behind it, the monitors clear the
 *  spandrel and read through the glass, and the desks still back onto the wall like real desks. */
export const DESK_RUN = { x0: 1176, x1: 1368, z0: 806, z1: 834, h: 24 };
/** where each station's kit sits, north → south across the 28-unit top */
export const STATION_KIT = { keyboard: 814, mouse: 814, headset: 822, monitor: 824 };
export const CHAIR_Z = 792;
export const CHAIR_SIZE = 30;

// ============================= EAST NOOK ========================================================
export const NOOK = {
  rug: { x: 1362, z: 656, w: 56, d: 118 },
  /** the two V1 seat cells, plus a small footstool the grid does not seat anyone on */
  poufs: [
    { id: "pouf-north", x: 1400, z: 688, r: 17, color: "charcoal" as MatKey },
    { id: "pouf-south", x: 1392, z: 744, r: 16, color: THEME.accentAlt as MatKey },
    { id: "pouf-stool", x: 1378, z: 776, r: 10, color: "gamingDark" as MatKey },
  ],
  table: { x: 1396, z: 712, r: 9, h: 13 },
  /** the artwork's warm floor lamp — the room's one warm light, balancing 300 units of violet */
  lamp: { x: 1414, z: 727, shadeR: 7, h: 40 },
};
/** The neon poster on the east wall's inner face (art z 755…811). */
export const POSTER = { z0: 757, z1: 803, y0: 13, h: 27 };

// ============================= PLANTING =========================================================
/** Verified against the artwork's foliage blobs; two apparent plants at z≈646 were the game landscape
 *  on the TV and are correctly absent. Positions are nudged clear of the rebuilt fittings. */
export const PLANTS = [
  { id: "plant-nw", x: 1160, z: 666, r: 9, h: 27 },
  { id: "plant-n", x: 1362, z: 666, r: 9, h: 26 },
  { id: "plant-ne", x: 1406, z: 642, r: 8, h: 24 },
  { id: "plant-sw-corner", x: 1138, z: 826, r: 10, h: 30 },
  { id: "plant-desk-west", x: 1164, z: 814, r: 6, h: 19 },
  { id: "plant-desk-east", x: 1380, z: 814, r: 6, h: 19 },
  { id: "plant-se-corner", x: 1404, z: 828, r: 10, h: 29 },
];

/** GAMING'S PHYSICAL WALLS, as pure data for derived navigation (7C) — the same runs build/gaming.ts
 *  extrudes, as world rects. Four sides, all real: solid north/east, solid west NORTH of the door, a glazed
 *  screen west SOUTH of it, and the opaque-spandrel south partition. The V1 '+' door band (z 720…752) is
 *  the ONE gap and nothing is declared inside it — the door's own leaf and jambs govern there. */
export const GAMING_WALLS: Rect[] = [
  { x: NORTH_WALL.x0, z: NORTH_WALL.z0, w: NORTH_WALL.x1 - NORTH_WALL.x0, d: NORTH_WALL.z1 - NORTH_WALL.z0 },
  { x: EAST_WALL.x0, z: EAST_WALL.z0, w: EAST_WALL.x1 - EAST_WALL.x0, d: EAST_WALL.z1 - EAST_WALL.z0 },
  { x: WEST_WALL.x0, z: WEST_WALL.z0, w: WEST_WALL.x1 - WEST_WALL.x0, d: WEST_WALL.z1 - WEST_WALL.z0 },
  { x: WEST_GLASS.x0, z: WEST_GLASS.z0, w: WEST_GLASS.x1 - WEST_GLASS.x0, d: WEST_GLASS.z1 - WEST_GLASS.z0 },
  { x: SOUTH_PARTITION.x0, z: SOUTH_PARTITION.z0, w: SOUTH_PARTITION.x1 - SOUTH_PARTITION.x0, d: SOUTH_PARTITION.z1 - SOUTH_PARTITION.z0 },
];

export const GAMING_ROOM: RoomDef = {
  id: GAMING_ROOM_ID,
  name: "Gaming Room",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: GAMING_WALLS,
  // no `shell`: four walls of three different kinds (solid / glazed screen / glazed partition) — its own
  // static builder instead, exactly as Reception, Meeting and Project do.
};

// ============================= 5C INTERACTIONS ==================================================
// Nothing below adds geometry. Every anchor is a V1-walkable cell centre, every contact point is derived
// from the exported mesh constants, and the globally deferred seated-facing calibration is NOT touched:
// each yaw here is the geometric reading of the piece the sitter is actually on.

export const CHAIR_R = CHAIR_SIZE / 2;
/** How far a chair rolls back off the desk. Bounded by the SOFA, whose south face is at 764.5: at 11 the
 *  chair's back edge stops at 766, 1.5 clear. Meeting's north row pulls 12 against a wall 3 away, so this
 *  is the same visibly-real pull under a tighter constraint. */
export const CHAIR_PULL = 11;
/** V1's OWN stand cells for the four stations: row 49, cols 73 / 76 / 79 / 82 — one cell west of each
 *  seat's 'oo' pair, which is exactly where you stand to pull a chair out. */
export const CHAIR_APPROACH_X = [73, 76, 79, 82].map((c) => c * CELL + CELL / 2); // 1176 / 1224 / 1272 / 1320
export const CHAIR_APPROACH_Z = 49 * CELL + CELL / 2; // 792
/** where the sitter stands once the chair is out of the way: the space the chair vacated */
const CHAIR_PRE_SEAT_Z = 800;

export function gamingChairSeat(i: number): SeatCapability {
  const cx = STATIONS[i], ax = CHAIR_APPROACH_X[i];
  const preSeat: Vec2 = { x: cx, z: CHAIR_PRE_SEAT_Z };
  return {
    approach: { x: ax, z: CHAIR_APPROACH_Z },
    preSeat,
    approachToSeat: [{ x: ax, z: CHAIR_PRE_SEAT_Z }, preSeat],
    pullDir: { x: 0, z: -1 }, // back off the desk, into the room
    pullDistance: CHAIR_PULL,
    seatedTuck: 7, // rolls back under the sitter, as Meeting's and the Design Room's chairs do
    cushionTopY: GAMING_CHAIR.cushionTop,
    cushionLocal: { x: 0, z: GAMING_CHAIR.cushionLocalZ },
    sitDepth: 3.5,
    seatedYaw: FACING_YAW.south, // the monitors are south of the chair
    timings: { pullMs: 820, sitMs: 650, slideMs: 700, standMs: 650, returnMs: 820 },
  };
}
export const gamingChairId = (i: number): string => `${GAMING_ROOM_ID}/gaming-chair-${i}`;
export const GAMING_CHAIR_IDS = STATIONS.map((_, i) => gamingChairId(i));
/** the pulled chair's back edge — tests assert it stays clear of the sofa behind it */
export const CHAIR_BACK_AT_FULL_PULL = CHAIR_Z - CHAIR_PULL - CHAIR_R; // 766

// ---- FIXED lounge seating -----------------------------------------------------------------------
// The furniture never moves, so these use LoungeSeatCapability and furniture drift is zero by
// construction. Contact points come from the builders' own exported numbers.

/** The sofa is built back-to-WEST and turned a quarter (facing "west"), so furniture-local +x is world
 *  NORTH and local +z is world EAST. One set of local numbers therefore serves all three places. */
export const SOFA_CUSH_D = sofaCushionDepth(SOFA.d, SOFA.seats);
export const SOFA_SLOT_Z = [0, 1, 2].map((i) => sofaCushionZ(i, SOFA.seats, SOFA_CUSH_D));
/** 1.5 forward of the cushion centre: the sitter lands ON the cushion instead of wedged into the back */
const SOFA_CONTACT_FORWARD = 1.5;
/** The two V1-walkable cells in front of the sofa. The coffee table blocks cols 78-80, so these flank it. */
const SOFA_STAND_WEST: Vec2 = { x: 77 * CELL + CELL / 2, z: 45 * CELL + CELL / 2 }; // (1240, 728)
const SOFA_STAND_EAST: Vec2 = { x: 81 * CELL + CELL / 2, z: 45 * CELL + CELL / 2 }; // (1304, 728)

function sofaSlots(): LoungeSeatSlot[] {
  return SOFA_SLOT_Z.map((lz, i) => {
    const worldX = SOFA.x + lz; // local +z → world +x
    const stand = i === 2 ? SOFA_STAND_EAST : SOFA_STAND_WEST;
    // final leg runs along the clear lane between the sofa front (729.75) and the coffee table (721)
    const lane = 727;
    const via: Vec2[] = i === 1 ? [{ x: stand.x + 16, z: lane }, { x: worldX, z: lane }] : [{ x: worldX, z: lane }];
    return {
      id: `sofa-${["west", "centre", "east"][i]}`,
      contactLocal: { x: SOFA_CUSHION_LOCAL_X + SOFA_CONTACT_FORWARD, y: SOFA_CUSHION_TOP, z: lz },
      seatedYaw: FACING_YAW.north, // the sofa opens north, at the display
      approach: { ...stand },
      approachToSeat: via,
      sink: 0,
      timings: { sitMs: 780, standMs: 720 },
    };
  });
}

/** A bean bag / pouf is a revolved bag of radius r and height r * 1.05 whose crown sits at h * 0.95.
 *  `sink` is real here: the bag compresses under a body instead of holding it on a hard surface. */
export const BAG_SINK = 2.2;
export const bagCrown = (r: number): number => r * 1.05 * 0.95;

type BagSpec = { id: string; x: number; z: number; r: number; yaw: number; stand: Vec2; via: Vec2 };
/** Bean bags and the two primary nook poufs. The third nook pouf is a 10-radius footstool — too small to
 *  seat a body on, so it is deliberately NOT given a slot. */
export const BAG_SEATS: BagSpec[] = [
  // V1 seatDirections: (1216,704) "right" → east, (1328,704) "left" → west. They face each other.
  { id: "beanbag-west", x: 1216, z: 704, r: 16, yaw: FACING_YAW.east, stand: { x: 1224, z: 680 }, via: { x: 1216, z: 690 } },
  { id: "beanbag-east", x: 1328, z: 704, r: 16, yaw: FACING_YAW.west, stand: { x: 1336, z: 680 }, via: { x: 1328, z: 690 } },
  // V1 seatDirections: (1400,688) "front" → south, (1392,744) "back" → north.
  { id: "pouf-north", x: 1400, z: 688, r: 17, yaw: FACING_YAW.south, stand: { x: 1368, z: 680 }, via: { x: 1386, z: 686 } },
  { id: "pouf-south", x: 1392, z: 744, r: 16, yaw: FACING_YAW.north, stand: { x: 1352, z: 760 }, via: { x: 1374, z: 750 } },
];
function bagSlot(b: BagSpec): LoungeSeatSlot {
  return {
    id: `${b.id}-seat`,
    contactLocal: { x: 0, y: bagCrown(b.r), z: 0 }, // placed(rect,"north") leaves local axes world-aligned
    seatedYaw: b.yaw,
    approach: { ...b.stand },
    approachToSeat: [{ ...b.via }],
    sink: BAG_SINK,
    timings: { sitMs: 820, standMs: 780 },
  };
}
export const SOFA_SEAT_ID = `${GAMING_ROOM_ID}/${SOFA.id}`;
export const BAG_SEAT_IDS = BAG_SEATS.map((b) => `${GAMING_ROOM_ID}/${b.id}`);

// ---- walk-up points ------------------------------------------------------------------------------
// Physical anchors only: somewhere to stand and something to face. No product behaviour in 5C.
const cell = (cx: number, cy: number): Vec2 => ({ x: cx * CELL + CELL / 2, z: cy * CELL + CELL / 2 });

/** In the recovered north lane, square on the display. Cell (79, 41). */
export const TV_APPROACH: ApproachCapability = { point: cell(79, 41), yaw: FACING_YAW.north, label: "Games console", action: "Pick a game" };
/** Throwing line for the dartboard, cell (86, 41) — clear of the plant and of the nook's north pouf. */
export const DARTS_APPROACH: ApproachCapability = { point: cell(86, 41), yaw: FACING_YAW.north, label: "Dartboard", action: "Throw darts" };
/** The fridge stands in the wall run north of the door; cell (72, 45) is the only body-clear cell that
 *  can see it — the cells directly east of it are inside the cabinet run and blocked by V1. */
export const FRIDGE_APPROACH: ApproachCapability = { point: cell(72, 45), yaw: FACING_YAW.north, label: "Drinks fridge", action: "Grab a drink" };
/** Square on the east wall's neon print, cell (87, 48), clear of the nook footstool. */
export const POSTER_APPROACH: ApproachCapability = { point: cell(87, 48), yaw: FACING_YAW.east, label: "Arcade print", action: "Take a look" };

export const TV_INTERACTION_ID = `${GAMING_ROOM_ID}/tv-interaction`;
export const DARTS_INTERACTION_ID = `${GAMING_ROOM_ID}/darts-interaction`;
export const FRIDGE_INTERACTION_ID = `${GAMING_ROOM_ID}/fridge-interaction`;
export const POSTER_INTERACTION_ID = `${GAMING_ROOM_ID}/poster-interaction`;

// ---- the west entrance ----------------------------------------------------------------------------
/** A single glass leaf on the ROOM side of the wall, sliding SOUTH to park over the fixed glazed screen —
 *  the way a surface-mounted slider actually works, and what the artwork's framed glass wall implies.
 *  It fills the V1 '+' band exactly and parks entirely clear of it. */
export const DOOR_LEAF_ID = `${GAMING_ROOM_ID}/west-door`;
export const DOOR_LEAF = { x: WEST_X + 2, z: (DOOR.z0 + DOOR.z1) / 2, w: DOOR.z1 - DOOR.z0, h: 34 };
const BODY_RADIUS = 10.5; // Bon's widest walking extent, as Reception measures it

export const WEST_DOOR: DoorCapability = {
  slide: { x: 0, z: 1 },
  slideDistance: DOOR.z1 - DOOR.z0,
  automatic: true,
  /** the doorway itself: while a body overlaps this the door must be open and may not close */
  crossing: { x: WEST_OUTER_X - 8, z: DOOR.z0 - 2, w: (WEST_X + 8) - (WEST_OUTER_X - 8), d: DOOR.z1 - DOOR.z0 + 4 },
  /** both approach aprons — the hall lane outside and the room's west lane inside */
  trigger: { x: WEST_OUTER_X - 48, z: DOOR.z0 - 34, w: 112, d: DOOR.z1 - DOOR.z0 + 68 },
  clearance: {
    bodyRadius: BODY_RADIUS,
    band: { x: 69 * CELL, z: DOOR.z0, w: 2 * CELL, d: DOOR.z1 - DOOR.z0 }, // the V1 '+' cells, verbatim
    // deliberately EMPTY: 5B proved no mesh stands inside the band, and the reveals at its two edges are
    // the opening's own jambs. Declaring them would delete both door cells at V1's cell granularity.
    solids: [],
  },
  timings: { openMs: 850, closeMs: 1050, holdMs: 750 },
};

// ============================= ENTITIES =========================================================
function furniture(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, props: Record<string, string | number | boolean> = {}): Entity {
  return {
    id: `${GAMING_ROOM_ID}/${id}`,
    kind,
    roomId: GAMING_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    capabilities: {},
    props: { w, d, facing, mirrored: false, ...props },
  };
}
function plantEntity(id: string, x: number, z: number, r: number, h: number): Entity {
  return {
    id: `${GAMING_ROOM_ID}/${id}`,
    kind: "plant",
    roomId: GAMING_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    // 7B: a plant standing ON THE FLOOR is a logical obstacle; one on a shelf or in a planter box is not.
    // Radius is the pot, not the canopy — a body brushes past leaves. Inert until this room runs derived
    // navigation; authored now so the rollout is one less thing to remember.
    footprint: { shape: "circle", r: r * 0.9 },
    capabilities: { sway: true },
    props: { r, h, hanging: false, y: 0 },
    source: { baked: true },
  };
}

/** The room's movable-in-principle furniture as world entities. Architecture, the media wall, the desk
 *  run, the nook table/lamp and every LED are static (build/gaming.ts).
 *
 *  NO capabilities are attached in 5B: seating, walk-ups and the door controller are all 5C. */
export function gamingRoomEntities(): Entity[] {
  const out: Entity[] = [];
  // the gamepad rug: base pile plus a glowing inlay. `glow` is a LOW emissive — printed line art catching
  // the room's light, not a light source of its own.
  out.push(furniture("rug-gamepad", "rug", RUG.x + RUG.w / 2, RUG.z + RUG.d / 2, RUG.w, RUG.d, "north",
    { shape: "rect", color: THEME.rug }));
  out.push(furniture("rug-nook", "rug", NOOK.rug.x + NOOK.rug.w / 2, NOOK.rug.z + NOOK.rug.d / 2, NOOK.rug.w, NOOK.rug.d, "north",
    // its lit border is drawn and animated by build/gaming rugBorder
    { shape: "rect", color: THEME.accent }));
  // sofa: facing "west" turns the piece a quarter so its back lands on the SOUTH side and the sitter
  // looks north at the display (see build/furniture's sofa note).
  out.push(furniture(SOFA.id, "sofa", SOFA.x, SOFA.z, SOFA.w, SOFA.d, "west",
    { tone: "lounge", color: THEME.upholstery, colorSeat: THEME.upholsterySeat, accent: THEME.accent, seats: SOFA.seats }));
  out.push(furniture("coffee-table", "round-table", COFFEE_TABLE.x, COFFEE_TABLE.z, COFFEE_TABLE.r * 2, COFFEE_TABLE.r * 2, "north", { tone: "lounge", color: THEME.shell }));
  for (const b of BEANBAGS) out.push(furniture(b.id, "beanbag", b.x, b.z, b.r * 2, b.r * 2, "north", { color: b.color }));
  for (const p of NOOK.poufs) out.push(furniture(p.id, "beanbag", p.x, p.z, p.r * 2, p.r * 2, "north", { color: p.color }));
  // the four gaming chairs, facing SOUTH: the sitter looks at the monitors.
  STATIONS.forEach((cx, i) => out.push(furniture(`gaming-chair-${i}`, "gaming-chair", cx, CHAIR_Z, CHAIR_SIZE, CHAIR_SIZE, "south",
    { color: THEME.shell, accent: THEME.accent })));
  for (const p of PLANTS) out.push(plantEntity(p.id, p.x, p.z, p.r, p.h));
  return withGamingInteractions(out);
}

function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: GAMING_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** 5C: hang the MOVABLE seat capability on the four gaming chairs, the FIXED lounge capability on the
 *  sofa / bags / poufs, add the four walk-up points and the west door leaf. No geometry, no transforms
 *  and no ids change — every 5B entity is the same object it was, with capabilities added. */
export function withGamingInteractions(entities: Entity[]): Entity[] {
  STATIONS.forEach((_, i) => {
    const e = entities.find((x) => x.id === gamingChairId(i));
    if (!e) throw new Error(`gaming: no chair entity ${gamingChairId(i)}`);
    e.capabilities = { ...e.capabilities, seat: gamingChairSeat(i) };
  });
  const sofa = entities.find((x) => x.id === SOFA_SEAT_ID);
  if (!sofa) throw new Error("gaming: no sofa entity");
  sofa.capabilities = { ...sofa.capabilities, lounge: { slots: sofaSlots() } };
  for (const b of BAG_SEATS) {
    const e = entities.find((x) => x.id === `${GAMING_ROOM_ID}/${b.id}`);
    if (!e) throw new Error(`gaming: no bag entity ${b.id}`);
    e.capabilities = { ...e.capabilities, lounge: { slots: [bagSlot(b)] } };
  }
  entities.push(approachEntity(TV_INTERACTION_ID, "gaming-wall-tv", TV_APPROACH));
  entities.push(approachEntity(DARTS_INTERACTION_ID, "gaming-dartboard", DARTS_APPROACH));
  entities.push(approachEntity(FRIDGE_INTERACTION_ID, "gaming-west-fittings", FRIDGE_APPROACH));
  entities.push(approachEntity(POSTER_INTERACTION_ID, "gaming-east-nook", POSTER_APPROACH));
  entities.push({
    id: DOOR_LEAF_ID,
    kind: "sliding-door",
    roomId: GAMING_ROOM_ID,
    transform: { pos: { x: DOOR_LEAF.x, z: DOOR_LEAF.z }, yaw: 0 },
    capabilities: { door: WEST_DOOR },
    props: { leafW: DOOR_LEAF.w, glassH: DOOR_LEAF.h, handleX: 1.4, handleZ: -DOOR_LEAF.w / 2 + 5 },
    source: { baked: true },
  });
  return entities;
}
