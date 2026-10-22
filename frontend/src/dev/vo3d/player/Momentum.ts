// vo3d player — MOMENTUM ON FOOT. Player View's WASD no longer sets the body's velocity outright: it sets where the
// body WANTS to go, and the body gets there the way a stylised game character does — quick to answer at a walk,
// building up into a sprint, and carrying a sprint's momentum when it stops or turns.
//
//   accelerating   along the way it is already going, up to ACCEL (a walk is reached almost at once; a sprint
//                  builds over ~0.6 s)
//   braking        against it — letting go, or pushing the other way — at STOP (from a walk: a step) or, from a
//                  run, BRAKE: a short, visible skid whose length grows with the speed (from a full sprint
//                  ~45 units in ~0.45 s, never more)
//   turning        across it, up to GRIP: a sprint leans into a curve instead of snapping round; a hard
//                  reversal plants, slows through the skid, and pushes off the new way
//
// It only says how far to TRY to go this frame. The step still goes through PlayerBody.move (sub-stepped, every
// wall, desk, door, car and terrain edge as before); `blocked` hands back what the world allowed, so momentum
// into a wall or a car is simply lost there — never carried through it, never pushing into it next frame.
import type { Vec2 } from "../core/coords";

export const MOMENTUM = {
  /** speeding up at a walk, and on into a sprint (u/s²) */
  ACCEL_WALK: 520,
  ACCEL_SPRINT: 340,
  /** slowing down from a walk (a quick, controlled stop) and, past SKID_FROM, the sprint's skid */
  STOP: 900,
  BRAKE: 380,
  /** the speed above which letting go is a skid rather than a stop; the skid's grip tightens back to STOP between
   *  SKID_FROM and SKID_SOFT, so it eases out instead of ending in a jolt */
  SKID_FROM: 100,
  SKID_SOFT: 60,
  SKID_FULL: 140,
  /** how hard it can turn across its own travel (u/s²): sets a sprint's turning circle (~v²/GRIP) */
  GRIP: 1100,
  /** below this the body is at rest */
  REST: 1.5,
} as const;

export interface MomentumStep {
  /** how far to try to move this frame */
  dx: number; dz: number;
  speed: number;
  /** 0 … 1: how hard it is braking from a run right now (the skid / plant pose's weight) */
  brake: number;
  /** sideways acceleration as a lean: + = the body's LEFT (turning left), radians-ish, clamped */
  bank: number;
  /** the way it is actually travelling (unit), or null at rest */
  dir: Vec2 | null;
}

export class Momentum {
  vx = 0;
  vz = 0;
  private brakeW = 0;
  private bankW = 0;

  get speed(): number { return Math.hypot(this.vx, this.vz); }

  /** stop dead: an interaction took the body, a ride began, a seat, the lift */
  reset(): void { this.vx = 0; this.vz = 0; this.brakeW = 0; this.bankW = 0; }

  /**
   * One frame. `want` is the unit direction the player is pushing (or null), `top` the speed asked for
   * (walk or sprint), `sprinting` whether Shift is held (a sprint accelerates harder for longer).
   */
  step(want: Vec2 | null, top: number, sprinting: boolean, dt: number): MomentumStep {
    const v0 = this.speed;
    const tx = want ? want.x * top : 0, tz = want ? want.z * top : 0;
    let ux = 0, uz = 0;
    if (v0 > 1e-6) { ux = this.vx / v0; uz = this.vz / v0; } else if (want) { ux = want.x; uz = want.z; }
    // the change asked for, split along and across the way it is going
    const dvx = tx - this.vx, dvz = tz - this.vz;
    const along = dvx * ux + dvz * uz;
    const ax = dvx - along * ux, az = dvz - along * uz;
    const skidding = v0 > MOMENTUM.SKID_FROM;
    const alongRate = along >= 0 ? (sprinting ? MOMENTUM.ACCEL_SPRINT : MOMENTUM.ACCEL_WALK) : brakeRate(v0);
    const dA = Math.sign(along) * Math.min(Math.abs(along), alongRate * dt);
    const across = Math.hypot(ax, az);
    const dC = Math.min(across, MOMENTUM.GRIP * dt);
    const cx = across > 1e-9 ? (ax / across) * dC : 0, cz = across > 1e-9 ? (az / across) * dC : 0;
    this.vx += dA * ux + cx;
    this.vz += dA * uz + cz;
    // a walk that is not asked to move simply stops (no creeping at a crawl)
    if (!want && this.speed < MOMENTUM.REST) { this.vx = 0; this.vz = 0; }
    const v = this.speed;
    // the skid pose: braking from a run (letting go, or a hard push the other way), eased in and out
    const braking = skidding && along < -0.25 * v0 ? Math.min(1, (v0 - MOMENTUM.SKID_FROM * 0.6) / 80) : 0;
    this.brakeW += (braking - this.brakeW) * Math.min(1, dt / (braking > this.brakeW ? 0.08 : 0.16));
    if (v < MOMENTUM.SKID_FROM * 0.35 && !braking) this.brakeW = Math.max(0, this.brakeW - dt / 0.12);
    // leaning into a turn: the sideways acceleration toward the body's left — (uz, −ux) for travel (ux, uz)
    const lat = dt > 0 ? (cx * uz - cz * ux) / dt : 0;
    const bankTarget = Math.max(-0.16, Math.min(0.16, (lat / MOMENTUM.GRIP) * 0.16 * Math.min(1, v / 140)));
    this.bankW += (bankTarget - this.bankW) * Math.min(1, dt / 0.12);
    return {
      dx: this.vx * dt, dz: this.vz * dt, speed: v,
      brake: this.brakeW, bank: this.bankW,
      dir: v > 1e-6 ? { x: this.vx / v, z: this.vz / v } : null,
    };
  }

  /** what the world actually allowed this frame (PlayerBody.move): momentum into a wall or a car is lost there */
  blocked(actualDx: number, actualDz: number, dt: number): void {
    if (dt <= 0) return;
    const ax = actualDx / dt, az = actualDz / dt;
    // keep what it really did (sliding along the wall), never more than it had
    const s = Math.hypot(ax, az), v = this.speed;
    const k = s > v && s > 0 ? v / s : 1;
    this.vx = ax * k; this.vz = az * k;
  }
}

/** how hard a body travelling at `v` slows when it is not pushing on: a skid at speed, a step at a walk */
export function brakeRate(v: number): number {
  const k = Math.max(0, Math.min(1, (v - MOMENTUM.SKID_SOFT) / (MOMENTUM.SKID_FULL - MOMENTUM.SKID_SOFT)));
  return MOMENTUM.STOP + (MOMENTUM.BRAKE - MOMENTUM.STOP) * k;
}

/** the stop from a speed, integrated as the body does it: how far and how long (for tests and tuning) */
export function skidFrom(v: number): { distance: number; seconds: number } {
  const m = new Momentum();
  m.vx = v;
  let d = 0, t = 0;
  while (m.speed > 0 && t < 5) { const s = m.step(null, 0, false, 1 / 240); d += Math.hypot(s.dx, s.dz); t += 1 / 240; }
  return { distance: d, seconds: t };
}
