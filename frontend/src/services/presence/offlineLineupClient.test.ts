import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as RealChatService.test.ts's FakeSocket, trimmed to
// what this client actually uses (on/emit/disconnect/trigger).
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
let ioSpy: ReturnType<typeof vi.fn>;

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

describe("offlineLineupClient", () => {
  it("emits go_offline / come_online on the connection it opens", async () => {
    const { emitGoOffline, emitComeOnline } = await import("./offlineLineupClient");

    emitGoOffline();
    expect(lastFakeSocket).not.toBeNull();
    expect(lastFakeSocket!.emitted).toEqual([{ event: "go_offline", payload: undefined }]);

    emitComeOnline();
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "go_offline", payload: undefined },
      { event: "come_online", payload: undefined },
    ]);
  });

  it("reuses the same connection across multiple emits", async () => {
    const { emitGoOffline, emitComeOnline } = await import("./offlineLineupClient");
    const socketIoModule = await import("socket.io-client");
    ioSpy = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = ioSpy.mock.calls.length;

    emitGoOffline();
    emitComeOnline();

    expect(ioSpy.mock.calls.length - callsBefore).toBe(1);
  });

  it("updates the subscribable snapshot when an offline_lineup event arrives", async () => {
    const { emitGoOffline, getOfflineLineupSnapshot } = await import("./offlineLineupClient");

    emitGoOffline(); // ensures the connection is opened
    expect(getOfflineLineupSnapshot()).toEqual([]);

    lastFakeSocket!.trigger("offline_lineup", {
      entries: [{ email: "a@example.com", slot: 0 }],
    });

    expect(getOfflineLineupSnapshot()).toEqual([{ email: "a@example.com", slot: 0 }]);
  });

  it("subscribes via useOfflineLineup and re-renders when a snapshot update arrives", async () => {
    const { useOfflineLineup } = await import("./offlineLineupClient");

    const { result } = renderHook(() => useOfflineLineup());
    expect(result.current).toEqual([]);
    expect(lastFakeSocket).not.toBeNull(); // mounting the hook opens the connection

    act(() => {
      lastFakeSocket!.trigger("offline_lineup", {
        entries: [{ email: "b@example.com", slot: 2 }],
      });
    });

    expect(result.current).toEqual([{ email: "b@example.com", slot: 2 }]);
  });

  it("setDevIdentity causes the next connection to authenticate with x-dev-email instead of token", async () => {
    const { emitGoOffline, setDevIdentity } = await import("./offlineLineupClient");

    setDevIdentity("dev@example.com");
    emitGoOffline();

    expect(lastFakeSocket).not.toBeNull();
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "dev@example.com" });
  });

  it("setDevIdentity tears down a live socket and reconnects with the new identity", async () => {
    const { emitGoOffline, setDevIdentity } = await import("./offlineLineupClient");
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;

    setDevIdentity("first@example.com");
    emitGoOffline();
    const firstSocket = lastFakeSocket;
    const disconnectSpy = vi.spyOn(firstSocket!, "disconnect");
    const callsBefore = ioMock.mock.calls.length;

    setDevIdentity("second@example.com");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    emitGoOffline();
    expect(ioMock.mock.calls.length - callsBefore).toBe(1);
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "second@example.com" });
  });

  // Run last: overrides the module-level "../api/client" mock for the rest of this file
  // (vi.doMock's replacement isn't scoped to a single test/undoable via vi.resetModules), so
  // no test after this one can rely on the default fake-token mock.
  it("does not open a connection when there is no auth token", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { emitGoOffline } = await import("./offlineLineupClient");

    emitGoOffline();

    expect(lastFakeSocket).toBeNull();
  });

  it("setDevIdentity allows connecting even with no real auth token present (doomed-from-the-start guard bypassed)", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { emitGoOffline, setDevIdentity } = await import("./offlineLineupClient");

    setDevIdentity("dev@example.com");
    emitGoOffline();

    expect(lastFakeSocket).not.toBeNull();
  });
});
