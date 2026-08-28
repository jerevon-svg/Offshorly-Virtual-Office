import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusPicker } from "./StatusPicker";
import { resetSelfStatusForTests, setManualStatus } from "../../services/presence/selfStatusStore";

describe("StatusPicker", () => {
  beforeEach(() => {
    resetSelfStatusForTests();
  });

  afterEach(() => {
    resetSelfStatusForTests();
  });

  it("offers all 5 manual statuses including DND when checked in", () => {
    render(<StatusPicker checkedIn />);
    const select = screen.getByLabelText("Set your status") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain("DND");
  });

  it("hides the DND option when not checked in (feature spec section 16)", () => {
    render(<StatusPicker checkedIn={false} />);
    const select = screen.getByLabelText("Set your status") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain("DND");
    // The other 4 statuses stay untouched.
    expect(values).toEqual(expect.arrayContaining(["AVAILABLE", "BUSY", "BREAK", "LUNCH"]));
  });

  it("selecting DND opens the duration popover instead of setting status immediately", () => {
    render(<StatusPicker checkedIn />);
    const select = screen.getByLabelText("Set your status") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "DND" } });

    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText("1 hour")).toBeInTheDocument();
    expect(screen.getByText("2 hours")).toBeInTheDocument();
  });

  it("picking a duration starts DND and shows the countdown chip", () => {
    render(<StatusPicker checkedIn />);
    fireEvent.change(screen.getByLabelText("Set your status"), { target: { value: "DND" } });
    fireEvent.click(screen.getByText("30 min"));

    expect(screen.getByText(/DND/)).toBeInTheDocument();
    expect(screen.getByLabelText("Cancel DND")).toBeInTheDocument();
  });

  it("cancelling DND restores the select with the previous status", () => {
    setManualStatus("BUSY");
    render(<StatusPicker checkedIn />);
    fireEvent.change(screen.getByLabelText("Set your status"), { target: { value: "DND" } });
    fireEvent.click(screen.getByText("1 hour"));
    expect(screen.getByLabelText("Cancel DND")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Cancel DND"));

    const select = screen.getByLabelText("Set your status") as HTMLSelectElement;
    expect(select.value).toBe("BUSY");
  });

  it("shows the exhausted-allowance message and a disabled Request Extended DND action once the daily allowance is used up", async () => {
    // dndUsedTodayMs lives as module-level in-memory state, synced from localStorage only at
    // module-load time (or on a day rollover) — reload both modules via resetModules so the
    // freshly re-imported StatusPicker resolves against a freshly re-imported store that
    // actually reads the localStorage value set below, same pattern selfStatusStore.test.ts
    // uses for its own reload-simulation tests.
    const d = new Date();
    const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    window.localStorage.setItem("office.dndUsageDay", todayKey);
    window.localStorage.setItem("office.dndUsedTodayMs", String(3 * 60 * 60_000));

    vi.resetModules();
    const { StatusPicker: ReloadedStatusPicker } = await import("./StatusPicker");

    render(<ReloadedStatusPicker checkedIn />);
    fireEvent.change(screen.getByLabelText("Set your status"), { target: { value: "DND" } });

    expect(screen.getByText(/used your normal DND focus time for today/i)).toBeInTheDocument();
    const extendedButton = screen.getByText("Request Extended DND");
    expect(extendedButton).toBeDisabled();
  });
});
