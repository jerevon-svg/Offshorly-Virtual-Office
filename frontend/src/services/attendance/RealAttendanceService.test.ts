import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RealAttendanceService,
  resetRealAttendanceServiceForTests,
  setDevIdentity,
} from "./RealAttendanceService";

describe("RealAttendanceService", () => {
  const service = new RealAttendanceService();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://backend.test/");
    resetRealAttendanceServiceForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetRealAttendanceServiceForTests();
  });

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: () => Promise.resolve(body) } as Response;
  }

  it("getMine GETs /attendance/me with the dev-email header when set", async () => {
    setDevIdentity("Bon@Example.com");
    const record = { email: "bon@example.com", status: "CHECKED_OUT", checkedInAt: null, checkedOutAt: null };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(record));
    const result = await service.getMine("bon@example.com");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://backend.test/attendance/me");
    expect((init?.headers as Headers).get("x-dev-email")).toBe("bon@example.com");
    expect(result).toEqual(record);
  });

  it("checkIn and checkOut POST to their routes", async () => {
    setDevIdentity("bon@example.com");
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ email: "bon@example.com", status: "CHECKED_IN", checkedInAt: "2026-09-04T01:00:00.000Z", checkedOutAt: null }),
    );
    await service.checkIn("bon@example.com");
    await service.checkOut("bon@example.com");
    const calls = vi.mocked(fetch).mock.calls;
    expect(String(calls[0][0])).toBe("http://backend.test/attendance/check-in");
    expect(calls[0][1]?.method).toBe("POST");
    expect(String(calls[1][0])).toBe("http://backend.test/attendance/check-out");
    expect(calls[1][1]?.method).toBe("POST");
  });

  it("rejects on a non-OK response so callers can keep the avatar outside", async () => {
    setDevIdentity("bon@example.com");
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: "nope" }, false, 500));
    await expect(service.checkIn("bon@example.com")).rejects.toThrow("nope");
  });
});
