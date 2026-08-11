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
  } catch {
    // best-effort
  }
}

// True when a prior submitTimeLogs call for this employeeId+workDate already
// succeeded — callers should treat the checkout as complete and skip
// re-submitting rather than creating a duplicate Zoho log.
export function isAlreadyCheckedOut(employeeId: string, workDate: string): boolean {
  const result = loadResult(employeeId, workDate);
  return result?.success === true;
}
