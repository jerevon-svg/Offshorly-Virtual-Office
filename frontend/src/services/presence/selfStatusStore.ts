import { useSyncExternalStore } from "react";
import {
  MANUAL_STATUSES,
  resolveCurrentStatus,
  type AutoConditions,
  type OfficeStatus,
} from "./status";

// Module-level store for the LOCAL viewer's own status — mirrors
// auth/currentUserStore.ts's useSyncExternalStore pattern rather than
// inventing a new state approach. Sync scope is v1/client-side-only for
// self (see the confirmed plan): manualStatus is persisted to localStorage
// so it survives reload; autoConditions are session-only (recomputed on
// every mount by useAutoStatusDetection.ts).

const STORAGE_KEY = "office.selfManualStatus";
const SINCE_STORAGE_KEY = "office.selfManualStatusSince";
const DEFAULT_MANUAL_STATUS: OfficeStatus = "AVAILABLE";

function loadPersistedManualStatus(): OfficeStatus {
  if (typeof window === "undefined") return DEFAULT_MANUAL_STATUS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (MANUAL_STATUSES as string[]).includes(raw)) {
      return raw as OfficeStatus;
    }
  } catch {
    // localStorage can throw (private mode / quota) — fall back silently.
  }
  return DEFAULT_MANUAL_STATUS;
}

function persistManualStatus(status: OfficeStatus): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, status);
  } catch {
    // Best-effort only.
  }
}

function persistManualStatusSince(since: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SINCE_STORAGE_KEY, String(since));
  } catch {
    // Best-effort only.
  }
}

// Loads the persisted manualStatusSince timestamp. If a manualStatus was
// already persisted (pre-feature data) but no "since" was ever recorded,
// this migration case falls back to "now" (stamped + persisted below) so an
// existing user isn't falsely flagged as instantly overtime on the first
// load after this feature ships.
function loadPersistedManualStatusSince(hasPersistedManualStatus: boolean): number {
  if (typeof window === "undefined") return Date.now();
  try {
    const raw = window.localStorage.getItem(SINCE_STORAGE_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch {
    // localStorage can throw (private mode / quota) — fall back silently.
  }
  const fallback = Date.now();
  if (hasPersistedManualStatus) {
    persistManualStatusSince(fallback);
  }
  return fallback;
}

function hasPersistedManualStatusRaw(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

let manualStatus: OfficeStatus = loadPersistedManualStatus();
let manualStatusSince: number = loadPersistedManualStatusSince(hasPersistedManualStatusRaw());
let autoConditions: AutoConditions = {
  away: false,
  inConversation: false,
  inCall: false,
  offline: false,
};

const listeners = new Set<() => void>();
function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

interface SelfStatusSnapshot {
  manualStatus: OfficeStatus;
  manualStatusSince: number;
  autoConditions: AutoConditions;
  currentStatus: OfficeStatus;
}

let cachedSnapshot: SelfStatusSnapshot = {
  manualStatus,
  manualStatusSince,
  autoConditions,
  currentStatus: resolveCurrentStatus(manualStatus, autoConditions),
};

function rebuildSnapshot(): void {
  cachedSnapshot = {
    manualStatus,
    manualStatusSince,
    autoConditions,
    currentStatus: resolveCurrentStatus(manualStatus, autoConditions),
  };
}

function getSnapshot(): SelfStatusSnapshot {
  return cachedSnapshot;
}

// Restricted to MANUAL_STATUSES — DND/Busy/etc are user-settable, but the
// three auto statuses (Away/In Conversation/In Call) and Offline are never
// reachable through the manual picker.
export function setManualStatus(status: OfficeStatus): void {
  if (!MANUAL_STATUSES.includes(status)) return;
  if (manualStatus === status) return;
  manualStatus = status;
  manualStatusSince = Date.now();
  persistManualStatus(status);
  persistManualStatusSince(manualStatusSince);
  rebuildSnapshot();
  notify();
}

export function setAutoCondition(key: keyof AutoConditions, value: boolean): void {
  if (autoConditions[key] === value) return;
  autoConditions = { ...autoConditions, [key]: value };
  rebuildSnapshot();
  notify();
}

export function getSelfStatusSnapshot(): SelfStatusSnapshot {
  return getSnapshot();
}

export function useSelfStatus(): SelfStatusSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: module state outlives a single test.
export function resetSelfStatusForTests(): void {
  manualStatus = DEFAULT_MANUAL_STATUS;
  manualStatusSince = Date.now();
  autoConditions = { away: false, inConversation: false, inCall: false, offline: false };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(SINCE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  rebuildSnapshot();
  notify();
}
