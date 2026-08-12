import { DOOR_CELLS, STAND_CELLS, cellToWorld, worldToCell } from "./officeGrid";
import { rooms } from "./office-layout";
import type { Pt } from "./walkable-zones";

// Pairs each room's hand-painted door with the two "stand-here" clusters
// Bon (the designer) paints flanking it — one just outside the room
// (corridor side) and one just inside (room side) — so a walking character
// can stop outside, wait for a future door-open animation, step through,
// then stop just inside for a door-close beat. Mirrors the clustering
// approach in roomSeats.ts (8-connected flood-fill over hand-painted cell
// sets, centroid = the real position), since both modules turn hand-painted
// tile blobs into single world points.
//
// STAND_CELLS ('s' tiles) is overloaded: the SAME symbol also marks
// desk/interaction stand-offs used elsewhere (nearestStandSpotConnectedTo).
// The proximity-to-door-centroid radius below is what disambiguates a real
// door-pair stand point from an unrelated nearby desk stand-off.
//
// Not every door is fully painted with both an inside and an outside
// stand-point yet (tilemap authoring is ongoing) — doorStandForRoom returns
// null for any room whose door doesn't have a complete pair, and callers
// must treat that as "fall back to existing behavior", not an error.

const CELL_KEY_RE = /^(-?\d+),(-?\d+)$/;

function parseCellKey(key: string): { cx: number; cy: number } {
  const match = CELL_KEY_RE.exec(key);
  if (!match) throw new Error(`doorStandPoints: malformed cell key "${key}"`);
  return { cx: Number(match[1]), cy: Number(match[2]) };
}

// 8-connected flood-fill clustering, same approach as roomSeats.ts's
// clusterInteractionCells — generalized here to work over either DOOR_CELLS
// or STAND_CELLS.
function clusterCells(cells: Set<string>): string[][] {
  const visited = new Set<string>();
  const clusters: string[][] = [];
  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];

  for (const start of cells) {
    if (visited.has(start)) continue;
    visited.add(start);
    const cluster: string[] = [start];
    const queue: string[] = [start];

    while (queue.length > 0) {
      const cur = queue.pop()!;
      const { cx, cy } = parseCellKey(cur);
      for (const [dx, dy] of neighborOffsets) {
        const key = `${cx + dx},${cy + dy}`;
        if (visited.has(key) || !cells.has(key)) continue;
        visited.add(key);
        cluster.push(key);
        queue.push(key);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function centroidOf(cluster: string[]): Pt {
  let sumX = 0;
  let sumY = 0;
  for (const key of cluster) {
    const { cx, cy } = parseCellKey(key);
    const world = cellToWorld(cx, cy);
    sumX += world.x;
    sumY += world.y;
  }
  return { x: sumX / cluster.length, y: sumY / cluster.length };
}

function roomContainsPoint(room: { x: number; y: number; width: number; height: number }, p: Pt): boolean {
  return p.x >= room.x && p.x <= room.x + room.width && p.y >= room.y && p.y <= room.y + room.height;
}

// Chebyshev-ish radius (in grid cells) around a door's centroid within which
// a stand cluster is considered "belongs to this door" rather than some
// unrelated nearby desk stand-off. Tunable — start conservative since the
// paired stand points Bon paints sit right against the doorway.
const DOOR_STAND_RADIUS_CELLS = 4;

export type DoorStandPair = { doorCell: Pt; inStand: Pt; outStand: Pt };

function buildDoorStandByRoom(): Map<string, DoorStandPair> {
  const doorClusters = clusterCells(DOOR_CELLS);
  const standClusters = clusterCells(STAND_CELLS);
  const standCentroids = standClusters.map(centroidOf);

  const byRoom = new Map<string, DoorStandPair>();

  for (const doorCluster of doorClusters) {
    const doorCentroid = centroidOf(doorCluster);
    const doorCell = worldToCell(doorCentroid);

    let bestInside: { pt: Pt; d: number; roomId: string } | null = null;
    let bestOutside: { pt: Pt; d: number } | null = null;

    for (const standPt of standCentroids) {
      const standCell = worldToCell(standPt);
      const d = Math.hypot(standCell.cx - doorCell.cx, standCell.cy - doorCell.cy);
      if (d > DOOR_STAND_RADIUS_CELLS) continue;

      const room = rooms.find((r) => roomContainsPoint(r, standPt));
      if (room) {
        if (!bestInside || d < bestInside.d) bestInside = { pt: standPt, d, roomId: room.id };
      } else {
        if (!bestOutside || d < bestOutside.d) bestOutside = { pt: standPt, d };
      }
    }

    // Only a COMPLETE pair (both sides present) counts as a usable door —
    // a lone inside or outside stand cluster near a door isn't enough to
    // gate the walk, since there'd be nothing to walk to/from on one side.
    if (bestInside && bestOutside) {
      // If a room somehow gets two candidate doors (shouldn't happen for
      // the current single-door-per-room tilemap), keep the pairing whose
      // stand points sit closest to the door — most likely the intended one.
      const existing = byRoom.get(bestInside.roomId);
      const candidateScore = bestInside.d + bestOutside.d;
      const existingScore = existing
        ? Math.hypot(existing.inStand.x - existing.doorCell.x, existing.inStand.y - existing.doorCell.y) +
          Math.hypot(existing.outStand.x - existing.doorCell.x, existing.outStand.y - existing.doorCell.y)
        : Infinity;
      if (!existing || candidateScore < existingScore) {
        byRoom.set(bestInside.roomId, {
          doorCell: doorCentroid,
          inStand: bestInside.pt,
          outStand: bestOutside.pt,
        });
      }
    }
  }

  return byRoom;
}

const doorStandByRoom = buildDoorStandByRoom();

// Returns the in/out stand-point pair + door position for `roomId` (an
// office-layout.ts `rooms` id, e.g. "design-team"), or null when that room's
// door doesn't have a complete hand-painted pair yet — callers must fall
// back to their existing single-goal walk behavior in that case.
export function doorStandForRoom(roomId: string): DoorStandPair | null {
  return doorStandByRoom.get(roomId) ?? null;
}
