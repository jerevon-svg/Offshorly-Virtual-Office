import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/notifications/notificationsClient", () => ({
  announceWorkHoursReached: vi.fn(),
}));
vi.mock("../../services/zoho", () => ({
  getZohoService: () => ({
    listProjects: vi.fn().mockResolvedValue([]),
    listTasks: vi.fn().mockResolvedValue([]),
    submitTimeLogs: vi.fn(),
  }),
}));

import { announceWorkHoursReached } from "../../services/notifications/notificationsClient";
import { useCheckoutFlow } from "./useCheckoutFlow";

// The 8h reminder lifecycle, driven through the EXISTING hook: initial card + ONE bell entry at
// the threshold, "Later" snoozes 30 minutes and comes back as a follow-up that creates no second
// bell entry, and starting checkout resolves the reminder.

const EIGHT_HOURS_MS = 8 * 60 * 60_000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T10:00:00.000Z"));
  vi.mocked(announceWorkHoursReached).mockReset();
  vi.mocked(announceWorkHoursReached).mockResolvedValue({ created: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function mount(timeInMs: number) {
  return renderHook(() => useCheckoutFlow({ employeeId: "e1", hourDecimal: 18, timeInMs }));
}

describe("useCheckoutFlow — 8h reminder lifecycle", () => {
  it("stays quiet below 8 hours", () => {
    const { result } = mount(Date.now() - EIGHT_HOURS_MS + 60_000);
    expect(result.current.reminderVisible).toBe(false);
    expect(announceWorkHoursReached).not.toHaveBeenCalled();
  });

  it("shows the initial card at 8h and asks for exactly one bell entry, keyed to the work date", () => {
    const { result } = mount(Date.now() - EIGHT_HOURS_MS);
    expect(result.current.reminderVisible).toBe(true);
    expect(result.current.reminderFollowUp).toBe(false);
    expect(announceWorkHoursReached).toHaveBeenCalledTimes(1);
    expect(announceWorkHoursReached).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("Later hides the card, brings it back 30 minutes later as a follow-up, with no second bell entry", () => {
    const { result } = mount(Date.now() - EIGHT_HOURS_MS);
    act(() => result.current.dismissReminderForLater());
    expect(result.current.reminderVisible).toBe(false);
    expect(result.current.state).toBe("IDLE");

    act(() => {
      vi.advanceTimersByTime(29 * 60_000);
    });
    expect(result.current.reminderVisible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(result.current.reminderVisible).toBe(true);
    expect(result.current.reminderFollowUp).toBe(true);
    expect(result.current.workedLabel).toBe("8h 31m");
    expect(announceWorkHoursReached).toHaveBeenCalledTimes(1);
  });

  it("Start checkout resolves the reminder and no follow-up fires while the flow is live", () => {
    const { result } = mount(Date.now() - EIGHT_HOURS_MS);
    act(() => result.current.startCheckout());
    expect(result.current.state).toBe("CHECKOUT_CONFIRMATION");
    expect(result.current.reminderVisible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(result.current.reminderVisible).toBe(false);
    expect(announceWorkHoursReached).toHaveBeenCalledTimes(1);
  });

  it("a rejected announce never breaks the card", () => {
    vi.mocked(announceWorkHoursReached).mockRejectedValue(new Error("offline"));
    const { result } = mount(Date.now() - EIGHT_HOURS_MS);
    expect(result.current.reminderVisible).toBe(true);
  });
});
