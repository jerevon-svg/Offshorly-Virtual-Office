import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaleSessionRecovery } from "./StaleSessionRecovery";

const { recoverStaleSession, getMine } = vi.hoisted(() => ({ recoverStaleSession: vi.fn(), getMine: vi.fn() }));
vi.mock("../../../services/attendance", () => ({ attendanceService: { recoverStaleSession, getMine } }));
afterEach(() => vi.restoreAllMocks());

const record = { email: "a@example.com", status: "CHECKED_OUT" as const, checkedInAt: "2026-09-25T18:55:49Z", checkedOutAt: "2026-10-10T00:00:00Z" };

describe("StaleSessionRecovery", () => {
  it("requires confirmation, prevents duplicate requests and applies only the confirmed record", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    let resolve!: (value: typeof record) => void;
    recoverStaleSession.mockReset().mockReturnValue(new Promise((done) => { resolve = done; }));
    const onRecovered = vi.fn();
    render(<StaleSessionRecovery employeeId={record.email} checkedInAt={record.checkedInAt} onRecovered={onRecovered} onRefresh={vi.fn()} />);
    const button = screen.getByRole("button", { name: "End old session without time log" });
    fireEvent.click(button);
    expect(recoverStaleSession).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(recoverStaleSession).toHaveBeenCalledExactlyOnceWith(record.email, record.checkedInAt);
    expect(onRecovered).not.toHaveBeenCalled();
    await act(async () => resolve(record));
    expect(onRecovered).toHaveBeenCalledWith(record);
  });

  it("shows a failure and refreshes attendance without reporting success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    recoverStaleSession.mockRejectedValue(new Error("Attendance changed"));
    getMine.mockResolvedValue(record);
    const onRecovered = vi.fn();
    const onRefresh = vi.fn();
    render(<StaleSessionRecovery employeeId={record.email} checkedInAt={record.checkedInAt} onRecovered={onRecovered} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "End old session without time log" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledWith(record));
    expect(screen.getByRole("alert").textContent).toBe("Attendance changed");
    expect(onRecovered).not.toHaveBeenCalled();
  });
});
