// vo3d player — DIRECT MOVEMENT AND COLLISION, as pure logic. No THREE, no scene, no raycasts.
//
// THE POINT OF THIS FILE: a player walking with WASD needs the same answer click-to-walk already has —
// "may a body of radius r stand at this world point?" — but asked CONTINUOUSLY instead of once per route.
// V2 already owns that answer twice over, so nothing new is authored here:
//
//   inside a reconstructed room  →  DerivedNav.clearanceAtPoint(p), the continuous distance from p to the
//                                   nearest logical solid (walls, footprints, door architecture). Bucketed,
//                                   so a query touches a handful of shapes, never the scene.
//   everywhere else              →  Walkability.walkable(cell), the memoised V1 grid + world regions +
//                                   architectural clearance layer, sampled at the body centre and at four
//                                   rim points so a 16-unit cell test still respects an 8-unit body.
//   either way                   →  WorldState.regionAt(p) decides whether p is office floor at all.
//
// There is therefore NO second collision map, and a desk that moves in the editor blocks the player the
// same frame it blocks the router.
//
// TUNNELLING. At 30 units/s a 60 Hz frame moves half a unit, but a stalled tab hands us a 250 ms dt and a
// 7.5-unit jump — enough to cross a door leaf. So a step is SWEPT: split into sub-steps no longer than a
// quarter of the body radius and resolved one at a time. Cost is bounded by dt, not by the world.
//
// SLIDING. A blocked sub-step is retried on each axis alone before being dropped. That is what makes a
// wall feel like a wall you can walk ALONG rather than a wall you stick to, and it costs two extra
// predicate calls only on the frames where something was actually hit.
import type { Vec2 } from "../core/coords";

/** "may a body stand centred here?" — supplied by the app, which owns the world handles. `ctx`, when the
 *  body is moving with a known height (outdoors): its feet, whether it is airborne and where it steps from
 *  — see world/exteriorGround TraversalState. A test with no heights to judge simply ignores it. */
export type StandTest = (p: Vec2, ctx?: StandContext) => boolean;
export type StandContext = { feet: number; airborne: boolean; from: Vec2 };

/** HEIGHTS FOR ONE MOVE (PlayerMode supplies them outdoors): the feet now, airborne or not, and — while
 *  grounded — the floor under any point (`support`) so the feet follow each sub-step, and the drop past
 *  which a grounded body leaves the edge instead of stepping down it (`fallDrop`). */
export type MoveHeights = { feet: number; airborne: boolean; support?: (p: Vec2) => number; fallDrop?: number };

/** sub-step length as a fraction of the body radius; a quarter of a body cannot skip a solid */
const SUBSTEP_FRACTION = 0.25;
/** how far the spawn search will look for a legal stand point, in radii */
const SPAWN_RINGS = 6;

export type MoveResult = {
  /** where the body ended up (may be the input when fully blocked) */
  pos: Vec2;
  /** distance actually travelled this step — drives the walk clip, so a body pinned to a wall goes idle */
  travelled: number;
  /** true when at least one sub-step was refused, i.e. something was hit */
  blocked: boolean;
  /** with MoveHeights: the feet after the move, and whether the body went off an edge (the move stops there) */
  feet?: number;
  fell?: boolean;
};

export class PlayerBody {
  pos: Vec2;
  readonly radius: number;
  private readonly canStand: StandTest;

  constructor(start: Vec2, radius: number, canStand: StandTest) {
    this.pos = { x: start.x, z: start.z };
    this.radius = radius;
    this.canStand = canStand;
  }

  /** Is the body somewhere legal right now? */
  get grounded(): boolean {
    return this.canStand(this.pos);
  }

  /** Move by a world-space delta, swept and axis-sliding. Returns where it got to. */
  move(dx: number, dz: number, h?: MoveHeights): MoveResult {
    const total = Math.hypot(dx, dz);
    if (total < 1e-6) return h ? { pos: { ...this.pos }, travelled: 0, blocked: false, feet: h.feet, fell: false } : { pos: { ...this.pos }, travelled: 0, blocked: false };
    let feet = h?.feet ?? 0, fell = false;
    const stand = (q: Vec2): boolean => (h ? this.canStand(q, { feet, airborne: h.airborne, from: this.pos }) : this.canStand(q));
    // a grounded sub-step taken: the feet follow the floor, and a drop past `fallDrop` ends the move off the edge
    const took = (q: Vec2): boolean => {
      this.pos = q;
      if (!h || h.airborne || !h.support) return true;
      const y = h.support(q);
      if (h.fallDrop !== undefined && feet - y > h.fallDrop) { fell = true; return false; }
      feet = y;
      return true;
    };
    const maxStep = Math.max(1e-3, this.radius * SUBSTEP_FRACTION);
    const steps = Math.ceil(total / maxStep);
    const sx = dx / steps, sz = dz / steps;
    const start = { ...this.pos };
    let blocked = false;
    for (let i = 0; i < steps; i++) {
      const p = this.pos;
      const full = { x: p.x + sx, z: p.z + sz };
      if (stand(full)) { if (took(full)) continue; break; }
      blocked = true;
      // slide: keep whichever single axis still fits. Tried longest-first so a glancing hit keeps most of
      // its speed instead of snapping to the minor axis.
      const axisX = { x: p.x + sx, z: p.z };
      const axisZ = { x: p.x, z: p.z + sz };
      const first = Math.abs(sx) >= Math.abs(sz) ? axisX : axisZ;
      const second = first === axisX ? axisZ : axisX;
      if (stand(first)) { if (!took(first)) break; }
      else if (stand(second)) { if (!took(second)) break; }
      else break; // a corner: nothing fits, and further sub-steps in this direction will not either
    }
    const res: MoveResult = { pos: { ...this.pos }, travelled: Math.hypot(this.pos.x - start.x, this.pos.z - start.z), blocked };
    if (h) { res.feet = feet; res.fell = fell; }
    return res;
  }

  /** Force the body somewhere legal, searching outward from `p`. Used when PLAYER is entered while the
   *  avatar happens to be standing where only an interaction had put it (mid-seat, on an approach mark).
   *  Returns false when nothing within range works, in which case the caller should refuse the mode. */
  placeNear(p: Vec2): boolean {
    const q = standablePointNear(p, this.radius, this.canStand);
    if (!q) return false;
    this.pos = q;
    return true;
  }
}

/** THE SPAWN SEARCH, as a pure function: the nearest point to `p` a body of `radius` may stand at, or
 *  null when nothing within SPAWN_RINGS radii works.
 *
 *  Lifted out of placeNear (which now delegates to it, unchanged in behaviour) so world/Coworkers.ts can
 *  place a roster body by exactly the test the player is placed by, instead of authoring a second search
 *  that agrees until one of them is tuned. Returning null rather than a forced point is the load-bearing
 *  part: dropping a body inside the furniture is worse than not placing it at all. */
export function standablePointNear(p: Vec2, radius: number, canStand: StandTest): Vec2 | null {
  if (canStand(p)) return { x: p.x, z: p.z };
  for (let ring = 1; ring <= SPAWN_RINGS; ring++) {
    const r = ring * radius;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const q = { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r };
      if (canStand(q)) return q;
    }
  }
  return null;
}
