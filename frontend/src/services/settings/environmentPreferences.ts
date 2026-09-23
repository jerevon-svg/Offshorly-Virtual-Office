// ENVIRONMENT PREFERENCES — the employee's own time-of-day and weather choice for the 3D office.
//
// This is the SAME idiom services/settings/experiencePreferences.ts and services/render/
// graphicsPreferences.ts already established: a module-level singleton, a listener set, a localStorage
// mirror, and a sanitiser that throws away any value no UI could have produced. Not a React store,
// because the readers are not all React — dev/vo3d/app/world.ts is a plain module running outside it and
// has to see the same value the Settings panel wrote.
//
// WHY ITS OWN KEY rather than two more fields on experiencePreferences. These two are scoped PER
// EMPLOYEE, and that store is not: it is a machine-level "how the office feels to me" record with one
// key for the page. Environment is a personal choice that must not follow the next person who signs in
// on the same browser, so it is keyed by the authenticated identity the way components/OfficeMap/
// toucanReturnBriefing.ts already keys its per-viewer boundary. Nothing is written server-side: no
// table, no endpoint, no migration.
//
// TWO AXES, NEVER COUPLED. Time of day and weather are independent all the way down (see
// dev/vo3d/env/weather.ts for why), so AUTO on one and a fixed value on the other is a first-class
// state, not an edge case. Setting one never reads or writes the other.
//
// AUTO MEANS "LET THE WORLD DECIDE", and the world's decision is unchanged by any of this:
//   time     "auto" → V1's real Asia/Manila clock (src/data/officePhase), exactly as the 2D office.
//   weather  "auto" → whatever the configured provider reports (GET /weather/office, or the manual dev
//                     provider when no backend is configured).
// Neither AUTO path is touched here — this module only records WHICH of them is in force.
//
// THE COMPANY HUB FORECAST IS NOT A SOURCE HERE. services/weather/forecastClient.ts feeds an
// informational slide and nothing else; it never writes a preference and is never read by this file.
import { getCurrentUser, subscribeCurrentUser } from "../../auth/currentUserStore";

/** dev/vo3d/env/timeOfDay.ts's EnvTimeMode, restated so a service does not import from the 3D app.
 *  The two unions are assignable to each other, so TypeScript fails the build if they ever drift. */
export type EnvironmentTimePreference = "auto" | "day" | "sunset" | "night";
/** dev/vo3d/env/weather.ts's WeatherMode, restated for the same reason (and the same guarantee). */
export type EnvironmentWeatherPreference =
  | "auto" | "clear" | "cloudy" | "rain" | "heavy_rain" | "thunderstorm";

export const ENVIRONMENT_TIME_PREFERENCES: readonly EnvironmentTimePreference[] = [
  "auto", "day", "sunset", "night",
];
export const ENVIRONMENT_WEATHER_PREFERENCES: readonly EnvironmentWeatherPreference[] = [
  "auto", "clear", "cloudy", "rain", "heavy_rain", "thunderstorm",
];

export interface EnvironmentPreferences {
  time: EnvironmentTimePreference;
  weather: EnvironmentWeatherPreference;
}

export const DEFAULT_ENVIRONMENT: EnvironmentPreferences = Object.freeze({
  time: "auto",
  weather: "auto",
} as EnvironmentPreferences);

const STORAGE_PREFIX = "vo:environment:v1:";

/** The signed-in employee, normalised the way every other per-viewer key in this app normalises it.
 *  "anon" before the auth gate's /auth/me response lands, and in the standalone dev rig where there is
 *  no identity at all — a real key, so a preference set there is still remembered, just not as anyone. */
function viewerKey(): string {
  return (getCurrentUser()?.email ?? "").trim().toLowerCase() || "anon";
}

/** Drop anything that is not a value this app's own UI could have written — a hand-edited payload, or
 *  one from a build whose vocabulary has since changed. Either way the answer is AUTO, per axis, which
 *  is the same thing an employee who never opened the panel gets. */
function sanitize(value: unknown): EnvironmentPreferences {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_ENVIRONMENT };
  const raw = value as Record<string, unknown>;
  return {
    time: ENVIRONMENT_TIME_PREFERENCES.includes(raw.time as EnvironmentTimePreference)
      ? (raw.time as EnvironmentTimePreference)
      : DEFAULT_ENVIRONMENT.time,
    weather: ENVIRONMENT_WEATHER_PREFERENCES.includes(raw.weather as EnvironmentWeatherPreference)
      ? (raw.weather as EnvironmentWeatherPreference)
      : DEFAULT_ENVIRONMENT.weather,
  };
}

function read(viewer: string): EnvironmentPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + viewer);
    if (stored === null) return { ...DEFAULT_ENVIRONMENT };
    return sanitize(JSON.parse(stored));
  } catch {
    // Storage unavailable (private browsing), or unparseable. AUTO is correct either way — this is a
    // preference, not state the session depends on.
    return { ...DEFAULT_ENVIRONMENT };
  }
}

// The identity is not known at import time (useAuthGate fetches it at boot), so the viewer is resolved
// lazily and re-resolved when it changes rather than captured once.
let viewer = viewerKey();
let state: EnvironmentPreferences = read(viewer);
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** Re-point at whoever is signed in now. Called when /auth/me lands, and defensively on every read, so
 *  a world that mounted before the identity did still ends up on the right employee's preference. */
function syncViewer(): boolean {
  const next = viewerKey();
  if (next === viewer) return false;
  viewer = next;
  state = read(viewer);
  return true;
}

subscribeCurrentUser(() => {
  if (syncViewer()) notify();
});

/** The snapshot. Identity is stable until something actually changes — including the employee — which
 *  is what makes it safe to hand straight to useSyncExternalStore. */
export function getEnvironmentPreferences(): EnvironmentPreferences {
  syncViewer();
  return state;
}

export function setEnvironmentPreference<K extends keyof EnvironmentPreferences>(
  key: K,
  value: EnvironmentPreferences[K],
): void {
  syncViewer();
  const next = sanitize({ ...state, [key]: value });
  // ONE AXIS AT A TIME. Writing `time` cannot move `weather`, and vice versa: the spread carries the
  // other axis through untouched and the sanitiser only ever narrows a bad value to AUTO.
  if (next[key] === state[key]) return;
  state = next;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + viewer, JSON.stringify(state));
  } catch {
    // ignore — the in-memory value still drives this session, it just will not outlive it
  }
  notify();
}

export function subscribeEnvironmentPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only — back to the shipped defaults for whoever is signed in, without touching the listeners. */
export function __resetEnvironmentPreferencesForTests(): void {
  viewer = viewerKey();
  state = { ...DEFAULT_ENVIRONMENT };
  notify();
}
