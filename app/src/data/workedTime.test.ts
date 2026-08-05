import { describe, expect, it } from "vitest";
import { computeWorkedMinutes, formatDuration, validateAllocation } from "./workedTime";
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
    expect(result.isFullyAllocated).toBe(false);
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

  it("errors when total exceeds worked minutes", () => {
    const result = validateAllocation(60, [
      entry({ category: "Meetings", timeSpentMinutes: 90, workDescription: "x" }),
    ]);
    expect(result.errors.some((e) => e.includes("exceeds worked time"))).toBe(true);
    expect(result.remainingMinutes).toBe(-30);
  });

  it("errors when total is under worked minutes (must fully allocate)", () => {
    const result = validateAllocation(60, [
      entry({ category: "Meetings", timeSpentMinutes: 30, workDescription: "x" }),
    ]);
    expect(result.errors.some((e) => e.includes("must fully account for worked time"))).toBe(true);
    expect(result.remainingMinutes).toBe(30);
  });

  it("is fully allocated with no errors when a valid entry exactly covers worked minutes", () => {
    const result = validateAllocation(60, [
      entry({ projectId: "p1", taskId: "t1", timeSpentMinutes: 60, workDescription: "did work" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.isFullyAllocated).toBe(true);
    expect(result.totalLoggedMinutes).toBe(60);
    expect(result.remainingMinutes).toBe(0);
  });

  it("sums multiple valid entries correctly", () => {
    const result = validateAllocation(90, [
      entry({ projectId: "p1", taskId: "t1", timeSpentMinutes: 60, workDescription: "a" }),
      entry({ category: "Meetings", timeSpentMinutes: 30, workDescription: "b" }),
    ]);
    expect(result.totalLoggedMinutes).toBe(90);
    expect(result.isFullyAllocated).toBe(true);
  });
});
