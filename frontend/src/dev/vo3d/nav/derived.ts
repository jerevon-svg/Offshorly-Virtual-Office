// vo3d nav — GEOMETRY-DERIVED WALKABILITY for reconstructed rooms.
//
//   valid reconstructed floor  −  walls  −  solid footprints  −  live door solids  +  clearance
//   = the authoritative walkable space
//
// The V1 grid is not consulted inside a derived room, and is not touched anywhere. Outside derived rooms
// nothing changes: the composed predicate falls straight through to the existing V1 layer (nav/Walkability).
//
// WHY A CLEARANCE FIELD AND NOT A BOOLEAN. Each governed cell stores the DISTANCE from its stand point to
// the nearest solid. Walkability is then `field[cell] >= radius` — a query parameter, not a baked
// assumption. That is what makes NAV_RADIUS tunable without a rebuild, gives the diagnostic a real readout
// ("this gap is 13 wide, you need 14"), and lets a door or a moved plant repaint a handful of cells.
//
// WHY A SUB-CELL STAND POINT. The grid stays at 16 units — same indices as V1, same cellKey, no resolution
// change. But a cell's CENTRE is a terrible sample of it: the Central Hub's apron ring is a genuine 28-unit
// walkway, and the cell centres inside it land 2–4 units from the monument purely because of where the
// 16-unit lattice happens to fall. Sampling the cell on a sub-grid and keeping the BEST point recovers that
// — the cell still means one routing node, but it now means "a body fits SOMEWHERE in here, and here is
// where", instead of "a body fits at this one arbitrary spot".
//
// That makes the routing node's position variable, so a cell-to-cell STEP is no longer trivially safe —
// two neighbours' stand points could sit on opposite sides of a thin solid. `edgeClear()` is the answer:
// the segment between two stand points is itself sampled, and A* and the connectivity flood both use it.
// Without that the layer would report routes a body cannot actually walk.
//
// And because a long edge is a fragile edge, the stand point is chosen to be the sample NEAREST THE CELL
// CENTRE that still holds the body — not the roomiest one. Sub-cell freedom is there to rescue a cell whose
// centre lands badly, not to scatter neighbouring nodes to opposite corners.
import { CELL, COLS, ROWS, cellCentre, type Cell } from "../adapters/v1Grid";
import { pointInRect, type Rect, type Vec2 } from "../core/coords";
import type { WorldState } from "../world/WorldState";
import { roomSolids, shapeBounds, distToShape, type Solid } from "./solids";
import type { CellPredicate } from "./pathfind";

/** Cells that no derived room governs carry this, so `governs()` is a cheap sentinel test. */
const NOT_GOVERNED = -1;
/** Clearance is only ever compared against a body radius, so distances past two cells are not worth
 *  measuring — and capping them is what lets the solid lookup stay local. */
const CLEARANCE_CAP = CELL * 2;
/** Sub-cell sample lattice, as fractions of CELL from the centre — 7 × 7 = 49 probes per cell.
 *  The ±0.5 ends matter: a corridor's best line often falls exactly ON a cell boundary (the Central Hub's
 *  17-unit café lane is centred at z 608, which is where row 37 ends and row 38 begins), and a lattice that
 *  stops short of the edge cannot see it from either side. */
const SUB = [-0.5, -1 / 3, -1 / 6, 0, 1 / 6, 1 / 3, 0.5];
/** Step along a cell-to-cell edge when validating it. Under a quarter of a body, so nothing thin hides. */
const EDGE_STEP = 4;

export type DerivedOptions = {
  /** rooms whose navigation comes from geometry; everything else stays V1-governed */
  roomIds: ReadonlySet<string>;
  /** live open fraction (0 closed … 1 open) of a door entity */
  doorOpen?: (id: string) => number;
};

export class DerivedNav {
  /** per cell: clearance at its stand point (capped), or NOT_GOVERNED */
  private readonly field = new Float32Array(COLS * ROWS);
  /** per governed cell: the clearance measured at each of the 25 sub-cell samples, so a stand point can be
   *  picked for the radius actually being queried instead of once, blindly, at build time */
  private readonly samples = new Map<number, Float32Array>();
  private readonly world: WorldState;
  readonly roomIds: ReadonlySet<string>;
  private doorOpen: (id: string) => number;
  /** governed cell windows, one per derived room — the only cells this layer may ever write */
  private readonly windows: { rect: Rect; c0: number; c1: number; r0: number; r1: number }[] = [];
  private solids: Solid[] = [];
  /** solids bucketed by cell, so a point test only looks at what is actually near it */
  private buckets = new Map<number, Solid[]>();
  /** last-seen bounds per solid id, so a move can invalidate the space it LEFT as well as the one it took */
  private readonly lastBounds = new Map<string, Rect>();
  /** diagnostics */
  rebuilds = 0;
  cellsWritten = 0;

  constructor(world: WorldState, opts: DerivedOptions) {
    this.world = world;
    this.roomIds = opts.roomIds;
    this.doorOpen = opts.doorOpen ?? (() => 0);
    this.field.fill(NOT_GOVERNED);
    for (const id of this.roomIds) {
      const room = world.rooms.get(id);
      if (!room) throw new Error(`nav/derived: no RoomDef for ${id}`);
      const rect = room.floorRect;
      this.windows.push({
        rect,
        c0: Math.max(0, Math.floor(rect.x / CELL)), c1: Math.min(COLS - 1, Math.floor((rect.x + rect.w) / CELL)),
        r0: Math.max(0, Math.floor(rect.z / CELL)), r1: Math.min(ROWS - 1, Math.floor((rect.z + rect.d) / CELL)),
      });
    }
    this.rebuild();
  }

  // ---- queries ------------------------------------------------------------------------------------
  /** true when this layer — not V1 — decides the cell */
  governs(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return false;
    return this.field[cy * COLS + cx] !== NOT_GOVERNED;
  }
  /** clearance at the cell's stand point (capped at two cells); −1 when not governed */
  clearanceAt(cx: number, cy: number): number {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return NOT_GOVERNED;
    return this.field[cy * COLS + cx];
  }
  /** a governed cell is walkable for a body of `radius` iff its stand point holds that body */
  clear(cx: number, cy: number, radius: number): boolean {
    const d = this.clearanceAt(cx, cy);
    return d !== NOT_GOVERNED && d >= radius;
  }
  /** WHERE in the cell a body of `radius` stands.
   *
   *  The cell centre for a V1-governed cell — every authored V1 stand point assumes exactly that. Inside a
   *  derived room, the sample CLOSEST TO THE CENTRE that still clears `radius`, so stand points stay as
   *  close to the lattice as the geometry allows and only slide when they have to. Falls back to the
   *  roomiest sample when nothing clears the radius (the cell is unwalkable anyway; this keeps the
   *  diagnostic honest about where its best spot was). */
  pointOf(c: Cell, radius = 0): Vec2 {
    const centre = cellCentre(c);
    const sm = this.samples.get(c.cy * COLS + c.cx);
    if (!sm) return centre;
    let bestI = -1, bestRank = Infinity, maxI = 0, maxD = -1;
    for (let i = 0; i < sm.length; i++) {
      const d = sm[i];
      if (d > maxD) { maxD = d; maxI = i; }
      if (d < radius) continue;
      const fx = SUB[i % SUB.length], fz = SUB[Math.floor(i / SUB.length)];
      const rank = Math.abs(fx) + Math.abs(fz);
      if (rank < bestRank) { bestRank = rank; bestI = i; }
    }
    const i = bestI >= 0 ? bestI : maxI;
    return { x: centre.x + SUB[i % SUB.length] * CELL, z: centre.z + SUB[Math.floor(i / SUB.length)] * CELL };
  }
  /** the predicate for a fixed radius, composed over a V1 fallback for everything this layer does not govern */
  predicate(radius: number, fallback: CellPredicate): CellPredicate {
    return (cx, cy) => (this.governs(cx, cy) ? this.clear(cx, cy, radius) : fallback(cx, cy));
  }

  /** Clearance at an arbitrary world point, capped. Only solids bucketed near the point are consulted,
   *  which is sound because the cap is smaller than the bucket padding. */
  clearanceAtPoint(p: Vec2): number {
    const near = this.buckets.get(this.bucketIndex(p));
    if (!near) return CLEARANCE_CAP;
    let best = CLEARANCE_CAP;
    for (const s of near) {
      const d = distToShape(p, s.shape);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
    return best;
  }

  /** Is the step between two cells walkable for `radius`?
   *
   *  Necessary because stand points move within their cells: two neighbours can both hold a body and still
   *  have a wall between them.
   *
   *  A BOUNDARY EDGE IS STILL TESTED, and deliberately so: the step from a derived room into the V1-governed
   *  hall is the step that crosses the room's wall plane, and the only place it may legally do that is a
   *  doorway. That is also what finally makes a door matter to routing — a CLOSED leaf sits across the
   *  crossing and the edge fails; slide it open and the same edge passes. Solids outside the derived rooms
   *  are unknown here and score as open, which is correct: beyond the wall, V1 is the authority.
   *
   *  THE GATE. A direct stand-point-to-stand-point segment is too brittle on its own: each cell picks its
   *  point in isolation, so two cells in a plainly walkable 21-unit corridor can pick points whose straight
   *  join happens to clip a chair. So a failed direct step is retried THROUGH THE SHARED BOUNDARY — walk to
   *  a clear spot on the gate between the cells, then on — which is how a corridor is actually used, and it
   *  is still a fully sampled, fully honest path. */
  edgeClear(a: Cell, b: Cell, radius: number): boolean {
    if (!this.governs(a.cx, a.cy) && !this.governs(b.cx, b.cy)) return true;
    const p = this.pointOf(a, radius), q = this.pointOf(b, radius);
    if (this.segmentClear(p, q, radius)) return true;
    for (const gate of this.gatePoints(a, b)) {
      if (this.clearanceAtPoint(gate) < radius) continue;
      if (this.segmentClear(p, gate, radius) && this.segmentClear(gate, q, radius)) return true;
    }
    return false;
  }

  /** every sampled point on the boundary two orthogonally adjacent cells share (empty for a diagonal pair,
   *  which A* only takes when both orthogonal steps are already legal) */
  private gatePoints(a: Cell, b: Cell): Vec2[] {
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return [];
    const ac = cellCentre(a);
    const x = ac.x + (dx * CELL) / 2, z = ac.z + (dy * CELL) / 2;
    return SUB.map((f) => (dx !== 0 ? { x, z: z + f * CELL } : { x: x + f * CELL, z }));
  }

  /** Sample a step, JUDGING ONLY THE SPACE THIS LAYER GOVERNS.
   *
   *  A sample outside every derived room's floor is skipped, not failed. The derived layer knows this
   *  room's solids and nothing else, so scoring a hall point against them is meaningless in one direction
   *  and actively wrong in the other: the V1 cell centre outside the Gaming Room's doorway sits 8 units
   *  from the door reveal — V1 and the door's own clearance band both call it walkable at cell
   *  granularity — and judging it here sealed the room off from the office entirely. */
  private segmentClear(p: Vec2, q: Vec2, radius: number): boolean {
    const dx = q.x - p.x, dz = q.z - p.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / EDGE_STEP));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const s = { x: p.x + dx * t, z: p.z + dz * t };
      if (!this.windows.some((w) => pointInRect(s, w.rect))) continue;
      if (this.clearanceAtPoint(s) < radius) return false;
    }
    return true;
  }

  /** the edge predicate to hand to aStar / Connectivity */
  edge(radius: number): (a: Cell, b: Cell) => boolean {
    return (a, b) => this.edgeClear(a, b, radius);
  }

  setDoorOpen(fn: (id: string) => number): void {
    this.doorOpen = fn;
  }

  // ---- build / invalidate -------------------------------------------------------------------------
  /** Full recompute of every governed cell. Boot, and nothing else. */
  rebuild(): void {
    this.reindex();
    this.rebuilds++;
    for (const w of this.windows)
      for (let cy = w.r0; cy <= w.r1; cy++) for (let cx = w.c0; cx <= w.c1; cx++) this.writeCell(cx, cy);
  }

  /** INCREMENTAL: recompute only the cells `rects` can reach, dilated by the query radius plus one cell.
   *  Everything else keeps its value — no world rebuild, ever, per requirement 4. */
  invalidate(rects: readonly Rect[], radius: number): number {
    if (!rects.length) return 0;
    this.reindex();
    const pad = radius + CELL;
    let n = 0;
    const seen = new Set<number>();
    for (const r of rects) {
      const c0 = Math.max(0, Math.floor((r.x - pad) / CELL)), c1 = Math.min(COLS - 1, Math.floor((r.x + r.w + pad) / CELL));
      const r0 = Math.max(0, Math.floor((r.z - pad) / CELL)), r1 = Math.min(ROWS - 1, Math.floor((r.z + r.d + pad) / CELL));
      for (let cy = r0; cy <= r1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
          const i = cy * COLS + cx;
          if (seen.has(i)) continue;
          seen.add(i);
          // a cell OUTSIDE every window is never governed and never written; one inside is rewritten even
          // if it was blocked, because the thing that blocked it may be what just moved away
          if (!this.inAnyWindow(cx, cy)) continue;
          this.writeCell(cx, cy);
          n++;
        }
    }
    return n;
  }

  /** the world rect a solid occupied when the field last saw it (for invalidating vacated space) */
  boundsOf(id: string): Rect | null {
    return this.lastBounds.get(id) ?? null;
  }
  /** every solid contributed by one entity (own footprint, jambs, leaf) */
  boundsOfEntity(entityId: string): Rect[] {
    const out: Rect[] = [];
    for (const [id, r] of this.lastBounds) if (id === entityId || id.startsWith(`${entityId}#`)) out.push(r);
    return out;
  }

  // ---- internals ----------------------------------------------------------------------------------
  private bucketIndex(p: Vec2): number {
    const cx = Math.max(0, Math.min(COLS - 1, Math.floor(p.x / CELL)));
    const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(p.z / CELL)));
    return cy * COLS + cx;
  }
  private inAnyWindow(cx: number, cy: number): boolean {
    return this.windows.some((w) => cx >= w.c0 && cx <= w.c1 && cy >= w.r0 && cy <= w.r1);
  }

  /** Re-read the solids and re-bucket them. Padding is the clearance cap, so a point test that only looks
   *  at its own bucket can never miss a solid that would have changed its answer. */
  private reindex(): void {
    this.solids = roomSolids(this.world, this.roomIds, this.doorOpen);
    this.buckets = new Map();
    for (const s of this.solids) {
      const b = shapeBounds(s.shape);
      this.lastBounds.set(s.id, b);
      const pad = CLEARANCE_CAP;
      const c0 = Math.max(0, Math.floor((b.x - pad) / CELL)), c1 = Math.min(COLS - 1, Math.floor((b.x + b.w + pad) / CELL));
      const r0 = Math.max(0, Math.floor((b.z - pad) / CELL)), r1 = Math.min(ROWS - 1, Math.floor((b.z + b.d + pad) / CELL));
      for (let cy = r0; cy <= r1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
          const i = cy * COLS + cx;
          const list = this.buckets.get(i);
          if (list) list.push(s);
          else this.buckets.set(i, [s]);
        }
    }
  }

  /** Sample the cell on the sub-lattice: keep every sample's clearance, and rate the cell by its best.
   *
   *  GOVERNANCE IS DECIDED BY THE CELL CENTRE, sub-cell freedom only by where inside it a body stands. That
   *  keeps the boundary between derived and V1 rule EXACTLY where region membership puts it — the same
   *  cell-centre convention the V1 grid has always used — so a cell belonging to the hall can never be
   *  quietly annexed by a room because one of its corners overlaps that room's floor. */
  private writeCell(cx: number, cy: number): void {
    const i = cy * COLS + cx;
    const c = cellCentre({ cx, cy });
    if (!this.windows.some((w) => pointInRect(c, w.rect)) || !this.world.walkableAt(c)) {
      this.field[i] = NOT_GOVERNED;
      this.samples.delete(i);
      return;
    }
    const sm = new Float32Array(SUB.length * SUB.length);
    let best = -1;
    for (let z = 0; z < SUB.length; z++)
      for (let x = 0; x < SUB.length; x++) {
        const p = { x: c.x + SUB[x] * CELL, z: c.z + SUB[z] * CELL };
        // a sample only counts if it stands on floor this layer is responsible for
        const on = this.windows.some((w) => pointInRect(p, w.rect)) && this.world.walkableAt(p);
        const d = on ? this.clearanceAtPoint(p) : -1;
        sm[z * SUB.length + x] = d;
        if (d > best) best = d;
      }
    if (best < 0) {
      this.field[i] = NOT_GOVERNED;
      this.samples.delete(i);
      return;
    }
    this.field[i] = best;
    this.samples.set(i, sm);
    this.cellsWritten++;
  }

  /** the solid a governed cell's stand point is closest to — the diagnostic's "why is this blocked" answer */
  nearestSolid(cx: number, cy: number): { solid: Solid; distance: number } | null {
    if (!this.governs(cx, cy)) return null;
    const p = this.pointOf({ cx, cy }, 0);
    let best: Solid | null = null, bestD = Infinity;
    for (const s of this.buckets.get(this.bucketIndex(p)) ?? []) {
      const d = distToShape(p, s.shape);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best ? { solid: best, distance: bestD } : null;
  }

  /** every governed cell, for tests and devtools */
  governedCells(): Cell[] {
    const out: Cell[] = [];
    for (const w of this.windows)
      for (let cy = w.r0; cy <= w.r1; cy++) for (let cx = w.c0; cx <= w.c1; cx++) if (this.governs(cx, cy)) out.push({ cx, cy });
    return out;
  }
}
