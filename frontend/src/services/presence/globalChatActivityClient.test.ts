import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as dndClient.test.ts's FakeSocket, plus a `connected`
// flag and connect/disconnect triggers so the reconnect re-emit contract can be exercised.
class FakeSocket {
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  connected = true;

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
    this.connected = false;
    return this;
  }

  trigger(event: string, payload?: unknown) {
    if (event === "connect") this.connected = true;
    if (event === "disconnect") this.connected = false;
    for (const cb of this.handlers.get(event) ?? []) cb(payload);
  }

  activeEmits() {
    return this.emitted.filter((e) => e.event === "global_chat_active").map((e) => (e.payload as { isActive: boolean }).isActive);
  }
}

let lastFakeSocket: FakeSocket | null = null;
let nextSocketStartsConnected = true;

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    lastFakeSocket = new FakeSocket();
    lastFakeSocket.connected = nextSocketStartsConnected;
    return lastFakeSocket;
  }),
}));

const getAuthTokenMock = vi.fn(() => "fake-token" as string | null);
vi.mock("../api/client", () => ({
  getAuthToken: () => getAuthTokenMock(),
}));

beforeEach(() => {
  vi.resetModules();
  lastFakeSocket = null;
  nextSocketStartsConnected = true;
  getAuthTokenMock.mockReturnValue("fake-token");
  (import.meta.env as Record<string, string>).VITE_CHAT_SOCKET_URL = "http://localhost:4800";
});

describe("globalChatActivityClient", () => {
  it("emits global_chat_active {isActive: true} and only that event (never a spatial session event)", async () => {
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(true);
    expect(lastFakeSocket?.emitted).toEqual([{ event: "global_chat_active", payload: { isActive: true } }]);
    expect(lastFakeSocket?.emitted.some((e) => e.event.startsWith("spatial_session"))).toBe(false);
  });

  it("emits global_chat_active {isActive: false}", async () => {
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(false);
    expect(lastFakeSocket?.activeEmits()).toEqual([false]);
  });

  it("defers the first emit until the socket connects when io() starts disconnected", async () => {
    nextSocketStartsConnected = false;
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(true);
    expect(lastFakeSocket?.activeEmits()).toEqual([]);
    lastFakeSocket!.trigger("connect");
    expect(lastFakeSocket?.activeEmits()).toEqual([true]);
  });

  it("1. a visible remote window kept open through a reconnect is re-reported as true immediately", async () => {
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(true);
    lastFakeSocket!.trigger("disconnect");
    lastFakeSocket!.trigger("connect");
    expect(lastFakeSocket?.activeEmits()).toEqual([true, true]);
  });

  it("2. no/minimized remote window through a reconnect re-reports false for this socket", async () => {
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(true);
    mod.emitGlobalChatActive(false);
    lastFakeSocket!.trigger("disconnect");
    lastFakeSocket!.trigger("connect");
    expect(lastFakeSocket?.activeEmits()).toEqual([true, false, false]);
  });

  it("5. stable connected state never re-emits for repeated calls with the same value", async () => {
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(true);
    mod.emitGlobalChatActive(true);
    mod.emitGlobalChatActive(true);
    expect(lastFakeSocket?.activeEmits()).toEqual([true]);
    mod.emitGlobalChatActive(false);
    mod.emitGlobalChatActive(false);
    expect(lastFakeSocket?.activeEmits()).toEqual([true, false]);
  });

  it("a value changed while disconnected is sent once on the next connect (no duplicate)", async () => {
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(false);
    lastFakeSocket!.trigger("disconnect");
    mod.emitGlobalChatActive(true); // while offline: nothing sent yet
    expect(lastFakeSocket?.activeEmits()).toEqual([false]);
    lastFakeSocket!.trigger("connect");
    expect(lastFakeSocket?.activeEmits()).toEqual([false, true]);
  });

  it("updates the subscribable snapshot (normalized emails) when a global_chat_activity event arrives", async () => {
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(true);
    lastFakeSocket!.trigger("global_chat_activity", { emails: ["A@Example.com", "b@example.com"] });
    expect(mod.getGlobalChatActiveEmailsSnapshot()).toEqual(new Set(["a@example.com", "b@example.com"]));
    lastFakeSocket!.trigger("global_chat_activity", { emails: [] });
    expect(mod.getGlobalChatActiveEmailsSnapshot().size).toBe(0);
  });

  it("re-renders useGlobalChatActiveEmails subscribers when a snapshot update arrives", async () => {
    const mod = await import("./globalChatActivityClient");
    const { result } = renderHook(() => mod.useGlobalChatActiveEmails());
    expect(result.current.size).toBe(0);
    act(() => {
      lastFakeSocket!.trigger("global_chat_activity", { emails: ["a@example.com"] });
    });
    expect(result.current.has("a@example.com")).toBe(true);
  });

  it("does not open a connection when there is no auth token", async () => {
    getAuthTokenMock.mockReturnValue(null);
    const mod = await import("./globalChatActivityClient");
    mod.emitGlobalChatActive(true);
    expect(lastFakeSocket).toBeNull();
  });
});
