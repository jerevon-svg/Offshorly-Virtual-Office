// vo3d rooms — PROJECT ROOM definition (data only, WORLD coordinates).
//
// Phase 4B. The EAST end of the front architectural bar: Meeting ← Reception → Project.
//
// Every number below is DERIVED, never invented:
//   • rect          → the READ-ONLY V1 asset manifest (x 1079.857, z 842.53, 352.143 × 395.53)
//   • interior      → the V1 walkability grid: cols 66–83 × rows 60–69, so the north wall face is z 960
//                     and the east boundary begins at col 84 (x 1344)
//   • sofas/chairs  → the grid's blocked furniture blocks and its 'o' seat cells, which match V1's
//                     seatDirections entries (1136,1008) (1264,1008) (1168,1088) (1232,1088) exactly
//   • façade plane  → FACADE_Z, shared with Reception and Meeting
//   • everything else → measured off src/assets/office/rooms/project-room.png at 0.125 units/px
//
// The flat PNG is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, type Rect } from "../core/coords";
import type { ApproachCapability, Entity, LoungeSeatSlot, RoomDef } from "../world/WorldState";
import { CELL } from "../adapters/v1Grid";
import { TUB_CUSHION_TOP } from "../build/furniture";
import { v1RoomRect } from "../adapters/v1Manifest";
import { FACADE_Z } from "../adapters/v1Floor";
import { GATE, RECT as RECEPTION_RECT, STRUCT } from "./reception";
import { kindFootprint } from "./footprint";

export const PROJECT_ROOM_ID = "project-room";
export const RECT: Rect = v1RoomRect(PROJECT_ROOM_ID); // x 1079.857, z 842.53, w 352.143, d 395.53

/** The room's west limit for every piece of GEOMETRY it builds.
 *
 *  The art bounding box starts at 1079.857 but Reception's rect ends at 1081.285 — a 1.428-unit overlap.
 *  That sliver is not cosmetic: cell (67, 60…69) has its centre at world x = 1080, INSIDE both rects, so a
 *  region built on the raw rect would steal a walkable cell from Reception (region order decides), and the
 *  two tiled plates would z-fight along the whole seam. Project therefore starts at Reception's own east
 *  edge, exactly. The V1 grid is untouched. */
export const WEST_EDGE = RECEPTION_RECT.x + RECEPTION_RECT.w; // 1081.285

/** NORTH WALL — corrected in 4C. 4B built the artwork's cove wall as a solid mass from the room's art
 *  bounding box (z 842.53) to z 960: 117 units of solid cream behind the sofas. That depth is the flat
 *  render's baked perspective, not wall thickness. It is now a real 12-unit wall whose inner face sits at
 *  948, and the strip the mass gave back is what makes the north circulation lane physically work.
 *  Cove/LED design, slat panel, furniture and layout are unchanged. */
export const WALL_T = 12;
/** ALIGNED TO RECEPTION. Reception's own north architectural line is its glass balustrade plane, GATE.z —
 *  the only wall-like element it builds at that end, and a measured V1-derived coordinate (rooms/reception).
 *  Both neighbours put their north wall's INNER face on exactly that line, so the three rooms end on one
 *  continuous architectural line instead of three arbitrary depths, and each gains its full usable depth. */
export const WALL_Z = GATE.z; // 890 — Reception's balustrade plane
export const WALL_OUTER_Z = WALL_Z - WALL_T; // 878
/** East wall face, measured off the art (the console run stands against it; the TV hangs on it). */
export const EAST_WALL_X = 1400;

/** Walkable floor region: generous, since the V1 grid alone decides which cells are open. The WEST edge is
 *  left completely open — no wall, no boundary geometry — so the tile runs straight on into Reception. */
export const FLOOR_RECT: Rect = { x: WEST_EDGE, z: WALL_Z, w: RECT.x + RECT.w - WEST_EDGE, d: FACADE_Z - WALL_Z };
/** The tiled interior plate, run to the wall's OUTER face so no void is left under it. Grout stays phased
 *  to the WORLD by tiledFloor(), so the bar's floor reads continuous whatever the room's depth. */
export const TILE_RECT: Rect = { x: FLOOR_RECT.x, z: WALL_OUTER_Z, w: FLOOR_RECT.w, d: FACADE_Z - WALL_OUTER_Z };

/** PROJECT'S PHYSICAL WALLS, as pure data for derived navigation (7C) — the same runs build/project.ts
 *  extrudes. Solid north + solid east, glass south, and NOTHING west: the tile runs on into Reception. */
export const PROJECT_WALLS: Rect[] = [
  { x: WEST_EDGE, z: WALL_OUTER_Z, w: RECT.x + RECT.w - WEST_EDGE, d: WALL_T }, // north
  { x: EAST_WALL_X, z: WALL_Z, w: RECT.x + RECT.w - EAST_WALL_X, d: FACADE_Z - WALL_Z }, // east
  { x: WEST_EDGE, z: FACADE_Z, w: EAST_WALL_X - WEST_EDGE, d: STRUCT.wallThickness }, // south façade glazing
];

export const PROJECT_ROOM: RoomDef = {
  id: PROJECT_ROOM_ID,
  name: "Project Room",
  rect: RECT,
  floorRect: FLOOR_RECT,
  wallSolids: PROJECT_WALLS,
  // no `shell`: solid north + solid east, glass south, NOTHING west — its own static builder instead.
};

// ============================= ARCHITECTURE =====================================================

export const NORTH_WALL = { x0: WEST_EDGE, x1: RECT.x + RECT.w, z0: WALL_OUTER_Z, z1: WALL_Z, h: STRUCT.wallHeight };
export const EAST_WALL = { x0: EAST_WALL_X, x1: RECT.x + RECT.w, z0: WALL_Z, z1: FACADE_Z, h: STRUCT.wallHeight };

/** The wood-slat feature panel in the NE corner (art x 1357…1408), on the north wall's face and trimmed
 *  so it stops at the east wall rather than running into it. */
export const NE_SLATS = { from: 1348, to: EAST_WALL_X, y0: 11, y1: 44 };

/** The painted bi-parting glass door in the street façade — STATIC glass only, no '+' cells in the grid. */
export const FACADE_DOOR = { x0: 1165, x1: 1238 };

/** V2-LOCAL walkability addition (nav/v2Open.ts): the strip 4B's north wall mass used to swallow, now
 *  real tiled floor between the corrected wall's inner face (948) and V1's own north lane (960). */
export const NORTH_STRIP = {
  id: "project-north-strip",
  rect: { x: WEST_EDGE, z: WALL_Z, w: EAST_WALL_X - 1 - WEST_EDGE, d: 60 * 16 - WALL_Z } as Rect, // up to V1's own lane at 960
  solids: [] as Rect[], // the east wall bounds the band rather than standing in it
};

// ============================= FURNITURE ========================================================

/** The two facing sofas. Grid blocks cols 69–71 and 78–80 × rows 60–66; the artwork's west sofa measures
 *  x 1109.9…1157.4, z 961.3…1072.5 — the same piece. Long axis in z, backs to the outside, exactly the
 *  arrangement build/furniture.ts's sofa is authored for (back-to-west, `mirrored` flips it east). */
export const SOFAS = [
  // `stand` is V1's own authored stand-here cell for that sofa: (70,67) and (79,67)
  { id: "sofa-west", x: 1128, z: 1016, w: 48, d: 112, mirrored: false, stand: { x: 1128, z: 1080 } },
  { id: "sofa-east", x: 1272, z: 1016, w: 48, d: 112, mirrored: true, stand: { x: 1272, z: 1080 } },
];

/** The rectangular coffee table between them (grid block cols 73–76 × rows 61–66; art 1178…1222 ×
 *  987…1070). Sized to the ARTWORK, not to the grid block — the grid's block includes the clearance
 *  V1 baked around it, and building to that would make the table read bulky and wrong. */
export const COFFEE_TABLE = { x: 1200, z: 1028, w: 46, d: 84 };

/** The two tub armchairs flanking the low bench, at V1's own seat anchors. */
export const ARMCHAIRS = [
  // `stand` is V1's own authored stand-here cell for that armchair: (71,68) and (78,68)
  { id: "tub-chair-west", x: 1168, z: 1088, w: 32, d: 32, facing: "east" as const, stand: { x: 1144, z: 1096 } },
  { id: "tub-chair-east", x: 1232, z: 1088, w: 32, d: 32, facing: "west" as const, stand: { x: 1256, z: 1096 } },
];
/** The low wood bench/console between the armchairs (grid cols 74–75 × rows 67–68; art 1179.6…1219). */
export const BENCH = { x: 1184, z: 1072, w: 32, d: 32, h: 12 };

/** The dark-walnut coffee/equipment console against the east wall (art x 1353.6…1399.2, running the room's
 *  full interior depth; shortened at the south end where the artwork stands a large floor plant). */
export const CONSOLE = { x: 1354, z: 962, w: EAST_WALL_X - 1354, d: 120, h: 26, modules: 5 };
/** The machines the artwork lines up along it, north → south, as offsets on the console top. */
export const CONSOLE_KIT = [
  { z: 972, kind: "espresso" as const },
  { z: 998, kind: "brewer" as const },
  { z: 1024, kind: "grinder" as const },
  { z: 1046, kind: "grinder" as const },
  { z: 1072, kind: "brewer" as const },
];
/** The large wall display on the east wall's inner face (art z 960.4…1041 — that z extent is the screen's
 *  true WIDTH; its x extent is the projected height). */
export const WALL_TV = { z0: 964, z1: 1036, y0: 8, y1: 44 };

/** Exterior planters on the shared front ledge (art x ≈ 1250…1279 and 1365…1401). */
export const LEDGE_PLANTERS = [
  { x: 1265, z: 1143, r: 12, h: 22 },
  { x: 1383, z: 1143, r: 12, h: 22 },
];

// ============================= ENTITIES =========================================================

function furnitureEntity(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, mirrored = false): Entity {
  return {
    id: `${PROJECT_ROOM_ID}/${id}`,
    kind,
    roomId: PROJECT_ROOM_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: kindFootprint(kind, w, d),
    capabilities: {},
    props: { w, d, facing, mirrored, tone: "lounge" },
  };
}

function plantEntity(id: string, x: number, z: number, r: number, h: number, y = 0, lush?: number, pot = true): Entity {
  return {
    id: `${PROJECT_ROOM_ID}/${id}`,
    kind: "plant",
    roomId: PROJECT_ROOM_ID,
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

/** Project's lounge furniture and planting as world entities — 4C hangs the lounge-seat capabilities on
 *  the sofas and armchairs. The console run, bench, TV and architecture are static (build/project.ts). */
export function projectRoomEntities(): Entity[] {
  const out: Entity[] = [];
  for (const s of SOFAS) out.push(furnitureEntity(s.id, "sofa", s.x, s.z, s.w, s.d, "south", s.mirrored));
  out.push(furnitureEntity("coffee-table", "lounge-table", COFFEE_TABLE.x, COFFEE_TABLE.z, COFFEE_TABLE.w, COFFEE_TABLE.d, "north"));
  for (const c of ARMCHAIRS) out.push(furnitureEntity(c.id, "tub-chair", c.x, c.z, c.w, c.d, c.facing));
  // the large floor plant standing at the console's south end, and the ledge palms
  out.push(plantEntity("plant-console", 1376, 1100, 12, 34));
  LEDGE_PLANTERS.forEach((p, i) => out.push(plantEntity(`ledge-palm-${i}`, p.x, p.z, 11, 26, p.h - 1.5, 1.5, false)));
  return withProjectInteractions(out);
}

// ============================= 4C GAMEPLAY ======================================================
// FIXED seating only. A sofa and a tub chair never move, so every seat here uses LoungeSeatCapability /
// LoungeSeatInteraction — the controller never writes to a furniture transform, so drift is zero by
// construction. No 4B geometry changes.

/** Sofa cushion geometry, read off build/furniture.ts so the metadata cannot drift from the mesh:
 *    deck base y 2, deckH 8            → deck top 10
 *    seat cushion base deckH+2 = 10, 5.6 tall (lounge tone) → cushion TOP 15.6
 *    cushion local x = backW/2 + 0.5   = 5.0   (backW 9 for the lounge tone)
 *    cushion local z = ±(cushD/2 + 0.6), cushD = (d - 2*armW - 3)/2 = 48 → ±24.6
 *  The sofa is authored back-to-WEST and the east sofa is the same group rotated π, so ONE set of local
 *  numbers serves both. */
export const SOFA_CUSHION_TOP = 15.6;
export const SOFA_CUSHION_LOCAL_X = 5.0;
export const SOFA_CUSHION_LOCAL_Z = 24.6;
/** 4C correction: 0.6 of sink plus a contact on the cushion's own centre put the body low and back into
 *  the seat back. The pelvis now rests ON the surface (no sink) and the contact sits 1.5 units FORWARD of
 *  the cushion centre — the sitter lands centred on the cushion instead of wedged against the backrest. */
export const SOFA_SINK = 0;
export const SOFA_CONTACT_FORWARD = 1.5;
/** Tub chair: the same exported figure Reception's lounge chairs derive from. */
export const TUB_SINK = 0.3;

/** TWO slots per sofa and no more. The builder lays exactly two seat cushions per sofa (cushD 48 each
 *  across a 112-deep frame, between two 6.5 arms), so two is the physically valid count — a third
 *  "middle" slot would seat a body on the gap between cushions. */
const SOFA_SLOT_Z = [-SOFA_CUSHION_LOCAL_Z, SOFA_CUSHION_LOCAL_Z];
/** where the sofa/table aisle is entered: north of the armchairs (z 1072) and beside the sofa (ends 1072) */
const AISLE_ENTRY_Z = 1064;

function sofaSlots(sofa: (typeof SOFAS)[number]): LoungeSeatSlot[] {
  // mirrored sofas are the same group turned π, so local +x/+z map to world −x/−z
  const m = sofa.mirrored ? -1 : 1;
  const frontX = sofa.x + m * (sofa.w / 2); // the open side the sitter walks in from
  const aisleX = sofa.x + m * (sofa.w / 2 + 12); // the clear lane between sofa and coffee table
  return SOFA_SLOT_Z.map((lz, i) => {
    const worldZ = sofa.z + m * lz;
    return {
      id: `${sofa.id}-${i === 0 ? "north" : "south"}`,
      contactLocal: { x: SOFA_CUSHION_LOCAL_X + SOFA_CONTACT_FORWARD, y: SOFA_CUSHION_TOP, z: lz },
      seatedYaw: sofa.mirrored ? FACING_YAW.west : FACING_YAW.east,
      approach: { ...sofa.stand }, // V1's own authored stand cell for this sofa
      // up the aisle between sofa and coffee table (entering NORTH of the armchairs), then square on to
      // the cushion. Waypoints are walked directly, so they are chosen clear of every neighbouring piece.
      approachToSeat: [{ x: aisleX, z: AISLE_ENTRY_Z }, { x: aisleX, z: worldZ }, { x: frontX + m * 2, z: worldZ }],
      sink: SOFA_SINK,
      timings: { sitMs: 780, standMs: 720 },
    };
  });
}

function tubSlot(chair: (typeof ARMCHAIRS)[number]): LoungeSeatSlot {
  // placed(rect, facing) points local −z at `facing`, so local +z is the chair's BACK
  const m = chair.facing === "east" ? -1 : 1; // local +z → world −x when facing east
  return {
    id: `${chair.id}-seat`,
    contactLocal: { x: 0, y: TUB_CUSHION_TOP, z: 3.5 },
    seatedYaw: chair.facing === "east" ? FACING_YAW.east : FACING_YAW.west,
    approach: { ...chair.stand }, // V1's own authored stand cell
    approachToSeat: [{ x: chair.x + m * (chair.w / 2 + 4), z: chair.z }],
    sink: TUB_SINK,
    timings: { sitMs: 750, standMs: 700 },
  };
}

export const SOFA_SEAT_IDS = SOFAS.map((s) => `${PROJECT_ROOM_ID}/${s.id}`);
export const TUB_SEAT_IDS = ARMCHAIRS.map((c) => `${PROJECT_ROOM_ID}/${c.id}`);

// ---- walk-up points ----------------------------------------------------------------------------
/** In front of the coffee/equipment console: cell (83, 64). The console's west face is x 1354 and a 10.5
 *  body on this cell reaches 1346.5 — 7.5 units clear. */
export const CONSOLE_APPROACH: ApproachCapability = {
  point: { x: 83 * CELL + CELL / 2, z: 64 * CELL + CELL / 2 }, // (1336, 1032)
  yaw: FACING_YAW.east,
  label: "Coffee station",
  action: "Make a coffee",
};
/** Standing back from the console to read the wall board: cell (82, 62), square on the display's centre
 *  line (z 1000) and clear of both the console and the sofas. */
export const TV_APPROACH: ApproachCapability = {
  point: { x: 82 * CELL + CELL / 2, z: 62 * CELL + CELL / 2 }, // (1320, 1000)
  yaw: FACING_YAW.east,
  label: "Project board",
  action: "View the board",
};
export const CONSOLE_INTERACTION_ID = `${PROJECT_ROOM_ID}/console-interaction`;
export const TV_INTERACTION_ID = `${PROJECT_ROOM_ID}/tv-interaction`;

function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: PROJECT_ROOM_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** 4C: hang the FIXED lounge capability on the two sofas and two tub chairs, and add the two walk-up
 *  points. Geometry, ids and transforms are untouched. */
export function withProjectInteractions(entities: Entity[]): Entity[] {
  for (const s of SOFAS) {
    const e = entities.find((x) => x.id === `${PROJECT_ROOM_ID}/${s.id}`);
    if (!e) throw new Error(`project: no sofa entity ${s.id}`);
    e.capabilities = { ...e.capabilities, lounge: { slots: sofaSlots(s) } };
  }
  for (const c of ARMCHAIRS) {
    const e = entities.find((x) => x.id === `${PROJECT_ROOM_ID}/${c.id}`);
    if (!e) throw new Error(`project: no armchair entity ${c.id}`);
    e.capabilities = { ...e.capabilities, lounge: { slots: [tubSlot(c)] } };
  }
  entities.push(approachEntity(CONSOLE_INTERACTION_ID, "project-east-console", CONSOLE_APPROACH));
  entities.push(approachEntity(TV_INTERACTION_ID, "project-wall-tv", TV_APPROACH));
  return entities;
}
