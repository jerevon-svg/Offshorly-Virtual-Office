import { useSyncExternalStore } from "react";
import {
  MANUAL_STATUSES,
  resolveCurrentStatus,
  type AutoConditions,
  type OfficeStatus,
} from "./status";
import { DND_POLICY } from "./dndPolicy";

// Module-level store for the LOCAL viewer's own status — mirrors
// auth/currentUserStore.ts's useSyncExternalStore pattern rather than
// inventing a new state approach. Sync scope is v1/client-side-only for
// self (see the confirmed plan): manualStatus is persisted to localStorage
// so it survives reload; autoConditions are session-only (recomputed on
// every mount by useAutoStatusDetection.ts).
//
// DND V1 additions (all still client-side-only, matching the rest of this store): a DND session
// carries an expiry timestamp (dndExpiresAt), an optional lightweight reason (dndReason), and
// remembers the manual status to restore to once it ends (dndPreviousStatus). The realtime
// broadcast to OTHER clients (dnd_set) is NOT this module's concern — OfficeMap.tsx's
// prevSelfOfficeStatusRef effect already reacts to any currentStatus transition into/out of
// "DND" and emits it, so startDnd/endDnd here only need to change LOCAL state; the existing
// effect picks up the rest. Daily-allowance consumption is tracked and enforced entirely
// client-side in V1 (see dndPolicy.ts's module docstring) — a determined user could bypass this
// by clearing localStorage; acceptable for V1 per the "no large admin/analytics system" scope
// constraint, and flagged as a known limitation in the feature's rollout notes.

const STORAGE_KEY = "office.selfManualStatus";
const SINCE_STORAGE_KEY = "office.selfManualStatusSince";
const DND_EXPIRES_AT_KEY = "office.dndExpiresAt";
const DND_REASON_KEY = "office.dndReason";
const DND_PREVIOUS_STATUS_KEY = "office.dndPreviousStatus";
const DND_USED_TODAY_MS_KEY = "office.dndUsedTodayMs";
const DND_USAGE_DAY_KEY = "office.dndUsageDay";
const DEFAULT_MANUAL_STATUS: OfficeStatus = "AVAILABLE";

function safeGetItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort only (private mode / quota).
  }
}

function safeRemoveItem(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadPersistedManualStatus(): OfficeStatus {
  const raw = safeGetItem(STORAGE_KEY);
  if (raw && (MANUAL_STATUSES as string[]).includes(raw)) {
    return raw as OfficeStatus;
  }
  return DEFAULT_MANUAL_STATUS;
}

function persistManualStatus(status: OfficeStatus): void {
  safeSetItem(STORAGE_KEY, status);
}

function persistManualStatusSince(since: number): void {
  safeSetItem(SINCE_STORAGE_KEY, String(since));
}

// Loads the persisted manualStatusSince timestamp. If a manualStatus was
// already persisted (pre-feature data) but no "since" was ever recorded,
// this migration case falls back to "now" (stamped + persisted below) so an
// existing user isn't falsely flagged as instantly overtime on the first
// load after this feature ships.
function loadPersistedManualStatusSince(hasPersistedManualStatus: boolean): number {
  const raw = safeGetItem(SINCE_STORAGE_KEY);
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  const fallback = Date.now();
  if (hasPersistedManualStatus) {
    persistManualStatusSince(fallback);
  }
  return fallback;
}

function hasPersistedManualStatusRaw(): boolean {
  return safeGetItem(STORAGE_KEY) !== null;
}

function loadPersistedDndExpiresAt(): number | null {
  const raw = safeGetItem(DND_EXPIRES_AT_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadPersistedDndPreviousStatus(): OfficeStatus | null {
  const raw = safeGetItem(DND_PREVIOUS_STATUS_KEY);
  return raw && (MANUAL_STATUSES as string[]).includes(raw) ? (raw as OfficeStatus) : null;
}

function loadPersistedDndUsedTodayMs(): number {
  const day = safeGetItem(DND_USAGE_DAY_KEY);
  if (day !== todayKey()) return 0; // stale day — treat as a fresh allowance, reconciled below
  const raw = safeGetItem(DND_USED_TODAY_MS_KEY);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

let manualStatus: OfficeStatus = loadPersistedManualStatus();
let manualStatusSince: number = loadPersistedManualStatusSince(hasPersistedManualStatusRaw());
let dndExpiresAt: number | null = loadPersistedDndExpiresAt();
let dndReason: string | null = safeGetItem(DND_REASON_KEY);
let dndPreviousStatus: OfficeStatus | null = loadPersistedDndPreviousStatus();
let dndUsedTodayMs: number = loadPersistedDndUsedTodayMs();
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

// Ensures dndUsedTodayMs reflects "today" (local date) — resets to 0 on a day rollover. Called
// at the start of every allowance-affecting operation (startDnd/endDnd/getDndAllowanceSnapshot)
// rather than on a timer, since it's cheap and idempotent.
function ensureUsageDayFresh(): void {
  const today = todayKey();
  if (safeGetItem(DND_USAGE_DAY_KEY) === today) return;
  dndUsedTodayMs = 0;
  safeSetItem(DND_USAGE_DAY_KEY, today);
  safeSetItem(DND_USED_TODAY_MS_KEY, "0");
}

// Migration/safety net: a DND session persisted from a previous browser session that has
// already run past its expiry (or predates this feature, so has no expiry at all — pre-feature
// data) must never resurrect on load. Restores the previous status immediately, before any
// snapshot is ever read — satisfies "expired DND must not resurrect after refresh/reconnect".
function reconcilePersistedDndOnLoad(): void {
  if (manualStatus !== "DND") return;
  const expired = dndExpiresAt === null || Date.now() >= dndExpiresAt;
  if (!expired) return;

  if (dndExpiresAt !== null) {
    ensureUsageDayFresh();
    const sessionDurationMs = Math.max(0, dndExpiresAt - manualStatusSince);
    dndUsedTodayMs = Math.min(DND_POLICY.dailyAllowanceMs, dndUsedTodayMs + sessionDurationMs);
    safeSetItem(DND_USED_TODAY_MS_KEY, String(dndUsedTodayMs));
  }

  manualStatus = dndPreviousStatus ?? DEFAULT_MANUAL_STATUS;
  manualStatusSince = Date.now();
  dndExpiresAt = null;
  dndReason = null;
  dndPreviousStatus = null;
  persistManualStatus(manualStatus);
  persistManualStatusSince(manualStatusSince);
  safeRemoveItem(DND_EXPIRES_AT_KEY);
  safeRemoveItem(DND_REASON_KEY);
  safeRemoveItem(DND_PREVIOUS_STATUS_KEY);
}
reconcilePersistedDndOnLoad();

export interface DndAllowanceSnapshot {
  usedMs: number;
  remainingMs: number;
  dailyAllowanceMs: number;
}

interface SelfStatusSnapshot {
  manualStatus: OfficeStatus;
  manualStatusSince: number;
  autoConditions: AutoConditions;
  currentStatus: OfficeStatus;
  /** Non-null only while manualStatus === "DND" — epoch ms this session auto-ends. */
  dndExpiresAt: number | null;
  dndReason: string | null;
}

let cachedSnapshot: SelfStatusSnapshot = buildSnapshot();

function buildSnapshot(): SelfStatusSnapshot {
  return {
    manualStatus,
    manualStatusSince,
    autoConditions,
    currentStatus: resolveCurrentStatus(manualStatus, autoConditions),
    dndExpiresAt,
    dndReason,
  };
}

function rebuildSnapshot(): void {
  cachedSnapshot = buildSnapshot();
}

function getSnapshot(): SelfStatusSnapshot {
  return cachedSnapshot;
}

// Restricted to MANUAL_STATUSES minus DND — DND must go through startDnd() so a duration is
// always captured; a direct setManualStatus("DND") call would otherwise re-enable the old
// indefinite-DND behavior this feature explicitly replaces. Available/Busy/Break/Lunch are
// untouched — unrestricted/unlimited, exactly as before.
export function setManualStatus(status: OfficeStatus): void {
  if (!MANUAL_STATUSES.includes(status)) return;
  if (status === "DND") return; // use startDnd() instead
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

/** Current daily DND usage/remaining allowance, reconciled for day rollover. */
export function getDndAllowanceSnapshot(): DndAllowanceSnapshot {
  ensureUsageDayFresh();
  return {
    usedMs: dndUsedTodayMs,
    remainingMs: Math.max(0, DND_POLICY.dailyAllowanceMs - dndUsedTodayMs),
    dailyAllowanceMs: DND_POLICY.dailyAllowanceMs,
  };
}

/** Starts a timed DND session. `durationMs` is clamped to both the per-session max
 * (DND_POLICY.maxSessionMs) and whatever's left of today's allowance — returns false (no-op) if
 * the allowance is already exhausted, so callers (the duration picker UI) can show the
 * exhausted-state message instead of silently granting nothing. Remembers the CURRENT
 * manualStatus as the status to restore to on endDnd(), UNLESS DND is already active (re-entry
 * keeps the original previous status rather than overwriting it with "DND" itself). */
export function startDnd(options: { durationMs: number; reason?: string | null }): boolean {
  ensureUsageDayFresh();
  const remainingAllowanceMs = Math.max(0, DND_POLICY.dailyAllowanceMs - dndUsedTodayMs);
  if (remainingAllowanceMs <= 0) return false;

  const durationMs = Math.min(options.durationMs, DND_POLICY.maxSessionMs, remainingAllowanceMs);
  if (durationMs <= 0) return false;

  if (manualStatus !== "DND") {
    dndPreviousStatus = manualStatus;
    safeSetItem(DND_PREVIOUS_STATUS_KEY, manualStatus);
  }

  const now = Date.now();
  manualStatus = "DND";
  manualStatusSince = now;
  dndExpiresAt = now + durationMs;
  dndReason = options.reason?.trim() || null;

  persistManualStatus(manualStatus);
  persistManualStatusSince(manualStatusSince);
  safeSetItem(DND_EXPIRES_AT_KEY, String(dndExpiresAt));
  if (dndReason) safeSetItem(DND_REASON_KEY, dndReason);
  else safeRemoveItem(DND_REASON_KEY);

  rebuildSnapshot();
  notify();
  return true;
}

/** Ends the current DND session (manual cancel OR auto-expiry — same path either way),
 * restoring the previous manual status and crediting elapsed time against today's allowance.
 * No-op if not currently DND. */
export function endDnd(): void {
  if (manualStatus !== "DND") return;

  ensureUsageDayFresh();
  const now = Date.now();
  const sessionDurationMs = dndExpiresAt !== null ? dndExpiresAt - manualStatusSince : now - manualStatusSince;
  const elapsedMs = now - manualStatusSince;
  const consumedMs = Math.max(0, Math.min(elapsedMs, sessionDurationMs > 0 ? sessionDurationMs : elapsedMs));
  dndUsedTodayMs = Math.min(DND_POLICY.dailyAllowanceMs, dndUsedTodayMs + consumedMs);
  safeSetItem(DND_USED_TODAY_MS_KEY, String(dndUsedTodayMs));

  manualStatus = dndPreviousStatus ?? DEFAULT_MANUAL_STATUS;
  manualStatusSince = now;
  dndExpiresAt = null;
  dndReason = null;
  dndPreviousStatus = null;

  persistManualStatus(manualStatus);
  persistManualStatusSince(manualStatusSince);
  safeRemoveItem(DND_EXPIRES_AT_KEY);
  safeRemoveItem(DND_REASON_KEY);
  safeRemoveItem(DND_PREVIOUS_STATUS_KEY);

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
  dndExpiresAt = null;
  dndReason = null;
  dndPreviousStatus = null;
  dndUsedTodayMs = 0;
  autoConditions = { away: false, inConversation: false, inCall: false, offline: false };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(SINCE_STORAGE_KEY);
      window.localStorage.removeItem(DND_EXPIRES_AT_KEY);
      window.localStorage.removeItem(DND_REASON_KEY);
      window.localStorage.removeItem(DND_PREVIOUS_STATUS_KEY);
      window.localStorage.removeItem(DND_USED_TODAY_MS_KEY);
      window.localStorage.removeItem(DND_USAGE_DAY_KEY);
    } catch {
      // ignore
    }
  }
  rebuildSnapshot();
  notify();
}
