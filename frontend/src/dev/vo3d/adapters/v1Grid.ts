// vo3d adapter — READ-ONLY view of the production walkability grid.
// The V1 grid is in frame units = world units, so a world point maps to a cell directly.
import { CELL, COLS, ROWS, DOOR_CELLS, STAND_CELLS, isWalkable } from "../../../data/officeGrid";
import type { Vec2 } from "../core/coords";

export { CELL, COLS, ROWS };
export type Cell = { cx: number; cy: number };
export const cellKey = (c: Cell): string => `${c.cx},${c.cy}`;
export const worldToCell = (p: Vec2): Cell => ({ cx: Math.floor(p.x / CELL), cy: Math.floor(p.z / CELL) });
export const cellCentre = (c: Cell): Vec2 => ({ x: (c.cx + 0.5) * CELL, z: (c.cy + 0.5) * CELL });
/** the static walkability layer: production grid, never mutated */
export const v1Static = (cx: number, cy: number): boolean => isWalkable(cx, cy);
export const isStandCell = (c: Cell): boolean => STAND_CELLS.has(cellKey(c));
export const isDoorCell = (c: Cell): boolean => DOOR_CELLS.has(cellKey(c));
