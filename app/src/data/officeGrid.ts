import { CELL, COLS, ROWS, WALK_ROWS } from "./officeWalkabilityGrid";
import type { Pt } from "./walkable-zones";

export { CELL, COLS, ROWS };

function idx(cx: number, cy: number): number {
  return cy * COLS + cx;
}

// Decodes WALK_ROWS (parsed from the hand-authored walkability reference
// image, see app/scripts/parse-walkable.cjs) into the grid's Uint8Array
// format: walkable = 1 for '.' (floor) and '+' (door) cells, blocked = 0 for
// '#' (wall/furniture) and 'o' (interaction point) cells. Also collects every
// 'o' cell into INTERACTION_CELLS for potential future use.
function buildGrid(): { grid: Uint8Array; interactionCells: Set<string> } {
  const g = new Uint8Array(COLS * ROWS);
  const interactionCells = new Set<string>();

  for (let cy = 0; cy < ROWS; cy++) {
    const row = WALK_ROWS[cy] ?? "";
    for (let cx = 0; cx < COLS; cx++) {
      const sym = row[cx];
      if (sym === "." || sym === "+") {
        g[idx(cx, cy)] = 1;
      } else {
        g[idx(cx, cy)] = 0;
        if (sym === "o") interactionCells.add(`${cx},${cy}`);
      }
    }
  }

  return { grid: g, interactionCells };
}

const built = buildGrid();
export const grid = built.grid;
export const INTERACTION_CELLS: Set<string> = built.interactionCells;

export function worldToCell(p: Pt): { cx: number; cy: number } {
  return { cx: Math.floor(p.x / CELL), cy: Math.floor(p.y / CELL) };
}

export function cellToWorld(cx: number, cy: number): Pt {
  return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
}

export function isWalkable(cx: number, cy: number): boolean {
  if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return false;
  return grid[idx(cx, cy)] === 1;
}

export function nearestWalkable(cx: number, cy: number): { cx: number; cy: number } {
  if (isWalkable(cx, cy)) return { cx, cy };
  for (let r = 1; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWalkable(cx + dx, cy + dy)) return { cx: cx + dx, cy: cy + dy };
      }
    }
  }
  return { cx, cy }; // give up, caller handles gracefully
}

// Connectivity-aware alternative to nearestWalkable: finds the closest
// walkable cell to (cx,cy) that's in the SAME flood-fill-connected region as
// (fromCx,fromCy). Prevents snapping a goal into an isolated furniture pocket
// that has no path to the start (see findPath in officePathfinding.ts).
// Flood-fills once from the start, then scans outward in expanding Chebyshev
// rings around the target (like nearestWalkable) checking region membership —
// reuses floodFillFrom rather than duplicating BFS logic.
export function nearestWalkableConnectedTo(
  cx: number,
  cy: number,
  fromCx: number,
  fromCy: number,
): { cx: number; cy: number } {
  const startCell = isWalkable(fromCx, fromCy) ? { cx: fromCx, cy: fromCy } : nearestWalkable(fromCx, fromCy);
  const region = floodFillFrom(startCell);
  if (region.size === 0) return nearestWalkable(cx, cy);

  if (isWalkable(cx, cy) && region.has(`${cx},${cy}`)) return { cx, cy };

  const maxRadius = Math.max(COLS, ROWS);
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const ncx = cx + dx;
        const ncy = cy + dy;
        if (region.has(`${ncx},${ncy}`)) return { cx: ncx, cy: ncy };
      }
    }
  }
  // Region non-empty but somehow nothing found (shouldn't happen) — fall back
  // to the start cell itself, which is guaranteed to be in its own region.
  return startCell;
}

// BFS flood-fill from a known-open corridor cell; returns the set of reachable
// cell keys ("cx,cy"). Used by the connectivity assertion (see officeGrid.test.ts).
export function floodFillFrom(start: { cx: number; cy: number }): Set<string> {
  const seen = new Set<string>();
  if (!isWalkable(start.cx, start.cy)) return seen;
  const queue: { cx: number; cy: number }[] = [start];
  seen.add(`${start.cx},${start.cy}`);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const [dx, dy] of dirs) {
      const nx = cur.cx + dx;
      const ny = cur.cy + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (!isWalkable(nx, ny)) continue;
      seen.add(key);
      queue.push({ cx: nx, cy: ny });
    }
  }
  return seen;
}
