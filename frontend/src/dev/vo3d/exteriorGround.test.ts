// world/exteriorGround — the exterior ground model (Phase 1: foundation only, wired into nothing live).
//
// Three kinds of evidence: the model's own answers at labelled campus points; the same points RAYCAST
// against the real built geometry (exterior + AI Lab + ground floor), so every height is the drawn one
// and not a guess; and the invariants later phases lean on (ride ⊆ walk, the campus stops at the kerbs,
// the Cave and floor 2 stay outside it, the tree scatter the ground reads is the one the builder draws).
import { describe, expect, it } from "vitest";
// PHASE 6B.8: the treehouse Lab (V2) is the only Lab, so this is the ground authority for it — the points around
// the Lab below are V2's plinth, terrace and walls, and the raycast builds the V2 Lab.
import * as THREE from "three";
import {
  RIDE_PROFILE, WALK_PROFILE, WORLD_WALK, buildExteriorGround, exteriorGround, exteriorSolids, inWalkableWorld, solidOverlaps, surfaceY,
  FACADE_WALL_T, campusTrees, type SurfaceKind,
} from "./world/exteriorGround";
import {
  CROSSINGS, OFFSHORLY_LOT, PARK_ISLANDS, RAMPS, PODIUM_LEDGE_Y, POND, VEHICLES, VEHICLE_BOUNDS,
  benchSpots, campusTreeSpots, islandCentre, roadById, roadEdge, streetLightSpots, type VehicleKind,
} from "./world/campus";
import { CORNER_TREES } from "./world/ailab";
import { OUTER_RECT as CAVE_OUTER } from "./rooms/cave";
import { OUTER_RECT as FLOOR2_OUTER } from "./rooms/floor2";
import { NAV_RADIUS } from "./nav/clearance";
import type { Vec2 } from "./core/coords";

const G = exteriorGround();
const R = NAV_RADIUS;
/** the WALK footprint the live stand test samples outdoors */
const F = WALK_PROFILE.footRadius;

/** name, point, expected kind, expected ground y, walk ok, ride ok */
type Row = [string, Vec2, SurfaceKind, number, boolean, boolean];
const ROWS: Row[] = [
  // the podium: Reception frontage, the façade side of the sidewalk, the ledge, the plinth ring
  ["Reception front sidewalk", { x: 720, z: 1216 }, "sidewalk", 0.2, true, true],
  ["façade side of the sidewalk", { x: 300, z: 1175 }, "sidewalk", 0.2, true, true],
  ["façade ledge", { x: 300, z: 1140 }, "facade-ledge", 0.08, true, true],
  ["podium ledge, front", { x: 300, z: 1266 }, "ledge", -3, true, true],
  ["podium ledge, west (LEG side)", { x: -24, z: 600 }, "ledge", -3, true, true],
  ["LEG_N runs on the ledge", { x: 1464, z: 600 }, "ledge", -3, true, true],
  // the entry flight (Phase 3): five even risers, the plinth ring as its middle tread
  ["entry flight, first tread (on the ring)", { x: 707, z: 1256 }, "stair", -1.5, true, false],
  ["entry flight, the ring's own tread", { x: 707, z: 1280 }, "ledge", -3, true, true],
  ["entry flight, third tread", { x: 707, z: 1299.5 }, "stair", -4.55, true, false],
  ["entry flight, last tread", { x: 707, z: 1314.5 }, "stair", -6.1, true, false],
  ["drop-off", { x: 707, z: 1352 }, "paving", -7.65, true, true],
  ["lay-by walk", { x: 600, z: 1396 }, "paving", -7.65, true, true],
  // all four sides of the office, on the lower walk ring
  ["west walk", { x: -80, z: 600 }, "paving", -7.65, true, true],
  ["north walk", { x: 500, z: -80 }, "paving", -7.65, true, true],
  ["east walk", { x: 1520, z: 600 }, "paving", -7.65, true, true],
  // the four street sidewalks, inside the kerbs
  ["main-road sidewalk", { x: 100, z: 1470 }, "paving", -7.65, true, true],
  ["west-road sidewalk", { x: -798, z: 430 }, "paving", -7.65, true, true],
  ["north-road sidewalk", { x: 430, z: -1950 }, "paving", -7.65, true, true],
  ["east-road sidewalk", { x: 2138, z: 430 }, "paving", -7.65, true, true],
  // parking and its paths
  ["parking aisle", { x: -532, z: 700 }, "asphalt", -7.95, true, true],
  ["empty stall", { x: -637, z: 566 }, "asphalt", -7.95, true, true],
  ["park drive", { x: -532, z: 1300 }, "asphalt", -7.95, true, true],
  ["mid-lot park path", { x: -250, z: 642 }, "paving", -7.65, true, true],
  ["park → building link", { x: -110, z: 610 }, "paving", -7.65, true, true],
  // grass
  ["east lawn", { x: 1800, z: 800 }, "lawn", -8, true, true],
  ["lawn west of the Lab", { x: 100, z: -400 }, "lawn", -8, true, true],
  // the AI Lab's exterior: causeways (paving 0.4 on a 0.2 stone rim), terrace, lakeside deck
  ["PATH_LINK causeway", { x: 1456, z: -150 }, "deck", 0.4, true, true],
  ["PATH_W causeway", { x: 1100, z: -268 }, "deck", 0.4, true, true],
  ["Lab terrace, west", { x: 66, z: -700 }, "deck", 0.2, true, true],
  ["lakeside terrace", { x: 740, z: -1000 }, "deck", 0.4, true, true],
  ["lake steps", { x: 740, z: -1061 }, "stair", -2.94, true, false],
  ["pond path, below the steps", { x: 740, z: -1102 }, "paving", -7.65, true, true],
  // not exterior ground, or not traversable
  ["Lab porch (threshold)", { x: 740, z: -400 }, "lab-interior", 0.75, false, false],
  ["Lab hall", { x: 740, z: -800 }, "lab-interior", 0.75, false, false],
  ["pond water", { x: 740, z: -1300 }, "water", -7.45, false, false],
  ["planting bed (soil between its shrubs)", { x: -147, z: 365 }, "bed", -7.5, true, true],
  ["car-park screen hedge", { x: -734, z: 700 }, "hedge", -7.5, false, false],
  ["car-park island (kerbed lawn, beside its tree)", { x: islandCentre(PARK_ISLANDS[0]).x + 14, z: islandCentre(PARK_ISLANDS[0]).z }, "island", -4.55, true, false],
];

describe("exterior ground — labelled points", () => {
  it.each(ROWS)("%s", (_n, p, kind, y, walk, ride) => {
    const g = G.groundAt(p);
    expect(g.kind).toBe(kind);
    expect(g.y).toBeCloseTo(y, 2);
    expect(g.inCampus).toBe(true);
    expect(G.canOccupy(p, R, WALK_PROFILE)).toBe(walk);
    expect(G.canOccupy(p, R, RIDE_PROFILE)).toBe(ride);
  });

  it("PHASE 3B — the streets are ground: carriageways, kerbs and the far sidewalks, all four roads", () => {
    for (const p of [{ x: 300, z: 1640 }, { x: -948, z: 600 }, { x: 2288, z: 600 }, { x: 600, z: -2100 }]) {
      expect(G.groundAt(p).kind).toBe("road");
      expect(G.groundAt(p).y).toBeCloseTo(-9.6, 2);
      expect(G.inCampus(p)).toBe(false); // off the Offshorly lot — and walkable all the same
      expect(G.canOccupy(p, F, WALK_PROFILE)).toBe(true);
    }
    const far = { x: 300, z: 1770 };
    expect(G.groundAt(far).kind).toBe("paving");
    expect(G.canOccupy(far, F, WALK_PROFILE)).toBe(true);
    // the kerb is a step, not a wall: sidewalk −7.65 → curb band −7.9 → carriageway −9.6
    for (let z = 1490; z <= 1540; z += 1) expect(G.canOccupy({ x: 300, z }, F, WALK_PROFILE), `z ${z}`).toBe(true);
  });
  it("PHASE 3B — the other lots, the open country between them and the north fields are ground", () => {
    for (const [p, kind] of [[{ x: 2600, z: -600 }, "lawn"], [{ x: -1800, z: 300 }, "lawn"], [{ x: 700, z: 2100 }, "lawn"], [{ x: 700, z: -2800 }, "lawn"], [{ x: 3500, z: 2200 }, "terrain"]] as const) {
      expect(G.groundAt(p).kind, JSON.stringify(p)).toBe(kind);
      expect(G.canOccupy(p, F, WALK_PROFILE), JSON.stringify(p)).toBe(true);
    }
  });

  it("water is water, and the pond has a walkable shore somewhere round it", () => {
    expect(G.isWater({ x: POND.x, z: POND.z })).toBe(true);
    expect(G.occupancy({ x: POND.x, z: POND.z }, R, WALK_PROFILE)).toMatchObject({ ok: false, reason: "surface" });
    let shoreOk = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      for (let k = 1.0; k < 1.1; k += 0.01) {
        const p = { x: POND.x + Math.cos(a) * POND.rx * k, z: POND.z + Math.sin(a) * POND.rz * k };
        if (G.groundAt(p).kind === "shore" && G.canOccupy(p, R, WALK_PROFILE)) shoreOk++;
      }
    }
    expect(shoreOk).toBeGreaterThan(20);
  });

  it("a footprint straddling an edge taller than the step is refused (the cliff model)", () => {
    // the Lab's causeway stands 8.2 over the lawn: standing across its edge is a step failure
    expect(G.occupancy({ x: 1100, z: -300 }, R, WALK_PROFILE)).toMatchObject({ ok: false, reason: "step" });
    // …but the entry flight's every riser is a step (~1.5), all the way down to the drop-off
    for (let z = 1240; z <= 1330; z += 2) expect(G.canOccupy({ x: 707, z }, R, WALK_PROFILE), `z ${z}`).toBe(true);
    // …and so is the lake flight, from the lakeside deck down to the pond path
    for (let z = -1040; z >= -1100; z -= 2) expect(G.canOccupy({ x: 740, z }, R, WALK_PROFILE), `z ${z}`).toBe(true);
    // the podium's two steps (3.2 sidewalk → ledge, 4.65 ledge → walk) are each a single walkable step…
    expect(G.canOccupy({ x: 300, z: 1238 }, R, WALK_PROFILE)).toBe(true);
    expect(G.canOccupy({ x: -48, z: 600 }, R, WALK_PROFILE)).toBe(true);
    // …and neither is rideable
    expect(G.occupancy({ x: 300, z: 1238 }, R, RIDE_PROFILE)).toMatchObject({ ok: false, reason: "step" });
    expect(G.occupancy({ x: -48, z: 600 }, R, RIDE_PROFILE)).toMatchObject({ ok: false, reason: "step" });
  });
});

describe("exterior ground — solids", () => {
  const trees = campusTrees();
  const firstGroveTree = trees.broad[0];
  const lamp = streetLightSpots().find((l) => l.z === 1470 && l.x > 0)!;
  const car = VEHICLES.find((v) => v.kind === "sport")!;
  const bench = benchSpots()[0];
  const cases: [string, Vec2, string][] = [
    ["a street tree / grove trunk", firstGroveTree, "tree:"],
    ["a street lamp", lamp, "lamp:"],
    ["a path bollard", { x: -110, z: 700 }, "bollard:"],
    ["a parked car", car, "vehicle:"],
    ["a lay-by jeepney", VEHICLES.find((v) => v.kind === "jeepney")!, "vehicle:jeepney"],
    ["a bench", bench, "bench:"],
    ["the monument sign", { x: 277, z: 1338 }, "monument-sign"],
    ["a docked Reception scooter", { x: 1156, z: 1183 }, "scooter:"],
    ["the Lab's east wall", { x: 1380, z: -700 }, "lab-wall:"],
    ["a Lab terrace shrub", { x: 590, z: -404 }, "lab-shrub:"],
    // EXTERIOR POLISH: the construction site's fence and scaffold (world/construction)
    ["the construction yard's fence", { x: 540, z: -320 }, "site:ai-lab:fence"],
    ["the scaffold against the Lab's south wall", { x: 480, z: -425 }, "site:ai-lab:scaffold"],
  ];
  // EXTERIOR POLISH: the corner beds are clipped to the inside of their diagonal walls — nothing of them
  // stands on the terrace any more
  it("leaves the terrace clear where a corner bed used to poke through the wall", () => {
    expect(G.solids.some((s) => s.id.startsWith("lab-corner-bed:"))).toBe(false);
    expect(G.solidAt({ x: CORNER_TREES[0].x - 30, z: CORNER_TREES[0].z - 26 }, 1)).toBeNull();
  });
  it.each(cases)("%s stops a footprint", (_n, p, prefix) => {
    expect(G.solidAt(p, R)).not.toBeNull();
    // (a bench or sign may stand among shrubs: the one expected must be among what overlaps)
    expect(G.solids.filter((s) => solidOverlaps(s, p, R)).some((s) => s.id.startsWith(prefix)), prefix).toBe(true);
  });
  it("open ground a little way off each solid is clear", () => {
    expect(G.solidAt({ x: lamp.x + 30, z: lamp.z }, R)).toBeNull();
    expect(G.solidAt({ x: -532, z: 700 }, R)).toBeNull();
  });
  it("stays a small, bucketed set — not hundreds of per-object meshes", () => {
    const st = (G as ReturnType<typeof buildExteriorGround>).stats();
    expect(st.solids).toBeLessThan(600);
    expect(st.maxSolidsPerBucket).toBeLessThan(40);
    expect(st.maxSurfacesPerBucket).toBeLessThan(30);
  });
});

describe("exterior ground — boundary", () => {
  it("the campus is the Offshorly lot, and its edges are the four streets' kerbs", () => {
    const b = G.bounds;
    expect(b).toEqual(OFFSHORLY_LOT.rect);
    expect(b.x).toBe(roadEdge(roadById("road-west"), 1));
    expect(b.x + b.w).toBe(roadEdge(roadById("road-east"), -1));
    expect(b.z).toBe(roadEdge(roadById("road-north"), 1));
    expect(b.z + b.d).toBe(roadEdge(roadById("road-main"), -1));
    // one unit either side of each kerb
    expect(G.inCampus({ x: b.x + 1, z: 0 })).toBe(true);
    expect(G.inCampus({ x: b.x - 1, z: 0 })).toBe(false);
    expect(G.inCampus({ x: 0, z: b.z + b.d + 1 })).toBe(false);
  });
  it("PHASE 3B — the walkable world ends at the inner edge of the distant tree belt, a circle about the world centre", () => {
    expect(inWalkableWorld({ x: WORLD_WALK.x + WORLD_WALK.r - 1, z: WORLD_WALK.z })).toBe(true);
    const beyond = { x: WORLD_WALK.x + WORLD_WALK.r + 10, z: WORLD_WALK.z };
    expect(G.occupancy(beyond, F, WALK_PROFILE)).toMatchObject({ ok: false, reason: "outside" });
    expect(WORLD_WALK.r).toBeLessThan(4000 - 150); // inside the belt's inner edge (build/exterior)
    // floor 2's plate stands far beyond it
    expect(inWalkableWorld({ x: FLOOR2_OUTER.x, z: FLOOR2_OUTER.z + FLOOR2_OUTER.d / 2 })).toBe(false);
  });
  it("PHASE 4 — the Championship Cave's sealed volume is off the walkable world; the east parcel is open ground", () => {
    expect(inWalkableWorld({ x: CAVE_OUTER.x, z: CAVE_OUTER.z })).toBe(false);
    expect(inWalkableWorld({ x: CAVE_OUTER.x + CAVE_OUTER.w, z: CAVE_OUTER.z + CAVE_OUTER.d })).toBe(false);
    expect(G.solids.some((s) => s.id === "cave-shell")).toBe(false);
    expect(G.canOccupy({ x: 2700, z: 560 }, F, WALK_PROFILE)).toBe(true); // where its invisible shell stood
  });
  it("the painted crossings sit on carriageways outside the campus (crossings stay a later phase)", () => {
    for (const c of CROSSINGS) {
      const r = roadById(c.roadId);
      const p = r.axis === "x" ? { x: c.at, z: r.at } : { x: r.at, z: c.at };
      expect(G.inCampus(p)).toBe(false);
    }
  });
});

describe("exterior ground — profiles", () => {
  it("RIDE is a strict subset of WALK", () => {
    for (const k of RIDE_PROFILE.allows) expect(WALK_PROFILE.allows.has(k)).toBe(true);
    for (const k of RIDE_PROFILE.slow) expect(RIDE_PROFILE.allows.has(k)).toBe(true);
    expect(RIDE_PROFILE.stepMax).toBeLessThan(WALK_PROFILE.stepMax);
    expect(RIDE_PROFILE.allows.has("stair")).toBe(false);
    expect(RIDE_PROFILE.slow.has("lawn")).toBe(true);
    for (const k of ["water", "hedge", "building", "lab-interior"] as SurfaceKind[]) {
      expect(WALK_PROFILE.allows.has(k)).toBe(false);
      expect(RIDE_PROFILE.allows.has(k)).toBe(false);
    }
    // Phase 4 decides what a scooter may ride; for now it keeps the Phase 1 set
    for (const k of ["road", "kerb", "terrain", "bed", "island"] as SurfaceKind[]) expect(WALK_PROFILE.allows.has(k)).toBe(true);
  });
  it("every ride-valid footprint is walk-valid (20k deterministic samples over the campus)", () => {
    let seed = 7, rideOk = 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const b = G.bounds;
    for (let i = 0; i < 20000; i++) {
      const p = { x: b.x + rnd() * b.w, z: b.z + rnd() * b.d };
      if (G.canOccupy(p, R, RIDE_PROFILE)) { rideOk++; expect(G.canOccupy(p, R, WALK_PROFILE)).toBe(true); }
    }
    expect(rideOk).toBeGreaterThan(5000);
  });
});

describe("exterior ground — connectivity on foot (what free roam will open)", () => {
  // flood fill over a 12-unit lattice of WALK-occupiable points, 4-connected, from the Reception frontage
  // the whole walkable world, on the live WALK footprint
  const STEP = 12, b = { x: WORLD_WALK.x - WORLD_WALK.r, z: WORLD_WALK.z - WORLD_WALK.r, w: 2 * WORLD_WALK.r, d: 2 * WORLD_WALK.r };
  const cols = Math.floor(b.w / STEP), rows = Math.floor(b.d / STEP);
  const at = (i: number, j: number) => ({ x: b.x + (i + 0.5) * STEP, z: b.z + (j + 0.5) * STEP });
  const cell = (p: Vec2) => [Math.floor((p.x - b.x) / STEP), Math.floor((p.z - b.z) / STEP)] as const;
  const seen = new Uint8Array(cols * rows);
  const ok = (i: number, j: number) => G.canOccupy(at(i, j), F, WALK_PROFILE);
  const [si, sj] = cell({ x: 720, z: 1216 });
  const q: number[] = [sj * cols + si];
  seen[q[0]] = 1;
  while (q.length) {
    const k = q.pop()!, i = k % cols, j = (k - i) / cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, nk = nj * cols + ni;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows || seen[nk]) continue;
      // an edge is walkable only if the half-way point is too, so a single lattice step never skips a wall
      const mid = { x: (at(i, j).x + at(ni, nj).x) / 2, z: (at(i, j).z + at(ni, nj).z) / 2 };
      if (!ok(ni, nj) || !G.canOccupy(mid, F, WALK_PROFILE)) continue;
      seen[nk] = 1;
      q.push(nk);
    }
  }
  const reached = (p: Vec2) => { const [i, j] = cell(p); return seen[j * cols + i] === 1; };
  it.each([
    ["the parking aisle", { x: -532, z: 700 }],
    ["the mid-lot park path", { x: -250, z: 642 }],
    ["the lay-by walk", { x: 600, z: 1396 }],
    ["all four street sidewalks", { x: 100, z: 1470 }],
    ["…west", { x: -798, z: 430 }],
    ["…north", { x: 430, z: -1950 }],
    ["…east", { x: 2138, z: 430 }],
    ["every side of the office", { x: 500, z: -80 }],
    ["the east lawn", { x: 1800, z: 800 }],
    ["the AI Lab causeway (via PATH_LINK)", { x: 1100, z: -268 }],
    ["the pond path (across the lawn)", { x: 740, z: -1102 }],
    // PHASE 3B — across the streets
    ["road-main's carriageway", { x: 300, z: 1640 }],
    ["road-main's far sidewalk", { x: 300, z: 1770 }],
    ["the south parcel", { x: 700, z: 2100 }],
    ["the east parcel", { x: 3000, z: -600 }],
    ["where the Cave's invisible shell stood", { x: 2700, z: 560 }],
    ["the west parcel", { x: -1800, z: 300 }],
    ["the north fields", { x: 700, z: -2800 }],
    ["open country beyond the parcels", { x: 3500, z: 2200 }],
    ["the west-main road corner", { x: -948, z: 1620 }],
    ["the east-north road corner", { x: 2288, z: -2100 }],
  ])("reaches %s", (_n, p) => expect(reached(p)).toBe(true));
  // PHASE 3: the lake steps are the terrace's walking way from the lawn — up from the pond path onto the
  // lakeside deck, and round the Lab's terrace ring (its every other edge is still the plinth's 8.2 face)
  it.each([
    ["the lakeside terrace (up the lake steps)", { x: 740, z: -1000 }],
    ["the terrace ring's north run, past the pond benches", { x: 480, z: -1016 }],
  ])("reaches %s", (_n, p) => expect(reached(p)).toBe(true));
  // …AND, SINCE THE EXTERIOR POLISH, ALL THE WAY ROUND: the corner beds are clipped inside their diagonal
  // walls, the two shrubs that hung off the plinth's north corners are gone and the grove trunks that stood
  // on the stone are stepped off it, so the terrace ring is continuous
  it("passes round the Lab's corners to the west run", () => {
    expect(G.canOccupy({ x: 66, z: -700 }, R, WALK_PROFILE)).toBe(true);
    expect(reached({ x: 66, z: -700 })).toBe(true);
  });
  // PHASE 3: the Lab rack lies ALONG the rear path, its rail on the path's north edge — no longer across it
  it("reaches the walk in to the Lab past the Lab rack (rail along the path's edge)", () => {
    expect(G.solidAt({ x: 814, z: -270 }, R)).toBeNull();
    expect(G.solidAt({ x: 833, z: -297 }, 1)).toBe("rack:lab");
    expect(reached({ x: 736, z: -300 })).toBe(true);
  });
});

describe("exterior ground — data authority", () => {
  it("the trees the ground reads are exactly the instances the builder draws", async () => {
    const { buildExterior } = await import("./build/exterior");
    const root = buildExterior().root;
    const planted = campusTrees();
    const all = Object.values(planted).flat();
    // EXTERIOR POLISH: every tree is one instance in the trunk batch (and one in the crown batch)
    const trunks = root.getObjectByName("trees-trunks") as THREE.BatchedMesh;
    expect(trunks.instanceCount).toBe(all.length);
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    const order = (["round", "tall", "broad", "conifer"] as const).flatMap((k) => planted[k]);
    order.forEach((s, i) => {
      trunks.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      expect(v.x).toBeCloseTo(s.x, 3); // the instance matrix is Float32
      expect(v.z).toBeCloseTo(s.z, 3);
    });
    expect(exteriorSolids().filter((s) => s.kind === "tree").length).toBe(all.length);
  });
  it("no trunk stands in a paved path, on the Lab's plinth or in a construction yard", () => {
    for (const t of Object.values(campusTrees()).flat()) {
      if (t.y !== undefined) continue;
      const g = G.groundAt(t);
      if (g.kind === "bed") continue; // the entry specimens stand in their beds
      expect(["lawn", "terrain", "shore"], `${t.x},${t.z} on ${g.id}`).toContain(g.kind);
    }
  });
  it("the approved tree layout is pinned (count and positional checksum)", () => {
    const all = Object.values(campusTreeSpots().spots).flat();
    expect(all.length).toBe(TREE_COUNT);
    expect(Math.round(all.reduce((a, t) => a + t.x * 3 + t.z * 7 + t.s * 11, 0))).toBe(TREE_CHECKSUM);
  });
  it("each vehicle kind's footprint matches its real geometry", async () => {
    const { vehicleGeos } = await import("./build/vehicles");
    for (const k of Object.keys(VEHICLE_BOUNDS) as VehicleKind[]) {
      const g = vehicleGeos(k), box = new THREE.Box3();
      for (const part of [g.paint, g.gloss, g.matte, g.lights]) if (part.attributes.position) { part.computeBoundingBox(); box.union(part.boundingBox!); }
      const vb = VEHICLE_BOUNDS[k];
      expect(box.min.x).toBeCloseTo(vb.x0, 0); expect(box.max.x).toBeCloseTo(vb.x1, 0);
      expect(box.min.z).toBeCloseTo(vb.z0, 0); expect(box.max.z).toBeCloseTo(vb.z1, 0);
    }
  });
  it("the façade wall and podium ledge constants are the builders' own", async () => {
    const { groundFloor } = await import("./rooms/ground-floor");
    expect(groundFloor().shell.wallThickness).toBe(FACADE_WALL_T);
    expect(PODIUM_LEDGE_Y).toBe(-3);
  });
  it("PHASE 4 — the ramps are built ground: each a smooth slope from end to end, sunk into what it crosses, clear of solids", () => {
    for (const r of RAMPS) {
      const s = G.surfaces.find((x) => x.id === `ramp:${r.id}`)!;
      const len = r.axis === "x" ? r.rect.w : r.rect.d;
      const at = (t: number) => (r.axis === "x" ? { x: r.rect.x + t, z: r.rect.z + r.rect.d / 2 } : { x: r.rect.x + r.rect.w / 2, z: r.rect.z + t });
      expect(surfaceY(s, at(0))).toBeCloseTo(r.fromY, 5);
      expect(surfaceY(s, at(len))).toBeCloseTo(r.toY, 5);
      expect(G.groundAt(at(len / 2)).kind, r.id).toBe("ramp");
      expect(G.groundAt(at(len / 2)).y).toBeCloseTo((r.fromY + r.toY) / 2, 3);
      for (let t = 0; t <= len; t += 6) expect(G.solidAt(at(t), 4), `${r.id} @ ${t}`).toBeNull();
    }
  });
});

/** KNOWN, REPORTED deviations of the drawn surface from the ground model (drawn − model), pinned so they cannot grow
 *  unnoticed. Phase 6B.8 (first raycast against the V2 Lab): the V2 Lab draws its stone, deck and soil 0.31–0.50
 *  above the ground model the exterior still shares with the V1-era Lab constants (world/ailab), so a walker on the
 *  Lab's causeways, terrace and lakeside deck, and inside the hall, stands that far into the drawn surface — the
 *  "sinking" on the 6B regression list. Pre-existing since V2 became the default (6B.1); a ground-model change is
 *  its own task (it moves walking and scooter heights). */
const KNOWN_DRAWN_OFFSET: Record<string, number> = {
  "PATH_LINK causeway": 0.35, "PATH_W causeway": 0.35, "Lab terrace, west": 0.5, "lakeside terrace": 0.41, "Lab hall": 0.307,
};
describe("exterior ground — heights match the built geometry (raycast)", () => {
  it("every labelled point's height is the drawn one", async () => {
    const [{ buildExterior }, { buildAiLabV2 }, { buildGroundFloor }, { groundFloor }, { scooterStations }, { v1Sidewalk }] = await Promise.all([
      import("./build/exterior"), import("./build/ailabV2"), import("./build/floorplan"), import("./rooms/ground-floor"), import("./world/scooters"), import("./adapters/v1Floor"),
    ]);
    // the V2 Lab paints its screen atlas on a 2D canvas, which jsdom lacks: a no-op context (this test reads geometry
    // only), restored straight after the build
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const realGetContext = proto.getContext;
    const noop: object = new Proxy(() => noop, { get: (_t, k) => (k === "canvas" ? undefined : noop), set: () => true, apply: () => noop });
    proto.getContext = () => noop;
    const scene = new THREE.Group();
    try {
      scene.add(buildExterior({ scooterStations: scooterStations(v1Sidewalk()) }).root, buildAiLabV2().group, buildGroundFloor(groundFloor()));
    } finally { proto.getContext = realGetContext; }
    scene.updateMatrixWorld(true);
    // ground is opaque, non-instanced geometry: instanced/batched meshes are trees, posts and vehicles,
    // and depthWrite-off planes are decals (the Lab's painted brand floor)
    const meshes: THREE.Object3D[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !(o as unknown as { isBatchedMesh?: boolean }).isBatchedMesh && (m.material as THREE.Material).depthWrite !== false) meshes.push(o);
    });
    const rc = new THREE.Raycaster();
    const extra: Row[] = [["pond water (north)", { x: 740, z: -1200 }, "water", -7.45, false, false], ["road", { x: 300, z: 1620 }, "road", -9.6, false, false]];
    for (const [name, p] of [...ROWS, ...extra]) {
      rc.set(new THREE.Vector3(p.x, 300, p.z), new THREE.Vector3(0, -1, 0));
      const hit = rc.intersectObjects(meshes, false).find((h) => h.point.y < 5)!;
      // a hair of paint (centre lines, stall lines) may sit on the surface
      const known = KNOWN_DRAWN_OFFSET[name];
      if (known !== undefined) { expect(Math.abs(hit.point.y - G.groundAt(p).y - known), `${name} (known offset ${known})`).toBeLessThan(0.02); continue; }
      expect(Math.abs(hit.point.y - G.groundAt(p).y), name).toBeLessThan(0.21);
    }
  }, 30000); // it builds the exterior, the Lab and the ground floor
});

// pinned from the approved layout (checkpoint e0f1c06); any change to the scatter or its inputs moves these
const TREE_COUNT = 220;
const TREE_CHECKSUM = -183987; // the approved V2 grove layout (Phase 3)
