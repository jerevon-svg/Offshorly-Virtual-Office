// vo3d world — REPLAYING A WALK SOMEBODY ELSE ALREADY TOOK. Phase 6A.
//
// PURE, and deliberately so: no THREE, no scene, no clock. It is handed a polyline, a duration and how
// far in it already is, and it answers "where is the body now, how far did it just move, and which way is
// it going". world/Coworkers.ts turns those answers into a transform and a clip; this file is the only
// place the arithmetic lives, and it is testable without a renderer.
//
// WHAT IT IS REPLAYING. V1's movement wire carries a movement as a path plus a duration
// (services/presence/movementSync's ActiveMovement, published by whoever is walking). Everyone else
// re-runs it locally — that is what V1's own PeerWalker does for the 2D office, and this is the same idea
// for V2's 3D bodies. Nothing here decides where anybody goes: the route and the time it takes are facts
// that arrived from the network.
//
// THREE THINGS IT DOES NOT DO, each for a reason:
//
//   • IT DOES NOT EXTRAPOLATE. When the elapsed time passes the duration the walk is DONE and the body is
//     at the last point, full stop. Guessing where somebody would have gone next is how a replay ends up
//     ahead of the person it is replaying, and then has to be yanked back when the truth lands.
//   • IT DOES NOT VALIDATE THE PATH against V2's floor. The route is V1's account of where that person
//     actually walked; V2 has reconstructed rooms V1 never had, and nudging the path to fit them would
//     redraw somebody else's journey. This is the same rule Phase 4B set for a live position — V1's truth
//     is drawn honestly, not corrected — and coworker bodies collide with nothing, so the cost of an
//     occasional clipped corner is cosmetic.
//   • IT DOES NOT OWN THE CLOCK. `advance` is given milliseconds. The caller's frame loop is the clock,
//     and a test is the clock in a test.
import { dist, easeInOutQuad, headingFor, type Vec2 } from "../core/coords";
import type { Vo3dWalkPacing } from "../app/coworkers";

/** What one frame of a replay produced. */
export interface ReplayStep {
  /** where the body stands now */
  pos: Vec2;
  /** ground covered since the previous call — what the walk clip's playback rate is derived from */
  travelled: number;
  /** the direction of travel, or null when the body did not move (nothing to turn toward) */
  heading: number | null;
}

/**
 * ONE COWORKER'S IN-FLIGHT WALK.
 *
 * `path` is the whole route in WORLD units with the ORIGIN FIRST, so `path[0]` is where the walk began
 * and `path[path.length - 1]` is where it ends. `elapsedMs` is how far into the walk the caller believes
 * it already is — for a movement that started before this viewer connected, that is most of it, and the
 * first `advance` therefore lands the body mid-route rather than snapping it back to the start. V1's
 * PeerWalker calls the same idea a fast-forward.
 *
 * A path with no distance in it is DONE on construction, sitting at its own end point. That covers the
 * degenerate cases (a one-point path, a path of repeated points) without a special case anywhere else.
 */
export class ReplayWalk {
  readonly movementId: string;
  readonly durationMs: number;
  /** "eased" replays on V1's curve; "linear" at constant speed. A free-movement leg is a sample of motion
   *  that did not stop at either end, so easing it would invent a halt at every leg boundary. */
  readonly pacing: Vo3dWalkPacing;
  /** total ground the route covers */
  readonly total: number;
  private readonly pts: readonly Vec2[];
  /** cumulative distance to each point; cum[0] = 0 */
  private readonly cum: readonly number[];
  private elapsed: number;
  /** distance along the route at the last reported step, so `travelled` is a delta and not a total */
  private covered: number;
  /** WHICH WAY THE ROUTE ENDS GOING — the direction of its last segment with any length in it, or null
   *  for a route with no distance at all. Phase 6B.
   *
   *  A fact about the PATH, not about the frames: computed once from the polyline, so it is the same
   *  answer whether the walk was replayed at 60fps, fast-forwarded most of the way, or never advanced at
   *  all. Reading the last `advance`'s heading instead would make it depend on where a frame boundary
   *  happened to land, and a final frame that covered a rounding-sized distance reports nothing. */
  readonly finalHeading: number | null;

  constructor(movementId: string, path: readonly Vec2[], durationMs: number, elapsedMs = 0, pacing: Vo3dWalkPacing = "eased") {
    this.movementId = movementId;
    this.durationMs = Math.max(1, durationMs);
    this.pacing = pacing;
    const pts = path.length > 0 ? path : [{ x: 0, z: 0 }];
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
    this.pts = pts;
    this.cum = cum;
    this.total = cum[cum.length - 1];
    // Clamped on the way in: a clock offset or a rounding error must never rewind a walk (negative) or
    // push it past its own end (which would read as "done" before the body had moved at all).
    this.elapsed = Math.min(this.durationMs, Math.max(0, elapsedMs));
    this.covered = this.distanceAt(this.elapsed);
    // Backwards from the end past any repeated points: a route may legally finish with a zero-length
    // segment (two identical waypoints), and that segment has no direction to report.
    let heading: number | null = null;
    for (let i = pts.length - 1; i >= 1; i--) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      if (Math.hypot(dx, dz) > 1e-6) { heading = headingFor(dx, dz); break; }
    }
    this.finalHeading = heading;
  }

  /** Has the walk run out? A done walk is not advanced again and its body idles at `end`. */
  get done(): boolean {
    return this.elapsed >= this.durationMs || this.total === 0;
  }

  /** The last point of the route — where this walk says the body finishes. */
  get end(): Vec2 {
    return this.pts[this.pts.length - 1];
  }

  /** Ground covered per second over the whole route — a fact about the MOVEMENT, stable for its duration,
   *  which is what the locomotion clip (walk or run) is chosen by. Choosing by the instantaneous speed
   *  would flip an eased walk into a run at its mid-point, where the curve peaks at 1.5x the mean. */
  get meanSpeed(): number {
    return (this.total / this.durationMs) * 1000;
  }

  /** Where the body is right now, without advancing anything. */
  get position(): Vec2 {
    return this.pointAt(this.covered);
  }

  /** Advance by `dtMs` and report the step. Safe to call on a done walk: it reports the end, standing still. */
  advance(dtMs: number): ReplayStep {
    const before = this.position;
    this.elapsed = Math.min(this.durationMs, this.elapsed + Math.max(0, dtMs));
    const covered = this.distanceAt(this.elapsed);
    this.covered = covered;
    const pos = this.pointAt(covered);
    const dx = pos.x - before.x;
    const dz = pos.z - before.z;
    const travelled = Math.hypot(dx, dz);
    return { pos, travelled, heading: travelled > 1e-6 ? headingFor(dx, dz) : null };
  }

  /** ON V1'S OWN CURVE. See core/coords easeInOutQuad: the same quadratic in/out V1's walker eases every
   *  path with, so the two offices place the same person at the same point at the same moment. */
  private distanceAt(elapsedMs: number): number {
    const t = Math.min(1, elapsedMs / this.durationMs);
    return (this.pacing === "linear" ? t : easeInOutQuad(t)) * this.total;
  }

  /** The point `d` units along the route, by segment. */
  private pointAt(d: number): Vec2 {
    if (this.total === 0) return { ...this.end };
    const clamped = Math.min(this.total, Math.max(0, d));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < clamped) i++;
    const segStart = this.pts[i - 1];
    const segEnd = this.pts[i];
    const segLen = this.cum[i] - this.cum[i - 1];
    const t = segLen === 0 ? 1 : (clamped - this.cum[i - 1]) / segLen;
    return { x: segStart.x + (segEnd.x - segStart.x) * t, z: segStart.z + (segEnd.z - segStart.z) * t };
  }
}
