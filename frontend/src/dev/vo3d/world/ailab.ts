// vo3d world — THE OFFSHORLY AI LAB: placement, walkable route and collision, as data.
//
// WHAT THIS IS. A hidden R&D annexe standing on the Offshorly lot's north-east lawn, reached on foot by
// walking OUT of the office's south sidewalk, EAST around the building and NORTH up a raised causeway.
// The normal workplace stays the product; the Lab is something you find by going behind it.
//
// THE ONE ARCHITECTURAL DECISION, and the reason this file exists at all:
//
//   The V1 navigation grid is 90 x 78 cells of 16 units — it describes x 0…1440, z 0…1248 and NOTHING
//   else. Both walkability layers allocate COLS x ROWS arrays and hard-guard those bounds, so a point
//   north of the office (negative z) or east of it (x > 1440) is not merely unwalkable, it is not
//   ADDRESSABLE. No region registration changes that, and widening the grid would rewrite the office's
//   own navigation.
//
//   So the Lab does what the CAVE already does (rooms/cave.ts): it stands OFF-GRID and answers the
//   "can I stand here?" question from its OWN geometry, composed into the player's stand test beside
//   the office's. It is a ROUTING of the question, not a relaxation of it — every wall, desk, planter
//   and platform edge below genuinely stops a body, and there is no point in the world where both tests
//   are consulted or neither is.
//
// WHAT THIS DELIBERATELY IS NOT. No room, no entity, no WorldState region, no footprint, no change to
// `world.bounds`, no A* / click-to-walk support, no camera-fence change. Free player movement only —
// which is exactly what the Cave proved is enough for an off-grid volume, because A* routes on CELLS and
// there are no cells out here to route on.
//
// VERTICAL DATUM. The player body is 2D (player/PlayerBody carries no y), and the office floor sits at
// the podium top. So the causeway and the Lab plate are both RAISED DECKS at that same datum rather than
// lawn-level paving — the walk reads as a deliberate elevated approach instead of the avatar floating
// 8 units over the grass.
import type { Rect, Vec2 } from "../core/coords";

/** the podium top — the office's own ground plane (world/campus PODIUM_TOP). Everything here decks to it. */
export const DECK_Y = 0.2;
/** lawn grade, for the skirt of every raised deck (world/campus GRADE) */
export const GRADE = -8;

// ============================= THE PLAN, RECONSTRUCTED ==========================================
// This is a 3D RECONSTRUCTION of the AI Lab concept, in the same spirit as V2's flat-room → true-3D
// reconstructions: the reference owns the PLAN (footprint, corner cuts, entrance, circulation, where the
// hub and the four zones sit, where the planting goes) and the Virtual Office owns the LANGUAGE (warm
// cream architecture, mint/blue AI accents, dark technical screens, existing foliage and furniture).
//
// WHAT THE REFERENCE SHOWS, and how each piece lands in world coordinates:
//
//   · a WIDE PLATE with all four corners cut away          → WALL_SEGS, a ten-segment polygon
//   · a CENTRAL SOUTH ENTRANCE reached by a broad flight   → the gap at x 654…826 + PORCH/steps
//   · a CIRCULAR PLANTED HUB low and centre                → HUB (740, −600) r 110
//   · FOUR WORK ZONES in the quadrants around it           → ZONES, two desks and two agents each
//   · PLANTING AS ARCHITECTURE, not decoration             → zone planters, perimeter pots, corner trees
//   · the plate TERMINATING AGAINST THE LAKE               → the north gap, spur and lakeside terrace
//
// The plan is NOT mirrored: the reference's zones differ from each other and so do these.
// ============================= THE FOOTPRINT ====================================================
/** the plate's bounding box — used for framing and for the plinth, never for collision */
export const LAB_OUTER: Rect = { x: 300, z: -980, w: 880, d: 540 };
/** low perimeter wall: knee-to-waist height, so every camera sees straight into an OPEN-TOP room */
export const WALL_T = 9;
export const WALL_H = 24;
/** the terrace outside the wall, and how far the plinth's corners are cut back */
export const PLINTH_MARGIN = 64;

/** the open entrance in the south wall, as an x span, and the lake gap in the north wall */
export const ENTRY_X0 = 654;
export const ENTRY_X1 = 826;
export const LAKE_GAP_X0 = 676;
export const LAKE_GAP_X1 = 804;
/** how far the entrance porch projects south of the wall line, and its flight of steps */
export const PORCH_DEPTH = 80;
export const STEP_COUNT = 3;

/** THE PERIMETER, as built segments. Two gaps — the south entrance and the north lake opening — are
 *  simply absent from this list, which is what makes them openings rather than doors. */
export const WALL_SEGS: readonly (readonly [Vec2, Vec2])[] = [
  [{ x: 380, z: -980 }, { x: LAKE_GAP_X0, z: -980 }], // north, west of the lake opening
  [{ x: LAKE_GAP_X1, z: -980 }, { x: 1100, z: -980 }], // north, east of it
  [{ x: 1100, z: -980 }, { x: 1180, z: -900 }], // NE corner cut
  [{ x: 1180, z: -900 }, { x: 1180, z: -520 }], // east
  [{ x: 1180, z: -520 }, { x: 1120, z: -440 }], // SE corner cut
  [{ x: 1120, z: -440 }, { x: ENTRY_X1, z: -440 }], // south, east of the entrance
  [{ x: ENTRY_X0, z: -440 }, { x: 360, z: -440 }], // south, west of it
  [{ x: 360, z: -440 }, { x: 300, z: -520 }], // SW corner cut
  [{ x: 300, z: -520 }, { x: 300, z: -900 }], // west
  [{ x: 300, z: -900 }, { x: 380, z: -980 }], // NW corner cut
];

// ============================= THE ROUTE ========================================================
// THERE IS NO SPECIAL CORRIDOR. The office's own podium already extends 48 units past the building on
// every side (campus PODIUM_MARGIN) at exactly the height a body walks at, so the entire journey down
// the east flank is the EXISTING exterior circulation — LEG_N and APRON declare it walkable and DRAW
// NOTHING AT ALL. Only the rear garden path across the lawn is new geometry.

/** the seam with the V1 sidewalk, at the building's south-east corner. Wholly on the podium. */
export const APRON: Rect = { x: 1392, z: 1200, w: 96, d: 40 };
/** north up the east flank, ON the podium margin. Nothing is built here. */
export const LEG_N: Rect = { x: 1440, z: -48, w: 48, d: 1288 };
/** off the podium's north-east corner onto the rear lawn. It runs back ONTO the podium on purpose —
 *  see the overlap rule below. */
export const PATH_LINK: Rect = { x: 1424, z: -300, w: 64, d: 276 };
/** west across the rear campus, behind the building, with the lab screen planting to the north */
export const PATH_W: Rect = { x: 700, z: -300, w: 788, d: 64 };
/** the turn-in: north through the gap in the screen planting, to the foot of the Lab's steps */
export const PATH_IN: Rect = { x: 696, z: -430, w: 80, d: 194 };

// ---- the room itself, as walkable rects inscribed in the polygon ---------------------------------
/** THE MAIN FLOOR. Inscribed inside the chamfered wall so no rect ever pokes through a corner cut —
 *  the cut corners are where the big planting stands anyway, exactly as the reference uses them. */
export const HALL: Rect = { x: 390, z: -960, w: 700, d: 460 };
/** the south bay, in front of the hub, between the two lower zones */
export const SOUTH_BAY: Rect = { x: 400, z: -520, w: 680, d: 72 };
/** the entrance throat and porch landing, projecting through the south wall */
export const PORCH: Rect = { x: 662, z: -470, w: 156, d: 110 };
/** out through the north wall to the water */
export const LAKE_SPUR: Rect = { x: 690, z: -1040, w: 100, d: 116 };
/** the lakeside viewing terrace the Lab terminates against. It stops short of the pond's shore band
 *  (which reaches z -1056) — walking into the water is the one thing this route must never allow. */
export const LAKE_TERRACE: Rect = { x: 620, z: -1040, w: 240, d: 66 };

/** THE WALKABLE UNION. A body's centre AND its four rim samples must all land inside one of these, which
 *  is what makes the plate edge and the perimeter wall stop a body without either being a solid.
 *
 *  ADJOINING RECTS MUST OVERLAP BY MORE THAN 2 x NAV_RADIUS. The handover predicate below is this union
 *  inset by the body radius, so two legs that merely touch leave a radius-wide hole between their insets
 *  that nothing can stand in. ailab.test.ts locks that for every pair in the chain. */
export const WALK: readonly Rect[] = [HALL, SOUTH_BAY, PORCH, LAKE_SPUR, LAKE_TERRACE, APRON, LEG_N, PATH_LINK, PATH_W, PATH_IN];
/** the legs that are DRAWN as paving — the two that sit on the office's own podium are not */
export const PAVED: readonly Rect[] = [PATH_LINK, PATH_W, PATH_IN];

// ============================= THE CENTRAL HUB ==================================================
/** THE ARCHITECTURAL HEART: a low circular planted island, set low-and-centre as the reference places it.
 *
 *  THE RADIUS IS A CIRCULATION DECISION, not a styling one. At r110 the island left 622 to the west wall
 *  and the west wall is at 395 — 227 units for a work zone AND a lane, which meant every desk had to be
 *  shoved against the perimeter and the room read as a ring of furniture round an empty cross. At r88
 *  the lane beside it is 84–94 units clear, which is what lets the zones come inward and the floor fill up. */
export const HUB = { x: 740, z: -600, r: 88 };
/** the latitudes the island occupies. North and south of this band a work island may project right in
 *  toward the centre line; alongside it the zones hold back so the two lanes stay open. */
export const HUB_BAND = { z0: HUB.z - HUB.r, z1: HUB.z + HUB.r };

// ============================= THE FOUR ZONES ===================================================
export type ZoneId = "nw" | "ne" | "sw" | "se";
export type AgentSlot = { x: number; z: number; yaw: number; agent: string | null };
/** a desk: its rect, the direction its operator faces, and how many screens sit on its far edge */
export type Station = { rect: Rect; yaw: number; screens: number };
export type Zone = {
  id: ZoneId;
  stations: readonly Station[];
  slots: readonly AgentSlot[];
  /** low technical surfaces carrying small monitor banks — equipment, not architecture */
  consoles: readonly Rect[];
  planters: readonly Planter[];
  tables: readonly { x: number; z: number; r: number }[];
  /** only two zones get one, and they run in different directions — four matching screens read as a grid */
  partition: Rect | null;
};

const N = 0, E = -Math.PI / 2, W = Math.PI / 2;

/** THE FOUR ZONES, deliberately NOT variations of one another. Each has a different desk count, a
 *  different silhouette (NW an L, NE a C, SW a stepped L, SE a mirrored stepped L with its island pushed
 *  further in), a different number of tables and consoles, and only two carry a partition. What they
 *  share is the rule that keeps the room walkable: alongside the island (z -688…-512) nothing on the west
 *  goes past x 552 and nothing on the east comes back of x 928; north and south of it, the work islands
 *  project right in toward the centre line. */
export const ZONES: readonly Zone[] = [
  {
    id: "nw",
    stations: [
      { rect: { x: 400, z: -930, w: 180, d: 44 }, yaw: N, screens: 3 },
      { rect: { x: 396, z: -846, w: 44, d: 110 }, yaw: W, screens: 2 },
      { rect: { x: 520, z: -812, w: 140, d: 40 }, yaw: N, screens: 2 }, // island, projecting inward
    ],
    slots: [{ x: 490, z: -872, yaw: N, agent: null }, { x: 468, z: -790, yaw: W, agent: null }],
    consoles: [{ x: 400, z: -730, w: 120, d: 32 }],
    planters: [{ x: 602, z: -928, w: 34, d: 34, form: "bed", plant: "medium" }, { x: 452, z: -756, w: 28, d: 28, form: "round", plant: "medium" }, { x: 396, z: -672, w: 34, d: 34, form: "corner", plant: "large" }],
    tables: [],
    partition: { x: 512, z: -730, w: 8, d: 96 },
  },
  {
    id: "ne",
    stations: [
      { rect: { x: 880, z: -930, w: 200, d: 44 }, yaw: N, screens: 4 },
      { rect: { x: 1046, z: -846, w: 44, d: 110 }, yaw: E, screens: 2 },
      { rect: { x: 844, z: -800, w: 40, d: 120 }, yaw: E, screens: 2 }, // island, side-on to the centre
    ],
    slots: [{ x: 980, z: -872, yaw: N, agent: "worker" }, { x: 978, z: -790, yaw: E, agent: null }],
    consoles: [{ x: 900, z: -880, w: 120, d: 28 }],
    planters: [{ x: 846, z: -928, w: 30, d: 30, form: "tech", plant: "shrub" }, { x: 1046, z: -672, w: 34, d: 34, form: "bed", plant: "medium" }],
    tables: [{ x: 912, z: -742, r: 24 }],
    partition: null,
  },
  {
    id: "sw",
    stations: [
      { rect: { x: 396, z: -660, w: 150, d: 44 }, yaw: N, screens: 3 },
      { rect: { x: 396, z: -576, w: 44, d: 96 }, yaw: W, screens: 2 },
      { rect: { x: 470, z: -500, w: 130, d: 38 }, yaw: N, screens: 2 }, // island, south of the band
    ],
    slots: [{ x: 470, z: -604, yaw: N, agent: "master" }, { x: 468, z: -524, yaw: W, agent: null }],
    consoles: [],
    planters: [{ x: 452, z: -716, w: 28, d: 28, form: "round", plant: "medium" }, { x: 396, z: -486, w: 32, d: 32, form: "corner", plant: "large" }],
    tables: [{ x: 556, z: -540, r: 26 }],
    partition: null,
  },
  {
    id: "se",
    stations: [
      { rect: { x: 930, z: -660, w: 150, d: 44 }, yaw: N, screens: 3 },
      { rect: { x: 1042, z: -576, w: 44, d: 96 }, yaw: E, screens: 2 },
      { rect: { x: 880, z: -500, w: 150, d: 38 }, yaw: N, screens: 3 }, // island, set back off the entrance axis
    ],
    slots: [{ x: 1004, z: -604, yaw: N, agent: "commit" }, { x: 974, z: -524, yaw: E, agent: null }],
    consoles: [{ x: 928, z: -700, w: 110, d: 30 }],
    planters: [{ x: 1046, z: -716, w: 28, d: 28, form: "tech", plant: "grass" }, { x: 930, z: -486, w: 32, d: 32, form: "bed", plant: "medium" }],
    tables: [{ x: 1000, z: -760, r: 24 }],
    partition: { x: 906, z: -872, w: 96, d: 8 },
  },
];

// ============================= THE PLANTING VOCABULARY ==========================================
/** THE FOUR PLANTER FORMS the Lab may use. The old composition was one of these repeated everywhere — a
 *  dark square trough — which from overhead read as a row of markers rather than as landscaping. Mixing
 *  the office's OWN existing planter languages is what turns it back into a designed scheme:
 *
 *    bed     a cream stone rim with recessed soil, holding two or three plants (the Central Hub's
 *            pantry-planter language, build/central-hub planterBox)
 *    round   the office's tapered planter with a rolled lip (build/props pot) in warm cream
 *    tech    the front bar's dark metal ledge planter (build/frontbar ledgePlanter) — the technical note
 *    corner  a larger cream bed carrying a feature plant, for the cut corners and zone hand-overs
 */
export type PlanterForm = "bed" | "round" | "tech" | "corner";
/** what stands IN the planter: the office's own tiered plant family (build/plants) */
export type PlantKind = "medium" | "large" | "shrub" | "grass";
export type Planter = Rect & { form: PlanterForm; plant: PlantKind };

/** PERIMETER POTS, set along the inside of the wall as the reference sets them — irregularly spaced,
 *  never opposite one another, and no two adjacent ones the same form. Rects are unchanged from the
 *  approved layout: this pass changes what is DRAWN in them, not where a body may walk. */
export const PERIMETER_POTS: readonly Planter[] = [
  { x: 660, z: -958, w: 30, d: 30, form: "tech", plant: "grass" },
  { x: 1112, z: -498, w: 34, d: 34, form: "round", plant: "medium" },
  { x: 1120, z: -868, w: 34, d: 34, form: "bed", plant: "medium" },
  { x: 1120, z: -700, w: 30, d: 30, form: "tech", plant: "shrub" },
  { x: 1030, z: -486, w: 30, d: 30, form: "round", plant: "medium" },
  { x: 440, z: -486, w: 34, d: 34, form: "bed", plant: "medium" },
];

/** INTERIOR PLANTING, threaded between the clusters rather than lined up along anything. The `corner`
 *  ones carry a large plant and mark where one zone hands over to the next. */
export const INTERIOR_POTS: readonly Planter[] = [
  { x: 668, z: -846, w: 26, d: 26, form: "corner", plant: "large" },
  { x: 812, z: -880, w: 28, d: 28, form: "corner", plant: "large" },
  { x: 620, z: -884, w: 30, d: 30, form: "bed", plant: "medium" },
  { x: 866, z: -690, w: 26, d: 26, form: "corner", plant: "large" },
  // the two that frame the arrival, standing on the porch either side of the entrance axis
  { x: 668, z: -400, w: 26, d: 26, form: "bed", plant: "medium" },
  { x: 792, z: -400, w: 26, d: 26, form: "bed", plant: "medium" },
  { x: 560, z: -466, w: 24, d: 24, form: "corner", plant: "large" },
  { x: 900, z: -820, w: 26, d: 26, form: "corner", plant: "large" },
];

/** ARCHITECTURAL PLANTING BEDS, in the band between the walkable floor and the perimeter wall.
 *
 *  THAT BAND IS FREE. The hall stops at x 390/1090 and z -960, the wall stands at 300/1180 and -980, and
 *  nothing can walk in between — so a long bed there is pure landscape with ZERO circulation risk, which
 *  is exactly where the reference puts its deepest planting. None of these carry a collision solid. */
export const WALL_BEDS: readonly (Rect & { plants: number })[] = [
  // The deep west and east runs, behind the desks that back onto those walls. Each one stops short of
  // the latitude where the corner cut starts (z -900 / -520), because past that the wall comes in on the
  // diagonal and a rectangle would poke through it.
  { x: 312, z: -896, w: 74, d: 166, plants: 4 },
  { x: 312, z: -708, w: 74, d: 190, plants: 4 },
  { x: 1094, z: -900, w: 74, d: 156, plants: 4 },
  { x: 1094, z: -736, w: 74, d: 212, plants: 5 },
  // the north band, either side of the lake opening
  { x: 420, z: -976, w: 160, d: 14, plants: 3 },
  { x: 860, z: -976, w: 170, d: 14, plants: 3 },
];

/** the big corner greenery the cut corners exist to hold */
export const CORNER_TREES: readonly { x: number; z: number; s: number }[] = [
  { x: 352, z: -932, s: 1.15 }, { x: 1128, z: -928, s: 1 },
  { x: 348, z: -486, s: 0.92 }, { x: 1132, z: -492, s: 1.08 },
];

/** WALL PILASTERS: short piers projecting inward off selected wall runs, so the perimeter has depth from
 *  overhead instead of reading as one flat ribbon. Cheap boxes, and only on three of the ten runs. */
export const PILASTERS: readonly Rect[] = [
  { x: 620, z: -974, w: 18, d: 22 }, { x: 844, z: -974, w: 18, d: 22 },
  { x: 1150, z: -790, w: 22, d: 18 }, { x: 1150, z: -600, w: 22, d: 18 },
  { x: 372, z: -790, w: 22, d: 18 }, { x: 372, z: -600, w: 22, d: 18 },
];

/** the robot's own footprint on the floor */
const ROBOT_FP = 24;
const robotRect = (p: { x: number; z: number }): Rect => ({ x: p.x - ROBOT_FP / 2, z: p.z - ROBOT_FP / 2, w: ROBOT_FP, d: ROBOT_FP });

/** EVERYTHING INSIDE THE ROOM THAT STOPS A BODY. The perimeter wall is NOT here: it is the boundary of
 *  the walkable union, which the rim test already enforces exactly at the wall's inner face. */
export const SOLIDS: readonly Rect[] = [
  ...ZONES.flatMap((z) => z.stations.map((st) => st.rect)),
  ...ZONES.flatMap((z) => z.slots.map((s) => robotRect(s))),
  ...ZONES.flatMap((z) => (z.partition ? [z.partition] : [])),
  ...ZONES.flatMap((z) => z.consoles),
  ...ZONES.flatMap((z) => z.planters),
  ...PERIMETER_POTS,
  ...INTERIOR_POTS,
  ...PILASTERS,
];
/** the round things — the hub island is a circle, and approximating it with a box would either let a body
 *  into its planting or hold one off the open floor beside it */
export const SOLID_CIRCLES: readonly { x: number; z: number; r: number }[] = [HUB, ...ZONES.flatMap((z) => z.tables)];

// ============================= THE COLLISION MODEL ==============================================
const inRect = (p: Vec2, r: Rect, grow = 0): boolean =>
  p.x >= r.x - grow && p.x <= r.x + r.w + grow && p.z >= r.z - grow && p.z <= r.z + r.d + grow;

const inWalk = (p: Vec2): boolean => WALK.some((r) => inRect(p, r));

/** rim samples, as unit offsets scaled by the body radius — the same four player/standTest uses */
const RIM: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** May a body of `radius` stand at world point `p`? The AI Lab's whole collision model. */
export function aiLabStandTest(p: Vec2, radius: number): boolean {
  if (!inWalk(p)) return false;
  for (const [ox, oz] of RIM) if (!inWalk({ x: p.x + ox * radius, z: p.z + oz * radius })) return false;
  for (const s of SOLIDS) if (inRect(p, s, radius)) return false;
  for (const c of SOLID_CIRCLES) if (Math.hypot(p.x - c.x, p.z - c.z) <= c.r + radius) return false;
  return true;
}

/** Is this world point somewhere the LAB — not the office — should answer for?
 *
 *  The union INSET BY THE BODY RADIUS, and the inset is the whole seam story. Inside it,
 *  `aiLabStandTest` is guaranteed to have all four rim samples in the union, so the handover can never
 *  land on a point this test refuses and the office's test would have allowed. Outside it, the office
 *  answers exactly as it always has. */
export function inAiLabZone(p: Vec2, radius: number): boolean {
  return WALK.some((r) => r.w > 2 * radius && r.d > 2 * radius && inRect(p, r, -radius));
}

/** the Lab's centre, for camera focus */
export const LAB_CENTRE: Vec2 = { x: LAB_OUTER.x + LAB_OUTER.w / 2, z: LAB_OUTER.z + LAB_OUTER.d / 2 };
/** a good spot to stand on first entering: on the porch landing, facing the hub */
export const LAB_ARRIVAL: Vec2 = { x: 740, z: -420 };
