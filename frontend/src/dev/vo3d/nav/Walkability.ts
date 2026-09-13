// vo3d nav — composed walkability. Two regimes, one predicate:
//
//   DERIVED room (7B):  geometryClear(cx,cy, NAV_RADIUS)      AND NOT reservation(cx,cy)
//   V1-governed:        static(cx,cy) AND NOT dynamicFootprint AND NOT reservation
//
// The static layer is the READ-ONLY V1 grid (plus the world regions and the door clearance bands) and is
// MEMOISED FOR THE SESSION — which is exactly why derived navigation does not live inside it. Geometry
// changes: a plant moves, a door opens. So the derived layer sits HERE, beside the dynamic footprints, and
// is invalidated incrementally.
//
// The two regimes never double-count: an entity standing in a derived room is already carved into that
// room's clearance field, so it is skipped on the legacy `navBlocker` layer.
import { CELL, COLS, ROWS, cellCentre, cellKey, type Cell } from "../adapters/v1Grid";
import type { Rect, Vec2 } from "../core/coords";
import type { CellPredicate } from "./pathfind";
import { isSolid, type Entity, type EntityId, type Footprint, type WorldState } from "../world/WorldState";
import { NAV_RADIUS } from "./clearance";
import type { DerivedNav } from "./derived";
import { entitySolids, shapeBounds } from "./solids";

/** Rasterise a footprint centred at `pos` onto grid cells (cell centre inside the shape + quarter-cell margin). */
export function footprintCells(pos: Vec2, fp: Footprint): Cell[] {
  const out: Cell[] = [];
  const m = CELL * 0.25;
  if (fp.shape === "sector" || fp.shape === "circle") {
    // the legacy V1-governed layer rasterises a sector by its bounding disc — it only ever runs for
    // navBlocker entities OUTSIDE derived rooms, where no curved architecture is declared
    const r = (fp.shape === "circle" ? fp.r : fp.rOut) + m;
    for (let cy = Math.floor((pos.z - r) / CELL); cy <= Math.floor((pos.z + r) / CELL); cy++)
      for (let cx = Math.floor((pos.x - r) / CELL); cx <= Math.floor((pos.x + r) / CELL); cx++)
        if (Math.hypot((cx + 0.5) * CELL - pos.x, (cy + 0.5) * CELL - pos.z) <= r) out.push({ cx, cy });
  } else {
    const hw = fp.w / 2 + m, hd = fp.d / 2 + m;
    for (let cy = Math.floor((pos.z - hd) / CELL); cy <= Math.floor((pos.z + hd) / CELL); cy++)
      for (let cx = Math.floor((pos.x - hw) / CELL); cx <= Math.floor((pos.x + hw) / CELL); cx++) {
        const wx = (cx + 0.5) * CELL, wz = (cy + 0.5) * CELL;
        if (Math.abs(wx - pos.x) <= hw && Math.abs(wz - pos.z) <= hd) out.push({ cx, cy });
      }
  }
  return out;
}

/** The static layer for a world larger than one room: the READ-ONLY V1 grid AND inside a registered
 *  walkable world region (cell centre). Memoised per cell — regions never change after registration. */
export function composeStatic(v1: CellPredicate, inWorld: (p: Vec2) => boolean, ...layers: CellPredicate[]): CellPredicate {
  const memo = new Uint8Array(COLS * ROWS); // 0 unknown · 1 walkable · 2 not
  return (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
    const i = cy * COLS + cx;
    if (memo[i] === 0) memo[i] = v1(cx, cy) && inWorld(cellCentre({ cx, cy })) && layers.every((l) => l(cx, cy)) ? 1 : 2;
    return memo[i] === 1;
  };
}

export class Walkability {
  private readonly dynamic = new Map<EntityId, Set<string>>();
  private readonly reservations = new Map<string, Set<string>>();
  private blocked = new Set<string>();
  readonly staticLayer: CellPredicate;
  /** geometry-derived layer for reconstructed rooms; null = every cell stays V1-governed */
  derived: DerivedNav | null = null;
  /** the radius routing is judged at inside derived rooms */
  navRadius = NAV_RADIUS;
  /** live open fraction per door entity (0 closed … 1 open) */
  private readonly doorOpen = new Map<EntityId, number>();
  /** incremental-update counters, for the bench and the tests */
  stats = { invalidations: 0, cellsInvalidated: 0 };

  constructor(staticLayer: CellPredicate) {
    this.staticLayer = staticLayer;
  }

  /** Attach the derived layer and subscribe to the world so geometry changes repaint only what they touch. */
  attachDerived(derived: DerivedNav, world: WorldState): void {
    this.derived = derived;
    derived.setDoorOpen((id) => this.doorOpen.get(id) ?? 0);
    world.changes.on((change) => this.onWorldChange(world, change.changed));
    this.syncFromWorld(world);
  }
  /** true when geometry, not the V1 grid, decides this cell */
  isDerived(cx: number, cy: number): boolean {
    return this.derived?.governs(cx, cy) === true;
  }
  /** where a body stands in a cell: the derived stand point inside a derived room, the centre elsewhere */
  pointOf(c: Cell): Vec2 {
    return this.derived ? this.derived.pointOf(c, this.navRadius) : cellCentre(c);
  }
  /** may a body step straight from one cell's stand point to the next? Always true without a derived layer */
  readonly edgeOk = (a: Cell, b: Cell): boolean => (this.derived ? this.derived.edgeClear(a, b, this.navRadius) : true);

  /** Rebuild the dynamic layer from every navBlocker entity the DERIVED layer does not already own. */
  syncFromWorld(world: WorldState): void {
    this.dynamic.clear();
    const derivedRooms = this.derived?.roomIds;
    for (const e of world.entities.values()) {
      if (derivedRooms?.has(e.roomId)) continue; // already carved into the clearance field
      if (e.capabilities.navBlocker && e.footprint && isSolid(e.footprint)) this.setEntityFootprint(e);
    }
    this.rebuild();
  }

  /** REQUIREMENT 4: a moved entity reopens the cells it left and blocks the cells it took, and nothing else
   *  in the world is recomputed. Both rect sets come from the field's own record of where the solid WAS. */
  private onWorldChange(world: WorldState, changed: readonly EntityId[]): void {
    const d = this.derived;
    if (!d || !changed.length) return;
    const rects: Rect[] = [];
    let touchesDerived = false;
    for (const id of changed) {
      const e = world.entities.get(id);
      if (!e || !d.roomIds.has(e.roomId)) continue;
      touchesDerived = true;
      rects.push(...d.boundsOfEntity(id)); // where it was
      for (const s of entitySolids(e, (x) => this.doorOpen.get(x) ?? 0)) rects.push(shapeBounds(s.shape)); // where it is
    }
    if (!touchesDerived) return;
    this.stats.invalidations++;
    this.stats.cellsInvalidated += d.invalidate(rects, this.navRadius);
  }

  /** A door moved: repaint the cells its leaf can reach at either end of the slide. No world rebuild. */
  setDoorOpenFraction(world: WorldState, id: EntityId, fraction: number): void {
    const prev = this.doorOpen.get(id) ?? 0;
    if (prev === fraction) return;
    this.doorOpen.set(id, fraction);
    const d = this.derived;
    const e = world.entities.get(id);
    if (!d || !e || !d.roomIds.has(e.roomId)) return;
    const rects: Rect[] = [...d.boundsOfEntity(id)];
    for (const s of entitySolids(e, (x) => this.doorOpen.get(x) ?? 0)) rects.push(shapeBounds(s.shape));
    this.stats.invalidations++;
    this.stats.cellsInvalidated += d.invalidate(rects, this.navRadius);
  }
  setEntityFootprint(e: Entity): void {
    if (!e.footprint) return;
    this.dynamic.set(e.id, new Set(footprintCells(e.transform.pos, e.footprint).map(cellKey)));
    this.rebuild();
  }
  clearEntityFootprint(id: EntityId): void {
    this.dynamic.delete(id);
    this.rebuild();
  }
  reserve(owner: string, cells: Cell[]): void {
    this.reservations.set(owner, new Set(cells.map(cellKey)));
    this.rebuild();
  }
  release(owner: string): void {
    this.reservations.delete(owner);
    this.rebuild();
  }
  private rebuild(): void {
    this.blocked = new Set();
    for (const s of this.dynamic.values()) for (const k of s) this.blocked.add(k);
    for (const s of this.reservations.values()) for (const k of s) this.blocked.add(k);
  }
  get dynamicBlockedKeys(): string[] {
    return [...this.blocked];
  }
  isDynamicallyBlocked(cx: number, cy: number): boolean {
    return this.blocked.has(`${cx},${cy}`);
  }
  /** the composed predicate: derived geometry where a reconstructed room governs, V1 everywhere else */
  readonly walkable: CellPredicate = (cx, cy) => {
    if (this.blocked.has(`${cx},${cy}`)) return false;
    const d = this.derived;
    if (d && d.governs(cx, cy)) return d.clear(cx, cy, this.navRadius);
    return this.staticLayer(cx, cy);
  };
}
