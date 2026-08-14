import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — records handlers registered via .on(event, cb) so
// tests can simulate server-pushed events, and records .emit calls so tests
// can assert what the client sent.
class FakeSocket {
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  emitted: Array<{ event: string; payload: unknown }> = [];

  on(event: string, cb: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  once(event: string, cb: (...args: unknown[]) => void) {
    return this.on(event, cb);
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
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

const originalEnv = { ...import.meta.env };

beforeEach(() => {
  vi.resetModules();
  lastFakeSocket = null;
  (import.meta.env as Record<string, string>).VITE_CHAT_SOCKET_URL = "http://localhost:4800";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(import.meta.env, originalEnv);
});

describe("RealChatService.sendMessage", () => {
  it("resolves with the saved message once message_saved arrives for its clientTempId", async () => {
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    const sendPromise = service.sendMessage({
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
    });

    expect(lastFakeSocket).not.toBeNull();
    const sent = lastFakeSocket!.emitted.find((e) => e.event === "send_message");
    expect(sent).toBeTruthy();
    const clientTempId = (sent!.payload as { clientTempId: string }).clientTempId;

    const savedMessage = {
      id: "msg-1",
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
      sentAt: new Date().toISOString(),
    };
    lastFakeSocket!.trigger("message_saved", { clientTempId, message: savedMessage });

    await expect(sendPromise).resolves.toEqual(savedMessage);
  });

  it("rejects if no message_saved ack arrives before the timeout", async () => {
    vi.useFakeTimers();
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    const sendPromise = service.sendMessage({
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
    });
    const assertion = expect(sendPromise).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    vi.useRealTimers();
  });
});

describe("RealChatService.onMessage", () => {
  it("fires registered listeners for both message_saved and incoming_message", async () => {
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    // Establish the socket connection (any public method that calls
    // this.socket() internally works — getMessages does).
    await service.getMessages("conv-a__b");

    const received: unknown[] = [];
    service.onMessage((msg) => received.push(msg));

    const savedMsg = {
      id: "m1",
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "own",
      sentAt: new Date().toISOString(),
    };
    const incomingMsg = {
      id: "m2",
      conversationId: "conv-a__b",
      senderId: "b@example.com",
      text: "peer",
      sentAt: new Date(Date.now() + 1).toISOString(),
    };

    lastFakeSocket!.trigger("message_saved", { clientTempId: "unrelated", message: savedMsg });
    lastFakeSocket!.trigger("incoming_message", { message: incomingMsg });

    expect(received).toEqual([savedMsg, incomingMsg]);
  });
});

describe("RealChatService reconnect handling", () => {
  it("refetches messages since the last-seen timestamp for the active conversation on reconnect", async () => {
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");

    const received: unknown[] = [];
    service.onMessage((msg) => received.push(msg));

    const firstMsg = {
      id: "m1",
      conversationId: "conv-a__b",
      senderId: "b@example.com",
      text: "before disconnect",
      sentAt: "2026-01-01T00:00:00.000Z",
    };
    lastFakeSocket!.trigger("incoming_message", { message: firstMsg });

    const missedMsg = {
      id: "m2",
      conversationId: "conv-a__b",
      senderId: "b@example.com",
      text: "missed while offline",
      sentAt: "2026-01-01T00:01:00.000Z",
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [missedMsg],
    });

    lastFakeSocket!.trigger("disconnect");
    lastFakeSocket!.trigger("connect");
    // catch-up fetch is async (await fetch + await res.json()) — poll rather
    // than guess how many microtask ticks that chain needs.
    await vi.waitFor(() => expect(received).toHaveLength(2));

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const catchUpCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/messages?since="),
    );
    expect(catchUpCall).toBeTruthy();
    const url = catchUpCall![0] as string;
    expect(url).toContain(encodeURIComponent(firstMsg.sentAt));
    expect(received[1]).toEqual(missedMsg);
  });
});
