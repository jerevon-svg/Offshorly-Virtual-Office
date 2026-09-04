import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAll, loadResult, saveResult } from "../../../data/checkoutStorage";
import { canOfferCheckIn } from "../spawnPlacement";
import { useCheckoutFlow } from "../useCheckoutFlow";
import { CheckoutSuccessCard } from "./CheckoutSuccessCard";

const submitTimeLogs = vi.fn();
vi.mock("../../../services/zoho", () => ({
  zohoService: {
    getProjects: () => Promise.resolve([]),
    getTasks: () => Promise.resolve([]),
    submitTimeLogs: (...args: unknown[]) => submitTimeLogs(...args),
  },
  isAlreadySubmittedError: (err: unknown) => err instanceof Error && err.name === "AlreadySubmittedError",
}));

const EMPLOYEE_ID = "emp-success-card";
function workDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Mirrors OfficeMap's wiring exactly: the card's visibility is local UI state, reset on every
// LIVE transition into CHECKED_OUT (not on mount), and Check In availability comes from the
// same canOfferCheckIn() gate the reception menu uses. Attendance is held CHECKED_OUT here —
// dismissing the card never touches it.
let latest: ReturnType<typeof useCheckoutFlow> | null = null;
function Harness() {
  const flow = useCheckoutFlow({ employeeId: EMPLOYEE_ID, hourDecimal: 10, timeInMs: null });
  latest = flow;
  const attendance = "CHECKED_OUT" as const;
  const [dismissed, setDismissed] = useState(false);
  const prevRef = useRef(flow.state);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = flow.state;
    if (flow.state === "CHECKED_OUT" && prev !== "CHECKED_OUT") setDismissed(false);
  }, [flow.state]);
  return (
    <>
      {!dismissed && (
        <CheckoutSuccessCard
          state={flow.state}
          workedLabel={flow.workedLabel}
          entries={flow.entries}
          submissionResult={flow.submissionResult}
          onDismiss={() => setDismissed(true)}
        />
      )}
      <div data-testid="state">{flow.state}</div>
      <div data-testid="checkin">{String(canOfferCheckIn(attendance, flow.state))}</div>
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  clearAll(EMPLOYEE_ID, workDate());
  submitTimeLogs.mockReset();
  latest = null;
});

describe("CheckoutSuccessCard dismissal", () => {
  it("a persisted CHECKED_OUT result shows the card; Close hides it, keeps history and keeps Check In available", () => {
    saveResult(EMPLOYEE_ID, workDate(), { success: true, submissionId: "hist-1", submittedAt: new Date().toISOString() });
    render(<Harness />);
    expect(screen.getByTestId("state").textContent).toBe("CHECKED_OUT");
    expect(screen.getByText("You're checked out! 🎉")).toBeTruthy();
    // Even with the card up, the gate itself already allows Check In (the card was the blocker).
    expect(screen.getByTestId("checkin").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByText("You're checked out! 🎉")).toBeNull();
    expect(screen.getByTestId("state").textContent).toBe("CHECKED_OUT"); // no fake new session
    expect(screen.getByTestId("checkin").textContent).toBe("true");
    expect(loadResult(EMPLOYEE_ID, workDate())?.submissionId).toBe("hist-1"); // history preserved
  });

  it("a newly completed checkout shows the card again after an earlier dismissal", async () => {
    saveResult(EMPLOYEE_ID, workDate(), { success: true, submissionId: "hist-1", submittedAt: new Date(Date.now() - 3_600_000).toISOString() });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("You're checked out! 🎉")).toBeNull();

    // New session, then a full checkout to CHECKED_OUT.
    act(() => latest!.beginNewSession(new Date().toISOString()));
    expect(screen.getByTestId("state").textContent).toBe("IDLE");
    submitTimeLogs.mockResolvedValue({ success: true, submissionId: "s2", submittedAt: new Date().toISOString(), entriesCreated: 1 });
    act(() => latest!.startCheckout());
    act(() => latest!.confirmStartCheckout());
    act(() => latest!.arrivedAtReception());
    act(() => latest!.continueToTimeLog());
    act(() => latest!.goToReview());
    await act(async () => {
      await latest!.submit();
    });
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("CHECKOUT_SUCCESS"));
    act(() => latest!.startExitWalk());
    act(() => latest!.finishExit());
    expect(screen.getByTestId("state").textContent).toBe("CHECKED_OUT");
    expect(screen.getByText("You're checked out! 🎉")).toBeTruthy();
    expect(loadResult(EMPLOYEE_ID, workDate())?.submissionId).toBe("s2");
  });

  it("renders nothing outside CHECKED_OUT", () => {
    render(<CheckoutSuccessCard state="IDLE" workedLabel="0h 0m" entries={[]} submissionResult={null} onDismiss={() => {}} />);
    expect(screen.queryByText("You're checked out! 🎉")).toBeNull();
  });
});
