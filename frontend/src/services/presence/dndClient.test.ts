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

describe("dndClient", () => {
  it("emits dnd_set with {isDnd: true}", async () => {
    const { emitDndSet } = await import("./dndClient");

    emitDndSet(true);

    expect(lastFakeSocket).not.toBeNull();
    expect(lastFakeSocket!.emitted).toEqual([{ event: "dnd_set", payload: { isDnd: true } }]);
  });

  it("emits dnd_set with {isDnd: false}", async () => {
    const { emitDndSet } = await import("./dndClient");

    emitDndSet(false);

    expect(lastFakeSocket!.emitted).toEqual([{ event: "dnd_set", payload: { isDnd: false } }]);
  });

  it("updates the subscribable snapshot when a dnd_status event arrives", async () => {
    const { emitDndSet, getDndEmailsSnapshot } = await import("./dndClient");

    emitDndSet(true); // opens the connection
    expect(getDndEmailsSnapshot()).toEqual(new Set());

    lastFakeSocket!.trigger("dnd_status", { emails: ["a@example.com", "b@example.com"] });

    expect(getDndEmailsSnapshot()).toEqual(new Set(["a@example.com", "b@example.com"]));
  });

  it("subscribes via useDndEmails and re-renders when a snapshot update arrives", async () => {
    const { useDndEmails } = await import("./dndClient");

    const { result } = renderHook(() => useDndEmails());
    expect(result.current).toEqual(new Set());
    expect(lastFakeSocket).not.toBeNull();

    act(() => {
      lastFakeSocket!.trigger("dnd_status", { emails: ["c@example.com"] });
    });

    expect(result.current).toEqual(new Set(["c@example.com"]));
  });

  it("does not open a connection when there is no auth token", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { emitDndSet } = await import("./dndClient");

    emitDndSet(true);

    expect(lastFakeSocket).toBeNull();
  });
});
