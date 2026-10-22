// vo3d player — S3: THE DRIFT. Pure (no THREE, no input, no clock): PlayerMode hands it one frame at a time and
// player/ScooterMotion turns its answer into movement.
//
// THE CONTROLS ARE THE ONES ALREADY THERE (player/PlayerInput): Space is an EDGE — one press, one hop, never a
// repeat while held — and the arrows / A–D steer.
//
//   tap Space                  the hop it always was
//   hold Space through the     a DRIFT, toward the side being steered (Mario Kart's hop-into-drift). It cannot
//   landing, steering            be straightened without letting go: steering INTO the turn tightens it and
//                                builds charge faster, steering OUT of it widens it
//   let go of Space            the drift ends; enough charge fires a short MINI-BOOST (two tiers)
//   Shift                      the ordinary boost, unchanged
//
// A drift ends WITHOUT a boost when it stops being a drift: too slow, onto a slow surface (lawn, shore), off the
// ground (rolling over an edge), a hard hit, a menu opening, a dismount. The mini-boost is SET, never added:
// one per drift, no stacking, and it needs at least DRIFT.tier1 of charge — over a second of sustained turning.

export const DRIFT = {
  /** the deck must be at least this fast to start one, and a drift that falls below `endSpeed` just ends */
  minSpeed: 120,
  endSpeed: 70,
  /** how hard the bars must be over at the landing (−1…1) */
  steerToStart: 0.35,
  /** after the landing, still holding Space: a steer this soon still starts it (ms) */
  graceMs: 220,
  /** the drift's turn, rad/s: its own rate, more steering into it, less steering out of it */
  turnBase: 1.55,
  turnInto: 0.75,
  turnOut: 0.55,
  /** the deck points INTO the turn by this much while the ride carries on round it (rad), and eases there */
  slip: 0.32,
  slipInto: 0.12,
  slipResponse: 6,
  /** a drift leans harder than a turn (player/ScooterMotion maxLean 0.16) */
  lean: 0.26,
  /** speed shed while drifting, u/s² (less with the throttle held) */
  drag: 40,
  /** charge per second: a base for holding the drift, more for steering into it */
  charge: 0.42,
  chargeInto: 0.38,
  /** the two mini-boost tiers, by charge */
  tier1: 0.45,
  tier2: 1.0,
  /** what each tier fires: how long, and the top speed it drives toward (Shift's own boost is 380) */
  boost: [{ ms: 600, speed: 400 }, { ms: 1000, speed: 430 }],
  /** a surface slower than this share of top speed is no place for a drift (world/exteriorGround cap) */
  minCap: 0.8,
} as const;

export type DriftDir = -1 | 0 | 1;
export type DriftEvent = "start" | "boost" | "end" | "cancel";

export interface DriftInput {
  /** is Space held right now? (false while a menu is open — player/PlayerInput jumpHeld) */
  held: boolean;
  /** the steer input, −1…1 (+ = right) */
  steer: number;
  airborne: boolean;
  /** the deck's speed along its heading, u/s */
  speed: number;
  /** the surface's speed share (world/exteriorGround), 1 = road */
  cap: number;
  /** may the rider drift at all — mounted, owning the body, no menu */
  allowed: boolean;
  /** the deck hit something hard this frame (not a graze along a kerb) */
  hardHit: boolean;
}

export class ScooterDrift {
  dir: DriftDir = 0;
  /** 0…1 */
  charge = 0;
  /** the deck's yaw offset into the turn, rad (eases in and out — the visual recovery is this easing) */
  slip = 0;
  /** a mini-boost running: ms left, and its top speed */
  boostMs = 0;
  boostSpeed = 0;
  /** steering along the drift last frame (−1 out … +1 into) */
  private along = 0;
  private wasAirborne = false;
  private sinceLand = Number.POSITIVE_INFINITY;

  get active(): boolean { return this.dir !== 0; }
  get tier(): 0 | 1 | 2 { return this.charge >= DRIFT.tier2 ? 2 : this.charge >= DRIFT.tier1 ? 1 : 0; }
  get boosting(): boolean { return this.boostMs > 0; }
  /** the drift's turn rate this frame, rad/s (0 when not drifting) */
  get turnRate(): number {
    if (!this.active) return 0;
    const a = this.along;
    return DRIFT.turnBase + (a > 0 ? DRIFT.turnInto * a : DRIFT.turnOut * a);
  }
  /** for the pose stream (S2 `fx`) and the effects */
  get fx(): { drift: DriftDir; charge: number; slip: number; boost: boolean } {
    return { drift: this.dir, charge: this.charge, slip: this.slip, boost: this.boosting };
  }

  /** a new ride, a dismount: nothing carries over */
  reset(): void {
    this.dir = 0; this.charge = 0; this.slip = 0; this.boostMs = 0; this.boostSpeed = 0; this.along = 0;
    this.wasAirborne = false; this.sinceLand = Number.POSITIVE_INFINITY;
  }

  update(i: DriftInput, dtMs: number): DriftEvent | null {
    const dt = Math.max(0, dtMs) / 1000;
    this.boostMs = Math.max(0, this.boostMs - dtMs);
    if (this.boostMs === 0) this.boostSpeed = 0;
    const landed = this.wasAirborne && !i.airborne;
    this.wasAirborne = i.airborne;
    if (landed) this.sinceLand = 0;
    else if (!i.airborne) this.sinceLand += dtMs;
    let event: DriftEvent | null = null;
    if (!this.active) {
      const steer = Math.abs(i.steer) >= DRIFT.steerToStart;
      if (i.allowed && i.held && !i.airborne && this.sinceLand <= DRIFT.graceMs && steer && i.speed >= DRIFT.minSpeed && i.cap >= DRIFT.minCap) {
        this.dir = i.steer > 0 ? 1 : -1;
        this.charge = 0;
        event = "start";
      }
    } else if (!i.allowed || i.airborne || i.speed < DRIFT.endSpeed || i.cap < DRIFT.minCap || i.hardHit) {
      this.dir = 0; this.charge = 0;
      event = "cancel";
    } else if (!i.held) {
      const tier = this.tier;
      if (tier > 0) {
        const b = DRIFT.boost[tier - 1];
        this.boostMs = b.ms; // SET, never added
        this.boostSpeed = b.speed;
      }
      this.dir = 0; this.charge = 0;
      event = tier > 0 ? "boost" : "end";
    }
    if (this.active) {
      this.along = Math.max(-1, Math.min(1, i.steer * this.dir));
      this.charge = Math.min(1, this.charge + dt * (DRIFT.charge + DRIFT.chargeInto * Math.max(0, this.along)));
    } else this.along = 0;
    const want = this.active ? this.dir * (DRIFT.slip + DRIFT.slipInto * this.along) : 0;
    this.slip += (want - this.slip) * Math.min(1, DRIFT.slipResponse * dt);
    if (!this.active && Math.abs(this.slip) < 1e-3) this.slip = 0;
    return event;
  }
}
