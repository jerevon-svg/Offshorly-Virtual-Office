import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiUrl, getAuthToken, HOME_PATH, LOGIN_PATH } from "./client";

describe("apiUrl", () => {
  beforeEach(() => {
    import.meta.env.VITE_API_URL = "https://atlas-api.offshorly.com";
  });

  it("builds an absolute URL from VITE_API_URL + path", () => {
    expect(apiUrl("/api/v1/auth/me")).toBe("https://atlas-api.offshorly.com/api/v1/auth/me");
  });

  it("never returns a relative path", () => {
    const result = apiUrl("/api/v1/auth/me");
    expect(result.startsWith("http")).toBe(true);
  });

  it("joins slashes correctly regardless of trailing/leading slashes", () => {
    import.meta.env.VITE_API_URL = "https://atlas-api.offshorly.com/";
    expect(apiUrl("/api/v1/auth/me")).toBe("https://atlas-api.offshorly.com/api/v1/auth/me");
    expect(apiUrl("api/v1/auth/me")).toBe("https://atlas-api.offshorly.com/api/v1/auth/me");
  });

  it("throws a clear error when VITE_API_URL is unset", () => {
    import.meta.env.VITE_API_URL = "";
    expect(() => apiUrl("/api/v1/auth/me")).toThrow(/VITE_API_URL/);
  });
});

describe("LOGIN_PATH / HOME_PATH", () => {
  it("are un-prefixed Atlas-origin paths, not /virtual-office-prefixed", () => {
    expect(LOGIN_PATH).toBe("/login");
    expect(HOME_PATH).toBe("/");
  });
});

describe("getAuthToken", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads the token from localStorage", () => {
    window.localStorage.setItem("token", "abc123");
    expect(getAuthToken()).toBe("abc123");
  });

  it("returns null when no token is present", () => {
    expect(getAuthToken()).toBeNull();
  });
});

describe("apiFetch", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    import.meta.env.VITE_API_URL = "https://atlas-api.offshorly.com";
    window.localStorage.clear();
    // checkout:* keys must survive auth clearing — plant one to assert against.
    window.localStorage.setItem("checkout:emp1:2026-08-07:draft", '{"entries":[]}');

    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, href: "https://atlas.offshorly.com/virtual-office" },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.unstubAllGlobals();
  });

  it("redirects to /login when no token is present", async () => {
    await expect(apiFetch("/api/v1/auth/me")).rejects.toThrow();
    expect(window.location.href).toBe(LOGIN_PATH);
  });

  it("sets Authorization: Bearer <token> from localStorage", async () => {
    window.localStorage.setItem("token", "my-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/auth/me");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer my-token");
  });

  it("preserves caller-supplied headers alongside Authorization", async () => {
    window.localStorage.setItem("token", "my-token");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/auth/me", { headers: { "X-Custom": "1" } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("X-Custom")).toBe("1");
    expect(headers.get("Authorization")).toBe("Bearer my-token");
  });

  it("on 401: clears only token and user, leaves checkout:* keys intact, redirects to /login", async () => {
    window.localStorage.setItem("token", "stale-token");
    window.localStorage.setItem("user", '{"id":"1"}');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/v1/auth/me");

    expect(window.localStorage.getItem("token")).toBeNull();
    expect(window.localStorage.getItem("user")).toBeNull();
    expect(window.localStorage.getItem("checkout:emp1:2026-08-07:draft")).toBe('{"entries":[]}');
    expect(window.location.href).toBe(LOGIN_PATH);
  });
});
