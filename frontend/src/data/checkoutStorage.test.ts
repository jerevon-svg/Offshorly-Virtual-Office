import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAll,
  isAlreadyCheckedOut,
  loadDraft,
  loadResult,
  saveDraft,
  saveResult,
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
