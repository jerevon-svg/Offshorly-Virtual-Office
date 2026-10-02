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
/** the office podium's plinth ring (build/floorplan): a 5-tall stone box standing on grade, so its top —
 *  the ledge a body sees between the podium sidewalk and the lower walks — is GRADE + 5 */
export const PODIUM_PLINTH_H = 5;
export const PODIUM_LEDGE_Y = GRADE + PODIUM_PLINTH_H;

export const PODIUM: Rect = { x: FRAME.x - PODIUM_MARGIN, z: FRAME.z - PODIUM_MARGIN, w: FRAME.w + 2 * PODIUM_MARGIN, d: FRAME.d + 2 * PODIUM_MARGIN };

export const ROADS: Road[] = [
  // the main street: the office's address, running east-west along the south (street-façade) side
  { id: "road-main", axis: "x", at: 1620, width: ROAD_W, from: -ROAD_RUN, to: ROAD_RUN, lanes: 2 },
  // the back street closing the block to the north
  // THE BACK STREET, moved north (was at -1028) to open the REAR CAMPUS. Offshorly's lot now runs deep
  // enough behind the building to hold the AI Lab and the lake behind it without either crossing a road,
  // which is the whole spatial idea: office → landscaped rear → hidden Lab → water → tree line. Every
  // lot boundary is derived from this road's edges, so they follow it; the office itself does not move.
  { id: "road-north", axis: "x", at: -2100, width: ROAD_W, from: -ROAD_RUN, to: ROAD_RUN, lanes: 2 },
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
 *  one stall every STALL_W down the length.
 *
 *  x -712, not the original -736: the lot used to start 20 units off the west street's sidewalk, so its
 *  screening hedge stood ON the public pavement. It moved 24 east to open a proper planted strip
 *  (PARK_SCREEN) between the pavement and the stalls; everything below is derived from this rect. */
export const PARKING: Rect = { x: -712, z: 300, w: 360, d: 836 };
/** pitch along the aisle (a stall's width) */
export const STALL_W = 76;
/** how deep a stall bites into the lot from its edge (a stall's length) */
export const STALL_D = 150;
/** x of each stall bank's outer edge, and the direction a car in it faces */
export const STALL_BANKS = [
  { x: PARKING.x, yaw: -Math.PI / 2 },
  { x: PARKING.x + PARKING.w - STALL_D, yaw: Math.PI / 2 },
] as const;
/** the drive off the main street into the parking deck, on the aisle's own centre line */
export const PARK_DRIVE: Rect = { x: PARKING.x + (PARKING.w - 140) / 2, z: PARKING.z + PARKING.d, w: 140, d: MAIN_N - (PARKING.z + PARKING.d) };
/** THE VISITOR FORECOURT at the foot of the entry stair — pedestrian paving only.
 *
 *  It used to run all the way to the main street as one "drop-off" apron, which put it ON the public
 *  sidewalk: the jeepney parked there stood on the pavement around a street lamp and against a street
 *  tree. The arrival is now three bands, north to south: this forecourt, the sidewalk diverted behind the
 *  bay (LAYBY_WALK), and a real lay-by (LAYBY) carved out of the sidewalk band beside the carriageway. */
export const DROP_OFF: Rect = { x: ENTRY_X - 250, z: PODIUM.z + PODIUM.d + 30, w: 500, d: 42 };
/** the public sidewalk, diverted behind the lay-by (paved, pedestrian) */
export const LAYBY_WALK: Rect = { x: DROP_OFF.x, z: DROP_OFF.z + DROP_OFF.d, w: DROP_OFF.w, d: MAIN_N - 84 - (DROP_OFF.z + DROP_OFF.d) };
/** THE LAY-BY: asphalt in the sidewalk band, open to the carriageway, where the jeepney, the tricycles
 *  and the kalesa wait. Vehicles here face west — the main street's north lane runs westbound. */
export const LAYBY: Rect = { x: DROP_OFF.x, z: MAIN_N - 84, w: DROP_OFF.w, d: 84 };
/** the lay-by's own surface level: just above the sidewalk it replaces */
export const LAYBY_Y = GRADE + 0.35 + 0.08;
/** the flight down from the podium to the drop-off — the visitor arrival move */
export const ENTRY_STAIR: Rect = { x: ENTRY_X - 150, z: PODIUM.z + PODIUM.d, w: 300, d: 30 };

/** the public sidewalk width (SIDEWALK_W below), needed here before it is declared */
const SIDEWALK_W_ = 84;
// ---- THE STAFF CAR PARK'S COMPOSITION -------------------------------------------------------------------
// Restrained on purpose and read from TWO heights — at the pavement and from floor 2's west windows one
// storey up (app/floors STOREY_H) — so everything here is either paint, paving or a kerbed island, and the
// only vertical pieces are five modest island trees and three lot lamps that reuse the street lamp.
/** stalls per bank */
export const PARK_STALLS = Math.floor(PARKING.d / STALL_W);
/** the drive aisle between the two banks */
export const PARK_AISLE: Rect = { x: PARKING.x + STALL_D, z: PARKING.z, w: PARKING.w - 2 * STALL_D, d: PARKING.d };
/** one stall's footprint: bank 0 is the west (street-side) bank, bank 1 the east (building-side) one */
export const stallRect = (bank: 0 | 1, i: number): Rect => ({ x: STALL_BANKS[bank].x, z: PARKING.z + i * STALL_W, w: STALL_D, d: STALL_W });
/** THE SCREEN: a planted strip between the west street's sidewalk and the stalls (the hedge's home) */
export const PARK_SCREEN: Rect = { x: WEST_E + SIDEWALK_W_ + 4, z: PARKING.z, w: PARKING.x - 4 - (WEST_E + SIDEWALK_W_ + 4), d: PARKING.d };
/** KERBED ISLANDS, each replacing one stall: the four bank ends and one mid-bank break in the long west
 *  row. Each carries one small tree; three carry a lot lamp, zig-zagged so the aisle is lit end to end
 *  (the street lamps on the west sidewalk already light the west bank). None touches the aisle. */
export const PARK_ISLANDS: { bank: 0 | 1; stall: number; lamp: boolean }[] = [
  { bank: 0, stall: 0, lamp: false },
  { bank: 1, stall: 0, lamp: true },
  { bank: 0, stall: 6, lamp: true },
  { bank: 0, stall: PARK_STALLS - 1, lamp: false },
  { bank: 1, stall: PARK_STALLS - 1, lamp: true },
];
/** the east-bank stall given over to the pedestrian walk out to the building */
export const PARK_WALK_STALL = 4;
/** the pedestrian walk's band through the lot and on to the building (centred on that stall) */
const WALK_Z = PARKING.z + (PARK_WALK_STALL + 0.5) * STALL_W - 24;
/** accessible bays: the two east-bank stalls either side of the walk, the shortest route to the door */
export const PARK_ACCESSIBLE = [PARK_WALK_STALL - 1, PARK_WALK_STALL + 1];
/** PEDESTRIAN PATHS from the car park to the office's west walk: through the planting-bed gap mid-lot,
 *  and the apron head carried on past the drive to the perimeter walk at the south end. */
export const PARK_PATHS: Rect[] = [
  // the walk band inside the east bank, then the path across the lawn to the link walk (x -136)
  { x: STALL_BANKS[1].x, z: WALK_Z, w: -136 - STALL_BANKS[1].x, d: 48 },
  { x: PARK_DRIVE.x + PARK_DRIVE.w, z: PARKING.z + PARKING.d, w: PODIUM.x - 60 - (PARK_DRIVE.x + PARK_DRIVE.w), d: 52 },
];
/** painted crossings: over the aisle on the walk's line, and over the drive on the apron head. `along`
 *  is the direction a pedestrian walks (the bars run that way). */
export const PARK_CROSSINGS: { rect: Rect; along: "x" | "z" }[] = [
  { rect: { x: PARK_AISLE.x, z: WALK_Z, w: PARK_AISLE.w, d: 48 }, along: "x" },
  { rect: { x: PARK_DRIVE.x, z: PARKING.z + PARKING.d, w: PARK_DRIVE.w, d: 52 }, along: "z" },
];
/** island centre */
export const islandCentre = (i: { bank: 0 | 1; stall: number }): { x: number; z: number } => {
  const r = stallRect(i.bank, i.stall);
  return { x: r.x + r.w / 2, z: r.z + r.d / 2 };
};
/** THE LOT LAMPS: the street lamp's own model at 0.8 scale, standing at the aisle end of its island with
 *  the arm reaching over the aisle (arm = local -z; yaw -PI/2 points it east, +PI/2 west). */
export const PARK_LAMP_SCALE = 0.8;
export const PARK_LAMPS: { x: number; z: number; yaw: number; s: number }[] = PARK_ISLANDS.filter((i) => i.lamp).map((i) => {
  const r = stallRect(i.bank, i.stall);
  return i.bank === 0
    ? { x: r.x + r.w - 14, z: r.z + r.d / 2, yaw: -Math.PI / 2, s: PARK_LAMP_SCALE }
    : { x: r.x + 14, z: r.z + r.d / 2, yaw: Math.PI / 2, s: PARK_LAMP_SCALE };
});

/** paved perimeter walk hugging the podium, and the two spurs that connect it to the street network */
export const WALKS: Rect[] = [
  { x: PODIUM.x - 60, z: PODIUM.z - 60, w: PODIUM.w + 120, d: 60 }, // north
  { x: PODIUM.x - 60, z: PODIUM.z + PODIUM.d, w: PODIUM.w + 120, d: 60 }, // south
  { x: PODIUM.x - 60, z: PODIUM.z, w: 60, d: PODIUM.d }, // west
  { x: PODIUM.x + PODIUM.w, z: PODIUM.z, w: 60, d: PODIUM.d }, // east
  // parking apron head, WEST of the drive; east of it the head runs on to the building (PARK_PATHS) and
  // the drive itself is crossed on a zebra (PARK_CROSSINGS) rather than paved over
  { x: PARKING.x, z: PARKING.z + PARKING.d, w: PARK_DRIVE.x - PARKING.x, d: 52 },
  { x: -136, z: 300, w: 52, d: 836 }, // parking → building link
];

/** public sidewalk bands: one down each side of every road, laid as rects so they can be baked flat */
export const SIDEWALK_W = SIDEWALK_W_;

/** the lawn/field of a lot, minus whatever is paved on it — the builder subtracts, this just names it */
export const LAWN_INSET = 0;

/** street furniture positions. Lights are the only exterior "light source" in the scene and they are
 *  emissive meshes, not real lights — see build/exterior.ts. */
export function streetLightSpots(spacing = 380): { x: number; z: number; yaw: number }[] {
  const raw: { x: number; z: number; yaw: number }[] = [];
  const out = raw;
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
  // THE RHYTHM MEETS THE PLAN. A lamp every `spacing` down each verge knows nothing about what else stands
  // there, so three cases are resolved here, once, for every consumer:
  //   • a verge lamp that lands inside a CROSS STREET's carriageway (the intersections) is dropped;
  //   • one that lands in the car park's entrance drive steps to the nearer side of the drive;
  //   • one that lands in the lay-by moves back onto the diverted sidewalk behind it, arm still over the bay.
  const inside = (p: { x: number; z: number }, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.z > r.z && p.z < r.z + r.d;
  const res: { x: number; z: number; yaw: number }[] = [];
  for (const l of raw) {
    if (ROADS.some((r) => inside(l, roadRect(r)))) continue;
    if (inside(l, PARK_DRIVE)) {
      const west = l.x - PARK_DRIVE.x < PARK_DRIVE.x + PARK_DRIVE.w - l.x;
      res.push({ ...l, x: west ? PARK_DRIVE.x - 14 : PARK_DRIVE.x + PARK_DRIVE.w + 14 });
      continue;
    }
    if (inside(l, LAYBY)) { res.push({ ...l, z: LAYBY.z - 12 }); continue; }
    res.push(l);
  }
  return res;
}

/** low path bollards along the campus's own walks — warmer and much smaller than a street lamp */
export function pathLightSpots(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const w = PODIUM.x - 30, e = PODIUM.x + PODIUM.w + 30, n = PODIUM.z - 30, s = PODIUM.z + PODIUM.d + 30;
  // the south row skips the foot of the entry stair: two bollards used to stand across the visitor's line
  for (let x = w + 90; x < e; x += 190) {
    out.push({ x, z: n });
    if (x < ENTRY_STAIR.x - 8 || x > ENTRY_STAIR.x + ENTRY_STAIR.w + 8) out.push({ x, z: s });
  }
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
/** THE OPEN COUNTRY between the lots, laid a hair under the lawns (EXTERIOR POLISH: it used to sit under the
 *  carriageways at ROAD_Y − 1, which left a 2.6 lip at every lot edge and 2.95 off every far sidewalk).
 *  It is now built as cells that never overlap a lot or a street corridor, so it can sit this close. */
export const TERRAIN_Y = GRADE - 0.3;
/** how far from WORLD_CENTRE a street is DRAWN: it runs on through the distant tree belt and ends at the foot
 *  of the horizon ridge (build/exterior), instead of running out across the terrain disc's edge */
export const ROAD_VIS_R = 4880;
/** the drawn span of a road along its axis: its own extent clipped to the ROAD_VIS_R circle */
export function roadVisibleSpan(r: Road): { from: number; to: number } {
  const c = r.axis === "x" ? WORLD_CENTRE.x : WORLD_CENTRE.z, off = r.at - (r.axis === "x" ? WORLD_CENTRE.z : WORLD_CENTRE.x);
  const half = Math.sqrt(Math.max(0, ROAD_VIS_R * ROAD_VIS_R - off * off));
  return { from: Math.max(r.from, c - half), to: Math.min(r.to, c + half) };
}

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
  // THE VERGE LINES stand on the lawn just beyond each outer sidewalk, mirrored about the block. The east
  // line used to sit at x 2246 — INSIDE the east street's carriageway, where traffic now runs — and the
  // west one on its sidewalk, on the same rhythm as the lamps (a trunk and a lamp post at one spot).
  { id: "line-west-verge", kind: "tall", axis: "z", at: -1172, from: -560, to: 1360, spacing: 268 },
  { id: "line-east-verge", kind: "tall", axis: "z", at: 2508, from: -560, to: 1360, spacing: 268 },
];

/* THE AI LAB's wide treehouse plinth (the only Lab since Phase 6B.8) puts the four Lab flank groves ~300 further out
 * than the original Lab's; only the grove CENTRES differ — the scatter consumes the same draws, so every other tree
 * is the approved layout. */

export const GROVES: Grove[] = [
  // ---- THE REAR CAMPUS: the planting that HIDES THE AI LAB, and then gives it back ----------------
  // The rule here is SCREENS WITH GAPS, never a hedge, and NOTHING IS MIRRORED. A solid tree wall would
  // make the Lab a locked door and a symmetrical one would read as an avenue; what the rear campus
  // should feel like is landscape that happens to have a building in it. So every cluster below differs
  // from its opposite number in position, size, count and species, and the approach threads between them.
  //
  //   1. REAR SCREEN — stands just off the building's north face, so the Lab is NOT visible from the
  //      office's own back door. This is what makes the walk round the east flank necessary.
  { id: "grove-rear-west", kind: "broad", x: 120, z: -132, rx: 250, rz: 58, count: 7 },
  { id: "grove-rear-mid", kind: "round", x: 560, z: -108, rx: 130, rz: 44, count: 5 },
  { id: "grove-rear-east", kind: "broad", x: 1250, z: -126, rx: 215, rz: 66, count: 7 },
  //   2. APPROACH FRAME — east of the podium, so the run north feels like a lane rather than a field.
  //      Two loose stands at different depths, not a row.
  { id: "grove-approach-east", kind: "tall", x: 1720, z: -150, rx: 155, rz: 185, count: 6 },
  { id: "grove-approach-far", kind: "round", x: 1640, z: 380, rx: 110, rz: 230, count: 5 },
  //   3. LAB SCREEN — the last veil, immediately south of the plinth. The gap between its two halves
  //      (x 650…850) is EXACTLY where the entrance walk arrives, so the building resolves out of the
  //      planting as you turn into it instead of appearing all at once. The east half is heavier and
  //      set further back than the west, so the two sides never read as a pair.
  { id: "grove-lab-screen-west", kind: "round", x: 495, z: -352, rx: 155, rz: 26, count: 6 },
  { id: "grove-lab-screen-east", kind: "broad", x: 1010, z: -338, rx: 160, rz: 30, count: 8 },
  //   4. FLANKS — heavy planting down both sides of the Lab, so it is only ever seen from the front or
  //      from directly above. This is what hides it from the east approach until you are past it.
  { id: "grove-lab-flank-west", kind: "broad", x: -112, z: -700, rx: 125, rz: 235, count: 10 },
  { id: "grove-lab-flank-west-n", kind: "conifer", x: -150, z: -1000, rx: 145, rz: 85, count: 5 },
  { id: "grove-lab-flank-east", kind: "round", x: 1610, z: -620, rx: 140, rz: 205, count: 9 },
  { id: "grove-lab-flank-east-n", kind: "broad", x: 1595, z: -960, rx: 130, rz: 95, count: 6 },
  //   5. THE LAKE SHORE — dense round the west, east and far side, and DELIBERATELY OPEN on the Lab's
  //      side, so the water is the view from inside the Lab and the tree line closes the world beyond it.
  { id: "grove-lake-west", kind: "round", x: -10, z: -1360, rx: 155, rz: 285, count: 10 },
  { id: "grove-lake-east", kind: "round", x: 1495, z: -1450, rx: 170, rz: 265, count: 10 },
  { id: "grove-lake-north", kind: "conifer", x: 700, z: -1905, rx: 530, rz: 115, count: 12 },
  // ---- the vacant parcels: ONE grove each, tucked into the far corner from the frontage ------------
  { id: "grove-lot-south", kind: "broad", x: 120, z: 2320, rx: 420, rz: 230, count: 11 },
  { id: "grove-lot-east", kind: "round", x: 3620, z: 180, rx: 230, rz: 380, count: 11 },
  { id: "grove-lot-west", kind: "round", x: -2180, z: 900, rx: 250, rz: 330, count: 11 },
  // ---- open country beyond the back street --------------------------------------------------------
  { id: "grove-field-a", kind: "conifer", x: -1500, z: -2560, rx: 380, rz: 260, count: 12 },
  { id: "grove-field-b", kind: "conifer", x: 900, z: -2650, rx: 440, rz: 300, count: 13 },
  { id: "grove-field-c", kind: "conifer", x: 2700, z: -2520, rx: 320, rz: 240, count: 10 },
];

export const SPECIMENS: Specimen[] = [
  { kind: "tall", x: ENTRY_X - 400, z: PODIUM.z + PODIUM.d + 44, s: 1.15 },
  { kind: "tall", x: ENTRY_X + 400, z: PODIUM.z + PODIUM.d + 44, s: 1.15 },
  { kind: "broad", x: 700, z: -180, s: 1.3 },
  // was x 1760, z -820 on the old north lawn. It now stands in the Lab's east flank planting — the one
  // existing tree the rear composition moves, and it moves rather than being felled.
  { kind: "broad", x: 1290, z: -830, s: 1.25 },
];

// ---- THE POND ----------------------------------------------------------------------------------------
/** THE LAKE. The one water feature, and since the rear campus opened it is a genuine body of water at the
 *  BACK of the property rather than an ornamental pond on the lawn: 1240 x 660, sitting directly BEHIND
 *  the AI Lab so the Lab reads against water from inside it and from every approach. Its outline is an
 *  organic closed curve (see build/exterior pondShape) rather than a circle, ringed by a shallow shore
 *  band and a path spur along its south side. Nothing else is out there — the rest is grass and trees. */
export const POND = { x: 740, z: -1430, rx: 740, rz: 340 };
/** how far the shore/beach band extends past the water line */
export const POND_SHORE = 34;
/** the two benches that look out over it, and the short path that reaches them */
export const POND_BENCHES: { x: number; z: number; yaw: number }[] = [
  { x: 566, z: -1016, yaw: Math.PI },
  { x: 914, z: -1016, yaw: Math.PI },
];
/** the walk from the AI Lab's rear opening down to the water, on the Lab's own centre line */
// the path from the lakeside steps (world/ailab lakeStepTreads) down to the water's edge
export const POND_PATH: Rect = { x: 706, z: -1120, w: 68, d: 86 };

// ---- VEHICLES ----------------------------------------------------------------------------------------
/** THE PARKED FLEET (build/vehicles). Sports and premium cars in the staff car park, and the Philippine
 *  street set — jeepney, tricycle, e-trike and a kalesa — waiting in the lay-by. A FEW, placed one by one:
 *  nothing is scattered and no road is filled. Every model faces local −z; `yaw` turns it. */
export type VehicleKind = "supercar" | "supercarWing" | "sport" | "pickup" | "sportbike" | "tricycle" | "etrike" | "jeepney" | "kalesa" | "scooter";
export type VehicleSpot = { kind: VehicleKind; x: number; z: number; yaw: number; colour: number; y?: number };
/** body length of each kind along its own axis — the lay-by is packed from these */
export const VEHICLE_LENGTH: Record<VehicleKind, number> = {
  supercar: 112, supercarWing: 112, sport: 112, pickup: 132, sportbike: 56, tricycle: 60, etrike: 72, jeepney: 180, kalesa: 144, scooter: 35,
};

const STALL_MID = (bank: number) => STALL_BANKS[bank].x + STALL_D / 2;
const stallZ = (i: number) => PARKING.z + (i + 0.5) * STALL_W;
/** the lay-by, packed west → east with a fixed gap, every vehicle facing west (yaw PI/2 turns −z to −x) */
const LAYBY_ORDER: { kind: VehicleKind; colour: number }[] = [
  { kind: "jeepney", colour: 0x2f5fc4 },
  { kind: "tricycle", colour: 0x2b2d33 },
  { kind: "etrike", colour: 0x8d949c },
  { kind: "kalesa", colour: 0x2e7d4f },
];
const LAYBY_GAP = 12;
const laybySpots: VehicleSpot[] = (() => {
  let x = LAYBY.x + 6;
  return LAYBY_ORDER.map((v) => {
    const len = VEHICLE_LENGTH[v.kind];
    const spot: VehicleSpot = { ...v, x: x + len / 2, z: LAYBY.z + LAYBY.d / 2 + 2, yaw: Math.PI / 2, y: LAYBY_Y };
    x += len + LAYBY_GAP;
    return spot;
  });
})();

export const VEHICLES: VehicleSpot[] = [
  // the staff car park: three exotics, two sporty road cars, one angular utility, two sports bikes
  { kind: "supercarWing", x: STALL_MID(0), z: stallZ(1), yaw: -Math.PI / 2, colour: 0xf2c230 },
  { kind: "sport", x: STALL_MID(0), z: stallZ(4), yaw: -Math.PI / 2, colour: 0xf1eee8 },
  { kind: "pickup", x: STALL_MID(0) - 4, z: stallZ(8), yaw: -Math.PI / 2, colour: 0xa3a9b0 },
  { kind: "sport", x: STALL_MID(1), z: stallZ(2), yaw: Math.PI / 2, colour: 0x3f7fd0 },
  { kind: "supercar", x: STALL_MID(1), z: stallZ(6), yaw: Math.PI / 2, colour: 0x5ec23a },
  { kind: "supercarWing", x: STALL_MID(1), z: stallZ(8), yaw: Math.PI / 2, colour: 0xc8262e },
  // both sports bikes share stall 9
  { kind: "sportbike", x: STALL_MID(1) - 26, z: stallZ(9) - 17, yaw: Math.PI / 2, colour: 0x6cc93a },
  { kind: "sportbike", x: STALL_MID(1) - 26, z: stallZ(9) + 17, yaw: Math.PI / 2, colour: 0xc8423a },
  // the lay-by: the Philippine street set
  ...laybySpots,
];

// ============================= SHARED SCENERY DATA (build/exterior + world/exteriorGround) ==============
// Everything below used to be computed inside build/exterior. It lives here so the ground model can read
// the SAME placements the builder draws — the builder consumes these, nothing is re-authored.

/** the exterior's own scatter stream (build/exterior resets to this at the start of every build) */
export const SCATTER_SEED = 20260913;
/** one step of that stream's LCG — the builder and campusTreeSpots share it, so neither can drift */
export const scatterStep = (seed: number): number => (seed * 1664525 + 1013904223) % 4294967296;

export type TreeSpot = { x: number; z: number; s: number; yaw: number; y?: number };
/** a trunk's base radius per kind, at scale 1 (build/exterior treeGeos) */
export const TREE_TRUNK_R: Record<TreeKind, number> = { round: 4.4, tall: 3.6, broad: 5.2, conifer: 3 };

/** how far a car-park island's kerb stands proud of the asphalt */
export const ISLAND_H = 3;
/** an island's kerbed footprint (the stall, inset 4 all round) */
export const islandRect = (i: { bank: 0 | 1; stall: number }): Rect => {
  const r = stallRect(i.bank, i.stall);
  return { x: r.x + 4, z: r.z + 4, w: r.w - 8, d: r.d - 8 };
};

/** EVERY CAMPUS TREE, in the builder's exact draw order. The scatter is the FIRST consumer of the stream
 *  after the reset, so this reproduces it from the seed alone; `seedAfter` is where the builder resumes
 *  for the shrubs, belts and puddles. Rows, groves, specimens, then the (deterministic) island trees. */
export function campusTreeSpots(): { spots: Record<TreeKind, TreeSpot[]>; seedAfter: number } {
  let seed = SCATTER_SEED;
  const rx = (): number => (seed = scatterStep(seed)) / 4294967296;
  const jitter = (n: number) => (rx() - 0.5) * n;
  const spots: Record<TreeKind, TreeSpot[]> = { round: [], tall: [], broad: [], conifer: [] };
  for (const line of TREE_LINES) {
    for (let t = line.from; t <= line.to; t += line.spacing) {
      const s2 = 0.92 + rx() * 0.16, yaw = rx() * 6.28;
      const spot = line.axis === "x" ? { x: t, z: line.at + jitter(8), s: s2, yaw } : { x: line.at + jitter(8), z: t, s: s2, yaw };
      // no street tree in the arrival's walk or bay — computed after the draws so the stream never shifts
      const inArrival = spot.x > LAYBY_WALK.x - 18 && spot.x < LAYBY_WALK.x + LAYBY_WALK.w + 18 && spot.z > LAYBY_WALK.z - 18 && spot.z < LAYBY.z + LAYBY.d;
      if (!inArrival) spots[line.kind].push(spot);
    }
  }
  for (const g of GROVES) {
    for (let i = 0; i < g.count; i++) {
      const a = rx() * Math.PI * 2, rr = Math.sqrt(rx());
      spots[g.kind].push({ x: g.x + Math.cos(a) * g.rx * rr, z: g.z + Math.sin(a) * g.rz * rr, s: 0.82 + rx() * 0.5, yaw: rx() * 6.28 });
    }
  }
  for (const sp of SPECIMENS) spots[sp.kind].push({ x: sp.x, z: sp.z, s: sp.s, yaw: rx() * 6.28 });
  PARK_ISLANDS.forEach((isl, k) => {
    const c = islandCentre(isl), out = isl.bank === 0 ? -1 : 1;
    spots.round.push({ x: c.x + out * 40, z: c.z, s: 0.72 + (k % 2) * 0.06, yaw: k * 1.7, y: PAVING_Y + ISLAND_H });
  });
  return { spots, seedAfter: seed };
}

/** PLANTING BEDS along the podium and the drop-off (soil, GRADE + 0.5) */
export const PLANTING_BEDS: Rect[] = [
  { x: ENTRY_X - 470, z: PODIUM.z + PODIUM.d + 8, w: 190, d: 62 },
  { x: ENTRY_X + 280, z: PODIUM.z + PODIUM.d + 8, w: 190, d: 62 },
  { x: PODIUM.x - 132, z: 180, w: 66, d: 420 },
  { x: PODIUM.x - 132, z: 700, w: 66, d: 420 },
  { x: PODIUM.x + PODIUM.w + 66, z: 260, w: 66, d: 700 },
  { x: 260, z: PODIUM.z - 132, w: 900, d: 66 },
];
export const BED_Y = GRADE + 0.5;

/** the monument sign's plinth, centred at (x, z) on the drop-off frontage */
export const MONUMENT_SIGN = { x: ENTRY_X - 430, z: DROP_OFF.z + 16, w: 260, d: 54 };

/** the low path bollards: the podium ring's lights plus the two on the mid-lot path */
export function bollardSpots(): { x: number; z: number }[] {
  const midPath = PARK_PATHS[0];
  return [...pathLightSpots(), { x: -300, z: midPath.z - 8 }, { x: -200, z: midPath.z + midPath.d + 8 }];
}
/** base radii of the repeated posts (build/exterior lampGeos / bollardGeos), at scale 1 */
export const LAMP_BASE_R = 5.5;
export const BOLLARD_BASE_R = 6;
/** a bench's footprint in its own frame (build/exterior benchGeos): 74 long, legs z −15…11 */
export const BENCH_FOOTPRINT = { x0: -37, x1: 37, z0: -15, z1: 11 };

/** THE ENTRY FLIGHT: from the podium's sidewalk edge down to the drop-off in five even risers (~1.5 each).
 *  The podium's plinth ring (PODIUM_LEDGE_Y) is itself the middle tread, so one tread stands ON the ring
 *  (between the frame's edge and the ring's middle) and two stand on grade beyond the podium's edge, in the
 *  ENTRY_STAIR rect, each wider than the one above. `base` is where each box stands. */
export const ENTRY_TREADS = 3;
export function entryStairTreads(): { rect: Rect; top: number; base: number }[] {
  const ringZ0 = FRAME.z + FRAME.d, ringZ1 = PODIUM.z + PODIUM.d, ringMid = (ringZ0 + ringZ1) / 2;
  const cx = ENTRY_STAIR.x + ENTRY_STAIR.w / 2, half = ENTRY_STAIR.d / 2;
  const tread = (w: number, z: number, d: number, top: number, base: number) => ({ rect: { x: cx - w / 2, z, w, d }, top, base });
  return [
    tread(ENTRY_STAIR.w, ringZ0, ringMid - ringZ0, PODIUM_LEDGE_Y + 1.5, PODIUM_LEDGE_Y - 0.2),
    tread(ENTRY_STAIR.w + 16, ENTRY_STAIR.z, half, PODIUM_LEDGE_Y - 1.55, GRADE - 1),
    tread(ENTRY_STAIR.w + 32, ENTRY_STAIR.z + half, half, PODIUM_LEDGE_Y - 3.1, GRADE - 1),
  ];
}

/** THE POND OUTLINE in the builder's shape space (x east, y = NORTH, i.e. world z = POND.z − y): the
 *  same eight radii-jittered points through three's SplineCurve (Catmull-Rom, open, 64 samples, closed by
 *  the final straight edge). `grow` scales it for the shore band. */
export function pondOutline(grow: number): { x: number; y: number }[] {
  const wob = [1.0, 0.86, 1.08, 0.92, 1.04, 0.82, 1.1, 0.9];
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * POND.rx * grow * wob[i], y: Math.sin(a) * POND.rz * grow * wob[(i + 3) % 8] });
  }
  const cr = (t: number, p0: number, p1: number, p2: number, p3: number): number => {
    const v0 = (p2 - p0) * 0.5, v1 = (p3 - p1) * 0.5, t2 = t * t, t3 = t * t2;
    return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
  };
  const n = 64, out: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const p = (pts.length - 1) * ((i % n) / n);
    const k = Math.floor(p), w = p - k;
    const p0 = pts[k === 0 ? k : k - 1], p1 = pts[k], p2 = pts[k > pts.length - 2 ? pts.length - 1 : k + 1], p3 = pts[k > pts.length - 3 ? pts.length - 1 : k + 2];
    out.push({ x: cr(w, p0.x, p1.x, p2.x, p3.x), y: cr(w, p0.y, p1.y, p2.y, p3.y) });
  }
  return out;
}
/** the water plane and the shore band under it (build/exterior) */
export const WATER_Y = GRADE + 0.55;
export const SHORE_Y = GRADE + 0.3;

/** EACH VEHICLE KIND'S FOOTPRINT in its own frame (nose toward −z), measured from build/vehicles'
 *  geometry — exteriorGround.test pins these to the real bounding boxes. */
export const VEHICLE_BOUNDS: Record<VehicleKind, { x0: number; x1: number; z0: number; z1: number }> = {
  supercar: { x0: -29.3, x1: 29.3, z0: -59.2, z1: 58.7 },
  supercarWing: { x0: -29.3, x1: 29.3, z0: -59.2, z1: 58.7 },
  sport: { x0: -28, x1: 28, z0: -58.3, z1: 59.3 },
  pickup: { x0: -32, x1: 32, z0: -67.2, z1: 66.7 },
  sportbike: { x0: -8, x1: 8, z0: -30.1, z1: 27.3 },
  tricycle: { x0: -22, x1: 28, z0: -30.5, z1: 28.2 },
  etrike: { x0: -27.5, x1: 27.5, z0: -39.1, z1: 39.7 },
  jeepney: { x0: -31, x1: 31, z0: -96.3, z1: 98 },
  kalesa: { x0: -25.5, x1: 25.5, z0: -78.6, z1: 69 },
  scooter: { x0: -8.25, x1: 8.25, z0: -16.9, z1: 17.94 },
};

/** THE RAMPS (Phase 4) — built, visible, and ground for walkers and riders alike. Each falls from `fromY`
 *  at its rect's min edge to `toY` at its max edge along `axis`, and is sunk into what it crosses.
 *    · the ACCESSIBLE RAMP beside the entry flight: podium sidewalk → the plinth ring's top (~1:17, staying
 *      above the ring it crosses) → the lower walk beyond the podium's edge (~1:13)
 *    · APRON: the podium sidewalk's east end down onto the plinth ring the Lab's east flank (LEG_N) runs on
 *    · PATH_LINK: from the ring back up to the Lab causeway's own deck
 *  The last two replace the two 3.2 steps the old scooter corridor floated across. */
export type Ramp = { id: string; rect: Rect; axis: "x" | "z"; fromY: number; toY: number };
export const RAMPS: Ramp[] = [
  { id: "entry-accessible-upper", rect: { x: 892, z: 1238, w: 56, d: PODIUM.z + PODIUM.d - 1238 }, axis: "z", fromY: PODIUM_TOP, toY: PODIUM_LEDGE_Y },
  { id: "entry-accessible-lower", rect: { x: 892, z: PODIUM.z + PODIUM.d, w: 56, d: 60 }, axis: "z", fromY: PODIUM_LEDGE_Y, toY: PAVING_Y },
  { id: "apron", rect: { x: 1400, z: 1200, w: 52, d: 40 }, axis: "x", fromY: PODIUM_TOP, toY: PODIUM_LEDGE_Y },
  { id: "path-link", rect: { x: 1440, z: -24, w: 48, d: 54 }, axis: "z", fromY: PODIUM_TOP, toY: PODIUM_LEDGE_Y },
];
/** EACH ROAD'S TWO VERGES as build/exterior lays them: a SIDEWALK_W sidewalk hard against the carriageway
 *  (at PAVING_Y) and a 10-wide curb band centred on the carriageway edge (at CURB_Y). */
export const CURB_Y = GRADE + 0.1;
export function roadVerges(r: Road): { side: -1 | 1; walk: Rect; curb: Rect }[] {
  return ([-1, 1] as const).map((side) => {
    const at = r.at + (side * (r.width + SIDEWALK_W_)) / 2;
    const walk: Rect = r.axis === "x"
      ? { x: r.from, z: at - SIDEWALK_W_ / 2, w: r.to - r.from, d: SIDEWALK_W_ }
      : { x: at - SIDEWALK_W_ / 2, z: r.from, w: SIDEWALK_W_, d: r.to - r.from };
    const curbAt = r.at + (side * r.width) / 2;
    const curb: Rect = r.axis === "x"
      ? { x: r.from, z: curbAt - 5, w: r.to - r.from, d: 10 }
      : { x: curbAt - 5, z: r.from, w: 10, d: r.to - r.from };
    return { side, walk, curb };
  });
}

/** EVERY SHRUB the exterior draws, by planting, in the builder's exact draw order — the stream continues
 *  from `seed` (where the tree scatter left it) and `seedAfter` is where the builder resumes. The shrub is
 *  one blob ~14 x s across at its widest, knee to waist high on the cast. */
export function campusShrubSpots(seed: number): { beds: TreeSpot[]; frontage: TreeSpot[]; screen: TreeSpot[]; islands: TreeSpot[]; reeds: TreeSpot[]; seedAfter: number } {
  const rx = (): number => (seed = scatterStep(seed)) / 4294967296;
  const jitter = (n: number) => (rx() - 0.5) * n;
  const beds: TreeSpot[] = [], frontage: TreeSpot[] = [], screen: TreeSpot[] = [], islands: TreeSpot[] = [], reeds: TreeSpot[] = [];
  for (const b of PLANTING_BEDS) for (let i = 0; i < Math.max(4, Math.round((b.w * b.d) / 3600)); i++) beds.push({ x: b.x + 14 + rx() * (b.w - 28), z: b.z + 14 + rx() * (b.d - 28), s: 0.8 + rx() * 0.5, yaw: rx() * 6.28 });
  for (const lot of EXPANSION_LOTS) {
    const r = lot.rect, n = 9;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1) - 0.5) * 0.42; // the middle 42% of the frontage only
      if (lot.frontage === "north") frontage.push({ x: r.x + r.w * (0.5 + t), z: r.z + 46 + jitter(10), s: 0.7 + rx() * 0.3, yaw: rx() * 6.28 });
      else if (lot.frontage === "west") frontage.push({ x: r.x + 46 + jitter(10), z: r.z + r.d * (0.5 + t), s: 0.7 + rx() * 0.3, yaw: rx() * 6.28 });
      else frontage.push({ x: r.x + r.w - 46 + jitter(10), z: r.z + r.d * (0.5 + t), s: 0.7 + rx() * 0.3, yaw: rx() * 6.28 });
    }
  }
  // the car park's screen hedge: three draws per plant plus a deterministic infill, so it reads as a hedge
  const screenX = PARK_SCREEN.x + PARK_SCREEN.w / 2;
  for (let z = PARKING.z; z < PARKING.z + PARKING.d; z += 76) {
    screen.push({ x: screenX + jitter(4), z: z + 20, s: 0.72 + rx() * 0.14, yaw: rx() * 6.28 });
    if (z + 58 < PARKING.z + PARKING.d) screen.push({ x: screenX, z: z + 58, s: 0.68, yaw: z * 0.01 });
  }
  // two low shrubs per island, flanking the tree
  PARK_ISLANDS.forEach((isl, k) => {
    const c = islandCentre(isl), out = isl.bank === 0 ? -1 : 1;
    for (const dz of [-18, 18]) islands.push({ x: c.x + out * 8, z: c.z + dz, s: 0.5, yaw: k + dz, y: PAVING_Y + ISLAND_H });
  });
  // reeds round the pond: three short arcs, not a continuous fringe
  for (const [a0, a1] of [[0.3, 1.15], [2.5, 3.2], [4.3, 5.1]] as const)
    for (let i = 0; i < 7; i++) {
      const a = a0 + (a1 - a0) * (i / 6);
      reeds.push({ x: POND.x + Math.cos(a) * (POND.rx + 16), z: POND.z + Math.sin(a) * (POND.rz + 14), s: 0.5 + rx() * 0.28, yaw: rx() * 6.28 });
    }
  return { beds, frontage, screen, islands, reeds, seedAfter: seed };
}
/** a shrub's footprint radius at scale 1: a little inside its ~14-unit widest blob, so a body brushes the
 *  foliage rather than stopping in the air in front of it */
export const SHRUB_R = 11;

/** each vacant parcel's future-lot marker: beside its service drive, one panel-width in from the frontage,
 *  facing the road; its plinth is 190 x 40 in the marker's own frame */
export const LOT_MARKER_PLINTH = { w: 190, d: 40 };
export function lotMarkerSpot(lot: Lot): { x: number; z: number; yaw: number } {
  const r = lot.rect, INSET = 120;
  if (lot.frontage === "north") return { x: r.x + r.w / 2 - 210, z: r.z + INSET, yaw: 0 };
  if (lot.frontage === "west") return { x: r.x + INSET, z: r.z + r.d / 2 - 210, yaw: -Math.PI / 2 };
  return { x: r.x + r.w - INSET, z: r.z + r.d / 2 - 210, yaw: Math.PI / 2 };
}

/** A VACANT PARCEL'S OWN GROUND: the mown pad set back from its frontage (GRADE + 0.12) and the service-drive
 *  stub off the road it fronts (asphalt, PAVING_Y − 0.3) */
export const VACANT_PAD_Y = GRADE + 0.12;
export function vacantLotGround(lot: Lot): { pad: Rect; stub: Rect } {
  const r = lot.rect, inset = 190;
  const pad: Rect = { x: r.x + inset, z: r.z + inset, w: r.w - 2 * inset, d: r.d - 2 * inset };
  const stub: Rect =
    lot.frontage === "north" ? { x: r.x + r.w / 2 - 70, z: r.z, w: 140, d: inset }
    : lot.frontage === "west" ? { x: r.x, z: r.z + r.d / 2 - 70, w: inset, d: 140 }
    : { x: r.x + r.w - inset, z: r.z + r.d / 2 - 70, w: inset, d: 140 };
  return { pad, stub };
}
