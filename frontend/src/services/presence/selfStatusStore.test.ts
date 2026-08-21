import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSelfStatusSnapshot,
  resetSelfStatusForTests,
  setAutoCondition,
  setManualStatus,
} from "./selfStatusStore";
import { MANUAL_STATUSES, type OfficeStatus } from "./status";

describe("selfStatusStore", () => {
  beforeEach(() => {
    resetSelfStatusForTests();
  });

  afterEach(() => {
    resetSelfStatusForTests();
  });

  it("defaults to AVAILABLE when nothing is stored", () => {
    expect(getSelfStatusSnapshot().manualStatus).toBe("AVAILABLE");
    expect(getSelfStatusSnapshot().currentStatus).toBe("AVAILABLE");
  });

  it("restricts setManualStatus to the 5 manual statuses", () => {
    setManualStatus("BUSY");
    expect(getSelfStatusSnapshot().manualStatus).toBe("BUSY");

    // Not a manual status — must be ignored, leaving manualStatus unchanged.
    setManualStatus("AWAY" as OfficeStatus);
    expect(getSelfStatusSnapshot().manualStatus).toBe("BUSY");

    setManualStatus("IN_CALL" as OfficeStatus);
    expect(getSelfStatusSnapshot().manualStatus).toBe("BUSY");

    for (const status of MANUAL_STATUSES) {
      setManualStatus(status);
      expect(getSelfStatusSnapshot().manualStatus).toBe(status);
    }
  });

  it("toggles auto conditions and derives currentStatus", () => {
    setManualStatus("AVAILABLE");
    setAutoCondition("away", true);
    expect(getSelfStatusSnapshot().autoConditions.away).toBe(true);
    expect(getSelfStatusSnapshot().currentStatus).toBe("AWAY");

    setAutoCondition("away", false);
    setAutoCondition("inCall", true);
    expect(getSelfStatusSnapshot().currentStatus).toBe("IN_CALL");

    setAutoCondition("inCall", false);
    setAutoCondition("offline", true);
    expect(getSelfStatusSnapshot().currentStatus).toBe("OFFLINE");
  });

  it("persists manualStatus to localStorage across a reload", () => {
    setManualStatus("LUNCH");
    expect(window.localStorage.getItem("office.selfManualStatus")).toBe("LUNCH");
  });

  it("stamps manualStatusSince on a real transition", () => {
    const before = Date.now();
    setManualStatus("BREAK");
    const snap = getSelfStatusSnapshot();
    expect(snap.manualStatusSince).toBeGreaterThanOrEqual(before);
    expect(window.localStorage.getItem("office.selfManualStatusSince")).toBe(
      String(snap.manualStatusSince),
    );
  });

  it("does NOT restamp manualStatusSince when setting the same status again", () => {
    setManualStatus("BREAK");
    const first = getSelfStatusSnapshot().manualStatusSince;
    setManualStatus("BREAK");
    const second = getSelfStatusSnapshot().manualStatusSince;
    expect(second).toBe(first);
  });

  it("restores manualStatusSince from localStorage on a simulated reload", async () => {
    setManualStatus("LUNCH");
    const since = getSelfStatusSnapshot().manualStatusSince;

    vi.resetModules();
    const reloaded = await import("./selfStatusStore");
    expect(reloaded.getSelfStatusSnapshot().manualStatus).toBe("LUNCH");
    expect(reloaded.getSelfStatusSnapshot().manualStatusSince).toBe(since);
  });

  it("falls back manualStatusSince to now() when manualStatus is present but since is missing (migration)", async () => {
    window.localStorage.setItem("office.selfManualStatus", "BREAK");
    window.localStorage.removeItem("office.selfManualStatusSince");

    const before = Date.now();
    vi.resetModules();
    const reloaded = await import("./selfStatusStore");
    const snap = reloaded.getSelfStatusSnapshot();

    expect(snap.manualStatus).toBe("BREAK");
    expect(snap.manualStatusSince).toBeGreaterThanOrEqual(before);
    expect(window.localStorage.getItem("office.selfManualStatusSince")).toBe(
      String(snap.manualStatusSince),
    );
  });
});
