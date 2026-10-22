import { afterEach, describe, expect, it, vi } from "vitest";
import { MockAttendanceService, resetMockAttendanceForTests } from "./MockAttendanceService";

describe("MockAttendanceService", () => {
  const id = "bon@example.com";
  afterEach(() => resetMockAttendanceForTests(id));

  it("reads CHECKED_OUT with null timestamps when nothing is recorded", async () => {
    expect(await new MockAttendanceService().getMine(id)).toEqual({
      email: id,
      status: "CHECKED_OUT",
      checkedInAt: null,
      checkedOutAt: null,
    });
  });

  it("persists a check-in across service instances (refresh / reopen)", async () => {
    const first = await new MockAttendanceService().checkIn(id);
    expect(first.status).toBe("CHECKED_IN");
    const again = await new MockAttendanceService().getMine(id);
    expect(again.status).toBe("CHECKED_IN");
    expect(again.checkedInAt).toBe(first.checkedInAt);
    // Idempotent: a second check-in keeps the original start.
    expect((await new MockAttendanceService().checkIn(id)).checkedInAt).toBe(first.checkedInAt);
  });

  it("check-out ends the session and survives a reload", async () => {
    const service = new MockAttendanceService();
    await service.checkIn(id);
    const out = await service.checkOut(id);
    expect(out.status).toBe("CHECKED_OUT");
    expect(out.checkedOutAt).not.toBeNull();
    expect((await new MockAttendanceService().getMine(id)).status).toBe("CHECKED_OUT");
  });
  it("recovers only the old session, then permits a separate fresh check-in", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-25T18:55:49Z"));
      const service = new MockAttendanceService();
      const old = await service.checkIn(id);
      await expect(service.recoverStaleSession(id, old.checkedInAt!)).rejects.toThrow("not stale");
      vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
      const out = await service.recoverStaleSession(id, old.checkedInAt!);
      expect(out.status).toBe("CHECKED_OUT");
      expect(out.checkedInAt).toBe(old.checkedInAt);
      expect(await service.recoverStaleSession(id, old.checkedInAt!)).toEqual(out);
      const fresh = await service.checkIn(id);
      expect(fresh.checkedInAt).toBe("2026-10-10T00:00:00.000Z");
      await expect(service.recoverStaleSession(id, old.checkedInAt!)).rejects.toThrow("Attendance changed");
      expect(await service.getMine(id)).toEqual(fresh);
    } finally {
      vi.useRealTimers();
    }
  });

});
