// vo3d nav — the SHARED approach resolver: where do you stand to use this thing?
//
// Replaces the Central Hub's room-local `standNear` (which knew only about V1 cells and its own OpenBands,
// judged nothing at body width, and had no notion of a side approach). One resolver, geometry-aware,
// reusable by every room as it migrates.
//
// THREE RULES, in order of authority:
//   1. CONNECTED. A cell no body can route to is not a stand point, however close it looks.
//   2. CLEAR. The cell has to hold a body of the routing radius — that is the derived clearance field's job.
//   3. NEAREST, with the preferred side breaking ties. Distance dominates so a stand point never teleports
//      across the room; `prefer` only chooses between cells that are already about equally close.
//
// SIDE APPROACH falls out of the scoring rather than being a special case: when nothing in the preferred
// direction qualifies, the best-scoring cell is simply somewhere else, and the resolver reports which.
import { CELL, cellCentre, worldToCell, type Cell } from "../adapters/v1Grid";
import { dist, type Vec2 } from "../core/coords";
import type { Connectivity } from "./connectivity";
import type { CellPredicate } from "./pathfind";

export type ApproachQuery = {
  /** the thing being approached (a chair, a counter face) — distance is measured from here */
  target: Vec2;
  /** ideal standing direction from `target` (chair → away from its table). Tie-break only. */
  prefer?: Vec2;
  /** where to begin the cell search; defaults to `target` */
  from?: Vec2;
  /** search half-width in cells */
  radiusCells?: number;
};

/** Where a body actually stands in a cell. Derived rooms move this off the centre (nav/derived.ts); a
 *  V1-governed cell keeps the centre, which is what every authored V1 stand point already assumes. */
export type PointAt = (c: Cell) => Vec2;

export type ApproachResult = {
  point: Vec2;
  cell: Cell;
  /** distance from `target` to the chosen stand point */
  distance: number;
  /** how well the chosen cell matches `prefer`: 1 = dead behind, −1 = opposite side */
  alignment: number;
  /** "preferred" when the cell lies in the preferred hemisphere, "side" otherwise */
  side: "preferred" | "side";
};

/** How strongly the preferred direction may pull the choice, in units. Deliberately under one cell: a cell
 *  three-quarters of a cell further away may win on direction, nothing more. */
const DIRECTION_WEIGHT = CELL * 0.75;

/** Nearest CONNECTED, CLEAR cell to `target`, preferring `prefer`. Null when the search window holds none. */
export function resolveApproach(q: ApproachQuery, walk: CellPredicate, connected: Connectivity, pointAt: PointAt = cellCentre): ApproachResult | null {
  const start = worldToCell(q.from ?? q.target);
  const span = q.radiusCells ?? 6;
  const len = q.prefer ? Math.hypot(q.prefer.x, q.prefer.z) || 1 : 1;
  const px = q.prefer ? q.prefer.x / len : 0, pz = q.prefer ? q.prefer.z / len : 0;
  let best: ApproachResult | null = null;
  let bestScore = -Infinity;
  for (let dy = -span; dy <= span; dy++)
    for (let dx = -span; dx <= span; dx++) {
      const cell: Cell = { cx: start.cx + dx, cy: start.cy + dy };
      if (!walk(cell.cx, cell.cy) || !connected.has(cell)) continue;
      const point = pointAt(cell);
      const vx = point.x - q.target.x, vz = point.z - q.target.z;
      const m = Math.hypot(vx, vz) || 1;
      const alignment = (vx / m) * px + (vz / m) * pz;
      const score = -m + DIRECTION_WEIGHT * alignment;
      if (score > bestScore) {
        bestScore = score;
        best = { point, cell, distance: dist(point, q.target), alignment, side: alignment > 0.2 ? "preferred" : "side" };
      }
    }
  return best;
}

/** Same, but throws with a legible message — for room data that must not silently lose a stand point. */
export function requireApproach(label: string, q: ApproachQuery, walk: CellPredicate, connected: Connectivity, pointAt?: PointAt): ApproachResult {
  const r = resolveApproach(q, walk, connected, pointAt);
  if (!r) throw new Error(`nav/approach: no connected, body-clear stand cell for ${label} near ${q.target.x},${q.target.z}`);
  return r;
}
