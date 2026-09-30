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
  { id: "grove-lab-flank-west", kind: "broad", x: 180, z: -700, rx: 125, rz: 235, count: 10 },
  { id: "grove-lab-flank-west-n", kind: "conifer", x: 275, z: -985, rx: 145, rz: 85, count: 5 },
  { id: "grove-lab-flank-east", kind: "round", x: 1300, z: -620, rx: 140, rz: 205, count: 9 },
  { id: "grove-lab-flank-east-n", kind: "broad", x: 1215, z: -940, rx: 130, rz: 95, count: 6 },
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
export const POND_PATH: Rect = { x: 706, z: -1092, w: 68, d: 58 };

// ---- VEHICLES ----------------------------------------------------------------------------------------
/** THE PARKED FLEET (build/vehicles). Sports and premium cars in the staff car park, and the Philippine
 *  street set — jeepney, tricycle, e-trike and a kalesa — waiting in the lay-by. A FEW, placed one by one:
 *  nothing is scattered and no road is filled. Every model faces local −z; `yaw` turns it. */
export type VehicleKind = "supercar" | "supercarWing" | "sport" | "pickup" | "sportbike" | "tricycle" | "etrike" | "jeepney" | "kalesa" | "scooter";
export type VehicleSpot = { kind: VehicleKind; x: number; z: number; yaw: number; colour: number; y?: number };
/** body length of each kind along its own axis — the lay-by is packed from these */
export const VEHICLE_LENGTH: Record<VehicleKind, number> = {
  supercar: 112, supercarWing: 112, sport: 112, pickup: 132, sportbike: 56, tricycle: 60, etrike: 72, jeepney: 180, kalesa: 144, scooter: 40,
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
