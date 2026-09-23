// vo3d — THE AI LAB's placement and its walking route.
//
// The Lab stands OFF-GRID (world/ailab explains why), so none of the office's own navigation tests can
// say anything about it. What has to be locked instead is exactly three things:
//
//   1. it takes nothing away from the existing world — no overlap with the office, the podium or the pond
//   2. the route from the V1 sidewalk to the Lab floor is CONTINUOUS, with no point on it where both the
//      office's test and the Lab's test say no
//   3. the Lab's own furniture and walls genuinely stop a body
import { describe, expect, it } from "vitest";
import {
  APRON, ENTRY_X0, ENTRY_X1, HALL, HUB, LAB_ARRIVAL, LAB_OUTER, LAKE_SPUR, LAKE_TERRACE, LEG_N,
  INTERIOR_POTS, PATH_IN, PATH_LINK, PATH_W, PERIMETER_POTS, PORCH, SOUTH_BAY, WALK, WALL_SEGS, ZONES,
  aiLabStandTest, inAiLabZone,
} from "./world/ailab";
import { GROVES, POND, POND_SHORE, PODIUM } from "./world/campus";
import { FRAME } from "./adapters/v1Floor";
import { NAV_RADIUS } from "./nav/clearance";
import { CELL, v1Static, worldToCell } from "./adapters/v1Grid";
import type { Rect, Vec2 } from "./core/coords";

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;

/** inside the pond's water line plus its shore band — the one thing the route must never cross */
const inWater = (p: Vec2): boolean =>
  ((p.x - POND.x) / (POND.rx + POND_SHORE)) ** 2 + ((p.z - POND.z) / (POND.rz + POND_SHORE)) ** 2 <= 1;

describe("AI Lab — placement is purely additive", () => {
  it("stands clear of the office frame and its podium", () => {
    expect(overlaps(LAB_OUTER, FRAME)).toBe(false);
    expect(overlaps(LAB_OUTER, PODIUM)).toBe(false);
    // and north of the podium, which is the whole point of it being "behind the office"
    expect(LAB_OUTER.z + LAB_OUTER.d).toBeLessThan(PODIUM.z);
  });

  it("puts the lake BEHIND the Lab, not between it and the office", () => {
    // the composition is OFFICE → LAB → LAKE, so the lake's south shore has to be north of the Lab's
    // north face, and the Lab has to sit between the office and the water on the same centre line
    expect(POND.z + POND.rz + POND_SHORE).toBeLessThan(LAB_OUTER.z);
    expect(LAB_OUTER.z + LAB_OUTER.d).toBeLessThan(PODIUM.z);
    // and it is a LAKE now, not the old ornamental pond
    expect(POND.rx * 2).toBeGreaterThan(1000);
  });

  it("stands clear of the water, and so does every walkable rect", () => {
    for (const r of WALK)
      for (let x = r.x; x <= r.x + r.w; x += 8)
        for (let z = r.z; z <= r.z + r.d; z += 8)
          expect({ x, z, wet: inWater({ x, z }) }).toEqual({ x, z, wet: false });
  });

  it("clears the campus path bollards the approach walk was sized around", () => {
    expect(PATH_W.x + PATH_W.w).toBeLessThanOrEqual(1488); // the podium edge; the bollards run down x 1518
  });

  it("is screened by planting that leaves the entrance as its one opening", () => {
    const w = GROVES.find((g) => g.id === "grove-lab-screen-west")!;
    const e = GROVES.find((g) => g.id === "grove-lab-screen-east")!;
    // the two halves of the lab screen must leave a real gap, and the entrance must be in it
    const gap0 = w.x + w.rx, gap1 = e.x - e.rx;
    expect(gap1 - gap0).toBeGreaterThan(120);
    expect(ENTRY_X0).toBeGreaterThanOrEqual(gap0);
    expect(ENTRY_X1).toBeLessThanOrEqual(gap1);
    // and the screen stands clear of the plate rather than on it
    expect(w.z + w.rz).toBeGreaterThan(LAB_OUTER.z + LAB_OUTER.d - 40);
    // the flanks and the rear screen exist, so the Lab is hidden from the office's own back face
    for (const id of ["grove-lab-flank-west", "grove-lab-flank-east", "grove-rear-west", "grove-rear-east"])
      expect(GROVES.some((g) => g.id === id), id).toBe(true);
  });
});

describe("AI Lab — the route is continuous", () => {
  it("the apron overlaps the V1 sidewalk's own walkable cells", () => {
    // rows 75-76 of the read-only V1 grid are the sidewalk; the apron has to share ground with them or
    // there is nothing for a body to step across
    let shared = 0;
    for (let x = APRON.x; x < APRON.x + APRON.w; x += CELL / 2)
      for (let z = APRON.z; z < APRON.z + APRON.d; z += CELL / 2) {
        const c = worldToCell({ x, z });
        if (v1Static(c.cx, c.cy)) shared++;
      }
    expect(shared).toBeGreaterThan(0);
  });

  it("hands over before the office's test would refuse, in both directions", () => {
    // the V1 sidewalk's east-most walkable column is 88 (x 1408…1424). Anywhere the Lab claims
    // authority it must also be able to HOLD a body — a zone that says yes and a stand test that says
    // no is exactly the seam bug this pair of predicates exists to prevent.
    for (let x = 1380; x <= 1560; x += 2)
      for (let z = 1204; z <= 1236; z += 2) {
        const p = { x, z };
        if (inAiLabZone(p, NAV_RADIUS)) expect(aiLabStandTest(p, NAV_RADIUS)).toBe(true);
      }
  });

  it("a body can walk the whole way from the sidewalk seam to the Lab floor", () => {
    // the whole journey: out of the office at the south-east corner, round the back, into the Lab
    const legs: [Vec2, Vec2][] = [
      [{ x: 1420, z: 1220 }, { x: 1476, z: 1220 }], // east onto the walk
      [{ x: 1476, z: 1220 }, { x: 1476, z: -254 }], // north up the office's east flank
      [{ x: 1476, z: -254 }, { x: 736, z: -254 }], // west across the rear campus
      [{ x: 736, z: -254 }, LAB_ARRIVAL], // north up the entrance steps onto the porch
      [LAB_ARRIVAL, { x: 740, z: -480 }], // in through the entrance gap between the two work islands
      [{ x: 740, z: -480 }, { x: 630, z: -480 }], // west along the south bay
      [{ x: 630, z: -480 }, { x: 630, z: -700 }], // north up the west lane, island to the right
      [{ x: 630, z: -700 }, { x: 700, z: -740 }], // across the back of the west zone
      [{ x: 700, z: -740 }, { x: 740, z: -900 }], // up the centre behind the island
      [{ x: 740, z: -900 }, { x: 740, z: -1010 }], // out through the north opening to the lake terrace
    ];
    for (const [a, b] of legs) {
      const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
      for (let i = 0; i <= n; i++) {
        const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
        // THE COMPOSED ANSWER, which is what bootstrap actually asks. Testing the stand test alone
        // hides the seam bug that matters: a point the Lab does not CLAIM (inAiLabZone false) falls
        // through to the office's test, which knows nothing about this ground and refuses it. Two legs
        // that merely touch leave exactly such a hole between their insets.
        const ok = inAiLabZone(p, NAV_RADIUS) && aiLabStandTest(p, NAV_RADIUS);
        expect({ p, ok }).toEqual({ p, ok: true });
      }
    }
  });

  it("every pair of adjoining legs overlaps by more than a body, so no inset hole opens", () => {
    // the failure mode this locks: leg A ends where leg B begins, both insets pull back by NAV_RADIUS,
    // and a 2 x NAV_RADIUS band between them belongs to neither predicate
    const chain: [Rect, Rect][] = [[APRON, LEG_N], [LEG_N, PATH_LINK], [PATH_LINK, PATH_W], [PATH_W, PATH_IN],
      [PATH_IN, PORCH], [PORCH, SOUTH_BAY], [SOUTH_BAY, HALL], [HALL, LAKE_SPUR], [LAKE_SPUR, LAKE_TERRACE]];
    for (const [a, c] of chain) {
      const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
      const oz = Math.min(a.z + a.d, c.z + c.d) - Math.max(a.z, c.z);
      expect({ ox, oz }).toEqual({ ox: expect.any(Number), oz: expect.any(Number) });
      expect(Math.min(ox, oz)).toBeGreaterThan(2 * NAV_RADIUS);
    }
  });

  it("can walk up to every agent's station", () => {
    // a probe immediately behind each agent, on the side away from its desk. If this fails the agent has
    // been walled in by its own zone's furniture.
    for (const zone of ZONES)
      for (const s of zone.slots) {
        // opsRobot's visor is its local -z, so `rotation.y = yaw` points it at (-sin, -cos).
        // BEHIND an agent is therefore (+sin, +cos) — getting this sign backwards puts the probe inside
        // the desk the agent is working at and makes every station look walled in.
        const probe = { x: s.x + Math.sin(s.yaw) * 34, z: s.z + Math.cos(s.yaw) * 34 };
        expect({ z: zone.id, a: s.agent, ok: aiLabStandTest(probe, NAV_RADIUS) }).toEqual({ z: zone.id, a: s.agent, ok: true });
      }
  });
});

describe("AI Lab — its own geometry stops a body", () => {
  it("refuses every desk, agent, partition, planter and the central island", () => {
    const centre = (r: Rect) => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });
    for (const zone of ZONES) {
      for (const st of zone.stations) expect({ z: zone.id, ok: aiLabStandTest(centre(st.rect), NAV_RADIUS) }).toEqual({ z: zone.id, ok: false });
      for (const s of zone.slots) expect({ z: zone.id, ok: aiLabStandTest({ x: s.x, z: s.z }, NAV_RADIUS) }).toEqual({ z: zone.id, ok: false });
      if (zone.partition) expect({ z: zone.id, ok: aiLabStandTest(centre(zone.partition), NAV_RADIUS) }).toEqual({ z: zone.id, ok: false });
      for (const c of zone.consoles) expect(aiLabStandTest(centre(c), NAV_RADIUS)).toBe(false);
      for (const p of zone.planters) expect(aiLabStandTest(centre(p), NAV_RADIUS)).toBe(false);
      for (const t of zone.tables) expect(aiLabStandTest({ x: t.x, z: t.z }, NAV_RADIUS)).toBe(false);
    }
    for (const p of INTERIOR_POTS) expect(aiLabStandTest(centre(p), NAV_RADIUS)).toBe(false);
    expect(aiLabStandTest({ x: HUB.x, z: HUB.z }, NAV_RADIUS)).toBe(false); // the central island
    expect(aiLabStandTest({ x: HUB.x + HUB.r - 4, z: HUB.z }, NAV_RADIUS)).toBe(false); // and its rim
    for (const p of PERIMETER_POTS) expect(aiLabStandTest(centre(p), NAV_RADIUS)).toBe(false);
  });

  it("leaves circulation all the way round the central hub", () => {
    // the reference's whole plan depends on the island being an island: eight points on a ring just
    // outside it must all hold a body, or the room is really two rooms
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const p = { x: HUB.x + Math.cos(a) * (HUB.r + 34), z: HUB.z + Math.sin(a) * (HUB.r + 34) };
      expect({ i, ok: aiLabStandTest(p, NAV_RADIUS) }).toEqual({ i, ok: true });
    }
  });

  it("can reach the lakeside terrace through the north opening", () => {
    expect(aiLabStandTest({ x: 740, z: -990 }, NAV_RADIUS)).toBe(true);
    expect(aiLabStandTest({ x: 700, z: -1010 }, NAV_RADIUS)).toBe(true);
  });

  it("refuses everything outside the perimeter wall", () => {
    const out: Vec2[] = [
      { x: LAB_OUTER.x - 20, z: -700 }, // west of the wall
      { x: LAB_OUTER.x + LAB_OUTER.w + 20, z: -700 }, // east of it
      { x: 500, z: LAB_OUTER.z - 20 }, // north of the wall, away from the lake opening
      { x: 400, z: LAB_OUTER.z + LAB_OUTER.d + 20 }, // south of it, away from the entrance
      { x: POND.x, z: POND.z }, // out in the middle of the lake
    ];
    for (const p of out) expect({ p, ok: aiLabStandTest(p, NAV_RADIUS) }).toEqual({ p, ok: false });
  });

  it("holds a body just inside the wall line but not through it", () => {
    expect(aiLabStandTest({ x: 740, z: HALL.z + NAV_RADIUS }, NAV_RADIUS)).toBe(true);
    expect(aiLabStandTest({ x: 500, z: HALL.z - 32 }, NAV_RADIUS)).toBe(false);
  });

  it("keeps the whole walkable floor inside the wall polygon", () => {
    // the perimeter is CHAMFERED and the walkable rects are inscribed in it by hand. If a rect ever
    // grows past a corner cut, a body walks out through the wall — so every walkable point inside the
    // room must sit on the inner side of all ten segments.
    const room = [HALL, SOUTH_BAY];
    for (const r of room)
      for (let x = r.x; x <= r.x + r.w; x += 10)
        for (let z = r.z; z <= r.z + r.d; z += 10) {
          let inside = false;
          for (const [a, c] of [...WALL_SEGS, [WALL_SEGS[WALL_SEGS.length - 1][1], WALL_SEGS[0][0]] as const])
            if ((a.z > z) !== (c.z > z) && x < a.x + ((c.x - a.x) * (z - a.z)) / (c.z - a.z)) inside = !inside;
          expect({ x, z, inside }).toEqual({ x, z, inside: true });
        }
  });
});

describe("AI Lab — the cost budget", () => {
  it("draws as a handful of merged meshes, casts no shadow, and adds no light", async () => {
    const { buildAiLab } = await import("./build/ailab");
    const lab = buildAiLab();

    let meshes = 0, casters = 0, lights = 0;
    lab.group.traverse((o) => {
      const q = o as unknown as { isMesh?: boolean; isLight?: boolean };
      if (q.isMesh) meshes++;
      if (o.castShadow || o.receiveShadow) casters++;
      if (q.isLight) lights++;
    });

    // THE WHOLE POINT OF Baker. The office frame is draw-call bound (~9,900 calls), so the Lab is
    // merged to one mesh per material; only the three status-tinted agents and the four labels, which
    // each carry a material or texture of their own, are allowed to stand outside the bake.
    // MEASURED: 74 draw calls / 176k triangles, carrying 800 leaf blades. The planting pass cost 11
    // draws for the whole five-level scheme, because the blades are ANCHORS batched by render/Foliage
    // into two InstancedMeshes and every pot, bed and trough merges by material like the architecture.
    // The rest are the 8 agents (unique status materials, so none can merge), the three tiled floor
    // plates (each clones the office tile map), the labels, and one mesh per material for the shell.
    expect(meshes).toBeLessThanOrEqual(80);
    // the two rules that protect the render-quality correction: the Lab is out of the shadow pass
    // entirely, and it adds nothing to the light rig
    expect(casters).toBe(0);
    expect(lights).toBe(0);
    expect(lab.stats.draws).toBeGreaterThan(0);
    // the planting really is instanced, not a few hundred individual blades
    expect(lab.stats.blades).toBeGreaterThan(400);

    // THE PLINTH AXIS. slab() maps an XY shape's y to MINUS world z, so an asymmetric plan authored
    // straight lands mirrored on the far side of the office — where it is invisible from every framing
    // that matters and impossible to spot in a unit test that only counts meshes. Bounding the whole
    // group is what catches it: nothing the Lab draws may ever reach south of the rear path.
    const box = new (await import("three")).Box3().setFromObject(lab.group);
    expect(box.max.z).toBeLessThan(0);
    expect(box.min.z).toBeGreaterThan(-1100);
    expect(box.min.x).toBeGreaterThan(200);
  });
});
