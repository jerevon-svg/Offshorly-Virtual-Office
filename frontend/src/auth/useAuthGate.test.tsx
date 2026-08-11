import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useAuthGate, getCurrentUserId, __resetCurrentUserIdForTest } from "./useAuthGate";
import { HOME_PATH, LOGIN_PATH } from "../services/api/client";

function GateProbe() {
  const status = useAuthGate();
  return <div data-testid="status">{status}</div>;
}

describe("useAuthGate", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // currentUserId is a module-level singleton in useAuthGate.ts; reset it
    // so one test's resolved id can never leak into the next test's
    // assertions (order-independence).
    __resetCurrentUserIdForTest();
    import.meta.env.VITE_API_URL = "https://atlas-api.offshorly.com";
    // Vitest loads .env.local like any Vite mode, and DEV is true here — so a
    // developer's local VITE_AUTH_GATE=off would silently bypass the gate and
    // pass every test below vacuously. Pin it off for the real-gate specs.
    import.meta.env.VITE_AUTH_GATE = "";
    window.localStorage.clear();
    window.localStorage.setItem("token", "valid-token");
    window.localStorage.setItem("user", "some-user-json");
    window.localStorage.setItem("checkout:draft", "keep-me");
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

  it("redirects to / when can_view_virtual_office is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ can_view_virtual_office: false }), { status: 200 }),
      ),
    );

    render(<GateProbe />);

    await waitFor(() => expect(window.location.href).toBe(HOME_PATH));
  });

  it("renders allowed (children path) when can_view_virtual_office is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ can_view_virtual_office: true }), { status: 200 }),
      ),
    );

    render(<GateProbe />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("allowed"));
  });

  it("treats a nested permissions.can_view_virtual_office shape as allowed too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ permissions: { can_view_virtual_office: true } }), {
          status: 200,
        }),
      ),
    );

    render(<GateProbe />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("allowed"));
  });

  it("treats a non-401 request error as unauthorized and redirects to / (not /login)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<GateProbe />);

    await waitFor(() => expect(window.location.href).toBe(HOME_PATH));
    expect(window.location.href).not.toBe(LOGIN_PATH);
  });

  it("redirects to /login (not /) when no token is present", async () => {
    window.localStorage.removeItem("token");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<GateProbe />);

    await waitFor(() => expect(window.location.href).toBe(LOGIN_PATH));
    expect(window.location.href).not.toBe(HOME_PATH);
    // apiFetch must short-circuit before ever hitting the network.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("VITE_AUTH_GATE=off allows immediately without any network call", async () => {
    import.meta.env.VITE_AUTH_GATE = "off";
    window.localStorage.removeItem("token");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<GateProbe />);

    expect(screen.getByTestId("status").textContent).toBe("allowed");
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
    // No token, yet no bounce to /login — the bypass must not redirect.
    expect(window.location.href).toBe("https://atlas.offshorly.com/virtual-office");
  });

  it("captures a top-level id from /auth/me into getCurrentUserId()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ can_view_virtual_office: true, id: "employee-42" }),
          { status: 200 },
        ),
      ),
    );

    render(<GateProbe />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("allowed"));
    expect(getCurrentUserId()).toBe("employee-42");
  });

  it("captures a numeric top-level id from /auth/me into getCurrentUserId()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ can_view_virtual_office: true, id: 42 }),
          { status: 200 },
        ),
      ),
    );

    render(<GateProbe />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("allowed"));
    expect(getCurrentUserId()).toBe("42");
  });

  it("captures an id nested under user from /auth/me into getCurrentUserId()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            can_view_virtual_office: true,
            user: { employee_id: "employee-99" },
          }),
          { status: 200 },
        ),
      ),
    );

    render(<GateProbe />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("allowed"));
    expect(getCurrentUserId()).toBe("employee-99");
  });

  it("falls back to 'bon' when /auth/me has no recognizable id field, and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ can_view_virtual_office: true }), { status: 200 }),
      ),
    );

    render(<GateProbe />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("allowed"));
    expect(getCurrentUserId()).toBe("bon");
    // Real shape mismatch (Atlas responded, gate allowed, no recognizable
    // id field) must be visible in the console, not silent.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("VITE_AUTH_GATE=off bypass path never touches currentUserId, and does not warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Seed a known, non-fallback sentinel first via the real fetch-based path
    // so this test is meaningful regardless of run order: if the bypass path
    // ever started resolving an id, this assertion would catch it.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ can_view_virtual_office: true, id: "sentinel-id" }),
          { status: 200 },
        ),
      ),
    );
    const { unmount } = render(<GateProbe />);
    await waitFor(() => expect(getCurrentUserId()).toBe("sentinel-id"));
    unmount();

    import.meta.env.VITE_AUTH_GATE = "off";
    window.localStorage.removeItem("token");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<GateProbe />);

    expect(screen.getByTestId("status").textContent).toBe("allowed");
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
    // Bypass path deliberately never touches currentUserId — it must remain
    // whatever it was seeded to above, not silently reset to "bon".
    expect(getCurrentUserId()).toBe("sentinel-id");
    // Intentional bypass, not a shape mismatch — must not warn.
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("on 401, clears only token+user, keeps checkout:* keys, and ends at /login (not /)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    render(<GateProbe />);

    await waitFor(() => expect(window.location.href).toBe(LOGIN_PATH));
    expect(window.location.href).not.toBe(HOME_PATH);
    expect(window.localStorage.getItem("token")).toBeNull();
    expect(window.localStorage.getItem("user")).toBeNull();
    expect(window.localStorage.getItem("checkout:draft")).toBe("keep-me");
  });
});
