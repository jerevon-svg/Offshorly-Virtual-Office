import { describe, expect, it } from "vitest";
import { findPath, roomOf } from "./officePathfinding";
import {
  isWalkable,
  worldToCell,
  cellToWorld,
  floodFillFrom,
  nearestWalkable,
  nearestWalkableConnectedTo,
  COLS,
  ROWS,
} from "./officeGrid";
import { aStar } from "./gridAStar";
import { bonLayer, npcCharacterLayers } from "./office-layout";
import type { AssetLayer } from "../types/office";

// findPath returns waypoints in the same top-left basis as a character's
// position (bonPos), not the grid-center basis used internally — add the
// character's half-width/height offset back before checking cell walkability.
const half = { x: bonLayer.width / 2, y: bonLayer.height / 2 };
function centerOf(p: { x: number; y: number }) {
  return { x: p.x + half.x, y: p.y + half.y };
}

// Re-implements the fast-path "is this straight line actually clear" check
// (see officePathfinding.ts's segmentClearOnGrid, center-line only — good
// enough as an independent oracle for test purposes) so tests can tell a
// LEGITIMATE length-1 [goal] path (genuinely a clear straight line) apart
// from the BUG case (a single-point path returned for an unreachable/blocked
// goal, which the old code did via a blind `return [goal]` fallback).
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

// Fixes the vacuous-loop bug directly: the old test pattern
// `for (i = 0; i < path.length - 1; i++)` never executes its body when
// path.length === 1, so a broken straight-line-through-walls single-point
// path silently passed every "every waypoint is walkable" assertion. This
// helper explicitly handles that length-1 case by verifying the direct
// start->goal line is genuinely obstacle-clear, instead of skipping
// verification entirely.
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

// Replicates OfficeMap.tsx's handleChoose "approach" standoff-point calculation so
// tests exercise the REAL geometry a live user action would produce, not
// hand-picked pre-verified-reachable coordinates.
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
  return { x: tc.x - ux * standoff - bw / 2, y: tc.y - uy * standoff - bh / 2 };
}

describe("findPath", () => {
  it("returns exactly [goal] for a direct clear line with no obstacle in between", () => {
    // Open floor strip along grid row 24 (verified against the new
    // solid-color-tile source image — the exact-tile pipeline replaced the
    // old fuzzy-classified reference, so this anchor is re-picked directly
    // against the new tilemap rather than reused from the prior image).
    const start = { x: 360, y: 392 };
    const goal = { x: 552, y: 392 };
    const path = findPath(start, goal);
    expect(path).toEqual([goal]);
  });

  it("returns a multi-point path when a straight line would cross known furniture", () => {
    // design-room: a line between two open interior cells (grid cols/rows
    // 5,15 and 9,12 in the walkability grid parsed from the reference image,
    // post design-room Figma grid update) that passes through furniture in
    // between.
    const start = { x: 176, y: 496 };
    const goal = { x: 304, y: 400 };
    expect(roomOf(start)?.id).toBe("design-room");
    expect(roomOf(goal)?.id).toBe("design-room");

    const path = findPath(start, goal);
    expect(path.length).toBeGreaterThan(1);

    // Every waypoint except possibly the final goal (a standoff point that
    // may legitimately land near/inside a target's footprint) must sit on a
    // walkable cell.
    for (let i = 0; i < path.length - 1; i++) {
      const { cx, cy } = worldToCell(centerOf(path[i]));
      expect(isWalkable(cx, cy)).toBe(true);
    }
  });

  it("reaches a goal that sits inside/adjacent to furniture via nearestWalkable", () => {
    // design-room: goal near the center of "bottom-desk-row"
    // (x1:68,y1:455,x2:241,y2:531) — e.g. a character's seat.
    const start = { x: 30, y: 470 };
    const goal = { x: 150, y: 490 };
    expect(roomOf(start)?.id).toBe("design-room");
    expect(roomOf(goal)?.id).toBe("design-room");

    const path = findPath(start, goal);
    expect(path[path.length - 1]).toEqual(goal);
  });

  it("routes cross-room without cutting through another room's wall ring", () => {
    // design-room interior -> dev-room interior (both verified reachable
    // from the open corridor, see interiorPoints below): straight line would
    // cross executive-room and/or central-hub.
    const start = { x: 208, y: 496 };
    const goal = { x: 1168, y: 176 };
    const startRoomId = roomOf(start)?.id ?? null;
    const goalRoomId = roomOf(goal)?.id ?? null;
    expect(startRoomId).toBe("design-room");
    expect(goalRoomId).toBe("dev-room");

    const path = findPath(start, goal, startRoomId, goalRoomId);
    expect(path.length).toBeGreaterThan(1);

    for (let i = 0; i < path.length - 1; i++) {
      const { cx, cy } = worldToCell(centerOf(path[i]));
      expect(isWalkable(cx, cy)).toBe(true);
    }
  });

  it("never returns an empty path", () => {
    const start = { x: 500, y: 790 };
    const goal = { x: 500, y: 790 };
    const path = findPath(start, goal);
    expect(path.length).toBeGreaterThan(0);
  });
});

describe("officeGrid connectivity (flood-fill)", () => {
  // A point in the open floor strip between central-hub and reception-room,
  // guaranteed to be outside every room's wall ring.
  const openCell = worldToCell({ x: 500, y: 790 });

  it("open corridor cell is walkable and reaches most of the floor", () => {
    expect(isWalkable(openCell.cx, openCell.cy)).toBe(true);
    const reachable = floodFillFrom(openCell);
    expect(reachable.size).toBeGreaterThan(600); // sanity: most of the floor is one connected region
  });

  // Interior floor point per room (design-space px), chosen from the
  // walkability grid parsed from the reference image (app/scripts/parse-
  // walkable.cjs) — each point is the reachable, walkable interior cell
  // closest to that room's center, i.e. clearly inside the room and away
  // from its wall ring. central-hub is an open atrium (no wall ring / door)
  // so it doesn't need this check the same way the other 10 rooms do.
  // Anchors re-picked directly against the new exact-tile solid-color
  // reference image (each point verified to be a floor/stand-here cell,
  // inside its own room, and flood-fill-reachable from the open corridor
  // anchor — see scripts/parse-walkable.cjs's connectivity validator, which
  // performs the same reachability check at generation time).
  const interiorPoints: Record<string, { x: number; y: number }> = {
    "ai-room": { x: 168, y: 136 },
    "executive-room": { x: 712, y: 168 },
    "dev-room": { x: 1272, y: 168 },
    "cms-room": { x: 1288, y: 472 },
    "qa-room": { x: 168, y: 728 },
    "design-room": { x: 168, y: 440 },
    "gaming-room": { x: 1240, y: 728 },
    "project-room": { x: 1256, y: 1080 },
    "meeting-room": { x: 152, y: 1048 },
    "reception-room": { x: 712, y: 1016 },
  };

  it("reaches every room's interior floor point from the open corridor", () => {
    const reachable = floodFillFrom(openCell);
    expect(Object.keys(interiorPoints)).toHaveLength(10);

    for (const [roomId, pt] of Object.entries(interiorPoints)) {
      const cell = worldToCell(pt);
      expect(roomOf(pt)?.id, `${roomId} interior point isn't inside ${roomId}`).toBe(roomId);
      expect(isWalkable(cell.cx, cell.cy), `${roomId} interior point blocked`).toBe(true);
      expect(reachable.has(`${cell.cx},${cell.cy}`), `${roomId} interior point unreachable from open corridor`).toBe(
        true,
      );
    }
  });

  it("grid dimensions are sane (non-zero, matches frame)", () => {
    expect(COLS).toBeGreaterThan(0);
    expect(ROWS).toBeGreaterThan(0);
  });
});

describe("findPath — real bon spawn to real NPC seats (regression for the reported bug)", () => {
  // bon's REAL manifest idle spawn position — this specific spawn sits right
  // next to furniture (grid cells (7,15)/(8,15) blocked directly above his
  // feet row), which is also what made the old occlusion-mask heuristic
  // misfire at idle (see Bug 1). Using it here (rather than a hand-picked
  // "known good" start) is what actually exercises the real reported bug.
  const bonStart = { x: bonLayer.x, y: bonLayer.y };

  it("covers all 19 NPCs", () => {
    expect(npcCharacterLayers.map((l) => l.id).sort()).toEqual(
      [
        "alex",
        "angelo",
        "arisha",
        "bhong",
        "chris",
        "clang",
        "cyrus",
        "eson",
        "france",
        "ivory",
        "jona",
        "kael",
        "karen",
        "kylle",
        "lalaine",
        "lui",
        "micah",
        "nicole",
        "rhendel",
      ].sort(),
    );
  });

  for (const target of npcCharacterLayers) {
    it(`bon -> ${target.id}: never a suspicious unreachable straight line`, () => {
      const goal = standoffGoal(bonLayer, target);
      const startRoomId = roomOf(centerOf(bonStart))?.id ?? null;
      const goalRoomId = roomOf({ x: target.x + target.width / 2, y: target.y + target.height / 2 })?.id ?? null;

      const path = findPath(bonStart, goal, startRoomId, goalRoomId);

      // Fixes the vacuous-loop bug (see assertPathIsGenuinelyValid): a
      // length-1 path is only acceptable if the direct line is genuinely
      // clear, not just because start/goal happen to be in the same room.
      assertPathIsGenuinelyValid(bonStart, path);

      if (path.length === 1) {
        // A legitimate same-room/short-hop fast path is fine; a bug-case
        // single point returned for an out-of-region/far goal is not.
        // assertPathIsGenuinelyValid already proved the line is clear, so
        // this is never the "straight line through walls" bug case.
      } else {
        // Multi-point path: final waypoint should land exactly on the
        // standoff goal (per findPath's contract).
        expect(path[path.length - 1]).toEqual(goal);
      }
    });
  }

  it("computes and reports the arisha waypoints (matches the user's screenshot scenario)", () => {
    const arisha = npcCharacterLayers.find((l) => l.id === "arisha")!;
    const goal = standoffGoal(bonLayer, arisha);
    const startRoomId = roomOf(centerOf(bonStart))?.id ?? null;
    const goalRoomId = roomOf({ x: arisha.x + arisha.width / 2, y: arisha.y + arisha.height / 2 })?.id ?? null;

    const path = findPath(bonStart, goal, startRoomId, goalRoomId);
    assertPathIsGenuinelyValid(bonStart, path);

    // eslint-disable-next-line no-console
    console.log("bon -> arisha standoff goal:", goal, "waypoints:", path);

    // arisha sits in reception-room's top band (behind the counter/railing).
    // Bon's newer, cleaner reception layout now has a genuinely clear
    // straight vertical shot up to her, so a single-waypoint path is
    // legitimately correct here — not the old "dogleg through a door"
    // assumption. assertPathIsGenuinelyValid above already proved any
    // length-1 result is a real clear line, not the unreachable-straight-
    // line bug case; for a multi-point result, every intermediate waypoint
    // must still be walkable.
    if (path.length > 1) {
      for (let i = 0; i < path.length - 1; i++) {
        const { cx, cy } = worldToCell(centerOf(path[i]));
        expect(isWalkable(cx, cy)).toBe(true);
      }
    }
  });
});

describe("goal connectivity snapping (grid invariant)", () => {
  // A point in the open floor strip, guaranteed to be outside every room's
  // wall ring and in the single largest connected region of the floor.
  const openCorridorCell = worldToCell({ x: 500, y: 790 });
  const mainRegion = floodFillFrom(openCorridorCell);

  it("every NPC's real seat position, snapped via findPath's own connectivity logic, lands in the same region as the open corridor", () => {
    for (const npc of npcCharacterLayers) {
      const center = { x: npc.x + npc.width / 2, y: npc.y + npc.height / 2 };
      const goalCell = worldToCell(center);
      const startCell = worldToCell(centerOf({ x: bonLayer.x, y: bonLayer.y }));

      const snapped = nearestWalkableConnectedTo(goalCell.cx, goalCell.cy, startCell.cx, startCell.cy);

      expect(
        mainRegion.has(`${snapped.cx},${snapped.cy}`),
        `${npc.id}'s connectivity-snapped seat cell (${snapped.cx},${snapped.cy}) isn't in the main connected region`,
      ).toBe(true);
    }
  });
});

describe("gridAStar", () => {
  it("finds a direct path between two adjacent open cells", () => {
    const a = worldToCell({ x: 380, y: 720 });
    const b = worldToCell({ x: 412, y: 720 });
    const path = aStar(a, b);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });

  it("returns null when the goal cell is unreachable (isolated by walls)", () => {
    // Any cell deep inside a wall ring's boundary line itself is blocked;
    // picking two clearly disconnected non-walkable cells returns null since
    // isWalkable(start) is false.
    const path = aStar({ cx: 0, cy: 0 }, { cx: 1, cy: 1 });
    expect(path).toBeNull();
  });
});
