// GRAPHICS & DISPLAY — the persisted user preference.
//
// A module-level singleton with a listener set and a localStorage mirror, which is the EXISTING idiom
// this app already uses for a settings-panel preference (see audio/backgroundMusic.ts — same shape,
// same try/catch-around-storage discipline, same "in-memory state still works when storage does not").
// It is deliberately NOT a React context or a new store library: the V2 renderer is a plain module that
// runs outside React entirely, and both sides have to read the same value.
//
// It holds the MODE and the CUSTOM OVERRIDES only. It does not hold the resolved settings and it knows
// nothing about quality levels: resolving is graphicsQuality.resolveGraphics's job and the adaptive
// rung is the renderer's, which is what keeps a preference that survives a reload from also trying to
// persist a performance measurement that does not survive a change of machine.

import {
  CUSTOM_CONTROL_IDS,
  isValidCustomValue,
  type CustomControlId,
  type CustomGraphics,
  type GraphicsMode,
} from "./graphicsQuality";

const STORAGE_KEY = "vo:graphics:v1";

/** Smooth is the default for everybody. An employee who never opens Settings gets the mode that keeps
 *  their machine playable, not the one that looks best on the machine it was authored on. */
export const DEFAULT_MODE: GraphicsMode = "smooth";

const MODES: readonly GraphicsMode[] = ["smooth", "full", "custom"];

interface StoredPreference {
  mode: GraphicsMode;
  custom: CustomGraphics;
}

let state: StoredPreference = read();
const listeners = new Set<() => void>();

function read(): StoredPreference {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { mode: DEFAULT_MODE, custom: {} };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { mode: DEFAULT_MODE, custom: {} };
    const record = parsed as { mode?: unknown; custom?: unknown };
    const mode = MODES.includes(record.mode as GraphicsMode) ? (record.mode as GraphicsMode) : DEFAULT_MODE;
    return { mode, custom: sanitize(record.custom) };
  } catch {
    // Storage unavailable (private browsing), or a payload written by a different build. Either way
    // the defaults are correct and the session still works — this is a preference, not state.
    return { mode: DEFAULT_MODE, custom: {} };
  }
}

/** Drop anything that is not a control we expose, or not a value that control offers. A hand-edited or
 *  stale payload can then never put the renderer somewhere no UI could have taken it. */
function sanitize(value: unknown): CustomGraphics {
  if (typeof value !== "object" || value === null) return {};
  const source = value as Record<string, unknown>;
  const out: CustomGraphics = {};
  for (const id of CUSTOM_CONTROL_IDS) {
    const v = source[id];
    if (v !== undefined && isValidCustomValue(id, v)) Object.assign(out, { [id]: v });
  }
  return out;
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore — the in-memory value still drives this session, it just will not outlive it
  }
}

function notify(): void {
  for (const cb of listeners) cb();
}

export function getGraphicsMode(): GraphicsMode {
  return state.mode;
}

export function getCustomGraphics(): CustomGraphics {
  return state.custom;
}

/** The whole preference, as one immutable snapshot — what useSyncExternalStore reads. */
export function getGraphicsPreference(): Readonly<StoredPreference> {
  return state;
}

export function setGraphicsMode(mode: GraphicsMode): void {
  if (!MODES.includes(mode) || mode === state.mode) return;
  state = { ...state, mode };
  persist();
  notify();
}

/**
 * Set one Custom control — AND SWITCH THE MODE TO CUSTOM.
 *
 * That coupling is the product rule, not a convenience: touching an individual control while "Smooth"
 * is selected has to mean something, and the only honest meaning is that the user is no longer letting
 * the mode decide. Doing it here rather than in the panel means it holds however the control was
 * reached, including from a future surface that is not this panel.
 */
export function setCustomGraphicsControl(id: CustomControlId, value: unknown): void {
  if (!isValidCustomValue(id, value)) return;
  state = { mode: "custom", custom: { ...state.custom, [id]: value } };
  persist();
  notify();
}

/** Forget every override and go back to the Full baseline, staying in Custom. */
export function resetCustomGraphics(): void {
  state = { ...state, custom: {} };
  persist();
  notify();
}

export function subscribeGraphics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: drop the in-memory cache and re-read storage. Not used by the app. */
export function __resetGraphicsPreferenceForTests(): void {
  state = read();
  notify();
}
