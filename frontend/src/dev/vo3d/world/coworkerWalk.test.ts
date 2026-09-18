// Phase 6A — the replay arithmetic, and the one cross-office invariant it rests on.
//
// The walker is pure and clock-free (advance is handed milliseconds), so these drive it exactly as the
// render loop does. The parity case is the important one: if V2's curve ever stops matching V1's, the
// same person is in two different places at the same moment depending on which office you are looking at,
// and they still arrive together — which is what would make it easy to miss.
import { describe, expect, it } from "vitest";
import { ReplayWalk } from "./coworkerWalk";
import { easeInOutQuad, dist, type Vec2 } from "../core/coords";
import { ease as v1Ease } from "../../../components/OfficeMap/useCharacterWalk";

/** A straight 300-unit route north, as a two-point polyline with the origin first. */
const STRAIGHT: Vec2[] = [{ x: 600, z: 800 }, { x: 600, z: 500 }];
/** An L: 200 east, then 200 north. */
const CORNER: Vec2[] = [{ x: 400, z: 800 }, { x: 600, z: 800 }, { x: 600, z: 600 }];

describe("the eased curve is V1's", () => {
  it("agrees with V1's own walker at every sampled point", () => {
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      expect(easeInOutQuad(t)).toBeCloseTo(v1Ease(t), 12);
    }
  });

  it("is the shape a replay needs: fixed ends, slow start and finish", () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 12);
    // Slower than linear in the first quarter, and symmetrically so in the last.
    expect(easeInOutQuad(0.25)).toBeLessThan(0.25);
    expect(easeInOutQuad(0.75)).toBeGreaterThan(0.75);
  });
});

describe("ReplayWalk", () => {
  it("starts at the origin and walks the whole route in the duration V1 published", () => {
    const w = new ReplayWalk("m1", STRAIGHT, 4000);
    expect(w.total).toBeCloseTo(300);
    expect(w.position).toEqual(STRAIGHT[0]);
    expect(w.done).toBe(false);
    for (let t = 0; t < 4000; t += 16) w.advance(16);
    expect(w.done).toBe(true);
    expect(dist(w.position, w.end)).toBeLessThan(1e-6);
  });

  it("moves MONOTONICALLY along the route — a replay never backs up", () => {
    const w = new ReplayWalk("m1", CORNER, 3000);
    let last = { ...CORNER[0] };
    let fromStart = 0;
    while (!w.done) {
      const step = w.advance(33);
      expect(step.travelled).toBeGreaterThanOrEqual(0);
      // Progress is measured from the START of the route, not as a chord sum: a frame that straddles the
      // corner covers the two legs' chord rather than their arc, which is exactly the ground the body
      // visibly crossed. What must never happen is going backwards.
      const d = dist(CORNER[0], step.pos);
      expect(d + 1e-9).toBeGreaterThanOrEqual(fromStart - 1e-9);
      fromStart = d;
      last = step.pos;
    }
    expect(dist(last, w.end)).toBeLessThan(1e-6);
  });

  it("covers exactly the route's length on a straight run", () => {
    // Where chord and arc are the same thing, the per-frame travelled figures must sum to the whole route
    // — that is what the walk clip's playback rate is derived from, so an under- or over-count would show
    // as skating or sprinting feet.
    const w = new ReplayWalk("m1", STRAIGHT, 3000);
    let covered = 0;
    while (!w.done) covered += w.advance(33).travelled;
    expect(covered).toBeCloseTo(w.total, 6);
  });

  it("turns the corner rather than cutting it", () => {
    const w = new ReplayWalk("m1", CORNER, 2000);
    // Halfway along an L of two equal legs is the corner itself.
    w.advance(1000);
    expect(dist(w.position, CORNER[1])).toBeLessThan(1e-6);
  });

  it("reports the heading of travel, and null when it did not move", () => {
    const w = new ReplayWalk("m1", STRAIGHT, 2000);
    // The eased curve is flat at t=0, so the first hair of a frame covers no ground.
    expect(w.advance(0).heading).toBeNull();
    const step = w.advance(400);
    expect(step.heading).not.toBeNull();
    // Travelling north: heading is the compass yaw for -z (core/coords FACING_YAW.north).
    expect(step.heading!).toBeCloseTo(Math.PI, 6);
  });

  it("FAST-FORWARDS a movement that started before this viewer was looking", () => {
    // The whole reason elapsedMs exists: a walk already three quarters done must put the body three
    // quarters along, not snap it back to the origin and re-walk it.
    const w = new ReplayWalk("m1", STRAIGHT, 4000, 3000);
    expect(w.position.z).toBeCloseTo(800 - easeInOutQuad(0.75) * 300, 6);
    expect(w.done).toBe(false);
  });

  it("is DONE, at the end, for a walk whose duration has already passed", () => {
    const w = new ReplayWalk("m1", STRAIGHT, 4000, 9999);
    expect(w.done).toBe(true);
    expect(w.position).toEqual(w.end);
  });

  it("clamps a negative elapsed rather than rewinding — clock skew is not a time machine", () => {
    const w = new ReplayWalk("m1", STRAIGHT, 4000, -5000);
    expect(w.position).toEqual(STRAIGHT[0]);
  });

  it("NEVER EXTRAPOLATES past the end of the route", () => {
    const w = new ReplayWalk("m1", STRAIGHT, 1000);
    for (let t = 0; t < 8000; t += 100) w.advance(100);
    expect(w.position).toEqual(w.end);
    // ...and keeps reporting no movement, so the body idles instead of drifting off.
    expect(w.advance(100).travelled).toBe(0);
  });

  it("is done on construction for a route with no distance in it", () => {
    const here: Vec2 = { x: 600, z: 500 };
    for (const path of [[here], [here, { ...here }], [here, here, here]]) {
      const w = new ReplayWalk("m1", path, 2000);
      expect(w.done).toBe(true);
      expect(w.position).toEqual(here);
    }
  });

  it("survives a zero or negative duration without dividing by it", () => {
    // The adapter already refuses a non-positive duration (a movement with one is not replayed at all),
    // so this is the defensive floor underneath that: the duration clamps to 1 ms, the arithmetic stays
    // finite, and the first frame finishes the walk at its end rather than producing NaN.
    for (const d of [0, -1]) {
      const w = new ReplayWalk("m1", STRAIGHT, d);
      expect(Number.isFinite(w.position.x)).toBe(true);
      expect(Number.isFinite(w.position.z)).toBe(true);
      const step = w.advance(16);
      expect(w.done).toBe(true);
      expect(step.pos).toEqual(w.end);
    }
  });

  it("carries the movement id it was started for, so a re-push can be recognised", () => {
    expect(new ReplayWalk("mv-7", STRAIGHT, 1000).movementId).toBe("mv-7");
  });

  it("lands at the same point as V1's own replay would, at the same moment", () => {
    // The end-to-end statement of the parity case above, in the terms the two offices actually use:
    // same path, same duration, same elapsed → same distance along the route.
    const w = new ReplayWalk("m1", STRAIGHT, 4000);
    for (const elapsed of [250, 1000, 2000, 3000, 3750]) {
      const fresh = new ReplayWalk("m1", STRAIGHT, 4000, elapsed);
      const v1Distance = v1Ease(elapsed / 4000) * 300;
      expect(800 - fresh.position.z).toBeCloseTo(v1Distance, 6);
    }
    expect(w.total).toBeCloseTo(300);
  });
});
