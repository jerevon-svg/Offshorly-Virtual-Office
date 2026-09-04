import { afterEach, describe, expect, it } from "vitest";
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
});
