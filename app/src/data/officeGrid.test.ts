import { describe, expect, it } from "vitest";
import { STAND_CELLS, isWalkable, isStandHere, floodFillFrom, nearestWalkableConnectedTo } from "./officeGrid";

// Known-open corridor anchor (world px 500,790 -> cell 15,24), same anchor
// used by parse-walkable.cjs's connectDoorsToMainRegion and the existing
// officePathfinding/officeGrid connectivity checks.
const ANCHOR = { cx: 15, cy: 24 };

describe("STAND_CELLS invariant", () => {
  it("every stand-here (purple) cell is walkable and reachable from the anchor", () => {
    // Currently STAND_CELLS may be empty (no purple painted yet) — this loop
    // vacuously passes in that case, acting as a backstop for when purple
    // gets hand-painted into walkable.png later.
    const region = floodFillFrom(ANCHOR);
    for (const key of STAND_CELLS) {
      const [cx, cy] = key.split(",").map(Number);
      expect(isWalkable(cx, cy)).toBe(true);
      expect(isStandHere(cx, cy)).toBe(true);
      const nearest = nearestWalkableConnectedTo(cx, cy, ANCHOR.cx, ANCHOR.cy);
      expect(region.has(`${nearest.cx},${nearest.cy}`) || region.has(key)).toBe(true);
    }
  });
});
