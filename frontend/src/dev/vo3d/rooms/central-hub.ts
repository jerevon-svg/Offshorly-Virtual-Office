// vo3d rooms — CENTRAL HUB definition (data only, WORLD coordinates).
//
// Phase 6B. The office's one HERO SHARED SPACE: a wall-less open atrium in the middle of the ground
// floor, bounded by circulation on all four sides. It is the only V1 room with no wall ring, no door
// cells and no painted seats — production calls it an "atrium" in officePathfinding.test.ts and V2 has
// carried it as `walls: false` since Phase 2.
//
// Every number below is DERIVED, never invented:
//   • rect        → the READ-ONLY V1 asset manifest (x 476.245, z 427.509, 500.519 × 323.444)
//   • blocked mass→ the V1 walkability grid: cols 30–60 × rows 27–46
//   • composition → measured off src/assets/office/rooms/central-hub.png at 0.124942 units/px
//                   (4006 × 2588 px over the 500.519 × 323.444 rect — an orthographic PLAN, with no
//                    baked perspective anywhere in it, so nothing here is extruded from a painted shadow)
//
// The flat PNG is a BLUEPRINT. Nothing here renders it.
import { FACING_YAW, growRect, type Facing, type Rect, type Vec2 } from "../core/coords";
import type { ApproachCapability, Entity, LoungeSeatSlot, RoomDef, SeatCapability } from "../world/WorldState";
import type { MatKey } from "../render/Materials";
import type { OpenBand } from "../nav/v2Open";
import { CELL, COLS, ROWS, cellCentre, v1Static, worldToCell, type Cell } from "../adapters/v1Grid";
import { openedLayer } from "../nav/v2Open";
import { v1RoomRect } from "../adapters/v1Manifest";
import { ARMCHAIR, CAFE_CHAIR, SOFA_CUSHION_LOCAL_X, SOFA_CUSHION_TOP, sofaCushionDepth, sofaCushionZ, TUB_CUSHION_TOP } from "../build/furniture";

export const CENTRAL_HUB_ID = "central-hub";
export const RECT: Rect = v1RoomRect(CENTRAL_HUB_ID); // x 476.245, z 427.509, w 500.519, d 323.444

// ============================= THEME ============================================================
/** ROOM-LEVEL COLOUR TABLE. No builder in this room names a palette key directly (5B's rule), so a
 *  future colour/material editor rewrites THIS object and the hub re-skins.
 *
 *  The brief is the EXACT OPPOSITE of the Gaming Room's: premium, warm, welcoming, social. Nothing in
 *  here is saturated, and the only light the room emits is a warm cove at ankle height. */
export const THEME = {
  /** bench shells, planter rims, the shelf carcass, the counter plinth */
  shell: "hubStone",
  /** their recessed toe-kicks and shadow reveals */
  shellDark: "hubStoneDark",
  /** the hub's own floor plate */
  plate: "hubTerrazzo",
  /** the plate outline and the central medallion inlay */
  inlay: "bronze",
  /** the arc benches' sage cushions */
  cushion: "hubSage",
  /** the cream upholstery of the sectional, loveseat, tub chair, café chairs and NE bench */
  upholstery: "cushionCream",
  /** the tan north armchair */
  leather: "hubCamel",
  /** the olive north armchair and the east lounge chair */
  olive: "loungeOlive",
  oliveSeat: "loungeOliveSeat",
  /** every architectural LED in the room — one warm channel, no second hue */
  cove: "coveWarm",
  /** the boxing-championship monument: one monochrome cast stone, as the reference is */
  monument: "hubMonument",
  /** café table tops and the two east round tables */
  tableTop: "white",
  /** the round wooden coffee table and the armchairs' splay legs */
  wood: "tableWood",
} satisfies Record<string, MatKey>;

// ============================= ARCHITECTURE =====================================================
// THE 6A READING. The source is a clean orthographic plan: there is no wall, no glass, no partition and
// no baked perspective anywhere in it. The ONLY architecture the hub owns is its floor.
//
// So: no ShellSpec, no wall runs, no door. `walls: false` stays set in rooms/ground-floor.ts, and
// build/floorplan.ts therefore draws nothing here — which means this room's static builder must supply
// its own plate, because the moment it flips to `reconstructed` it loses the placeholder one.

/** The hub floor plate: the source's rounded rectangle, inset 2 units from the manifest rect. */
export const PLATE = { x: RECT.x + 2, z: RECT.z + 2, w: RECT.w - 4, d: RECT.d - 4, radius: 30, lift: 0.35 };
/** The NORTH NOTCH. The plate steps back here, and the step lines up exactly with the Executive room's
 *  south approach (the V1 grid's 'sss' stand cells at row 20, cols 44–46). It is a plate cutout marking
 *  where the plaza yields to the corridor — NOT a recess, and the cells inside it are already walkable. */
export const NOTCH = { x0: 697.7, x1: 756.5, z1: 453.8 };
/** The plate's brass outline: what makes an unwalled plaza read as a defined place. */
export const OUTLINE_W = 1.6;

/** The hub is wall-less, so its walkable floor is its WHOLE rect — no inset. `groundFloorRegions` cuts a
 *  hole in the shared floor at interiorRect(RECT) (the rect shrunk by half a cell); anything smaller than
 *  the full rect here would strand the ring of cells between the two. */
export const FLOOR_RECT: Rect = { ...RECT };

// ============================= HERO — THE CENTRAL ISLAND ========================================
// V1 blocks this as ONE solid 12 × 14-cell rectangle (cols 40–51 × rows 31–44, x 640…832, z 496…720).
// In true 3D only the four bench arcs are solid: an annulus r 64 → 90 over four spans. See OPEN_BANDS.
//
// Angles are COMPASS bearings (0 = north, 90 = east), because that is how the plan reads. build/arc.ts
// converts to shape space in exactly one place.
export const ISLAND = {
  centre: { x: 726.5, z: 590.2 } as Vec2,
  /** the brass floor medallion inside the ring */
  medallionR: 63,
  /** the bench annulus */
  rIn: 64,
  rOut: 90,
  /** plinth recess (carries the cove), bench top, planter rim top */
  plinthH: 3,
  seatH: 15,
  rimH: 26,
  /** cushion / soil insets from the annulus faces */
  inset: 2.5,
};

export type ArcSeg = { from: number; to: number };
export type HubArc = {
  id: string;
  /** the whole arc, compass degrees */
  span: ArcSeg;
  /** the upholstered length */
  cushion: ArcSeg;
  /** the raised planting bed */
  planter: ArcSeg;
  /** cushion colour */
  colour: MatKey;
  /** the two LOWER arcs carry the warm under-bench cove the source paints */
  cove: boolean;
};

/** THE SOURCE ASYMMETRY, preserved verbatim: the two UPPER arcs are bench-heavy with a short planter at
 *  their north ends; the two LOWER arcs are planting-heavy with a short bench. That imbalance is the
 *  composition — seating faces the room across the top, greenery anchors the bottom. */
export const ARCS: HubArc[] = [
  { id: "arc-nw", span: { from: 290.4, to: 346.6 }, cushion: { from: 290.4, to: 323 }, planter: { from: 323, to: 346.6 }, colour: THEME.cushion as MatKey, cove: false },
  { id: "arc-ne", span: { from: 13.4, to: 69.6 }, cushion: { from: 35, to: 69.6 }, planter: { from: 13.4, to: 35 }, colour: THEME.upholstery as MatKey, cove: false },
  { id: "arc-se", span: { from: 110.4, to: 166.6 }, cushion: { from: 154, to: 166.6 }, planter: { from: 110.4, to: 154 }, colour: THEME.cushion as MatKey, cove: true },
  { id: "arc-sw", span: { from: 193.4, to: 249.6 }, cushion: { from: 193.4, to: 211 }, planter: { from: 211, to: 249.6 }, colour: THEME.cushion as MatKey, cove: true },
];

/** The four gaps the arcs leave, compass degrees. North and south are the ~27° axial passages; east and
 *  west are the wider ~41° ones. Used by the walkability tests, not by any builder. */
export const GAPS: ArcSeg[] = [
  { from: 346.6, to: 373.4 }, // north (wraps 360)
  { from: 69.6, to: 110.4 }, // east
  { from: 166.6, to: 193.4 }, // south
  { from: 249.6, to: 290.4 }, // west
];

// ============================= HERO — THE BOXING CHAMPIONSHIP MONUMENT ==========================
/** The production centrepiece: a commemorative boxing ring on the medallion, with the two sculpted "boss"
 *  statues squaring up inside it and a plaque set into the floor in front. THE HERO OF THE CENTRAL HUB.
 *
 *  SIZED FROM THE PRODUCTION SCREENSHOT. Earlier passes sized this from the walkable apron and stopped at
 *  a 72 base; the production capture settles it differently — the bosses are meant to DWARF an employee
 *  (~2:1 against Bon's 36 units) and the ring is meant to read as architecture. So the installation is
 *  scaled to the largest the bench island physically allows instead: at an 84 base the corners stand 60.1
 *  from the centre against a bench inner face at 64, ~4 units clear.
 *
 *  THE TRADE THAT BUYS. At this size the footprint reaches past the inner apron cells, so the continuous
 *  walkway of the 72 build becomes FOUR APRON POCKETS — north, south, east and west — each fed by its own
 *  bench gap. Every side of the monument is still walkable and every gap still works; what is lost is the
 *  ability to circle the monument without stepping out through a gap. That is the cost of the production
 *  hierarchy inside a 64-radius island, and it is the right way round: the hero reads correctly and you
 *  can still walk up to any face of it.
 *
 *  The stone disc it stands on is FLOOR, not a plinth: 0.35 proud, so the apron stays walkable right up to
 *  the base. Only the ring itself blocks — see MONUMENT_FOOTPRINT. */
export const MONUMENT = {
  centre: { x: 726.5, z: 590.2 } as Vec2,
  /** the flush stone medallion disc under the ring (a floor inlay — never a step) */
  discR: 54,
  discY: 0.35,
  /** stepped base: bottom step, then the plinth step */
  base: 72, baseH: 4,
  step: 69, stepH: 4,
  /** the canvas deck and the height of its top surface */
  canvas: 66, canvasH: 1.8,
  deckY: 0.35 + 4 + 4 + 1.8, // 10.15
  /** corner posts, at ±post on both axes */
  post: 31, postR: 2.8, postH: 21,
  /** rope heights ABOVE the deck, and their radius — three a side, as the reference strings them */
  ropes: [5.9, 10.5, 15.3],
  ropeR: 0.75,
  /** each statue's centre, ±x from the monument centre; they face each other across the canvas */
  statueX: 19.5,
  /** the placeholders are authored ~21.7 tall and scaled here */
  statueScale: 3.13,
  /** THE CONTRACT A REPLACEMENT MUST MEET, and the number this room is calibrated on.
   *
   *  SET FROM THE PRODUCTION CAPTURE, not from a world-unit rule. Bon stands 36 units
   *  (BON_STANDING_HEIGHT) and production shows the bosses DWARFING an employee — giant commemorative
   *  sculptures, not characters standing in a ring. 68 is 1.9× Bon, and it also reproduces the capture's
   *  statue-to-post proportion (68 against a 21-high post ≈ 3.2×, which is what the screenshot measures).
   *
   *  IT IS ALSO THE CEILING. The statues stand ON the canvas, so their outer edge cannot pass the canvas
   *  rim: at 68 the pair spans 19.5 ± 12.9, i.e. 32.4 against a 33 half-canvas. Going bigger means a
   *  bigger canvas, which means a bigger base — and past a 72 base the footprint swallows the row of cells
   *  (row 34) that lets the WEST and EAST bench gaps reach the rest of the floor, leaving both as
   *  unreachable dead ends. The ring stays 72 for that reason and the bosses take up the slack.
   *
   *  A GLB is normalised to this height on load. */
  statueHeight: 68,
  /** the floor plaque, south of the ring (local to the monument centre) */
  plaque: { w: 58, d: 10, z: 46 },
};

/** BOSS STATUE SLOTS — the two figures inside the ring.
 *
 *  Each slot is filled by its own sculpted GLB (see bossUrl). The procedural figures the ring ships with
 *  are only a fallback for when the asset is missing.
 *
 *  This table exists so that swap is a DROP-IN. It is the whole contract between the ring and whatever
 *  stands in it: an id, a transform on the deck, a facing, and a height to normalise to. The ring, posts,
 *  ropes, plinth and plaque are the real procedural asset and know nothing about the figures — replacing a
 *  boss touches one anchor Group and rebuilds no monument geometry.
 *
 *  Positions are MONUMENT-LOCAL (the monument group already sits at MONUMENT.centre); y is the deck. */
export type BossSlot = {
  id: string;
  /** monument-local position of the statue's FEET */
  x: number;
  z: number;
  /** rotation about Y. The figure is authored facing local −z, so this turns it at its opponent. */
  yaw: number;
  /** world height the statue must be normalised to, feet on the deck */
  height: number;
  /** what distinguishes this boss — the placeholder reads it, and so should the GLB that replaces it */
  hair: "wavy" | "bald";
  glasses: boolean;
};

/** Where a slot's sculpted GLB is served from. ONE FILE PER BOSS.
 *
 *  The combined pair was tried first and rejected: image-to-3D reconstructs an image as a SINGLE connected
 *  volume, so two figures in one frame came back fused — the bald boss merged into the other's shoulder,
 *  in one unnamed mesh. Generated separately, each boss is a clean isolated subject, which is the shape of
 *  input the pipeline is actually built for. Their face-to-face composition is not lost by splitting: it
 *  lives in BOSS_SLOTS' transforms, which is where it always lived. */
export const bossUrl = (slot: BossSlot): string => `${import.meta.env.BASE_URL}vo3d/${slot.id}.glb`;

export const BOSS_SLOTS: BossSlot[] = [
  { id: "boss-west", x: -MONUMENT.statueX, z: 0, yaw: -Math.PI / 2, height: MONUMENT.statueHeight, hair: "wavy", glasses: false },
  { id: "boss-east", x: MONUMENT.statueX, z: 0, yaw: Math.PI / 2, height: MONUMENT.statueHeight, hair: "bald", glasses: true },
];

/** the world position of a slot's feet, for tooling and tests */
export const bossSlotWorld = (s: BossSlot): Vec2 => ({ x: MONUMENT.centre.x + s.x, z: MONUMENT.centre.z + s.z });

/** What the monument physically occupies: its base step plus a hair of margin. Declared as an OpenBand
 *  solid so no V2-local correction can ever open a cell underneath it. */
export const MONUMENT_FOOTPRINT: Rect = {
  x: MONUMENT.centre.x - MONUMENT.base / 2 - 0.5,
  z: MONUMENT.centre.z - MONUMENT.base / 2 - 0.5,
  w: MONUMENT.base + 1,
  d: MONUMENT.base + 1,
};

// ============================= V2-LOCAL WALKABILITY =============================================
/** THE ONE REAL CORRECTION IN THIS ROOM (approved in 6A).
 *
 *  V1 painted a bounding box around a ring of benches, so 168 cells are blocked where only an annulus is
 *  solid. The medallion inside the ring and the four gaps between the arcs are flat, tiled, physically
 *  reachable floor with nothing standing on them — textbook "old 2D blocking with no physical cause",
 *  the same class of error 4C corrected at Meeting/Project and 5A at the Gaming Room.
 *
 *  CONSERVATIVE by construction. The medallion band is the INSCRIBED SQUARE of the r-62 inner disc, not
 *  its bounding box, and each gap band is a rect that fits inside the gap wedge at its NARROWEST radius.
 *  Every cell centre these five bands open was checked against the arc annulus by bearing and radius —
 *  which is why every `solids` list is legitimately empty. ~51 cells open, not 168.
 *
 *  The V1 grid file itself is untouched. Nothing outside these five rects can change. */
export const OPEN_BANDS: OpenBand[] = [
  // THE APRON, in two rects rather than one. The monument pushes the walkway out to the cells at cols
  // 42/48 and rows 34/39, and a single rect spanning all of them would also open the SE corner cell
  // (776, 632) — which sits 64.8 from the centre, i.e. UNDER the south-east bench. Splitting the apron so
  // the southern strip stops short of col 48 keeps every opened cell on real floor.
  //
  // Row 34 is the load-bearing row: it is what connects the west and east pockets to the north and south
  // gaps, and the WEST AND EAST BENCH GAPS HAVE NO OTHER ROUTE OUT (V1 blocks the café tables and the
  // island mass either side of them). Lose row 34 and both gaps become unreachable.
  { id: "hub-apron", rect: { x: 672, z: 547, w: 112, d: 79 }, solids: [MONUMENT_FOOTPRINT] },
  { id: "hub-apron-south", rect: { x: 672, z: 626, w: 96, d: 14 }, solids: [MONUMENT_FOOTPRINT] },
  // The four passages through the benches.
  { id: "hub-gap-north", rect: { x: 714, z: 496, w: 28, d: 56 }, solids: [MONUMENT_FOOTPRINT] },
  { id: "hub-gap-south", rect: { x: 714, z: 630, w: 28, d: 92 }, solids: [MONUMENT_FOOTPRINT] },
  { id: "hub-gap-west", rect: { x: 636, z: 572, w: 54, d: 36 }, solids: [MONUMENT_FOOTPRINT] },
  { id: "hub-gap-east", rect: { x: 763, z: 572, w: 54, d: 36 }, solids: [MONUMENT_FOOTPRINT] },
];
// DELIBERATELY NOT DECLARED: the apron south of the ring (cols 40–51 × rows 43–44) that V1 also
// over-blocks. 6A rated it lower value and 6B defers it — the round coffee table stands in it, and the
// circulation it would add is already served by the open hall two cells further south.

// ============================= WEST PANTRY RUN ==================================================
// V1: cols 30–31 × rows 32–43 (x 480…512, z 512…704). Measured: x 478.7…505.7, z 513.7…696.2.
export const COUNTER = { x: 480, z: 544, w: 28, d: 96, h: 28, topT: 2.6, toe: 3 };
export const COUNTER_PLANTERS: Rect[] = [
  { x: 480, z: 512, w: 28, d: 32 },
  { x: 480, z: 640, w: 28, d: 62 },
];
/** What stands on the worktop, north → south, exactly as the source stacks it. */
export const APPLIANCES = {
  espresso: { x: 492, z: 566, w: 17, d: 15, h: 20 },
  filter: { x: 492, z: 606, w: 16, d: 14, h: 18 },
  bowl: { x: 490.5, z: 631, r: 3.2, h: 2.4 },
};

// ============================= CAFÉ BAY =========================================================
/** Six octagonal tables on the V1 grid's OWN block centres (cols 33–35 / 37–39 × rows 29–31 / 34–36 /
 *  39–41). The art agrees with the grid to within 4 units everywhere, so the grid wins — it is the
 *  gameplay authority and 6C's seat cells will be read off it. */
export const CAFE_COLS = [552, 616];
export const CAFE_ROWS = [488, 568, 648];
export const CAFE_TABLE_W = 33;
export const CAFE_CHAIR_W = 14;
export const CAFE_CHAIR_D = 15;
/** How far a chair's centre sits from its table's, on each of the four sides. */
export const CAFE_CHAIR_OFFSET = 24;
/** The four places at every table, in V1's own 'o'-cell order: north, east, south, west. */
export const CAFE_SIDES = ["north", "east", "south", "west"] as const;

export type CafeSeatRef = { table: number; side: (typeof CAFE_SIDES)[number]; x: number; z: number; facing: number };
/** Every café place as a plan fact. 6B only builds the chair; 6C hangs the SeatCapability on it. */
export function cafeSeats(): CafeSeatRef[] {
  const out: CafeSeatRef[] = [];
  cafeTables().forEach((t, i) => {
    for (const side of CAFE_SIDES) {
      const d = CAFE_CHAIR_OFFSET;
      const p = side === "north" ? { x: t.x, z: t.z - d } : side === "south" ? { x: t.x, z: t.z + d } : side === "east" ? { x: t.x + d, z: t.z } : { x: t.x - d, z: t.z };
      // a chair FACES its table: the sitter on the north side looks south
      const facing = side === "north" ? FACING_YAW.south : side === "south" ? FACING_YAW.north : side === "east" ? FACING_YAW.west : FACING_YAW.east;
      out.push({ table: i, side, ...p, facing });
    }
  });
  return out;
}
export function cafeTables(): Vec2[] {
  const out: Vec2[] = [];
  for (const z of CAFE_ROWS) for (const x of CAFE_COLS) out.push({ x, z });
  return out;
}

// ============================= NORTH ARMCHAIR ROW ===============================================
// V1: cols 49–56 × rows 28–30 ('o' interaction cells, x 784…912, z 448…496). Three chairs, facing SOUTH
// into the room, in the source's own colour order: cream, tan, olive.
export const NORTH_CHAIRS = [
  { id: "armchair-n-cream", x: 812, z: 472, colour: THEME.upholstery as MatKey, seat: THEME.upholstery as MatKey },
  { id: "armchair-n-tan", x: 852, z: 472, colour: THEME.leather as MatKey, seat: THEME.leather as MatKey },
  { id: "armchair-n-olive", x: 893, z: 472, colour: THEME.olive as MatKey, seat: THEME.oliveSeat as MatKey },
];
export const NORTH_CHAIR_W = 30;
export const NORTH_CHAIR_D = 34;

// ============================= EAST LOUNGE CLUSTER ==============================================
/** The long cream sectional, x 820…848 × z 512…620 in the source. build/furniture's sofa is AUTHORED
 *  back-to-WEST with its length in local z, so the piece already opens EAST at facing "north" and needs no
 *  quarter turn (Gaming's sofa passes "west" precisely because its length runs along world x instead). */
export const SECTIONAL = { id: "sectional", x: 834, z: 566, w: 28, d: 108, seats: 3, facing: "north" as const };
export const EAST_TABLES = [
  { id: "side-table-n", x: 872, z: 522, r: 12 },
  { id: "round-table-e", x: 878, z: 569, r: 13 },
];
export const TUB = { id: "tub-chair-e", x: 879, z: 609, w: 22, d: 24 };
export const LOWER_LOUNGE = [
  { id: "armchair-e-olive", x: 862, z: 666, w: 30, d: 32, colour: THEME.olive as MatKey, seat: THEME.oliveSeat as MatKey, seats: 1 },
  { id: "loveseat-e", x: 896, z: 666, w: 34, d: 30, colour: THEME.upholstery as MatKey, seat: THEME.upholstery as MatKey, seats: 2 },
];
/** The round wooden coffee table the source dresses with a plant and a small object — `tone: "lounge"`
 *  is exactly that dressing, already built by build/furniture's roundTable. */
export const COFFEE_TABLE = { id: "coffee-table-e", x: 821, z: 695, r: 17 };

// ============================= EAST LIBRARY RUN =================================================
// V1: cols 57–58 × rows 30–43, widening to cols 57–60 across rows 31–36 (the two big floor planters).
export const SHELF_RUN = { x: 920, z: 490, w: 26, d: 146, h: 46, bays: 4 };
export const SHELF_PLANTER: Rect = { x: 920, z: 636, w: 26, d: 46 };
export const EAST_PLANTERS = [
  { id: "planter-e-n", x: 960, z: 522, r: 13, h: 17, plant: { r: 9, h: 20 } },
  { id: "planter-e-s", x: 962, z: 565, r: 13, h: 17, plant: { r: 10, h: 22 } },
];

// ============================= PLANTING =========================================================
/** Free-standing plants. The arc-bed planting is generated from ARCS by the builder (it has to follow the
 *  curve), and the counter/shelf planter boxes carry their own — these are the loose floor pots. */
//  Sized against the production avatar (36 units standing): the source's specimens are big bushy shrubs,
//  not trees, so nothing here is authored taller than shoulder height before its canopy.
export const PLANTS = [
  { id: "plant-hall-nw", x: 528, z: 452, r: 7, h: 19, lush: 0.8 },
  { id: "plant-hall-sw", x: 528, z: 700, r: 7, h: 19, lush: 0.8 },
];

// ============================= ROOM =============================================================
export const CENTRAL_HUB: RoomDef = {
  id: CENTRAL_HUB_ID,
  name: "Central Hub",
  rect: RECT,
  floorRect: FLOOR_RECT,
  // no `shell`, and deliberately no door of any kind: this room has no walls to put one in.
};

/** cell-aligned world rect of a V1 cell block, for tests */
export const cells = (c0: number, c1: number, r0: number, r1: number): Rect => ({ x: c0 * CELL, z: r0 * CELL, w: (c1 - c0 + 1) * CELL, d: (r1 - r0 + 1) * CELL });
/** the ring's bounding box — the mass V1 blocks whole */
export const ISLAND_BOX: Rect = growRect({ x: ISLAND.centre.x, z: ISLAND.centre.z, w: 0, d: 0 }, ISLAND.rOut);

// ============================= ENTITIES =========================================================
function furniture(id: string, kind: string, x: number, z: number, w: number, d: number, facing: string, props: Record<string, string | number | boolean> = {}): Entity {
  return {
    id: `${CENTRAL_HUB_ID}/${id}`,
    kind,
    roomId: CENTRAL_HUB_ID,
    transform: { pos: { x, z }, yaw: 0 },
    footprint: { shape: "rect", w, d },
    capabilities: {},
    props: { w, d, facing, mirrored: false, ...props },
  };
}
function plantEntity(id: string, x: number, z: number, r: number, h: number, lush?: number, standsIn?: number): Entity {
  return {
    id: `${CENTRAL_HUB_ID}/${id}`,
    kind: "plant",
    roomId: CENTRAL_HUB_ID,
    transform: { pos: { x, z }, yaw: 0 },
    capabilities: { sway: true },
    // `standsIn` = the rim height of a planter the STATIC builder owns: the plant drops its own pot and
    // sits on that soil instead (reception's planters use the same split).
    props: { r, h, hanging: false, y: standsIn ?? 0, ...(standsIn === undefined ? {} : { pot: false }), ...(lush === undefined ? {} : { lush }) },
    source: { baked: true },
  };
}

/** The hub's movable-in-principle furniture as world entities. Architecture (the plate, the medallion,
 *  the four arcs, the counter run, the shelf run, every planter box and every cove) is STATIC and lives
 *  in build/central-hub.ts.
 *
 *  NO capabilities are attached in 6B. Seating, walk-ups and every product integration are 6C — but each
 *  café chair, armchair and sofa below is already its own addressable entity with its own view, which is
 *  precisely what 6C needs to hang a SeatCapability on it. */
export function centralHubEntities(): Entity[] {
  const out: Entity[] = [];

  // --- café bay: 6 tables, 24 chairs -------------------------------------------------------------
  cafeTables().forEach((t, i) => {
    out.push(furniture(`cafe-table-${i}`, "cafe-table", t.x, t.z, CAFE_TABLE_W, CAFE_TABLE_W, "north", { color: THEME.tableTop }));
  });
  for (const s of cafeSeats()) {
    const facing = s.side === "north" ? "south" : s.side === "south" ? "north" : s.side === "east" ? "west" : "east";
    const spun = facing === "east" || facing === "west";
    out.push(furniture(`cafe-chair-${s.table}-${s.side}`, "cafe-chair", s.x, s.z,
      spun ? CAFE_CHAIR_D : CAFE_CHAIR_W, spun ? CAFE_CHAIR_W : CAFE_CHAIR_D, facing,
      { color: THEME.upholstery, colorSeat: THEME.upholstery }));
  }

  // --- north armchair row, facing south into the room --------------------------------------------
  for (const c of NORTH_CHAIRS) out.push(furniture(c.id, "armchair", c.x, c.z, NORTH_CHAIR_W, NORTH_CHAIR_D, "south", { color: c.colour, colorSeat: c.seat, seats: 1 }));

  // --- east lounge cluster -----------------------------------------------------------------------
  out.push(furniture(SECTIONAL.id, "sofa", SECTIONAL.x, SECTIONAL.z, SECTIONAL.w, SECTIONAL.d, SECTIONAL.facing,
    { tone: "lounge", color: THEME.upholstery, colorSeat: THEME.upholstery, seats: SECTIONAL.seats }));
  for (const t of EAST_TABLES) out.push(furniture(t.id, "round-table", t.x, t.z, t.r * 2, t.r * 2, "north", { color: THEME.tableTop }));
  out.push(furniture(TUB.id, "tub-chair", TUB.x, TUB.z, TUB.w, TUB.d, "north", { tone: "lounge", color: THEME.upholstery, colorSeat: THEME.upholstery }));
  for (const c of LOWER_LOUNGE) out.push(furniture(c.id, "armchair", c.x, c.z, c.w, c.d, "north", { color: c.colour, colorSeat: c.seat, seats: c.seats, ...(c.seats === 2 ? { accent: THEME.olive } : {}) }));
  out.push(furniture(COFFEE_TABLE.id, "round-table", COFFEE_TABLE.x, COFFEE_TABLE.z, COFFEE_TABLE.r * 2, COFFEE_TABLE.r * 2, "north", { tone: "lounge", color: THEME.wood }));

  // --- loose floor planting ----------------------------------------------------------------------
  for (const p of PLANTS) out.push(plantEntity(p.id, p.x, p.z, p.r, p.h, p.lush));
  for (const p of EAST_PLANTERS) out.push(plantEntity(`${p.id}-plant`, p.x, p.z, p.plant.r, p.plant.h, 0.9, p.h - 1));

  return withCentralHubInteractions(out);
}


// ============================= 6C INTERACTIONS ==================================================
// Nothing below adds geometry. Every anchor is a walkable cell centre, every contact point is derived from
// the exported mesh constants, and the globally deferred seated-facing calibration is NOT touched: each
// yaw here is the geometric reading of the piece the sitter is actually on.

/** The layer approach points are judged against: the READ-ONLY V1 grid PLUS this room's own OpenBands
 *  (the apron inside the bench ring is V2-local floor, and bench sitters stand on it). */
const opened = openedLayer(OPEN_BANDS);
const cellOpen = (cx: number, cy: number): boolean => v1Static(cx, cy) || opened(cx, cy);

/** Cells actually CONNECTED to the floor, flood-filled once from production's own open-corridor anchor.
 *
 *  Plain walkability is not enough for a stand point: the V1 grid has isolated 's' cells tucked inside
 *  furniture clusters that a body can never route to, and standNear happily picked them — two approach
 *  points landed on cells no path could reach. Connectivity is the real requirement, so it is the test. */
const connected: Set<string> = (() => {
  const seen = new Set<string>();
  const start = worldToCell({ x: 500, z: 790 });
  if (!cellOpen(start.cx, start.cy)) return seen;
  const q: Cell[] = [start];
  seen.add(`${start.cx},${start.cy}`);
  while (q.length) {
    const c = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { cx: c.cx + dx, cy: c.cy + dy }, k = `${n.cx},${n.cy}`;
      if (seen.has(k) || n.cx < 0 || n.cy < 0 || n.cx >= COLS || n.cy >= ROWS || !cellOpen(n.cx, n.cy)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen;
})();
const cellWalkable = (c: Cell): boolean => connected.has(`${c.cx},${c.cy}`);

/** The nearest walkable cell centre to `from`, preferring cells that lie in direction `dir`.
 *
 *  Approach points are DERIVED rather than hand-typed: 24 café chairs at four orientations around six
 *  tables is far too many magic numbers to keep honest, and the V1 grid is the authority on where a body
 *  may stand. Scoring is direction first, distance second, so a chair's stand point lands behind it
 *  wherever the grid allows and falls back to the closest legal cell when it does not. */
export function standNear(from: Vec2, dir: Vec2): Vec2 {
  const start = worldToCell(from);
  const len = Math.hypot(dir.x, dir.z) || 1;
  const dx0 = dir.x / len, dz0 = dir.z / len;
  let best: Cell | null = null;
  let bestScore = -Infinity;
  // CLOSEST legal cell wins, with `dir` only breaking ties between cells of similar distance. Scoring the
  // other way round (direction first) put the pantry stand point 76 units away across the café bay.
  for (let dy = -6; dy <= 6; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      const c: Cell = { cx: start.cx + dx, cy: start.cy + dy };
      if (!cellWalkable(c)) continue;
      const p = cellCentre(c);
      const vx = p.x - from.x, vz = p.z - from.z;
      const m = Math.hypot(vx, vz) || 1;
      const score = -m + CELL * 0.75 * ((vx / m) * dx0 + (vz / m) * dz0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
  if (!best) throw new Error(`central hub: no walkable stand cell near ${from.x},${from.z}`);
  return cellCentre(best);
}

/** yaw that faces the direction (dx, dz) — core/coords' heading convention */
const yawToward = (dx: number, dz: number): number => Math.atan2(dx, dz);

// ---- café seating: 24 MOVABLE chairs -------------------------------------------------------------
/** How far a café chair slides back off the table. The chair's front edge rests exactly on the table edge
 *  (offset 24 − half-depth 7.5 = 16.5 = the octagon's half across-flats), so 12 opens a real 12-unit gap
 *  for the sitter to step into instead of walking through the table. */
export const CAFE_PULL = 12;
/** it slides back under the sitter once they are down, the way a dining chair actually behaves */
export const CAFE_TUCK = 5;

export const cafeChairId = (table: number, side: string): string => `${CENTRAL_HUB_ID}/cafe-chair-${table}-${side}`;
export const CAFE_CHAIR_IDS = cafeSeats().map((s) => cafeChairId(s.table, s.side));

export function cafeChairSeat(ref: CafeSeatRef): SeatCapability {
  const t = cafeTables()[ref.table];
  const dx = ref.x - t.x, dz = ref.z - t.z;
  const m = Math.hypot(dx, dz);
  const out = { x: dx / m, z: dz / m }; // table → chair, i.e. the direction the chair pulls back in
  const at = (d: number): Vec2 => ({ x: t.x + out.x * d, z: t.z + out.z * d });
  const preSeat = at(CAFE_CHAIR_OFFSET - 1); // the space the pulled chair vacates
  return {
    approach: standNear(at(CAFE_CHAIR_OFFSET + 22), out),
    preSeat,
    // one waypoint on the chair's own axis first: the stand cell can sit off-axis, and a straight leg from
    // it to the pre-seat point would cut the corner through the table
    approachToSeat: [at(CAFE_CHAIR_OFFSET + 14), preSeat],
    pullDir: out,
    pullDistance: CAFE_PULL,
    seatedTuck: CAFE_TUCK,
    cushionTopY: CAFE_CHAIR.cushionTop,
    cushionLocal: { x: 0, z: 0 },
    sitDepth: 2.5,
    seatedYaw: yawToward(-out.x, -out.z), // the sitter faces the table
    timings: { pullMs: 760, sitMs: 620, slideMs: 640, standMs: 620, returnMs: 760 },
  };
}

// ---- the four curved benches: FIXED slots ---------------------------------------------------------
/** Bench seat surface: the cushion slab sits on the bench mass and is 4.5 thick. */
export const BENCH_SEAT_Y = ISLAND.seatH + 4.5;
/** radius the sitter's pelvis lands on — the middle of the 26-wide annulus */
export const BENCH_SEAT_R = (ISLAND.rIn + ISLAND.rOut) / 2;
/** how much of a cushion span one person occupies, in arc length at BENCH_SEAT_R */
const BENCH_SEAT_ARC = 21;

export type BenchSlotRef = { arc: string; deg: number; x: number; z: number; seatedYaw: number };
/** Every place the cushioned lengths can actually seat someone. The planter halves of each arc are
 *  PLANTING, not seating, and are deliberately skipped — a slot there would sit the avatar in the soil. */
export function benchSlotRefs(): BenchSlotRef[] {
  const out: BenchSlotRef[] = [];
  for (const a of ARCS) {
    const span = a.cushion.to - a.cushion.from;
    const arcLen = (span * Math.PI * BENCH_SEAT_R) / 180;
    const n = Math.max(1, Math.floor(arcLen / BENCH_SEAT_ARC));
    for (let i = 0; i < n; i++) {
      const deg = a.cushion.from + ((i + 0.5) / n) * span;
      const t = (deg * Math.PI) / 180;
      out.push({
        arc: a.id, deg,
        x: ISLAND.centre.x + Math.sin(t) * BENCH_SEAT_R,
        z: ISLAND.centre.z - Math.cos(t) * BENCH_SEAT_R,
        // the benches ring the monument: a sitter faces INWARD, at the hero
        seatedYaw: yawToward(-Math.sin(t), Math.cos(t)),
      });
    }
  }
  return out;
}

export const BENCH_ENTITY_ID = `${CENTRAL_HUB_ID}/bench-seating`;

function benchSlots(): LoungeSeatSlot[] {
  return benchSlotRefs().map((b) => {
    const t = (b.deg * Math.PI) / 180;
    const inward = { x: -Math.sin(t), z: Math.cos(t) };
    // stand on the APRON inside the ring, in front of the slot, then sit back onto the cushion
    const front: Vec2 = { x: ISLAND.centre.x + Math.sin(t) * 50, z: ISLAND.centre.z - Math.cos(t) * 50 };
    return {
      id: b.arc.replace("arc-", "bench-") + `-${Math.round(b.deg)}`,
      // the bench entity sits at the island centre with no rotation, so local == world offset
      contactLocal: { x: b.x - ISLAND.centre.x, y: BENCH_SEAT_Y, z: b.z - ISLAND.centre.z },
      seatedYaw: b.seatedYaw,
      approach: standNear(front, inward),
      approachToSeat: [front],
      sink: 1.2, // upholstered, but on a stone shell: it gives a little
      timings: { sitMs: 780, standMs: 720 },
    };
  });
}

// ---- the east lounge cluster + north armchairs: FIXED slots ---------------------------------------
/** One slot per armchair, `seats` slots for the loveseat. `facing` is the direction the piece opens. */
function armchairSlots(id: string, c: Vec2, w: number, facing: Facing, seats: number): LoungeSeatSlot[] {
  const dir = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } }[facing];
  const armW = w * 0.15;
  const cw = (w - 2 * armW - 1.6) / seats;
  const front: Vec2 = { x: c.x + dir.x * 26, z: c.z + dir.z * 26 };
  return Array.from({ length: seats }, (_, i) => {
    const lx = (i - (seats - 1) / 2) * (cw + 0.8);
    return {
      id: seats > 1 ? `${id}-${i}` : id,
      contactLocal: { x: lx, y: ARMCHAIR.cushionTop, z: 1 },
      seatedYaw: FACING_YAW[facing],
      approach: standNear(front, dir),
      approachToSeat: [{ x: c.x + dir.x * 17, z: c.z + dir.z * 17 }],
      sink: 1.6,
      timings: { sitMs: 760, standMs: 700 },
    };
  });
}

/** The sectional: authored back-to-WEST with its length in local z, so at facing "north" it opens EAST and
 *  local axes are world axes. Cushion geometry comes from build/furniture's own exported numbers. */
function sectionalSlots(): LoungeSeatSlot[] {
  const cushD = sofaCushionDepth(SECTIONAL.d, SECTIONAL.seats);
  return Array.from({ length: SECTIONAL.seats }, (_, i) => {
    const lz = sofaCushionZ(i, SECTIONAL.seats, cushD);
    const seat: Vec2 = { x: SECTIONAL.x + SOFA_CUSHION_LOCAL_X, z: SECTIONAL.z + lz };
    const front: Vec2 = { x: seat.x + 26, z: seat.z };
    return {
      id: `sectional-${["north", "centre", "south"][i]}`,
      contactLocal: { x: SOFA_CUSHION_LOCAL_X + 1.5, y: SOFA_CUSHION_TOP, z: lz },
      seatedYaw: FACING_YAW.east,
      approach: standNear(front, { x: 1, z: 0 }),
      approachToSeat: [{ x: seat.x + 16, z: seat.z }],
      sink: 0,
      timings: { sitMs: 780, standMs: 720 },
    };
  });
}

function tubSlot(): LoungeSeatSlot {
  const front: Vec2 = { x: TUB.x, z: TUB.z - 24 };
  return {
    id: "tub-chair-e",
    contactLocal: { x: 0, y: TUB_CUSHION_TOP, z: 0 },
    seatedYaw: FACING_YAW.north,
    approach: standNear(front, { x: 0, z: -1 }),
    approachToSeat: [{ x: TUB.x, z: TUB.z - 15 }],
    sink: 1.4,
    timings: { sitMs: 760, standMs: 700 },
  };
}

// ---- walk-up points --------------------------------------------------------------------------------
// Physical anchors only: somewhere to stand and something to face. No product behaviour in 6C.
export const COUNTER_INTERACTION_ID = `${CENTRAL_HUB_ID}/pantry-interaction`;
export const SHELF_INTERACTION_ID = `${CENTRAL_HUB_ID}/library-interaction`;
export const MONUMENT_INTERACTION_ID = `${CENTRAL_HUB_ID}/monument-interaction`;

/** In the aisle east of the pantry run, facing the worktop. Aimed at the middle of the run rather than at
 *  the espresso machine specifically: V1 marks the cells directly beside the appliances as interaction
 *  cells (blocked), so aiming there pushed the stand point two cells north of the counter entirely. */
export const COUNTER_APPROACH: ApproachCapability = {
  point: standNear({ x: COUNTER.x + COUNTER.w + 14, z: COUNTER.z + COUNTER.d / 2 }, { x: 1, z: 0 }),
  yaw: FACING_YAW.west, label: "Pantry", action: "Grab a coffee",
};
/** The library run's west face, at its NORTH end. The aisle beside the run's middle is taken by the east
 *  lounge's round tables and floor planters, so the closest connected cell there is 60-odd units out —
 *  far enough that the avatar would be facing the sectional, not the shelves. */
export const SHELF_APPROACH: ApproachCapability = {
  point: standNear({ x: SHELF_RUN.x - 14, z: SHELF_RUN.z + 18 }, { x: -1, z: 0 }),
  yaw: FACING_YAW.east, label: "Library", action: "Browse the shelves",
};
/** At the plaque, facing the monument. The apron south of the ring is the only place you can read it from. */
export const MONUMENT_APPROACH: ApproachCapability = {
  point: standNear({ x: MONUMENT.centre.x, z: MONUMENT.centre.z + MONUMENT.plaque.z + 16 }, { x: 0, z: 1 }),
  yaw: FACING_YAW.north, label: "Boxing Championship", action: "Read the plaque",
};

// ---- Toucan ----------------------------------------------------------------------------------------
/** V2's Toucan perch. The legacy V1 coordinate (727, 556) is now INSIDE the boxing monument — it predates
 *  the hero and would put the bird through the ring — so V2 carries its own. This is the north-east arc's
 *  planting bed rim: real geometry, already outside every walkable cell, clear of the monument footprint,
 *  and a toucan sitting among the planting reads exactly right.
 *
 *  Declared here rather than edited into V1: the production ToucanFlyer is V1 product code and is not this
 *  phase's to touch. Whatever integrates Toucan into V2 reads this. */
export const TOUCAN_PERCH = (() => {
  const ne = ARCS.find((a) => a.id === "arc-ne")!;
  const deg = (ne.planter.from + ne.planter.to) / 2;
  const t = (deg * Math.PI) / 180;
  return {
    x: Math.round((ISLAND.centre.x + Math.sin(t) * BENCH_SEAT_R) * 10) / 10,
    z: Math.round((ISLAND.centre.z - Math.cos(t) * BENCH_SEAT_R) * 10) / 10,
    y: ISLAND.rimH,
  };
})();

// ---- assembly --------------------------------------------------------------------------------------
export const NORTH_CHAIR_SEAT_IDS = NORTH_CHAIRS.map((c) => `${CENTRAL_HUB_ID}/${c.id}`);
export const LOWER_LOUNGE_SEAT_IDS = LOWER_LOUNGE.map((c) => `${CENTRAL_HUB_ID}/${c.id}`);
export const SECTIONAL_SEAT_ID = `${CENTRAL_HUB_ID}/${SECTIONAL.id}`;
export const TUB_SEAT_ID = `${CENTRAL_HUB_ID}/${TUB.id}`;
/** every FIXED lounge piece in the hub, in the order bootstrap flattens them */
export const HUB_LOUNGE_IDS = [BENCH_ENTITY_ID, ...NORTH_CHAIR_SEAT_IDS, SECTIONAL_SEAT_ID, TUB_SEAT_ID, ...LOWER_LOUNGE_SEAT_IDS];

function approachEntity(id: string, pick: string, approach: ApproachCapability): Entity {
  return {
    id, kind: "solid", roomId: CENTRAL_HUB_ID,
    transform: { pos: { ...approach.point }, yaw: approach.yaw },
    capabilities: { approach }, props: { pick }, source: { baked: true },
  };
}

/** 6C: hang the MOVABLE seat capability on the 24 café chairs, the FIXED lounge capability on the benches
 *  and every real lounge piece, and add the three walk-up points. No geometry, no transforms and no ids
 *  change — every 6B entity is the same object it was, with capabilities added. */
export function withCentralHubInteractions(entities: Entity[]): Entity[] {
  for (const ref of cafeSeats()) {
    const id = cafeChairId(ref.table, ref.side);
    const e = entities.find((x) => x.id === id);
    if (!e) throw new Error(`central hub: no café chair entity ${id}`);
    e.capabilities = { ...e.capabilities, seat: cafeChairSeat(ref) };
  }
  const fixed: [string, LoungeSeatSlot[]][] = [
    [SECTIONAL_SEAT_ID, sectionalSlots()],
    [TUB_SEAT_ID, [tubSlot()]],
  ];
  NORTH_CHAIRS.forEach((c) => fixed.push([`${CENTRAL_HUB_ID}/${c.id}`, armchairSlots(c.id, { x: c.x, z: c.z }, NORTH_CHAIR_W, "south", 1)]));
  LOWER_LOUNGE.forEach((c) => fixed.push([`${CENTRAL_HUB_ID}/${c.id}`, armchairSlots(c.id, { x: c.x, z: c.z }, c.w, "north", c.seats)]));
  for (const [id, slots] of fixed) {
    const e = entities.find((x) => x.id === id);
    if (!e) throw new Error(`central hub: no lounge entity ${id}`);
    e.capabilities = { ...e.capabilities, lounge: { slots } };
  }
  // The benches are STATIC geometry (build/central-hub owns the arcs), so their seating hangs on a
  // footprint-only entity pinned to the island centre — the same trick the Design Room's baked decor uses.
  entities.push({
    id: BENCH_ENTITY_ID, kind: "solid", roomId: CENTRAL_HUB_ID,
    transform: { pos: { ...ISLAND.centre }, yaw: 0 },
    capabilities: { lounge: { slots: benchSlots() } },
    props: { pick: "hub-island" }, source: { baked: true },
  });
  entities.push(approachEntity(COUNTER_INTERACTION_ID, "hub-pantry", COUNTER_APPROACH));
  entities.push(approachEntity(SHELF_INTERACTION_ID, "hub-shelf-run", SHELF_APPROACH));
  entities.push(approachEntity(MONUMENT_INTERACTION_ID, "hub-monument", MONUMENT_APPROACH));
  return entities;
}
