import { INTERACTION_CELLS, cellToWorld } from "./officeGrid";
import { rooms } from "./office-layout";
import type { Pt } from "./walkable-zones";
import type { WalkDirection } from "./bonWalkFrames";
import { directionForSeat } from "./seatDirections";
import officeAssetsManifest from "./office-assets-manifest.json";

// A seat is a real position PLUS a fixed facing direction (see
// seatDirections.ts) — the direction belongs to the chair, never to whoever
// last sat in it. Additive over the old bare Pt shape: every existing
// caller that only reads `.x`/`.y` keeps working unchanged.
export interface Seat extends Pt {
  direction: WalkDirection;
  /** Id of the source manifest furniture entry this seat was generated from
   *  (manifestSeatsForRoom() only — the 4 manifest-driven rooms). A single
   *  furniture item split into multiple sub-seats (see MULTI_SEAT_SOFA_IDS)
   *  shares one furnitureId across all its sub-seats, since they all render
   *  as one furniture image on screen. Undefined for flood-fill-derived
   *  seats (the other 6 rooms), which have no furniture entry to link to.
   *  Not consumed anywhere yet — prep for a follow-up depth-layering fix. */
  furnitureId?: string;
}

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

// --- Manifest-driven seats (dense rooms) ------------------------------
//
// 4 rooms — dev-team, executive-team, ai-room, design-team — paint their
// chairs' "o" interaction cells close enough together (~1.3 cells apart at
// worst) that clusterInteractionCells() above merges multiple real chairs
// into a single blob per row, under-counting seats. These 4 rooms happen to
// already have EXACT per-chair pixel placements in
// office-assets-manifest.json's furniture layer, so seat detection for them
// is derived directly from those coordinates instead of the painted grid.
// The other 6 rooms (including cms-team, which is visually just as dense but
// whose paint IS gapped correctly) keep the flood-fill path unchanged —
// some of them have no chair furniture in the manifest at all.
//
// Folder name intentionally differs from the room id for ai-room (its
// furniture assets live under "furniture/ai-team/", not "furniture/ai-room/").
const MANIFEST_SEAT_ROOMS: Record<string, string> = {
  "dev-team": "dev-team",
  "executive-team": "executive-team",
  "ai-room": "ai-team",
  "design-team": "design-team",
};

// Matches every seatable furniture PNG filename in the 4 manifest-driven
// rooms: desk chairs, visitor chairs, sofas, and the design-room beanbag.
// Tested against `path` (the asset filename), not `id` — several real
// visitor chairs (e.g. dev-team's dev-lead1-visitor1/2, dev-lead2-visitor1/2,
// all pointing at dev-visitor-chair.png) have ids that don't contain
// "chair"/"sofa"/"beanbag", so id-matching silently under-counted them.
// Verified against office-assets-manifest.json to produce the exact expected
// counts before sofa-splitting (dev-team 23, executive-team 15, ai-room 21,
// design-team 10) — confirmed by cross-checking every furniture path in each
// room's folder by hand. After MULTI_SEAT_SOFA_IDS splits 4 of those
// furniture items into 3 seats each: dev-team 25, executive-team 19,
// design-team 12, ai-room unchanged at 21 (no sofa furniture in that room).
const SEATABLE_FURNITURE_RE = /chair|sofa|beanbag/i;

interface ManifestFurnitureLayer {
  kind: string;
  path: string;
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const MANIFEST_FURNITURE = officeAssetsManifest as ManifestFurnitureLayer[];

// Sofas physically big enough to seat 3 people (~4-5 person-widths long,
// person-width unit ≈ 16px — a standard chair's width in the manifest) get
// split into 3 independent seats instead of the usual 1-per-furniture-item.
// Explicit id lookup, not a width/height heuristic, so exactly these 4 are
// affected and nothing else — approved scope, confirmed by hand for each id
// against office-assets-manifest.json. Excluded on purpose: bottom-center-sofa
// and top-center-sofa (executive-team, near-square/loveseat-sized, only ~2
// person-widths — too small for 3 real seats) and design-side-beanbag
// (single-person by nature, even though it matches SEATABLE_FURNITURE_RE).
const MULTI_SEAT_SOFA_IDS = new Set<string>([
  "white-sofa-left",
  "white-sofa-right",
  "dev-side-sofa",
  "design-side-sofa",
]);

// Splits one sofa furniture box into 3 seat centroids along its long axis
// (the larger of width/height — all 4 MULTI_SEAT_SOFA_IDS sofas are
// vertically oriented, so this varies y and holds x fixed at the sofa's
// horizontal center, but is written generically in case a future
// horizontally-oriented sofa is added to the set). Segment-center method:
// each sub-seat sits at fraction (2k-1)/(2*3) = 1/6, 1/2, 5/6 along the long
// axis, evenly spaced within the sofa's own footprint (not off its edges).
function sofaSubSeatCentroids(chair: ManifestFurnitureLayer): Pt[] {
  const vertical = chair.height >= chair.width;
  const fractions = [1 / 6, 1 / 2, 5 / 6];
  return fractions.map((frac) =>
    vertical
      ? { x: chair.x + chair.width / 2, y: chair.y + frac * chair.height }
      : { x: chair.x + frac * chair.width, y: chair.y + chair.height / 2 },
  );
}

function manifestSeatsForRoom(roomId: string, folder: string): Seat[] {
  const chairs = MANIFEST_FURNITURE.filter(
    (item) =>
      item.kind === "furniture" &&
      item.path.includes(`furniture/${folder}/`) &&
      SEATABLE_FURNITURE_RE.test(item.path),
  );

  const seats: Seat[] = chairs.flatMap((chair) => {
    const points = MULTI_SEAT_SOFA_IDS.has(chair.id)
      ? sofaSubSeatCentroids(chair)
      : [{ x: chair.x + chair.width / 2, y: chair.y + chair.height / 2 }];

    return points.map((point) => ({
      ...point,
      direction: directionForSeat(roomId, point.x, point.y),
      furnitureId: chair.id,
    }));
  });

  // Same deterministic reading order as the flood-fill path: top-to-bottom,
  // then left-to-right. Seat index feeds roster seating assignment and
  // click-to-sit enumeration, both of which depend on stable ordering. Sofa
  // sub-seats interleave into this sort naturally based on their computed
  // x/y, same as any other seat.
  seats.sort((a, b) => a.y - b.y || a.x - b.x);
  return seats;
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

function buildSeatsByRoom(): Map<string, Seat[]> {
  const clusters = clusterInteractionCells(INTERACTION_CELLS);
  const byRoom = new Map<string, Seat[]>();

  for (const cluster of clusters) {
    const centroid = centroidOf(cluster);
    const roomId = roomContaining(centroid);
    if (!roomId) continue; // seat painted outside any known room rect
    const seat: Seat = { ...centroid, direction: directionForSeat(roomId, centroid.x, centroid.y) };
    const list = byRoom.get(roomId);
    if (list) list.push(seat);
    else byRoom.set(roomId, [seat]);
  }

  // Deterministic reading order: top-to-bottom, then left-to-right. Keeps
  // seat assignment stable across re-renders/reorderings of the roster.
  for (const seats of byRoom.values()) {
    seats.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  // Manifest-driven rooms fully replace whatever the flood-fill produced for
  // them (it under-counts these 4 specifically — see MANIFEST_SEAT_ROOMS'
  // doc comment above).
  for (const [roomId, folder] of Object.entries(MANIFEST_SEAT_ROOMS)) {
    byRoom.set(roomId, manifestSeatsForRoom(roomId, folder));
  }

  return byRoom;
}

const seatsByRoom = buildSeatsByRoom();

export function seatsForRoomId(roomId: string): Seat[] {
  return seatsByRoom.get(roomId) ?? [];
}
