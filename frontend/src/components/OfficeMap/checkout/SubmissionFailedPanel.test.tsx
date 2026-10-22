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

describe("SubmissionFailedPanel — failure-kind copy", () => {
  it.each([0, 1])("shows the blocked-date guidance for an unconfirmed duplicate with %i entries", (entriesCreated) => {
    const error = `${entriesCreated ? "Only 1 of 2 entries are confirmed in Zoho. " : ""}This work date was already attempted. Editing will not make it retryable until the Atlas team reconciles Zoho writes and clears the earlier attempt. Contact the Atlas team before retrying.`;
    render(<SubmissionFailedPanel visible error={error} onTryAgain={() => {}} onSaveAndReturnLater={() => {}}
      result={{ success: false, kind: "unknown", entriesCreated }} />);
    expect(screen.getByText(error)).toBeTruthy();
    expect(screen.getByText(/draft.*not been checked out/s)).toBeTruthy();
    expect(screen.queryByText(/remove the ones that succeeded/)).toBeNull();
  });

  it("keeps the task ID and upstream diagnostic text verbatim", () => {
    const taskId = "task-123";
    const error = 'Zoho rejected: PATTERN_NOT_MATCHED {"field":"notes","value":"a < b & c"}';
    render(<SubmissionFailedPanel visible error={null} onTryAgain={() => {}} onSaveAndReturnLater={() => {}}
      result={{ success: false, kind: "entry-rejection", failures: [{ taskId, error }] }} />);
    expect(screen.getByRole("listitem").textContent).toBe(`${taskId}: Atlas could not log this entry — ${error}`);
  });

  it("entry-rejection: neutral per-entry wording, never asserts a Zoho rejection", () => {
    render(
      <SubmissionFailedPanel
        visible
        error="1 of 1 entries could not be logged."
        onTryAgain={() => {}}
        onSaveAndReturnLater={() => {}}
        result={{
          success: false,
          kind: "entry-rejection",
          entriesCreated: 0,
          failures: [{ taskId: "task-a", error: "That task is not assigned to you." }],
        }}
      />,
    );
    expect(screen.getByText("Atlas responded; these entries could not be logged.")).toBeTruthy();
    expect(screen.getByText(/task-a: Atlas could not log this entry — That task is not assigned to you\./)).toBeTruthy();
    expect(screen.queryByText(/Zoho rejected/)).toBeNull();
  });

  it("entry-rejection: shows Atlas's message even when the underlying cause isn't a Zoho rejection", () => {
    render(
      <SubmissionFailedPanel
        visible
        error="1 of 1 entries could not be logged."
        onTryAgain={() => {}}
        onSaveAndReturnLater={() => {}}
        result={{
          success: false,
          kind: "entry-rejection",
          entriesCreated: 0,
          failures: [{ taskId: "task-b", error: "Upstream Zoho request timed out." }],
        }}
      />,
    );
    expect(screen.getByText(/task-b: Atlas could not log this entry — Upstream Zoho request timed out\./)).toBeTruthy();
    expect(screen.queryByText(/Zoho rejected/)).toBeNull();
  });

  it("transport: heading says it couldn't confirm, never claims Atlas is down, and warns before retry", () => {
    render(
      <SubmissionFailedPanel
        visible
        error="Submission failed (HTTP 503)."
        onTryAgain={() => {}}
        onSaveAndReturnLater={() => {}}
        result={{ success: false, kind: "transport" }}
      />,
    );
    expect(screen.getByText("Couldn't confirm submission through Atlas")).toBeTruthy();
    expect(screen.queryByText(/Atlas is down/i)).toBeNull();
    expect(screen.getByText(/may already be logged.*check Zoho before trying again/s)).toBeTruthy();
    // Retry stays available — the warning gates awareness, not the action itself.
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("a timeout (kind transport, outcome unknown) shows the same unconfirmed-outcome warning before retry", () => {
    render(
      <SubmissionFailedPanel
        visible
        error="Couldn't confirm submission through Atlas (timed out)."
        onTryAgain={() => {}}
        onSaveAndReturnLater={() => {}}
        result={{ success: false, kind: "transport" }}
      />,
    );
    expect(screen.getByText("Couldn't confirm submission through Atlas")).toBeTruthy();
    expect(screen.getByText(/may already be logged.*check Zoho before trying again/s)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("unknown-outcome kind gets the same heading and duplicate-risk warning as transport", () => {
    render(
      <SubmissionFailedPanel
        visible
        error="Something unexpected happened."
        onTryAgain={() => {}}
        onSaveAndReturnLater={() => {}}
        result={{ success: false, kind: "unknown" }}
      />,
    );
    expect(screen.getByText("Couldn't confirm submission through Atlas")).toBeTruthy();
    expect(screen.getByText(/may already be logged.*check Zoho before trying again/s)).toBeTruthy();
  });

  it("auth/validation: falls back to the raw message unchanged, no duplicate-risk warning", () => {
    render(
      <SubmissionFailedPanel
        visible
        error="Submission failed (HTTP 401)."
        onTryAgain={() => {}}
        onSaveAndReturnLater={() => {}}
        result={{ success: false, kind: "auth" }}
      />,
    );
    expect(screen.getByText("Submission failed (HTTP 401).")).toBeTruthy();
    expect(screen.queryByText(/may already be logged/)).toBeNull();
  });
});
