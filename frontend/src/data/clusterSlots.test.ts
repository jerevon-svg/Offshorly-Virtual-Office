import { describe, expect, it } from "vitest";
import { assignClusterSlots, DEFAULT_RADIUS, MAX_RADIUS_STEPS } from "./clusterSlots";
import { isWalkable, worldToCell, floodFillFrom, nearestWalkable, CELL } from "./officeGrid";

// Known-open corridor anchor (world px 500,790) — same anchor used by
// officeGrid.test.ts's connectivity checks, guaranteed walkable and
// well-connected, so ring positions around it have room to fan out.
const ANCHOR_WORLD = { x: 500, y: 790 };

function cellKey(p: { x: number; y: number }): string {
  const { cx, cy } = worldToCell(p);
  return `${cx},${cy}`;
}

describe("assignClusterSlots", () => {
  it("assigns 2 distinct, non-overlapping slots for 2 members", () => {
    const slots = assignClusterSlots(["b@x.com", "a@x.com"], ANCHOR_WORLD);
    const keys = Object.keys(slots);
    expect(keys).toHaveLength(2);
    const cellA = cellKey(slots["a@x.com"]);
    const cellB = cellKey(slots["b@x.com"]);
    expect(cellA).not.toBe(cellB);
  });

  it("places 2 members close together (conversational spacing, not spread apart)", () => {
    const slots = assignClusterSlots(["a@x.com", "b@x.com"], ANCHOR_WORLD);
    const [p, q] = Object.values(slots);
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    expect(dist).toBeGreaterThanOrEqual(CELL);        // distinct, non-overlapping
    expect(dist).toBeLessThanOrEqual(2.5 * CELL);     // regression guard vs the old ~80px gap
  });

  it("assigns 3 distinct, non-overlapping slots roughly symmetric around the anchor", () => {
    const members = ["c@x.com", "a@x.com", "b@x.com"];
    const slots = assignClusterSlots(members, ANCHOR_WORLD);
    const pts = Object.values(slots);
    expect(pts).toHaveLength(3);

    const cellKeys = new Set(pts.map((p) => cellKey(p)));
    expect(cellKeys.size).toBe(3);

    // Roughly symmetric: average displacement from the anchor across all
    // members should be small relative to each member's own displacement
    // (a ring/arc around the anchor cancels out, unlike e.g. a line to one side).
    const dists = pts.map((p) => Math.hypot(p.x - ANCHOR_WORLD.x, p.y - ANCHOR_WORLD.y));
    const avgDist = dists.reduce((a, b) => a + b, 0) / dists.length;
    const meanX = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const meanY = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const centroidOffset = Math.hypot(meanX - ANCHOR_WORLD.x, meanY - ANCHOR_WORLD.y);
    expect(centroidOffset).toBeLessThan(avgDist);
  });

  it("is deterministic regardless of input array order", () => {
    const forward = ["alice@x.com", "bob@x.com", "carol@x.com", "dave@x.com"];
    const shuffled = ["dave@x.com", "carol@x.com", "alice@x.com", "bob@x.com"];

    const slotsA = assignClusterSlots(forward, ANCHOR_WORLD);
    const slotsB = assignClusterSlots(shuffled, ANCHOR_WORLD);

    expect(slotsB).toEqual(slotsA);
  });

  it("places every returned slot on a walkable tile", () => {
    const members = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"];
    const slots = assignClusterSlots(members, ANCHOR_WORLD);
    for (const p of Object.values(slots)) {
      const { cx, cy } = worldToCell(p);
      expect(isWalkable(cx, cy)).toBe(true);
    }
  });

  it("keeps every slot connected to the anchor's walkable region", () => {
    const members = ["a@x.com", "b@x.com", "c@x.com"];
    const slots = assignClusterSlots(members, ANCHOR_WORLD);
    const anchorCell = worldToCell(ANCHOR_WORLD);
    const region = floodFillFrom(
      isWalkable(anchorCell.cx, anchorCell.cy) ? anchorCell : nearestWalkable(anchorCell.cx, anchorCell.cy),
    );
    for (const p of Object.values(slots)) {
      expect(region.has(cellKey(p))).toBe(true);
    }
  });

  it("returns the (snapped) anchor position itself for a single member", () => {
    const slots = assignClusterSlots(["solo@x.com"], ANCHOR_WORLD);
    expect(Object.keys(slots)).toHaveLength(1);
    const { cx, cy } = worldToCell(slots["solo@x.com"]);
    expect(isWalkable(cx, cy)).toBe(true);
  });

  it("returns an empty mapping for zero members without throwing", () => {
    expect(() => assignClusterSlots([], ANCHOR_WORLD)).not.toThrow();
    expect(assignClusterSlots([], ANCHOR_WORLD)).toEqual({});
  });

  it("resolves collisions instead of stacking members on the same tile, even when every ring candidate starts out identical", () => {
    // radius: 0 forces every member's FIRST candidate position to be the
    // exact anchor point (same cell) — a deliberate collision-forcing setup.
    // The algorithm must widen the search per member so none of them stack.
    const members = Array.from({ length: 10 }, (_, i) => `member${i}@x.com`);
    const slots = assignClusterSlots(members, ANCHOR_WORLD, { radius: 0 });
    const keys = Object.values(slots).map((p) => cellKey(p));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never throws even in a degenerate/blocked scenario (far off-grid anchor)", () => {
    const members = Array.from({ length: 6 }, (_, i) => `m${i}@x.com`);
    const offGrid = { x: -100000, y: -100000 };
    expect(() => assignClusterSlots(members, offGrid)).not.toThrow();
    const slots = assignClusterSlots(members, offGrid);
    const keys = Object.values(slots).map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length); // still no two members stacked, even off-grid
  });

  it("keeps every slot within DEFAULT_RADIUS + MAX_RADIUS_STEPS*CELL of the anchor, for N=2..5 members (compactness bound)", () => {
    const maxDist = DEFAULT_RADIUS + MAX_RADIUS_STEPS * CELL;
    for (let n = 2; n <= 5; n++) {
      const members = Array.from({ length: n }, (_, i) => `p${i}@x.com`);
      const slots = assignClusterSlots(members, ANCHOR_WORLD);
      for (const p of Object.values(slots)) {
        const dist = Math.hypot(p.x - ANCHOR_WORLD.x, p.y - ANCHOR_WORLD.y);
        expect(dist).toBeLessThanOrEqual(maxDist);
      }
    }
  });

  it(
    "returns quickly (does not hang) and yields finite Pts for a non-finite anchor",
    { timeout: 2000 },
    () => {
      const members = Array.from({ length: 4 }, (_, i) => `n${i}@x.com`);

      const nanAnchor = { x: NaN, y: NaN };
      const slotsNaN = assignClusterSlots(members, nanAnchor);
      expect(Object.keys(slotsNaN)).toHaveLength(members.length);
      for (const p of Object.values(slotsNaN)) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }

      const infAnchor = { x: Infinity, y: -Infinity };
      const slotsInf = assignClusterSlots(members, infAnchor);
      expect(Object.keys(slotsInf)).toHaveLength(members.length);
      for (const p of Object.values(slotsInf)) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    },
  );
});
