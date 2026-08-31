// ---------------------------------------------------------------------------
// Toucan flight rhythm — the glide/flap-burst state machine and the wing
// stroke curve, kept as a pure, THREE-free module (same split as
// render3d/angleMath.ts) so the timing can be unit-tested without a WebGL
// context. ToucanFlyer.tsx owns the bones; this owns the *phase*.
//
// TWO invariants this module exists to guarantee:
//
// 1. BOTH WINGS SHARE ONE PHASE. wingStrokeAngle() returns a single scalar
//    that ToucanFlyer applies to the LeftArm and RightArm bones with the
//    SAME sign. That looks counter-intuitive but is correct for this rig:
//    LeftShoulder/RightShoulder ship mirrored bind quaternions
//    (~(0.537, 0.555, -0.453, 0.444) vs ~(0.537, -0.556, 0.459, 0.438)),
//    so the two bones' local axes already point in opposite world
//    directions. Composing the same local-space rotation onto both bind
//    poses therefore produces naturally MIRRORED world motion — both
//    wingtips travel the same way relative to the body. Negating one side
//    mirrors an already-mirrored frame, which drives the wings in the same
//    world direction (one up while the other goes down) — that double
//    mirror was the old "left -> right -> left" alternating-wings bug.
//
// 2. A BURST STARTS AND ENDS EXACTLY AT THE GLIDE POSE. The stroke uses
//    (1 - cos(phase)) / 2, which is 0 with zero slope at every multiple of
//    2*PI, and a burst is always a WHOLE number of 2*PI wingbeats. So the
//    glide -> flap and flap -> glide handoffs are continuous in both
//    position and velocity for free — no cross-fade, no envelope lerp, and
//    structurally impossible to snap into the glide pose.
//
// The whole machine is a handful of numbers advanced by dt inside the
// existing requestAnimationFrame loop: no timers, no listeners, no React
// state, frame-rate independent, and randomized ONLY at state transitions
// (never per frame).
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** Flap phase speed, radians/sec. One wingbeat = TAU/FLAP_FREQUENCY ~= 0.70s. */
export const FLAP_FREQUENCY = 9;
/**
 * The glide/soar base pose, as radians about FLAP_AXIS off the authored bind
 * pose. NEGATIVE = wings raised/extended (verified against the real GLB: a
 * positive local-X rotation on LeftArm drops the wingtip's world Y, so
 * negative lifts it). Deliberately small — the bind pose already reads as
 * "wings out to the sides" once the flying-posture fix tips the rig onto its
 * belly, so this is a slight extension of it, not a new silhouette.
 */
export const GLIDE_SPREAD_ANGLE = -0.15;
/**
 * Downstroke depth measured FROM the glide pose (so the wing travels
 * GLIDE_SPREAD_ANGLE .. GLIDE_SPREAD_ANGLE + FLAP_STROKE_AMPLITUDE =
 * -0.15 .. +0.55 rad). The +0.55 upper bound is intentional: it matches the
 * old symmetric flap's peak excursion, so ToucanFlyer's one-shot camera
 * framing (FRAME_PADDING_FACTOR) still covers a full-amplitude stroke
 * without re-fitting.
 */
export const FLAP_STROKE_AMPLITUDE = 0.7;

export const GLIDE_MIN_S = 2.2;
export const GLIDE_MAX_S = 5;
export const BURST_MIN_BEATS = 2;
export const BURST_MAX_BEATS = 4;
/** How fast the spread base pose blends in on take-off / out on perch. */
export const SPREAD_BLEND_RATE = 4;

export type WingMode = "glide" | "burst";

export interface WingRhythmState {
  mode: WingMode;
  /** Flap phase in radians; 0 (and every multiple of TAU) is the glide pose. */
  phase: number;
  /** Seconds left to hold the glide pose. Glide mode only. */
  glideRemaining: number;
  /** Radians of flap phase left in the current burst. Burst mode only. */
  burstPhaseRemaining: number;
  /** 0 = perched (exact bind pose), 1 = airborne (spread pose applies). */
  spread: number;
  /** Previous frame's airborne flag, for take-off edge detection. */
  wasFlying: boolean;
}

export type RandomFn = () => number;

function nextGlideDuration(rand: RandomFn): number {
  return GLIDE_MIN_S + rand() * (GLIDE_MAX_S - GLIDE_MIN_S);
}

/** Starts a burst of a whole number of wingbeats from the glide pose. */
function beginBurst(state: WingRhythmState, rand: RandomFn): void {
  const beats =
    BURST_MIN_BEATS + Math.floor(rand() * (BURST_MAX_BEATS - BURST_MIN_BEATS + 1));
  state.mode = "burst";
  state.phase = 0;
  state.burstPhaseRemaining = beats * TAU;
}

export function createWingRhythm(rand: RandomFn = Math.random): WingRhythmState {
  return {
    mode: "glide",
    phase: 0,
    glideRemaining: nextGlideDuration(rand),
    burstPhaseRemaining: 0,
    spread: 0,
    wasFlying: false,
  };
}

/**
 * Advances the rhythm by `dt` seconds. `flying` is the bird's existing
 * travel phase (false while perched/paused): it gates *starting* a burst and
 * drives the spread blend, but never interrupts a burst mid-stroke, so the
 * bird can never freeze with one wing mid-beat.
 */
export function advanceWingRhythm(
  state: WingRhythmState,
  dt: number,
  flying: boolean,
  rand: RandomFn = Math.random,
): void {
  state.spread += ((flying ? 1 : 0) - state.spread) * Math.min(1, SPREAD_BLEND_RATE * dt);

  // Take-off flaps: a bird leaving a perch beats its wings, so the rising
  // edge of `flying` pre-empts whatever glide hold was pending.
  const tookOff = flying && !state.wasFlying;
  state.wasFlying = flying;
  if (tookOff && state.mode === "glide") beginBurst(state, rand);

  if (state.mode === "burst") {
    const step = dt * FLAP_FREQUENCY;
    state.phase += step;
    state.burstPhaseRemaining -= step;
    if (state.burstPhaseRemaining <= 0) {
      // The burst just completed a whole number of beats, so the stroke is
      // already back at (within one frame of) the glide pose — see invariant
      // 2 above. Rewinding phase to 0 is the same pose, not a jump.
      state.mode = "glide";
      state.phase = 0;
      state.burstPhaseRemaining = 0;
      state.glideRemaining = nextGlideDuration(rand);
    }
    return;
  }

  state.glideRemaining -= dt;
  if (state.glideRemaining > 0) return;
  // Perched birds keep re-arming the glide hold instead of bursting, so the
  // rhythm is ready to go the moment they take off again.
  if (flying) beginBurst(state, rand);
  else state.glideRemaining = nextGlideDuration(rand);
}

/**
 * The stroke rotation, in radians about ToucanFlyer's FLAP_AXIS, to compose
 * onto BOTH wing bones' bind quaternions with the SAME sign (invariant 1).
 */
export function wingStrokeAngle(state: WingRhythmState): number {
  const stroke = (1 - Math.cos(state.phase)) / 2; // 0 -> 1 -> 0 per wingbeat
  return state.spread * (GLIDE_SPREAD_ANGLE + FLAP_STROKE_AMPLITUDE * stroke);
}
