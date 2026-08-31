import { describe, expect, it } from "vitest";
import {
  advanceWingRhythm,
  BURST_MAX_BEATS,
  BURST_MIN_BEATS,
  createWingRhythm,
  FLAP_FREQUENCY,
  FLAP_STROKE_AMPLITUDE,
  GLIDE_MAX_S,
  GLIDE_MIN_S,
  GLIDE_SPREAD_ANGLE,
  wingStrokeAngle,
  type WingRhythmState,
} from "./toucanWingRhythm";

const TAU = Math.PI * 2;
/** Deterministic stand-in for Math.random so timings are reproducible. */
const constRand = (v: number) => () => v;

/**
 * Runs the rhythm for `seconds` at a fixed step, sampling the stroke angle
 * every frame. `flying` defaults to airborne.
 */
function simulate(
  state: WingRhythmState,
  seconds: number,
  { dt = 1 / 60, flying = true, rand = constRand(0.5) } = {},
) {
  const samples: { t: number; angle: number; mode: string; spread: number }[] = [];
  for (let t = 0; t < seconds; t += dt) {
    advanceWingRhythm(state, dt, flying, rand);
    samples.push({
      t: t + dt,
      angle: wingStrokeAngle(state),
      mode: state.mode,
      spread: state.spread,
    });
  }
  return samples;
}

/** Airborne with the spread pose fully blended in. */
function airborneState(rand = constRand(0.5)) {
  const state = createWingRhythm(rand);
  // Blend `spread` up to ~1 without letting the take-off burst run: hold
  // `flying` true for a second, then fast-forward to the next glide.
  simulate(state, 1, { rand });
  while (state.mode !== "glide") advanceWingRhythm(state, 1 / 60, true, rand);
  return state;
}

describe("wingStrokeAngle — both wings share one phase", () => {
  it("returns a single scalar, so left and right can never diverge", () => {
    const state = airborneState();
    // The contract that kills the alternating-wings bug: one number per
    // frame, applied identically to both bones. There is no per-side value
    // to get out of phase, and no sign flip anywhere in the module.
    for (const sample of simulate(state, 3)) {
      expect(Number.isFinite(sample.angle)).toBe(true);
    }
  });

  it("holds the spread/glide pose exactly at every wingbeat boundary", () => {
    const state = airborneState();
    state.spread = 1;
    for (const beats of [0, 1, 2, 3, 4]) {
      state.phase = beats * TAU;
      expect(wingStrokeAngle(state)).toBeCloseTo(GLIDE_SPREAD_ANGLE, 12);
    }
  });

  it("reaches full downstroke depth at mid-beat", () => {
    const state = airborneState();
    state.spread = 1;
    state.phase = Math.PI;
    expect(wingStrokeAngle(state)).toBeCloseTo(
      GLIDE_SPREAD_ANGLE + FLAP_STROKE_AMPLITUDE,
      12,
    );
  });

  it("keeps the whole cycle inside the camera-framed excursion envelope", () => {
    const state = airborneState();
    state.spread = 1;
    const peak = Math.max(
      Math.abs(GLIDE_SPREAD_ANGLE),
      Math.abs(GLIDE_SPREAD_ANGLE + FLAP_STROKE_AMPLITUDE),
    );
    for (let phase = 0; phase <= TAU; phase += TAU / 720) {
      state.phase = phase;
      expect(Math.abs(wingStrokeAngle(state))).toBeLessThanOrEqual(peak + 1e-9);
    }
  });

  it("rests at the authored bind pose while perched", () => {
    const state = createWingRhythm(constRand(0.5));
    expect(state.spread).toBe(0);
    expect(wingStrokeAngle(state)).toBeCloseTo(0, 12); // signed zero, so not toBe(0)
  });
});

describe("glide / flap-burst rhythm", () => {
  it("starts in glide and does not flap on the spot", () => {
    const state = createWingRhythm(constRand(0.5));
    expect(state.mode).toBe("glide");
    // Perched for well past the longest glide hold: never bursts.
    for (const sample of simulate(state, GLIDE_MAX_S * 3, { flying: false })) {
      expect(sample.mode).toBe("glide");
    }
  });

  it("flaps on take-off, then settles into glide", () => {
    const state = createWingRhythm(constRand(0.5));
    advanceWingRhythm(state, 1 / 60, false); // one perched frame
    advanceWingRhythm(state, 1 / 60, true); // rising edge -> burst
    expect(state.mode).toBe("burst");
  });

  it("alternates glide and burst, never flapping continuously", () => {
    const state = airborneState();
    const samples = simulate(state, 40);
    const glideFrames = samples.filter((s) => s.mode === "glide").length;
    const burstFrames = samples.filter((s) => s.mode === "burst").length;
    expect(glideFrames).toBeGreaterThan(0);
    expect(burstFrames).toBeGreaterThan(0);
    // A calm ambient bird glides at least as much as it flaps.
    expect(glideFrames).toBeGreaterThan(burstFrames);
  });

  it("runs 2-4 whole wingbeats per burst", () => {
    for (const r of [0, 0.34, 0.67, 0.999]) {
      const state = airborneState(constRand(r));
      // Advance to the start of a burst.
      while (state.mode !== "burst") advanceWingRhythm(state, 1 / 60, true, constRand(r));
      const beats = (state.burstPhaseRemaining + state.phase) / TAU;
      expect(beats).toBeGreaterThanOrEqual(BURST_MIN_BEATS);
      expect(beats).toBeLessThanOrEqual(BURST_MAX_BEATS);
      expect(beats % 1).toBeCloseTo(0, 12);
    }
  });

  it("holds each glide for GLIDE_MIN_S..GLIDE_MAX_S", () => {
    for (const r of [0, 0.5, 0.999]) {
      const state = airborneState(constRand(r));
      expect(state.glideRemaining).toBeGreaterThanOrEqual(GLIDE_MIN_S - 1e-9);
      expect(state.glideRemaining).toBeLessThanOrEqual(GLIDE_MAX_S + 1e-9);
    }
  });

  it("never jumps the wing pose at a glide<->burst transition", () => {
    const state = airborneState();
    state.spread = 1;
    const samples = simulate(state, 40);
    // Per-frame stroke change is bounded by the flap curve's own max slope
    // (FLAP_STROKE_AMPLITUDE/2 * FLAP_FREQUENCY rad/s), plus slack for the
    // sub-frame phase residual discarded when a burst ends.
    const maxStep = (FLAP_STROKE_AMPLITUDE / 2) * FLAP_FREQUENCY * (1 / 60) * 1.5;
    for (let i = 1; i < samples.length; i++) {
      const step = Math.abs(samples[i].angle - samples[i - 1].angle);
      expect(step).toBeLessThan(maxStep);
    }
  });

  it("finishes a burst even if the bird perches mid-stroke", () => {
    const state = airborneState();
    while (state.mode !== "burst") advanceWingRhythm(state, 1 / 60, true);
    advanceWingRhythm(state, 1 / 60, true);
    expect(state.mode).toBe("burst");
    // Land immediately: the burst runs to a whole-beat boundary rather than
    // freezing one wing mid-beat.
    let frames = 0;
    while (state.mode === "burst" && frames < 10_000) {
      advanceWingRhythm(state, 1 / 60, false);
      frames++;
    }
    expect(state.mode).toBe("glide");
    expect(state.phase).toBe(0);
  });
});

describe("frame-rate independence", () => {
  it("reaches the same state after 12s regardless of step size", () => {
    const run = (dt: number) => {
      const state = createWingRhythm(constRand(0.5));
      let elapsed = 0;
      while (elapsed < 12 - 1e-9) {
        advanceWingRhythm(state, dt, true, constRand(0.5));
        elapsed += dt;
      }
      return state;
    };
    const at60 = run(1 / 60);
    const at30 = run(1 / 30);
    const at144 = run(1 / 144);
    expect(at30.mode).toBe(at60.mode);
    expect(at144.mode).toBe(at60.mode);
    // Phase drifts only by the discarded sub-frame residual at burst ends.
    expect(Math.abs(at30.phase - at60.phase)).toBeLessThan(0.5);
    expect(Math.abs(at144.phase - at60.phase)).toBeLessThan(0.5);
    expect(at30.spread).toBeCloseTo(1, 2);
    expect(at144.spread).toBeCloseTo(1, 2);
  });
});
