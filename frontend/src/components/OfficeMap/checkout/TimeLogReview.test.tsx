import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TimeLogEntry } from "../../../services/zoho/types";
import { validateAllocation } from "../../../data/workedTime";
import { TimeLogReview } from "./TimeLogReview";

function entry(minutes: number): TimeLogEntry {
  return { projectId: "p1", taskId: "t1", category: null, timeSpentMinutes: minutes, workDescription: "w", billable: true };
}

function renderReview(sessionMinutes: number, workedLabel: string, entries: TimeLogEntry[]) {
  const onSubmit = vi.fn();
  render(
    <TimeLogReview
      entries={entries}
      allocation={validateAllocation(sessionMinutes, entries)}
      workedLabel={workedLabel}
      onBack={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, submit: screen.getByRole("button", { name: /submit log and check out/i }) as HTMLButtonElement };
}

function rowValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

describe("TimeLogReview", () => {
  it("shows the three figures and the explanation, and submits an under-allocated log", () => {
    const { submit, onSubmit } = renderReview(572, "9h 32m", [entry(300), entry(180)]);
    expect(rowValue("Checked in for")).toBe("9h 32m");
    expect(rowValue("Sent to Zoho Projects")).toBe("8h 0m (2 entries)");
    expect(rowValue("Not logged")).toBe("1h 32m");
    expect(screen.getByText(/Only your project entries are sent to Zoho Projects/)).toBeTruthy();
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("blocks an over-allocated log with a visible reason", () => {
    const { submit } = renderReview(480, "8h 0m", [entry(540)]);
    expect(submit.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/exceeds your checked-in time/);
  });

  it("blocks a log with no entries", () => {
    const { submit } = renderReview(480, "8h 0m", []);
    expect(submit.disabled).toBe(true);
  });
});
