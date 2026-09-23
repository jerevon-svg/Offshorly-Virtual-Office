// EXPERIENCE PREFERENCES — the employee-facing settings the 3D world itself honours.
//
// It is the SAME idiom services/render/graphicsPreferences.ts already established, and deliberately so:
// a module-level singleton, a listener set, a localStorage mirror, and a sanitiser that throws away any
// value no UI could have produced. Nothing here is a React store, because the readers are not all React
// — PlayerCamera and app/world.ts are plain modules running outside it, and both have to see the same
// value the Settings panel wrote.
//
// WHY ONE MODULE AND ONE KEY rather than three. These are the settings a person sets once and forgets:
// how fast the mouse turns them, whether name pills are overhead, how loud the office is. They are
// written from one panel, read on one machine, and there is no reason for three storage keys and three
// subscription lists to exist for six values. Graphics stays separate because it is genuinely a
// different thing — a mode plus adaptive rungs, read by the renderer every frame.
//
// EVERY VALUE HERE IS BACKED BY REAL BEHAVIOUR. There is no preference in this file that nothing reads:
//   defaultView          app/Vo3dHud applies it once, the first time the world is ready.
//   lookSensitivity      player/PlayerCamera multiplies its own LOOK_SENSITIVITY by it.
//   invertLook           player/PlayerCamera flips the pitch sign.
//   nameplates           app/Vo3dOverheads drops the status pill.
//   worldChatIndicators  app/Vo3dOverheads drops bubbles, typing dots and unread badges.
//   ambientAudio         app/world.ts enables / disables audio/EnvironmentalAudio.
//   ambientVolume        app/world.ts sets its master volume.

export type DefaultViewPreference = "office" | "explore" | "player";

export interface ExperiencePreferences {
  /** Which camera the office opens in. "office" is V1's own framing and stays the default. */
  defaultView: DefaultViewPreference;
  /** Multiplier on the player camera's base radians-per-pixel. 1 = the authored feel. */
  lookSensitivity: number;
  /** Invert the vertical axis of mouse look, the way flight-stick players expect it. */
  invertLook: boolean;
  /** Overhead name-and-status pills on coworkers. */
  nameplates: boolean;
  /** Overhead chat: speech bubbles, typing dots and the unread badge. */
  worldChatIndicators: boolean;
  /** The office's ambient sound bed and weather audio (music is its own, separate control). */
  ambientAudio: boolean;
  /** Master volume for that bed, 0..1. */
  ambientVolume: number;
}

export const SENSITIVITY_RANGE = { min: 0.4, max: 2.5 } as const;

export const DEFAULT_EXPERIENCE: ExperiencePreferences = Object.freeze({
  defaultView: "office",
  lookSensitivity: 1,
  invertLook: false,
  nameplates: true,
  worldChatIndicators: true,
  ambientAudio: true,
  ambientVolume: 0.5,
});

const STORAGE_KEY = "vo:experience:v1";
const VIEWS: readonly DefaultViewPreference[] = ["office", "explore", "player"];

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Drop anything that is not a value this app's own UI could have written. A hand-edited or stale
 *  payload can then never put the world somewhere no control could have taken it. */
function sanitize(value: unknown): ExperiencePreferences {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_EXPERIENCE };
  const raw = value as Record<string, unknown>;
  const bool = (key: keyof ExperiencePreferences): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : (DEFAULT_EXPERIENCE[key] as boolean);
  return {
    defaultView: VIEWS.includes(raw.defaultView as DefaultViewPreference)
      ? (raw.defaultView as DefaultViewPreference)
      : DEFAULT_EXPERIENCE.defaultView,
    lookSensitivity:
      typeof raw.lookSensitivity === "number" && Number.isFinite(raw.lookSensitivity)
        ? clamp(raw.lookSensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max)
        : DEFAULT_EXPERIENCE.lookSensitivity,
    invertLook: bool("invertLook"),
    nameplates: bool("nameplates"),
    worldChatIndicators: bool("worldChatIndicators"),
    ambientAudio: bool("ambientAudio"),
    ambientVolume:
      typeof raw.ambientVolume === "number" && Number.isFinite(raw.ambientVolume)
        ? clamp(raw.ambientVolume, 0, 1)
        : DEFAULT_EXPERIENCE.ambientVolume,
  };
}

function read(): ExperiencePreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return { ...DEFAULT_EXPERIENCE };
    return sanitize(JSON.parse(stored));
  } catch {
    // Storage unavailable (private browsing), or a payload from another build. The defaults are
    // correct either way — this is a preference, not state the session depends on.
    return { ...DEFAULT_EXPERIENCE };
  }
}

let state: ExperiencePreferences = read();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore — the in-memory value still drives this session, it just will not outlive it
  }
}

/** The snapshot. Identity is stable until something actually changes, which is what makes it safe to
 *  hand straight to useSyncExternalStore. */
export function getExperiencePreferences(): ExperiencePreferences {
  return state;
}

export function setExperiencePreference<K extends keyof ExperiencePreferences>(
  key: K,
  value: ExperiencePreferences[K],
): void {
  const next = sanitize({ ...state, [key]: value });
  if (next[key] === state[key]) return;
  state = next;
  persist();
  for (const cb of listeners) cb();
}

export function subscribeExperience(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only — back to the shipped defaults, without touching the listener set. */
export function __resetExperiencePreferencesForTests(): void {
  state = { ...DEFAULT_EXPERIENCE };
  for (const cb of listeners) cb();
}
