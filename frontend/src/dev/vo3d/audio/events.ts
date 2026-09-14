// vo3d audio — WHEN A SOUND IS ALLOWED TO FIRE. Pure logic, no Web Audio, no THREE.
//
// Everything in this file exists to answer one question: "is this a NEW thing happening, or the same
// thing still happening?" A door that is open is open on every one of the sixty frames a second it is
// open; a scanner reads 0.87 for as long as somebody stands in front of it. Playing a sound off a STATE
// rather than off a TRANSITION is how a foley layer turns into a stuck buzzer, so no caller is trusted to
// remember what it last saw — they ask here.
import type { EnvPhase } from "../env/timeOfDay";
import type { WeatherState } from "../env/weather";

/** EDGE DETECTION, keyed. One Map, one string compare per query, no allocation after the first sighting
 *  of each key. `changed` is true exactly once per real transition, whatever the frame rate. */
export class EdgeTracker {
  private readonly seen = new Map<string, string>();

  /** true when `value` differs from what this key last reported. The FIRST sighting of a key does not
   *  fire: a door that is already closed at startup has not just closed. */
  changed(key: string, value: string): boolean {
    const had = this.seen.has(key);
    const prev = this.seen.get(key);
    this.seen.set(key, value);
    return had && prev !== value;
  }
  /** what this key last reported, or null */
  last(key: string): string | null {
    return this.seen.get(key) ?? null;
  }
  /** SCHMITT TRIGGER for a continuous signal (a scanner's 0…1 activation). Rising through `on` fires;
   *  it cannot fire again until the signal has fallen back below `off`. A value hovering on a single
   *  threshold is the classic way to make a detection chirp stutter. */
  crossed(key: string, value: number, on = 0.55, off = 0.25): boolean {
    const high = this.seen.get(key) === "1";
    if (!high && value >= on) { this.seen.set(key, "1"); return true; }
    if (high && value <= off) this.seen.set(key, "0");
    return false;
  }
  reset(): void {
    this.seen.clear();
  }
}

/** how far a body travels between footfalls, in world units. Derived from the walk clip: the walk cycle
 *  is 1.067 s at its authored 30 u/s, which is two steps every 32 units — so 16 units per footfall, and
 *  the cadence then follows the ACTUAL speed for free (70 u/s is 4.4 steps a second, 100 u/s is 6.3). */
export const STRIDE = 16;
/** A SPRINT'S STRIDE IS LONGER, BUT NOT PROPORTIONALLY. That distinction is the whole point: if stride
 *  grew with speed the cadence would be identical at 70 and at 100, and a sprint would sound exactly like
 *  a walk. 18 against 16 means a 43% faster body takes 27% more steps a second — which is what running
 *  is, and why it is audibly running. */
export const SPRINT_STRIDE = 18;

/** FOOTFALL CADENCE, from distance actually travelled. Not a timer: a player scraping along a wall covers
 *  no ground and takes no steps, which is the same rule the walk clip's playback rate already follows. */
export class Footsteps {
  private acc = 0;
  private parity = false;

  /** @param travelled world units covered this frame @returns true when a foot lands */
  advance(travelled: number, sprinting: boolean): boolean {
    if (!(travelled > 1e-4)) { this.acc = 0; return false; } // stopped: the next step starts from scratch
    this.acc += travelled;
    const stride = sprinting ? SPRINT_STRIDE : STRIDE;
    if (this.acc < stride) return false;
    // ONE step per frame at most. A 250 ms stalled frame at sprint covers 25 units — never enough for two
    // — but clamping here is what guarantees a pathological dt can never machine-gun the pool.
    this.acc -= stride;
    if (this.acc > stride) this.acc = 0;
    this.parity = !this.parity;
    return true;
  }
  /** left/right, so consecutive steps can be pitched apart instead of sounding like one foot twice */
  get left(): boolean {
    return this.parity;
  }
  reset(): void {
    this.acc = 0;
  }
}

/** HOW OFTEN THE TOUCAN IS ALLOWED TO CALL, in seconds, before weather and time thin it further. */
export const CALL_COOLDOWN = { min: 9, max: 26 };
/** call activity by phase — night is silent, not merely rarer */
export const CALL_PHASE: Record<EnvPhase, number> = { day: 1, sunset: 0.45, night: 0 };
/** call activity by weather — a storm silences it outright */
export const CALL_WEATHER: Record<WeatherState, number> = {
  clear: 1, cloudy: 0.8, rain: 0.35, heavy_rain: 0.15, thunderstorm: 0,
};

/** 0…1 — how willing the toucan is to call right now. Zero means it does not call at all. */
export function callActivity(phase: EnvPhase, weather: WeatherState): number {
  return CALL_PHASE[phase] * CALL_WEATHER[weather];
}

/** WHETHER THE TOUCAN IS FLYING AT ALL, and how briskly.
 *
 *  TWO THINGS GROUND IT OUTRIGHT, and both are the honest behaviour AND the cheap one — a hidden bird is
 *  not sampled, not oriented and not drawn:
 *    · a SEVERE STORM. It is not made calmer, it is put away.
 *    · NIGHT. Toucans are diurnal; one doing laps of a dark campus reads as a bug, not as atmosphere.
 *      Sunset is the transition and keeps it flying, more slowly.
 *  Rain in between is a speed, not a decision. */
export function flightActivity(weather: WeatherState, phase: EnvPhase = "day"): number {
  if (phase === "night") return 0;
  if (weather === "thunderstorm") return 0;
  const wx = weather === "heavy_rain" ? 0.45 : weather === "rain" ? 0.7 : 1;
  return phase === "sunset" ? wx * 0.75 : wx;
}
