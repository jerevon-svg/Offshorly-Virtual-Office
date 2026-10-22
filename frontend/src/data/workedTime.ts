// Pure helpers for computing/formatting worked time and validating the
// checkout time-log allocation. No React/DOM deps — trivially unit-testable.

import type { TimeLogEntry } from "../services/zoho/types";
import { APPROVED_CATEGORIES } from "../services/zoho/types";

// 462 -> "7h 42m". Negative/zero-safe (floors at 0 before formatting).
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

// Elapsed time since check-in minus breaks, floored at 0 (never negative).
export function computeWorkedMinutes(
  timeInMs: number,
  nowMs: number,
  breakMinutes: number,
): number {
  const elapsedMinutes = (nowMs - timeInMs) / 60_000;
  const worked = elapsedMinutes - breakMinutes;
  return Math.max(0, Math.floor(worked));
}

// Checked-in time and project time are two different things. `sessionMinutes` is how long the employee
// was checked in; `loggedMinutes` is the project work they report. Logging LESS than the session is
// valid — the rest is `unallocatedMinutes`, shown but never submitted, and never classified as a break,
// overtime, paid or unpaid time. Logging MORE than the session is blocked.
export interface AllocationResult {
  sessionMinutes: number;
  loggedMinutes: number;
  unallocatedMinutes: number;
  /** Logged project time exceeds the checked-in time — the one total-level error. */
  isOverAllocated: boolean;
  canSubmit: boolean;
  errors: string[];
}

const APPROVED_CATEGORY_SET = new Set<string>(APPROVED_CATEGORIES);
export const MAX_ENTRY_MINUTES = 1440;

// Validates a draft's entries against the checked-in time for the session. Under-allocation is valid
// (decision A); over-allocation and every per-entry problem are not (decision C). At least one valid
// entry is still required — a zero-hour checkout is out of scope (decision B).
export function validateAllocation(
  sessionMinutes: number,
  entries: TimeLogEntry[],
): AllocationResult {
  const errors: string[] = [];

  if (entries.length === 0) {
    errors.push("Add at least one time log entry.");
  }

  entries.forEach((entry, i) => {
    const label = `Entry ${i + 1}`;

    const hasProject = !!entry.projectId;
    const hasCategory = !!entry.category;

    if (!hasProject && !hasCategory) {
      errors.push(`${label}: select a project or a category.`);
    }

    if (hasProject && !hasCategory && !entry.taskId) {
      errors.push(`${label}: select a task, or choose an approved category instead.`);
    }

    if (hasCategory && !APPROVED_CATEGORY_SET.has(entry.category as string) && !hasProject) {
      errors.push(`${label}: "${entry.category}" is not an approved category.`);
    }

    if (!entry.timeSpentMinutes || entry.timeSpentMinutes <= 0) {
      errors.push(`${label}: enter time spent greater than 0.`);
    }
    if (entry.timeSpentMinutes > MAX_ENTRY_MINUTES) {
      errors.push(`${label}: max 24h per entry; add another entry for the rest`);
    }

    if (!entry.workDescription || entry.workDescription.trim().length === 0) {
      errors.push(`${label}: enter a work description.`);
    }
  });

  const loggedMinutes = entries.reduce(
    (sum, e) => sum + (Number.isFinite(e.timeSpentMinutes) ? e.timeSpentMinutes : 0),
    0,
  );
  const unallocatedMinutes = Math.max(0, sessionMinutes - loggedMinutes);

  // Only an OVER-allocation is an error. The session clock keeps ticking while the employee reviews, and
  // a growing session can only grow the unallocated figure — it can never invalidate a log that was valid.
  const isOverAllocated = loggedMinutes > sessionMinutes;
  if (isOverAllocated) {
    errors.push(
      `Logged time (${formatDuration(loggedMinutes)}) exceeds your checked-in time (${formatDuration(sessionMinutes)}). Reduce an entry to continue.`,
    );
  }

  const canSubmit = entries.length > 0 && errors.length === 0;

  return { sessionMinutes, loggedMinutes, unallocatedMinutes, isOverAllocated, canSubmit, errors };
}

/** What a successful checkout showed the employee, captured at the moment of submission. Local display
 *  only: it is stored beside the result in the browser and never sent anywhere. `sessionMinutes` is the
 *  browser's checked-in time at submit — the server's attendance checkout lands a moment later and is
 *  the authoritative record. */
export interface CheckoutSummary {
  sessionMinutes: number;
  loggedMinutes: number;
  unallocatedMinutes: number;
  entryCount: number;
}

export function summarizeCheckout(allocation: AllocationResult, entryCount: number): CheckoutSummary {
  return {
    sessionMinutes: allocation.sessionMinutes,
    loggedMinutes: allocation.loggedMinutes,
    unallocatedMinutes: allocation.unallocatedMinutes,
    entryCount,
  };
}

// --- HH:MM <-> minutes -------------------------------------------------
// The time-log UI collects durations as hours + minutes, but every stored
// and submitted value stays whole minutes (the Zoho contract). These two
// helpers are the only conversion boundary.

// 497 -> { hours: 8, minutes: 17 }. Negative/fractional-safe.
export function splitDuration(totalMinutes: number): { hours: number; minutes: number } {
  const total = Number.isFinite(totalMinutes) ? Math.max(0, Math.floor(totalMinutes)) : 0;
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

// { 8, 17 } -> 497. Hours floor at 0; minutes are clamped to 0–59 so an
// out-of-range field can never inflate the total past what it displays.
export function composeDuration(hours: number, minutes: number): number {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0;
  const m = Number.isFinite(minutes) ? Math.min(59, Math.max(0, Math.floor(minutes))) : 0;
  return h * 60 + m;
}


// Recovery requires both a previous Manila date and a full 24 hours.
export function needsSessionRecovery(timeInMs: number | null, nowMs = Date.now()): boolean {
  if (timeInMs === null || !Number.isFinite(timeInMs) || !Number.isFinite(nowMs)) return false;
  const manilaDay = (ms: number) => Math.floor((ms + 8 * 3600_000) / 86400_000);
  return nowMs - timeInMs >= 86400_000 && manilaDay(timeInMs) < manilaDay(nowMs);
}
