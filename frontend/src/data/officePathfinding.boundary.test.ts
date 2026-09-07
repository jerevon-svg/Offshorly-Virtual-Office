import { describe, expect, it } from "vitest";
import { bonLayer, officeAssetLayers } from "./office-layout";
import { COLS, ROWS, cellToWorld, floodFillFrom, isWalkable, worldToCell } from "./officeGrid";
import { classifyDestination, findPath } from "./officePathfinding";
import { insideOfficeValidator, selfPathLeavesOffice } from "../components/OfficeMap/spawnPlacement";

// Office boundary invariant (2026-09-07): a CHECKED_IN employee can never walk or path onto the
// sidewalk/outside layer; only checkout moves them there. The walkability grid deliberately
// connects the interior to the sidewalk through the entrance corridor (the check-in entry walk and
// the checkout exit walk path along it), so grid connectivity does NOT enforce the invariant — the
// self-movement funnel's allowMove gate (selfPathLeavesOffice) does. This suite pins both facts
// against the real floor plan, grid and pathfinder.
describe("office boundary: checked-in self movement cannot cross onto the sidewalk", () => {
  const AVATAR = { w: bonLayer.width, h: bonLayer.height };
  const half = { x: AVATAR.w / 2, y: AVATAR.h / 2 };
  const sidewalk = officeAssetLayers.find((l) => l.kind === "sidewalk") ?? null;
  const inside = insideOfficeValidator(sidewalk);
  const center = (p: { x: number; y: number }) => ({ x: p.x + half.x, y: p.y + half.y });
  const topLeftOfCell = (c: { cx: number; cy: number }) => {
    const w = cellToWorld(c.cx, c.cy);
    return { x: w.x - half.x, y: w.y - half.y };
  };

  const outsideWalkableCells: { cx: number; cy: number }[] = [];
  const insideWalkableCells: { cx: number; cy: number }[] = [];
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      if (!isWalkable(cx, cy)) continue;
      (inside(cellToWorld(cx, cy)) ? insideWalkableCells : outsideWalkableCells).push({ cx, cy });
    }
  }
  // Avatar top-left positions spread across the interior, in the same basis findPath/moveSelf use.
  const insideStarts = [0, 0.25, 0.5, 0.75, 0.999]
    .map((f) => insideWalkableCells[Math.floor(f * (insideWalkableCells.length - 1))])
    .map(topLeftOfCell);
  const outsideGoals = [{ x: bonLayer.x, y: bonLayer.y }, ...outsideWalkableCells.filter((_, i) => i % 7 === 0).map(topLeftOfCell)];
  const gate = (attendance: "CHECKED_IN" | "CHECKED_OUT" | "UNKNOWN", checkoutBusy: boolean, origin: { x: number; y: number }, path: { x: number; y: number }[]) =>
    selfPathLeavesOffice(attendance, checkoutBusy, inside, AVATAR, origin, path);

  it("sanity: the outside spawn is on a walkable sidewalk cell, and the grid connects it to the interior (so the gate, not connectivity, is the guard)", () => {
    expect(sidewalk).not.toBeNull();
    expect(outsideWalkableCells.length).toBeGreaterThan(0);
    expect(inside(center(bonLayer))).toBe(false);
    const spawnCell = worldToCell(center(bonLayer));
    expect(isWalkable(spawnCell.cx, spawnCell.cy)).toBe(true);
    const spawnRegion = floodFillFrom(spawnCell);
    expect(insideWalkableCells.some((c) => spawnRegion.has(`${c.cx},${c.cy}`))).toBe(true);
    // Consequently the grid alone would let a right-click reach the sidewalk from inside:
    expect(insideStarts.some((s) => classifyDestination(s, center(bonLayer)).valid)).toBe(true);
  });

  it("CHECKED_IN, standing inside: every pathfinder route to any sidewalk point is rejected", () => {
    for (const start of insideStarts) {
      expect(inside(center(start))).toBe(true);
      for (const goal of outsideGoals) {
        const path = findPath(start, goal, null, null);
        expect(path.length).toBeGreaterThan(0);
        expect(gate("CHECKED_IN", false, start, path), `start ${JSON.stringify(start)} → ${JSON.stringify(goal)}`).toBe(true);
        // Also for the raw single-goal path the fast/straight-line branch would produce.
        expect(gate("CHECKED_IN", false, start, [goal])).toBe(true);
      }
    }
  });

  it("CHECKED_IN, standing inside: routes between interior points are untouched (normal movement)", () => {
    for (const start of insideStarts) {
      for (const goal of insideStarts) {
        if (goal === start) continue;
        const path = findPath(start, goal, null, null);
        expect(path.every((p) => inside(center(p)))).toBe(true);
        expect(gate("CHECKED_IN", false, start, path)).toBe(false);
      }
    }
  });

  it("only checkout may move a checked-in employee outside: the checkout flow's own walks pass the gate", () => {
    const [start] = insideStarts;
    const exitPath = findPath(start, { x: bonLayer.x, y: bonLayer.y }, null, null);
    expect(gate("CHECKED_IN", true, start, exitPath)).toBe(false);
  });

  it("a walk that STARTS outside (check-in entry walk after server confirmation) and any CHECKED_OUT/UNKNOWN walk pass the gate", () => {
    const outsideStart = { x: bonLayer.x, y: bonLayer.y };
    const entryPath = findPath(outsideStart, insideStarts[0], null, null);
    expect(gate("CHECKED_IN", false, outsideStart, entryPath)).toBe(false);
    for (const attendance of ["CHECKED_OUT", "UNKNOWN"] as const) {
      expect(gate(attendance, false, insideStarts[0], [{ x: bonLayer.x, y: bonLayer.y }])).toBe(false);
    }
  });
});
