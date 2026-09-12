import { describe, expect, it } from "vitest";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, HERO_PLANT_ID, designRoomEntities, RECT } from "./rooms/design-room";
import { Walkability, footprintCells } from "./nav/Walkability";
import { planWalk } from "./nav/planner";
import { CELL, v1Static, worldToCell } from "./adapters/v1Grid";
import { v1Path } from "./adapters/v1Pathfinding";
import { pointInRect, type Vec2 } from "./core/coords";
import { aStar } from "./nav/pathfind";

const W = (x: number, z: number): Vec2 => ({ x: RECT.x + x, z: RECT.z + z });
const inBounds = (p: Vec2) => pointInRect(p, DESIGN_ROOM.floorRect);
function world(): WorldState { const w = new WorldState(); w.addRoom(DESIGN_ROOM); for (const e of designRoomEntities()) w.addEntity(e); return w; }
function legsWalkable(from: Vec2, path: Vec2[], walk: (cx: number, cy: number) => boolean): void {
  const pts = [from, ...path];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d <= len; d += 1) { const t = len ? d / len : 0; const c = worldToCell({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); expect(walk(c.cx, c.cy), `leg ${i} at ${c.cx},${c.cy}`).toBe(true); }
  }
}

describe("vo3d nav — composed walkability over the READ-ONLY V1 grid", () => {
  it("static layer = production grid; the planner agrees with the production oracle where no dynamic obstacle interferes", () => {
    const wk = new Walkability(v1Static);
    const from = W(290, 56), to = W(112, 196);
    const r = planWalk(from, to, wk, inBounds);
    expect(r.ok).toBe(true);
    const oracle = v1Path(from, to);
    if (r.ok) {
      // production lands on the exact clicked point, the planner on the cell centre → compare destination CELLS
      const last = r.path[r.path.length - 1], ol = oracle[oracle.length - 1];
      expect(worldToCell(last)).toEqual(worldToCell(ol));
      legsWalkable(from, r.path, wk.walkable);
    }
  });

  it("rejects clicks outside the floor and on blocked cells; snaps valid clicks to the cell centre", () => {
    const wk = new Walkability(v1Static);
    expect(planWalk(W(298, 125), { x: RECT.x - 20, z: RECT.z + 100 }, wk, inBounds)).toMatchObject({ ok: false, reason: "outside-world" });
    expect(planWalk(W(298, 125), W(155, 105), wk, inBounds)).toMatchObject({ ok: false, reason: "unwalkable" }); // lead desk
    const r = planWalk(W(298, 125), W(270, 190), wk, inBounds);
    expect(r.ok).toBe(true);
    if (r.ok) { expect((r.destination.x / CELL) % 1).toBeCloseTo(0.5, 6); expect((r.destination.z / CELL) % 1).toBeCloseTo(0.5, 6); }
  });

  it("routes around the desk U (multi-waypoint, every leg walkable)", () => {
    const wk = new Walkability(v1Static);
    const from = W(270, 190), to = W(155, 56);
    const r = planWalk(from, to, wk, inBounds);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.path.length).toBeGreaterThanOrEqual(2); legsWalkable(from, r.path, wk.walkable); }
  });

  it("dynamic footprints from navBlocker entities block cells and are released when the entity moves", () => {
    const w = world();
    const wk = new Walkability(v1Static);
    wk.syncFromWorld(w);
    const plant = w.get(HERO_PLANT_ID);
    const origCells = footprintCells(plant.transform.pos, plant.footprint!);
    expect(origCells.length).toBeGreaterThanOrEqual(1);
    expect(wk.dynamicBlockedKeys).toEqual(origCells.map((c) => `${c.cx},${c.cy}`));
    // move onto column 17 (the east aisle) and re-sync
    w.commit((tx) => tx.setTransform(HERO_PLANT_ID, { pos: W(270.5, 125), yaw: 0 }));
    wk.syncFromWorld(w);
    const c = worldToCell(W(270.5, 125));
    expect(wk.isDynamicallyBlocked(c.cx, c.cy)).toBe(true);
    expect(v1Static(c.cx, c.cy)).toBe(true); // production considers it walkable — the dynamic layer is what blocks it
    for (const o of origCells) expect(wk.isDynamicallyBlocked(o.cx, o.cy)).toBe(false);
    // forced detour: straight walk through that cell was 1 waypoint, now steps around
    const straight = planWalk(W(270.5, 141), W(270.5, 109), new Walkability(v1Static), inBounds);
    expect(straight.ok && straight.path.length).toBe(1);
    const detour = planWalk(W(270.5, 141), W(270.5, 109), wk, inBounds);
    expect(detour.ok).toBe(true);
    if (detour.ok) { expect(detour.path.length).toBeGreaterThanOrEqual(2); expect(Math.abs(detour.path[0].x - W(270.5, 0).x)).toBeGreaterThan(8); legsWalkable(W(270.5, 141), detour.path, wk.walkable); }
    // clicking the plant's cell is unwalkable; the old spot is walkable again
    expect(planWalk(W(290, 56), W(270.5, 125), wk, inBounds).ok).toBe(false);
    expect(planWalk(W(290, 56), plant.transform.pos, wk, inBounds).ok).toBe(true);
  });

  it("reservations compose like footprints", () => {
    const wk = new Walkability(v1Static);
    const c = worldToCell(W(270.5, 125));
    wk.reserve("seat", [c]);
    expect(wk.walkable(c.cx, c.cy)).toBe(false);
    wk.release("seat");
    expect(wk.walkable(c.cx, c.cy)).toBe(true);
  });

  it("A* honours production movement rules (8-connected, no corner cutting)", () => {
    const path = aStar(v1Static, { cx: 18, cy: 23 }, { cx: 17, cy: 31 })!;
    expect(path[0]).toEqual({ cx: 18, cy: 23 });
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      expect(Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy))).toBe(1);
      if (a.cx !== b.cx && a.cy !== b.cy) { expect(v1Static(b.cx, a.cy)).toBe(true); expect(v1Static(a.cx, b.cy)).toBe(true); }
    }
  });
});
