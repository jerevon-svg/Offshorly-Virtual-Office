import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCheckoutFlow } from "./useCheckoutFlow";
import { loadDraft, loadRecovery, loadResult, clearAll, saveDraft, saveResult } from "../../data/checkoutStorage";

// zohoService is mocked at the module boundary so each test controls
// submitTimeLogs' outcome directly (HTTP-500-equivalent failure, success,
// AlreadySubmittedError) without going through a real network layer —
// AtlasZohoService.test.ts already covers translating an actual HTTP 500
// into { success: false, error: ... }; this file covers what the checkout
// STATE MACHINE does with that result.
const getProjects = vi.fn();
const getTasks = vi.fn();
const submitTimeLogs = vi.fn();

vi.mock("../../services/zoho", () => ({
  zohoService: {
    getProjects: (...args: unknown[]) => getProjects(...args),
    getTasks: (...args: unknown[]) => getTasks(...args),
    submitTimeLogs: (...args: unknown[]) => submitTimeLogs(...args),
  },
  isAlreadySubmittedError: (err: unknown) =>
    err instanceof Error && err.name === "AlreadySubmittedError",
}));

const EMPLOYEE_ID = "emp-checkout-resilience";

async function driveToReviewing(hookResult: { current: ReturnType<typeof useCheckoutFlow> }) {
  act(() => hookResult.current.startCheckout());
  act(() => hookResult.current.confirmStartCheckout());
  act(() => hookResult.current.arrivedAtReception());
  act(() => hookResult.current.continueToTimeLog());
  await waitFor(() => expect(hookResult.current.entries.length).toBeGreaterThan(0));
  act(() => hookResult.current.goToReview());
  expect(hookResult.current.state).toBe("REVIEWING");
}

beforeEach(() => {
  getProjects.mockReset().mockResolvedValue([]);
  getTasks.mockReset().mockResolvedValue([]);
  submitTimeLogs.mockReset();
  clearAll(EMPLOYEE_ID, currentWorkDate());
});

// Mirrors the hook's own manilaWorkDate() so the test reads/writes the same
// storage keys the hook does, without re-importing a private helper.
function currentWorkDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

describe("useCheckoutFlow — submission failure resilience", () => {
  it("an HTTP-500-equivalent submit result (success:false) goes to SUBMISSION_FAILED, keeps the draft, and does NOT mark CHECKED_OUT", async () => {
    submitTimeLogs.mockResolvedValue({
      success: false,
      error: "Submission failed (HTTP 500).",
    });

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );

    await driveToReviewing(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(result.current.error).toBe("Submission failed (HTTP 500).");

    const draft = loadDraft(EMPLOYEE_ID, currentWorkDate());
    expect(draft).not.toBeNull();
    expect(draft?.entries.length).toBeGreaterThan(0);

    // Never recorded as a successful checkout.
    const storedResult = loadResult(EMPLOYEE_ID, currentWorkDate());
    expect(storedResult?.success).not.toBe(true);
    expect(result.current.state).not.toBe("CHECKED_OUT");
  });

  it("a thrown network error on submit also lands on SUBMISSION_FAILED with the draft preserved (not CHECKED_OUT)", async () => {
    submitTimeLogs.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );

    await driveToReviewing(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(loadDraft(EMPLOYEE_ID, currentWorkDate())).not.toBeNull();
    expect(result.current.state).not.toBe("CHECKED_OUT");
  });

  it("retrySubmit is idempotent: repeated failures never fabricate success, never mark CHECKED_OUT, and each retry reissues exactly one submitTimeLogs call", async () => {
    submitTimeLogs.mockResolvedValue({ success: false, error: "Submission failed (HTTP 500)." });

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );

    await driveToReviewing(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(submitTimeLogs).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.retrySubmit();
    });
    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(submitTimeLogs).toHaveBeenCalledTimes(2);
    expect(result.current.state).not.toBe("CHECKED_OUT");

    await act(async () => {
      await result.current.retrySubmit();
    });
    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(submitTimeLogs).toHaveBeenCalledTimes(3);
    expect(result.current.state).not.toBe("CHECKED_OUT");
  });

  it("retrySubmit recovers to CHECKOUT_SUCCESS once the backend accepts the retry, and stops resubmitting", async () => {
    submitTimeLogs
      .mockResolvedValueOnce({ success: false, error: "Submission failed (HTTP 500)." })
      .mockResolvedValueOnce({
        success: true,
        submissionId: "vo-retry-1",
        submittedAt: new Date().toISOString(),
        entriesCreated: 1,
        failures: [],
      });

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );

    await driveToReviewing(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toBe("SUBMISSION_FAILED");

    await act(async () => {
      await result.current.retrySubmit();
    });
    expect(result.current.state).toBe("CHECKOUT_SUCCESS");
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())?.success).toBe(true);
  });

  it("saveAndReturnLater (SubmissionFailedPanel's only other action besides retry) keeps the draft and returns to IDLE without resubmitting", async () => {
    submitTimeLogs.mockResolvedValue({ success: false, error: "Submission failed (HTTP 500)." });

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );

    await driveToReviewing(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(submitTimeLogs).toHaveBeenCalledTimes(1);

    act(() => result.current.saveAndReturnLater());

    expect(result.current.state).toBe("IDLE");
    // saveAndReturnLater itself never calls submitTimeLogs again.
    expect(submitTimeLogs).toHaveBeenCalledTimes(1);
    const draft = loadDraft(EMPLOYEE_ID, currentWorkDate());
    expect(draft).not.toBeNull();
    expect(draft?.entries.length).toBeGreaterThan(0);
    // Still never recorded as a successful checkout.
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())?.success).not.toBe(true);
  });

  it("a thrown network error is ambiguous: no result, no success, draft kept", async () => {
    submitTimeLogs.mockRejectedValue(new Error("Failed to fetch"));
    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );
    await driveToReviewing(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(result.current.submissionResult).toBeNull();
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())).toBeNull();
    expect(loadDraft(EMPLOYEE_ID, currentWorkDate())).not.toBeNull();
  });
});

describe("useCheckoutFlow — under-allocation and the moving session clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a valid under-allocated log stays submittable as the clock advances, and submits only the entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00.000Z"));
    submitTimeLogs.mockResolvedValue({ success: true, submissionId: "s-under", submittedAt: "2026-09-11T10:02:00Z", entriesCreated: 1 });
    // Fixed once, like the server's check-in time — not recomputed per render.
    const checkedInAtMs = Date.now() - 572 * 60_000;
    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: checkedInAtMs }),
    );

    act(() => result.current.startCheckout());
    act(() => result.current.confirmStartCheckout());
    act(() => result.current.arrivedAtReception());
    act(() => result.current.continueToTimeLog());
    act(() =>
      result.current.updateEntry(0, { projectId: "p1", taskId: "t1", timeSpentMinutes: 480, workDescription: "shipped" }),
    );
    act(() => result.current.goToReview());
    expect(result.current.allocation.canSubmit).toBe(true);
    expect(result.current.allocation.unallocatedMinutes).toBe(92);
    const entriesBefore = result.current.entries;

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(result.current.state).toBe("REVIEWING");
    expect(result.current.allocation.canSubmit).toBe(true);
    expect(result.current.allocation.unallocatedMinutes).toBe(94);
    expect(result.current.entries).toEqual(entriesBefore);

    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toBe("CHECKOUT_SUCCESS");

    // The request is exactly what the employee entered: one 8h entry, nothing for the other 1h 34m.
    expect(submitTimeLogs).toHaveBeenCalledTimes(1);
    const request = submitTimeLogs.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(["employeeId", "entries", "workDate"]);
    expect(request.entries).toEqual(entriesBefore);

    // What the success card will show, captured at submit and stored for a reload.
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())?.checkoutSummary).toEqual({
      sessionMinutes: 574,
      loggedMinutes: 480,
      unallocatedMinutes: 94,
      entryCount: 1,
    });
  });

  it("an over-allocated log is not submittable", () => {
    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 480 * 60_000 }),
    );
    act(() => result.current.startCheckout());
    act(() => result.current.confirmStartCheckout());
    act(() => result.current.arrivedAtReception());
    act(() => result.current.continueToTimeLog());
    act(() =>
      result.current.updateEntry(0, { projectId: "p1", taskId: "t1", timeSpentMinutes: 540, workDescription: "x" }),
    );
    expect(result.current.allocation.isOverAllocated).toBe(true);
    expect(result.current.allocation.canSubmit).toBe(false);
  });
});

describe("useCheckoutFlow — same-day new session", () => {
  it("resumes CHECKED_OUT from today's result, beginNewSession returns to IDLE and keeps the result as history", () => {
    const workDate = currentWorkDate();
    const earlier = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    saveResult(EMPLOYEE_ID, workDate, { success: true, submissionId: "session-1", submittedAt: earlier });
    saveDraft(EMPLOYEE_ID, workDate, {
      entries: [{ projectId: "p", taskId: "t", category: null, timeSpentMinutes: 60, workDescription: "old" }],
      savedAt: earlier,
    });

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: null }),
    );
    expect(result.current.state).toBe("CHECKED_OUT");
    expect(result.current.submissionResult?.submissionId).toBe("session-1");

    act(() => result.current.beginNewSession(new Date().toISOString()));
    expect(result.current.state).toBe("IDLE");
    expect(result.current.submissionResult).toBeNull();
    expect(result.current.entries).toEqual([]);
    // History preserved; stale draft dropped so already-logged entries are not inherited.
    expect(loadResult(EMPLOYEE_ID, workDate)?.submissionId).toBe("session-1");
    expect(loadDraft(EMPLOYEE_ID, workDate)).toBeNull();

    // A refresh (fresh hook) now starts the new session in IDLE, not CHECKED_OUT.
    const { result: reloaded } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() }),
    );
    expect(reloaded.current.state).toBe("IDLE");
  });
});

// ---- V3a — an Atlas 409 is never a success ------------------------------------------------------------

class AlreadySubmittedError extends Error {
  submissionId = "vo-morning";
  entriesCreated = 2;
  constructor() {
    super("already submitted");
    this.name = "AlreadySubmittedError";
  }
}

const EVENING_ENTRY = { projectId: "p1", taskId: "t1", timeSpentMinutes: 240, workDescription: "evening work" };

async function reviewEveningEntry(hookResult: { current: ReturnType<typeof useCheckoutFlow> }) {
  act(() => hookResult.current.startCheckout());
  act(() => hookResult.current.confirmStartCheckout());
  act(() => hookResult.current.arrivedAtReception());
  act(() => hookResult.current.continueToTimeLog());
  act(() => hookResult.current.updateEntry(0, EVENING_ENTRY));
  act(() => hookResult.current.goToReview());
}

describe("useCheckoutFlow — V3a submission conflicts", () => {
  const MORNING = { success: true, submissionId: "vo-morning", entriesCreated: 2, submittedAt: "" };

  // Morning: a confirmed submission. Evening: a new session the same day, then a 409.
  async function eveningConflict() {
    const morningAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    saveResult(EMPLOYEE_ID, currentWorkDate(), { ...MORNING, submittedAt: morningAt });
    const hook = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 20, timeInMs: Date.now() - 4 * 60 * 60 * 1000 }),
    );
    act(() => hook.result.current.beginNewSession(new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()));
    submitTimeLogs.mockRejectedValue(new AlreadySubmittedError());
    await reviewEveningEntry(hook.result);
    await act(async () => {
      await hook.result.current.submit();
    });
    return { ...hook, morningAt };
  }

  it("a normal confirmed submission still succeeds", async () => {
    submitTimeLogs.mockResolvedValue({ success: true, submissionId: "s-ok", submittedAt: new Date().toISOString(), entriesCreated: 1 });
    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 5 * 60 * 60 * 1000 }),
    );
    await reviewEveningEntry(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.state).toBe("CHECKOUT_SUCCESS");
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())?.submissionId).toBe("s-ok");
  });

  it("a same-day 409 is an unresolved conflict: no success, no retry, draft kept, earlier result untouched", async () => {
    const { result, morningAt } = await eveningConflict();
    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(result.current.submissionResult).toEqual(expect.objectContaining({ success: false, conflict: true }));
    expect(result.current.submissionResult?.entriesCreated).toBeUndefined(); // Atlas's count is the morning's
    expect(result.current.error).toMatch(/could not be confirmed as saved/);
    expect(submitTimeLogs).toHaveBeenCalledTimes(1); // never retried automatically
    expect(loadDraft(EMPLOYEE_ID, currentWorkDate())?.entries[0]).toMatchObject(EVENING_ENTRY);
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())).toEqual({ ...MORNING, submittedAt: morningAt });
  });

  it("after a refresh the entries are restored and the employee is still checked in", async () => {
    const first = await eveningConflict();
    first.unmount();
    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 20, timeInMs: Date.now() - 4 * 60 * 60 * 1000 }),
    );
    expect(result.current.state).toBe("IDLE");
    expect(result.current.entries[0]).toMatchObject(EVENING_ENTRY);
  });

  it("staying checked in keeps the draft and reports nothing as saved", async () => {
    const { result } = await eveningConflict();
    act(() => result.current.saveAndReturnLater());
    expect(result.current.state).toBe("IDLE");
    expect(loadDraft(EMPLOYEE_ID, currentWorkDate())?.entries[0]).toMatchObject(EVENING_ENTRY);
    expect(loadRecovery(EMPLOYEE_ID, currentWorkDate())).toBeNull();
  });

  it("checking out anyway records no submission, keeps a recovery copy, and resumes as 'not confirmed' after a reload", async () => {
    const first = await eveningConflict();
    act(() => first.result.current.checkOutWithoutConfirmedHours());
    expect(first.result.current.state).toBe("CHECKED_OUT");
    expect(first.result.current.submissionResult).toEqual(expect.objectContaining({ success: false, hoursNotConfirmed: true }));
    expect(first.result.current.recovery?.reason).toBe("conflict");
    expect(first.result.current.recovery?.entries[0]).toMatchObject(EVENING_ENTRY);
    // The morning's confirmed result is not overwritten by the attendance-only checkout.
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())).toEqual({ ...MORNING, submittedAt: first.morningAt });

    first.unmount();
    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 20, timeInMs: Date.now() - 4 * 60 * 60 * 1000 }),
    );
    expect(result.current.state).toBe("CHECKED_OUT");
    expect(result.current.submissionResult?.hoursNotConfirmed).toBe(true);
    expect(result.current.submissionResult?.success).toBe(false);
    expect(result.current.recovery?.entries[0]).toMatchObject(EVENING_ENTRY);
  });

  it("checking out anyway is only reachable from a failed submission", async () => {
    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 60 * 60 * 1000 }),
    );
    await reviewEveningEntry(result);
    expect(() => act(() => result.current.checkOutWithoutConfirmedHours())).toThrow(/Illegal checkout state transition/);
    expect(loadRecovery(EMPLOYEE_ID, currentWorkDate())).toBeNull();
  });
});
