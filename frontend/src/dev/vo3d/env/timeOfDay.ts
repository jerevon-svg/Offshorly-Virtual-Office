// vo3d env — TIME OF DAY ADAPTER.
//
// V1 REMAINS THE SOURCE OF TRUTH. src/data/officePhase.ts owns the real clock (Asia/Manila wall time),
// the four-phase classification and the boundaries (6 morning, 10 day, 17 sunset, 19 night). Nothing here
// re-derives, re-times or re-classifies any of that: this module CONSUMES phaseForHour/manilaHourDecimal
// and nothing else. V1's own hook (useOfficePhase) and its dev slider are untouched and unaware of V2.
//
// The only translation is presentational: V1 presents FOUR phases, the 3D environment presents THREE.
// `morning` and `day` share one daylight presentation — V2 has no separate dawn treatment, and inventing
// one here would be a second set of timing rules by the back door.
import { manilaHourDecimal, phaseForHour, type Phase } from "../../../data/officePhase";

export type EnvPhase = "day" | "sunset" | "night";
/** dev-only override. AUTO = the real V1 clock; the three explicit values are visual testing only. */
export type EnvTimeMode = "auto" | EnvPhase;
export const ENV_TIME_MODES: EnvTimeMode[] = ["auto", "day", "sunset", "night"];

/** V1 phase → environment phase. The ONLY mapping rule in V2. */
export function envPhaseFor(phase: Phase): EnvPhase {
  return phase === "morning" ? "day" : phase;
}
/** Convenience for a decimal hour — still routed through V1's phaseForHour, never re-implemented. */
export function envPhaseForHour(hourDecimal: number): EnvPhase {
  return envPhaseFor(phaseForHour(hourDecimal));
}

/** The environment's read side of the V1 clock, plus the dev override.
 *
 *  Deliberately pull-based and allocation-free: the render loop asks for the phase every frame and this
 *  re-reads the clock at most once per `intervalMs` (Intl formatting is not free). Setting `mode` to
 *  anything but "auto" changes ONLY what this returns — the V1 clock keeps running underneath and is
 *  never written to, so switching back to AUTO lands on real time immediately. */
export class TimeOfDay {
  mode: EnvTimeMode = "auto";
  private readonly clock: () => number;
  private readonly intervalMs: number;
  /** null = the constructor's read is still current but has no timestamp yet */
  private lastPoll: number | null = null;
  private real: EnvPhase;

  constructor(clock: () => number = manilaHourDecimal, intervalMs = 30_000) {
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.real = envPhaseForHour(clock());
  }
  /** The phase in force at `nowMs` (a performance.now()-style monotonic ms stamp). */
  phase(nowMs = 0): EnvPhase {
    if (this.lastPoll === null) this.lastPoll = nowMs; // stamp the constructor's read; don't repeat it
    else if (nowMs - this.lastPoll >= this.intervalMs) {
      this.lastPoll = nowMs;
      this.real = envPhaseForHour(this.clock());
    }
    return this.mode === "auto" ? this.real : this.mode;
  }
  /** what the REAL V1 clock says right now, regardless of the override — for the dev readout */
  get realPhase(): EnvPhase {
    return this.real;
  }
  get hourDecimal(): number {
    return this.clock();
  }
  get overridden(): boolean {
    return this.mode !== "auto";
  }
}
