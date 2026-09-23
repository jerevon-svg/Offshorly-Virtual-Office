// THE TOUCAN SUMMON MACHINE — the pure half of "Call Toucan", shared by V1's office and the V2 world.
//
// EXTRACTED, NOT REWRITTEN. Every constant, every comment and every function body below came out of
// components/OfficeMap/ToucanFlyer.tsx unchanged, for the same reason chatWindowLayout.ts came out of
// OfficeMap.tsx: dev/vo3d's world-space bird has to park in the same place, arrive on the same radius,
// wait out the same deadbands and fly at the same summoned speed as the 2D one, and a second copy of
// this arithmetic is how the two birds end up behaving like two different animals. ToucanFlyer still
// re-exports all of it, so its own tests (toucanSummon.test.ts) point at the same functions they always
// did and V1's behaviour is bit-for-bit what it was.
//
// UNITS. V1 speaks map PIXELS in the (x, y) of data/office-layout's frame. V2's world happens to be
// built on that very frame at 1:1 (adapters/v1Floor's FRAME is literally FRAME_WIDTH x FRAME_HEIGHT in
// world units), so every threshold here transfers to the 3D world verbatim with `y` read as `z`. That is
// why the V2 bird could adopt this file rather than needing its own tuning pass.
//
// NO THREE, NO REACT, NO DOM — so both callers can unit-test the behaviour without a WebGL context.
import { FRAME_WIDTH } from "../../data/office-layout";

const SPEED_PX_PER_SEC = 55; // calm, ambient pace
const MIN_TRAVEL_S = 4;
const MAX_TRAVEL_S = 18;

export type ToucanSummonState = "roaming" | "approaching" | "attending";

// How far to the SIDE of the player's character centre the bird parks.
// Lateral on purpose: StatusLabel/TalkingBubble occupy the space directly
// above every avatar's head (see greetingAnchor), so parking overhead would
// sit the bird on top of the viewer's own nameplate. Note the canvas is
// already lifted ALTITUDE_PX in screen space, so a park point at the
// character's own centre-y reads as "hovering beside the head."
//
// Was 55px, which read as "across the desk" rather than "with you" — tuned
// down to 32px so the bird is plainly beside the character while still
// clearing the avatar body and the nameplate above it.
const PARK_LATERAL_PX = 32;
// Re-target deadband while approaching: the park point is recomputed from
// the player's live position every frame, but a fresh beginTravel() resets
// travelT to 0, so re-issuing one per frame would leave the bird
// permanently at the start of an ease and effectively frozen. Only a
// MEANINGFUL move (the player actually walking somewhere) re-aims it.
const RETARGET_DEADBAND_PX = 40;
// Close enough to latch `attending` and stop moving. Latching on a radius
// rather than only on travelT>=1 is what stops the bird endlessly
// converging on a target that keeps shifting by a few pixels.
//
// Was 24px, which was fine against the old 55px park offset but became the
// DOMINANT term once that dropped to 32 — measured live, the bird was
// latching up to 24px short and parking ~44px away instead of ~32. Tightened
// to 10px: the normal latch is travelT>=1 (which lands exactly on the park
// point), and this radius is only the early-out for a target that keeps
// shifting slightly, so a small value costs nothing.
const ARRIVE_RADIUS_PX = 10;
// Hysteresis while parked: small player movement is ignored completely (no
// chasing/jitter), but walking properly away re-enters `approaching` so the
// bird catches up. Must stay well above ARRIVE_RADIUS_PX or the two
// thresholds would oscillate.
const FOLLOW_BREAK_PX = 140;
// How much faster a SUMMONED approach flies than normal roaming. Applied
// only on the "approaching" path in beginTravel — SPEED_PX_PER_SEC itself is
// untouched, so roaming is bit-for-bit unchanged.
const SUMMON_SPEED_MULTIPLIER = 1.8;
// Roaming's MIN_TRAVEL_S (4s) exists to keep ambient hops languid; on a
// summon it would swallow the speed-up entirely for the short hops that are
// most common (the bird is usually already in the same room), so a summon
// gets its own, much shorter floor. MAX_TRAVEL_S still applies.
const SUMMON_MIN_TRAVEL_S = 0.9;
// Nose-up pitch applied ONLY while summoned, so the bird reads as
// approaching/hovering in front of its owner instead of presenting its full
// back to the overhead camera. Lives on its own group between the yaw/bank
// pivot and the one-time pose fix, so it never fights either.
// Was 0.55 rad (~32deg), which still read as "looking at the bird's back from
// above." 0.95 rad (~54deg) tips the chest and head clearly toward the
// overhead camera so a summoned toucan reads as hovering in front of its
// owner. Deliberately not 90deg — the silhouette has to stay a flying bird
// with a wing to each side.
const SUMMON_UPRIGHT_MAX_RAD = 0.95;
// Distance to the park point at which the upright blend starts easing in —
// the bird sets up as it closes the last stretch rather than flying the whole
// way tilted.
const SUMMON_UPRIGHT_BLEND_START_PX = 320;
// While parked, the bird faces the LATCHED user centre; the latch only moves
// when the user really moves, so tiny position noise can never make the bird
// swivel. Same value as the approach re-target deadband, same reasoning.
const ATTEND_FACE_DEADBAND_PX = RETARGET_DEADBAND_PX;

// Park point for a given character centre: beside the avatar, on whichever
// side faces the middle of the map, clamped so the bird never parks off the
// frame edge. Exported for the unit tests.
export function parkPointFor(center: { x: number; y: number }): { x: number; y: number } {
  const towardInterior = center.x > FRAME_WIDTH / 2 ? -1 : 1;
  const x = Math.max(
    PARK_LATERAL_PX,
    Math.min(FRAME_WIDTH - PARK_LATERAL_PX, center.x + towardInterior * PARK_LATERAL_PX),
  );
  return { x, y: center.y };
}

// The whole summon state machine, as a pure function of (intent, phase,
// current position, current travel target). Kept out of the rAF closure so
// the thresholds above are unit-testable without a WebGL context or a
// simulated animation loop; updateSummon() below is a thin apply-the-verdict
// wrapper.
export type ToucanSummonDecision =
  // Nothing to do this frame.
  | { kind: "hold" }
  // Start (or restart) a summoned flight AND report the new state.
  | { kind: "approach"; target: { x: number; y: number } }
  // Re-aim an in-progress approach; state is already "approaching".
  | { kind: "retarget"; target: { x: number; y: number } }
  // Close enough — latch parked.
  | { kind: "attend" }
  // Summon withdrawn while approaching/attending — resume roaming.
  | { kind: "release" };

export function decideSummon(input: {
  // Viewer's character centre, or null when not summoned.
  center: { x: number; y: number } | null;
  phase: "flying" | "paused" | "approaching" | "attending";
  pos: { x: number; y: number };
  // Current travel target (only meaningful while approaching).
  to: { x: number; y: number };
}): ToucanSummonDecision {
  const { center, phase, pos, to } = input;

  if (!center) {
    return phase === "approaching" || phase === "attending" ? { kind: "release" } : { kind: "hold" };
  }

  const park = parkPointFor(center);
  const distToPark = Math.hypot(park.x - pos.x, park.y - pos.y);

  if (phase === "attending") {
    // Small movement is ignored entirely (no chasing); a real walk away
    // re-triggers the approach.
    return distToPark > FOLLOW_BREAK_PX ? { kind: "approach", target: park } : { kind: "hold" };
  }

  if (phase === "approaching") {
    if (distToPark <= ARRIVE_RADIUS_PX) return { kind: "attend" };
    // Deadband: only a meaningful shift in the park point re-aims the leg,
    // otherwise travelT would reset every frame and the bird would stall.
    return Math.hypot(park.x - to.x, park.y - to.y) > RETARGET_DEADBAND_PX
      ? { kind: "retarget", target: park }
      : { kind: "hold" };
  }

  // Summoned out of roaming — "flying" mid-leg and "paused"/perched behave
  // identically.
  return { kind: "approach", target: park };
}

// Travel duration for one leg. "roaming" is the ORIGINAL formula verbatim
// (including its +-15% jitter, passed in so this stays pure); "summon" swaps
// in the faster speed and the shorter floor, and takes no jitter at all — a
// click should respond the same way every time.
export function travelDurationFor(
  distancePx: number,
  mode: "roaming" | "summon",
  jitter = 1,
): number {
  if (mode === "summon") {
    const base = distancePx / (SPEED_PX_PER_SEC * SUMMON_SPEED_MULTIPLIER);
    return Math.min(MAX_TRAVEL_S, Math.max(SUMMON_MIN_TRAVEL_S, base));
  }
  const base = distancePx / SPEED_PX_PER_SEC;
  return Math.min(MAX_TRAVEL_S, Math.max(MIN_TRAVEL_S, base)) * jitter;
}

// Nose-up pitch the bird should be easing toward, in radians. Zero for both
// roaming phases — that is what guarantees normal flight is untouched — and
// eases in over the last SUMMON_UPRIGHT_BLEND_START_PX of an approach, held
// at full while parked.
export function uprightPitchTarget(
  phase: "flying" | "paused" | "approaching" | "attending",
  distanceToParkPx: number,
): number {
  if (phase === "attending") return SUMMON_UPRIGHT_MAX_RAD;
  if (phase !== "approaching") return 0;
  const closeness = 1 - Math.min(1, Math.max(0, distanceToParkPx) / SUMMON_UPRIGHT_BLEND_START_PX);
  return SUMMON_UPRIGHT_MAX_RAD * closeness;
}

// The point a parked bird faces. Latches on arrival and only moves once the
// user has genuinely walked, so small position noise never swivels the bird.
export function attendFacePointFor(
  current: { x: number; y: number } | null,
  center: { x: number; y: number },
): { x: number; y: number } {
  if (!current) return center;
  return Math.hypot(center.x - current.x, center.y - current.y) > ATTEND_FACE_DEADBAND_PX
    ? center
    : current;
}

// Yaw (radians) that points the bird's head at `to`. The +PI is not
// decoration: the pose fix maps the head to local -Z, and a plain Y-rotation
// by theta sends local -Z to world (-sin theta, -cos theta) in this
// (map-x, map-y-as-depth) convention — so theta must be atan2(dx, dy) + PI
// for the head to point toward the target rather than away from it. Omitting
// it is exactly the "faces one way, flies backwards" bug.
export function yawToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.x - from.x, to.y - from.y) + Math.PI;
}
