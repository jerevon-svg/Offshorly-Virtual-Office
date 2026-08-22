// frontend/src/data/clusterSlots.ts
//
// Shared geometry contract for "cluster formation": given the members of a
// conversation cluster and one anchor point, deterministically computes
// where each member should stand once gathered, so every client
// independently derives the SAME email -> Pt mapping for the RESTING
// position with zero server-side position broadcast. (Only the walking
// animation toward these slots gets broadcast, separately, in a later
// stage — this file only computes the final resting slots.)
//
// Determinism comes from sorting `members` before assignment: the same
// membership set, regardless of the order callers happen to pass it in,
// always yields the identical mapping.

import type { Pt } from "./walkable-zones";
import { CELL, worldToCell, cellToWorld, nearestWalkableConnectedTo } from "./officeGrid";

// Exported so tests can derive the max distance any assigned slot can ever
// land from the anchor (DEFAULT_RADIUS + MAX_RADIUS_STEPS*CELL), bounding how
// far any member (including a repositioning incumbent on a membership
// change) could ever need to walk.
export const DEFAULT_RADIUS = CELL; // ~1 tile radius → n=2 stand 2 tiles/32px apart (close, conversational); tighter than the old 2.5 that read as 5 tiles apart
export const MAX_RADIUS_STEPS = 6; // widen the ring this many times before giving up on a collision-free, walkable slot
const START_ANGLE = -Math.PI / 2; // top of the ring, for a stable/consistent visual arrangement

/**
 * Computes where each member of a conversation cluster should stand around
 * `anchor`, arranged in a ring/arc with consistent spacing, snapped to
 * walkable tiles reachable from the anchor, with no two members sharing a
 * tile. Pure and deterministic: sorts `members` internally so callers never
 * need to agree on array order. Never throws.
 */
export function assignClusterSlots(members: string[], anchor: Pt, opts?: { radius?: number }): Record<string, Pt> {
  const sorted = [...members].sort();
  const result: Record<string, Pt> = {};
  if (sorted.length === 0) return result;

  // Guard against non-finite anchors (NaN/Infinity): without this, the
  // spiral fallback below computes NaN cell coordinates that all collapse to
  // the same "NaN,NaN" key, and the collision-retry loop spins forever
  // instead of terminating. Fall back to a safe, finite anchor so every
  // downstream computation (ring math + spiral fallback) stays finite.
  const safeAnchor: Pt =
    Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? anchor : { x: 0, y: 0 };

  const anchorCell = worldToCell(safeAnchor);

  if (sorted.length === 1) {
    const snapped = nearestWalkableConnectedTo(anchorCell.cx, anchorCell.cy, anchorCell.cx, anchorCell.cy);
    result[sorted[0]] = cellToWorld(snapped.cx, snapped.cy);
    return result;
  }

  const radius = opts?.radius ?? DEFAULT_RADIUS;
  const n = sorted.length;
  const usedCells = new Set<string>();

  sorted.forEach((email, i) => {
    const angle = START_ANGLE + (i * 2 * Math.PI) / n;
    let slot: Pt | null = null;

    for (let step = 0; step <= MAX_RADIUS_STEPS && !slot; step++) {
      const r = radius + step * CELL;
      // Determinism here relies on Math.cos/Math.sin converging to the same
      // value across engines plus the integer-cell snap below absorbing any
      // sub-cell float drift; if a cross-browser desync ever surfaces, look
      // here first.
      const candidate = { x: safeAnchor.x + r * Math.cos(angle), y: safeAnchor.y + r * Math.sin(angle) };
      const cCell = worldToCell(candidate);
      const snapped = nearestWalkableConnectedTo(cCell.cx, cCell.cy, anchorCell.cx, anchorCell.cy);
      const key = `${snapped.cx},${snapped.cy}`;
      if (!usedCells.has(key)) {
        usedCells.add(key);
        slot = cellToWorld(snapped.cx, snapped.cy);
      }
    }

    if (!slot) {
      // Degrade gracefully: a pathologically blocked scene shouldn't throw or
      // stack two members on one tile. Spiral outward by cell index — no
      // walkability guarantee here, but each index gets a strictly unique
      // offset, so overlap is still impossible even in this last-resort path.
      let spiral = MAX_RADIUS_STEPS + 1;
      let fallbackCell: { cx: number; cy: number };
      let key: string;
      do {
        fallbackCell = { cx: anchorCell.cx + spiral, cy: anchorCell.cy };
        key = `${fallbackCell.cx},${fallbackCell.cy}`;
        spiral++;
      } while (usedCells.has(key));
      usedCells.add(key);
      slot = cellToWorld(fallbackCell.cx, fallbackCell.cy);
    }

    result[email] = slot;
  });

  return result;
}
