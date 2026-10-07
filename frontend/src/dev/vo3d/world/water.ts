// vo3d world — WATER BODIES, as data. Pure; no THREE.
//
// ONE MODEL FOR WHAT THE WATER LOOKS LIKE AND WHAT IT WILL ONE DAY DO. The lake's renderer (build/exterior
// lakeMesh) shades shallow and deep water from `shoreDistance`, and a future swimming phase reads `waterAt`
// for the very same number — so the pale shelf a player sees is, by construction, the wadeable shelf:
//
//     WALKING (shore) → SHALLOW (wading) → SWIM (deep) → SHALLOW → WALKING
//
// TODAY water is still a blocked surface (world/exteriorGround: neither profile allows "water"); nothing
// here changes traversal. It only describes the body: its outline, its surface height, how far any point
// is from its waterline and how deep the water stands there.
//
// THE OUTLINE IS STAR-SHAPED about its centre (world/campus pondOutline: eight jittered radii through a
// Catmull-Rom), so "distance from the waterline" is measured along the ray from the centre — exact on the
// ray, a close and smooth approximation off it, and the same parameterisation the lake mesh's rings use.
import type { Vec2 } from "../core/coords";
import { POND, POND_SHORE, WATER_Y, pondOutline } from "./campus";

export type WaterZone = "shallow" | "swim";
export type WaterBody = {
  id: string;
  centre: Vec2;
  /** the still-water surface height */
  surfaceY: number;
  /** width of the beach band round it (the shore surface) */
  shoreBand: number;
  /** from the waterline inward, the wadeable shelf (world units) */
  shallowBand: number;
  /** the water's depth at the shelf's outer edge and at the deepest point (world units; the cast is 36 tall) */
  shelfDepth: number;
  maxDepth: number;
  /** the waterline in world x/z, closed (first point repeated last) */
  outline: readonly Vec2[];
};

/** THE AI LAB LAKE — the one body of water in the world */
export const LAKE: WaterBody = {
  id: "ai-lab-lake",
  centre: { x: POND.x, z: POND.z },
  surfaceY: WATER_Y,
  shoreBand: POND_SHORE,
  shallowBand: 56,
  shelfDepth: 14,
  maxDepth: 46,
  // pondOutline's y is NORTH: world z = POND.z − y
  outline: pondOutline(1).map((p) => ({ x: POND.x + p.x, z: POND.z - p.y })),
};
export const WATER_BODIES: readonly WaterBody[] = [LAKE];

/** the waterline's distance from the centre along the bearing `a` (radians, atan2(dz, dx)) */
const radiusTables = new Map<string, Float32Array>();
const TABLE = 512;
function radiusTable(b: WaterBody): Float32Array {
  let t = radiusTables.get(b.id);
  if (t) return t;
  t = new Float32Array(TABLE);
  for (let k = 0; k < TABLE; k++) {
    const a = (k / TABLE) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let best = 0;
    for (let i = 0; i < b.outline.length - 1; i++) {
      const p = b.outline[i], q = b.outline[i + 1];
      const ex = q.x - p.x, ez = q.z - p.z, px = p.x - b.centre.x, pz = p.z - b.centre.z;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const s = (px * ez - pz * ex) / den, u = (px * dz - pz * dx) / den;
      if (s > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, s);
    }
    t[k] = best;
  }
  radiusTables.set(b.id, t);
  return t;
}
export function waterlineRadius(b: WaterBody, bearing: number): number {
  const t = radiusTable(b);
  const f = (((bearing / (Math.PI * 2)) % 1) + 1) % 1 * TABLE;
  const i = Math.floor(f), w = f - i;
  return t[i % TABLE] * (1 - w) + t[(i + 1) % TABLE] * w;
}

/** SIGNED DISTANCE FROM THE WATERLINE, along the ray from the centre: > 0 in the water, < 0 on land. */
export function shoreDistance(b: WaterBody, p: Vec2): number {
  const dx = p.x - b.centre.x, dz = p.z - b.centre.z;
  return waterlineRadius(b, Math.atan2(dz, dx)) - Math.hypot(dx, dz);
}

/** HOW DEEP THE WATER STANDS at a distance `d` in from the waterline: a gentle shelf to `shelfDepth` at the
 *  shallow band's edge, then a smooth fall to `maxDepth`. 0 on land. */
export function depthAtShoreDistance(b: WaterBody, d: number): number {
  if (d <= 0) return 0;
  if (d <= b.shallowBand) return (d / b.shallowBand) * b.shelfDepth;
  const t = Math.min(1, (d - b.shallowBand) / (b.shallowBand * 2.2));
  return b.shelfDepth + (b.maxDepth - b.shelfDepth) * t * t * (3 - 2 * t);
}

export type WaterSample = { body: WaterBody; inWater: boolean; shoreDistance: number; depth: number; zone: WaterZone | null };
/** THE QUERY A SWIMMING PHASE WILL MAKE: which body (if any) a point is in, how far from its edge, how deep,
 *  and whether that depth is wading or swimming. Null when no body is near. */
export function waterAt(p: Vec2): WaterSample | null {
  for (const b of WATER_BODIES) {
    const d = shoreDistance(b, p);
    if (d < -b.shoreBand) continue;
    const depth = depthAtShoreDistance(b, d);
    return { body: b, inWater: d > 0, shoreDistance: d, depth, zone: d <= 0 ? null : d <= b.shallowBand ? "shallow" : "swim" };
  }
  return null;
}
