// Design Room true-3D POC — ROOM EDIT MODE proof (one object) + DYNAMIC WALKABILITY overlay.
//
// V2 object-model sketch, kept to one plant:
//   visual transform   → the plant's existing THREE.Group (moved in place; geometry, materials
//                        and sway nodes are children, so they travel with it)
//   logical footprint  → a circle (centre = group position, radius) rasterised onto the
//                        PRODUCTION grid's cells; stored per object in DynamicNav
//   interaction meta   → editable: yes, placement rules (inside floor, clear of fixed furniture)
//   navigation         → DynamicNav composes `production isWalkable && !dynamicallyBlocked`
//
// Production navigation is reused READ-ONLY. Its `aStar` is bound to the global grid and
// takes no predicate, so it cannot see a dynamic obstacle without mutating production data
// (forbidden). Therefore: with NO dynamic obstacle in play the plan is delegated wholesale to
// production findPath/classifyDestination (see nav.ts); when one is registered, a dev A* with
// the SAME movement rules as data/gridAStar.ts (8-connected, octile cost, no corner cutting)
// runs over the composed predicate. Production grid data/helpers (CELL, isWalkable,
// worldToCell, cellToWorld) remain the static source of truth in both branches.
import * as THREE from "three";
import { CELL, isWalkable } from "../../data/officeGrid";
import { ROOM, SHELL } from "./layout";
import { blockedRects, insideFloor, pointInRect, type Ground } from "./avatar";
import { frameCentreToGround, groundToFrameCentre } from "./nav";

export type Cell = { cx: number; cy: number };
const key = (c: Cell): string => `${c.cx},${c.cy}`;

/** Circle footprint → production grid cells whose centre lies within radius (+ quarter cell). */
export function footprintCells(centre: Ground, radius: number): Cell[] {
  const f = groundToFrameCentre(centre);
  const r = radius + CELL * 0.25;
  const out: Cell[] = [];
  const cx0 = Math.floor((f.x - r) / CELL), cx1 = Math.floor((f.x + r) / CELL);
  const cy0 = Math.floor((f.y - r) / CELL), cy1 = Math.floor((f.y + r) / CELL);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const wx = (cx + 0.5) * CELL, wy = (cy + 0.5) * CELL;
      if (Math.hypot(wx - f.x, wy - f.y) <= r) out.push({ cx, cy });
    }
  }
  return out;
}

/** Dev-only overlay of dynamically blocked cells keyed by object id. Never touches production data. */
export class DynamicNav {
  private byObject = new Map<string, Set<string>>();
  private blocked = new Set<string>();

  setObstacle(id: string, centre: Ground, radius: number): Cell[] {
    const cells = footprintCells(centre, radius);
    this.byObject.set(id, new Set(cells.map(key)));
    this.rebuild();
    return cells;
  }
  clearObstacle(id: string): void {
    this.byObject.delete(id);
    this.rebuild();
  }
  private rebuild(): void {
    this.blocked = new Set();
    for (const s of this.byObject.values()) for (const k of s) this.blocked.add(k);
  }
  get hasObstacles(): boolean {
    return this.blocked.size > 0;
  }
  blockedKeys(): string[] {
    return [...this.blocked];
  }
  isBlocked(cx: number, cy: number): boolean {
    return this.blocked.has(`${cx},${cy}`);
  }
  /** composed predicate: production walkability AND not dynamically blocked */
  walkable(cx: number, cy: number): boolean {
    return isWalkable(cx, cy) && !this.isBlocked(cx, cy);
  }
}

// ---- dev A* over a predicate (rules mirror data/gridAStar.ts) ----------------------------
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];
function octile(a: Cell, b: Cell): number {
  const dx = Math.abs(a.cx - b.cx), dy = Math.abs(a.cy - b.cy);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}
export function aStarWith(walk: (cx: number, cy: number) => boolean, start: Cell, goal: Cell, maxNodes = 20000): Cell[] | null {
  if (!walk(start.cx, start.cy) || !walk(goal.cx, goal.cy)) return null;
  const open: { c: Cell; f: number }[] = [{ c: start, f: octile(start, goal) }];
  const g = new Map<string, number>([[key(start), 0]]);
  const came = new Map<string, Cell>();
  const closed = new Set<string>();
  let expanded = 0;
  while (open.length && expanded++ < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { c } = open.splice(bi, 1)[0];
    const ck = key(c);
    if (c.cx === goal.cx && c.cy === goal.cy) {
      const path: Cell[] = [c];
      let k = ck;
      while (came.has(k)) { const p = came.get(k)!; path.push(p); k = key(p); }
      return path.reverse();
    }
    if (closed.has(ck)) continue;
    closed.add(ck);
    for (const [dx, dy, cost] of DIRS) {
      const nx = c.cx + dx, ny = c.cy + dy;
      if (!walk(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!walk(c.cx + dx, c.cy) || !walk(c.cx, c.cy + dy))) continue; // no corner cutting
      const nk = `${nx},${ny}`;
      const ng = (g.get(ck) ?? Infinity) + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, c);
        open.push({ c: { cx: nx, cy: ny }, f: ng + octile({ cx: nx, cy: ny }, goal) });
      }
    }
  }
  return null;
}
export function floodFillWith(walk: (cx: number, cy: number) => boolean, start: Cell, limit = 20000): Set<string> {
  const seen = new Set<string>([key(start)]);
  const q: Cell[] = [start];
  while (q.length && seen.size < limit) {
    const c = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { cx: c.cx + dx, cy: c.cy + dy };
      const k = key(n);
      if (seen.has(k) || !walk(n.cx, n.cy)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen;
}
export function nearestWalkableWith(walk: (cx: number, cy: number) => boolean, from: Cell, region?: Set<string>, maxR = 12): Cell {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const c = { cx: from.cx + dx, cy: from.cy + dy };
      if (walk(c.cx, c.cy) && (!region || region.has(key(c)))) return c;
    }
  }
  return from;
}
export function mergeCollinear(cells: Cell[]): Cell[] {
  if (cells.length <= 2) return cells;
  const out: Cell[] = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1], b = cells[i], c = cells[i + 1];
    if (b.cx - a.cx !== c.cx - b.cx || b.cy - a.cy !== c.cy - b.cy) out.push(b);
  }
  out.push(cells[cells.length - 1]);
  return out;
}

// ---- the editable plant --------------------------------------------------------------------
export type PlacementCheck = { ok: boolean; reason?: "outside-room" | "overlaps-furniture" | "on-blocked-cells" };

export class EditablePlant {
  readonly id: string;
  readonly group: THREE.Object3D;
  readonly radius: number;
  /** last confirmed position */
  committed = new THREE.Vector3();
  /** original position at construction (for reset) */
  readonly original = new THREE.Vector3();
  selected = false;
  editing = false;
  private readonly solids = blockedRects(1.5);
  private readonly nav: DynamicNav;

  constructor(id: string, group: THREE.Object3D, radius: number, nav: DynamicNav) {
    this.nav = nav;
    this.id = id;
    this.group = group;
    this.radius = radius;
    this.committed.copy(group.position);
    this.original.copy(group.position);
    this.nav.setObstacle(id, { x: group.position.x, z: group.position.z }, radius);
  }

  /** Where can the plant stand? Inside the floor (radius margin) and clear of fixed furniture/cabinets. */
  validate(p: Ground): PlacementCheck {
    const T = SHELL.wallThickness, r = this.radius;
    if (!(p.x > T + r && p.x < ROOM.width - T - r && p.z > T + r && p.z < SHELL.frontWallZ - r)) return { ok: false, reason: "outside-room" };
    for (const rect of this.solids) {
      // circle vs rect
      const nx = Math.max(rect.x, Math.min(p.x, rect.x + rect.w)), nz = Math.max(rect.z, Math.min(p.z, rect.z + rect.d));
      if (Math.hypot(p.x - nx, p.z - nz) < r) return { ok: false, reason: "overlaps-furniture" };
    }
    return { ok: true };
  }
  /** Preview move (uncommitted): moves the real group; footprint follows only on confirm. */
  preview(p: Ground): PlacementCheck {
    this.editing = true;
    this.group.position.x = p.x;
    this.group.position.z = p.z;
    return this.validate(p);
  }
  confirm(): PlacementCheck {
    const p = { x: this.group.position.x, z: this.group.position.z };
    const v = this.validate(p);
    if (!v.ok) return v;
    this.committed.copy(this.group.position);
    this.nav.setObstacle(this.id, p, this.radius); // old cells released, new cells blocked
    this.editing = false;
    return v;
  }
  cancel(): void {
    this.group.position.copy(this.committed);
    this.editing = false;
  }
  reset(): void {
    this.group.position.copy(this.original);
    this.committed.copy(this.original);
    this.nav.setObstacle(this.id, { x: this.original.x, z: this.original.z }, this.radius);
    this.editing = false;
  }
  get position(): Ground {
    return { x: this.group.position.x, z: this.group.position.z };
  }
  driftFromCommitted(): number {
    return this.group.position.distanceTo(this.committed);
  }
}

/** Cells of the room grid currently blocked only by dynamic obstacles (for the overlay). */
export function dynamicBlockedGround(nav: DynamicNav): Ground[] {
  return nav.blockedKeys().map((k) => {
    const [cx, cy] = k.split(",").map(Number);
    return frameCentreToGround({ x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL });
  });
}

// re-exported for tests
export { insideFloor, pointInRect };
