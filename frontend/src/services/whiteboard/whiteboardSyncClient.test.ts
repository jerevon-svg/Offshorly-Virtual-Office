import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as roomPresenceClient.test.ts's FakeSocket, plus `connected`
// and `id` because the sync client gates emits on connection state.
class FakeSocket {
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  connected = false;
  id: string | undefined = undefined;
  disconnected = 0;

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
    this.disconnected += 1;
    this.connected = false;
    return this;
  }

  trigger(event: string, payload?: unknown) {
    for (const cb of this.handlers.get(event) ?? []) cb(payload);
  }

  connect(id = "sid-1") {
    this.connected = true;
    this.id = id;
    this.trigger("connect");
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

vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://localhost:8002");

import { joinWhiteboard, type SyncHandlers } from "./whiteboardSyncClient";

function handlers(): SyncHandlers & { statuses: string[] } {
  const statuses: string[] = [];
  return {
    statuses,
    onStatus: (s) => statuses.push(s),
    onSnapshot: vi.fn(),
    onRemoteElements: vi.fn(),
    onAck: vi.fn(),
    onPresence: vi.fn(),
    onPointer: vi.fn(),
  };
}

const snapshot = (boardId: string) => ({ boardId, elements: [], appState: {}, files: {}, version: 1, seq: 0, collaborators: [] });

beforeEach(() => {
  lastFakeSocket = null;
});

describe("joinWhiteboard", () => {
  it("joins on connect, goes live on the snapshot, and re-joins on every reconnect", () => {
    const h = handlers();
    const handle = joinWhiteboard("b1", h)!;
    const sock = lastFakeSocket!;
    expect(h.statuses).toEqual(["connecting"]);

    sock.connect("s1");
    expect(sock.emitted).toEqual([{ event: "whiteboard_join", payload: { boardId: "b1" } }]);
    sock.trigger("whiteboard_snapshot", snapshot("b1"));
    expect(h.onSnapshot).toHaveBeenCalledTimes(1);
    expect(h.statuses).toEqual(["connecting", "live"]);
    expect(handle.selfId()).toBe("s1");

    sock.connected = false;
    sock.trigger("disconnect");
    expect(h.statuses.at(-1)).toBe("reconnecting");
    // Emits while disconnected are dropped — the editor keeps them pending.
    expect(handle.sendElements([{ id: "a", version: 1, versionNonce: 1 }], 1)).toBe(false);
    expect(sock.emitted).toHaveLength(1);

    sock.connect("s2");
    expect(sock.emitted.at(-1)).toEqual({ event: "whiteboard_join", payload: { boardId: "b1" } });
    sock.trigger("whiteboard_snapshot", snapshot("b1"));
    expect(h.onSnapshot).toHaveBeenCalledTimes(2);
    expect(h.statuses.at(-1)).toBe("live");
    expect(handle.selfId()).toBe("s2");
  });

  it("dispatches room events for its own board only", () => {
    const h = handlers();
    joinWhiteboard("b1", h);
    const sock = lastFakeSocket!;
    sock.connect();
    sock.trigger("whiteboard_elements", { boardId: "other", elements: [{ id: "x" }] });
    sock.trigger("whiteboard_elements", { boardId: "b1", elements: [{ id: "a", version: 1, versionNonce: 1 }] });
    sock.trigger("whiteboard_ack", { boardId: "b1", clientSeq: 4, seq: 9 });
    sock.trigger("whiteboard_presence", { boardId: "b1", collaborators: [{ sid: "s9", email: "b@x", username: "b", color: {} }] });
    sock.trigger("whiteboard_pointer", { boardId: "b1", sid: "s9", pointer: { x: 1, y: 2, tool: "pointer" }, button: "up" });
    expect(h.onRemoteElements).toHaveBeenCalledTimes(1);
    expect(h.onRemoteElements).toHaveBeenCalledWith([{ id: "a", version: 1, versionNonce: 1 }]);
    expect(h.onAck).toHaveBeenCalledWith(4);
    expect(h.onPresence).toHaveBeenCalledWith([expect.objectContaining({ sid: "s9" })]);
    expect(h.onPointer).toHaveBeenCalledWith(expect.objectContaining({ sid: "s9", button: "up" }));
  });

  it("sends elements and pointers with the board id while connected, and leaves cleanly", () => {
    const h = handlers();
    const handle = joinWhiteboard("b1", h)!;
    const sock = lastFakeSocket!;
    sock.connect();
    expect(handle.sendElements([{ id: "a", version: 2, versionNonce: 3 }], 5)).toBe(true);
    handle.sendPointer({ pointer: { x: 1, y: 1, tool: "pointer" }, button: "down", selectedElementIds: {} });
    expect(sock.emitted.slice(1)).toEqual([
      { event: "whiteboard_elements", payload: { boardId: "b1", elements: [{ id: "a", version: 2, versionNonce: 3 }], clientSeq: 5 } },
      { event: "whiteboard_pointer", payload: { boardId: "b1", pointer: { x: 1, y: 1, tool: "pointer" }, button: "down", selectedElementIds: {} } },
    ]);
    handle.leave();
    expect(sock.emitted.at(-1)).toEqual({ event: "whiteboard_leave", payload: { boardId: "b1" } });
    expect(sock.disconnected).toBe(1);
  });

  it("reports offline (REST fallback) when the join is refused or the server is unreachable before any join", () => {
    const h1 = handlers();
    joinWhiteboard("b1", h1);
    lastFakeSocket!.connect();
    lastFakeSocket!.trigger("whiteboard_error", { boardId: "b1", code: "forbidden" });
    expect(h1.statuses.at(-1)).toBe("offline");

    const h2 = handlers();
    joinWhiteboard("b1", h2);
    lastFakeSocket!.trigger("connect_error", new Error("refused"));
    expect(h2.statuses.at(-1)).toBe("offline");
  });
});
