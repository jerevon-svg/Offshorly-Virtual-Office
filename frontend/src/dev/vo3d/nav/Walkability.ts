// vo3d nav — composed walkability:
//   effective(cx,cy) = static(cx,cy) AND NOT dynamicFootprint(cx,cy) AND NOT reservation(cx,cy)
// The static layer is the READ-ONLY V1 grid; dynamic footprints come from WorldState entities
// flagged `navBlocker`; reservations are short-lived cell holds owned by interactions.
import { CELL, cellKey, type Cell } from "../adapters/v1Grid";
import type { Vec2 } from "../core/coords";
import type { CellPredicate } from "./pathfind";
import type { Entity, EntityId, Footprint, WorldState } from "../world/WorldState";

/** Rasterise a footprint centred at `pos` onto grid cells (cell centre inside the shape + quarter-cell margin). */
export function footprintCells(pos: Vec2, fp: Footprint): Cell[] {
  const out: Cell[] = [];
  const m = CELL * 0.25;
  if (fp.shape === "circle") {
    const r = fp.r + m;
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

export class Walkability {
  private readonly dynamic = new Map<EntityId, Set<string>>();
  private readonly reservations = new Map<string, Set<string>>();
  private blocked = new Set<string>();
  readonly staticLayer: CellPredicate;

  constructor(staticLayer: CellPredicate) {
    this.staticLayer = staticLayer;
  }
  /** Rebuild the dynamic layer from every navBlocker entity in the world. */
  syncFromWorld(world: WorldState): void {
    this.dynamic.clear();
    for (const e of world.entities.values()) if (e.capabilities.navBlocker && e.footprint) this.setEntityFootprint(e);
    this.rebuild();
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
  /** the composed predicate */
  readonly walkable: CellPredicate = (cx, cy) => this.staticLayer(cx, cy) && !this.blocked.has(`${cx},${cy}`);
}
