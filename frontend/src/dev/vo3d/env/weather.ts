// vo3d env — THE WEATHER MODEL. Provider-independent, and deliberately NOT coupled to rendering.
//
// WHY THIS IS A SEPARATE AXIS FROM TIME OF DAY. V1 owns the clock (src/data/officePhase) and env/timeOfDay
// presents it as day/sunset/night. Weather is orthogonal: it is not a time, it cannot be derived from one,
// and it changes on its own schedule. So the two are kept apart all the way down — one clock adapter, one
// weather adapter — and composed only at the last moment, in env/weatherGrade. Nothing here reads a phase
// and nothing in timeOfDay reads a weather state.
//
// WHAT A PROVIDER MAY AND MAY NOT DO. A provider returns a `WeatherObservation` and nothing else. It never
// hands a renderer a provider payload, never leaks a provider's vocabulary (WMO codes, "Rain — light",
// icon ids) past this file, and never decides how anything looks. That is the whole point of the
// normalization step: swapping providers must be a one-file change with no visual consequence.
//
// NO PROVIDER IS WIRED IN THIS PHASE. See providers/manual.ts for the dev source the visual proof runs on,
// and stateForWmoCode() below for the normalization a real WMO-code provider (Open-Meteo, met.no) plugs
// into. No network call is made from this module, and no key is read by it.

/** THE APP'S OWN WEATHER VOCABULARY. Five states, chosen because they are the ones that change how the
 *  world is PRESENTED — not because any particular provider reports them. Everything a provider can say is
 *  funnelled into exactly one of these. */
export type WeatherState = "clear" | "cloudy" | "rain" | "heavy_rain" | "thunderstorm";
export const WEATHER_STATES: WeatherState[] = ["clear", "cloudy", "rain", "heavy_rain", "thunderstorm"];

/** dev-only override, exactly the shape env/timeOfDay's EnvTimeMode takes. AUTO = whatever the configured
 *  provider says (CLEAR when none is configured); the five explicit values are visual testing only. */
export type WeatherMode = "auto" | WeatherState;
export const WEATHER_MODES: WeatherMode[] = ["auto", ...WEATHER_STATES];

/** THE NORMALIZED OBSERVATION. The only thing that crosses the provider boundary. */
export type WeatherObservation = {
  state: WeatherState;
  /** 0…1 within the state — how hard it is coming down. Providers that cannot say report 1. */
  intensity: number;
  /** provider's own words, for the dev readout ONLY. Never parsed, never switched on. */
  label: string;
  /** epoch ms the provider says the observation was taken */
  observedAt: number;
};

/** A SOURCE OF WEATHER. Implemented by the dev provider today; implemented by a real service the moment one
 *  is approved and configured. `read` may reject — the caller is required to keep its last good value. */
export interface WeatherProvider {
  readonly id: string;
  /** human-readable, for the dev readout */
  readonly label: string;
  read(signal?: AbortSignal): Promise<WeatherObservation>;
}

/** WMO PRESENT-WEATHER CODE → our vocabulary.
 *
 *  This is the normalization table, written now so the provider seam is proven rather than promised. WMO
 *  4677/4680 codes are what Open-Meteo and met.no both report, so a real provider becomes an adapter that
 *  fetches a number and calls this — no rendering code learns a provider's vocabulary.
 *
 *  States we do not model (snow, freezing rain, hail) normalize to the nearest thing we DO present rather
 *  than inventing a sixth state: the office is in Manila. */
export function stateForWmoCode(code: number): WeatherState {
  if (code >= 95) return "thunderstorm";           // 95 · 96 · 99 thunderstorm, with or without hail
  if (code === 65 || code === 67 || code === 82) return "heavy_rain"; // heavy rain · heavy freezing rain · violent showers
  if (code >= 80 && code <= 81) return "rain";     // rain showers, slight/moderate
  if (code >= 71 && code <= 86) return "cloudy";   // snow of every kind — not modelled; overcast is the honest read
  if (code >= 51 && code <= 67) return "rain";     // drizzle · freezing drizzle · rain
  if (code === 45 || code === 48) return "cloudy"; // fog / depositing rime fog
  if (code >= 2 && code <= 3) return "cloudy";     // partly cloudy · overcast
  return "clear";                                  // 0 clear · 1 mainly clear, and anything unrecognised
}

/** Rain rate (mm/h) → intensity within a rain state. Providers that report a rate can sharpen the read;
 *  ones that cannot simply omit it. Saturates at 8 mm/h, which is already a downpour. */
export function intensityForRate(mmPerHour: number): number {
  if (!Number.isFinite(mmPerHour) || mmPerHour <= 0) return 0;
  return Math.min(1, mmPerHour / 8);
}

/** THE ENVIRONMENT'S READ SIDE OF THE WEATHER, plus the dev override.
 *
 *  Shaped exactly like env/timeOfDay's TimeOfDay and for the same reasons: pull-based, allocation-free on
 *  the hot path, and throttled — the render loop asks every frame and this re-reads the provider at most
 *  once per `intervalMs`. The provider read is ASYNCHRONOUS and never blocks a frame: `state()` returns the
 *  last good observation while a new one is in flight, and a rejected read leaves the last good value
 *  standing rather than flickering the sky.
 *
 *  With no provider (today) AUTO resolves to `fallback` and nothing is ever fetched. */
export class Weather {
  mode: WeatherMode = "auto";
  private readonly provider: WeatherProvider | null;
  private readonly intervalMs: number;
  private readonly fallback: WeatherState;
  private observation: WeatherObservation | null = null;
  private lastPoll: number | null = null;
  private inFlight = false;
  private failures = 0;

  constructor(provider: WeatherProvider | null = null, intervalMs = 600_000, fallback: WeatherState = "clear") {
    this.provider = provider;
    this.intervalMs = intervalMs;
    this.fallback = fallback;
  }

  /** The state in force at `nowMs` (a performance.now()-style monotonic ms stamp). */
  state(nowMs = 0): WeatherState {
    if (this.provider) {
      if (this.lastPoll === null || nowMs - this.lastPoll >= this.intervalMs) {
        this.lastPoll = nowMs;
        this.poll();
      }
    }
    return this.mode === "auto" ? this.observed : this.mode;
  }
  /** what the PROVIDER says right now, regardless of the override — for the dev readout */
  get observed(): WeatherState {
    return this.observation?.state ?? this.fallback;
  }
  get observedAt(): number | null {
    return this.observation?.observedAt ?? null;
  }
  get intensity(): number {
    return this.observation?.intensity ?? 1;
  }
  get overridden(): boolean {
    return this.mode !== "auto";
  }
  get source(): string {
    if (!this.provider) return `none configured — AUTO falls back to ${this.fallback.toUpperCase()}`;
    return this.failures > 0 && !this.observation ? `${this.provider.label} (unreachable)` : this.provider.label;
  }
  /** Force a re-read on the next `state()` call (the dev panel's refresh button). */
  invalidate(): void {
    this.lastPoll = null;
  }

  private poll(): void {
    const p = this.provider;
    if (!p || this.inFlight) return;
    this.inFlight = true;
    p.read()
      .then((o) => { this.observation = o; this.failures = 0; })
      .catch(() => { this.failures++; }) // keep the last good observation; a bad fetch must not flicker the sky
      .finally(() => { this.inFlight = false; });
  }
}
