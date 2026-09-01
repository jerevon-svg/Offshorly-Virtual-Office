import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as offlineLineupClient.test.ts's FakeSocket, trimmed to
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

describe("spatialSessionStore", () => {
  it("emits spatial_session_start with {sessionId} on the connection it opens", async () => {
    const { emitSpatialSessionStart } = await import("./spatialSessionStore");

    emitSpatialSessionStart("conv-123");

    expect(lastFakeSocket).not.toBeNull();
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "spatial_session_start", payload: { sessionId: "conv-123" } },
    ]);
  });

  it("emits spatial_session_leave with no payload", async () => {
    const { emitSpatialSessionStart, emitSpatialSessionLeave } = await import(
      "./spatialSessionStore"
    );

    emitSpatialSessionStart("conv-123"); // opens the connection
    emitSpatialSessionLeave();

    expect(lastFakeSocket!.emitted).toEqual([
      { event: "spatial_session_start", payload: { sessionId: "conv-123" } },
      { event: "spatial_session_leave", payload: undefined },
    ]);
  });

  it("guards emitSpatialSessionStart against an empty/falsy sessionId", async () => {
    const { emitSpatialSessionStart } = await import("./spatialSessionStore");

    emitSpatialSessionStart("");

    expect(lastFakeSocket).toBeNull();
  });

  it("reuses the same connection across multiple emits", async () => {
    const { emitSpatialSessionStart, emitSpatialSessionLeave } = await import(
      "./spatialSessionStore"
    );
    const socketIoModule = await import("socket.io-client");
    ioSpy = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = ioSpy.mock.calls.length;

    emitSpatialSessionStart("conv-123");
    emitSpatialSessionLeave();

    expect(ioSpy.mock.calls.length - callsBefore).toBe(1);
  });

  it("updates the subscribable snapshot when a spatial_sessions event arrives", async () => {
    const { emitSpatialSessionStart, getSpatialSessionsSnapshot } = await import(
      "./spatialSessionStore"
    );

    emitSpatialSessionStart("conv-123"); // ensures the connection is opened
    expect(getSpatialSessionsSnapshot()).toEqual([]);

    lastFakeSocket!.trigger("spatial_sessions", {
      sessions: [{ sessionId: "conv-123", members: ["a@example.com", "b@example.com"] }],
    });

    expect(getSpatialSessionsSnapshot()).toEqual([
      { sessionId: "conv-123", members: ["a@example.com", "b@example.com"] },
    ]);
  });

  it("subscribes via useSpatialSessions and re-renders when a snapshot update arrives", async () => {
    const { useSpatialSessions } = await import("./spatialSessionStore");

    const { result } = renderHook(() => useSpatialSessions());
    expect(result.current).toEqual([]);
    expect(lastFakeSocket).not.toBeNull(); // mounting the hook opens the connection

    act(() => {
      lastFakeSocket!.trigger("spatial_sessions", {
        sessions: [{ sessionId: "conv-456", members: ["c@example.com"] }],
      });
    });

    expect(result.current).toEqual([{ sessionId: "conv-456", members: ["c@example.com"] }]);
  });

  it("setDevIdentity causes the next connection to authenticate with x-dev-email instead of token", async () => {
    const { emitSpatialSessionStart, setDevIdentity } = await import("./spatialSessionStore");

    setDevIdentity("dev@example.com");
    emitSpatialSessionStart("conv-123");

    expect(lastFakeSocket).not.toBeNull();
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "dev@example.com" });
  });

  it("setDevIdentity tears down a live socket and reconnects with the new identity", async () => {
    const { emitSpatialSessionStart, setDevIdentity } = await import("./spatialSessionStore");
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;

    setDevIdentity("first@example.com");
    emitSpatialSessionStart("conv-123");
    const firstSocket = lastFakeSocket;
    const disconnectSpy = vi.spyOn(firstSocket!, "disconnect");
    const callsBefore = ioMock.mock.calls.length;

    setDevIdentity("second@example.com");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    emitSpatialSessionStart("conv-456");
    expect(ioMock.mock.calls.length - callsBefore).toBe(1);
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "second@example.com" });
  });

  // --- Stage 0: reconnect re-assert ---------------------------------------------------

  it("re-emits spatial_session_start for the active session on reconnect", async () => {
    const { emitSpatialSessionStart } = await import("./spatialSessionStore");

    emitSpatialSessionStart("conv-123");
    lastFakeSocket!.emitted.length = 0;

    // A reconnect is a brand-new server-side sid with no memory of us.
    lastFakeSocket!.trigger("connect");

    expect(lastFakeSocket!.emitted).toEqual([
      { event: "spatial_session_start", payload: { sessionId: "conv-123" } },
    ]);
  });

  it("does not resurrect a session the user explicitly left before reconnecting", async () => {
    const { emitSpatialSessionStart, emitSpatialSessionLeave } = await import(
      "./spatialSessionStore"
    );

    emitSpatialSessionStart("conv-123");
    emitSpatialSessionLeave();
    lastFakeSocket!.emitted.length = 0;

    lastFakeSocket!.trigger("connect");

    expect(lastFakeSocket!.emitted).toEqual([]);
  });

  it("re-asserts only the LATEST session id across an upgrade, never a stale one", async () => {
    const { emitSpatialSessionStart, emitSpatialSessionLeave } = await import(
      "./spatialSessionStore"
    );

    // Mirrors OfficeMap's conversation_upgraded handler: leave the old id, start the new one.
    emitSpatialSessionStart("old-conv");
    emitSpatialSessionLeave();
    emitSpatialSessionStart("new-conv");
    lastFakeSocket!.emitted.length = 0;

    lastFakeSocket!.trigger("connect");

    expect(lastFakeSocket!.emitted).toEqual([
      { event: "spatial_session_start", payload: { sessionId: "new-conv" } },
    ]);
  });

  it("re-asserts once per connect, idempotently across repeated reconnects", async () => {
    const { emitSpatialSessionStart } = await import("./spatialSessionStore");

    emitSpatialSessionStart("conv-123");
    lastFakeSocket!.emitted.length = 0;

    lastFakeSocket!.trigger("connect");
    lastFakeSocket!.trigger("connect");

    // One start per connect and nothing else — the server treats a repeat for the same
    // (email, session) as idempotent, registering the new sid as a co-owner.
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "spatial_session_start", payload: { sessionId: "conv-123" } },
      { event: "spatial_session_start", payload: { sessionId: "conv-123" } },
    ]);
  });

  it("does not re-assert the previous identity's session after setDevIdentity", async () => {
    const { emitSpatialSessionStart, setDevIdentity } = await import("./spatialSessionStore");

    setDevIdentity("first@example.com");
    emitSpatialSessionStart("conv-123");

    setDevIdentity("second@example.com");
    emitSpatialSessionStart(""); // guarded no-op; forces no new session
    const before = lastFakeSocket;
    before!.emitted.length = 0;
    before!.trigger("connect");

    expect(before!.emitted).toEqual([]);
  });

  it("snapshot updates still arrive normally after a reconnect", async () => {
    const { emitSpatialSessionStart, getSpatialSessionsSnapshot } = await import(
      "./spatialSessionStore"
    );

    emitSpatialSessionStart("conv-123");
    lastFakeSocket!.trigger("connect");

    lastFakeSocket!.trigger("spatial_sessions", {
      sessions: [{ sessionId: "conv-123", members: ["a@example.com", "b@example.com"] }],
    });

    expect(getSpatialSessionsSnapshot()).toEqual([
      { sessionId: "conv-123", members: ["a@example.com", "b@example.com"] },
    ]);
  });

  // Run last: overrides the module-level "../api/client" mock for the rest of this file
  // (vi.doMock's replacement isn't scoped to a single test/undoable via vi.resetModules), so
  // no test after this one can rely on the default fake-token mock.
  it("does not open a connection when there is no auth token", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { emitSpatialSessionStart } = await import("./spatialSessionStore");

    emitSpatialSessionStart("conv-123");

    expect(lastFakeSocket).toBeNull();
  });

  it("setDevIdentity allows connecting even with no real auth token present (doomed-from-the-start guard bypassed)", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { emitSpatialSessionStart, setDevIdentity } = await import("./spatialSessionStore");

    setDevIdentity("dev@example.com");
    emitSpatialSessionStart("conv-123");

    expect(lastFakeSocket).not.toBeNull();
  });
});
