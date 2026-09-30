import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCheckoutFlow } from "./useCheckoutFlow";
import { loadDraft, loadResult, clearAll, saveDraft, saveResult } from "../../data/checkoutStorage";

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
  act(() => hookResult.current.updateEntry(0, {
    category: "Meetings",
    timeSpentMinutes: hookResult.current.workedMinutes,
    workDescription: "did work",
  }));
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
  it.each(["submit", "retrySubmit"] as const)("%s blocks 1441 minutes and preserves the draft", async (method) => {
    submitTimeLogs.mockResolvedValue({ success: false, error: "network down" });
    const timeInMs = Date.now() - 1441 * 60_000;
    const { result } = renderHook(() => useCheckoutFlow({
      employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs,
    }));
    await driveToReviewing(result);
    if (method === "retrySubmit") {
      act(() => result.current.updateEntry(0, { timeSpentMinutes: 1440 }));
      act(() => result.current.addEntry());
      act(() => result.current.updateEntry(1, {
        category: "Meetings", timeSpentMinutes: 1, workDescription: "rest",
      }));
      await act(async () => { await result.current.submit(); });
      expect(result.current.state).toBe("SUBMISSION_FAILED");
      expect(submitTimeLogs).toHaveBeenCalledTimes(1);
      submitTimeLogs.mockClear();
      act(() => result.current.removeEntry(1));
      act(() => result.current.updateEntry(0, { timeSpentMinutes: 1441 }));
    }
    const draft = loadDraft(EMPLOYEE_ID, currentWorkDate());
    await act(async () => { await result.current[method](); });
    expect(submitTimeLogs).not.toHaveBeenCalled();
    expect(result.current.state).toBe("EDITING_TIME_LOG");
    expect(result.current.error).toBe("Entry 1: max 24h per entry; add another entry for the rest");
    expect(result.current.submissionResult).toBeNull();
    expect(loadDraft(EMPLOYEE_ID, currentWorkDate())).toEqual(draft);
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())).toBeNull();
  });

  it("submits a fully allocated 95h43m session split into capped entries", async () => {
    submitTimeLogs.mockResolvedValue({ success: true, entriesCreated: 4 });
    const timeInMs = Date.now() - 5743 * 60_000;
    const { result } = renderHook(() => useCheckoutFlow({
      employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs,
    }));
    await driveToReviewing(result);
    for (const [index, minutes] of [1440, 1440, 1440, 1423].entries()) {
      if (index > 0) act(() => result.current.addEntry());
      act(() => result.current.updateEntry(index, {
        category: "Meetings", timeSpentMinutes: minutes, workDescription: "did work",
      }));
    }
    await act(async () => { await result.current.submit(); });
    expect(submitTimeLogs).toHaveBeenCalledTimes(1);
    expect(submitTimeLogs.mock.calls[0][0].entries.map((entry: { timeSpentMinutes: number }) => entry.timeSpentMinutes))
      .toEqual([1440, 1440, 1440, 1423]);
    expect(result.current.state).toBe("CHECKOUT_SUCCESS");
  });

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

  it("a per-entry rejection followed by a network failure shows fresh state, not the old failures list", async () => {
    submitTimeLogs
      .mockResolvedValueOnce({
        success: false,
        kind: "entry-rejection",
        error: "1 of 1 entries could not be logged.",
        entriesCreated: 0,
        failures: [{ taskId: "task-a", error: "That task is not assigned to you." }],
      })
      .mockResolvedValueOnce({
        success: false,
        kind: "transport",
        error: "Couldn't confirm submission through Atlas.",
      });

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );

    await driveToReviewing(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.submissionResult?.failures?.length).toBe(1);

    await act(async () => {
      await result.current.retrySubmit();
    });
    // Stale per-entry failure list must not survive into the new attempt's result.
    expect(result.current.submissionResult?.failures ?? []).toEqual([]);
    expect(result.current.submissionResult?.kind).toBe("transport");
    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(result.current.state).not.toBe("CHECKOUT_SUCCESS");
  });

  it("clears the previous failures list as soon as a retry starts, not just once it resolves", async () => {
    submitTimeLogs.mockResolvedValueOnce({
      success: false,
      kind: "entry-rejection",
      entriesCreated: 0,
      failures: [{ taskId: "task-a", error: "nope" }],
    });
    let resolveSecond!: (v: unknown) => void;
    submitTimeLogs.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );

    await driveToReviewing(result);
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.submissionResult?.failures?.length).toBe(1);

    act(() => {
      void result.current.retrySubmit();
    });
    // Retry is still pending (submitTimeLogs hasn't resolved yet) — the
    // stale failures list must already be gone, not linger until resolution.
    expect(result.current.submissionResult).toBeNull();
    expect(result.current.state).toBe("SUBMITTING");

    await act(async () => {
      resolveSecond({ success: false, kind: "transport", error: "Couldn't confirm submission through Atlas." });
      await Promise.resolve();
    });
    expect(result.current.state).toBe("SUBMISSION_FAILED");
    expect(result.current.submissionResult?.kind).toBe("transport");
  });

  it("a duplicate-submission (AlreadySubmittedError) is treated as success and recorded, not as a failure", async () => {
    class AlreadySubmittedError extends Error {
      submissionId = "vo-earlier";
      entriesCreated = 2;
      constructor() {
        super("already submitted");
        this.name = "AlreadySubmittedError";
      }
    }
    submitTimeLogs.mockRejectedValue(new AlreadySubmittedError());

    const { result } = renderHook(() =>
      useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: Date.now() - 1 * 60 * 60 * 1000 }),
    );

    await driveToReviewing(result);
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toBe("CHECKOUT_SUCCESS");
    expect(loadResult(EMPLOYEE_ID, currentWorkDate())?.success).toBe(true);
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
