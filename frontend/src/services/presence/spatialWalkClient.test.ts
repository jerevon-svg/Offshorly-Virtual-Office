import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as spatialSessionStore.test.ts's
// FakeSocket, trimmed to what this client actually uses (on/emit/disconnect/
// trigger).
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

describe("spatialWalkClient", () => {
  it("emitWalkStart emits walk_started with {from, path} on the connection it opens", async () => {
    const { emitWalkStart } = await import("./spatialWalkClient");

    emitWalkStart({ x: 1, y: 2 }, [{ x: 3, y: 4 }]);

    expect(lastFakeSocket).not.toBeNull();
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "walk_started", payload: { from: { x: 1, y: 2 }, path: [{ x: 3, y: 4 }] } },
    ]);
  });

  it("emitWalkArrived emits walk_arrived with {at}", async () => {
    const { emitWalkStart, emitWalkArrived } = await import("./spatialWalkClient");

    emitWalkStart({ x: 0, y: 0 }, [{ x: 1, y: 1 }]); // opens the connection
    emitWalkArrived({ x: 5, y: 6 });

    expect(lastFakeSocket!.emitted).toEqual([
      { event: "walk_started", payload: { from: { x: 0, y: 0 }, path: [{ x: 1, y: 1 }] } },
      { event: "walk_arrived", payload: { at: { x: 5, y: 6 } } },
    ]);
  });

  it("emitWalkStart with an empty path is a no-op", async () => {
    const { emitWalkStart } = await import("./spatialWalkClient");

    emitWalkStart({ x: 0, y: 0 }, []);

    expect(lastFakeSocket).toBeNull();
  });

  it("emitWalkStart caps a path longer than 64 points, preserving the last point", async () => {
    const { emitWalkStart } = await import("./spatialWalkClient");

    const longPath = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i }));
    emitWalkStart({ x: 0, y: 0 }, longPath);

    expect(lastFakeSocket).not.toBeNull();
    const sent = lastFakeSocket!.emitted[0].payload as { path: { x: number; y: number }[] };
    expect(sent.path.length).toBeLessThanOrEqual(64);
    expect(sent.path[sent.path.length - 1]).toEqual(longPath[longPath.length - 1]);
  });

  it("emitAndWalkTo emits walk_started, calls walkTo, and emits walk_arrived on arrival", async () => {
    const { emitAndWalkTo } = await import("./spatialWalkClient");

    const from = { x: 0, y: 0 };
    const path = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
    const onArrive = vi.fn();
    const fakeWalkTo = vi.fn((_input: unknown, onArriveCb?: () => void) => {
      onArriveCb?.();
    });

    emitAndWalkTo(fakeWalkTo, from, path, onArrive);

    expect(fakeWalkTo).toHaveBeenCalledTimes(1);
    expect(fakeWalkTo.mock.calls[0][0]).toEqual(path);
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "walk_started", payload: { from, path } },
      { event: "walk_arrived", payload: { at: { x: 2, y: 2 } } },
    ]);
  });

  it("reuses the same connection across multiple emits", async () => {
    const { emitWalkStart, emitWalkArrived } = await import("./spatialWalkClient");
    const socketIoModule = await import("socket.io-client");
    ioSpy = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = ioSpy.mock.calls.length;

    emitWalkStart({ x: 0, y: 0 }, [{ x: 1, y: 1 }]);
    emitWalkArrived({ x: 1, y: 1 });

    expect(ioSpy.mock.calls.length - callsBefore).toBe(1);
  });

  it("peer_walk_started updates getPeerWalksSnapshot keyed by lowercased email, incrementing startNonce", async () => {
    const { emitWalkStart, getPeerWalksSnapshot } = await import("./spatialWalkClient");

    emitWalkStart({ x: 0, y: 0 }, [{ x: 1, y: 1 }]); // ensures connection opened
    expect(getPeerWalksSnapshot()).toEqual([]);

    lastFakeSocket!.trigger("peer_walk_started", {
      email: "Peer@Example.com",
      from: { x: 0, y: 0 },
      path: [{ x: 10, y: 10 }],
    });

    expect(getPeerWalksSnapshot()).toEqual([
      {
        email: "peer@example.com",
        from: { x: 0, y: 0 },
        path: [{ x: 10, y: 10 }],
        startNonce: 1,
        arrivedAt: null,
        arrivedNonce: 0,
      },
    ]);

    lastFakeSocket!.trigger("peer_walk_started", {
      email: "peer@example.com",
      from: { x: 5, y: 5 },
      path: [{ x: 20, y: 20 }],
    });

    expect(getPeerWalksSnapshot()[0].startNonce).toBe(2);
  });

  it("peer_walk_arrived sets arrivedAt and increments arrivedNonce for that email", async () => {
    const { emitWalkStart, getPeerWalksSnapshot } = await import("./spatialWalkClient");

    emitWalkStart({ x: 0, y: 0 }, [{ x: 1, y: 1 }]); // ensures connection opened
    lastFakeSocket!.trigger("peer_walk_started", {
      email: "peer@example.com",
      from: { x: 0, y: 0 },
      path: [{ x: 10, y: 10 }],
    });

    lastFakeSocket!.trigger("peer_walk_arrived", {
      email: "peer@example.com",
      at: { x: 10, y: 10 },
    });

    const entry = getPeerWalksSnapshot().find((w) => w.email === "peer@example.com");
    expect(entry?.arrivedAt).toEqual({ x: 10, y: 10 });
    expect(entry?.arrivedNonce).toBe(1);
  });

  it("usePeerWalks re-renders when a peer_walk_started event is triggered", async () => {
    const { usePeerWalks } = await import("./spatialWalkClient");

    const { result } = renderHook(() => usePeerWalks());
    expect(result.current).toEqual([]);
    expect(lastFakeSocket).not.toBeNull(); // mounting the hook opens the connection

    act(() => {
      lastFakeSocket!.trigger("peer_walk_started", {
        email: "peer@example.com",
        from: { x: 0, y: 0 },
        path: [{ x: 10, y: 10 }],
      });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].email).toBe("peer@example.com");
  });

  it("setDevIdentity causes the next connection to authenticate with x-dev-email instead of token", async () => {
    const { emitWalkStart, setDevIdentity } = await import("./spatialWalkClient");

    setDevIdentity("dev@example.com");
    emitWalkStart({ x: 0, y: 0 }, [{ x: 1, y: 1 }]);

    expect(lastFakeSocket).not.toBeNull();
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "dev@example.com" });
  });

  it("setDevIdentity tears down a live socket and reconnects with the new identity", async () => {
    const { emitWalkStart, setDevIdentity } = await import("./spatialWalkClient");
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;

    setDevIdentity("first@example.com");
    emitWalkStart({ x: 0, y: 0 }, [{ x: 1, y: 1 }]);
    const firstSocket = lastFakeSocket;
    const disconnectSpy = vi.spyOn(firstSocket!, "disconnect");
    const callsBefore = ioMock.mock.calls.length;

    setDevIdentity("second@example.com");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    emitWalkStart({ x: 0, y: 0 }, [{ x: 2, y: 2 }]);
    expect(ioMock.mock.calls.length - callsBefore).toBe(1);
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "second@example.com" });
  });

  // Run last: overrides the module-level "../api/client" mock for the rest of this file
  // (vi.doMock's replacement isn't scoped to a single test/undoable via vi.resetModules), so
  // no test after this one can rely on the default fake-token mock.
  it("does not open a connection when there is no auth token", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { emitWalkStart } = await import("./spatialWalkClient");

    emitWalkStart({ x: 0, y: 0 }, [{ x: 1, y: 1 }]);

    expect(lastFakeSocket).toBeNull();
  });

  it("setDevIdentity allows connecting even with no real auth token present (doomed-from-the-start guard bypassed)", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { emitWalkStart, setDevIdentity } = await import("./spatialWalkClient");

    setDevIdentity("dev@example.com");
    emitWalkStart({ x: 0, y: 0 }, [{ x: 1, y: 1 }]);

    expect(lastFakeSocket).not.toBeNull();
  });
});
