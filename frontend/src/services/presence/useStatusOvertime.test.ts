import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStatusOvertime } from "./useStatusOvertime";
import { resetSelfStatusForTests, setManualStatus } from "./selfStatusStore";

const BREAK_LIMIT_MS = 15 * 60_000;

describe("useStatusOvertime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSelfStatusForTests();
  });

  afterEach(() => {
    resetSelfStatusForTests();
    vi.useRealTimers();
  });

  it("does not fire before the limit is reached", () => {
    setManualStatus("BREAK");
    const { result } = renderHook(() => useStatusOvertime());

    act(() => {
      vi.advanceTimersByTime(BREAK_LIMIT_MS - 60_000);
    });

    expect(result.current.overtime).toBeNull();
  });

  it("fires at exactly the limit boundary (overMs === 0)", () => {
    setManualStatus("BREAK");
    const { result } = renderHook(() => useStatusOvertime());

    act(() => {
      vi.advanceTimersByTime(BREAK_LIMIT_MS);
    });

    expect(result.current.overtime).not.toBeNull();
    expect(result.current.overtime?.status).toBe("BREAK");
    expect(result.current.overtime?.overMs).toBeGreaterThanOrEqual(0);
  });

  it("reports the correct overMs once past the limit", () => {
    setManualStatus("BREAK");
    const { result } = renderHook(() => useStatusOvertime());

    act(() => {
      vi.advanceTimersByTime(BREAK_LIMIT_MS + 3 * 60_000);
    });

    expect(result.current.overtime).not.toBeNull();
    expect(result.current.overtime?.overMs).toBeGreaterThanOrEqual(3 * 60_000);
  });

  it("dismiss() suppresses the popup, then it re-fires after the 5-minute snooze while still over", () => {
    setManualStatus("BREAK");
    const { result } = renderHook(() => useStatusOvertime());

    act(() => {
      vi.advanceTimersByTime(BREAK_LIMIT_MS + 15_000);
    });
    expect(result.current.overtime).not.toBeNull();

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.overtime).toBeNull();

    // Still within the 5-minute snooze window — stays suppressed.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.overtime).toBeNull();

    // Past the 5-minute snooze window, still on Break/over the limit —
    // re-fires.
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(result.current.overtime).not.toBeNull();
  });

  it("fully clears state when manualStatus changes away from BREAK/LUNCH before firing", () => {
    setManualStatus("BREAK");
    const { result, rerender } = renderHook(() => useStatusOvertime());

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.overtime).toBeNull();

    act(() => {
      setManualStatus("AVAILABLE");
    });
    rerender();

    act(() => {
      vi.advanceTimersByTime(BREAK_LIMIT_MS + 60_000);
    });
    expect(result.current.overtime).toBeNull();
  });

  it("fully clears state when manualStatus changes away from BREAK/LUNCH after firing", () => {
    setManualStatus("BREAK");
    const { result, rerender } = renderHook(() => useStatusOvertime());

    act(() => {
      vi.advanceTimersByTime(BREAK_LIMIT_MS + 60_000);
    });
    expect(result.current.overtime).not.toBeNull();

    act(() => {
      setManualStatus("AVAILABLE");
    });
    rerender();

    expect(result.current.overtime).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.overtime).toBeNull();
  });
});
