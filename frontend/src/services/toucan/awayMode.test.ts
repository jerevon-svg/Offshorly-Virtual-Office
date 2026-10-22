import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCurrentStatus } from "../presence/status";
import { getSelfStatusSnapshot, resetSelfStatusForTests, setManualStatus } from "../presence/selfStatusStore";
import type { ToucanDelegation } from "./types";

const h = vi.hoisted(() => ({
  getDelegation: vi.fn(),
  ended: new Set<(e: { delegationId?: string | null }) => void>(),
  connected: new Set<() => void>(),
}));

vi.mock("./index", () => ({ toucanService: { getDelegation: () => h.getDelegation() } }));
vi.mock("./delegationClient", () => ({
  subscribeDelegationEnded: (cb: (e: { delegationId?: string | null }) => void) => {
    h.ended.add(cb);
    return () => h.ended.delete(cb);
  },
  subscribeToucanChannelConnected: (cb: () => void) => {
    h.connected.add(cb);
    return () => h.connected.delete(cb);
  },
}));

import { awayReturnLine, refreshAwayMode, resetAwayModeForTests, setAwayModeDelegation, useAwayMode, useAwayModeSync } from "./awayMode";

const ACTIVE: ToucanDelegation = {
  id: "d-1",
  status: "active",
  endCondition: "until_return",
  scope: "dm_and_groups",
  startsAt: "2026-10-22T01:00:00.000Z",
  expiresAt: null,
  hardCapAt: "2026-10-23T01:00:00.000Z",
  replyCount: 0,
};

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

beforeEach(() => {
  resetSelfStatusForTests();
  resetAwayModeForTests();
  h.getDelegation.mockReset().mockResolvedValue(null);
  h.ended.clear();
  h.connected.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("status precedence with Away Mode", () => {
  const base = { away: false, inConversation: false, inCall: false, offline: false };
  it("delegated reads as AWAY over a manual status", () => {
    expect(resolveCurrentStatus("BUSY", { ...base, delegated: true })).toBe("AWAY");
  });
  it("DND, calls, meetings and Offline still win", () => {
    expect(resolveCurrentStatus("DND", { ...base, delegated: true })).toBe("DND");
    expect(resolveCurrentStatus("AVAILABLE", { ...base, inCall: true, delegated: true })).toBe("IN_CALL");
    expect(resolveCurrentStatus("AVAILABLE", { ...base, inMeeting: true, delegated: true })).toBe("IN_MEETING");
    expect(resolveCurrentStatus("AVAILABLE", { ...base, offline: true, delegated: true })).toBe("OFFLINE");
  });
});

describe("awayMode mirror", () => {
  it("loads the server's active delegation on mount and reads as Away without touching the manual status", async () => {
    setManualStatus("LUNCH");
    h.getDelegation.mockResolvedValue(ACTIVE);
    const { result } = renderHook(() => {
      useAwayModeSync();
      return useAwayMode();
    });
    await flush();
    expect(result.current?.id).toBe("d-1");
    expect(getSelfStatusSnapshot().currentStatus).toBe("AWAY");
    expect(getSelfStatusSnapshot().manualStatus).toBe("LUNCH");
  });

  it("delegation_ended clears Away and the previous status returns", async () => {
    setManualStatus("BUSY");
    h.getDelegation.mockResolvedValue(ACTIVE);
    renderHook(() => useAwayModeSync());
    await flush();
    // An event about an older delegation is ignored.
    act(() => h.ended.forEach((cb) => cb({ delegationId: "d-0" })));
    expect(getSelfStatusSnapshot().currentStatus).toBe("AWAY");
    act(() => h.ended.forEach((cb) => cb({ delegationId: "d-1" })));
    expect(getSelfStatusSnapshot().currentStatus).toBe("BUSY");
  });

  it("a reconnect re-reads the server, so a delegation started or ended elsewhere is picked up", async () => {
    renderHook(() => useAwayModeSync());
    await flush();
    expect(getSelfStatusSnapshot().currentStatus).not.toBe("AWAY");
    h.getDelegation.mockResolvedValue(ACTIVE);
    act(() => h.connected.forEach((cb) => cb()));
    await flush();
    expect(getSelfStatusSnapshot().currentStatus).toBe("AWAY");
  });

  it("another tab's change (storage ping) triggers a re-read", async () => {
    renderHook(() => useAwayModeSync());
    await flush();
    h.getDelegation.mockResolvedValue(ACTIVE);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "toucan:away-mode:changed", newValue: "1" }));
    });
    await flush();
    expect(getSelfStatusSnapshot().currentStatus).toBe("AWAY");
  });

  it("a slow fetch that started before 'I'm back' cannot bring Away back", async () => {
    let resolveSlow: (v: ToucanDelegation | null) => void = () => {};
    h.getDelegation.mockImplementation(() => new Promise((r) => (resolveSlow = r)));
    void refreshAwayMode();
    setAwayModeDelegation(null); // the confirmed stop lands first
    await act(async () => {
      resolveSlow(ACTIVE);
      await Promise.resolve();
    });
    expect(getSelfStatusSnapshot().currentStatus).not.toBe("AWAY");
  });

  it("a failed read keeps the current state rather than guessing", async () => {
    setAwayModeDelegation(ACTIVE);
    h.getDelegation.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await refreshAwayMode();
    });
    expect(getSelfStatusSnapshot().currentStatus).toBe("AWAY");
  });

  it("an expired or ended row never reads as Away, and a timed row re-checks at its expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T05:00:00.000Z"));
    setAwayModeDelegation({ ...ACTIVE, endCondition: "at_time", expiresAt: "2026-10-22T04:59:00.000Z" });
    expect(getSelfStatusSnapshot().currentStatus).not.toBe("AWAY");
    setAwayModeDelegation({ ...ACTIVE, status: "ended" });
    expect(getSelfStatusSnapshot().currentStatus).not.toBe("AWAY");

    setAwayModeDelegation({ ...ACTIVE, endCondition: "at_time", expiresAt: "2026-10-22T05:10:00.000Z" });
    expect(getSelfStatusSnapshot().currentStatus).toBe("AWAY");
    h.getDelegation.mockResolvedValue(null); // the server's lazy expiry
    await act(async () => {
      vi.advanceTimersByTime(11 * 60_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getSelfStatusSnapshot().currentStatus).not.toBe("AWAY");
  });

  it("states a return time only when one was explicitly given", () => {
    expect(awayReturnLine({ returnLabel: "7:00 PM" })).toBe("Back around 7:00 PM");
    expect(awayReturnLine({ returnLabel: null })).toBe("Until you're back");
    expect(awayReturnLine({})).toBe("Until you're back");
  });
});
