// vo3d — THE SHADOW FRAME'S FOCUS GRID (Phase 4C stage 2).
//
// WHAT IS ACTUALLY BEING PINNED HERE. Every time the shadow frustum re-centres, Renderer.updateShadowFrame
// calls invalidateShadows() and the NEXT frame redraws every static caster in the building into the shadow
// map — measured at ~5.3 ms on the ground floor. So the centre's grid is not a cosmetic tuning constant,
// it IS the static-pass rate, and the rate is what these tests hold: crossings per second are
// speed / quantum per axis, and nothing about walking may put that back where it was.
//
// The decision is pure (snapShadowCentre) precisely so it can be held here. The live wiring — PLAYER
// setting the override and CameraModes giving it back — is asserted in player.test.ts, next to the rest of
// the mode handoff.
import { describe, expect, it } from "vitest";
import { snapShadowCentre } from "./render/Renderer";
import { PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "./player/PlayerMode";
import type { Vec2 } from "./core/coords";

/** The grid PLAYER mode installs. Stated here rather than imported because app/world holds it inside
 *  createVo3dWorld — if that number moves, this file is exactly where the rate has to be re-argued. */
const PLAYER_QUANTUM = 64;
/** The orbit default, which OFFICE and EXPLORE are still on. */
const ORBIT_QUANTUM = 8;

/** Walk a focus in a straight line and count how many times the frame re-centres. Returns the centres so
 *  a caller can also assert WHERE they were, not merely how many. */
function walk(opts: { quantum: number; speed: number; seconds: number; fps: number; heading: Vec2; from?: Vec2 }): {
  snaps: number; frames: number; centres: Vec2[]; maxDrift: number;
} {
  const { quantum, speed, seconds, fps, heading } = opts;
  const len = Math.hypot(heading.x, heading.z) || 1;
  const dir = { x: heading.x / len, z: heading.z / len };
  const focus: Vec2 = { ...(opts.from ?? { x: 0, z: 0 }) };
  let centre: Vec2 = { x: Number.NaN, z: Number.NaN };
  const centres: Vec2[] = [];
  const frames = Math.round(seconds * fps);
  let snaps = 0;
  let maxDrift = 0;
  for (let f = 0; f < frames; f++) {
    const next = snapShadowCentre(centre, focus, quantum);
    if (next !== centre) { snaps++; centres.push(next); }
    centre = next;
    maxDrift = Math.max(maxDrift, Math.hypot(focus.x - centre.x, focus.z - centre.z));
    focus.x += (dir.x * speed) / fps;
    focus.z += (dir.z * speed) / fps;
  }
  return { snaps, frames, centres, maxDrift };
}

describe("shadow focus — snapping", () => {
  it("snaps to the grid, and an unsettled centre always re-snaps", () => {
    expect(snapShadowCentre({ x: Number.NaN, z: Number.NaN }, { x: 40, z: -100 }, 64)).toEqual({ x: 64, z: -128 });
    expect(snapShadowCentre({ x: Number.NaN, z: Number.NaN }, { x: 3, z: 5 }, 8)).toEqual({ x: 0, z: 8 });
  });

  it("holds the frame still while the focus stays inside the dead band", () => {
    const centre = { x: 0, z: 0 };
    // 0.55 of 64 = 35.2 units of allowed drift per axis
    expect(snapShadowCentre(centre, { x: 35, z: -35 }, 64)).toBe(centre); // same object: nothing moved
    expect(snapShadowCentre(centre, { x: 0, z: 35.2 }, 64)).toBe(centre);
  });

  it("re-centres once the focus leaves the dead band, on either axis alone", () => {
    const centre = { x: 0, z: 0 };
    expect(snapShadowCentre(centre, { x: 36, z: 0 }, 64)).toEqual({ x: 64, z: 0 });
    expect(snapShadowCentre(centre, { x: 0, z: -36 }, 64)).toEqual({ x: 0, z: -64 });
    // ...and it goes to the NEAREST grid point, not one step along: a teleport lands in one move.
    expect(snapShadowCentre(centre, { x: 900, z: 900 }, 64)).toEqual({ x: 896, z: 896 });
  });

  it("`force` re-snaps even when the focus has not moved — the sun moving needs a fresh frame", () => {
    const centre = { x: 0, z: 0 };
    expect(snapShadowCentre(centre, { x: 4, z: 4 }, 64)).toBe(centre);
    expect(snapShadowCentre(centre, { x: 4, z: 4 }, 64, true)).toEqual({ x: 0, z: 0 });
    expect(snapShadowCentre(centre, { x: 4, z: 4 }, 64, true)).not.toBe(centre); // a new object, i.e. a real re-snap
  });

  it("HYSTERESIS: a focus wobbling on a cell boundary does not re-centre every frame", () => {
    // The failure this exists for: with a band of exactly half a quantum, a focus sitting ON the band edge
    // flips the centre 0 <-> 64 forever, and every flip is a full static redraw of the building. The
    // wobble below is parked on that edge (0.55 * 64 = 35.2) and crosses it on every other frame.
    let centre: Vec2 = { x: 0, z: 0 };
    let snaps = 0;
    for (let f = 0; f < 120; f++) {
      const focus = { x: 35.2 + (f % 2 ? 0.4 : -0.4), z: 0 };
      const next = snapShadowCentre(centre, focus, PLAYER_QUANTUM);
      if (next !== centre) snaps++;
      centre = next;
    }
    // ONE move — out to 64 on the first frame past the edge — and then the wobble is 28 units inside the
    // new band and cannot reach back. Without the dead band this loop costs 120 static passes.
    expect(snaps).toBe(1);
  });
});

describe("shadow focus — static-pass rate at the approved speeds", () => {
  // The acceptance targets for stage 2, expressed as the arithmetic they come from rather than as a
  // measurement: static passes on <= 5% of walking frames and <= 8% of sprinting frames, at 60 fps.
  const FPS = 60;
  const WALK_BUDGET = 0.05;
  const SPRINT_BUDGET = 0.08;
  const DIAGONAL = { x: 1, z: 1 };
  const AXIS = { x: 1, z: 0 };

  it("a 30-second diagonal walk stays inside the walking budget", () => {
    const r = walk({ quantum: PLAYER_QUANTUM, speed: PLAYER_WALK_SPEED, seconds: 30, fps: FPS, heading: DIAGONAL });
    expect(r.snaps / r.frames).toBeLessThanOrEqual(WALK_BUDGET);
  });

  it("a 30-second diagonal SPRINT stays inside the sprinting budget", () => {
    const r = walk({ quantum: PLAYER_QUANTUM, speed: PLAYER_SPRINT_SPEED, seconds: 30, fps: FPS, heading: DIAGONAL });
    expect(r.snaps / r.frames).toBeLessThanOrEqual(SPRINT_BUDGET);
  });

  it("NO heading and no starting offset blows the budget", () => {
    // Swept rather than argued, because the worst case is not where intuition puts it. From the origin a
    // diagonal is the CHEAP direction: each axis moves at 0.71 of the speed and both leave the dead band on
    // the same frame, so one re-centre serves both. Give the two axes different phases — any start that is
    // not on the grid — and they take turns instead, which is what actually costs the most: up to two
    // re-centres per cell travelled. Hence the offsets below, not just the headings.
    let worstWalk = 0, worstSprint = 0;
    for (let deg = 0; deg < 360; deg += 3) {
      const heading = { x: Math.cos((deg * Math.PI) / 180), z: Math.sin((deg * Math.PI) / 180) };
      for (const from of [{ x: 0, z: 0 }, { x: 7, z: 41 }, { x: 13, z: -29 }, { x: 31, z: 5 }]) {
        worstWalk = Math.max(worstWalk, walk({ quantum: PLAYER_QUANTUM, speed: PLAYER_WALK_SPEED, seconds: 30, fps: FPS, heading, from }).snaps);
        worstSprint = Math.max(worstSprint, walk({ quantum: PLAYER_QUANTUM, speed: PLAYER_SPRINT_SPEED, seconds: 30, fps: FPS, heading, from }).snaps);
      }
    }
    const frames = 30 * FPS;
    expect(worstWalk / frames).toBeLessThanOrEqual(WALK_BUDGET);
    expect(worstSprint / frames).toBeLessThanOrEqual(SPRINT_BUDGET);
    // ...and the in-phase diagonal really is the cheap one, which is why the sweep has to exist.
    expect(walk({ quantum: PLAYER_QUANTUM, speed: PLAYER_SPRINT_SPEED, seconds: 30, fps: FPS, heading: DIAGONAL }).snaps)
      .toBeLessThan(walk({ quantum: PLAYER_QUANTUM, speed: PLAYER_SPRINT_SPEED, seconds: 30, fps: FPS, heading: AXIS }).snaps);
    // THE NUMBERS THE BUDGET WAS SIGNED OFF ON, pinned so a tuning change has to restate them: 48 and 68
    // re-centres over 30 s — 1.6/s walking, 2.3/s sprinting. At 60 fps that is 2.7% and 3.8% of frames, so
    // the 5% / 8% budgets are only reached if the frame rate itself falls below ~32 fps / ~26 fps.
    expect(worstWalk).toBe(48);
    expect(worstSprint).toBe(68);
  });

  it("THE REGRESSION: the orbit grid would blow both budgets, which is why PLAYER overrides it", () => {
    // The pre-stage-2 behaviour, held here so a revert cannot pass quietly.
    const before = walk({ quantum: ORBIT_QUANTUM, speed: PLAYER_WALK_SPEED, seconds: 30, fps: FPS, heading: AXIS });
    expect(before.snaps / before.frames).toBeGreaterThan(WALK_BUDGET);
    const after = walk({ quantum: PLAYER_QUANTUM, speed: PLAYER_WALK_SPEED, seconds: 30, fps: FPS, heading: AXIS });
    expect(after.snaps * 6).toBeLessThan(before.snaps); // better than 6x, walking a straight line
  });

  it("OFFICE and EXPLORE keep the grid they were approved with", () => {
    // Not a rate claim — a same-centres claim. The orbit modes must still land on the multiples of 8 they
    // always did; only the moment of the hand-off moves, by the width of the dead band.
    const r = walk({ quantum: ORBIT_QUANTUM, speed: 40, seconds: 2, fps: FPS, heading: AXIS });
    expect(r.centres.length).toBeGreaterThan(1);
    for (const c of r.centres) expect(c.x % ORBIT_QUANTUM).toBe(0);
  });
});

describe("shadow focus — coverage the frame must keep", () => {
  /** PLAYER's frustum half-size, from app/world. The body may sit this far from the centre at worst. */
  const PLAYER_SHADOW_RADIUS = 300;
  /** The loss the 64 grid was accepted with: at worst a sixth of the shadowed ground ahead of the body. */
  const MIN_COVERAGE_FRACTION = 5 / 6;

  it("never lets the body drift further from the centre than the grid allows", () => {
    for (const heading of [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }, { x: -3, z: 1 }, { x: 1, z: -7 }]) {
      const r = walk({ quantum: PLAYER_QUANTUM, speed: PLAYER_SPRINT_SPEED, seconds: 30, fps: 60, heading, from: { x: 13, z: -29 } });
      // per axis 0.55 * 64 = 35.2, so the worst case is that on both axes at once
      expect(r.maxDrift).toBeLessThanOrEqual(Math.hypot(35.2, 35.2) + 1e-9);
    }
  });

  it("keeps at least five sixths of the shadowed ground in front of the body", () => {
    const worst = Math.hypot(PLAYER_QUANTUM * 0.55, PLAYER_QUANTUM * 0.55);
    expect((PLAYER_SHADOW_RADIUS - worst) / PLAYER_SHADOW_RADIUS).toBeGreaterThanOrEqual(MIN_COVERAGE_FRACTION);
  });

  it("a coarser grid than 64 would break that coverage floor — 64 is the ceiling, not a round number", () => {
    const worst = Math.hypot(128 * 0.55, 128 * 0.55);
    expect((PLAYER_SHADOW_RADIUS - worst) / PLAYER_SHADOW_RADIUS).toBeLessThan(MIN_COVERAGE_FRACTION);
  });
});
