import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TimeLogEntry } from "../../../services/zoho/types";
import { validateAllocation } from "../../../data/workedTime";
import { TimeLogForm } from "./TimeLogForm";
import { TimeLogReview } from "./TimeLogReview";

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

function renderForm(entries: TimeLogEntry[], onUpdateEntry = vi.fn(), workedMinutes = 497) {
  render(
    <TimeLogForm
      entries={entries}
      projects={[{ id: "p1", name: "Project One" }]}
      tasks={[{ id: "t1", projectId: "p1", name: "Task One" }]}
      allocation={validateAllocation(workedMinutes, entries)}
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
  it("combines 24h + 1m, shows the entry error, and clamps minutes above 59", () => {
    const onUpdate = vi.fn();
    function Form() {
      const [entries, setEntries] = useState([entry()]);
      return <TimeLogForm entries={entries} projects={[]} tasks={[]}
        allocation={validateAllocation(1441, entries)} workedLabel="24h 1m" error={null}
        onUpdateEntry={(index, patch) => {
          onUpdate(index, patch);
          setEntries(entries.map((value, i) => i === index ? { ...value, ...patch } : value));
        }} onAddEntry={vi.fn()} onRemoveEntry={vi.fn()} onContinue={vi.fn()} />;
    }
    render(<Form />);
    fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "1" } });
    expect(onUpdate).toHaveBeenLastCalledWith(0, { timeSpentMinutes: 1441 });
    expect(screen.getByText("Entry 1: max 24h per entry; add another entry for the rest")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review log" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "75" } });
    expect(onUpdate).toHaveBeenLastCalledWith(0, { timeSpentMinutes: 1499 });
    expect(screen.getByLabelText("Minutes")).toHaveValue(59);
  });

  it.each([1440, 1441])("gates Review and submit at the entry limit (%d minutes)", (minutes) => {
    const entries = [entry({ timeSpentMinutes: minutes })];
    renderForm(entries, vi.fn(), minutes);
    const reviewButton = screen.getByRole("button", { name: "Review log" });
    expect(reviewButton).toHaveProperty("disabled", minutes > 1440);
    const message = "Entry 1: max 24h per entry; add another entry for the rest";
    expect(screen.queryByText(message) !== null).toBe(minutes > 1440);
    render(
      <TimeLogReview entries={entries} allocation={validateAllocation(minutes, entries)}
        workedLabel="24h" onBack={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Submit log and check out" }))
      .toHaveProperty("disabled", minutes > 1440);
    expect(screen.queryAllByText(message)).toHaveLength(minutes > 1440 ? 2 : 0);
  });

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
