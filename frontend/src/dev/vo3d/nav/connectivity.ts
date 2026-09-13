// vo3d nav — CONNECTIVITY as a first-class fact.
//
// Walkable is not the same as reachable, and confusing the two is what produced the Central Hub's 79-unit
// café approach points: the V1 grid's café aisles are open floor, but the ring of 'o' interaction cells
// around each table sealed them into a pocket no body could route into, and the room-local stand-point
// search happily picked a cell on the far side of the island instead.
//
// So connectivity is computed ONCE from a world anchor and handed to everything that needs to know where a
// body can actually stand. 4-connected on purpose: A* is 8-connected but forbids corner cutting, so a
// diagonal step needs both orthogonals — a 4-connected flood is exactly the set A* can reach.
import { COLS, ROWS, cellKey, worldToCell, type Cell } from "../adapters/v1Grid";
import type { Vec2 } from "../core/coords";
import type { CellPredicate, EdgePredicate } from "./pathfind";

/** The open hall south-west of the Central Hub — production's own "open corridor" anchor, used by
 *  officePathfinding's tests and by every reachability assertion in vo3d since Phase 6. */
export const HALL_ANCHOR: Vec2 = { x: 500, z: 790 };

export class Connectivity {
  readonly cells: ReadonlySet<string>;
  readonly anchor: Cell;
  constructor(walk: CellPredicate, anchor: Vec2 = HALL_ANCHOR, edgeOk: EdgePredicate = () => true) {
    const start = worldToCell(anchor);
    this.anchor = start;
    const seen = new Set<string>();
    if (walk(start.cx, start.cy)) {
      seen.add(cellKey(start));
      const q: Cell[] = [start];
      while (q.length) {
        const c = q.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = { cx: c.cx + dx, cy: c.cy + dy };
          const k = cellKey(n);
          if (seen.has(k) || n.cx < 0 || n.cy < 0 || n.cx >= COLS || n.cy >= ROWS || !walk(n.cx, n.cy) || !edgeOk(c, n)) continue;
          seen.add(k);
          q.push(n);
        }
      }
    }
    this.cells = seen;
  }
  has(c: Cell): boolean {
    return this.cells.has(cellKey(c));
  }
  at(p: Vec2): boolean {
    return this.has(worldToCell(p));
  }
  get size(): number {
    return this.cells.size;
  }
}
