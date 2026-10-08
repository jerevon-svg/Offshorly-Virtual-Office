import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SubmissionFailedPanel } from "./SubmissionFailedPanel";

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
