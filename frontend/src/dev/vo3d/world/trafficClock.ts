// vo3d world — THE TRAFFIC'S SHARED CLOCK. world/traffic places every car as a pure function of time; this
// is the time, and it is the SERVER's, so every browser puts the same car at the same place.
//
// The offset (server − local, ms) is the movement feed's own (services/presence/movementSync, measured on
// every snapshot), handed in by the host. How a change in it is APPLIED is the whole of this file:
//
//   • while the exterior is NOT drawn (OFFICE, indoors with no window, the Cave), a new offset is taken at
//     once — nobody sees the cars move;
//   • while it IS drawn, the clock is SLEWED toward the new offset: it runs a little fast or slow (at most
//     SLEW seconds per second) until it agrees, so a car speeds up or eases off for a moment rather than
//     jumping. It never runs backwards (SLEW < 1), so nothing ever reverses;
//   • an offset so far out (FAR_S) that slewing would leave this browser's cars visibly wrong for minutes
//     is taken at once even while drawn — one correction instead of a long disagreement.
//
// Pure and deterministic: no timers, no Date — the caller passes its local clock.

/** how fast a drawn clock may drift toward a new offset, seconds per second */
export const SLEW = 0.25;
/** an offset change this large (seconds) is taken at once even while the cars are on screen */
export const FAR_S = 30;

export class TrafficClock {
  /** the offset we are heading for, ms (server − local); 0 until the first measurement */
  private target = 0;
  /** the offset in force, ms */
  private shown: number | null = null;
  private lastLocal: number | null = null;

  /** the newest server-minus-local measurement, ms; non-finite values are ignored */
  setOffset(ms: number): void {
    if (Number.isFinite(ms)) this.target = ms;
  }

  get offsetMs(): number { return this.shown ?? this.target; }
  get targetMs(): number { return this.target; }

  /** THE SHARED TIME, in SECONDS, for a frame at local time `localMs`. `drawn`: are the cars on screen? */
  now(localMs: number, drawn: boolean): number {
    const dt = this.lastLocal === null ? 0 : Math.max(0, localMs - this.lastLocal);
    this.lastLocal = localMs;
    const gap = this.target - (this.shown ?? this.target);
    if (this.shown === null || !drawn || Math.abs(gap) > FAR_S * 1000) this.shown = this.target;
    else {
      const step = SLEW * dt;
      this.shown += Math.max(-step, Math.min(step, gap));
    }
    return (localMs + this.shown) / 1000;
  }
}
