// Design Room true-3D POC — NAVIGATION ADAPTER over the PRODUCTION grid/A*.
//
// Reuses, READ-ONLY and unchanged:
//   data/officePathfinding.ts  findPath(), classifyDestination()   (A* + goal snapping)
//   data/officeGrid.ts         CELL/COLS/ROWS, isWalkable(), STAND_CELLS, DOOR_CELLS, worldToCell/cellToWorld
//   data/officeWalkabilityGrid.ts  the hand-authored walkability rows those build on
//
// COORDINATE MAPPING (documented here, nowhere else):
//   * The production grid lives in FRAME units of the whole office (1440×1244,
//     16-unit cells). The 3D room is ROOM-RELATIVE: x3d = frameX − ROOM.x,
//     z3d = frameY − ROOM.y (screen-down y becomes world +z). No scaling.
//   * Production treats the character's LAYER CENTRE (top-left + half of bon's
//     manifest box) as the point that occupies a grid cell. In 3D the ground
//     point under the avatar's feet plays that role. So:
//       groundFrame = (x3d + ROOM.x, z3d + ROOM.y)
//       topLeft     = groundFrame − half          (what findPath/classifyDestination expect as start)
//     and every returned top-left point is converted back with + half.
//     Consequence (deliberate): in the 2D VO the sprite's feet hang ~18 units
//     below its cell; in 3D the feet ARE on the cell, so a 3D character stands
//     about one cell "north" of where its 2D sprite's feet would appear.
//   * classifyDestination's `point` argument is a CENTRE point (it calls
//     worldToCell on it directly), so the clicked ground point is passed as-is
//     in frame units; its returned cellCenter is top-left basis.
//   * Clicks are limited to this room's floor (insideFloor) before the
//     production logic runs — the production grid also knows the corridors
//     outside the room, but the prototype has no geometry there.
import { classifyDestination, findPath } from "../../data/officePathfinding";
import { CELL, COLS, ROWS, DOOR_CELLS, STAND_CELLS, isWalkable } from "../../data/officeGrid";
import type { DynamicNav } from "./edit";
import { aStarWith, floodFillWith, mergeCollinear, nearestWalkableWith } from "./edit";
import { bonLayer } from "../../data/office-layout";
import type { Pt } from "../../data/walkable-zones";
import { ROOM } from "./layout";
import { insideFloor } from "./avatar";

export type Ground = { x: number; z: number };
const HALF = { x: bonLayer.width / 2, y: bonLayer.height / 2 };

export function groundToFrameCentre(g: Ground): Pt {
  return { x: g.x + ROOM.x, y: g.z + ROOM.y };
}
export function frameCentreToGround(p: Pt): Ground {
  return { x: p.x - ROOM.x, z: p.y - ROOM.y };
}
export function groundToTopLeft(g: Ground): Pt {
  const c = groundToFrameCentre(g);
  return { x: c.x - HALF.x, y: c.y - HALF.y };
}
export function topLeftToGround(p: Pt): Ground {
  return frameCentreToGround({ x: p.x + HALF.x, y: p.y + HALF.y });
}

export type NavResult =
  | { ok: true; destination: Ground; path: Ground[]; cell: { cx: number; cy: number } }
  | { ok: false; reason: "outside-room" | "unwalkable" | "unreachable"; destination: Ground | null; cell: { cx: number; cy: number } | null };

/**
 * Resolve a clicked ground point to a walkable destination and a path from the
 * avatar's current ground position, using the production classifier + A*.
 */
export function planWalk(from: Ground, clicked: Ground, dyn?: DynamicNav): NavResult {
  if (!insideFloor(clicked.x, clicked.z)) return { ok: false, reason: "outside-room", destination: null, cell: null };
  const start = groundToTopLeft(from);
  const point = groundToFrameCentre(clicked);
  const cell = { cx: Math.floor(point.x / CELL), cy: Math.floor(point.y / CELL) };
  if (dyn?.hasObstacles) return planWalkDynamic(from, cell, dyn);
  // no dynamic obstacle → PRODUCTION classifier + A*, unchanged
  const { valid, cellCenter } = classifyDestination(start, point);
  const destination = topLeftToGround(cellCenter);
  if (!valid) return { ok: false, reason: isWalkable(cell.cx, cell.cy) ? "unreachable" : "unwalkable", destination, cell };
  const path = findPath(start, cellCenter).map(topLeftToGround);
  return { ok: true, destination, path, cell };
}

/**
 * Dynamic branch (edit.ts): same steps as production findPath/classifyDestination — cell
 * snapping, connectivity check, goal snapping to the nearest connected cell, A* with
 * production movement rules, collinear merge, exact landing on the destination — but over
 * the composed predicate `production isWalkable && !dynamically blocked`.
 */
function planWalkDynamic(from: Ground, cell: { cx: number; cy: number }, dyn: DynamicNav): NavResult {
  const walk = (cx: number, cy: number) => dyn.walkable(cx, cy);
  const fc = groundToFrameCentre(from);
  let s = { cx: Math.floor(fc.x / CELL), cy: Math.floor(fc.y / CELL) };
  const destination = frameCentreToGround({ x: (cell.cx + 0.5) * CELL, y: (cell.cy + 0.5) * CELL });
  if (!walk(cell.cx, cell.cy)) return { ok: false, reason: "unwalkable", destination, cell };
  if (!walk(s.cx, s.cy)) s = nearestWalkableWith(walk, s);
  const region = floodFillWith(walk, s);
  let g = cell;
  if (!region.has(`${g.cx},${g.cy}`)) g = nearestWalkableWith(walk, g, region);
  const cells = aStarWith(walk, s, g);
  if (!cells || cells.length === 0) return { ok: false, reason: "unreachable", destination, cell };
  const pts = mergeCollinear(cells).slice(1).map((c) => frameCentreToGround({ x: (c.cx + 0.5) * CELL, y: (c.cy + 0.5) * CELL }));
  const dest = frameCentreToGround({ x: (g.cx + 0.5) * CELL, y: (g.cy + 0.5) * CELL });
  if (pts.length) pts[pts.length - 1] = dest;
  else pts.push(dest);
  return { ok: true, destination: dest, path: pts, cell: g };
}

// ---- grid visualisation data (this room's window of the production grid) --------------
export type CellKind = "walkable" | "blocked" | "stand" | "door";
export type GridCell = { cx: number; cy: number; kind: CellKind; centre: Ground };

export function roomGridCells(): GridCell[] {
  const cx0 = Math.max(0, Math.floor(ROOM.x / CELL));
  const cx1 = Math.min(COLS - 1, Math.floor((ROOM.x + ROOM.width) / CELL));
  const cy0 = Math.max(0, Math.floor(ROOM.y / CELL));
  const cy1 = Math.min(ROWS - 1, Math.floor((ROOM.y + ROOM.height) / CELL));
  const out: GridCell[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const key = `${cx},${cy}`;
      const walkable = isWalkable(cx, cy);
      const kind: CellKind = DOOR_CELLS.has(key) ? "door" : STAND_CELLS.has(key) ? "stand" : walkable ? "walkable" : "blocked";
      const centre = frameCentreToGround({ x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL });
      if (!insideFloor(centre.x, centre.z)) continue; // only cells whose centre lies on this room's floor (walls / corridors outside are not part of the prototype)
      out.push({ cx, cy, kind, centre });
    }
  }
  return out;
}

export const CELL_SIZE = CELL;
