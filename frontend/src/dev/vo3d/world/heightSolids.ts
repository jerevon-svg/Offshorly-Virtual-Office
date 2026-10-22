// vo3d world — HEIGHT-BANDED SOLIDS (PARKOUR V3): obstacles that occupy a vertical BAND, for spaces whose collision
// is answered from their own geometry (the AI Lab, the Cave, any future floor that is not on the V1 lattice).
//
// THE ONE RULE: an obstacle stops a body only where its band overlaps the body's own — from the feet plus what this
// motion clears (a step up on the floor, the air clearance in the air) to the top of the head. So a post under a deck
// stops a body on the floor and not one standing on the deck; a deck's slab stops a head that rises into it and not a
// body walking beneath; a rail stops a body on its deck and not one walking under it; a wall or a trunk, whose band
// runs from the floor to the sky, stops everybody at every height. Nothing else about the floor-plane collision
// changes: these are still outlines tested at the body's radius.
//
// Surfaces you stand on (world/standables) are judged by the same rule with their own band: a platform's slab
// (top − thickness … top), or furniture's full height (floor … top). That is what lets a body stand on a deck, walk
// under it, and never pass through it.
//
// PURE: no THREE, no scene.
import type { Vec2 } from "../core/coords";
import { segDist, topOf, type Standable } from "./standables";

/** a body's vertical extent while it moves: feet, and how much of what is under them it clears */
export type BodyBand = { feet: number; airborne: boolean };
/** the body's height, and the clearances a grounded and an airborne body get over what is beneath them */
export const BODY = { height: 36, stepUp: 5, airClear: 1.5 } as const;

export type HeightSolid = {
  id: string;
  /** distance from a point to the outline (0 inside) */
  dist(p: Vec2): number;
  /** the band it occupies at a point, absolute y */
  band(p: Vec2): readonly [number, number];
  bounds: { x0: number; z0: number; x1: number; z1: number };
};

const FLAT = (y0: number, y1: number) => (): readonly [number, number] => [y0, y1];
export const circleSolid = (id: string, c: Vec2, r: number, y0: number, y1: number): HeightSolid => ({
  id, dist: (p) => Math.max(0, Math.hypot(p.x - c.x, p.z - c.z) - r), band: FLAT(y0, y1), bounds: { x0: c.x - r, z0: c.z - r, x1: c.x + r, z1: c.z + r },
});
/** a box, grown SQUARE (corners included) — the rule every floor-plane box test in the Lab has always used */
export const rectSolid = (id: string, r: { x: number; z: number; w: number; d: number }, y0: number, y1: number): HeightSolid => ({
  id, dist: (p) => Math.max(0, r.x - p.x, p.x - (r.x + r.w), r.z - p.z, p.z - (r.z + r.d)),
  band: FLAT(y0, y1), bounds: { x0: r.x, z0: r.z, x1: r.x + r.w, z1: r.z + r.d },
});
/** a thick line between two (x, y, z) points: a rail along a deck or a ramp, its band following the line's own
 *  height (`below` under it, `above` over it) */
export function segmentSolid(id: string, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, r: number, below: number, above: number): HeightSolid {
  const L2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
  const yAt = (p: Vec2): number => {
    const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / L2));
    return a.y + (b.y - a.y) * t;
  };
  return {
    id, dist: (p) => Math.max(0, segDist(p, a, b) - r),
    band: (p) => { const y = yAt(p); return [y - below, y + above]; },
    bounds: { x0: Math.min(a.x, b.x) - r, z0: Math.min(a.z, b.z) - r, x1: Math.max(a.x, b.x) + r, z1: Math.max(a.z, b.z) + r },
  };
}

/** a surface's own band: a platform's slab, or furniture from `floor` to its top */
export const surfaceBand = (s: Standable, p: Vec2, floor: number): readonly [number, number] =>
  s.thickness !== undefined ? [topOf(s, p) - s.thickness, topOf(s, p)] : [floor, topOf(s, p)];

/** does a band overlap the body's own, for a body at `feet` (moving as `motion` says)? */
export function bandHits(band: readonly [number, number], body: BodyBand): boolean {
  const lo = body.feet + (body.airborne ? BODY.airClear : BODY.stepUp);
  return band[1] > lo && band[0] < body.feet + BODY.height;
}

/** May a disc of `radius` at `p`, with its feet as `body`, stand clear of these solids and surfaces? Anything named in
 *  `ignore` — a vault's one excused obstacle, the structure a route is mounted on — is skipped; nothing else ever is. */
export function clearOfSolids(p: Vec2, radius: number, body: BodyBand, solids: readonly HeightSolid[], surfaces: readonly Standable[], floor: number, ignore?: ReadonlySet<string>): boolean {
  for (const s of solids) {
    if (ignore?.has(s.id)) continue;
    const b = s.bounds;
    if (p.x < b.x0 - radius || p.x > b.x1 + radius || p.z < b.z0 - radius || p.z > b.z1 + radius) continue;
    // inclusive, as the Lab's floor test has always been: touching an obstacle's grown outline is touching it
    if (s.dist(p) <= radius && bandHits(s.band(p), body)) return false;
  }
  for (const s of surfaces) {
    if (ignore?.has(s.id)) continue;
    const b = s.bounds;
    if (p.x < b.x0 - radius || p.x > b.x1 + radius || p.z < b.z0 - radius || p.z > b.z1 + radius) continue;
    if (s.dist(p) < radius && bandHits(surfaceBand(s, p, floor), body)) return false;
  }
  return true;
}
