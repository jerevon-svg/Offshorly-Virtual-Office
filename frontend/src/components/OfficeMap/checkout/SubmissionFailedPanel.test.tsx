import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubmissionFailedPanel } from "./SubmissionFailedPanel";
import { CheckoutSuccessCard } from "./CheckoutSuccessCard";

const CONFLICT = { success: false, conflict: true };

function renderPanel(result: object | null, error = "boom") {
  const handlers = { onTryAgain: vi.fn(), onSaveAndReturnLater: vi.fn(), onCheckOutAnyway: vi.fn() };
  render(<SubmissionFailedPanel visible error={error} result={result as never} {...handlers} />);
  return handlers;
}

describe("SubmissionFailedPanel — V3a", () => {
  it("a 409 conflict says the hours were not confirmed, keeps the entries, and offers no retry", () => {
    renderPanel(CONFLICT);
    expect(screen.getByText("Your project hours could not be confirmed as saved")).toBeTruthy();
    expect(screen.getByText(/submission conflict/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(/were logged successfully/)).toBeNull();
  });

  it("an ordinary failure keeps Try again and warns to check Zoho first", () => {
    renderPanel(null);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText(/check Zoho Projects before trying again/)).toBeTruthy();
  });

  it("staying checked in is one click", () => {
    const h = renderPanel(CONFLICT);
    fireEvent.click(screen.getByRole("button", { name: "Save and return later" }));
    expect(h.onSaveAndReturnLater).toHaveBeenCalledTimes(1);
    expect(h.onCheckOutAnyway).not.toHaveBeenCalled();
  });

  it("checking out anyway needs an explicit second confirmation, and Go back cancels it", () => {
    const h = renderPanel(CONFLICT);
    fireEvent.click(screen.getByRole("button", { name: /Check out anyway — hours not confirmed/ }));
    expect(h.onCheckOutAnyway).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toMatch(/NOT been confirmed as saved/);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByText("Your project hours could not be confirmed as saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Check out anyway — hours not confirmed/ }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, check out — hours not confirmed/ }));
    expect(h.onCheckOutAnyway).toHaveBeenCalledTimes(1);
  });
});

describe("CheckoutSuccessCard — V3a attendance-only checkout", () => {
  it("never shows the success card, and lists the kept entries", () => {
    render(
      <CheckoutSuccessCard
        state="CHECKED_OUT"
        workedLabel="4h 0m"
        entries={[]}
        submissionResult={{ success: false, hoursNotConfirmed: true, submittedAt: "2026-10-22T14:00:00Z" }}
        recovery={{
          entries: [{ projectId: "p1", taskId: "t1", category: null, timeSpentMinutes: 240, workDescription: "evening work", billable: true }],
          savedAt: "2026-10-22T14:00:00Z",
          checkedOutAt: "2026-10-22T14:00:00Z",
          reason: "conflict",
        }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByText("You're checked out! 🎉")).toBeNull();
    expect(screen.queryByText("Sent to Zoho Projects")).toBeNull();
    expect(screen.getByText("You're checked out — project hours not confirmed")).toBeTruthy();
    expect(screen.getByTestId("checkout-hours-not-confirmed").textContent).toContain("4h 0m — evening work");
  });
});
