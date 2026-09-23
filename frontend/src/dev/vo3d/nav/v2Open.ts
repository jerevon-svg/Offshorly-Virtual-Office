// vo3d nav — V2-LOCAL WALKABILITY ADDITIONS.
//
// The V1 grid is READ-ONLY and stays the authority everywhere it and the reconstruction agree. But V1 was
// authored against the flat 2.5D artwork, and in two places the true-3D reconstruction has MORE floor than
// the painting did: Meeting's and Project's north walls were built in 4B as solid masses swallowing the
// whole art bounding box, and 4C replaced them with real 12-unit walls. The strip they gave back is real,
// tiled, reachable floor that V1 still marks blocked — "old 2D blocking" with no physical cause.
//
// This layer is the smallest honest correction: a room declares a BAND of its own floor plus the solids
// standing in it, and cells whose centre lies in the band and outside every solid become walkable.
//
// Deliberately narrow:
//   • it only ADDS cells, and only inside a band a room explicitly declares
//   • it is judged at the SAME granularity V1 uses (cell centre vs solid), not a body-radius test —
//     V1's own lanes let a body overhang, and this must not be stricter than the grid it extends
//   • the V1 grid file is untouched, and nothing outside a declared band can change
import type { Rect } from "../core/coords";
import type { CellPredicate } from "./pathfind";
import { CELL, cellCentre } from "../adapters/v1Grid";

/** A patch of reconstructed floor V1 does not know about, and the solids standing on it. */
export type OpenBand = {
  /** the floor this band covers (world) */
  rect: Rect;
  /** things standing on it that a cell centre may not land inside */
  solids: Rect[];
  /** for diagnostics */
  id: string;
};

const inside = (x: number, z: number, r: Rect): boolean => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d;

/** cell predicate that is TRUE for cells the bands open (and false everywhere else) */
export function openedLayer(bands: readonly OpenBand[]): CellPredicate {
  if (!bands.length) return () => false;
  return (cx, cy) => {
    const c = cellCentre({ cx, cy });
    for (const b of bands) {
      if (!inside(c.x, c.z, b.rect)) continue;
      if (b.solids.some((s) => inside(c.x, c.z, s))) continue;
      return true;
    }
    return false;
  };
}

/** The static layer the V2 world actually uses: the READ-ONLY V1 grid, plus the bands above. */
export const v2Static = (v1: CellPredicate, opened: CellPredicate): CellPredicate => (cx, cy) => v1(cx, cy) || opened(cx, cy);

/** every cell a band opens, for tests and NavDebug */
export function openedCells(bands: readonly OpenBand[]): { cx: number; cy: number }[] {
  const out: { cx: number; cy: number }[] = [];
  const open = openedLayer(bands);
  for (const b of bands) {
    for (let cy = Math.floor(b.rect.z / CELL); cy <= Math.floor((b.rect.z + b.rect.d) / CELL); cy++)
      for (let cx = Math.floor(b.rect.x / CELL); cx <= Math.floor((b.rect.x + b.rect.w) / CELL); cx++)
        if (open(cx, cy) && !out.some((o) => o.cx === cx && o.cy === cy)) out.push({ cx, cy });
  }
  return out;
}
