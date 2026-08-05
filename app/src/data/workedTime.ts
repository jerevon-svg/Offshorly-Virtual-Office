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

export interface AllocationResult {
  totalLoggedMinutes: number;
  remainingMinutes: number;
  isFullyAllocated: boolean;
  errors: string[];
}

const APPROVED_CATEGORY_SET = new Set<string>(APPROVED_CATEGORIES);

// Validates a draft's entries against the worked-minutes budget for the day.
// Per spec, entries must fully allocate the worked time (no over/under).
export function validateAllocation(
  workedMinutes: number,
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

    if (!entry.workDescription || entry.workDescription.trim().length === 0) {
      errors.push(`${label}: enter a work description.`);
    }
  });

  const totalLoggedMinutes = entries.reduce(
    (sum, e) => sum + (Number.isFinite(e.timeSpentMinutes) ? e.timeSpentMinutes : 0),
    0,
  );
  const remainingMinutes = workedMinutes - totalLoggedMinutes;

  if (totalLoggedMinutes > workedMinutes) {
    errors.push(
      `Logged time (${formatDuration(totalLoggedMinutes)}) exceeds worked time (${formatDuration(workedMinutes)}).`,
    );
  } else if (entries.length > 0 && totalLoggedMinutes !== workedMinutes) {
    errors.push(
      `Logged time (${formatDuration(totalLoggedMinutes)}) must fully account for worked time (${formatDuration(workedMinutes)}).`,
    );
  }

  const isFullyAllocated =
    errors.length === 0 && entries.length > 0 && totalLoggedMinutes === workedMinutes;

  return { totalLoggedMinutes, remainingMinutes, isFullyAllocated, errors };
}
