// EXTERIOR POLISH (Phase 5): the water model, the construction site and crew, and the exterior's
// camera-driven detail — the contracts the visual pass rests on.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LAKE, depthAtShoreDistance, shoreDistance, waterAt } from "./world/water";
import { AI_LAB_SITE, CONSTRUCTION_SITES, CREW, constructionSolids } from "./world/construction";
import { WALK_PROFILE, RIDE_PROFILE, exteriorGround, campusTrees } from "./world/exteriorGround";
import { PAVED, WALK as LAB_WALK } from "./world/ailab";
import { WALKS, POND_PATH, TERRAIN_Y, GRADE, ROADS, roadVisibleSpan, ROAD_VIS_R, WORLD_CENTRE } from "./world/campus";
import { lakeGeometry, terrainGeometry } from "./build/exteriorDetail";
import { buildExterior } from "./build/exterior";
import { treeLibrary } from "./build/exteriorFoliage";
import { ConstructionCrew, CREW_SHOW_RANGE } from "./avatar/ConstructionCrew";
import { loadRosterGlb, normaliseLikeAvatar } from "./avatar/rosterGlb.testutil";
import type { CastPrototype } from "./avatar/CastPrototypes";
import type { Rect } from "./core/coords";

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.d && a.z + a.d > b.z;

describe("the lake as data (world/water) — ready for WALK → SHALLOW → SWIM", () => {
  const G = exteriorGround();
  it("measures distance from the waterline: positive in the water, negative on land", () => {
    expect(shoreDistance(LAKE, LAKE.centre)).toBeGreaterThan(200);
    expect(shoreDistance(LAKE, { x: LAKE.centre.x, z: LAKE.centre.z + 600 })).toBeLessThan(0);
  });
  it("agrees with the ground model's own water surface everywhere it is sampled", () => {
    let checked = 0;
    for (let x = LAKE.centre.x - 900; x <= LAKE.centre.x + 900; x += 37)
      for (let z = LAKE.centre.z - 450; z <= LAKE.centre.z + 450; z += 29) {
        const d = shoreDistance(LAKE, { x, z });
        if (Math.abs(d) < 6) continue; // the waterline itself is a polyline vs a ray: a hair either way
        expect(G.isWater({ x, z }), `${x},${z} d=${d.toFixed(1)}`).toBe(d > 0);
        checked++;
      }
    expect(checked).toBeGreaterThan(500);
  });
  it("shelves gently, then deepens: wading at the edge, swimming in the middle", () => {
    expect(depthAtShoreDistance(LAKE, 0)).toBe(0);
    expect(depthAtShoreDistance(LAKE, LAKE.shallowBand)).toBeCloseTo(LAKE.shelfDepth, 5);
    expect(depthAtShoreDistance(LAKE, 400)).toBeCloseTo(LAKE.maxDepth, 5);
    for (let d = 1; d < 400; d += 7) expect(depthAtShoreDistance(LAKE, d + 7)).toBeGreaterThanOrEqual(depthAtShoreDistance(LAKE, d));
    expect(waterAt({ x: LAKE.centre.x, z: LAKE.centre.z })?.zone).toBe("swim");
    const edge = waterAt({ x: LAKE.centre.x, z: LAKE.centre.z + LAKE.outline.reduce((m, p) => Math.max(m, p.z - LAKE.centre.z), 0) - 20 });
    expect(edge?.zone).toBe("shallow");
  });
  it("the rendered lake carries the SAME shoreline distance in its vertices (aShore)", () => {
    const g = lakeGeometry();
    const p = g.getAttribute("position"), s = g.getAttribute("aShore");
    for (let i = 1; i < p.count; i += 17) expect(s.getX(i)).toBeCloseTo(shoreDistance(LAKE, { x: p.getX(i), z: p.getZ(i) }), -0.5);
  });
  it("is still a blocked surface today: nobody walks or rides into the water", () => {
    expect(WALK_PROFILE.allows.has("water")).toBe(false);
    expect(RIDE_PROFILE.allows.has("water")).toBe(false);
  });
});

describe("the construction site (world/construction)", () => {
  const G = exteriorGround();
  it("keeps the Reception ↔ Lab route and the Lab's own walks clear", () => {
    for (const site of CONSTRUCTION_SITES)
      for (const s of constructionSolids(site))
        for (const r of [...PAVED, ...LAB_WALK.filter((w) => w !== LAB_WALK[0]), ...WALKS, POND_PATH]) expect(overlaps(s.rect, r), `${s.id} on a path`).toBe(false);
  });
  it("the fence and scaffold are real obstacles, and the terrace in front of the scaffold still passes", () => {
    expect(G.solidAt({ x: 540, z: -320 }, 2)).toMatch(/^site:ai-lab:fence/);
    expect(G.solidAt({ x: 480, z: -425 }, 2)).toBe("site:ai-lab:scaffold");
    const s = AI_LAB_SITE.scaffold!;
    for (let x = s.x0; x <= s.x1; x += 16) expect(G.canOccupy({ x, z: -392 }, RIDE_PROFILE.footRadius, RIDE_PROFILE), `${x}`).toBe(true);
  });
  it("no tree stands in the yard", () => {
    const y = AI_LAB_SITE.yard;
    for (const t of Object.values(campusTrees()).flat()) expect(t.x > y.x && t.x < y.x + y.w && t.z > y.z && t.z < y.z + y.d).toBe(false);
  });
  it("a crew of five, each one distinct, each with somewhere to work inside the site", () => {
    expect(CREW.length).toBe(5);
    expect(new Set(CREW.map((c) => c.hat)).size).toBe(5);
    expect(new Set(CREW.map((c) => c.tool)).size).toBe(5);
    expect(AI_LAB_SITE.work.length).toBe(5);
    const y = AI_LAB_SITE.yard, s = AI_LAB_SITE.scaffold!;
    const onSite = (p: { x: number; z: number }) => (p.x > y.x && p.x < y.x + y.w && p.z > y.z && p.z < y.z + y.d) || (p.x > s.x0 && p.x < s.x1 && p.z > s.zWall && p.z < s.zWall + s.depth);
    for (const w of AI_LAB_SITE.work) for (const p of "at" in w ? [w.at] : [w.from, w.to]) expect(onSite(p), JSON.stringify(p)).toBe(true);
  });
});

describe("the construction crew (avatar/ConstructionCrew) on the real Bon rig", () => {
  it("dresses five workers on clones, skins their workwear to the body, and works to the wall clock", async () => {
    const gltf = await loadRosterGlb("bon");
    normaliseLikeAvatar(gltf.scene);
    const proto: CastPrototype = { id: "bon", gltf, scene: gltf.scene, clips: gltf.animations, triangles: 0, headY: 36 };
    const crew = new ConstructionCrew(AI_LAB_SITE);
    crew.adopt(proto);
    expect(crew.stats?.workers).toBe(5);
    const wear: THREE.SkinnedMesh[] = [];
    crew.group.traverse((o) => { if (o.name.startsWith("crew-wear:")) wear.push(o as THREE.SkinnedMesh); });
    expect(wear.length).toBe(5);
    for (const w of wear) {
      const sw = w.geometry.getAttribute("skinWeight"), si = w.geometry.getAttribute("skinIndex");
      for (let i = 0; i < sw.count; i += 11) {
        expect(sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i)).toBeCloseTo(1, 2);
        expect(si.getX(i)).toBeLessThan(w.skeleton.bones.length);
      }
      expect(w.skeleton).toBeTruthy();
    }
    // the playable Bon is untouched: the prototype scene keeps its own materials and gains no children
    expect(proto.scene.getObjectByName("crew-wear:crew-foreman")).toBeUndefined();
    // deterministic: the same wall-clock second puts every worker at the same place
    const near = new THREE.Vector3(540, 0, -260);
    crew.update(1000, 0.016, near);
    const at = crew.group.children.filter((c) => c.name.startsWith("crew:")).map((c) => c.position.clone());
    crew.update(1000, 0.016, near);
    crew.group.children.filter((c) => c.name.startsWith("crew:")).forEach((c, i) => expect(c.position.distanceTo(at[i])).toBeLessThan(1e-9));
    expect(crew.group.visible).toBe(true);
    // gated: far from the site the crew is neither drawn nor animated
    crew.update(1001, 0.016, new THREE.Vector3(540 + CREW_SHOW_RANGE + 50, 0, -260));
    expect(crew.group.visible).toBe(false);
    crew.dispose();
  }, 60000);
});

describe("the exterior's detail follows the camera", () => {
  const ex = buildExterior();
  it("brings at most NEAR_CAP trees to their near cut, only close to the camera", () => {
    ex.detailTick(new THREE.Vector3(1250, 60, -300));
    const near = ex.stats.treeLod.nearNow;
    expect(near).toBeGreaterThan(5);
    expect(near).toBeLessThanOrEqual(ex.stats.treeLod.nearCap);
    ex.detailTick(new THREE.Vector3(720, 6000, 622)); // high overhead
    expect(ex.stats.treeLod.nearNow).toBe(0);
  });
  it("the near and far cuts of every species share one silhouette (crowns on the same bounds)", () => {
    for (const lods of Object.values(treeLibrary())) for (const l of lods) {
      const a = new THREE.Box3().setFromBufferAttribute(l.near.canopy.getAttribute("position") as THREE.BufferAttribute);
      const b = new THREE.Box3().setFromBufferAttribute(l.far.canopy.getAttribute("position") as THREE.BufferAttribute);
      expect(Math.abs(a.max.y - b.max.y)).toBeLessThan(0.5);
      expect(Math.abs((a.max.x - a.min.x) - (b.max.x - b.min.x))).toBeLessThan(0.5);
    }
  });
});

describe("the ground meets the world's edge cleanly", () => {
  it("open country sits a hair under grade and never overlaps a lot or a street corridor", () => {
    expect(TERRAIN_Y).toBeGreaterThan(GRADE - 0.5);
    const g = terrainGeometry(), p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(TERRAIN_Y, 4);
  });
  it("every street is drawn only to the foot of the horizon ridge", () => {
    for (const r of ROADS) {
      const s = roadVisibleSpan(r), c = r.axis === "x" ? WORLD_CENTRE.x : WORLD_CENTRE.z, off = r.at - (r.axis === "x" ? WORLD_CENTRE.z : WORLD_CENTRE.x);
      expect(Math.hypot(s.to - c, off)).toBeLessThanOrEqual(ROAD_VIS_R + 1e-6);
      expect(Math.hypot(s.from - c, off)).toBeLessThanOrEqual(ROAD_VIS_R + 1e-6);
    }
  });
});
