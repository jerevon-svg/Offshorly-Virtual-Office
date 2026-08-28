import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as spatialSessionStore.test.ts's FakeSocket.
class FakeSocket {
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  emitted: Array<{ event: string; payload: unknown }> = [];

  on(event: string, cb: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
    return this;
  }

  disconnect() {
    return this;
  }

  trigger(event: string, payload?: unknown) {
    for (const cb of this.handlers.get(event) ?? []) cb(payload);
  }
}

let lastFakeSocket: FakeSocket | null = null;

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    lastFakeSocket = new FakeSocket();
    return lastFakeSocket;
  }),
}));

vi.mock("../api/client", () => ({
  getAuthToken: vi.fn(() => "fake-token"),
}));

beforeEach(() => {
  vi.resetModules();
  lastFakeSocket = null;
  (import.meta.env as Record<string, string>).VITE_CHAT_SOCKET_URL = "http://localhost:4800";
});

describe("roomPresenceClient", () => {
  it("emits room_presence_enter with {roomId}", async () => {
    const { emitRoomPresenceEnter } = await import("./roomPresenceClient");

    emitRoomPresenceEnter("design-team");

    expect(lastFakeSocket).not.toBeNull();
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "room_presence_enter", payload: { roomId: "design-team" } },
    ]);
  });

  it("guards emitRoomPresenceEnter against an empty roomId", async () => {
    const { emitRoomPresenceEnter } = await import("./roomPresenceClient");

    emitRoomPresenceEnter("");

    expect(lastFakeSocket).toBeNull();
  });

  it("emits room_presence_leave with no payload", async () => {
    const { emitRoomPresenceEnter, emitRoomPresenceLeave } = await import("./roomPresenceClient");

    emitRoomPresenceEnter("design-team"); // opens the connection
    emitRoomPresenceLeave();

    expect(lastFakeSocket!.emitted).toEqual([
      { event: "room_presence_enter", payload: { roomId: "design-team" } },
      { event: "room_presence_leave", payload: undefined },
    ]);
  });

  it("updates the subscribable snapshot when a room_presence event arrives", async () => {
    const { emitRoomPresenceEnter, getRoomPresenceSnapshot } = await import("./roomPresenceClient");

    emitRoomPresenceEnter("design-team");
    expect(getRoomPresenceSnapshot()).toEqual([]);

    lastFakeSocket!.trigger("room_presence", {
      rooms: [{ roomId: "design-team", members: ["a@example.com"] }],
    });

    expect(getRoomPresenceSnapshot()).toEqual([{ roomId: "design-team", members: ["a@example.com"] }]);
  });

  it("subscribes via useRoomPresence and re-renders when a snapshot update arrives", async () => {
    const { useRoomPresence } = await import("./roomPresenceClient");

    const { result } = renderHook(() => useRoomPresence());
    expect(result.current).toEqual([]);

    act(() => {
      lastFakeSocket!.trigger("room_presence", {
        rooms: [{ roomId: "dev-team", members: ["b@example.com"] }],
      });
    });

    expect(result.current).toEqual([{ roomId: "dev-team", members: ["b@example.com"] }]);
  });
});
