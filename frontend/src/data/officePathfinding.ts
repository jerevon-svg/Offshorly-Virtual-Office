import { officeAssetLayers, bonLayer } from "./office-layout";
import type { Pt } from "./walkable-zones";
import { CELL, worldToCell, cellToWorld, isWalkable, nearestWalkable, nearestWalkableConnectedTo, floodFillFrom } from "./officeGrid";
import { aStar, type Cell } from "./gridAStar";

export type TileDestination = { valid: boolean; cellCenter: Pt };

// Right-click-to-move validation: is `point` a walkable tile connected to
// `start`'s region? Deliberately does NOT use findPath's
// nearestWalkableConnectedTo goal-snapping — that "nearest reachable"
// substitution is correct for internal fixed-goal callers (Walk To/Move to
// Room/Sit Here), but an arbitrary map click on a blocked or disconnected
// tile must simply fail, never silently walk to a nearby substitute tile.
// Returns the clicked tile's cell-center in the same top-left Pt basis
// findPath/walkTo expect, for both the ring-feedback anchor and (when valid)
// the findPath goal.
export function classifyDestination(start: Pt, point: Pt): TileDestination {
  const startCenter = { x: start.x + half.x, y: start.y + half.y };
  const s = worldToCell(startCenter);
  const t = worldToCell(point);
  const w = cellToWorld(t.cx, t.cy);
  const cellCenter = { x: w.x - half.x, y: w.y - half.y };

  if (!isWalkable(t.cx, t.cy)) return { valid: false, cellCenter };

  const sSnapped = isWalkable(s.cx, s.cy) ? s : nearestWalkable(s.cx, s.cy);
  const region = floodFillFrom(sSnapped);
  return { valid: region.has(`${t.cx},${t.cy}`), cellCenter };
}

const roomLayers = officeAssetLayers.filter((l) => l.kind === "room");

export function roomOf(p: Pt): { id: string } | null {
  for (const l of roomLayers) {
    if (p.x >= l.x && p.x <= l.x + l.width && p.y >= l.y && p.y <= l.y + l.height) return { id: l.id };
  }
  return null;
}

const half = { x: bonLayer.width / 2, y: bonLayer.height / 2 };

// Fast-path clear-line check: samples the straight segment a->b at CELL/2
// intervals and bails if any sampled point's cell isn't walkable. Also
// samples across bon's body width (not just the center line) at each step, so
// furniture that would clip a shoulder while the center line reads "clear"
// isn't missed — bon's box is ~23.5px wide at CELL=32, so a center-line-only
// check can straddle a 1-cell-wide obstacle undetected.
function segmentClearOnGrid(a: Pt, b: Pt): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const step = CELL / 2;
  const steps = Math.max(1, Math.ceil(dist / step));

  // Unit vector along travel direction, and its perpendicular, scaled to
  // bon's half-width so we sample both body edges as well as the center.
  const dirX = dist > 0 ? (b.x - a.x) / dist : 0;
  const dirY = dist > 0 ? (b.y - a.y) / dist : 0;
  const perpX = -dirY;
  const perpY = dirX;
  const halfWidth = half.x; // bon's half body width in px
  const offsets = [-halfWidth, 0, halfWidth];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cxWorld = a.x + (b.x - a.x) * t;
    const cyWorld = a.y + (b.y - a.y) * t;
    for (const off of offsets) {
      const x = cxWorld + perpX * off;
      const y = cyWorld + perpY * off;
      const { cx, cy } = worldToCell({ x, y });
      if (!isWalkable(cx, cy)) return false;
    }
  }
  return true;
}

function dirOf(a: Cell, b: Cell): string {
  const dx = Math.sign(b.cx - a.cx);
  const dy = Math.sign(b.cy - a.cy);
  return `${dx},${dy}`;
}

// Collapses consecutive same-direction steps into single waypoints — keeps
// only the first cell, the last cell, and any cell where the incoming
// direction differs from the previous kept step's direction (i.e. corners).
function mergeCollinear(cells: Cell[]): Cell[] {
  if (cells.length <= 2) return cells;
  const kept: Cell[] = [cells[0]];
  let prevDir = dirOf(cells[0], cells[1]);
  for (let i = 1; i < cells.length - 1; i++) {
    const dir = dirOf(cells[i], cells[i + 1]);
    if (dir !== prevDir) {
      kept.push(cells[i]);
      prevDir = dir;
    }
  }
  kept.push(cells[cells.length - 1]);
  return kept;
}

export function findPath(
  start: Pt,
  goal: Pt,
  _startRoomId?: string | null,
  _goalRoomId?: string | null,
): Pt[] {
  const startCenter = { x: start.x + half.x, y: start.y + half.y };
  const goalCenter = { x: goal.x + half.x, y: goal.y + half.y };

  if (segmentClearOnGrid(startCenter, goalCenter)) return [goal]; // fast path, no detour needed

  let s = worldToCell(startCenter);
  let g = worldToCell(goalCenter);
  if (!isWalkable(s.cx, s.cy)) s = nearestWalkable(s.cx, s.cy);

  // Connectivity-aware goal snapping: a goal cell (or the nearestWalkable of
  // an unwalkable one) can land in a furniture-enclosed pocket that has no
  // path to the start's region at all (e.g. reception-room's isolated top
  // band, or seats behind furniture with no floodfill-reachable connection).
  // Snapping via plain nearestWalkable there just moves the goal to another
  // cell in the SAME unreachable pocket, and A* correctly returns null — the
  // old code then fell back to a raw straight line through walls. Instead,
  // snap the goal to the nearest cell that's actually in the start's
  // connected region before running A*.
  const startRegion = floodFillFrom(s);
  if (!startRegion.has(`${g.cx},${g.cy}`)) {
    g = nearestWalkableConnectedTo(g.cx, g.cy, s.cx, s.cy);
  }

  const cells = aStar(s, g);
  if (!cells || cells.length === 0) return [goal]; // genuine last-resort safety net — shouldn't happen once goal is connectivity-snapped

  const merged = mergeCollinear(cells);
  const pts: Pt[] = merged.slice(1).map((c) => {
    const w = cellToWorld(c.cx, c.cy);
    return { x: w.x - half.x, y: w.y - half.y }; // back to top-left basis for walkTo/characterOverrides
  });
  if (pts.length > 0) pts[pts.length - 1] = goal; // land exactly on the standoff point, not a cell center
  else pts.push(goal);
  return pts;
}
