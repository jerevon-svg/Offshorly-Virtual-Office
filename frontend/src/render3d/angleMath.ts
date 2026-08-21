// Pure angle-interpolation helpers for CharacterCanvas's continuous-turn
// rotation (Phase A.3) — replaces the old 4-step `directionToHeadingDegrees`
// snap with a smooth slerp/lerp of `rotation.y` toward a target heading.
// Kept dependency-free (no THREE import) so it's testable without a real
// THREE.js/WebGL context.
//
// All angles are in DEGREES, normalized to (-180, 180].

// Normalizes an arbitrary angle (degrees) into (-180, 180].
export function normalizeAngleDegrees(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

// Shortest signed delta (degrees, in (-180, 180]) to rotate `from` by to reach
// `to`, going the short way around the circle (never the long way around,
// even across the +/-180deg wrap boundary).
export function shortestAngleDeltaDegrees(from: number, to: number): number {
  return normalizeAngleDegrees(to - from);
}

// Steps `current` toward `target` by at most `maxDeltaDegrees` (always >= 0),
// taking the shortest path and never overshooting — reaches `target` exactly
// once within `maxDeltaDegrees` of it, then holds. Returns a normalized
// (-180, 180] angle.
export function stepAngleTowardsDegrees(
  current: number,
  target: number,
  maxDeltaDegrees: number,
): number {
  const delta = shortestAngleDeltaDegrees(current, target);
  if (Math.abs(delta) <= maxDeltaDegrees) {
    return normalizeAngleDegrees(current + delta);
  }
  return normalizeAngleDegrees(current + Math.sign(delta) * maxDeltaDegrees);
}
