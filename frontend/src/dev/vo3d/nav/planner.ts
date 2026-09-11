// vo3d nav — click → destination → path, over composed walkability. World coordinates throughout.
// Steps mirror production findPath/classifyDestination: cell snapping, connectivity check, goal
// snapping to the nearest connected cell, A*, collinear merge, exact landing on the destination.
import { cellCentre, cellKey, worldToCell, type Cell } from "../adapters/v1Grid";
import type { Vec2 } from "../core/coords";
import { aStar, floodFill, mergeCollinear, nearestWalkable } from "./pathfind";
import type { Walkability } from "./Walkability";

export type NavResult =
  | { ok: true; destination: Vec2; path: Vec2[]; cell: Cell }
  | { ok: false; reason: "outside-room" | "unwalkable" | "unreachable"; destination: Vec2 | null; cell: Cell | null };

/** `inBounds` restricts clicks to floors the world actually models (the V1 grid also knows corridors we have no geometry for). */
export function planWalk(from: Vec2, clicked: Vec2, walkability: Walkability, inBounds: (p: Vec2) => boolean): NavResult {
  if (!inBounds(clicked)) return { ok: false, reason: "outside-room", destination: null, cell: null };
  const walk = walkability.walkable;
  const cell = worldToCell(clicked);
  const destination = cellCentre(cell);
  if (!walk(cell.cx, cell.cy)) return { ok: false, reason: "unwalkable", destination, cell };
  let s = worldToCell(from);
  if (!walk(s.cx, s.cy)) s = nearestWalkable(walk, s);
  const region = floodFill(walk, s);
  let g = cell;
  if (!region.has(cellKey(g))) g = nearestWalkable(walk, g, region);
  const cells = aStar(walk, s, g);
  if (!cells || cells.length === 0) return { ok: false, reason: "unreachable", destination, cell };
  const pts = mergeCollinear(cells).slice(1).map(cellCentre);
  const dest = cellCentre(g);
  if (pts.length) pts[pts.length - 1] = dest;
  else pts.push(dest);
  return { ok: true, destination: dest, path: pts, cell: g };
}
