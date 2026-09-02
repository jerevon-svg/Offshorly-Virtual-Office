import { beforeEach, describe, expect, it, vi } from "vitest";

// T8 — the client-side executor for a CONFIRMED set_status effect. The store is
// mocked so these tests assert exactly which existing product function each
// effect is routed through (setManualStatus vs startDnd) and that nothing is
// touched when an effect cannot apply — the panel's honesty depends on that.

const store = vi.hoisted(() => ({
  setManualStatus: vi.fn(),
  startDnd: vi.fn(() => true),
  getDndAllowanceSnapshot: vi.fn(() => ({
    usedMs: 0,
    remainingMs: 3 * 60 * 60_000,
    dailyAllowanceMs: 3 * 60 * 60_000,
  })),
}));

vi.mock("../presence/selfStatusStore", () => store);

import { applyToucanStatus, canApplyToucanStatus } from "./applyAction";

describe("applyToucanStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.startDnd.mockReturnValue(true);
    store.getDndAllowanceSnapshot.mockReturnValue({
      usedMs: 0,
      remainingMs: 3 * 60 * 60_000,
      dailyAllowanceMs: 3 * 60 * 60_000,
    });
  });

  it("routes a plain status through setManualStatus, exactly like the StatusPicker", () => {
    const result = applyToucanStatus({ status: "BUSY" });
    expect(result.ok).toBe(true);
    expect(store.setManualStatus).toHaveBeenCalledWith("BUSY");
    expect(store.startDnd).not.toHaveBeenCalled();
  });

  it("routes DND through startDnd with the confirmed duration, so the allowance policy stays authoritative", () => {
    const result = applyToucanStatus({ status: "DND", dndMinutes: 45 });
    expect(result.ok).toBe(true);
    expect(store.startDnd).toHaveBeenCalledWith({
      durationMs: 45 * 60_000,
      reason: "Set via Toucan",
    });
    expect(store.setManualStatus).not.toHaveBeenCalled();
  });

  it("refuses DND before touching anything when the daily allowance is exhausted", () => {
    store.getDndAllowanceSnapshot.mockReturnValue({
      usedMs: 3 * 60 * 60_000,
      remainingMs: 0,
      dailyAllowanceMs: 3 * 60 * 60_000,
    });
    expect(canApplyToucanStatus({ status: "DND", dndMinutes: 30 }).ok).toBe(false);
    const result = applyToucanStatus({ status: "DND", dndMinutes: 30 });
    expect(result.ok).toBe(false);
    expect(store.startDnd).not.toHaveBeenCalled();
    expect(store.setManualStatus).not.toHaveBeenCalled();
  });

  it("reports failure honestly when startDnd itself declines", () => {
    store.startDnd.mockReturnValue(false);
    const result = applyToucanStatus({ status: "DND", dndMinutes: 30 });
    expect(result.ok).toBe(false);
  });

  it("refuses a status outside the manual vocabulary without touching the store", () => {
    const result = applyToucanStatus({ status: "IN_CALL" });
    expect(result.ok).toBe(false);
    expect(store.setManualStatus).not.toHaveBeenCalled();
    expect(store.startDnd).not.toHaveBeenCalled();
  });
});
