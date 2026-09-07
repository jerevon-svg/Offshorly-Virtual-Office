import { useSyncExternalStore } from "react";

// Startup readiness — the ONLY state the boot loading cover keys off.
//
// A tiny module-level signal store, deliberately not a new architecture:
// App publishes `auth` (useAuthGate reached "allowed") and OfficeMap
// publishes the rest from state it ALREADY tracks for its own reasons
// (roster.loading, server attendance answered, TransformWrapper onInit,
// spawn-restore effect placed self). Nothing here fetches, delays, or
// changes any of those flows — it only observes them. Lazy features (Team
// Map, Whiteboards, Rewards, Toucan, …) are intentionally NOT signals: the
// office fades in as soon as the critical startup state is ready.
export type StartupSignal = "auth" | "roster" | "attendance" | "transform" | "selfPlaced";

export type StartupSignals = Record<StartupSignal, boolean>;

export interface StartupStage {
  signal: StartupSignal;
  /** Short label for the step row. */
  label: string;
  /** Sentence shown while this is the first unfinished step. */
  status: string;
}

// Ordered as the signals typically resolve on a real boot; progress is
// simply "how many are done", so an out-of-order arrival still counts.
export const STARTUP_STAGES: readonly StartupStage[] = [
  { signal: "auth", label: "Connecting", status: "Connecting to your workspace…" },
  { signal: "transform", label: "Office", status: "Loading the office environment…" },
  { signal: "roster", label: "Employees", status: "Loading employees…" },
  { signal: "attendance", label: "Attendance", status: "Restoring your attendance…" },
  { signal: "selfPlaced", label: "Position", status: "Restoring your position…" },
];

export interface StartupProgress {
  /** 0..1 fraction of signals that are ready. */
  fraction: number;
  /** Index into STARTUP_STAGES of the first unfinished stage (or length when ready). */
  activeIndex: number;
  /** Status sentence for the active stage; "Almost there…" when all are ready. */
  status: string;
  /** Every critical startup signal has resolved. */
  ready: boolean;
}

const INITIAL_SIGNALS: StartupSignals = {
  auth: false,
  roster: false,
  attendance: false,
  transform: false,
  selfPlaced: false,
};

let signals: StartupSignals = { ...INITIAL_SIGNALS };
const listeners = new Set<() => void>();

export function setStartupSignal(signal: StartupSignal, value: boolean): void {
  if (signals[signal] === value) return;
  signals = { ...signals, [signal]: value };
  listeners.forEach((listener) => listener());
}

export function getStartupSignals(): StartupSignals {
  return signals;
}

export function subscribeStartupSignals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function deriveStartupProgress(current: StartupSignals): StartupProgress {
  const done = STARTUP_STAGES.filter((stage) => current[stage.signal]).length;
  const activeIndex = STARTUP_STAGES.findIndex((stage) => !current[stage.signal]);
  const ready = activeIndex === -1;
  return {
    fraction: done / STARTUP_STAGES.length,
    activeIndex: ready ? STARTUP_STAGES.length : activeIndex,
    status: ready ? "Almost there…" : STARTUP_STAGES[activeIndex].status,
    ready,
  };
}

export function useStartupSignals(): StartupSignals {
  return useSyncExternalStore(subscribeStartupSignals, getStartupSignals, getStartupSignals);
}

// Test-only. Production never resets: the cover is a once-per-tab affair.
export function __resetStartupSignalsForTest(): void {
  signals = { ...INITIAL_SIGNALS };
  listeners.forEach((listener) => listener());
}
