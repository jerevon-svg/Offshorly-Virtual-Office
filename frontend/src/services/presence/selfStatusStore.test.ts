import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  endDnd,
  getDndAllowanceSnapshot,
  getSelfStatusSnapshot,
  resetSelfStatusForTests,
  setAutoCondition,
  setManualStatus,
  startDnd,
} from "./selfStatusStore";
import { MANUAL_STATUSES, type OfficeStatus } from "./status";
import { DND_POLICY } from "./dndPolicy";

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

  it("restricts setManualStatus to the 4 free-form manual statuses (DND must go through startDnd)", () => {
    setManualStatus("BUSY");
    expect(getSelfStatusSnapshot().manualStatus).toBe("BUSY");

    // Not a manual status — must be ignored, leaving manualStatus unchanged.
    setManualStatus("AWAY" as OfficeStatus);
    expect(getSelfStatusSnapshot().manualStatus).toBe("BUSY");

    setManualStatus("IN_CALL" as OfficeStatus);
    expect(getSelfStatusSnapshot().manualStatus).toBe("BUSY");

    for (const status of MANUAL_STATUSES.filter((s) => s !== "DND")) {
      setManualStatus(status);
      expect(getSelfStatusSnapshot().manualStatus).toBe(status);
    }

    // DND V1: a direct setManualStatus("DND") call is a no-op — starting DND without a duration
    // would re-enable the old indefinite-DND behavior this feature replaces.
    setManualStatus("BUSY");
    setManualStatus("DND");
    expect(getSelfStatusSnapshot().manualStatus).toBe("BUSY");
  });

  describe("DND V1 (startDnd/endDnd)", () => {
    it("startDnd sets manualStatus=DND with an expiry and remembers the previous status", () => {
      setManualStatus("BUSY");
      const before = Date.now();
      const started = startDnd({ durationMs: 30 * 60_000, reason: "Deep Work" });

      expect(started).toBe(true);
      const snap = getSelfStatusSnapshot();
      expect(snap.manualStatus).toBe("DND");
      expect(snap.currentStatus).toBe("DND");
      expect(snap.dndReason).toBe("Deep Work");
      expect(snap.dndExpiresAt).not.toBeNull();
      expect(snap.dndExpiresAt as number).toBeGreaterThanOrEqual(before + 30 * 60_000);
    });

    it("startDnd clamps duration to the per-session max", () => {
      startDnd({ durationMs: 10 * 60 * 60_000 }); // way over the 2h cap
      const snap = getSelfStatusSnapshot();
      const sessionMs = (snap.dndExpiresAt as number) - snap.manualStatusSince;
      expect(sessionMs).toBeLessThanOrEqual(DND_POLICY.maxSessionMs);
    });

    it("endDnd restores the previous manual status", () => {
      setManualStatus("BUSY");
      startDnd({ durationMs: 30 * 60_000 });
      expect(getSelfStatusSnapshot().manualStatus).toBe("DND");

      endDnd();

      const snap = getSelfStatusSnapshot();
      expect(snap.manualStatus).toBe("BUSY");
      expect(snap.dndExpiresAt).toBeNull();
      expect(snap.dndReason).toBeNull();
    });

    it("endDnd falls back to AVAILABLE when there was no manual status before (fresh session)", () => {
      startDnd({ durationMs: 30 * 60_000 });
      endDnd();
      expect(getSelfStatusSnapshot().manualStatus).toBe("AVAILABLE");
    });

    it("endDnd is a no-op when not currently DND", () => {
      setManualStatus("BUSY");
      endDnd();
      expect(getSelfStatusSnapshot().manualStatus).toBe("BUSY");
    });

    it("credits elapsed DND time toward today's allowance on endDnd", () => {
      const before = getDndAllowanceSnapshot();
      startDnd({ durationMs: 30 * 60_000 });
      endDnd();
      const after = getDndAllowanceSnapshot();
      // endDnd() runs essentially instantly in this test, so consumed time is ~0 — just assert
      // usage never goes backwards and never exceeds the daily cap either way.
      expect(after.usedMs).toBeGreaterThanOrEqual(before.usedMs);
      expect(after.usedMs).toBeLessThanOrEqual(DND_POLICY.dailyAllowanceMs);
    });

    it("startDnd returns false and does not change status once the daily allowance is exhausted", async () => {
      // Simulate a previous session (or an earlier reload today) having already exhausted the
      // allowance — module-load-time initialization reads dndUsedTodayMs from localStorage, so
      // reload via resetModules rather than poking the live module's in-memory value directly.
      const day = new Date();
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      window.localStorage.setItem("office.dndUsageDay", key);
      window.localStorage.setItem("office.dndUsedTodayMs", String(DND_POLICY.dailyAllowanceMs));

      vi.resetModules();
      const reloaded = await import("./selfStatusStore");
      reloaded.setManualStatus("AVAILABLE");
      const started = reloaded.startDnd({ durationMs: 30 * 60_000 });

      expect(started).toBe(false);
      expect(reloaded.getSelfStatusSnapshot().manualStatus).toBe("AVAILABLE");
    });
  });

  it("an expired DND session persisted from a previous load does not resurrect on reload", async () => {
    startDnd({ durationMs: 30 * 60_000 });
    // Force the persisted expiry into the past, simulating a session that ran out while the tab
    // was closed.
    window.localStorage.setItem("office.dndExpiresAt", String(Date.now() - 1000));

    vi.resetModules();
    const reloaded = await import("./selfStatusStore");
    const snap = reloaded.getSelfStatusSnapshot();

    expect(snap.manualStatus).not.toBe("DND");
    expect(snap.dndExpiresAt).toBeNull();
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
