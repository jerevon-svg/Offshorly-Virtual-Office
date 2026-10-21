// S1 — the host's line between the scooter store and the world: only a server that speaks scooters is asked,
// and the world is told which rides are MINE, with `full` on every (re)connect snapshot.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScooterAuthority } from "./useScooterAuthority";
import { applyFullSnapshot, applyRelayedPose, applyScooterState, applyTrafficHolds, resetScooterStoreForTests, type ScooterWire } from "../../../services/scooters/scooterStore";

const sc = (id: string, state: ScooterWire["state"], version: number, rider: string | null = null): ScooterWire => ({ id, state, rider, at: null, since: 0, version });

afterEach(() => resetScooterStoreForTests());

describe("useScooterAuthority", () => {
  it("asks nobody until the server has sent its scooters; then installs the authority and the states", () => {
    const world = { setScooterAuthority: vi.fn(), applyScooterStates: vi.fn() };
    const ref = { current: world };
    renderHook(() => useScooterAuthority(ref, true, "Me@Offshorly.com"));
    expect(world.setScooterAuthority).not.toHaveBeenCalled(); // an old backend: single-player, never a timeout
    act(() => applyFullSnapshot({ scooters: [sc("scooter-r1", "ridden", 1, "me@offshorly.com"), sc("scooter-r2", "ridden", 1, "you@x"), sc("scooter-r3", "docked", 0)] }));
    expect(world.setScooterAuthority).toHaveBeenCalledTimes(1);
    expect(typeof world.setScooterAuthority.mock.calls[0][0].claim).toBe("function");
    expect(world.applyScooterStates).toHaveBeenLastCalledWith(
      [{ id: "scooter-r1", state: "ridden", mine: true, at: null, accident: null }, { id: "scooter-r2", state: "ridden", mine: false, at: null, accident: null }, { id: "scooter-r3", state: "docked", mine: false, at: null, accident: null }],
      true,
    );
    // a single change afterwards is NOT a full snapshot
    act(() => applyScooterState({ scooter: sc("scooter-r3", "ridden", 1, "you@x") }));
    expect(world.applyScooterStates.mock.calls.at(-1)![1]).toBe(false);
    // a reconnect's snapshot is full again
    act(() => applyFullSnapshot({ scooters: [sc("scooter-r3", "docked", 0)] }));
    expect(world.applyScooterStates.mock.calls.at(-1)![1]).toBe(true);
  });

  it("withdraws the authority when the host unmounts", () => {
    const world = { setScooterAuthority: vi.fn(), applyScooterStates: vi.fn() };
    const { unmount } = renderHook(() => useScooterAuthority({ current: world }, true, "me@x"));
    act(() => applyFullSnapshot({ scooters: [] }));
    unmount();
    expect(world.setScooterAuthority).toHaveBeenLastCalledWith(null);
  });
});

describe("useScooterAuthority — S2 poses", () => {
  const P = { x: 10, z: 20, y: 0, heading: 1, speed: 50, lean: 0, pitch: 0 };

  it("forwards every relayed pose to the world, and offers the world a way to send its own", () => {
    const world = { setScooterAuthority: vi.fn(), applyScooterStates: vi.fn(), pushScooterPose: vi.fn() };
    renderHook(() => useScooterAuthority({ current: world }, true, "me@x"));
    act(() => applyFullSnapshot({ scooters: [] }));
    expect(typeof world.setScooterAuthority.mock.calls[0][0].sendPose).toBe("function");
    applyRelayedPose({ scooterId: "scooter-r2", rider: "you@x", seq: 3, t: 100, ...P });
    expect(world.pushScooterPose).toHaveBeenCalledWith(expect.objectContaining({ scooterId: "scooter-r2", rider: "you@x", seq: 3 }));
  });

  it("JOINING MID-RIDE: seeds each OTHER rider from the snapshot's stored pose — never our own, never a docked one", () => {
    const world = { setScooterAuthority: vi.fn(), applyScooterStates: vi.fn(), pushScooterPose: vi.fn() };
    renderHook(() => useScooterAuthority({ current: world }, true, "me@x"));
    act(() => applyFullSnapshot({ scooters: [
      { ...sc("scooter-r1", "ridden", 2, "you@x"), pose: { ...P, t: 900, seq: 41 } as never },
      { ...sc("scooter-r2", "ridden", 2, "me@x"), pose: { ...P, t: 900, seq: 7 } as never },
      { ...sc("scooter-r3", "docked", 1), pose: null },
      { ...sc("scooter-r4", "ridden", 1, "him@x") }, // no pose yet: nothing to seed
    ] }));
    expect(world.pushScooterPose).toHaveBeenCalledTimes(1);
    expect(world.pushScooterPose).toHaveBeenCalledWith(expect.objectContaining({ scooterId: "scooter-r1", rider: "you@x", seq: 41, t: 900, x: 10 }));
    // states first, then the seed — the world must know the ride is theirs before it draws it
    expect(world.applyScooterStates.mock.invocationCallOrder.at(-1)!).toBeLessThan(world.pushScooterPose.mock.invocationCallOrder[0]);
  });
});

describe("useScooterAuthority — S4 traffic", () => {
  it("passes the holds to the world, and lets the world report obstacles only once the server has shown it holds traffic", () => {
    const world = { setScooterAuthority: vi.fn(), applyScooterStates: vi.fn(), applyTrafficHolds: vi.fn(), setTrafficReporter: vi.fn() };
    const { unmount } = renderHook(() => useScooterAuthority({ current: world }, true, "me@x"));
    expect(world.setTrafficReporter).not.toHaveBeenCalled(); // an older backend never hears a report
    const list = [{ loop: "B", vehicle: 1, d0: 2, t0: 3, hold: null }];
    act(() => applyTrafficHolds({ vehicles: list }));
    expect(world.applyTrafficHolds).toHaveBeenCalledWith(list);
    expect(world.setTrafficReporter).toHaveBeenCalledTimes(1);
    act(() => applyTrafficHolds({ vehicles: [] }));
    expect(world.setTrafficReporter).toHaveBeenCalledTimes(1); // installed once
    unmount();
    expect(world.setTrafficReporter).toHaveBeenLastCalledWith(null);
  });
});
