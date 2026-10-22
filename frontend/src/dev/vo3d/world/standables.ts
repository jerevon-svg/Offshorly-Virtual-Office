// vo3d world — STANDABLE TOPS: the one height-aware obstacle vocabulary, shared by every floor and the campus.
//
// THE RULE THIS FILE EXISTS FOR. Until Parkour V1 every obstacle in V2 was a flat outline that blocked at every
// height — a sofa, a desk and a wall were the same thing to a body. A STANDABLE is an obstacle that also has a
// TOP: below it, it blocks exactly as before; with the feet at or above it, the body passes over it and stands
// on it. Nothing else changes, and nothing becomes standable by accident:
//
//   • ELIGIBILITY IS DATA, NEVER HEIGHT. A piece is standable only because of WHAT it is — a seat (its own
//     `cushionTopY`), a lounge piece (its own seat-surface slots), or a flat-topped kind in STANDABLE_KIND_TOPS
//     below. Walls, door architecture, glass, room front walls and the Reception balustrade are never here, so
//     "waist high" can never mean "jump over it" — a 22-unit front wall stays exactly as solid as a 46-unit one.
//   • MISSING DATA BLOCKS. A kind with no entry is not standable; its outline keeps blocking at every height.
//   • ONE PLACE, EVERY LOCATION. app/world.ts builds one index from the world's entities and the campus's solids
//     and asks it everywhere the player stands — no floor, room or coordinate is named here, so a future floor's
//     sofa is standable the moment it is authored with a seat.
//
// PARKOUR V2 — TRAVERSAL METADATA ON THE SAME ITEMS. A standable may also be a VAULT obstacle (`vault`), and an item
// may be vault-only (`stand: false` — a rail too narrow for the body's footprint to stand on). Both are data, set
// where the piece is declared (VAULT_KINDS below, the Reception rail list in app/world.ts, the Meeting Floor's
// solids), never inferred from height. A vault-only item is invisible to every stand query here — it is never a
// top, never "cleared" by a jump — so a double jump can never carry anybody over it; only player/traversal's
// vault planner, with its access check, may name it.
//
// PURE: no THREE, no scene. Each standable carries its own distance function (0 inside its outline), so the
// index never needs to know which world the outline came from.

import { distToShape, entityShape } from "../nav/solids";
import type { Vec2 } from "../core/coords";
import type { Entity } from "./WorldState";

/** Flat-topped kinds with no seat data of their own, by kind → top height (units above the floor). Measured from
 *  each builder (build/furniture.ts, build/exec-furniture.ts). Desks, cabinets, planters and screens are
 *  deliberately absent: a desk carries monitors and kit, a planter a plant. */
export const STANDABLE_KIND_TOPS: Readonly<Record<string, number>> = {
  "round-table": 14, //       build/furniture roundTable h
  "lounge-table": 15, //      build/furniture loungeTable h
  "exec-coffee-table": 15, // build/exec-furniture coffee table h
  "conference-table": 24, //  build/furniture DESK_H
  "cafe-table": 24, //        build/furniture CAFE_TABLE.topY
};

/** PARKOUR V2 — standable kinds that are also VAULT obstacles: low, flat, open tops a hand can be planted on. Seats
 *  (backs, arms), sofas and the conference table (far too deep) are deliberately absent. */
export const VAULT_KINDS: ReadonlySet<string> = new Set(["round-table", "lounge-table", "exec-coffee-table", "cafe-table"]);

/** The campus benches' seat top: build/exterior benchGeos slats sit at 18 with a 3-unit section. */
export const CAMPUS_BENCH_TOP = 21;

export type Standable = {
  id: string;
  top: number;
  /** distance from a point to the outline, 0 inside */
  dist(p: Vec2): number;
  /** conservative world bounds, for bucketing */
  bounds: { x0: number; z0: number; x1: number; z1: number };
  /** PARKOUR V2 — false: vault-only, never stood on (default true) */
  stand?: boolean;
  /** PARKOUR V2 — an eligible vault obstacle (default false) */
  vault?: boolean;
};

/** PARKOUR V2 — traversal flags for a declared piece */
export type TraversalFlags = { stand?: boolean; vault?: boolean };
const canStandOn = (s: Standable): boolean => s.stand !== false;

/** How high a piece's top is, from its own data — or null when it is not standable. */
export function standableTop(e: Entity): number | null {
  if (e.footprint?.solid === false) return null;
  const seat = e.capabilities.seat;
  if (seat && Number.isFinite(seat.cushionTopY)) return seat.cushionTopY;
  const lounge = e.capabilities.lounge;
  if (lounge && lounge.slots.length > 0) {
    const top = Math.max(...lounge.slots.map((s) => s.contactLocal.y));
    if (Number.isFinite(top) && top > 0) return top;
  }
  return STANDABLE_KIND_TOPS[e.kind] ?? null;
}

/** An entity as a standable, or null (not solid, no outline, or not eligible). */
export function standableFromEntity(e: Entity): Standable | null {
  const top = standableTop(e);
  if (top === null) return null;
  const shape = entityShape(e);
  if (!shape || shape.kind === "sector") return null;
  const b = shape.kind === "rect"
    ? { x0: shape.rect.x, z0: shape.rect.z, x1: shape.rect.x + shape.rect.w, z1: shape.rect.z + shape.rect.d }
    : { x0: shape.c.x - shape.r, z0: shape.c.z - shape.r, x1: shape.c.x + shape.r, z1: shape.c.z + shape.r };
  return { id: e.id, top, dist: (p) => distToShape(p, shape), bounds: b, ...(VAULT_KINDS.has(e.kind) ? { vault: true } : {}) };
}

/** PARKOUR V2 — an axis-aligned rect (a rail run, a Meeting Floor solid) as a traversal item */
export function standableFromRect(id: string, top: number, r: { x: number; z: number; w: number; d: number }, flags: TraversalFlags = {}): Standable {
  return {
    id, top, ...flags,
    dist: (p) => Math.hypot(Math.max(0, r.x - p.x, p.x - (r.x + r.w)), Math.max(0, r.z - p.z, p.z - (r.z + r.d))),
    bounds: { x0: r.x, z0: r.z, x1: r.x + r.w, z1: r.z + r.d },
  };
}

/** PARKOUR V2 — a disc (a café table's pedestal footprint) as a traversal item */
export function standableFromCircle(id: string, top: number, c: Vec2, r: number, flags: TraversalFlags = {}): Standable {
  return { id, top, ...flags, dist: (p) => Math.max(0, Math.hypot(p.x - c.x, p.z - c.z) - r), bounds: { x0: c.x - r, z0: c.z - r, x1: c.x + r, z1: c.z + r } };
}

/** A campus solid box (world/exteriorGround's `box` shape: centre, half extents, rotation) as a standable. */
export function standableFromBox(id: string, top: number, box: { x: number; z: number; hx: number; hz: number; cos: number; sin: number }): Standable {
  const { x, z, hx, hz, cos, sin } = box;
  const ex = Math.abs(hx * cos) + Math.abs(hz * sin), ez = Math.abs(hx * sin) + Math.abs(hz * cos);
  return {
    id,
    top,
    dist: (p) => {
      const dx = p.x - x, dz = p.z - z;
      // world → box frame, exactly as world/exteriorGround solidOverlaps does (the inverse of three's rotation.y)
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      const ox = Math.max(0, Math.abs(lx) - hx), oz = Math.max(0, Math.abs(lz) - hz);
      return Math.hypot(ox, oz);
    },
    bounds: { x0: x - ex, z0: z - ez, x1: x + ex, z1: z + ez },
  };
}

const CELL = 64;

/** Every standable top in the world, bucketed so a point query looks only at what is near it. */
export class StandableIndex {
  private readonly cells = new Map<string, Standable[]>();
  readonly size: number;

  constructor(items: readonly Standable[]) {
    this.size = items.length;
    for (const s of items) {
      for (let cx = Math.floor(s.bounds.x0 / CELL); cx <= Math.floor(s.bounds.x1 / CELL); cx++)
        for (let cz = Math.floor(s.bounds.z0 / CELL); cz <= Math.floor(s.bounds.z1 / CELL); cz++) {
          const k = `${cx},${cz}`;
          const list = this.cells.get(k);
          if (list) list.push(s);
          else this.cells.set(k, [s]);
        }
    }
  }

  /** standables whose outline comes within `r` of `p` (a disc of radius r overlaps them) */
  near(p: Vec2, r: number): Standable[] {
    const out: Standable[] = [];
    const seen = new Set<string>();
    for (let cx = Math.floor((p.x - r) / CELL); cx <= Math.floor((p.x + r) / CELL); cx++)
      for (let cz = Math.floor((p.z - r) / CELL); cz <= Math.floor((p.z + r) / CELL); cz++)
        for (const s of this.cells.get(`${cx},${cz}`) ?? []) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          if (s.dist(p) < r) out.push(s);
        }
    return out;
  }

  /** THE TOP UNDER A BODY: the highest standable top a disc of radius `r` at `p` rests on, or −Infinity. */
  topUnder(p: Vec2, r: number): number {
    let best = -Infinity;
    for (const s of this.near(p, r)) if (canStandOn(s) && s.top > best) best = s.top;
    return best;
  }

  /** A PUBLISHED FEET HEIGHT, VALIDATED: the highest real top under a body at `p` within `tol` of `feet`, or null.
   *  This is how a relayed height is honoured — it can only select a surface that is really there. */
  topMatching(p: Vec2, r: number, feet: number, tol = 2.5): number | null {
    let best: number | null = null;
    for (const s of this.near(p, r)) if (canStandOn(s) && Math.abs(s.top - feet) <= tol && (best === null || s.top > best)) best = s.top;
    return best;
  }

  /** THE TOPS A BODY HAS CLEARED: ids of standables overlapping its disc whose top is at or below `reach` — the
   *  feet plus what this motion allows (a step up when grounded, the air clearance when airborne). These are
   *  the only obstacles a stand test may stop treating as solid for this body, at this height. */
  cleared(p: Vec2, r: number, reach: number): ReadonlySet<string> {
    let out: Set<string> | null = null;
    for (const s of this.near(p, r)) if (canStandOn(s) && s.top <= reach) (out ??= new Set()).add(s.id);
    return out ?? NONE;
  }

  /** PARKOUR V2 — the VAULT obstacles a disc of radius `r` at `p` overlaps (player/traversal) */
  vaultables(p: Vec2, r: number): Standable[] {
    return this.near(p, r).filter((s) => s.vault === true);
  }
}

const NONE: ReadonlySet<string> = new Set();

/** Is `p` inside the polygon `poly` (even-odd)? For outlines such as the treehouse decks' rims. */
export function insidePolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
