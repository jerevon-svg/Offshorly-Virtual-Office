import { isWalkable } from "./officeGrid";

export type Cell = { cx: number; cy: number };

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function octile(a: Cell, b: Cell): number {
  const dx = Math.abs(a.cx - b.cx);
  const dy = Math.abs(a.cy - b.cy);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function key(c: Cell): string {
  return `${c.cx},${c.cy}`;
}

type OpenEntry = { cell: Cell; f: number };

// Simple array-based min-priority-queue: linear-scan extract-min, O(1) push.
// Fine for ~7000-cell grids (no need for a binary heap at this scale).
class OpenList {
  private items: OpenEntry[] = [];

  push(entry: OpenEntry) {
    this.items.push(entry);
  }

  popMin(): OpenEntry | undefined {
    if (this.items.length === 0) return undefined;
    let bestIdx = 0;
    for (let i = 1; i < this.items.length; i++) {
      if (this.items[i].f < this.items[bestIdx].f) bestIdx = i;
    }
    const [entry] = this.items.splice(bestIdx, 1);
    return entry;
  }

  get size() {
    return this.items.length;
  }
}

export function aStar(start: Cell, goal: Cell): Cell[] | null {
  if (!isWalkable(start.cx, start.cy) || !isWalkable(goal.cx, goal.cy)) return null;
  if (start.cx === goal.cx && start.cy === goal.cy) return [start];

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const cellOf = new Map<string, Cell>();

  const startKey = key(start);
  gScore.set(startKey, 0);
  cellOf.set(startKey, start);
  cellOf.set(key(goal), goal);

  const open = new OpenList();
  open.push({ cell: start, f: octile(start, goal) });

  const closed = new Set<string>();

  while (open.size > 0) {
    const current = open.popMin();
    if (!current) break;
    const curKey = key(current.cell);
    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (current.cell.cx === goal.cx && current.cell.cy === goal.cy) {
      // reconstruct path
      const path: Cell[] = [current.cell];
      let k = curKey;
      while (cameFrom.has(k)) {
        k = cameFrom.get(k)!;
        path.push(cellOf.get(k)!);
      }
      path.reverse();
      return path;
    }

    const curG = gScore.get(curKey) ?? Infinity;

    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = current.cell.cx + dx;
      const ny = current.cell.cy + dy;
      if (!isWalkable(nx, ny)) continue;

      // No corner-cutting: for diagonal moves, both orthogonal neighbors must
      // also be walkable.
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(current.cell.cx + dx, current.cell.cy) || !isWalkable(current.cell.cx, current.cell.cy + dy)) {
          continue;
        }
      }

      const neighbor: Cell = { cx: nx, cy: ny };
      const nKey = key(neighbor);
      if (closed.has(nKey)) continue;

      const tentativeG = curG + cost;
      const existingG = gScore.get(nKey) ?? Infinity;
      if (tentativeG < existingG) {
        gScore.set(nKey, tentativeG);
        cameFrom.set(nKey, curKey);
        cellOf.set(nKey, neighbor);
        open.push({ cell: neighbor, f: tentativeG + octile(neighbor, goal) });
      }
    }
  }

  return null; // goal unreachable
}
