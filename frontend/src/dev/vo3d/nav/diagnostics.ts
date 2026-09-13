// vo3d nav — V1 ↔ DERIVED V2 COMPARISON.
//
// The migration's safety net. Every governed cell falls into one of four buckets, and only one of them is
// allowed to be a surprise:
//
//   agree-walk      both say walkable                     — nothing to see
//   agree-block     both say blocked                      — nothing to see
//   legacy-open     V1 blocked, V2 walkable               — EXPECTED: the 2D painting over-blocked
//   v2-obstruction  V1 walkable, V2 blocked               — AUDIT EVERY ONE: either real geometry V1 missed,
//                                                           or a footprint bug. Never assume the first.
//
// Connectivity is reported alongside, because a cell that is walkable and unreachable is a bug of the same
// family and was the actual cause of the Central Hub's 79-unit café approaches.
import { COLS, ROWS, cellCentre, cellKey, type Cell } from "../adapters/v1Grid";
import type { WorldState } from "../world/WorldState";
import type { Connectivity } from "./connectivity";
import type { DerivedNav } from "./derived";
import type { CellPredicate } from "./pathfind";

export type Bucket = "agree-walk" | "agree-block" | "legacy-open" | "v2-obstruction";

export type CellVerdict = {
  cell: Cell;
  bucket: Bucket;
  /** distance from the cell centre to the nearest solid (derived layer) */
  clearance: number;
  /** what that nearest solid is, and where it came from */
  cause: { id: string; from: "wall" | "entity" | "door" } | null;
  connected: boolean;
  roomId: string | null;
};

export type DiagnosticReport = {
  counts: Record<Bucket, number>;
  governed: number;
  /** governed, walkable at the routing radius, but not reachable from the anchor */
  strandedCells: Cell[];
  /** every V1-walkable cell the derived layer closes — the audit list */
  obstructions: CellVerdict[];
  byRoom: Map<string, Record<Bucket, number>>;
};

/** Classify every derived-governed cell against the V1 layer it replaces. */
export function compareToV1(
  derived: DerivedNav,
  v1: CellPredicate,
  radius: number,
  world: WorldState,
  connected?: Connectivity,
): DiagnosticReport {
  const counts: Record<Bucket, number> = { "agree-walk": 0, "agree-block": 0, "legacy-open": 0, "v2-obstruction": 0 };
  const byRoom = new Map<string, Record<Bucket, number>>();
  const obstructions: CellVerdict[] = [];
  const strandedCells: Cell[] = [];
  let governed = 0;
  for (let cy = 0; cy < ROWS; cy++)
    for (let cx = 0; cx < COLS; cx++) {
      if (!derived.governs(cx, cy)) continue;
      governed++;
      const v = verdictFor(derived, v1, radius, world, { cx, cy }, connected);
      counts[v.bucket]++;
      const room = v.roomId ?? "?";
      if (!byRoom.has(room)) byRoom.set(room, { "agree-walk": 0, "agree-block": 0, "legacy-open": 0, "v2-obstruction": 0 });
      byRoom.get(room)![v.bucket]++;
      if (v.bucket === "v2-obstruction") obstructions.push(v);
      if (connected && derived.clear(cx, cy, radius) && !v.connected) strandedCells.push({ cx, cy });
    }
  return { counts, governed, strandedCells, obstructions, byRoom };
}

export function verdictFor(
  derived: DerivedNav,
  v1: CellPredicate,
  radius: number,
  world: WorldState,
  cell: Cell,
  connected?: Connectivity,
): CellVerdict {
  const centre = cellCentre(cell);
  const v2walk = derived.clear(cell.cx, cell.cy, radius);
  const v1walk = v1(cell.cx, cell.cy);
  const bucket: Bucket = v1walk && v2walk ? "agree-walk" : !v1walk && !v2walk ? "agree-block" : v2walk ? "legacy-open" : "v2-obstruction";
  const near = derived.nearestSolid(cell.cx, cell.cy);
  return {
    cell,
    bucket,
    clearance: derived.clearanceAt(cell.cx, cell.cy),
    cause: near ? { id: near.solid.id, from: near.solid.from } : null,
    connected: connected ? connected.cells.has(cellKey(cell)) : false,
    roomId: world.regionAt(centre)?.roomId ?? null,
  };
}

/** One-line-per-room summary for the console / overlay. */
export function summariseReport(r: DiagnosticReport): string {
  const lines = [`derived cells ${r.governed} · agree ${r.counts["agree-walk"]}w/${r.counts["agree-block"]}b · legacy-open ${r.counts["legacy-open"]} · v2-obstruction ${r.counts["v2-obstruction"]} · stranded ${r.strandedCells.length}`];
  for (const [room, c] of r.byRoom) lines.push(`  ${room}: ${c["agree-walk"]}w/${c["agree-block"]}b · +${c["legacy-open"]} · −${c["v2-obstruction"]}`);
  return lines.join("\n");
}
