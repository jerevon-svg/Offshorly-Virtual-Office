import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const enters: string[] = [];
let leaves = 0;
vi.mock("../../../services/presence/roomPresenceClient", () => ({
  emitRoomPresenceEnter: (roomId: string) => { enters.push(roomId); },
  emitRoomPresenceLeave: () => { leaves += 1; },
}));

// V1's OWN bridge, stubbed to the one mapping these cases need. The real function is exercised by
// office-layout's own tests; what matters here is that this adapter goes THROUGH it rather than
// publishing V2's manifest id into a registry that speaks V1's flat one.
vi.mock("../../../data/office-layout", () => ({
  flatRoomIdForRoomLayer: (layerId: string) =>
    ({ "design-room": "design-team", "dev-room": "dev-team" }[layerId] ?? null),
}));

import { useV1RoomPresence, flatRoomForWorld, mayPublish, SAMPLE_MS } from "./v1RoomPresence";
import type { Vo3dWorld } from "../app/world";

/** A world that is only ever asked one thing. */
function worldAt(roomLayerId: string | null) {
  return { current: { currentRoomId: () => roomLayerId } as unknown as Vo3dWorld };
}

beforeEach(() => {
  enters.length = 0;
  leaves = 0;
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => { vi.useRealTimers(); });

describe("the namespace bridge", () => {
  it("publishes V1's FLAT id, never V2's manifest id", () => {
    expect(flatRoomForWorld(worldAt("design-room").current)).toBe("design-team");
  });

  it("is not in a room when the layer has no hand-drawn twin, or there is no world", () => {
    expect(flatRoomForWorld(worldAt("cave").current)).toBeNull();
    expect(flatRoomForWorld(worldAt(null).current)).toBeNull();
    expect(flatRoomForWorld(null)).toBeNull();
  });
});

describe("who may be an occupant at all", () => {
  it("is nobody without an identity, and nobody V1 has not confirmed is checked in", () => {
    expect(mayPublish("bon@offshorly.com", "permitted")).toBe(true);
    expect(mayPublish("", "permitted")).toBe(false);
    // `unknown` is the pre-first-read and failed-read answer. A room is not locked on a maybe.
    expect(mayPublish("bon@offshorly.com", "unknown")).toBe(false);
    expect(mayPublish("bon@offshorly.com", "denied")).toBe(false);
  });
});

describe("one event per real transition", () => {
  it("enters once and then says nothing while the body stays put", () => {
    const world = worldAt("design-room");
    renderHook(() => useV1RoomPresence(world, true, "bon@offshorly.com", "permitted"));
    expect(enters).toEqual(["design-team"]);

    vi.advanceTimersByTime(SAMPLE_MS * 10);
    expect(enters).toEqual(["design-team"]);
    expect(leaves).toBe(0);
  });

  it("sends a single ENTER when crossing straight from one room into another", () => {
    const world = worldAt("design-room");
    renderHook(() => useV1RoomPresence(world, true, "bon@offshorly.com", "permitted"));
    (world.current as unknown as { currentRoomId: () => string }).currentRoomId = () => "dev-room";
    vi.advanceTimersByTime(SAMPLE_MS);

    expect(enters).toEqual(["design-team", "dev-team"]);
    expect(leaves).toBe(0);  // V1's rule: enter supersedes, leave is only for open floor
  });

  it("leaves once when the body steps out into the hall, and stays quiet there", () => {
    const world = worldAt("design-room");
    renderHook(() => useV1RoomPresence(world, true, "bon@offshorly.com", "permitted"));
    (world.current as unknown as { currentRoomId: () => null }).currentRoomId = () => null;
    vi.advanceTimersByTime(SAMPLE_MS * 4);

    expect(leaves).toBe(1);
    expect(enters).toEqual(["design-team"]);
  });
});

describe("never a stale occupant", () => {
  it("gives the room up on unmount — which is what a switch to Classic, a reload or a closed tab is", () => {
    const { unmount } = renderHook(() => useV1RoomPresence(worldAt("design-room"), true, "bon@offshorly.com", "permitted"));
    expect(enters).toEqual(["design-team"]);
    unmount();
    expect(leaves).toBe(1);
  });

  it("does not emit a leave on unmount when it never claimed a room", () => {
    const { unmount } = renderHook(() => useV1RoomPresence(worldAt(null), true, "bon@offshorly.com", "permitted"));
    unmount();
    expect(leaves).toBe(0);
    expect(enters).toEqual([]);
  });

  it("gives the room up when attendance stops permitting it, rather than going quiet", () => {
    const world = worldAt("design-room");
    const { rerender } = renderHook(
      ({ access }: { access: "permitted" | "denied" }) =>
        useV1RoomPresence(world, true, "bon@offshorly.com", access),
      { initialProps: { access: "permitted" as "permitted" | "denied" } },
    );
    expect(enters).toEqual(["design-team"]);
    rerender({ access: "denied" });
    expect(leaves).toBe(1);
  });
});

describe("never a false membership", () => {
  it("publishes nothing at all before the world is ready", () => {
    renderHook(() => useV1RoomPresence(worldAt("design-room"), false, "bon@offshorly.com", "permitted"));
    vi.advanceTimersByTime(SAMPLE_MS * 4);
    expect(enters).toEqual([]);
    expect(leaves).toBe(0);
  });

  it("publishes nothing for the standalone rig, where there is nobody to be an occupant", () => {
    renderHook(() => useV1RoomPresence(worldAt("design-room"), true, "", "permitted"));
    vi.advanceTimersByTime(SAMPLE_MS * 4);
    expect(enters).toEqual([]);
  });

  it("publishes nothing for a checked-out employee", () => {
    renderHook(() => useV1RoomPresence(worldAt("design-room"), true, "bon@offshorly.com", "denied"));
    vi.advanceTimersByTime(SAMPLE_MS * 4);
    expect(enters).toEqual([]);
  });

  it("stops sampling while the tab is hidden", () => {
    const world = worldAt("design-room");
    renderHook(() => useV1RoomPresence(world, true, "bon@offshorly.com", "permitted"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    (world.current as unknown as { currentRoomId: () => string }).currentRoomId = () => "dev-room";
    vi.advanceTimersByTime(SAMPLE_MS * 5);
    expect(enters).toEqual(["design-team"]);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(enters).toEqual(["design-team", "dev-team"]);
  });
});
