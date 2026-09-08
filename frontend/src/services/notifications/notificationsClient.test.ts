import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setDevIdentity,
} from "./notificationsClient";

describe("notificationsClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    // Seeded, because these cases assert request SHAPE (url, method, error surfacing) and the
    // client now refuses outright to issue a request with no identity at all — see
    // missingIdentity.test.ts, which owns that path. Individual cases still override it.
    setDevIdentity("tester@example.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setDevIdentity(null);
  });

  function mockJsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: () => Promise.resolve(body) } as Response;
  }

  it("GETs /notifications/me with the dev-email header when set", async () => {
    setDevIdentity("Alex@Example.com");
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ notifications: [], unreadCount: 0 }));

    await fetchNotifications();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/notifications/me");
    expect((init?.headers as Headers).get("x-dev-email")).toBe("alex@example.com");
  });

  it("POSTs a single read, url-encoding the id", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ unreadCount: 2, updated: 1 }));

    const result = await markNotificationRead("a b/c");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/notifications/a%20b%2Fc/read");
    expect(init?.method).toBe("POST");
    expect(result).toEqual({ unreadCount: 2, updated: 1 });
  });

  it("POSTs mark-all-read", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ unreadCount: 0, updated: 4 }));

    const result = await markAllNotificationsRead();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/notifications/read-all");
    expect(init?.method).toBe("POST");
    expect(result.unreadCount).toBe(0);
  });

  it("surfaces the backend's error message", async () => {
    vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ error: "Missing Authorization bearer token" }, false, 401));

    await expect(fetchNotifications()).rejects.toThrow("Missing Authorization bearer token");
  });

  // There is deliberately no create/delete function here: notifications are written only
  // server-side, from the authoritative action (see backend/app/services/notifications.py).
  it("exposes no way to create a notification from the browser", async () => {
    const client = await import("./notificationsClient");
    expect(Object.keys(client).filter((k) => /create|delete|send/i.test(k))).toEqual([]);
  });
});
