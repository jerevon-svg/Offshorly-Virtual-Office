// vo3d env — LIGHTNING: when the sky lights up, how hard, and the THUNDER EVENT that falls out of it.
//
// WHAT THIS IS NOT. It is not a light. No THREE object is created here, nothing is added to the scene and
// this file does not import three at all. A strike is a NUMBER between 0 and 1 — `flash` — and the
// environment spends it on exposure, ambient, fill and the sky dome's own brightness, all of which are
// uniforms that were already being written. That is the whole reason a flash costs nothing: there is no
// shadow-casting light to create and destroy, no material to recompile, and no frame where the renderer
// has one more light than it had before.
//
// WHY THE ENVELOPE IS SHAPED LIKE THIS. Real lightning is a near-instant rise and a fast, non-linear
// fall, often with a second stroke down the same channel a beat later. Attack 35ms, exponential decay
// ~120ms, optional second pulse 90–170ms behind at roughly half strength. Anything slower reads as a UI
// fade; anything with a regular period reads as a strobe, which is the failure mode this must never have.
//
// THE AUDIO SEAM, STATED ONCE. Thunder is NOT played here and no audio API is touched — the spatial
// ambient-audio system is a later phase and must not find a competing implementation waiting for it.
// What this does is emit a `ThunderEvent` at the instant the sky lights, carrying everything a delayed
// clap needs: how far away the fiction put the strike, therefore how long after the flash the sound
// arrives, and how loud it should be. A consumer that wants thunder subscribes and schedules; a consumer
// that does not costs one null check.
import type { LightningParams } from "./weatherGrade";
import type { WeatherState } from "./weather";

/** WHAT A STRIKE TELLS THE REST OF THE APP. The audio phase's entire input. */
export type ThunderEvent = {
  /** seconds on the Lightning's own monotonic clock, at the moment the sky lit */
  at: number;
  /** 0…1, after distance falloff — how bright the flash was, and how loud the clap should be */
  strength: number;
  /** how far away the fiction puts it. Not physics: a number drawn so that near strikes are rarer than
   *  far ones, because a storm mostly happens somewhere else. */
  distanceKm: number;
  /** seconds between the flash and the clap — distanceKm / 0.343 km·s⁻¹, the real figure. A 3 km strike
   *  is heard 8.7 s later, which is exactly the delay that makes a storm feel like it has a size. */
  delaySeconds: number;
  /** true if a second stroke followed down the same channel — a rolling clap rather than a single crack */
  double: boolean;
  /** the weather state in force when it struck */
  state: WeatherState;
};

/** the speed of sound, km per second */
const SOUND_KM_PER_S = 0.343;
/** how many pulses can be in the air at once. A strike is one or two; four is headroom, and the ring
 *  exists so that advancing the envelope never allocates. */
const SLOTS = 4;
const ATTACK = 0.035;
/** LEFT ALONE AT 120 ms, DELIBERATELY. Stretching the decay was the obvious way to make a strike easier
 *  to see, and it is the wrong one: this file's own rule is that anything slower reads as a UI fade, and
 *  a 190 ms tail is still ringing two thirds of a second later. Visibility was fixed where the problem
 *  actually was — the DAY phase gain, which was attenuating the flash below the threshold at which a
 *  viewer notices it at all (env/weatherGrade LIGHTNING_PHASE_GAIN). */
const DECAY = 0.12;
/** below this a pulse contributes nothing visible and is retired */
const CUTOFF = 0.004;

/** THE OPENING STRIKE, and why it is not a second scheduler.
 *
 *  A thunderstorm's authored gap is 9…27 s (env/weatherGrade LIGHTNING). That is the right number for a
 *  storm you are living through and the wrong one for a storm you have just SELECTED: picking
 *  THUNDERSTORM and then standing in the rain for twenty-seven seconds does not read as a thunderstorm,
 *  it reads as rain. So the FIRST gap after the storm is (re)armed is drawn from this much shorter window
 *  instead, and every gap after it is the authored one again.
 *
 *  This is one line of clamping inside the existing countdown — there is no second timer, no second
 *  strike path and no change to what a strike IS. `strike()` is still the only thing that fires, and the
 *  storm settles into its own rhythm from the second strike onward. */
export const OPENING_GAP = { min: 2, max: 5 };

type Pulse = { age: number; amp: number; live: boolean };

export class Lightning {
  /** THE AUDIO SEAM. Set by whoever wants to hear about strikes; null costs one comparison per strike. */
  onStrike: ((e: ThunderEvent) => void) | null = null;
  /** master switch for the dev panel. Off = the scheduler stops and any live pulse decays out. */
  enabled = true;

  private params: LightningParams | null = null;
  private state: WeatherState = "clear";
  private readonly pulses: Pulse[] = Array.from({ length: SLOTS }, () => ({ age: 0, amp: 0, live: false }));
  /** queued second stroke: seconds until it fires, or null */
  private second: { in: number; amp: number } | null = null;
  private countdown = Number.POSITIVE_INFINITY;
  private _flash = 0;
  private _t = 0;
  private strikes = 0;
  private seed: number;

  /** @param seed deterministic by default so a test can assert a whole storm's timing */
  constructor(seed = 0x5eed1107) {
    this.seed = seed >>> 0;
  }

  /** A strike-free state simply stops the scheduler. Switching state mid-storm never cuts a live flash —
   *  a pulse already in the air decays out honestly rather than vanishing on a frame boundary. */
  setParams(p: LightningParams | null, state: WeatherState): void {
    this.state = state;
    if (p === this.params) return;
    this.params = p;
    // ARMING A STRIKING STATE OPENS WITH A SHORT GAP (see OPENING_GAP); everything afterwards is the
    // authored rhythm, because gap() is what strike() itself re-arms with.
    this.countdown = p ? OPENING_GAP.min + this.rand() * (OPENING_GAP.max - OPENING_GAP.min) : Number.POSITIVE_INFINITY;
  }

  /** 0 = no flash … 1 = full. What the environment spends. */
  get flash(): number {
    return this._flash;
  }
  /** seconds since construction — the clock ThunderEvent.at is on */
  get time(): number {
    return this._t;
  }
  /** how many strikes this instance has fired (dev readout) */
  get count(): number {
    return this.strikes;
  }
  /** seconds until the next scheduled strike; Infinity when the state does not strike (dev readout) */
  get nextIn(): number {
    return this.countdown;
  }
  get striking(): boolean {
    return this.params !== null;
  }

  /** Advance. Allocation-free: one object is built per STRIKE (the ThunderEvent), never per frame. */
  update(dt: number): void {
    if (!(dt > 0)) dt = 0;
    this._t += dt;

    if (this.second) {
      this.second.in -= dt;
      if (this.second.in <= 0) {
        this.fire(this.second.amp);
        this.second = null;
      }
    }
    if (this.enabled && this.params) {
      this.countdown -= dt;
      if (this.countdown <= 0) this.strike();
    }

    // advance every live pulse and sum. Two exponentials at worst; no allocation, no array churn.
    let sum = 0;
    for (const p of this.pulses) {
      if (!p.live) continue;
      p.age += dt;
      const v = envelope(p.age) * p.amp;
      if (v <= CUTOFF && p.age > ATTACK) { p.live = false; continue; }
      sum += v;
    }
    this._flash = sum > 1 ? 1 : sum;
  }

  /** Fire a strike NOW (the scheduler's own path, and the dev panel's "strike" button). */
  strike(): ThunderEvent | null {
    const p = this.params;
    if (!p) return null;
    this.countdown = this.gap(p);
    // DISTANCE. Squared so that far strikes are the common case and a close one is an event: most of a
    // storm is happening over there, and a flash that fills the frame every time is a light switch.
    const distanceKm = 0.8 + this.rand() ** 2 * 11;
    const falloff = Math.max(0.22, 1 - (distanceKm - 0.8) / 13);
    const amp = p.strength * falloff;
    const double = this.rand() < p.doubleChance;
    this.fire(amp);
    if (double) this.second = { in: 0.09 + this.rand() * 0.08, amp: amp * (0.42 + this.rand() * 0.26) };
    this.strikes++;
    const e: ThunderEvent = {
      at: this._t,
      strength: Math.min(1, amp),
      distanceKm,
      delaySeconds: distanceKm / SOUND_KM_PER_S,
      double,
      state: this.state,
    };
    this.onStrike?.(e);
    return e;
  }

  private fire(amp: number): void {
    // take the deadest slot — a live pulse is never stolen, so a double never eats its own first stroke
    let slot = this.pulses.find((p) => !p.live);
    if (!slot) slot = this.pulses.reduce((a, b) => (a.age >= b.age ? a : b));
    slot.age = 0;
    slot.amp = amp;
    slot.live = true;
  }
  private gap(p: LightningParams): number {
    return p.minGap + this.rand() * Math.max(0, p.maxGap - p.minGap);
  }
  /** LCG. Deterministic on purpose: a storm has to be reproducible in a test, and nothing here needs
   *  cryptographic randomness — it needs to not be a metronome. */
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
}

/** 0…1 over a pulse's life: a 35 ms rise and an exponential fall. Exported for the test. */
export function envelope(age: number): number {
  if (age < 0) return 0;
  if (age < ATTACK) return age / ATTACK;
  return Math.exp(-(age - ATTACK) / DECAY);
}
