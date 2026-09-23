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

// The server's registry is in-memory and cleared by this user's disconnect, so a reconnect arrives with
// no DND. spatialSessionStore re-asserts its session on "connect"; this is the same pattern for DND.
describe("dndClient reconnect re-assert", () => {
  // The last test above swapped in a token-less api/client with vi.doMock, which survives resetModules;
  // put the signed-in one back so these connect.
  beforeEach(() => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => "fake-token") }));
  });

  it("re-emits dnd_set true on every (re)connect while DND is still wanted", async () => {
    const { emitDndSet } = await import("./dndClient");
    emitDndSet(true);
    lastFakeSocket!.trigger("connect");
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "dnd_set", payload: { isDnd: true } },
      { event: "dnd_set", payload: { isDnd: true } },
    ]);
  });

  it("does not re-assert after DND was turned off", async () => {
    const { emitDndSet } = await import("./dndClient");
    emitDndSet(true);
    emitDndSet(false);
    lastFakeSocket!.trigger("connect");
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "dnd_set", payload: { isDnd: true } },
      { event: "dnd_set", payload: { isDnd: false } },
    ]);
  });

  it("does not re-assert on a connection that only ever listened", async () => {
    const { useDndEmails } = await import("./dndClient");
    renderHook(() => useDndEmails());
    lastFakeSocket!.trigger("connect");
    expect(lastFakeSocket!.emitted).toEqual([]);
  });

  it("opens no second socket for the re-assert", async () => {
    const { io } = await import("socket.io-client");
    const { emitDndSet } = await import("./dndClient");
    const before = vi.mocked(io).mock.calls.length; // the spy is module-wide and never cleared
    emitDndSet(true);
    lastFakeSocket!.trigger("connect");
    lastFakeSocket!.trigger("connect");
    expect(vi.mocked(io).mock.calls.length).toBe(before + 1);
  });
});

describe("useSelfDndPublication (the shared publisher)", () => {
  // The last test above swapped in a token-less api/client with vi.doMock, which survives resetModules;
  // put the signed-in one back so these connect.
  beforeEach(() => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => "fake-token") }));
  });

  it("publishes nothing on a plain mount when DND is off", async () => {
    const { useSelfDndPublication } = await import("./dndClient");
    renderHook(() => useSelfDndPublication(false));
    expect(lastFakeSocket).toBeNull();
  });

  it("publishes TRUE once on a mount that already finds DND active (reload), then FALSE when it ends", async () => {
    const { useSelfDndPublication } = await import("./dndClient");
    const { rerender } = renderHook(({ on }: { on: boolean }) => useSelfDndPublication(on), { initialProps: { on: true } });
    expect(lastFakeSocket!.emitted).toEqual([{ event: "dnd_set", payload: { isDnd: true } }]);
    rerender({ on: true });
    expect(lastFakeSocket!.emitted).toHaveLength(1);
    rerender({ on: false });
    expect(lastFakeSocket!.emitted).toEqual([
      { event: "dnd_set", payload: { isDnd: true } },
      { event: "dnd_set", payload: { isDnd: false } },
    ]);
  });

  it("emits once per real crossing and nothing on unmount", async () => {
    const { useSelfDndPublication } = await import("./dndClient");
    const { rerender, unmount } = renderHook(({ on }: { on: boolean }) => useSelfDndPublication(on), { initialProps: { on: false } });
    rerender({ on: true });
    rerender({ on: true });
    expect(lastFakeSocket!.emitted).toEqual([{ event: "dnd_set", payload: { isDnd: true } }]);
    unmount();
    expect(lastFakeSocket!.emitted).toHaveLength(1);
  });

  it("what the hook published is what a reconnect re-asserts", async () => {
    const { useSelfDndPublication } = await import("./dndClient");
    renderHook(() => useSelfDndPublication(true));
    lastFakeSocket!.trigger("connect");
    expect(lastFakeSocket!.emitted).toHaveLength(2);
    expect(lastFakeSocket!.emitted[1]).toEqual({ event: "dnd_set", payload: { isDnd: true } });
  });
});
