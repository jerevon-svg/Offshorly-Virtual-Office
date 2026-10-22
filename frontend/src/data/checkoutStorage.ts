// localStorage persistence for the checkout flow. Keyed by
// employeeId + Manila calendar workDate so refreshes/resumes are per-day.
//
// Idempotency ownership: THIS module owns dedup for "already checked out
// today". MockZohoService itself has no memory of prior calls — the
// checkout hook must check isAlreadyCheckedOut() before calling
// zohoService.submitTimeLogs() again, and persist the first successful
// result here via saveResult() so later attempts short-circuit.

import type { SubmitTimeLogsResult } from "../services/zoho/types";
import type { TimeLogEntry } from "../services/zoho/types";

export interface CheckoutDraft {
  entries: TimeLogEntry[];
  breakMinutes?: number;
  savedAt: string;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function draftKey(employeeId: string, workDate: string): string {
  return `checkout:${employeeId}:${workDate}:draft`;
}

function resultKey(employeeId: string, workDate: string): string {
  return `checkout:${employeeId}:${workDate}:result`;
}

// V3a — the RECOVERY copy of entries whose submission could not be confirmed (an Atlas 409 or a
// failure), written when the employee explicitly checks out anyway. Its own key, so it can never
// overwrite an earlier CONFIRMED result, and a new session's draft reset (clearDraft) leaves it alone.
function recoveryKey(employeeId: string, workDate: string): string {
  return `checkout:${employeeId}:${workDate}:recovery`;
}

// New-session marker: written when a confirmed attendance Check In starts a
// NEW work session on a day that may already hold a completed checkout. It
// separates "I completed a checkout today" (history — the result stays) from
// "I am currently checked out" (attendance) — see isAlreadyCheckedOut().
function sessionKey(employeeId: string, workDate: string): string {
  return `checkout:${employeeId}:${workDate}:session`;
}

export interface CheckoutSession {
  startedAt: string;
}

export function saveSessionStart(employeeId: string, workDate: string, startedAt: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(sessionKey(employeeId, workDate), JSON.stringify({ startedAt }));
  } catch {
    // best-effort
  }
}

export function loadSessionStart(employeeId: string, workDate: string): CheckoutSession | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(sessionKey(employeeId, workDate));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutSession>;
    return typeof parsed.startedAt === "string" ? { startedAt: parsed.startedAt } : null;
  } catch {
    return null;
  }
}

/** Drops only the in-progress time-log draft (a new session must not inherit
 * entries that were already logged by the previous checkout). The result is
 * NOT touched — it is history. */
export function clearDraft(employeeId: string, workDate: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(draftKey(employeeId, workDate));
  } catch {
    // best-effort
  }
}

export function saveDraft(employeeId: string, workDate: string, draft: CheckoutDraft): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(draftKey(employeeId, workDate), JSON.stringify(draft));
  } catch {
    // Ignore storage failures (quota, privacy mode) — draft persistence is
    // best-effort, not required for the flow to function.
  }
}

export function loadDraft(employeeId: string, workDate: string): CheckoutDraft | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(draftKey(employeeId, workDate));
    if (!raw) return null;
    return JSON.parse(raw) as CheckoutDraft;
  } catch {
    return null;
  }
}

export function saveResult(
  employeeId: string,
  workDate: string,
  result: SubmitTimeLogsResult,
): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(resultKey(employeeId, workDate), JSON.stringify(result));
  } catch {
    // best-effort
  }
}

export function loadResult(employeeId: string, workDate: string): SubmitTimeLogsResult | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(resultKey(employeeId, workDate));
    if (!raw) return null;
    return JSON.parse(raw) as SubmitTimeLogsResult;
  } catch {
    return null;
  }
}

/** Entries the employee kept after an unconfirmed submission, plus when they checked out anyway.
 *  Content only — never a token, never a server response. */
export interface CheckoutRecovery {
  entries: TimeLogEntry[];
  breakMinutes?: number;
  savedAt: string;
  /** Set when the employee chose "Check out anyway — hours not confirmed". */
  checkedOutAt?: string;
  /** "conflict" = Atlas 409 (already has a submission for this date); "failed" = anything else. */
  reason: "conflict" | "failed";
}

export function saveRecovery(employeeId: string, workDate: string, recovery: CheckoutRecovery): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(recoveryKey(employeeId, workDate), JSON.stringify(recovery));
  } catch {
    // best-effort
  }
}

export function loadRecovery(employeeId: string, workDate: string): CheckoutRecovery | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(recoveryKey(employeeId, workDate));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutRecovery;
    return Array.isArray(parsed?.entries) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearAll(employeeId: string, workDate: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(draftKey(employeeId, workDate));
    window.localStorage.removeItem(resultKey(employeeId, workDate));
    window.localStorage.removeItem(sessionKey(employeeId, workDate));
    window.localStorage.removeItem(recoveryKey(employeeId, workDate));
  } catch {
    // best-effort
  }
}

// Session-aware: a stamp older than the new-session marker is history from an earlier session today
// and must not lock the employee out of a new session (Check In → Check Out → Check In again). A
// stamp that cannot be proven newer than the marker is treated as history.
function isCurrentSession(employeeId: string, workDate: string, stamp: string | undefined): boolean {
  const session = loadSessionStart(employeeId, workDate);
  if (!session) return true;
  const started = Date.parse(session.startedAt);
  if (!Number.isFinite(started)) return true;
  const at = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(at) && at > started;
}

/** How the CURRENT session's checkout ended, or null if it hasn't.
 *
 *  * A confirmed result (success: true) — the employee's hours were accepted.
 *  * V3a — an attendance-only checkout after an unconfirmed submission, returned as
 *    { success: false, hoursNotConfirmed: true }. Built from the recovery key, never written over
 *    the result key, so an earlier confirmed result stays exactly as it was.
 *  When both belong to this session the later one wins. */
export function loadCompletion(employeeId: string, workDate: string): SubmitTimeLogsResult | null {
  const result = loadResult(employeeId, workDate);
  const confirmed =
    result?.success === true && isCurrentSession(employeeId, workDate, result.submittedAt) ? result : null;
  const recovery = loadRecovery(employeeId, workDate);
  const unconfirmed: SubmitTimeLogsResult | null =
    recovery?.checkedOutAt && isCurrentSession(employeeId, workDate, recovery.checkedOutAt)
      ? { success: false, hoursNotConfirmed: true, submittedAt: recovery.checkedOutAt }
      : null;
  if (confirmed && unconfirmed) {
    const confirmedAt = confirmed.submittedAt ? Date.parse(confirmed.submittedAt) : NaN;
    return Number.isFinite(confirmedAt) && confirmedAt >= Date.parse(unconfirmed.submittedAt ?? "") ? confirmed : unconfirmed;
  }
  return confirmed ?? unconfirmed;
}

// True when the CURRENT work session's checkout is complete — either confirmed, or (V3a) an explicit
// attendance-only checkout. Callers then skip re-submitting rather than creating a duplicate Zoho log.
export function isAlreadyCheckedOut(employeeId: string, workDate: string): boolean {
  return loadCompletion(employeeId, workDate) !== null;
}
