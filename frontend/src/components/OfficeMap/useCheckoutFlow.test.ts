import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCheckoutFlow } from "./useCheckoutFlow";
import { loadDraft, loadResult, clearAll } from "../../data/checkoutStorage";

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
