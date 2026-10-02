// vo3d world — THE EXTERIOR GROUND MODEL: what the ground outside the office IS, as data. Pure; no THREE.
//
// ONE SOURCE OF TRUTH FOR "WHAT IS UNDER THIS POINT, AND MAY A BODY STAND THERE". Every surface below is
// read from the constants the builders draw from (world/campus, world/ailab, world/scooters, V1's own
// sidewalk and rooms), never re-authored, and exteriorGround.test raycasts the real built geometry to
// prove the heights. Nothing in the live world consults this yet: Phase 1 is the foundation only.
//
// HOW A HEIGHT IS ANSWERED. The exterior is built as flat plates stacked on the lawn, and what a camera
// sees at a point is simply the HIGHEST plate there — paving laid over lawn, water over its shore, the
// top tread of the entry stair over the lower ones. So `groundAt` returns the highest surface containing
// the point, which reproduces the rendered ground without any per-pair priority table. A surface may
// carry a linear `slope` (ramps), and a sloped one CUTS: it is sunk into the plinth it crosses, so it wins
// inside its own rect. None is built yet, so every live surface is flat.
//
// HOW A BODY IS ANSWERED. A footprint is its centre and four rim samples — the same pattern
// player/standTest uses. It may occupy a point when every sample is inside the campus on a surface its
// profile allows, the samples' heights spread no more than the profile's step limit, and no solid
// overlaps it. The height-spread rule is the whole cliff model: a body cannot straddle an edge taller
// than a step, so every raised deck, kerb and podium face becomes collision exactly where it is drawn,
// with no edge data at all.
//
// COST. Surfaces and solids are bucketed once (lazily, on first use) over the campus and its streets;
// a query touches one bucket's short list. No raycasts, no per-frame allocation beyond the sample.
import type { Rect, Vec2 } from "../core/coords";
import { FACADE_Z, FRAME, v1Rooms, v1Sidewalk } from "../adapters/v1Floor";
import {
  BED_Y, BENCH_FOOTPRINT, BOLLARD_BASE_R, DROP_OFF, GRADE, ISLAND_H, LAMP_BASE_R, LAYBY, LAYBY_WALK, LAYBY_Y,
  LOTS, MONUMENT_SIGN, OFFSHORLY_LOT, PARK_DRIVE, PARK_ISLANDS, PARK_LAMPS, PARK_PATHS, PARK_SCREEN, PARKING,
  PAVING_Y, RAMPS, PLANTING_BEDS, PODIUM, PODIUM_LEDGE_Y, PODIUM_TOP, POND, POND_BENCHES, POND_PATH,
  POND_SHORE, ROAD_Y, ROADS, SHORE_Y, TREE_TRUNK_R, VEHICLES, VEHICLE_BOUNDS, WALKS, WATER_Y, CURB_Y,
  benchSpots, bollardSpots, campusTreeSpots, entryStairTreads, islandRect, pondOutline, roadRect, roadVerges,
  streetLightSpots, type TreeKind,
  EXPANSION_LOTS, LOT_MARKER_PLINTH, SHRUB_R, VACANT_PAD_Y, WORLD_CENTRE, campusShrubSpots, lotMarkerSpot, vacantLotGround,
  TERRAIN_Y, type TreeSpot,
} from "./campus";
import { CONSTRUCTION_SITES, constructionSolids } from "./construction";
import { LAKE, shoreDistance } from "./water";
import {
  DECK_Y, LAB_CHEEKS, LAB_CHEEK_POTS, LAB_TERRACE_BENCHES, LAKE_SPUR, LAKE_TERRACE, PAVED, PORCH, WALL_T,
  labEntranceTreads, lakeStepTreads,
} from "./ailab";
// the plinth, wall and terrace planting the ground model reads are the BUILT Lab's (world/labVariant)
import { LAB_FP } from "./labVariant";
const LAB_PLINTH = LAB_FP.plinth, WALL_SEGS = LAB_FP.wallSegs, LAB_TERRACE_SHRUBS = LAB_FP.terraceShrubs;
import { scooterStations } from "./scooters";

// ============================= TYPES ============================================================
export type SurfaceKind =
  | "building" //      the office's mass north of the façade — never exterior ground
  | "facade-ledge" //  the shared stone ledge between the street façade and the sidewalk
  | "sidewalk" //      V1's front pavement, on the podium
  | "ledge" //         the podium's plinth ring, a step below the sidewalk
  | "stair" //         a tread of a built flight
  | "ramp" //          a sloped way between levels (none built yet)
  | "paving" //        walks, drop-off, lay-by walk, street sidewalks, park paths, pond path, rack slabs
  | "asphalt" //       parking, the park drive, the lay-by
  | "deck" //          the AI Lab's plinth terrace, its causeways and the lakeside deck
  | "lab-interior" //  inside the Lab's wall, and its porch threshold
  | "lawn" //          grass: every lot's lawn and the fields
  | "shore" //         the pond's shore band
  | "bed" //           planting beds (soil and shrubs)
  | "hedge" //         the car park's screen strip
  | "island" //        a kerbed car-park island (planted, with a tree and sometimes a lamp)
  | "water" //         the pond
  | "kerb" //          the curb band at a carriageway edge
  | "road" //          a carriageway
  | "terrain"; //      the open-country disc beyond everything

/** a linear height ramp across a rect: y goes from `from` at the rect's min edge to `to` at its max edge */
export type Slope = { axis: "x" | "z"; from: number; to: number };
type Shape = { rect: Rect } | { poly: readonly Vec2[] };
/** `cuts`: the surface is sunk INTO whatever it crosses (a ramp through the plinth), so inside it, it wins
 *  regardless of height */
export type Surface = { id: string; kind: SurfaceKind; y: number; slope?: Slope; cuts?: boolean; shape: Shape; bbox: Rect };

export type GroundSample = { id: string; kind: SurfaceKind; y: number; inCampus: boolean };

/** what stops a body: a round post/trunk, or a box in its own frame (three's rotation.y convention) */
export type SolidKind = "tree" | "lamp" | "bollard" | "bench" | "vehicle" | "scooter" | "rack" | "sign" | "wall" | "cheek" | "pot" | "shrub" | "site";
export type Solid =
  | { id: string; kind: SolidKind; circle: { x: number; z: number; r: number } }
  | { id: string; kind: SolidKind; box: { x: number; z: number; hx: number; hz: number; cos: number; sin: number } };

/** WHO is standing: which surfaces carry them, which of those slow them, and the tallest step they take */
export type GroundProfile = {
  id: "walk" | "ride";
  allows: ReadonlySet<SurfaceKind>;
  /** allowed, but at reduced speed (the ride's off-road) */
  slow: ReadonlySet<SurfaceKind>;
  /** allowed at full speed; everything else allowed is NORMAL (see SURFACE_SPEED) */
  fast: ReadonlySet<SurfaceKind>;
  /** the largest height spread a STANDING footprint may straddle (a moving one: the larger of the two below) */
  stepMax: number;
  /** TRAVERSAL (a body moving with a known feet height — see TraversalState): the tallest edge it steps or
   *  rolls UP onto while grounded, the deepest it steps or rolls DOWN off, and how far ground may stand
   *  above airborne feet before it is a face the body hits rather than a top it clears */
  stepUp: number;
  dropMax: number;
  airClear: number;
  /** how close the body's CENTRE may come to a solid: its real half-width, not the footprint radius. The
   *  footprint radius (the stand tests' 8, from V1's 16-unit grid) keeps feet back from edges and walls;
   *  a chibi's torso is ~4 either side, so holding it 8 off a bench or a trunk was an invisible wall. */
  solidRadius: number;
  /** the footprint the stand test samples (centre + four rim points) for surfaces and steps. Outdoors it
   *  is the body's own ~6 either side, not the indoor lattice's 8, so a gap a body visibly fits is a gap. */
  footRadius: number;
};

/** ON FOOT: every open exterior surface, grass included. The step covers the tallest single step that is
 *  actually built on the podium (ledge → lower walk, 4.65) and nothing taller — a raised deck (8.2) is
 *  a wall to a walker unless a flight is built against it. */
export const WALK_PROFILE: GroundProfile = {
  id: "walk",
  // PHASE 3B — THE VISIBLE WORLD: roads and kerbs are ground you can step onto, the open country between
  // the lots is ground, and a planting bed or a kerbed car-park island is ground with plants on it (its
  // shrubs and trees are the solids). Only water, the car park's dense screen hedge and the building stop
  // a walker by what they ARE.
  allows: new Set<SurfaceKind>(["facade-ledge", "sidewalk", "ledge", "stair", "ramp", "paving", "asphalt", "deck", "lawn", "shore", "road", "kerb", "terrain", "bed", "island"]),
  slow: new Set<SurfaceKind>(),
  fast: new Set<SurfaceKind>(),
  stepMax: 5,
  stepUp: 5,
  dropMax: 5,
  airClear: 1.5,
  footRadius: 6,
  solidRadius: 5.5,
};
/** ON A SCOOTER (Phase 4): the whole visible world a wheel can roll on — a strict subset of the walk. Roads and
 *  asphalt are FAST, paving and decks NORMAL, grass, fields, soil and the shore SLOW (off-road); never a stair
 *  or a raised island. The step is a kerb's worth: the curb band's 1.7 down to a carriageway, the 2.6 lip where
 *  a parcel's lawn meets the open country and the 2.95 off a far sidewalk onto it roll; the podium's 3.2 and
 *  4.65 steps and an island's 3.4 do not — ramps do. */
export const RIDE_PROFILE: GroundProfile = {
  id: "ride",
  allows: new Set<SurfaceKind>(["facade-ledge", "sidewalk", "ledge", "ramp", "paving", "asphalt", "deck", "lawn", "shore", "road", "kerb", "terrain", "bed"]),
  slow: new Set<SurfaceKind>(["lawn", "shore", "terrain", "bed"]),
  fast: new Set<SurfaceKind>(["road", "asphalt", "kerb"]),
  // TRAVERSAL: a wheel rolls UP a kerb-sized edge (the podium's 3.2 sidewalk step, a 2.6–2.95 lip) and DOWN
  // anything a walker steps down (the podium's 4.65 ledge); 4.65 and more upward, and every deck, wants the
  // jump. `stepMax` stays the spread a STANDING deck may straddle (the static test: mount, QA).
  stepMax: 3,
  stepUp: 3.5,
  dropMax: 5,
  airClear: 1.5,
  // the footprint is the DECK's (its wheels are ±5): what it rolls on and what it steps over; the handlebars
  // (±8) are the solid radius — a deck bumping off a 40-wide ramp's edges at 8.5 was the wrong body
  footRadius: 6.5,
  solidRadius: 8.5,
};

/** THE SURFACE'S SHARE OF THE TOP SPEED, by class (player/ScooterMotion `cap`) */
export type SpeedClass = "fast" | "normal" | "slow";
export const SURFACE_SPEED: Record<SpeedClass, number> = { fast: 1, normal: 0.85, slow: 0.5 };
export const speedClassOf = (kind: SurfaceKind, profile: GroundProfile): SpeedClass =>
  profile.fast.has(kind) ? "fast" : profile.slow.has(kind) ? "slow" : "normal";

/** A BODY ON THE MOVE: where its feet are (absolute y), whether it is in the air, and where it is coming
 *  from. Grounded, the edges are judged against the feet — up by `stepUp`, down by `dropMax` — instead of
 *  as a bare spread, and a body already straddling an edge (a ledge it just landed on) may always move so
 *  as not to straddle it worse. Airborne, the only height rule is clearance: no ground under the footprint
 *  above the feet by more than `airClear`. Surfaces, the world's edge, foreign owners and solids are judged
 *  exactly as for a body standing still — a jump clears an EDGE, never a tree, a wall, water or the world. */
export type TraversalState = { feet: number; airborne: boolean; from?: Vec2 };

export type Occupancy = { ok: true } | { ok: false; reason: "outside" | "surface" | "step" | "solid" | "foreign"; detail: string };
/** WHO ELSE OWNS A POINT. A footprint standing outside can reach into space another test governs (the
 *  office's walls and door mat, the AI Lab's interior): for such a sample this returns that test's verdict,
 *  for exterior ground it returns null and the ground model judges it. */
export type ForeignOwner = (q: Vec2) => boolean | null;

export type ExteriorGround = {
  /** the campus: the Offshorly lot, bounded by the kerbs of its four streets */
  readonly bounds: Rect;
  readonly surfaces: readonly Surface[];
  readonly solids: readonly Solid[];
  groundAt(p: Vec2): GroundSample;
  inCampus(p: Vec2): boolean;
  isWater(p: Vec2): boolean;
  /** does a body of `radius` at `p` overlap a solid? returns the first solid's id, or null */
  solidAt(p: Vec2, radius: number): string | null;
  /** may a body of `radius` stand at `p` under `profile`? — with the reason when it may not */
  /** `ignoreSolid`: a solid this body does not collide with (the ridden scooter's own empty dock) */
  /** `motion`: judge the heights as a moving body (TraversalState); omitted, the static spread rule */
  occupancy(p: Vec2, radius: number, profile: GroundProfile, foreign?: ForeignOwner, ignoreSolid?: string, motion?: TraversalState): Occupancy;
  canOccupy(p: Vec2, radius: number, profile: GroundProfile, foreign?: ForeignOwner, ignoreSolid?: string, motion?: TraversalState): boolean;
  /** THE HEIGHT A FOOTPRINT RESTS AT: the highest ground under its centre and rim — what a body there
   *  stands on, and what a falling one lands on */
  support(p: Vec2, radius: number): number;
  /** does a disc overlap a solid (other than `ignore`)? returns its id or null */
  solidNear(p: Vec2, radius: number, ignore?: string): string | null;
  /** sizes, for the debug overlay and budgets */
  stats(): { surfaces: number; solids: number; surfaceBuckets: number; maxSurfacesPerBucket: number; solidBuckets: number; maxSolidsPerBucket: number };
};

// ============================= DATA =============================================================
/** THE WALKABLE WORLD (Phase 3B): the rendered exterior out to the inner edge of the distant tree belt that
 *  rings it (build/exterior's horizon belts start at radius 4000 ± 150 about WORLD_CENTRE). Beyond it the
 *  terrain disc runs on under the belts and the hills to 5400, and the streets run on to the horizon — the
 *  one place this limit is not a visible one. */
export const WORLD_WALK = { x: WORLD_CENTRE.x, z: WORLD_CENTRE.z, r: 3800 };
export const inWalkableWorld = (p: Vec2): boolean => Math.hypot(p.x - WORLD_WALK.x, p.z - WORLD_WALK.z) <= WORLD_WALK.r;
/** the façade wall's thickness (rooms SHELL.wallThickness); the ledge starts on its outer face */
export const FACADE_WALL_T = 6;
/** the façade ledge's top (build/floorplan: −1.6 base + 1.6 + LEDGE_LIFT) */
export const FACADE_LEDGE_Y = 0.08;
/** the V1 frame's hall slab top (build/floorplan HALL_TILE_LIFT) */
export const FRAME_SLAB_Y = -0.02;
/** the Lab's causeway/terrace PAVING top (a 0.5 slab at DECK_Y − 0.3); the stone rim around it is DECK_Y */
export const LAB_PAVING_Y = DECK_Y + 0.2;
/** the Lab's interior tile and porch (build/ailab tiledFloor at DECK_Y − 0.05) — measured from the build */
export const LAB_FLOOR_Y = 0.75;
/** the rack slab (build/vehicles scooterDockGeos): 48 deep, 1.4 tall, 16 wider than its docks */
const RACK_SLAB = { h: 1.4, d: 48, dz: 2, pad: 16 };
/** the rack's rail, posts and totem, all within this band of its local z */
const RACK_RAIL = { z0: -22, z1: -15.5 };
/** how far the query grid reaches past the campus: enough to hold its streets and their far sidewalks */
const GRID_MARGIN = 64;
/** the largest body radius the solid buckets are built for */
const MAX_QUERY_R = 24;

const grow = (r: Rect, g: number): Rect => ({ x: r.x - g, z: r.z - g, w: r.w + 2 * g, d: r.d + 2 * g });
const inRect = (p: Vec2, r: Rect): boolean => p.x >= r.x && p.x <= r.x + r.w && p.z >= r.z && p.z <= r.z + r.d;
function polyBBox(pts: readonly Vec2[]): Rect {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  return { x: x0, z: z0, w: x1 - x0, d: z1 - z0 };
}
function inPoly(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const rectSurface = (id: string, kind: SurfaceKind, y: number, rect: Rect, slope?: Slope): Surface => ({ id, kind, y, slope, cuts: slope ? true : undefined, shape: { rect }, bbox: rect });
const polySurface = (id: string, kind: SurfaceKind, y: number, poly: readonly Vec2[]): Surface => ({ id, kind, y, shape: { poly }, bbox: polyBBox(poly) });

/** the pond's outline in WORLD x/z (the builder's shape y is north, so world z = POND.z − y) */
export const pondWorldOutline = (g: number): Vec2[] => pondOutline(g).map((p) => ({ x: POND.x + p.x, z: POND.z - p.y }));

/** EVERY EXTERIOR SURFACE, in no particular order — height, not order, decides which one shows. */
export function exteriorSurfaces(): Surface[] {
  const S: Surface[] = [];
  // lawns: every lot and field (the Offshorly lot's lawn is the campus's base)
  for (const lot of LOTS) S.push(rectSurface(`lawn:${lot.id}`, "lawn", GRADE, lot.rect));
  // the street grid: carriageways, their curb bands and their sidewalks
  for (const r of ROADS) {
    S.push(rectSurface(`road:${r.id}`, "road", ROAD_Y, roadRect(r)));
    for (const v of roadVerges(r)) {
      S.push(rectSurface(`kerb:${r.id}:${v.side}`, "kerb", CURB_Y, v.curb));
      S.push(rectSurface(`sidewalk:${r.id}:${v.side}`, "paving", PAVING_Y, v.walk));
    }
  }
  // the vacant parcels' mown pads and service-drive stubs
  for (const lot of EXPANSION_LOTS) {
    const { pad, stub } = vacantLotGround(lot);
    S.push(rectSurface(`pad:${lot.id}`, "lawn", VACANT_PAD_Y, pad));
    S.push(rectSurface(`stub:${lot.id}`, "asphalt", PAVING_Y - 0.3, stub));
  }
  // the lower walks and paths
  WALKS.forEach((w, i) => S.push(rectSurface(`walk:${i}`, "paving", PAVING_Y, w)));
  S.push(rectSurface("pond-path", "paving", PAVING_Y, POND_PATH));
  S.push(rectSurface("drop-off", "paving", PAVING_Y, DROP_OFF));
  S.push(rectSurface("layby-walk", "paving", PAVING_Y, LAYBY_WALK));
  PARK_PATHS.forEach((w, i) => S.push(rectSurface(`park-path:${i}`, "paving", PAVING_Y, w)));
  // asphalt
  S.push(rectSurface("layby", "asphalt", LAYBY_Y, LAYBY));
  S.push(rectSurface("parking", "asphalt", PAVING_Y - 0.3, PARKING));
  S.push(rectSurface("park-drive", "asphalt", PAVING_Y - 0.3, PARK_DRIVE));
  // planting
  PLANTING_BEDS.forEach((b, i) => S.push(rectSurface(`bed:${i}`, "bed", BED_Y, b)));
  S.push(rectSurface("park-screen", "hedge", BED_Y, PARK_SCREEN));
  PARK_ISLANDS.forEach((isl, i) => S.push(rectSurface(`island:${i}`, "island", PAVING_Y + ISLAND_H + 0.1, islandRect(isl))));
  // the podium: plinth ring, V1's sidewalk on top of it, the façade ledge, and the building behind it
  S.push(rectSurface("podium-ledge", "ledge", PODIUM_LEDGE_Y, PODIUM));
  const sidewalk = v1Sidewalk();
  S.push(rectSurface("sidewalk", "sidewalk", PODIUM_TOP, sidewalk));
  const front = v1Rooms().filter((r) => r.rect.z + r.rect.d > FACADE_Z);
  if (front.length) {
    const x0 = Math.min(...front.map((r) => r.rect.x)), x1 = Math.max(...front.map((r) => r.rect.x + r.rect.w));
    const z0 = FACADE_Z + FACADE_WALL_T;
    S.push(rectSurface("facade-ledge", "facade-ledge", FACADE_LEDGE_Y, { x: x0, z: z0, w: x1 - x0, d: sidewalk.z - z0 }));
  }
  S.push(rectSurface("office", "building", 0, { x: FRAME.x, z: FRAME.z, w: FRAME.w, d: FACADE_Z + FACADE_WALL_T - FRAME.z }));
  // south of the façade the V1 frame is still the hall slab's top (build/floorplan HALL_TILE_LIFT): it shows
  // as the thin strips beside the ledge and the sidewalk and along the sidewalk's south lip
  S.push(rectSurface("frame-slab", "sidewalk", FRAME_SLAB_Y, { x: FRAME.x, z: FACADE_Z + FACADE_WALL_T, w: FRAME.w, d: FRAME.z + FRAME.d - (FACADE_Z + FACADE_WALL_T) }));
  // the entry stair, tread by tread, exactly as built
  entryStairTreads().forEach((t, i) => S.push(rectSurface(`entry-tread:${i}`, "stair", t.top, t.rect)));
  // the scooter racks' slabs
  for (const st of scooterStations(sidewalk)) {
    const w = st.base.count * st.base.spacing + RACK_SLAB.pad;
    // local slab: x −w/2…w/2, z dz−d/2…dz+d/2; a yaw of ±π/2 swaps the axes (and the sign of the offset)
    const local = { x0: -w / 2, x1: w / 2, z0: RACK_SLAB.dz - RACK_SLAB.d / 2, z1: RACK_SLAB.dz + RACK_SLAB.d / 2 };
    S.push(rectSurface(`rack-slab:${st.id}`, "paving", RACK_SLAB.h, worldAabb(st.base.x, st.base.z, st.base.yaw, local)));
  }
  // THE AI LAB: plinth terrace, the causeways' stone and paving, the lakeside deck, the entrance flight,
  // and the interior (inside the wall, plus the porch threshold)
  S.push(polySurface("lab-plinth", "deck", DECK_Y, LAB_PLINTH));
  PAVED.forEach((r, i) => {
    S.push(rectSurface(`lab-causeway:${i}`, "deck", DECK_Y, r));
    S.push(rectSurface(`lab-causeway-paving:${i}`, "deck", LAB_PAVING_Y, grow(r, -5)));
  });
  [LAKE_SPUR, LAKE_TERRACE].forEach((r, i) => {
    S.push(rectSurface(`lake-deck:${i}`, "deck", DECK_Y, grow(r, 8)));
    S.push(rectSurface(`lake-deck-paving:${i}`, "deck", LAB_PAVING_Y, r));
  });
  labEntranceTreads().forEach((t, i) => S.push(rectSurface(`lab-tread:${i}`, "stair", GRADE + t.rise, t.rect)));
  lakeStepTreads().forEach((t, i) => S.push(rectSurface(`lake-step:${i}`, "stair", t.top, t.rect)));
  S.push(polySurface("lab-interior", "lab-interior", LAB_FLOOR_Y, WALL_SEGS.map(([a]) => a)));
  S.push(rectSurface("lab-porch", "lab-interior", LAB_FLOOR_Y, PORCH));
  // the pond: shore band, then the water over it
  S.push(polySurface("pond-shore", "shore", SHORE_Y, pondWorldOutline(1 + POND_SHORE / POND.rx)));
  S.push(polySurface("pond-water", "water", WATER_Y, pondWorldOutline(1)));
  // the built ramps (Phase 4), sunk into whatever they cross
  for (const r of RAMPS) S.push(rectSurface(`ramp:${r.id}`, "ramp", r.fromY, r.rect, { axis: r.axis, from: r.fromY, to: r.toY }));
  return S;
}

/** the world AABB of a local box under a yaw that is a multiple of π/2 (racks only) */
function worldAabb(cx: number, cz: number, yaw: number, l: { x0: number; x1: number; z0: number; z1: number }): Rect {
  const c = Math.round(Math.cos(yaw)), s = Math.round(Math.sin(yaw));
  const xs = [l.x0 * c + l.z0 * s, l.x1 * c + l.z1 * s], zs = [-l.x0 * s + l.z0 * c, -l.x1 * s + l.z1 * c];
  return { x: cx + Math.min(...xs), z: cz + Math.min(...zs), w: Math.abs(xs[1] - xs[0]), d: Math.abs(zs[1] - zs[0]) };
}

/** a box solid from a local-frame rect, placed at (x, z) under `yaw` (three's rotation.y) */
function boxSolid(id: string, kind: SolidKind, x: number, z: number, yaw: number, l: { x0: number; x1: number; z0: number; z1: number }): Solid {
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const lx = (l.x0 + l.x1) / 2, lz = (l.z0 + l.z1) / 2;
  return { id, kind, box: { x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos, hx: (l.x1 - l.x0) / 2, hz: (l.z1 - l.z0) / 2, cos, sin } };
}
const rectSolid = (id: string, kind: SolidKind, r: Rect): Solid => ({ id, kind, box: { x: r.x + r.w / 2, z: r.z + r.d / 2, hx: r.w / 2, hz: r.d / 2, cos: 1, sin: 0 } });

/** THE TREES AS PLANTED: world/campus campusTreeSpots (the approved, seeded layout), except that a trunk
 *  the grove scatter dropped INTO a paved path — through the PATH_LINK causeway, onto the north perimeter
 *  walk behind the building — is NUDGED just clear of that path's nearest edge (EXTERIOR POLISH), so the
 *  screen planting keeps its mass. A tree that would land in another path is left out. Trees standing in a
 *  planting bed (the entry specimens) are where they belong and are not moved. Computed AFTER the draws, so
 *  the stream and every other tree are untouched. The builder and the ground model both read this. */
let plantedCache: Record<TreeKind, TreeSpot[]> | null = null;
export function campusTrees(): Record<TreeKind, TreeSpot[]> {
  if (plantedCache) return plantedCache;
  // what a trunk may not stand in: paved paths, construction yards — and the Lab's stone plinth (below)
  const keepOut: Rect[] = [...PAVED, ...WALKS, POND_PATH, ...PARK_PATHS, ...CONSTRUCTION_SITES.map((c) => c.yard), ...EXPANSION_LOTS.map((l) => vacantLotGround(l).stub),
    ...ROADS.flatMap((r) => [roadRect(r), ...roadVerges(r).map((v) => v.walk)])];
  const inBed = (t: Vec2) => PLANTING_BEDS.some((b) => inRect(t, b));
  const hits = (t: Vec2, r: number) => keepOut.find((p) => t.x > p.x - r && t.x < p.x + p.w + r && t.z > p.z - r && t.z < p.z + p.d + r);
  const LAB_C = { x: LAB_PLINTH.reduce((a, q) => a + q.x, 0) / LAB_PLINTH.length, z: LAB_PLINTH.reduce((a, q) => a + q.z, 0) / LAB_PLINTH.length };
  const onPlinth = (t: Vec2, r: number) => inPoly(t, LAB_PLINTH) || [[r, 0], [-r, 0], [0, r], [0, -r]].some(([ox, oz]) => inPoly({ x: t.x + ox, z: t.z + oz }, LAB_PLINTH));
  const placed: { x: number; z: number; r: number }[] = [];
  const crowded = (t: Vec2, r: number) => placed.some((q) => Math.hypot(q.x - t.x, q.z - t.z) < q.r + r + 4);
  // a trunk in the lake (or its roots in the water's edge) stands out onto the beach
  const wet = (t: Vec2, r: number) => shoreDistance(LAKE, t) > -r - 4;
  const blocked = (t: Vec2, r: number) => onPlinth(t, r) || !!hits(t, r) || inRect(t, PODIUM) || wet(t, r);
  const settle = (kind: TreeKind) => (spot: TreeSpot): TreeSpot | null => {
    const r = TREE_TRUNK_R[kind] * spot.s * 1.6; // the root flare reaches past the trunk
    if (spot.y !== undefined || inBed(spot) || !blocked(spot, r)) return spot; // as approved
    let t: TreeSpot = spot;
    for (let pass = 0; pass < 6 && (blocked(t, r) || crowded(t, r)); pass++) {
      if (wet(t, r)) {
        const dx = t.x - LAKE.centre.x, dz = t.z - LAKE.centre.z, d = Math.hypot(dx, dz) || 1;
        const k = shoreDistance(LAKE, t) + r + 10;
        t = { ...t, x: t.x + (dx / d) * k, z: t.z + (dz / d) * k };
      }
      if (onPlinth(t, r) || crowded(t, r)) {
        // step outward from the Lab (or simply onward, if it is only crowded) until clear
        const dx = t.x - LAB_C.x, dz = t.z - LAB_C.z, d = Math.hypot(dx, dz) || 1;
        for (let k = 4; k < 260; k += 4) {
          const q = { ...t, x: t.x + (dx / d) * k, z: t.z + (dz / d) * k };
          if (!onPlinth(q, r) && !crowded(q, r)) { t = q; break; }
        }
      }
      const p = hits(t, r);
      if (p) {
        // well clear, not just clear: a trunk stood a hand's width off a raised path leaves a pocket narrower
        // than a scooter between them, so a nudged tree steps a full body (CLEAR) beyond its own flare
        const CLEAR = 20;
        const moves = [
          { x: p.x - r - CLEAR, z: t.z, d: t.x - (p.x - r) }, { x: p.x + p.w + r + CLEAR, z: t.z, d: p.x + p.w + r - t.x },
          { x: t.x, z: p.z - r - CLEAR, d: t.z - (p.z - r) }, { x: t.x, z: p.z + p.d + r + CLEAR, d: p.z + p.d + r - t.z },
        ].sort((a, b) => a.d - b.d);
        const m = moves.find((q) => !blocked(q, r));
        if (m) t = { ...t, x: m.x, z: m.z };
      }
    }
    return blocked(t, r) || crowded(t, r) ? null : t;
  };
  const all = campusTreeSpots().spots;
  // the approved trees claim their ground first, so a nudged tree steps round them rather than into them
  for (const k of Object.keys(all) as TreeKind[]) for (const t of all[k]) { const r = TREE_TRUNK_R[k] * t.s * 1.6; if (t.y !== undefined || inBed(t) || !blocked(t, r)) placed.push({ x: t.x, z: t.z, r }); }
  const run = (k: TreeKind) => all[k].map((t) => {
    const out = settle(k)(t);
    if (out && out !== t) placed.push({ x: out.x, z: out.z, r: TREE_TRUNK_R[k] * t.s * 1.6 });
    return out;
  }).filter((t): t is TreeSpot => t !== null);
  plantedCache = { round: run("round"), tall: run("tall"), broad: run("broad"), conifer: run("conifer") };
  return plantedCache;
}

/** EVERY VISIBLE SOLID OBSTACLE on and around the campus, from the placements the builders use. */
export function exteriorSolids(): Solid[] {
  const out: Solid[] = [];
  const trees = campusTrees();
  for (const kind of Object.keys(trees) as TreeKind[])
    trees[kind].forEach((t, i) => out.push({ id: `tree:${kind}:${i}`, kind: "tree", circle: { x: t.x, z: t.z, r: TREE_TRUNK_R[kind] * t.s } }));
  [...streetLightSpots().map((l) => ({ ...l, s: 1 })), ...PARK_LAMPS].forEach((l, i) => out.push({ id: `lamp:${i}`, kind: "lamp", circle: { x: l.x, z: l.z, r: LAMP_BASE_R * l.s } }));
  bollardSpots().forEach((b, i) => out.push({ id: `bollard:${i}`, kind: "bollard", circle: { x: b.x, z: b.z, r: BOLLARD_BASE_R } }));
  // PHASE 3B — the shrubs themselves, not the beds they stand in: each is knee to waist high on the cast and
  // stops a body at its own foliage; the soil between them is ground. (The car park's screen hedge stays a
  // blocked strip — it is planted dense on purpose — and the pond's reeds are soft.)
  const shrubs = campusShrubSpots(campusTreeSpots().seedAfter);
  [...shrubs.beds, ...shrubs.frontage, ...shrubs.islands].forEach((t, i) => out.push({ id: `shrub:${i}`, kind: "shrub", circle: { x: t.x, z: t.z, r: SHRUB_R * t.s } }));
  // the vacant parcels' future-lot markers, by their plinths
  for (const lot of EXPANSION_LOTS) {
    const m = lotMarkerSpot(lot), w = LOT_MARKER_PLINTH.w, d = LOT_MARKER_PLINTH.d;
    out.push(boxSolid(`lot-marker:${lot.id}`, "sign", m.x, m.z, m.yaw, { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2 }));
  }

  [...benchSpots(), ...POND_BENCHES].forEach((b, i) => out.push(boxSolid(`bench:${i}`, "bench", b.x, b.z, b.yaw, BENCH_FOOTPRINT)));
  VEHICLES.forEach((v, i) => out.push(boxSolid(`vehicle:${v.kind}:${i}`, "vehicle", v.x, v.z, v.yaw, VEHICLE_BOUNDS[v.kind])));
  for (const st of scooterStations(v1Sidewalk())) {
    for (const d of st.docks) out.push(boxSolid(`scooter:${d.id}`, "scooter", d.x, d.z, d.yaw, VEHICLE_BOUNDS.scooter));
    const w = st.base.count * st.base.spacing + RACK_SLAB.pad;
    out.push(boxSolid(`rack:${st.id}`, "rack", st.base.x, st.base.z, st.base.yaw, { x0: -w / 2, x1: w / 2, z0: RACK_RAIL.z0, z1: RACK_RAIL.z1 }));
  }
  out.push(rectSolid("monument-sign", "sign", { x: MONUMENT_SIGN.x - MONUMENT_SIGN.w / 2, z: MONUMENT_SIGN.z - MONUMENT_SIGN.d / 2, w: MONUMENT_SIGN.w, d: MONUMENT_SIGN.d }));
  // the Lab's perimeter wall, one box per run (build/ailab wallSeg: t wide, len + t long, yawed along it)
  WALL_SEGS.forEach(([a, c], i) => {
    const dx = c.x - a.x, dz = c.z - a.z, len = Math.hypot(dx, dz);
    out.push(boxSolid(`lab-wall:${i}`, "wall", (a.x + c.x) / 2, (a.z + c.z) / 2, Math.atan2(dx, dz), { x0: -WALL_T / 2, x1: WALL_T / 2, z0: -(len + WALL_T) / 2, z1: (len + WALL_T) / 2 }));
  });
  LAB_CHEEKS.forEach((r, i) => out.push(rectSolid(`lab-cheek:${i}`, "cheek", r)));
  LAB_CHEEK_POTS.forEach((r, i) => out.push(rectSolid(`lab-cheek-pot:${i}`, "pot", r)));
  // (the Lab's corner beds are clipped to the inside of their diagonal walls now — build/ailab cornerBedPoly —
  // so nothing of them stands on the terrace and the terrace ring is open all the way round)
  // CONSTRUCTION SITES (world/construction): their fences and scaffolds, from the data the site is drawn from
  for (const site of CONSTRUCTION_SITES) for (const c of constructionSolids(site)) out.push(rectSolid(c.id, "site", c.rect));
  LAB_TERRACE_SHRUBS.forEach((t, i) => out.push({ id: `lab-shrub:${i}`, kind: "shrub", circle: { x: t.x, z: t.z, r: t.r } }));
  LAB_TERRACE_BENCHES.forEach((t, i) => out.push(rectSolid(`lab-bench:${i}`, "bench", { x: t.x - t.w / 2, z: t.z - 8, w: t.w, d: 16 })));
  return out;
}

// ============================= QUERIES ==========================================================
/** a uniform bucket grid of item indices over `area` */
class Buckets {
  private readonly cells: number[][];
  private readonly cols: number;
  private readonly rows: number;
  private readonly area: Rect;
  private readonly size: number;
  constructor(area: Rect, size: number) {
    this.area = area;
    this.size = size;
    this.cols = Math.ceil(area.w / size);
    this.rows = Math.ceil(area.d / size);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }
  insert(b: Rect, idx: number): void {
    const i0 = Math.max(0, Math.floor((b.x - this.area.x) / this.size)), i1 = Math.min(this.cols - 1, Math.floor((b.x + b.w - this.area.x) / this.size));
    const j0 = Math.max(0, Math.floor((b.z - this.area.z) / this.size)), j1 = Math.min(this.rows - 1, Math.floor((b.z + b.d - this.area.z) / this.size));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.cols + i].push(idx);
  }
  at(p: Vec2): readonly number[] | null {
    const i = Math.floor((p.x - this.area.x) / this.size), j = Math.floor((p.z - this.area.z) / this.size);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return null;
    return this.cells[j * this.cols + i];
  }
  get bucketCount(): number { return this.cells.length; }
  get maxPerBucket(): number { return this.cells.reduce((m, c) => Math.max(m, c.length), 0); }
}

const surfaceHas = (s: Surface, p: Vec2): boolean => ("rect" in s.shape ? inRect(p, s.shape.rect) : inRect(p, s.bbox) && inPoly(p, s.shape.poly));
export function surfaceY(s: Surface, p: Vec2): number {
  if (!s.slope) return s.y;
  const r = s.bbox, t = s.slope.axis === "x" ? (p.x - r.x) / r.w : (p.z - r.z) / r.d;
  return s.slope.from + (s.slope.to - s.slope.from) * Math.min(1, Math.max(0, t));
}
function solidBBox(s: Solid): Rect {
  if ("circle" in s) return { x: s.circle.x - s.circle.r, z: s.circle.z - s.circle.r, w: 2 * s.circle.r, d: 2 * s.circle.r };
  const { x, z, hx, hz, cos, sin } = s.box;
  const ex = Math.abs(hx * cos) + Math.abs(hz * sin), ez = Math.abs(hx * sin) + Math.abs(hz * cos);
  return { x: x - ex, z: z - ez, w: 2 * ex, d: 2 * ez };
}
/** does a disc of `r` at `p` overlap the solid? */
export function solidOverlaps(s: Solid, p: Vec2, r: number): boolean {
  if ("circle" in s) return Math.hypot(p.x - s.circle.x, p.z - s.circle.z) < s.circle.r + r;
  const { x, z, hx, hz, cos, sin } = s.box;
  const dx = p.x - x, dz = p.z - z;
  // world → box frame: the inverse of three's rotation.y
  const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
  const qx = Math.max(Math.abs(lx) - hx, 0), qz = Math.max(Math.abs(lz) - hz, 0);
  return qx * qx + qz * qz < r * r;
}

const RIM: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function buildExteriorGround(): ExteriorGround {
  const bounds = OFFSHORLY_LOT.rect;
  // the query grid covers the whole walkable world (and a margin for the footprint at its edge)
  const area: Rect = { x: WORLD_WALK.x - WORLD_WALK.r - GRID_MARGIN, z: WORLD_WALK.z - WORLD_WALK.r - GRID_MARGIN, w: 2 * (WORLD_WALK.r + GRID_MARGIN), d: 2 * (WORLD_WALK.r + GRID_MARGIN) };
  const surfaces = exteriorSurfaces().filter((s) => s.bbox.x < area.x + area.w && s.bbox.x + s.bbox.w > area.x && s.bbox.z < area.z + area.d && s.bbox.z + s.bbox.d > area.z);
  const solids = exteriorSolids().filter((s) => { const b = solidBBox(s); return b.x < area.x + area.w && b.x + b.w > area.x && b.z < area.z + area.d && b.z + b.d > area.z; });
  const surfB = new Buckets(area, 128);
  surfaces.forEach((s, i) => surfB.insert(s.bbox, i));
  const solidB = new Buckets(area, 64);
  solids.forEach((s, i) => solidB.insert(grow(solidBBox(s), MAX_QUERY_R), i));
  const TERRAIN: Omit<GroundSample, "inCampus"> = { id: "terrain", kind: "terrain", y: TERRAIN_Y };

  const inCampus = (p: Vec2): boolean => inRect(p, bounds);
  function groundAt(p: Vec2): GroundSample {
    const idx = surfB.at(p);
    let best: Surface | null = null, bestY = -Infinity, cut = false;
    if (idx) for (const i of idx) {
      const s = surfaces[i];
      if (!surfaceHas(s, p)) continue;
      const y = surfaceY(s, p);
      // a cutting surface outranks every plain one; among equals, the highest shows
      if ((s.cuts && !cut) || ((!!s.cuts === cut) && y > bestY)) { best = s; bestY = y; cut = !!s.cuts; }
    }
    return best ? { id: best.id, kind: best.kind, y: bestY, inCampus: inCampus(p) } : { ...TERRAIN, inCampus: inCampus(p) };
  }
  function solidNear(p: Vec2, radius: number, ignore?: string): string | null {
    const idx = solidB.at(p);
    if (!idx) return null;
    for (const i of idx) if (solids[i].id !== ignore && solidOverlaps(solids[i], p, radius)) return solids[i].id;
    return null;
  }
  const solidAt = (p: Vec2, radius: number): string | null => solidNear(p, radius);
  /** the lowest and highest ground under a footprint, nothing else judged */
  function heights(p: Vec2, radius: number): { lo: number; hi: number } {
    let lo = Infinity, hi = -Infinity;
    for (let k = -1; k < RIM.length; k++) {
      const y = groundAt(k < 0 ? p : { x: p.x + RIM[k][0] * radius, z: p.z + RIM[k][1] * radius }).y;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    return { lo, hi };
  }
  /** how far a grounded footprint breaks the step rules for feet at `feet` (0 = it does not) */
  const excess = (lo: number, hi: number, feet: number, profile: GroundProfile): number =>
    Math.max(0, hi - feet - profile.stepUp) + Math.max(0, feet - lo - profile.dropMax) + Math.max(0, hi - lo - Math.max(profile.stepUp, profile.dropMax));
  function occupancy(p: Vec2, radius: number, profile: GroundProfile, foreign?: ForeignOwner, ignoreSolid?: string, motion?: TraversalState): Occupancy {
    let lo = Infinity, hi = -Infinity;
    for (let k = -1; k < RIM.length; k++) {
      const q = k < 0 ? p : { x: p.x + RIM[k][0] * radius, z: p.z + RIM[k][1] * radius };
      const g = groundAt(q);
      const owner = foreign ? foreign(q) : null;
      if (owner === false) return { ok: false, reason: "foreign", detail: g.id };
      if (owner === null) {
        if (!inWalkableWorld(q)) return { ok: false, reason: "outside", detail: g.id };
        if (!profile.allows.has(g.kind)) return { ok: false, reason: "surface", detail: `${g.kind}:${g.id}` };
      }
      if (g.y < lo) lo = g.y;
      if (g.y > hi) hi = g.y;
    }
    if (!motion) {
      if (hi - lo > profile.stepMax) return { ok: false, reason: "step", detail: (hi - lo).toFixed(2) };
    } else if (motion.airborne) {
      if (hi > motion.feet + profile.airClear) return { ok: false, reason: "step", detail: `face ${(hi - motion.feet).toFixed(2)}` };
    } else {
      const e = excess(lo, hi, motion.feet, profile);
      if (e > 0) {
        // never stuck on an edge: from a footprint already straddling one, any move that straddles no worse
        const was = motion.from ? heights(motion.from, radius) : null;
        if (!was || e > excess(was.lo, was.hi, motion.feet, profile) + 1e-6) return { ok: false, reason: "step", detail: `edge ${(hi - motion.feet).toFixed(2)}/${(motion.feet - lo).toFixed(2)}` };
      }
    }
    const hit = solidNear(p, profile.solidRadius, ignoreSolid);
    return hit ? { ok: false, reason: "solid", detail: hit } : { ok: true };
  }
  return {
    bounds, surfaces, solids, groundAt, inCampus, solidAt, occupancy,
    isWater: (p) => groundAt(p).kind === "water",
    canOccupy: (p, r, profile, foreign, ignoreSolid, motion) => occupancy(p, r, profile, foreign, ignoreSolid, motion).ok,
    support: (p, r) => heights(p, r).hi,
    solidNear,
    stats: () => ({ surfaces: surfaces.length, solids: solids.length, surfaceBuckets: surfB.bucketCount, maxSurfacesPerBucket: surfB.maxPerBucket, solidBuckets: solidB.bucketCount, maxSolidsPerBucket: solidB.maxPerBucket }),
  };
}

let shared: ExteriorGround | null = null;
/** THE campus ground, built on first use and shared. */
export function exteriorGround(): ExteriorGround {
  return (shared ??= buildExteriorGround());
}
