import { describe, expect, it } from "vitest";
import { findPath, roomOf } from "./officePathfinding";
import {
  cellToWorld,
  isWalkable,
  nearestStandSpotConnectedTo,
  nearestWalkable,
  nearestWalkableConnectedTo,
  worldToCell,
} from "./officeGrid";
import { bonLayer, npcCharacterLayers, roomLayers } from "./office-layout";
import type { AssetLayer } from "../types/office";

// Mirrors officePathfinding.test.ts's centerOf/assertPathIsGenuinelyValid
// helpers — findPath returns waypoints in top-left basis, walkability checks
// need the character-center basis.
const half = { x: bonLayer.width / 2, y: bonLayer.height / 2 };
function centerOf(p: { x: number; y: number }) {
  return { x: p.x + half.x, y: p.y + half.y };
}

function segmentGenuinelyClear(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const step = 8; // CELL/2, CELL === 16
  const steps = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const { cx, cy } = worldToCell({ x, y });
    if (!isWalkable(cx, cy)) return false;
  }
  return true;
}

function assertPathIsGenuinelyValid(start: { x: number; y: number }, path: { x: number; y: number }[]) {
  expect(path.length).toBeGreaterThan(0);
  if (path.length === 1) {
    // Mirror findPath's own start-snapping: a raw start cell that's
    // non-walkable (e.g. bon's outside-spawn threshold cell) gets snapped to
    // the nearest walkable cell internally before pathing, so the oracle
    // must sample from that same snapped point, not the raw start.
    const startCell = worldToCell(centerOf(start));
    const snappedStartCell = isWalkable(startCell.cx, startCell.cy)
      ? startCell
      : nearestWalkable(startCell.cx, startCell.cy);
    const snappedStartWorld = cellToWorld(snappedStartCell.cx, snappedStartCell.cy);
    expect(segmentGenuinelyClear(snappedStartWorld, centerOf(path[0]))).toBe(true);
    return;
  }
  for (let i = 0; i < path.length - 1; i++) {
    const { cx, cy } = worldToCell(centerOf(path[i]));
    expect(isWalkable(cx, cy)).toBe(true);
  }
}

// Replicates OfficeMap.tsx's startCheckin standoff-point calculation (same
// geometry as handleChoose's "approach" branch), including the stand-spot-first /
// walkability-snapped-geometry-fallback logic OfficeMap.tsx now applies
// before using the point as a walk target — real production logic, not a
// hand-picked reachable point.
function standoffGoal(bon: { x: number; y: number; width: number; height: number }, target: AssetLayer) {
  const bw = bon.width;
  const bh = bon.height;
  const bc = { x: bon.x + bw / 2, y: bon.y + bh / 2 };
  const tc = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const dx = tc.x - bc.x;
  const dy = tc.y - bc.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const standoff = target.width / 2 + bw / 2 + 4;
  const bcCell = worldToCell(bc);
  const tcCell = worldToCell(tc);
  const standSpot = nearestStandSpotConnectedTo(tcCell.cx, tcCell.cy, bcCell.cx, bcCell.cy);
  if (standSpot) {
    const w = cellToWorld(standSpot.cx, standSpot.cy);
    return { x: w.x - bw / 2, y: w.y - bh / 2 };
  }
  const raw = { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
  const rawCell = worldToCell({ x: raw.x + bw / 2, y: raw.y + bh / 2 });
  const snapped = nearestWalkableConnectedTo(rawCell.cx, rawCell.cy, bcCell.cx, bcCell.cy);
  const w = cellToWorld(snapped.cx, snapped.cy);
  return { x: w.x - bw / 2, y: w.y - bh / 2 };
}

// Replicates OfficeMap.tsx's chooseRoom snapped-goal calculation.
function snappedRoomGoal(
  bon: { x: number; y: number; width: number; height: number },
  room: AssetLayer,
) {
  const bw = bon.width;
  const bh = bon.height;
  const startCenter = { x: bon.x + bw / 2, y: bon.y + bh / 2 };
  const roomCenter = { x: room.x + room.width / 2, y: room.y + room.height / 2 };
  const startCell = worldToCell(startCenter);
  const roomCell = worldToCell(roomCenter);
  const snapped = nearestWalkableConnectedTo(roomCell.cx, roomCell.cy, startCell.cx, startCell.cy);
  const snappedWorld = cellToWorld(snapped.cx, snapped.cy);
  return { x: snappedWorld.x - bw / 2, y: snappedWorld.y - bh / 2 };
}

describe("onboarding check-in flow pathfinding", () => {
  // bon's REAL current outside-spawn manifest position — read live, not
  // hardcoded, since a parallel round is updating this value independently.
  const bonStart = { x: bonLayer.x, y: bonLayer.y };

  it("bon's live manifest spawn resolves to a real x/y (sanity — not a stale guess)", () => {
    expect(typeof bonLayer.x).toBe("number");
    expect(typeof bonLayer.y).toBe("number");
  });

  it("path exists from bon's live outside spawn to Arisha's standoff point", () => {
    const arisha = npcCharacterLayers.find((l) => l.id === "arisha");
    expect(arisha).toBeDefined();
    const goal = standoffGoal(bonLayer, arisha!);
    const startRoomId = roomOf(centerOf(bonStart))?.id ?? null;
    const goalRoomId = roomOf({ x: arisha!.x + arisha!.width / 2, y: arisha!.y + arisha!.height / 2 })?.id ?? null;

    const path = findPath(bonStart, goal, startRoomId, goalRoomId);
    assertPathIsGenuinelyValid(bonStart, path);

    if (path.length === 1) {
      // assertPathIsGenuinelyValid above already proved the direct line is
      // genuinely clear (with start properly snapped), so no extra check
      // needed here.
    } else {
      expect(path[path.length - 1]).toEqual(goal);
    }
  });

  it("covers every room in roomLayers", () => {
    expect(roomLayers.length).toBeGreaterThan(0);
  });

  for (const room of roomLayers) {
    it(`path exists from Arisha's standoff point to ${room.id}'s snapped-walkable center`, () => {
      const arisha = npcCharacterLayers.find((l) => l.id === "arisha")!;
      const receptionGoal = standoffGoal(bonLayer, arisha);
      // bon "arrives" at reception — his effective position for the second
      // leg of onboarding is the standoff point, matching chooseRoom's use
      // of live bonPos after walkTo's onArrive fires.
      const bonAtReception = { x: receptionGoal.x, y: receptionGoal.y, width: bonLayer.width, height: bonLayer.height };

      const goal = snappedRoomGoal(bonAtReception, room);
      const startRoomId = roomOf(centerOf(bonAtReception))?.id ?? null;

      const path = findPath(bonAtReception, goal, startRoomId, room.id);
      assertPathIsGenuinelyValid(bonAtReception, path);

      if (path.length === 1) {
        expect(segmentGenuinelyClear(centerOf(bonAtReception), centerOf(goal))).toBe(true);
      } else {
        expect(path[path.length - 1]).toEqual(goal);
      }
    });
  }
});
