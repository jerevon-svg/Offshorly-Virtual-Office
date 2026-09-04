import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAll,
  clearDraft,
  isAlreadyCheckedOut,
  loadDraft,
  loadResult,
  loadSessionStart,
  saveDraft,
  saveResult,
  saveSessionStart,
} from "./checkoutStorage";

const EMPLOYEE = "bon";
const WORK_DATE = "2026-08-05";

beforeEach(() => {
  window.localStorage.clear();
});

describe("draft persistence", () => {
  it("returns null when no draft saved", () => {
    expect(loadDraft(EMPLOYEE, WORK_DATE)).toBeNull();
  });

  it("round-trips a saved draft", () => {
    const draft = {
      entries: [
        {
          projectId: "proj-1",
          taskId: "task-1",
          category: null,
          timeSpentMinutes: 60,
          workDescription: "did stuff",
        },
      ],
      breakMinutes: 15,
      savedAt: "2026-08-05T10:00:00.000Z",
    };
    saveDraft(EMPLOYEE, WORK_DATE, draft);
    expect(loadDraft(EMPLOYEE, WORK_DATE)).toEqual(draft);
  });

  it("keeps drafts scoped per employeeId+workDate", () => {
    saveDraft(EMPLOYEE, WORK_DATE, { entries: [], savedAt: "x" });
    expect(loadDraft("someone-else", WORK_DATE)).toBeNull();
    expect(loadDraft(EMPLOYEE, "2026-08-06")).toBeNull();
  });
});

describe("result persistence + idempotency", () => {
  it("isAlreadyCheckedOut is false with no result", () => {
    expect(isAlreadyCheckedOut(EMPLOYEE, WORK_DATE)).toBe(false);
  });

  it("isAlreadyCheckedOut is true after a successful result is saved", () => {
    saveResult(EMPLOYEE, WORK_DATE, {
      success: true,
      submissionId: "mock-zoho-log-bon-2026-08-05",
      submittedAt: "2026-08-05T18:05:00.000Z",
      entriesCreated: 2,
    });
    expect(isAlreadyCheckedOut(EMPLOYEE, WORK_DATE)).toBe(true);
    expect(loadResult(EMPLOYEE, WORK_DATE)?.submissionId).toBe("mock-zoho-log-bon-2026-08-05");
  });

  it("isAlreadyCheckedOut stays false after a failed result", () => {
    saveResult(EMPLOYEE, WORK_DATE, { success: false, error: "boom" });
    expect(isAlreadyCheckedOut(EMPLOYEE, WORK_DATE)).toBe(false);
  });

  it("repeated saveResult with success keeps the same submissionId (no duplication)", () => {
    const result = {
      success: true,
      submissionId: "mock-zoho-log-bon-2026-08-05",
      submittedAt: "2026-08-05T18:05:00.000Z",
      entriesCreated: 2,
    };
    saveResult(EMPLOYEE, WORK_DATE, result);
    saveResult(EMPLOYEE, WORK_DATE, result);
    expect(loadResult(EMPLOYEE, WORK_DATE)?.submissionId).toBe(result.submissionId);
  });
});

describe("clearAll", () => {
  it("removes both draft and result for the key", () => {
    saveDraft(EMPLOYEE, WORK_DATE, { entries: [], savedAt: "x" });
    saveResult(EMPLOYEE, WORK_DATE, { success: true });
    clearAll(EMPLOYEE, WORK_DATE);
    expect(loadDraft(EMPLOYEE, WORK_DATE)).toBeNull();
    expect(loadResult(EMPLOYEE, WORK_DATE)).toBeNull();
  });
});

describe("session-aware isAlreadyCheckedOut", () => {
  const T = (h: number) => `2026-08-05T${String(h).padStart(2, "0")}:00:00.000Z`;

  it("a successful result with no newer session marker means checked out", () => {
    saveResult(EMPLOYEE, WORK_DATE, { success: true, submissionId: "s1", submittedAt: T(9) });
    expect(isAlreadyCheckedOut(EMPLOYEE, WORK_DATE)).toBe(true);
  });

  it("a newer session marker turns the earlier result into history (active new session)", () => {
    saveResult(EMPLOYEE, WORK_DATE, { success: true, submissionId: "s1", submittedAt: T(9) });
    saveSessionStart(EMPLOYEE, WORK_DATE, T(10));
    expect(isAlreadyCheckedOut(EMPLOYEE, WORK_DATE)).toBe(false);
    // History is preserved, not deleted.
    expect(loadResult(EMPLOYEE, WORK_DATE)?.submissionId).toBe("s1");
    expect(loadSessionStart(EMPLOYEE, WORK_DATE)).toEqual({ startedAt: T(10) });
  });

  it("a later checkout result after the marker means checked out again", () => {
    saveSessionStart(EMPLOYEE, WORK_DATE, T(10));
    saveResult(EMPLOYEE, WORK_DATE, { success: true, submissionId: "s2", submittedAt: T(17) });
    expect(isAlreadyCheckedOut(EMPLOYEE, WORK_DATE)).toBe(true);
  });

  it("a result that cannot be proven newer than the marker is history", () => {
    saveSessionStart(EMPLOYEE, WORK_DATE, T(10));
    saveResult(EMPLOYEE, WORK_DATE, { success: true, submissionId: "old-shape" });
    expect(isAlreadyCheckedOut(EMPLOYEE, WORK_DATE)).toBe(false);
  });

  it("clearDraft leaves the result and marker alone; clearAll removes the marker too", () => {
    saveDraft(EMPLOYEE, WORK_DATE, { entries: [], savedAt: T(9) });
    saveResult(EMPLOYEE, WORK_DATE, { success: true, submissionId: "s1", submittedAt: T(9) });
    saveSessionStart(EMPLOYEE, WORK_DATE, T(10));
    clearDraft(EMPLOYEE, WORK_DATE);
    expect(loadDraft(EMPLOYEE, WORK_DATE)).toBeNull();
    expect(loadResult(EMPLOYEE, WORK_DATE)).not.toBeNull();
    expect(loadSessionStart(EMPLOYEE, WORK_DATE)).not.toBeNull();
    clearAll(EMPLOYEE, WORK_DATE);
    expect(loadSessionStart(EMPLOYEE, WORK_DATE)).toBeNull();
  });
});

describe("per-employee isolation", () => {
  it("one employee's result, draft and session marker are invisible to another employee", () => {
    saveResult("jerevon@offshorly.com", WORK_DATE, { success: true, submissionId: "j1", submittedAt: "2026-08-05T09:00:00.000Z" });
    saveDraft("jerevon@offshorly.com", WORK_DATE, { entries: [], savedAt: "2026-08-05T09:00:00.000Z" });
    saveSessionStart("jerevon@offshorly.com", WORK_DATE, "2026-08-05T08:00:00.000Z");
    expect(loadResult("alex@offshorly.com", WORK_DATE)).toBeNull();
    expect(loadDraft("alex@offshorly.com", WORK_DATE)).toBeNull();
    expect(loadSessionStart("alex@offshorly.com", WORK_DATE)).toBeNull();
    expect(isAlreadyCheckedOut("alex@offshorly.com", WORK_DATE)).toBe(false);
    expect(isAlreadyCheckedOut("jerevon@offshorly.com", WORK_DATE)).toBe(true);
  });
});
