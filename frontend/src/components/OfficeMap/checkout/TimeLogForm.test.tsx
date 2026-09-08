import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TimeLogEntry } from "../../../services/zoho/types";
import { validateAllocation } from "../../../data/workedTime";
import { TimeLogForm } from "./TimeLogForm";

function entry(patch: Partial<TimeLogEntry> = {}): TimeLogEntry {
  return {
    projectId: "p1",
    taskId: "t1",
    category: null,
    timeSpentMinutes: 0,
    workDescription: "did work",
    billable: true,
    ...patch,
  } as TimeLogEntry;
}

function renderForm(entries: TimeLogEntry[], onUpdateEntry = vi.fn()) {
  render(
    <TimeLogForm
      entries={entries}
      projects={[{ id: "p1", name: "Project One" }]}
      tasks={[{ id: "t1", projectId: "p1", name: "Task One" }]}
      allocation={validateAllocation(497, entries)}
      workedLabel="8h 17m"
      error={null}
      onUpdateEntry={onUpdateEntry}
      onAddEntry={vi.fn()}
      onRemoveEntry={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  return { onUpdateEntry };
}

describe("TimeLogForm time spent (HH:MM)", () => {
  it("shows stored minutes split across the hours and minutes boxes", () => {
    renderForm([entry({ timeSpentMinutes: 497 })]);
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("8");
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("17");
  });

  it("submits 8h 17m to the entry model as 497 minutes", () => {
    const { onUpdateEntry } = renderForm([entry({ timeSpentMinutes: 0 })]);
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "8" } });
    expect(onUpdateEntry).toHaveBeenLastCalledWith(0, { timeSpentMinutes: 480 });

    // The parent re-renders with the composed value; minutes then add on top.
    renderForm([entry({ timeSpentMinutes: 480 })], onUpdateEntry);
    fireEvent.change(screen.getAllByLabelText("Minutes")[1], { target: { value: "17" } });
    expect(onUpdateEntry).toHaveBeenLastCalledWith(0, { timeSpentMinutes: 497 });
  });

  it("clamps minutes above 59", () => {
    const { onUpdateEntry } = renderForm([entry({ timeSpentMinutes: 60 })]);
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "75" } });
    expect(onUpdateEntry).toHaveBeenLastCalledWith(0, { timeSpentMinutes: 119 });
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("59");
  });

  it("clamps negative hours to zero", () => {
    const { onUpdateEntry } = renderForm([entry({ timeSpentMinutes: 120 })]);
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "-3" } });
    expect(onUpdateEntry).toHaveBeenLastCalledWith(0, { timeSpentMinutes: 0 });
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("0");
  });

  it("treats a blanked box as zero without refilling it mid-edit", () => {
    const { onUpdateEntry } = renderForm([entry({ timeSpentMinutes: 480 })]);
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "" } });
    expect(onUpdateEntry).toHaveBeenLastCalledWith(0, { timeSpentMinutes: 0 });
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("");
  });
});
