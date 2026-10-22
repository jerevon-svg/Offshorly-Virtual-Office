import { describe, expect, it } from "vitest";
import {
  composeDuration,
  computeWorkedMinutes,
  formatDuration,
  splitDuration,
  summarizeCheckout,
  validateAllocation,
} from "./workedTime";
import type { TimeLogEntry } from "../services/zoho/types";

describe("formatDuration", () => {
  it.each([
    [462, "7h 42m"],
    [0, "0h 0m"],
    [60, "1h 0m"],
    [59, "0h 59m"],
    [-30, "0h 0m"],
  ])("formatDuration(%d) === %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});

describe("computeWorkedMinutes", () => {
  const HOUR_MS = 60 * 60_000;

  it("computes elapsed minus breaks", () => {
    const timeIn = 0;
    const now = 8 * HOUR_MS; // 8h elapsed
    expect(computeWorkedMinutes(timeIn, now, 60)).toBe(8 * 60 - 60);
  });

  it("floors at 0 when breaks exceed elapsed time", () => {
    const timeIn = 0;
    const now = 30 * 60_000; // 30 minutes elapsed
    expect(computeWorkedMinutes(timeIn, now, 60)).toBe(0);
  });

  it("floors at 0 when now is before timeIn", () => {
    expect(computeWorkedMinutes(10_000, 0, 0)).toBe(0);
  });
});

function entry(overrides: Partial<TimeLogEntry> = {}): TimeLogEntry {
  return {
    projectId: null,
    taskId: null,
    category: null,
    timeSpentMinutes: 0,
    workDescription: "",
    ...overrides,
  };
}

describe("validateAllocation", () => {
  it("errors when there are no entries", () => {
    const result = validateAllocation(120, []);
    expect(result.errors).toContain("Add at least one time log entry.");
    expect(result.canSubmit).toBe(false);
  });

  it("errors when entry has neither project nor category", () => {
    const result = validateAllocation(60, [entry({ timeSpentMinutes: 60, workDescription: "x" })]);
    expect(result.errors.some((e) => e.includes("select a project or a category"))).toBe(true);
  });

  it("errors when project set but no task and no approved category", () => {
    const result = validateAllocation(60, [
      entry({ projectId: "p1", timeSpentMinutes: 60, workDescription: "x" }),
    ]);
    expect(result.errors.some((e) => e.includes("select a task"))).toBe(true);
  });

  it("errors when timeSpentMinutes is zero or missing", () => {
    const result = validateAllocation(60, [
      entry({ category: "Meetings", workDescription: "x", timeSpentMinutes: 0 }),
    ]);
    expect(result.errors.some((e) => e.includes("time spent greater than 0"))).toBe(true);
  });

  it("errors when workDescription is missing", () => {
    const result = validateAllocation(60, [
      entry({ category: "Meetings", timeSpentMinutes: 60, workDescription: "" }),
    ]);
    expect(result.errors.some((e) => e.includes("work description"))).toBe(true);
  });

  it("errors when total exceeds checked-in minutes, and cannot submit (decision C)", () => {
    const result = validateAllocation(60, [
      entry({ category: "Meetings", timeSpentMinutes: 90, workDescription: "x" }),
    ]);
    expect(result.errors.some((e) => e.includes("exceeds your checked-in time"))).toBe(true);
    expect(result.isOverAllocated).toBe(true);
    expect(result.canSubmit).toBe(false);
    expect(result.unallocatedMinutes).toBe(0);
  });

  it("an invalid entry blocks submission even when the total fits", () => {
    const result = validateAllocation(480, [
      entry({ projectId: "p1", taskId: null, timeSpentMinutes: 60, workDescription: "x" }),
    ]);
    expect(result.isOverAllocated).toBe(false);
    expect(result.canSubmit).toBe(false);
  });

  it("allows under-allocation and reports the remainder as unallocated (decision A)", () => {
    const result = validateAllocation(60, [
      entry({ category: "Meetings", timeSpentMinutes: 30, workDescription: "x" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.canSubmit).toBe(true);
    expect(result.loggedMinutes).toBe(30);
    expect(result.unallocatedMinutes).toBe(30);
  });

  it("is valid with zero unallocated when a valid entry exactly covers the session", () => {
    const result = validateAllocation(60, [
      entry({ projectId: "p1", taskId: "t1", timeSpentMinutes: 60, workDescription: "did work" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.canSubmit).toBe(true);
    expect(result.sessionMinutes).toBe(60);
    expect(result.loggedMinutes).toBe(60);
    expect(result.unallocatedMinutes).toBe(0);
  });

  it("sums multiple valid entries correctly", () => {
    const result = validateAllocation(90, [
      entry({ projectId: "p1", taskId: "t1", timeSpentMinutes: 60, workDescription: "a" }),
      entry({ category: "Meetings", timeSpentMinutes: 30, workDescription: "b" }),
    ]);
    expect(result.loggedMinutes).toBe(90);
    expect(result.canSubmit).toBe(true);
  });

  // The approved acceptance matrix. No 8-hour rule in either direction: below 8h is allowed, above 8h
  // is allowed, and the only total-level limit is the checked-in time itself.
  const valid = (minutes: number) =>
    entry({ projectId: "p1", taskId: "t1", timeSpentMinutes: minutes, workDescription: "w" });
  it.each([
    ["9h 32m checked in / 8h logged", 572, [480], true, 92],
    ["8h checked in / 8h logged", 480, [480], true, 0],
    ["8h checked in / 6h logged", 480, [360], true, 120],
    ["8h checked in / 9h logged (blocked)", 480, [540], false, 0],
    ["10h checked in / 9h logged", 600, [300, 240], true, 60],
    ["2h checked in / 1h logged (well under 8h)", 120, [60], true, 60],
  ])("%s", (_label, session, logged, ok, unallocated) => {
    const result = validateAllocation(session, logged.map(valid));
    expect(result.canSubmit).toBe(ok);
    expect(result.unallocatedMinutes).toBe(unallocated);
  });

  it("8h checked in / 0h logged is blocked (decision B: zero-hour checkout is deferred)", () => {
    expect(validateAllocation(480, []).canSubmit).toBe(false);
  });

  it("a growing session never invalidates a valid log — it only grows the unallocated figure", () => {
    const entries = [valid(480)];
    const before = validateAllocation(480, entries);
    const after = validateAllocation(482, entries);
    expect(before.canSubmit).toBe(true);
    expect(after.canSubmit).toBe(true);
    expect(after.unallocatedMinutes - before.unallocatedMinutes).toBe(2);
    expect(after.loggedMinutes).toBe(before.loggedMinutes);
  });
});

describe("summarizeCheckout", () => {
  it("captures the three figures and the entry count", () => {
    const allocation = validateAllocation(572, [
      entry({ projectId: "p1", taskId: "t1", timeSpentMinutes: 300, workDescription: "a" }),
      entry({ projectId: "p1", taskId: "t2", timeSpentMinutes: 180, workDescription: "b" }),
    ]);
    expect(summarizeCheckout(allocation, 2)).toEqual({
      sessionMinutes: 572,
      loggedMinutes: 480,
      unallocatedMinutes: 92,
      entryCount: 2,
    });
  });
});

describe("splitDuration / composeDuration", () => {
  it("splits total minutes into hours and minutes", () => {
    expect(splitDuration(497)).toEqual({ hours: 8, minutes: 17 });
    expect(splitDuration(0)).toEqual({ hours: 0, minutes: 0 });
    expect(splitDuration(59)).toEqual({ hours: 0, minutes: 59 });
    expect(splitDuration(120)).toEqual({ hours: 2, minutes: 0 });
  });

  it("floors negative and non-finite totals at zero", () => {
    expect(splitDuration(-30)).toEqual({ hours: 0, minutes: 0 });
    expect(splitDuration(Number.NaN)).toEqual({ hours: 0, minutes: 0 });
  });

  it("composes hours + minutes back into total minutes", () => {
    expect(composeDuration(8, 17)).toBe(497);
    expect(composeDuration(0, 0)).toBe(0);
  });

  it("clamps minutes to 0-59 and hours to non-negative", () => {
    expect(composeDuration(1, 75)).toBe(60 + 59);
    expect(composeDuration(1, -5)).toBe(60);
    expect(composeDuration(-2, 30)).toBe(30);
    expect(composeDuration(Number.NaN, Number.NaN)).toBe(0);
  });

  it("round-trips any in-range total", () => {
    for (const total of [0, 1, 59, 60, 61, 497, 1439]) {
      const { hours, minutes } = splitDuration(total);
      expect(composeDuration(hours, minutes)).toBe(total);
    }
  });
});
