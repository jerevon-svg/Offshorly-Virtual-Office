// vo3d nav — predicate-driven grid search. Rules mirror production data/gridAStar.ts
// (8-connected, octile cost, no corner cutting) but run over ANY walkability predicate.
import { cellKey, type Cell } from "../adapters/v1Grid";

export type CellPredicate = (cx: number, cy: number) => boolean;
/** May a body step directly from `a` to `b`? Cells are adjacent, but a derived room's stand points move
 *  WITHIN their cells, so the step itself has to be checked (nav/derived.ts). Default: always yes, which is
 *  what the V1 grid has always assumed for adjacent cells. */
export type EdgePredicate = (a: Cell, b: Cell) => boolean;
const ANY_EDGE: EdgePredicate = () => true;

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];
function octile(a: Cell, b: Cell): number {
  const dx = Math.abs(a.cx - b.cx), dy = Math.abs(a.cy - b.cy);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}
export function aStar(walk: CellPredicate, start: Cell, goal: Cell, maxNodes = 20000, edgeOk: EdgePredicate = ANY_EDGE): Cell[] | null {
  if (!walk(start.cx, start.cy) || !walk(goal.cx, goal.cy)) return null;
  const open: { c: Cell; f: number }[] = [{ c: start, f: octile(start, goal) }];
  const g = new Map<string, number>([[cellKey(start), 0]]);
  const came = new Map<string, Cell>();
  const closed = new Set<string>();
  let expanded = 0;
  while (open.length && expanded++ < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { c } = open.splice(bi, 1)[0];
    const ck = cellKey(c);
    if (c.cx === goal.cx && c.cy === goal.cy) {
      const path: Cell[] = [c];
      let k = ck;
      while (came.has(k)) { const p = came.get(k)!; path.push(p); k = cellKey(p); }
      return path.reverse();
    }
    if (closed.has(ck)) continue;
    closed.add(ck);
    for (const [dx, dy, cost] of DIRS) {
      const nx = c.cx + dx, ny = c.cy + dy;
      if (!walk(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!walk(c.cx + dx, c.cy) || !walk(c.cx, c.cy + dy))) continue;
      if (!edgeOk(c, { cx: nx, cy: ny })) continue;
      const nk = `${nx},${ny}`;
      const ng = (g.get(ck) ?? Infinity) + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, c);
        open.push({ c: { cx: nx, cy: ny }, f: ng + octile({ cx: nx, cy: ny }, goal) });
      }
    }
  }
  return null;
}
export function floodFill(walk: CellPredicate, start: Cell, limit = 20000, edgeOk: EdgePredicate = ANY_EDGE): Set<string> {
  const seen = new Set<string>([cellKey(start)]);
  const q: Cell[] = [start];
  while (q.length && seen.size < limit) {
    const c = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { cx: c.cx + dx, cy: c.cy + dy };
      const k = cellKey(n);
      if (seen.has(k) || !walk(n.cx, n.cy) || !edgeOk(c, n)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen;
}
export function nearestWalkable(walk: CellPredicate, from: Cell, region?: Set<string>, maxR = 12): Cell {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const c = { cx: from.cx + dx, cy: from.cy + dy };
      if (walk(c.cx, c.cy) && (!region || region.has(cellKey(c)))) return c;
    }
  }
  return from;
}
export function mergeCollinear(cells: Cell[]): Cell[] {
  if (cells.length <= 2) return cells;
  const out: Cell[] = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1], b = cells[i], c = cells[i + 1];
    if (b.cx - a.cx !== c.cx - b.cx || b.cy - a.cy !== c.cy - b.cy) out.push(b);
  }
  out.push(cells[cells.length - 1]);
  return out;
}
