// vo3d nav — architectural clearance layer. The V1 grid is authored at 16-unit cells and its door bands are
// generous; real jambs, fixed panes and a parked leaf are narrower than that. A cell is clear when a body of
// `bodyRadius` standing on its centre overlaps none of the registered solids. Static: composed into the static
// layer (composeStatic) next to the V1 grid and the world regions; dynamic footprints/reservations stay separate.
import { cellCentre } from "../adapters/v1Grid";
import { circleOverlapsRect, pointInRect, type Rect } from "../core/coords";
import type { CellPredicate } from "./pathfind";
import type { WorldState } from "../world/WorldState";

export type Clearance = { band: Rect; solids: Rect[]; bodyRadius: number };

/** every clearance the world's entities declare: moving architecture (door capabilities) and static
 *  architecture the V1 grid resolves too coarsely (gate pedestals, bollards — `clearance` capability). */
export function worldClearances(world: WorldState): Clearance[] {
  const out: Clearance[] = [];
  for (const e of world.entities.values()) {
    if (e.capabilities.door) out.push(e.capabilities.door.clearance);
    if (e.capabilities.clearance) out.push(e.capabilities.clearance);
  }
  return out;
}

export function clearanceLayer(clearances: readonly Clearance[]): CellPredicate {
  return (cx, cy) => {
    const c = cellCentre({ cx, cy });
    for (const cl of clearances) { if (!pointInRect(c, cl.band)) continue; for (const s of cl.solids) if (circleOverlapsRect(c, cl.bodyRadius, s)) return false; }
    return true;
  };
}
