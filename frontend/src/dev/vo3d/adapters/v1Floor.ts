// vo3d adapter — READ-ONLY view of the production GROUND-FLOOR layout: the frame, every room
// footprint, the sidewalk, and the hand-painted door openings. Nothing here is invented: rects come
// from the asset manifest, door spans from the '+' cells of the walkability grid.
import manifest from "../../../data/office-assets-manifest.json";
import { FRAME_WIDTH, FRAME_HEIGHT, formatRoomName } from "../../../data/office-layout";
import { CELL, cellKey, isDoorCell, type Cell } from "./v1Grid";
import { COLS, ROWS } from "../../../data/officeGrid";
import { pointInRect, type Facing, type Rect, type Vec2 } from "../core/coords";

type Layer = { id: string; kind: string; path: string; x: number; y: number; width: number; height: number };
const layers = manifest as Layer[];
const toRect = (l: Layer): Rect => ({ x: l.x, z: l.y, w: l.width, d: l.height });

/** the V1 frame: 1440 × 1244 frame units = world units; the grid covers 90 × 78 cells of 16 */
export const FRAME: Rect = { x: 0, z: 0, w: FRAME_WIDTH, d: FRAME_HEIGHT };
export const GRID_RECT: Rect = { x: 0, z: 0, w: COLS * CELL, d: ROWS * CELL };

/** The FRONT-ROW FAÇADE plane: the north face of the V1 south door band (walkability grid rows 70–74).
 *  Meeting, Reception and Project share one continuous street façade here — their art bounding boxes do
 *  NOT agree on it (they end at z 1199.4 / 1237.6 / 1238.1), so the plane is taken from the grid, which is
 *  the only source that spans all three rooms. */
export const FACADE_Z = 70 * CELL; // 1120
/** the rooms whose rect reaches the façade band: the bottom architectural bar (Meeting → Reception → Project) */
export const FRONT_ROW_ROOM_IDS: ReadonlySet<string> = new Set(["meeting-room", "reception-room", "project-room"]);

export type V1Room = { id: string; name: string; rect: Rect };
/** every manifest room layer, in manifest order (11 rooms incl. the wall-less central hub) */
export function v1Rooms(): V1Room[] {
  return layers.filter((l) => l.kind === "room").map((l) => ({ id: l.id, name: formatRoomName(l.id), rect: toRect(l) }));
}
export function v1Sidewalk(): Rect {
  const l = layers.find((e) => e.kind === "sidewalk");
  if (!l) throw new Error("v1Floor: no sidewalk layer");
  return toRect(l);
}

/** A hand-painted door: a cluster of '+' cells attributed to one wall of one room. `from`/`to` run
 *  along the wall (x for north/south walls, z for east/west) in world units, cell-aligned. */
export type DoorOpening = { roomId: string; side: Facing; from: number; to: number; cells: Cell[]; centre: Vec2 };

function clusterDoorCells(): Cell[][] {
  const seen = new Set<string>();
  const out: Cell[][] = [];
  for (let cy = 0; cy < ROWS; cy++)
    for (let cx = 0; cx < COLS; cx++) {
      const start = { cx, cy };
      if (!isDoorCell(start) || seen.has(cellKey(start))) continue;
      const cluster: Cell[] = [];
      const q = [start];
      seen.add(cellKey(start));
      while (q.length) {
        const c = q.pop()!;
        cluster.push(c);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const n = { cx: c.cx + dx, cy: c.cy + dy };
            if ((dx || dy) && isDoorCell(n) && !seen.has(cellKey(n))) { seen.add(cellKey(n)); q.push(n); }
          }
      }
      out.push(cluster);
    }
  return out;
}

/** Every door cluster → the room whose rect contains its centroid (else the nearest room) and the
 *  nearest wall of that room. Spans are the cluster's cell extent along that wall. */
export function v1DoorOpenings(rooms: V1Room[] = v1Rooms()): DoorOpening[] {
  return clusterDoorCells().map((cells) => {
    const centre: Vec2 = { x: (cells.reduce((a, c) => a + c.cx + 0.5, 0) / cells.length) * CELL, z: (cells.reduce((a, c) => a + c.cy + 0.5, 0) / cells.length) * CELL };
    const edgeDist = (r: Rect): Record<Facing, number> => ({ north: Math.abs(centre.z - r.z), south: Math.abs(centre.z - (r.z + r.d)), west: Math.abs(centre.x - r.x), east: Math.abs(centre.x - (r.x + r.w)) });
    let room = rooms.find((r) => pointInRect(centre, r.rect));
    if (!room) room = rooms.slice().sort((a, b) => Math.min(...Object.values(edgeDist(a.rect))) - Math.min(...Object.values(edgeDist(b.rect))))[0];
    const d = edgeDist(room.rect);
    const side = (Object.keys(d) as Facing[]).sort((a, b) => d[a] - d[b])[0];
    const along = side === "north" || side === "south" ? cells.map((c) => c.cx) : cells.map((c) => c.cy);
    return { roomId: room.id, side, from: Math.min(...along) * CELL, to: (Math.max(...along) + 1) * CELL, cells, centre };
  });
}
