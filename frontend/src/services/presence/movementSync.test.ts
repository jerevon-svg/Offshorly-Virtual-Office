import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyArrived,
  applySnapshot,
  applyStarted,
  type PeerMovementState,
} from "./movementSync";

// Fake Socket.IO client — same shape as spatialSessionStore.test.ts's/
// spatialWalkClient.test.ts's FakeSocket.
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

describe("movementSync — pure reducers", () => {
  it("applySnapshot replaces entries whose revision is newer or absent", () => {
    const prev = new Map<string, PeerMovementState>([
      [
        "a@x.com",
        {
          email: "a@x.com",
          revision: 5,
          stable: { pos: { x: 0, y: 0 }, facing: "front", state: "standing", seatKey: null, roomId: null },
          active: null,
        },
      ],
    ]);
    const next = applySnapshot(prev, {
      serverTime: 1000,
      entries: [
        // stale — revision 3 < existing 5 — ignored
        { email: "a@x.com", revision: 3, pos: { x: 9, y: 9 }, facing: "back", state: "standing", seatKey: null, roomId: null, updatedAt: 1, active: null },
        // new entry
        { email: "b@x.com", revision: 1, pos: { x: 1, y: 1 }, facing: "left", state: "sitting", seatKey: "seat-1", roomId: "r1", updatedAt: 1, active: null },
      ],
    });
    expect(next.get("a@x.com")!.stable.pos).toEqual({ x: 0, y: 0 });
    expect(next.get("b@x.com")!.stable.state).toBe("sitting");
  });

  it("applyStarted sets active and stable.state=standing, ignores stale revision", () => {
    const prev = new Map<string, PeerMovementState>();
    const started = applyStarted(prev, {
      email: "A@X.com",
      movementId: "m1",
      revision: 1,
      origin: { x: 0, y: 0 },
      path: [{ x: 1, y: 1 }],
      roomId: null,
      durationMs: 500,
      startedAt: 1000,
    });
    const entry = started.get("a@x.com")!;
    expect(entry.active?.movementId).toBe("m1");
    expect(entry.stable.state).toBe("standing");

    // stale (revision <= current) ignored
    const stale = applyStarted(started, {
      email: "a@x.com",
      movementId: "m0",
      revision: 1,
      origin: { x: 5, y: 5 },
      path: [],
      roomId: null,
      durationMs: 100,
      startedAt: 900,
    });
    expect(stale).toBe(started);

    // newer start supersedes active
    const superseded = applyStarted(started, {
      email: "a@x.com",
      movementId: "m2",
      revision: 2,
      origin: { x: 10, y: 10 },
      path: [{ x: 20, y: 20 }],
      roomId: "r2",
      durationMs: 800,
      startedAt: 2000,
    });
    expect(superseded.get("a@x.com")!.active?.movementId).toBe("m2");
  });

  it("applyArrived clears active and sets stable, ignores stale/lower revision (arrived-before-started)", () => {
    const withActive = applyStarted(new Map(), {
      email: "a@x.com",
      movementId: "m1",
      revision: 2,
      origin: { x: 0, y: 0 },
      path: [{ x: 1, y: 1 }],
      roomId: null,
      durationMs: 500,
      startedAt: 1000,
    });

    // arrived with LOWER revision than current (out-of-order delivery) — ignored
    const ignored = applyArrived(withActive, {
      email: "a@x.com",
      movementId: "m0",
      revision: 1,
      at: { x: 99, y: 99 },
      facing: "back",
      state: "standing",
      seatKey: null,
      roomId: null,
    });
    expect(ignored).toBe(withActive);

    const arrived = applyArrived(withActive, {
      email: "a@x.com",
      movementId: "m1",
      revision: 3,
      at: { x: 1, y: 1 },
      facing: "front",
      state: "sitting",
      seatKey: "seat-1",
      roomId: "r1",
    });
    const entry = arrived.get("a@x.com")!;
    expect(entry.active).toBeNull();
    expect(entry.stable).toEqual({
      pos: { x: 1, y: 1 },
      facing: "front",
      state: "sitting",
      seatKey: "seat-1",
      roomId: "r1",
    });
  });
});

describe("movementSync — socket wiring", () => {
  it("emitWalkStarted opens a connection and emits walk_started with the full payload", async () => {
    const { emitWalkStarted } = await import("./movementSync");
    emitWalkStarted({
      movementId: "m1",
      origin: { x: 0, y: 0 },
      path: [{ x: 1, y: 1 }],
      roomId: "r1",
      durationMs: 1200,
    });
    expect(lastFakeSocket).not.toBeNull();
    expect(lastFakeSocket!.emitted).toEqual([
      {
        event: "walk_started",
        payload: { movementId: "m1", origin: { x: 0, y: 0 }, path: [{ x: 1, y: 1 }], roomId: "r1", durationMs: 1200 },
      },
    ]);
  });

  it("emitWalkArrived emits walk_arrived with the full payload", async () => {
    const { emitWalkStarted, emitWalkArrived } = await import("./movementSync");
    emitWalkStarted({ movementId: "m1", origin: { x: 0, y: 0 }, path: [{ x: 1, y: 1 }], roomId: null, durationMs: 500 });
    emitWalkArrived({ movementId: "m1", at: { x: 1, y: 1 }, facing: "front", state: "standing", seatKey: null, roomId: null });
    expect(lastFakeSocket!.emitted[1]).toEqual({
      event: "walk_arrived",
      payload: { movementId: "m1", at: { x: 1, y: 1 }, facing: "front", state: "standing", seatKey: null, roomId: null },
    });
  });

  it("caps a path longer than 64 points on emitWalkStarted, preserving the last point", async () => {
    const { emitWalkStarted } = await import("./movementSync");
    const longPath = Array.from({ length: 100 }, (_, i) => ({ x: i, y: i }));
    emitWalkStarted({ movementId: "m1", origin: { x: 0, y: 0 }, path: longPath, roomId: null, durationMs: 500 });
    const sent = lastFakeSocket!.emitted[0].payload as { path: { x: number; y: number }[] };
    expect(sent.path.length).toBeLessThanOrEqual(64);
    expect(sent.path[sent.path.length - 1]).toEqual(longPath[longPath.length - 1]);
  });

  it("emitWalkStarted rounds a fractional durationMs and clamps to [100, 20000] (backend rejects non-int / out-of-range)", async () => {
    const { emitWalkStarted } = await import("./movementSync");

    emitWalkStarted({ movementId: "m1", origin: { x: 0, y: 0 }, path: [{ x: 1, y: 1 }], roomId: null, durationMs: 1234.56 });
    let sent = lastFakeSocket!.emitted.at(-1)!.payload as { durationMs: number };
    expect(Number.isInteger(sent.durationMs)).toBe(true);
    expect(sent.durationMs).toBe(1235);

    emitWalkStarted({ movementId: "m2", origin: { x: 0, y: 0 }, path: [{ x: 1, y: 1 }], roomId: null, durationMs: 5 });
    sent = lastFakeSocket!.emitted.at(-1)!.payload as { durationMs: number };
    expect(sent.durationMs).toBe(100);

    emitWalkStarted({ movementId: "m3", origin: { x: 0, y: 0 }, path: [{ x: 1, y: 1 }], roomId: null, durationMs: 99999 });
    sent = lastFakeSocket!.emitted.at(-1)!.payload as { durationMs: number };
    expect(sent.durationMs).toBe(20000);
  });

  it("positions_snapshot populates the store and computes clock offset", async () => {
    const { usePeerMovements, getServerClockOffsetMs } = await import("./movementSync");
    const { result } = renderHook(() => usePeerMovements());
    expect(lastFakeSocket).not.toBeNull();

    const fakeNow = Date.now();
    act(() => {
      lastFakeSocket!.trigger("positions_snapshot", {
        serverTime: fakeNow + 5000,
        entries: [
          { email: "Peer@X.com", revision: 1, pos: { x: 1, y: 1 }, facing: "front", state: "standing", seatKey: null, roomId: null, updatedAt: 1, active: null },
        ],
      });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].email).toBe("peer@x.com");
    expect(getServerClockOffsetMs()).toBeGreaterThanOrEqual(4900);
  });

  it("usePeerMovements re-renders on peer_walk_started/peer_walk_arrived", async () => {
    const { usePeerMovements } = await import("./movementSync");
    const { result } = renderHook(() => usePeerMovements());
    expect(result.current).toEqual([]);

    act(() => {
      lastFakeSocket!.trigger("peer_walk_started", {
        email: "peer@example.com",
        movementId: "m1",
        revision: 1,
        origin: { x: 0, y: 0 },
        path: [{ x: 10, y: 10 }],
        roomId: null,
        durationMs: 500,
        startedAt: Date.now(),
      });
    });
    expect(result.current).toHaveLength(1);
    expect(result.current[0].active?.movementId).toBe("m1");

    act(() => {
      lastFakeSocket!.trigger("peer_walk_arrived", {
        email: "peer@example.com",
        movementId: "m1",
        revision: 2,
        at: { x: 10, y: 10 },
        facing: "front",
        state: "standing",
        seatKey: null,
        roomId: null,
      });
    });
    expect(result.current[0].active).toBeNull();
    expect(result.current[0].stable.pos).toEqual({ x: 10, y: 10 });
  });

  it("setDevIdentity authenticates the next connection with x-dev-email", async () => {
    const { emitWalkStarted, setDevIdentity } = await import("./movementSync");
    setDevIdentity("dev@example.com");
    emitWalkStarted({ movementId: "m1", origin: { x: 0, y: 0 }, path: [{ x: 1, y: 1 }], roomId: null, durationMs: 500 });
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "dev@example.com" });
  });
});
