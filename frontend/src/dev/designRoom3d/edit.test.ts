import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CELL, isWalkable } from "../../data/officeGrid";
import { buildRoom, HERO_PLANT_INDEX, swayNodesOf, animateSway } from "./build";
import { BAKED } from "./layout";
import { groundToFrameCentre, planWalk } from "./nav";
import { DynamicNav, EditablePlant, aStarWith, footprintCells } from "./edit";

const hero = BAKED.plants[HERO_PLANT_INDEX];
const FROM = { x: 270.5, z: 190 }; // south-east floor
const TO = { x: 270.5, z: 56 }; // straight north up the east aisle (grid column 17) — the plant will be dropped on it
const R = 8;

describe("room edit mode (one plant) + dynamic walkability", () => {
  it("rasterises a circular footprint onto production grid cells", () => {
    const cells = footprintCells({ x: hero.x, z: hero.z }, R);
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(cells.length).toBeLessThanOrEqual(9);
    const f = groundToFrameCentre({ x: hero.x, z: hero.z });
    expect(cells.some((c) => c.cx === Math.floor(f.x / CELL) && c.cy === Math.floor(f.y / CELL))).toBe(true);
  });

  it("with no dynamic obstacle the plan is the production plan; with one it is the same route when it does not interfere", () => {
    const dyn = new DynamicNav();
    const base = planWalk(FROM, TO);
    const same = planWalk(FROM, TO, dyn);
    expect(base).toEqual(same); // hasObstacles false → identical (production) result
    dyn.setObstacle("x", { x: 40, z: 150 }, R); // far away in the west aisle
    const far = planWalk(FROM, TO, dyn);
    expect(far.ok).toBe(true);
    if (far.ok && base.ok) {
      const last = far.path[far.path.length - 1], bl = base.path[base.path.length - 1];
      expect(last.x).toBeCloseTo(bl.x, 6);
      expect(last.z).toBeCloseTo(bl.z, 6);
    }
  });

  it("moving the plant onto a walkable route reroutes around it, and releases its old cells", () => {
    const room = buildRoom();
    const g = room.getObjectByName(`plant-${HERO_PLANT_INDEX}`)!;
    const dyn = new DynamicNav();
    const plant = new EditablePlant("hero-plant", g, R, dyn);
    const originalCells = dyn.blockedKeys();
    expect(originalCells.length).toBeGreaterThan(0);
    // baseline route, east side (x≈270) — find a walkable cell on it to drop the plant on
    const before = planWalk(FROM, TO, dyn);
    expect(before.ok).toBe(true);
    const target = { x: 270.5, z: 125 }; // east aisle, production-walkable, on the straight line
    const tf = groundToFrameCentre(target);
    expect(isWalkable(Math.floor(tf.x / CELL), Math.floor(tf.y / CELL))).toBe(true);
    expect(plant.preview(target).ok).toBe(true);
    expect(plant.confirm().ok).toBe(true);
    // old cells released, new cells blocked
    for (const k of originalCells) expect(dyn.blockedKeys()).not.toContain(k);
    expect(dyn.isBlocked(Math.floor(tf.x / CELL), Math.floor(tf.y / CELL))).toBe(true);
    // a click ON the plant is rejected as unwalkable
    const onPlant = planWalk(FROM, target, dyn);
    expect(onPlant.ok).toBe(false);
    // the route now avoids every blocked cell (sampled every unit)
    const after = planWalk(FROM, TO, dyn);
    expect(after.ok).toBe(true);
    if (!after.ok || !before.ok) return;
    expect(after.path.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`)).not.toEqual(before.path.map((p) => `${p.x.toFixed(0)},${p.z.toFixed(0)}`));
    // forced detour: the cells directly north and south of the plant (17,26 → 17,28) are a straight
    // 1-waypoint production walk; with the plant on 17,27 the walk must step around it
    const north = { x: 270.5, z: 109 }, south = { x: 270.5, z: 141 };
    const straight = planWalk(south, north);
    expect(straight.ok && straight.path.length).toBe(1);
    const detour = planWalk(south, north, dyn);
    expect(detour.ok).toBe(true);
    if (detour.ok) {
      expect(detour.path.length).toBeGreaterThanOrEqual(2);
      const mid = detour.path[0];
      expect(Math.abs(mid.x - 270.5)).toBeGreaterThan(8); // steps to a neighbouring column
    }
    const pts = [FROM, ...after.path];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let d = 0; d <= len; d += 1) {
        const t = len ? d / len : 0;
        const f = groundToFrameCentre({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        const cx = Math.floor(f.x / CELL), cy = Math.floor(f.y / CELL);
        expect(dyn.walkable(cx, cy), `leg ${i} crosses ${cx},${cy}`).toBe(true);
      }
    }
    // old location is walkable again for the planner
    const oldSpot = planWalk(FROM, { x: hero.x, z: hero.z }, dyn);
    expect(oldSpot.ok).toBe(true);
    // sway nodes still belong to the moved group (they moved with it)
    const nodes = swayNodesOf(room);
    const inPlant = nodes.filter((n) => { let o: THREE.Object3D | null = n.obj; while (o) { if (o === g) return true; o = o.parent; } return false; });
    expect(inPlant.length).toBeGreaterThan(20);
    animateSway(nodes, 1.0);
    expect(g.position.x).toBeCloseTo(target.x, 6);
  });

  it("rejects placements outside the room or overlapping fixed furniture, and cancel/reset restore exactly", () => {
    const room = buildRoom();
    const g = room.getObjectByName(`plant-${HERO_PLANT_INDEX}`)!;
    const dyn = new DynamicNav();
    const plant = new EditablePlant("hero-plant", g, R, dyn);
    const orig = g.position.clone();
    expect(plant.preview({ x: -5, z: 100 })).toMatchObject({ ok: false, reason: "outside-room" });
    expect(plant.confirm().ok).toBe(false);
    expect(plant.preview({ x: 155, z: 105 })).toMatchObject({ ok: false, reason: "overlaps-furniture" }); // lead desk
    plant.cancel();
    expect(g.position.distanceTo(orig)).toBeLessThan(1e-9);
    // 5 move/confirm cycles then reset → zero drift, footprint back at the original cells
    const startKeys = [...dyn.blockedKeys()].sort();
    // open-floor spots: the plant needs radius 8 + 1.5 clearance from fixed furniture (the west aisle and lounge are too tight for it)
    const spots = [{ x: 270.5, z: 125 }, { x: 200, z: 192 }, { x: 200, z: 56 }, { x: 290, z: 56 }, { x: 250, z: 190 }];
    for (const s of spots) { expect(plant.preview(s).ok).toBe(true); expect(plant.confirm().ok).toBe(true); expect(plant.driftFromCommitted()).toBe(0); }
    plant.reset();
    expect(g.position.distanceTo(orig)).toBeLessThan(1e-9);
    expect([...dyn.blockedKeys()].sort()).toEqual(startKeys);
  });

  it("dev A* honours production movement rules (no corner cutting) and matches production on an open grid", () => {
    const walk = (cx: number, cy: number) => isWalkable(cx, cy);
    const s = { cx: 18, cy: 23 }, gcell = { cx: 17, cy: 31 };
    const path = aStarWith(walk, s, gcell)!;
    expect(path[0]).toEqual(s);
    expect(path[path.length - 1]).toEqual(gcell);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      expect(Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy))).toBe(1);
      if (a.cx !== b.cx && a.cy !== b.cy) { expect(walk(b.cx, a.cy)).toBe(true); expect(walk(a.cx, b.cy)).toBe(true); }
    }
  });
});
