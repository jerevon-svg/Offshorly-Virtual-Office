import { INTERACTION_CELLS, cellToWorld } from "./officeGrid";
import { rooms } from "./office-layout";
import type { Pt } from "./walkable-zones";

// Turns the hand-painted "interaction" (blue) tiles into real seat
// positions, one per painted chair, bucketed into whichever room's rect
// contains it.
//
// The paint tool marks a chair as a small BLOB of adjacent blue cells, not a
// single cell — so a "seat" here is a connected component (8-directional,
// so diagonally-touching cells still merge into one chair) rather than one
// cell each. Its position is the centroid of every cell in that blob, which
// lands roughly at the chair's visual center regardless of blob shape.
//
// Computed once at module load (INTERACTION_CELLS is static, parsed from the
// walkability reference image at build time), then memoized — callers must
// not mutate the returned arrays.

const CELL_KEY_RE = /^(-?\d+),(-?\d+)$/;

function parseCellKey(key: string): { cx: number; cy: number } {
  const match = CELL_KEY_RE.exec(key);
  if (!match) throw new Error(`roomSeats: malformed cell key "${key}"`);
  return { cx: Number(match[1]), cy: Number(match[2]) };
}

// 8-connected flood-fill clustering over INTERACTION_CELLS. Union-find would
// work too, but the cell count here (a few hundred) makes a plain BFS per
// unvisited cell simplest and plenty fast.
function clusterInteractionCells(cells: Set<string>): string[][] {
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

function roomContaining(point: Pt): string | null {
  const room = rooms.find(
    (r) =>
      point.x >= r.x &&
      point.x <= r.x + r.width &&
      point.y >= r.y &&
      point.y <= r.y + r.height,
  );
  return room?.id ?? null;
}

function buildSeatsByRoom(): Map<string, Pt[]> {
  const clusters = clusterInteractionCells(INTERACTION_CELLS);
  const byRoom = new Map<string, Pt[]>();

  for (const cluster of clusters) {
    const seat = centroidOf(cluster);
    const roomId = roomContaining(seat);
    if (!roomId) continue; // seat painted outside any known room rect
    const list = byRoom.get(roomId);
    if (list) list.push(seat);
    else byRoom.set(roomId, [seat]);
  }

  // Deterministic reading order: top-to-bottom, then left-to-right. Keeps
  // seat assignment stable across re-renders/reorderings of the roster.
  for (const seats of byRoom.values()) {
    seats.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  return byRoom;
}

const seatsByRoom = buildSeatsByRoom();

export function seatsForRoomId(roomId: string): Pt[] {
  return seatsByRoom.get(roomId) ?? [];
}
