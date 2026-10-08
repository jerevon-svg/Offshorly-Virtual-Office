// vo3d player — HOW A SHARED E-SCOOTER MOVES. Pure arcade handling: no THREE, no world, no DOM, so every
// number here is tunable and testable on its own. PlayerMode feeds it the held keys and moves the body by
// what it returns, through the ride area's own stand test (world/scooters).
//
// THE FEEL, in one paragraph. It is a scooter, not a car and not a faster walk: it rolls up to speed
// over about a second and a half, coasts down when you let go, brakes hard, and steers by turning the
// deck — A/D bend the path, they do not strafe. Steering is quickest at walking pace and relaxes as the
// speed comes up, so it stays controllable at full speed without becoming twitchy, and you can still
// pivot out of a dead end. The deck leans into the turn with the speed — the one visual that says "this
// is momentum". Shift is a short-lived boost, not a second gear.

/** Tuning. World units (a person is 36 tall; a walk is 70 u/s, a sprint 100). */
export const SCOOTER = {
  /** cruising top speed, and the Shift boost */
  // TUNED FOR THE WHOLE WORLD (Phase 4b): quick transport, ~3x a sprint on a road. Acceleration, braking and
  // coasting scale with it (x1.62) so reaching cruise, stopping and rolling to rest take as long as before.
  maxSpeed: 300,
  boostSpeed: 380,
  /** rolling up to speed, u/s² */
  accel: 243,
  /** holding the brake (S while moving forward), and coasting with nothing held */
  brake: 585,
  coast: 130,
  /** a slow walk-pace reverse, for backing out of a nose-in stop */
  reverseSpeed: 32,
  /** steering: turn rate at low speed and at top speed, rad/s — quick when slow, calmer when fast */
  turnSlow: 2.9,
  turnFast: 2.4,
  /** how fast the held steer input is reached (so a tap is a nudge and a hold is a turn) */
  steerResponse: 9,
  /** lean: radians at full steer and full speed */
  maxLean: 0.16,
  /** hitting a wall keeps this fraction of the speed (the body slides along it) */
  bump: 0.55,
  /** rolling from a faster surface onto a slower one: how hard the deck sheds the difference, u/s² */
  surfaceDrag: 220,
  /** IN THE AIR (a Space hop): the share of the ground turn rate the bars still give — enough to correct a
   *  line, not to carve — and the speed shed per second (none: the hop keeps the momentum it left with) */
  airSteer: 0.3,
  airDrag: 0,
} as const;

/** THE HOP (player/PlayerJump tuning): snappier than the walk's float — a quick pop of about 12.6 units that
 *  lands inside half a second, so its length is the deck's speed: ~140 at cruise, ~175 boosted. */
export const SCOOTER_JUMP = { takeoff: 110, gravity: 480 } as const;

/** `cap` (0…1, default 1): the surface's share of the top speed (world/exteriorGround SURFACE_SPEED) — the
 *  deck eases down to it at `surfaceDrag`, never snaps */
/** `airborne`: the wheels are off the ground — no drive, no brake, no surface drag, light steering */
export type ScooterInput = { throttle: number; steer: number; boost: boolean; cap?: number; airborne?: boolean };

export class ScooterMotion {
  /** signed speed along the heading, u/s (negative = reversing) */
  speed = 0;
  /** heading in the avatar's convention: forward = (sin h, −cos h) */
  heading: number;
  /** smoothed steer input, −1..1 */
  steer = 0;
  /** current visual lean, radians (positive = leaning right) */
  lean = 0;

  constructor(heading: number) {
    this.heading = heading;
  }

  /** Advance by dt. Returns the world-space displacement to attempt. */
  step(input: ScooterInput, dt: number): { dx: number; dz: number } {
    const S = SCOOTER;
    const throttle = Math.max(-1, Math.min(1, input.throttle));
    const target = Math.max(-1, Math.min(1, input.steer));
    this.steer += (target - this.steer) * Math.min(1, S.steerResponse * dt);
    const top = input.boost ? S.boostSpeed : S.maxSpeed;
    // the surface's own limit: below `top` (boost/cruise, handled exactly as before), shed at surfaceDrag
    const surfaceTop = top * Math.max(0.05, Math.min(1, input.cap ?? 1));
    if (input.airborne) {
      // nothing to push against: the hop carries the speed it left with
      const d = S.airDrag * dt;
      this.speed = Math.abs(this.speed) <= d ? 0 : this.speed - Math.sign(this.speed) * d;
    } else if (throttle > 0) {
      // rolling forward (or cancelling a reverse first, at braking strength)
      const a = this.speed < 0 ? S.brake : S.accel * throttle;
      // accelerate only up to what the surface allows; any excess is shed at surfaceDrag below
      const aim = Math.min(top, surfaceTop);
      if (this.speed < aim) this.speed = Math.min(aim, this.speed + a * dt);
      // letting a boost lapse eases back down rather than snapping
      if (this.speed > top) this.speed = Math.max(top, this.speed - S.coast * dt);
    } else if (throttle < 0) {
      if (this.speed > 0) this.speed = Math.max(0, this.speed - S.brake * dt);
      else this.speed = Math.max(-S.reverseSpeed, this.speed - S.accel * 0.5 * dt);
    } else {
      const d = S.coast * dt;
      this.speed = Math.abs(this.speed) <= d ? 0 : this.speed - Math.sign(this.speed) * d;
    }
    if (!input.airborne) {
      if (this.speed > top) this.speed = Math.max(top, this.speed - S.coast * dt);
      if (this.speed > surfaceTop) this.speed = Math.max(surfaceTop, this.speed - S.surfaceDrag * dt);
    }
    // steering: rate eases from turnSlow to turnFast with speed, and there is some turn even when still
    const k = Math.min(1, Math.abs(this.speed) / S.maxSpeed);
    const rate = S.turnSlow + (S.turnFast - S.turnSlow) * k;
    const moving = Math.abs(this.speed) > 4 ? Math.sign(this.speed) : 1;
    this.heading += this.steer * rate * (input.airborne ? S.airSteer : 1) * dt * moving * (0.45 + 0.55 * Math.min(1, Math.abs(this.speed) / 40));
    // lean follows steer × speed, smoothed
    const want = this.steer * S.maxLean * k;
    this.lean += (want - this.lean) * Math.min(1, 7 * dt);
    const d = this.speed * dt;
    return { dx: Math.sin(this.heading) * d, dz: -Math.cos(this.heading) * d };
  }

  /** THE BODY MET SOMETHING this step and slid (PlayerBody resolves it). The deck keeps the speed it
   *  ACTUALLY made good — so a graze along a kerb costs only the component into it, and a head-on stop
   *  really stops — with a small knock so touching a wall is still felt. `travelled` is what the body
   *  covered this step, `dt` the step. */
  bumped(travelled: number, dt: number): void {
    const achieved = dt > 0 ? travelled / dt : 0;
    const kept = Math.min(Math.abs(this.speed), achieved * 1.02) * Math.sign(this.speed);
    this.speed = kept * (1 - (1 - SCOOTER.bump) * 0.12);
  }
}
