// vo3d nav — click → destination → path, over composed walkability. World coordinates throughout.
// Steps mirror production findPath/classifyDestination: cell snapping, connectivity check, goal
// snapping to the nearest connected cell, A*, collinear merge, exact landing on the destination.
import { cellKey, worldToCell, type Cell } from "../adapters/v1Grid";
import type { Vec2 } from "../core/coords";
import { aStar, floodFill, mergeCollinear, nearestWalkable } from "./pathfind";
import type { Walkability } from "./Walkability";

export type NavResult =
  | { ok: true; destination: Vec2; path: Vec2[]; cell: Cell }
  | { ok: false; reason: "outside-world" | "unwalkable" | "unreachable"; destination: Vec2 | null; cell: Cell | null };

/** `inBounds` restricts destinations to the walkable regions the world actually models (room floors that are
 *  reconstructed, shared floor, exterior) — the V1 grid also knows interiors we have no geometry for yet. */
export function planWalk(from: Vec2, clicked: Vec2, walkability: Walkability, inBounds: (p: Vec2) => boolean): NavResult {
  if (!inBounds(clicked)) return { ok: false, reason: "outside-world", destination: null, cell: null };
  const walk = walkability.walkable;
  // In a derived room a cell's stand point is not its centre (nav/derived.ts), so both the WAYPOINTS and the
  // step-validity test come from the layer that owns the cell. Outside one, `pointAt` is cellCentre and
  // `edgeOk` is always true — byte-for-byte the behaviour every V1-governed room already had.
  const pointAt = (c: Cell): Vec2 => walkability.pointOf(c);
  const edgeOk = walkability.edgeOk;
  const cell = worldToCell(clicked);
  const destination = pointAt(cell);
  if (!walk(cell.cx, cell.cy)) return { ok: false, reason: "unwalkable", destination, cell };
  let s = worldToCell(from);
  if (!walk(s.cx, s.cy)) s = nearestWalkable(walk, s);
  const region = floodFill(walk, s, 20000, edgeOk);
  let g = cell;
  if (!region.has(cellKey(g))) g = nearestWalkable(walk, g, region);
  const cells = aStar(walk, s, g, 20000, edgeOk);
  if (!cells || cells.length === 0) return { ok: false, reason: "unreachable", destination, cell };
  // collinear merge is a CELL-INDEX simplification; the points it keeps are still the real stand points
  const pts = mergeCollinear(cells).slice(1).map(pointAt);
  const dest = pointAt(g);
  if (pts.length) pts[pts.length - 1] = dest;
  else pts.push(dest);
  return { ok: true, destination: dest, path: pts, cell: g };
}
