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

export function clearAll(employeeId: string, workDate: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(draftKey(employeeId, workDate));
    window.localStorage.removeItem(resultKey(employeeId, workDate));
    window.localStorage.removeItem(sessionKey(employeeId, workDate));
  } catch {
    // best-effort
  }
}

// True when a successful submitTimeLogs result for this employeeId+workDate
// belongs to the CURRENT work session — callers then treat the checkout as
// complete and skip re-submitting rather than creating a duplicate Zoho log.
//
// Session-aware: a result older than the new-session marker is history from
// an earlier session today and must not lock the employee out of a new
// session (Check In → Check Out → Check In again). A result whose timestamp
// cannot be proven newer than the marker is treated as history.
export function isAlreadyCheckedOut(employeeId: string, workDate: string): boolean {
  const result = loadResult(employeeId, workDate);
  if (result?.success !== true) return false;
  const session = loadSessionStart(employeeId, workDate);
  if (!session) return true;
  const started = Date.parse(session.startedAt);
  if (!Number.isFinite(started)) return true;
  const submitted = result.submittedAt ? Date.parse(result.submittedAt) : NaN;
  return Number.isFinite(submitted) && submitted > started;
}
