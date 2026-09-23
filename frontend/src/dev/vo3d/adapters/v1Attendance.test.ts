// Phase 5 — V1's attendance as the ONE authority, and the freshness rules around it.
//
// The point of these cases is what the adapter must NOT do: invent a status, treat a network failure as a
// checkout, need socket traffic in order to notice a change, run two requests at once, or keep listening
// after the route is gone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMine = vi.fn();
vi.mock("../../../services/attendance", () => ({
  attendanceService: { getMine: (id: string) => getMine(id), checkIn: vi.fn(), checkOut: vi.fn() },
}));

import { accessForStatus, FOCUS_MIN_GAP_MS, REFRESH_MS, useV1OfficeAccess } from "./v1Attendance";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import { __resetCurrentUserIdForTest } from "../../../auth/useAuthGate";

function signIn(email = "jerevon@offshorly.com") {
  setCurrentUserFromMeResponse({ id: "atlas-1", email, full_name: "Bon", role: "dev", team: null });
}
const checkedIn = () => getMine.mockResolvedValue({ status: "CHECKED_IN" });
const checkedOut = () => getMine.mockResolvedValue({ status: "CHECKED_OUT" });
/** A deferred read, so a test can hold one in flight. */
function deferred() {
  let settle: (v: unknown) => void = () => {};
  let fail: (e: unknown) => void = () => {};
  getMine.mockReturnValue(new Promise((res, rej) => { settle = res; fail = rej; }));
  return { settle: (v: unknown) => settle(v), fail: (e: unknown) => fail(e) };
}
/** The focus floor is measured with Date.now(), so tests move the clock rather than waiting. */
let clock = 1_000_000;
const advanceClock = (ms: number) => { clock += ms; };
const pastFocusGap = () => advanceClock(FOCUS_MIN_GAP_MS + 1);
const visibility = (state: "visible" | "hidden") =>
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });

beforeEach(() => {
  getMine.mockReset();
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  visibility("visible");
  resetCurrentUserForTests();
  __resetCurrentUserIdForTest();
});
afterEach(() => {
  resetCurrentUserForTests();
  __resetCurrentUserIdForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("accessForStatus", () => {
  it("opens the office for CHECKED_IN and closes it for CHECKED_OUT", () => {
    expect(accessForStatus("CHECKED_IN")).toBe("permitted");
    expect(accessForStatus("CHECKED_OUT")).toBe("denied");
  });

  it("answers `unknown` for anything else, rather than guessing either way", () => {
    // A guess in one direction seals a checked-in employee out of their own office; a guess in the other
    // is the bypass. `unknown` shuts the gate without moving anybody — see app/access.ts.
    expect(accessForStatus(null)).toBe("unknown");
    expect(accessForStatus(undefined)).toBe("unknown");
    expect(accessForStatus("SOMETHING_NEW")).toBe("unknown");
  });
});

describe("the first read", () => {
  it("asks nobody when V1 could not identify the session", () => {
    const { result } = renderHook(() => useV1OfficeAccess("k"));
    expect(result.current).toBe("unknown");
    expect(getMine).not.toHaveBeenCalled();
  });

  it("starts unknown and settles on V1's answer", async () => {
    signIn();
    checkedIn();
    const { result } = renderHook(() => useV1OfficeAccess("k"));
    expect(result.current).toBe("unknown");
    await waitFor(() => expect(result.current).toBe("permitted"));
    expect(getMine).toHaveBeenCalledTimes(1);
  });

  it("stays unknown — fail-closed — when the very first read fails", async () => {
    signIn();
    getMine.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useV1OfficeAccess("k"));
    await waitFor(() => expect(getMine).toHaveBeenCalled());
    expect(result.current).toBe("unknown");
  });
});

describe("noticing a change WITHOUT any socket traffic", () => {
  // The offline-lineup broadcast is a doorbell, not the mechanism. These are the paths that work when it
  // never arrives — a transition that happened while this client's socket was down.
  it("re-reads on window focus", async () => {
    signIn();
    checkedIn();
    const { result } = renderHook(() => useV1OfficeAccess("k"));
    await waitFor(() => expect(result.current).toBe("permitted"));
    checkedOut();
    pastFocusGap();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(result.current).toBe("denied"));
  });

  it("FLOORS the focus path, so alt-tabbing cannot turn into a request per keystroke", async () => {
    // A browser fires `focus` for window focus as well as tab focus, and the OS moves focus around on its
    // own — a two-session run showed reads arriving from nothing else. The doorbell and the interval are
    // deliberately NOT floored, so a real check-out is unaffected.
    signIn();
    checkedIn();
    renderHook(() => useV1OfficeAccess("k"));
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 8; i++) window.dispatchEvent(new Event("focus"));
    expect(getMine).toHaveBeenCalledTimes(1);
    pastFocusGap();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(2));
  });

  it("re-reads when a hidden tab becomes visible, and not when it goes hidden", async () => {
    signIn();
    checkedIn();
    const { result } = renderHook(() => useV1OfficeAccess("k"));
    await waitFor(() => expect(result.current).toBe("permitted"));
    expect(getMine).toHaveBeenCalledTimes(1);

    pastFocusGap();
    visibility("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(getMine).toHaveBeenCalledTimes(1); // going away costs nothing

    checkedOut();
    visibility("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(result.current).toBe("denied"));
  });

  it("re-reads on the bounded interval, but only while the tab is visible", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    signIn();
    checkedIn();
    const { result } = renderHook(() => useV1OfficeAccess("k"));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe("permitted");

    visibility("hidden");
    await act(async () => { advanceClock(REFRESH_MS * 3); await vi.advanceTimersByTimeAsync(REFRESH_MS * 3); });
    expect(getMine).toHaveBeenCalledTimes(1); // a backgrounded preview polls nothing at all

    visibility("visible");
    checkedOut();
    await act(async () => { advanceClock(REFRESH_MS); await vi.advanceTimersByTimeAsync(REFRESH_MS); });
    expect(result.current).toBe("denied");
  });

  it("re-reads when the lineup doorbell rings, and never answers from the doorbell itself", async () => {
    signIn();
    checkedIn();
    const { result, rerender } = renderHook(({ k }: { k: string }) => useV1OfficeAccess(k), {
      initialProps: { k: "a" },
    });
    await waitFor(() => expect(result.current).toBe("permitted"));
    checkedOut();
    // Deliberately with no delay at all: the doorbell is the attendance-triggered path and is NOT floored,
    // so a confirmed check-out revokes access in one round trip even though the mount read just happened.
    rerender({ k: "b" });
    await waitFor(() => expect(result.current).toBe("denied"));
    expect(getMine).toHaveBeenCalledTimes(2);
  });

  it("reads exactly once at mount, not twice for the initial refresh key", async () => {
    signIn();
    checkedIn();
    renderHook(() => useV1OfficeAccess("k"));
    await waitFor(() => expect(getMine).toHaveBeenCalled());
    expect(getMine).toHaveBeenCalledTimes(1);
  });
});

describe("failure and recovery", () => {
  it("KEEPS the last answer V1 gave when a refresh fails — a blip is not a checkout", async () => {
    signIn();
    checkedIn();
    const { result } = renderHook(() => useV1OfficeAccess("k"));
    await waitFor(() => expect(result.current).toBe("permitted"));
    getMine.mockRejectedValue(new Error("network"));
    pastFocusGap();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(2));
    expect(result.current).toBe("permitted");
  });

  it("recovers on the next successful read, including a change that happened during the outage", async () => {
    signIn();
    checkedIn();
    const { result } = renderHook(() => useV1OfficeAccess("k"));
    await waitFor(() => expect(result.current).toBe("permitted"));
    getMine.mockRejectedValue(new Error("network"));
    pastFocusGap();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(2));
    checkedOut();
    pastFocusGap();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(result.current).toBe("denied"));
  });
});

describe("one request at a time", () => {
  it("does not start a second read while one is in flight, and honours the trigger afterwards", async () => {
    signIn();
    const first = deferred();
    const { rerender } = renderHook(({ k }: { k: string }) => useV1OfficeAccess(k), { initialProps: { k: "a" } });
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));

    // Three triggers land while the first read is still open.
    await act(async () => {
      rerender({ k: "b" });
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getMine).toHaveBeenCalledTimes(1); // still just the one

    checkedIn();
    await act(async () => { first.settle({ status: "CHECKED_OUT" }); await Promise.resolve(); });
    // ...and the burst collapses into exactly ONE follow-up read, not three.
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(2));
  });

  it("never lets a slow answer overwrite a newer one", async () => {
    signIn();
    const slow = deferred();
    const { result, rerender } = renderHook(({ k }: { k: string }) => useV1OfficeAccess(k), { initialProps: { k: "a" } });
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));
    // Let the slow read finish as CHECKED_IN, which queues the coalesced follow-up...
    checkedOut();
    await act(async () => { rerender({ k: "b" }); slow.settle({ status: "CHECKED_IN" }); await Promise.resolve(); });
    // ...and the follow-up's newer answer is the one that stands.
    await waitFor(() => expect(result.current).toBe("denied"));
  });
});

describe("unmount", () => {
  it("drops an answer that lands after unmount", async () => {
    signIn();
    const d = deferred();
    const { unmount } = renderHook(() => useV1OfficeAccess("k"));
    await waitFor(() => expect(getMine).toHaveBeenCalledTimes(1));
    unmount();
    // No state update after unmount: React would warn, and the answer belongs to a route that is gone.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { d.settle({ status: "CHECKED_IN" }); await Promise.resolve(); });
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops listening and stops polling", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    signIn();
    checkedIn();
    const { unmount } = renderHook(() => useV1OfficeAccess("k"));
    await act(async () => { await Promise.resolve(); });
    expect(getMine).toHaveBeenCalledTimes(1);
    unmount();
    pastFocusGap();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      advanceClock(REFRESH_MS * 3);
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    });
    expect(getMine).toHaveBeenCalledTimes(1);
  });
});
