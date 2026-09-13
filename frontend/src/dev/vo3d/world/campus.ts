// vo3d world — THE CAMPUS PLAN: the world OUTSIDE the office, as data.
//
// ARCHITECTURE. The hierarchy this file establishes, and the reason it exists at all:
//
//     WORLD  →  COMPANY LOT  →  COMPANY CAMPUS  →  OFFICE  →  ROOMS
//
// Offshorly is the FIRST developed property in a world that is designed to hold others. So the office is
// not "the scene with some decoration around it" — it is one lot on a street grid, and the street grid is
// the thing that makes a second company possible later. Three more lots are already laid out, serviced by
// the same roads, and landscaped as open land. Adding a company means giving a vacant lot a campus
// builder; it does NOT mean re-cutting roads, re-planning Offshorly, or rebuilding the environment.
//
// DELIBERATELY NOT HERE: any other company, any "for sale" signage, any lot ownership/gameplay, any
// multi-company backend. A lot is a rect, a frontage road and a status. That is the whole contract.
//
// COORDINATES are the same world units as everything else (core/coords): x east, z south, y up. The V1
// office frame is 1440 x 1244 at the origin and the campus is laid out around it.
//
// SCENERY ONLY. Nothing in this file is registered with WorldState, appears in a navigation grid, or
// carries a footprint. The avatar's world still ends at the V1 frame.
import type { Facing, Rect } from "../core/coords";
import { FRAME } from "../adapters/v1Floor";

// ---- vertical datum ---------------------------------------------------------------------------------
/** The V1 ground-floor plinth stands proud of the site (build/floorplan: base y -8, margin 48 all round).
 *  The campus meets it there, so the plinth reads as the building's retaining podium rather than a slab
 *  hovering over a lawn. Everything below is measured off that one datum. */
export const PODIUM_MARGIN = 48;
/** top of the V1 exterior sidewalk / office ground plane */
export const PODIUM_TOP = 0.2;
/** campus ground level: lawn, beds, verges */
export const GRADE = -8;
/** carriageway, one curb below the lawn */
export const ROAD_Y = GRADE - 1.6;
/** paving: sidewalks, aprons, the parking deck — a hair proud of the lawn so edges never z-fight */
export const PAVING_Y = GRADE + 0.35;
/** painted markings sit just above their paving */
export const MARK_Y = ROAD_Y + 0.12;

// ---- the block --------------------------------------------------------------------------------------
/** A road runs ALONG `axis`; `at` is its centre-line on the other axis. */
export type Road = { id: string; axis: "x" | "z"; at: number; width: number; from: number; to: number; lanes: 2 };
export type LotStatus = "developed" | "vacant";
/** A parcel of the world. `company` lots can host a company campus; `field` is open country that never will. */
export type Lot = { id: string; name: string; kind: "company" | "field"; status: LotStatus; rect: Rect; frontage: Facing; companyId?: string };
/** a marked pedestrian crossing: a band across `roadId` centred at `at` on the road's running axis */
export type Crossing = { id: string; roadId: string; at: number; width: number };

const ROAD_W = 216;
/** how far the roads run past the block before the distant scenery takes over */
const ROAD_RUN = 5400;

/** the podium footprint: the V1 frame grown by the plinth margin */
export const PODIUM: Rect = { x: FRAME.x - PODIUM_MARGIN, z: FRAME.z - PODIUM_MARGIN, w: FRAME.w + 2 * PODIUM_MARGIN, d: FRAME.d + 2 * PODIUM_MARGIN };

export const ROADS: Road[] = [
  // the main street: the office's address, running east-west along the south (street-façade) side
  { id: "road-main", axis: "x", at: 1620, width: ROAD_W, from: -ROAD_RUN, to: ROAD_RUN, lanes: 2 },
  // the back street closing the block to the north
  { id: "road-north", axis: "x", at: -1028, width: ROAD_W, from: -ROAD_RUN, to: ROAD_RUN, lanes: 2 },
  // the two cross streets that make Offshorly a corner property
  { id: "road-west", axis: "z", at: -948, width: ROAD_W, from: -ROAD_RUN, to: ROAD_RUN, lanes: 2 },
  { id: "road-east", axis: "z", at: 2288, width: ROAD_W, from: -ROAD_RUN, to: ROAD_RUN, lanes: 2 },
];
export const roadById = (id: string): Road => {
  const r = ROADS.find((x) => x.id === id);
  if (!r) throw new Error(`campus: no road ${id}`);
  return r;
};
export function roadRect(r: Road): Rect {
  return r.axis === "x"
    ? { x: r.from, z: r.at - r.width / 2, w: r.to - r.from, d: r.width }
    : { x: r.at - r.width / 2, z: r.from, w: r.width, d: r.to - r.from };
}
/** the near edge of a road on the side facing `towards` (the coordinate a lot's boundary lands on) */
export const roadEdge = (r: Road, side: -1 | 1): number => r.at + (side * r.width) / 2;

const MAIN_N = roadEdge(roadById("road-main"), -1); //   1512
const MAIN_S = roadEdge(roadById("road-main"), 1); //    1728
const NORTH_S = roadEdge(roadById("road-north"), 1); //  -920
const NORTH_N = roadEdge(roadById("road-north"), -1); // -1136
const WEST_E = roadEdge(roadById("road-west"), 1); //    -840
const WEST_W = roadEdge(roadById("road-west"), -1); //   -1056
const EAST_W = roadEdge(roadById("road-east"), -1); //   2180
const EAST_E = roadEdge(roadById("road-east"), 1); //    2396

/** THE LOTS. One developed (Offshorly), three vacant company parcels, one open field to the north.
 *  Every company lot shares an edge with a road, so a future campus has an address and an approach. */
export const LOTS: Lot[] = [
  { id: "lot-offshorly", name: "Offshorly", kind: "company", status: "developed", companyId: "offshorly", frontage: "south", rect: { x: WEST_E, z: NORTH_S, w: EAST_W - WEST_E, d: MAIN_N - NORTH_S } },
  { id: "lot-south", name: "South Parcel", kind: "company", status: "vacant", frontage: "north", rect: { x: WEST_E, z: MAIN_S, w: EAST_W - WEST_E, d: 1020 } },
  { id: "lot-east", name: "East Parcel", kind: "company", status: "vacant", frontage: "west", rect: { x: EAST_E, z: NORTH_S, w: 1560, d: MAIN_N - NORTH_S } },
  { id: "lot-west", name: "West Parcel", kind: "company", status: "vacant", frontage: "east", rect: { x: WEST_W - 1560, z: NORTH_S, w: 1560, d: MAIN_N - NORTH_S } },
  { id: "field-north", name: "North Fields", kind: "field", status: "vacant", frontage: "south", rect: { x: WEST_W - 1560, z: NORTH_N - 1500, w: EAST_E - WEST_W + 3120, d: 1500 } },
];
export const lotById = (id: string): Lot => {
  const l = LOTS.find((x) => x.id === id);
  if (!l) throw new Error(`campus: no lot ${id}`);
  return l;
};
export const OFFSHORLY_LOT = lotById("lot-offshorly");
/** the parcels a future company campus can be dropped onto, in the order they should be offered */
export const EXPANSION_LOTS = LOTS.filter((l) => l.kind === "company" && l.status === "vacant");

export const CROSSINGS: Crossing[] = [
  { id: "cross-main-west", roadId: "road-main", at: -948, width: 132 },
  { id: "cross-main-east", roadId: "road-main", at: 2288, width: 132 },
  // the desire line from the visitor drop-off to the parcel opposite
  { id: "cross-main-entry", roadId: "road-main", at: 707, width: 116 },
  { id: "cross-west-main", roadId: "road-west", at: 1620, width: 132 },
  { id: "cross-east-main", roadId: "road-east", at: 1620, width: 132 },
];

// ---- the Offshorly campus (what sits ON the developed lot) --------------------------------------------
/** world x of the reception entrance — the campus's approach is aimed at it (reception-room spans 332…1081) */
export const ENTRY_X = 707;

/** Employee parking, west of the building. The lot is a TALL strip, so the two banks of perpendicular
 *  stalls are COLUMNS either side of a north-south aisle: 150 stall + 60 aisle + 150 stall across, and
 *  one stall every STALL_W down the length. */
export const PARKING: Rect = { x: -736, z: 300, w: 360, d: 836 };
/** pitch along the aisle (a stall's width) */
export const STALL_W = 76;
/** how deep a stall bites into the lot from its edge (a stall's length) */
export const STALL_D = 150;
/** x of each stall bank's outer edge, and the direction a car in it faces */
export const STALL_BANKS = [
  { x: PARKING.x, yaw: -Math.PI / 2 },
  { x: PARKING.x + PARKING.w - STALL_D, yaw: Math.PI / 2 },
] as const;
/** the drive off the main street into the parking deck */
export const PARK_DRIVE: Rect = { x: -626, z: PARKING.z + PARKING.d, w: 140, d: MAIN_N - (PARKING.z + PARKING.d) };
/** the visitor drop-off apron in front of reception, between the podium edge and the main street */
export const DROP_OFF: Rect = { x: ENTRY_X - 250, z: PODIUM.z + PODIUM.d + 30, w: 500, d: MAIN_N - (PODIUM.z + PODIUM.d) - 30 };
/** the flight down from the podium to the drop-off — the visitor arrival move */
export const ENTRY_STAIR: Rect = { x: ENTRY_X - 150, z: PODIUM.z + PODIUM.d, w: 300, d: 30 };

/** paved perimeter walk hugging the podium, and the two spurs that connect it to the street network */
export const WALKS: Rect[] = [
  { x: PODIUM.x - 60, z: PODIUM.z - 60, w: PODIUM.w + 120, d: 60 }, // north
  { x: PODIUM.x - 60, z: PODIUM.z + PODIUM.d, w: PODIUM.w + 120, d: 60 }, // south
  { x: PODIUM.x - 60, z: PODIUM.z, w: 60, d: PODIUM.d }, // west
  { x: PODIUM.x + PODIUM.w, z: PODIUM.z, w: 60, d: PODIUM.d }, // east
  { x: PARKING.x, z: PARKING.z + PARKING.d, w: PARKING.w, d: 52 }, // parking apron head
  { x: -136, z: 300, w: 52, d: 836 }, // parking → building link
];

/** public sidewalk bands: one down each side of every road, laid as rects so they can be baked flat */
export const SIDEWALK_W = 84;

/** the lawn/field of a lot, minus whatever is paved on it — the builder subtracts, this just names it */
export const LAWN_INSET = 0;

/** street furniture positions. Lights are the only exterior "light source" in the scene and they are
 *  emissive meshes, not real lights — see build/exterior.ts. */
export function streetLightSpots(spacing = 380): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  const span = 2800; // only light the block and a little beyond; the distance is scenery
  for (const r of ROADS) {
    const half = r.width / 2 + 42;
    for (const side of [-1, 1] as const) {
      for (let t = -span; t <= span; t += spacing) {
        if (r.axis === "x") out.push({ x: t, z: r.at + side * half, yaw: side > 0 ? Math.PI : 0 });
        else out.push({ x: r.at + side * half, z: t, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }
    }
  }
  return out;
}

/** low path bollards along the campus's own walks — warmer and much smaller than a street lamp */
export function pathLightSpots(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const w = PODIUM.x - 30, e = PODIUM.x + PODIUM.w + 30, n = PODIUM.z - 30, s = PODIUM.z + PODIUM.d + 30;
  for (let x = w + 90; x < e; x += 190) out.push({ x, z: n }, { x, z: s });
  for (let z = n + 150; z < s - 60; z += 190) out.push({ x: w, z }, { x: e, z });
  for (let z = 340; z < 1130; z += 180) out.push({ x: -110, z });
  return out;
}

export function benchSpots(): { x: number; z: number; yaw: number }[] {
  return [
    { x: ENTRY_X - 330, z: PODIUM.z + PODIUM.d + 34, yaw: Math.PI },
    { x: ENTRY_X + 330, z: PODIUM.z + PODIUM.d + 34, yaw: Math.PI },
    { x: PODIUM.x - 34, z: 500, yaw: -Math.PI / 2 },
    { x: PODIUM.x - 34, z: 760, yaw: -Math.PI / 2 },
    { x: 420, z: PODIUM.z - 34, yaw: 0 },
    { x: 1020, z: PODIUM.z - 34, yaw: 0 },
  ];
}

/** THE HORIZON. Everything beyond the block is one disc of terrain plus two rings of distant planting;
 *  the radius is chosen so the widest normal gameplay zoom (~6.7k x 3.8k world units) never reaches an
 *  edge, from any rotation. */
export const WORLD_CENTRE = { x: FRAME.x + FRAME.w / 2, z: FRAME.z + FRAME.d / 2 };
export const WORLD_RADIUS = 5400;

// ---- LANDSCAPE COMPOSITION ---------------------------------------------------------------------------
// V1 scattered trees at random across every lawn and field. It read as noise: ~310 near trees competing
// with the building for attention, and no piece of ground that felt deliberately left empty.
//
// Planting is now COMPOSED, not scattered. Three primitives, all explicit data:
//   • TREE_LINES — clean, evenly spaced rows along a NAMED STRETCH of one verge. Only the stretches that
//     frame the Offshorly block are planted; the rest of the street grid is bare on purpose.
//   • GROVES     — organic clusters with a soft elliptical falloff, placed where the eye should rest.
//   • SPECIMENS  — single feature trees, positioned one at a time.
// Everything between them is UNINTERRUPTED GRASS. The negative space is the composition.
export type TreeKind = "round" | "tall" | "broad" | "conifer";
/** an evenly spaced row along one axis, over a bounded stretch */
export type TreeLine = { id: string; kind: TreeKind; axis: "x" | "z"; at: number; from: number; to: number; spacing: number };
/** an organic cluster: `count` trees inside an ellipse, densest at the centre */
export type Grove = { id: string; kind: TreeKind; x: number; z: number; rx: number; rz: number; count: number };
/** a single feature tree */
export type Specimen = { kind: TreeKind; x: number; z: number; s: number };

/** Only four stretches are planted, and each one frames the block rather than lining a whole road. */
export const TREE_LINES: TreeLine[] = [
  { id: "line-main-north", kind: "round", axis: "x", at: 1400, from: -640, to: 1980, spacing: 208 },
  { id: "line-main-south", kind: "round", axis: "x", at: 1836, from: -640, to: 1980, spacing: 264 },
  { id: "line-west-verge", kind: "tall", axis: "z", at: -1104, from: -560, to: 1360, spacing: 268 },
  { id: "line-east-verge", kind: "tall", axis: "z", at: 2246, from: -560, to: 1360, spacing: 268 },
];

export const GROVES: Grove[] = [
  // the Offshorly lot's own north lawn: one grove, set to the west so the pond has open water around it
  { id: "grove-north-lawn", kind: "broad", x: 120, z: -620, rx: 300, rz: 170, count: 11 },
  { id: "grove-pond-head", kind: "round", x: 1180, z: -430, rx: 190, rz: 130, count: 7 },
  { id: "grove-east-lawn", kind: "broad", x: 1880, z: 420, rx: 150, rz: 300, count: 8 },
  // the vacant parcels: ONE grove each, tucked into the far corner from the frontage, so the developable
  // ground stays visibly clear
  { id: "grove-lot-south", kind: "broad", x: 120, z: 2320, rx: 420, rz: 230, count: 11 },
  { id: "grove-lot-east", kind: "round", x: 3620, z: 180, rx: 230, rz: 380, count: 11 },
  { id: "grove-lot-west", kind: "round", x: -2180, z: 900, rx: 250, rz: 330, count: 11 },
  // the open country north of the block: three loose stands, nothing else
  { id: "grove-field-a", kind: "conifer", x: -1450, z: -2100, rx: 380, rz: 260, count: 12 },
  { id: "grove-field-b", kind: "conifer", x: 900, z: -2650, rx: 440, rz: 300, count: 13 },
  { id: "grove-field-c", kind: "conifer", x: 2700, z: -1900, rx: 320, rz: 240, count: 10 },
];

export const SPECIMENS: Specimen[] = [
  { kind: "tall", x: ENTRY_X - 400, z: PODIUM.z + PODIUM.d + 44, s: 1.15 },
  { kind: "tall", x: ENTRY_X + 400, z: PODIUM.z + PODIUM.d + 44, s: 1.15 },
  { kind: "broad", x: 700, z: -180, s: 1.3 },
  { kind: "broad", x: 1760, z: -820, s: 1.25 },
];

// ---- THE POND ----------------------------------------------------------------------------------------
/** The one water feature: a landscaped pond on the Offshorly lot's north lawn. Its outline is an organic
 *  closed curve (see build/exterior pondShape) rather than a circle, ringed by a shallow shore band and a
 *  single curved path spur. Deliberately the only "feature" out there — the rest of that lawn is grass. */
export const POND = { x: 760, z: -560, rx: 390, rz: 215 };
/** how far the shore/beach band extends past the water line */
export const POND_SHORE = 34;
/** the two benches that look out over it, and the short path that reaches them */
export const POND_BENCHES: { x: number; z: number; yaw: number }[] = [
  { x: 620, z: -300, yaw: Math.PI },
  { x: 880, z: -300, yaw: Math.PI },
];
export const POND_PATH: Rect = { x: 560, z: -290, w: 400, d: 46 };

// ---- VEHICLES ----------------------------------------------------------------------------------------
/** The Philippine transport mix. A FEW, placed one by one: nothing is scattered and no road is filled. */
export type VehicleKind = "car" | "jeepney" | "tricycle" | "motorcycle";
export type VehicleSpot = { kind: VehicleKind; x: number; z: number; yaw: number; colour: number };

const STALL_MID = (bank: number) => STALL_BANKS[bank].x + STALL_D / 2;
const stallZ = (i: number) => PARKING.z + (i + 0.5) * STALL_W;

export const VEHICLES: VehicleSpot[] = [
  // employee parking — half a dozen vehicles in a 22-stall lot reads "occupied", not "texture"
  { kind: "car", x: STALL_MID(0) + 4, z: stallZ(1), yaw: -Math.PI / 2, colour: 0xd05a52 },
  { kind: "car", x: STALL_MID(0) + 4, z: stallZ(4), yaw: -Math.PI / 2, colour: 0xf1eee8 },
  { kind: "car", x: STALL_MID(0) + 4, z: stallZ(8), yaw: -Math.PI / 2, colour: 0x4c515a },
  { kind: "car", x: STALL_MID(1) - 4, z: stallZ(2), yaw: Math.PI / 2, colour: 0x3f7fd0 },
  { kind: "car", x: STALL_MID(1) - 4, z: stallZ(6), yaw: Math.PI / 2, colour: 0xdfb352 },
  { kind: "motorcycle", x: STALL_MID(1) - 30, z: stallZ(9), yaw: Math.PI / 2, colour: 0xc8423a },
  { kind: "motorcycle", x: STALL_MID(1) - 30, z: stallZ(9) + 44, yaw: Math.PI / 2, colour: 0x2f3238 },
  // the visitor drop-off: the jeepney is the set piece, a tricycle waiting behind it
  { kind: "jeepney", x: ENTRY_X - 40, z: DROP_OFF.z + DROP_OFF.d - 66, yaw: Math.PI / 2, colour: 0x2f5fc4 },
  { kind: "tricycle", x: ENTRY_X + 210, z: DROP_OFF.z + DROP_OFF.d - 64, yaw: Math.PI / 2, colour: 0x1f9d55 },
  // kerbside on the main street, west of the entry crossing
  { kind: "tricycle", x: -170, z: 1466, yaw: Math.PI / 2, colour: 0x1f9d55 },
  { kind: "car", x: 1180, z: 1466, yaw: Math.PI / 2, colour: 0x6f9e7a },
];
