// vo3d core — ONE world coordinate system.
// x → east (screen right), z → south (screen down), y → up.
// 1 world unit = 1 V1 frame unit; the V1 frame origin (0,0) is the world origin.
// Rooms are world-space rects. There are no room-local world origins.
export type Vec2 = { x: number; z: number };
export type Rect = { x: number; z: number; w: number; d: number };
export type Facing = "north" | "south" | "east" | "west";

/** rotation.y that makes model-forward (+z at yaw 0, i.e. facing the camera / south) face `facing` */
export const FACING_YAW: Record<Facing, number> = { south: 0, west: Math.PI / 2, north: Math.PI, east: -Math.PI / 2 };

export const rectCentre = (r: Rect): Vec2 => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });
export const pointInRect = (p: Vec2, r: Rect): boolean => p.x >= r.x && p.x <= r.x + r.w && p.z >= r.z && p.z <= r.z + r.d;
export const growRect = (r: Rect, m: number): Rect => ({ x: r.x - m, z: r.z - m, w: r.w + 2 * m, d: r.d + 2 * m });
export function circleOverlapsRect(c: Vec2, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(c.x, rect.x + rect.w));
  const nz = Math.max(rect.z, Math.min(c.z, rect.z + rect.d));
  return Math.hypot(c.x - nx, c.z - nz) < r;
}

/** yaw (rotation.y) that faces a movement direction; model forward = +z at yaw 0 */
export const headingFor = (dx: number, dz: number): number => Math.atan2(dx, dz);
/** step `from` toward `to` by at most `maxStep` along the shortest arc */
export function stepAngle(from: number, to: number, maxStep: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
/** The same angle, expressed in (-π, π]. `stepAngle` wraps the DELTA it takes but not the value it
 *  returns, so a yaw that has turned a few times can sit outside that range; a yaw that goes on the
 *  wire, or is compared to one that came off it, is wrapped first so two viewers agree on the number. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** THE INVERSE of FACING_YAW: the compass facing a yaw is closest to.
 *
 *  Defined as the inverse of the TABLE rather than re-derived from the heading arithmetic, so a yaw the
 *  table produced always round-trips back to the facing it came from — whatever convention the table
 *  encodes. Re-deriving it (`atan2`) is how the two would drift apart, and this world already carries two
 *  yaw conventions that differ by π (see app/world.ts facePlayer).
 *
 *  Ties (a yaw exactly 45° between two facings) resolve to the NORTH/SOUTH axis, which is the same
 *  tie-break V1's own directionBetween takes (its `Math.abs(dx) > Math.abs(dy)` is strict, so an exact
 *  diagonal falls through to front/back). */
export function facingForYaw(yaw: number): Facing {
  let best: Facing = "south";
  let bestDelta = Infinity;
  for (const facing of ["south", "north", "east", "west"] as const) {
    let d = yaw - FACING_YAW[facing];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const delta = Math.abs(d);
    if (delta < bestDelta) { bestDelta = delta; best = facing; }
  }
  return best;
}

/** THE EASE V1's OWN WALKER USES, restated here so V2 can replay a V1 walk on the same curve.
 *
 *  Phase 6A replays a coworker's walk from the path and duration V1 published. If V2 interpolated that
 *  linearly while V1's PeerWalker eases it (components/OfficeMap/useCharacterWalk.ts's `ease`, the same
 *  quadratic in/out), the SAME person would be at different points along the SAME path at the same moment
 *  depending on which office you were looking at — up to about an eighth of the path's length apart in
 *  mid-walk. They would still arrive together, which is exactly what makes the discrepancy easy to miss.
 *
 *  So this is a deliberate second copy of a four-line curve rather than a shared import: the world must
 *  stay loadable with no V1 module in its graph (app/world.ts's standing rule). What keeps the two honest
 *  is a test — coworkerWalk.test.ts asserts this agrees with V1's `ease` at sampled t, so the day one of
 *  them is retuned the other is told. */
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
