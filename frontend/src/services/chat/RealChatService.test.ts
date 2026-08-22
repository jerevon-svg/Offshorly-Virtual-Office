import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — records handlers registered via .on(event, cb) so
// tests can simulate server-pushed events, and records .emit calls so tests
// can assert what the client sent.
class FakeSocket {
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  // Real socket.io-client Sockets expose this synchronously-readable
  // property; defaults to true so existing warm-path tests (written before
  // the cold-start handling below existed) keep passing unmodified.
  connected = true;
  // Real socket.io-client Sockets expose this too — true while the manager
  // is (or will be) retrying, false once it has given up (e.g. an
  // auth/namespace connect_error). Defaults to true; tests that exercise
  // the terminal-error path set it to false before triggering connect_error.
  active = true;

  connect() {
    this.connected = true;
  }

  on(event: string, cb: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  once(event: string, cb: (...args: unknown[]) => void) {
    return this.on(event, cb);
  }

  off(event: string, cb: (...args: unknown[]) => void) {
    const list = this.handlers.get(event);
    if (!list) return this;
    this.handlers.set(
      event,
      list.filter((h) => h !== cb),
    );
    return this;
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
    return this;
  }

  trigger(event: string, payload?: unknown) {
    if (event === "connect") this.connected = true;
    if (event === "disconnect") this.connected = false;
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

    // Force the warm (already-connected) path so this exercises the ack
    // timeout specifically, not the connect-wait path.
    await service.getMessages("conv-a__b");
    lastFakeSocket!.connected = true;
    lastFakeSocket!.trigger("connect");

    const sendPromise = service.sendMessage({
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
    });
    const assertion = expect(sendPromise).rejects.toThrow(/timed out/i);

    const SEND_ACK_TIMEOUT_MS = 8000;
    await vi.advanceTimersByTimeAsync(SEND_ACK_TIMEOUT_MS);
    await assertion;
    vi.useRealTimers();
  });

  it("emits nothing while disconnected; connects, then emits exactly once and resolves on ack", async () => {
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");
    lastFakeSocket!.connected = false;

    const sendPromise = service.sendMessage({
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
    });

    expect(lastFakeSocket!.emitted.find((e) => e.event === "send_message")).toBeUndefined();

    lastFakeSocket!.connected = true;
    lastFakeSocket!.trigger("connect");

    await vi.waitFor(() => {
      expect(lastFakeSocket!.emitted.filter((e) => e.event === "send_message")).toHaveLength(1);
    });

    const sent = lastFakeSocket!.emitted.find((e) => e.event === "send_message");
    const clientTempId = (sent!.payload as { clientTempId: string }).clientTempId;
    const savedMessage = {
      id: "msg-2",
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
      sentAt: new Date().toISOString(),
    };
    lastFakeSocket!.trigger("message_saved", { clientTempId, message: savedMessage });

    await expect(sendPromise).resolves.toEqual(savedMessage);
    expect(lastFakeSocket!.emitted.filter((e) => e.event === "send_message")).toHaveLength(1);
  });

  it("rejects on connect timeout when disconnected and connect never fires, without ever emitting", async () => {
    vi.useFakeTimers();
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");
    lastFakeSocket!.connected = false;

    const sendPromise = service.sendMessage({
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
    });
    const assertion = expect(sendPromise).rejects.toThrow(/wak(e|ing)|reach the chat server/i);

    const CONNECT_TIMEOUT_MS = 45000;
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    await assertion;

    expect(lastFakeSocket!.emitted.find((e) => e.event === "send_message")).toBeUndefined();
    vi.useRealTimers();
  });

  it("only starts the 8s ack timeout after connect, not from the moment sendMessage is called", async () => {
    vi.useFakeTimers();
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");
    lastFakeSocket!.connected = false;

    const sendPromise = service.sendMessage({
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
    });

    // Wait most of the connect-timeout window before connecting — if the
    // ack timer had (incorrectly) started at sendMessage() call time, it
    // would already have fired well before this point.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(lastFakeSocket!.emitted.find((e) => e.event === "send_message")).toBeUndefined();

    lastFakeSocket!.connected = true;
    lastFakeSocket!.trigger("connect");
    await vi.advanceTimersByTimeAsync(0);

    expect(lastFakeSocket!.emitted.filter((e) => e.event === "send_message")).toHaveLength(1);

    // Ack timer just armed — shouldn't have rejected yet.
    let settled = false;
    sendPromise.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(7000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await expect(sendPromise).rejects.toThrow(/timed out/i);
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

describe("RealChatService connect_error handling", () => {
  it('sets state to "error" (not stuck at "connecting") and captures the reason when socket.active is false', async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");
    expect(service.getConnectionState()).toBe("connecting");

    lastFakeSocket!.active = false;
    lastFakeSocket!.trigger("connect_error", new Error("invalid token"));

    expect(service.getConnectionState()).toBe("error");
    expect(service.getConnectionState()).not.toBe("connecting");
    expect(service.getConnectionError()).toBe("invalid token");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('sets state to "reconnecting" when socket.active is true (manager will retry on its own)', async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");
    lastFakeSocket!.active = true;
    lastFakeSocket!.trigger("connect_error", new Error("transport close"));

    expect(service.getConnectionState()).toBe("reconnecting");
  });

  it("rejects a send waiting on the cold connect path (instead of hanging to the 45s timeout) when connect_error is terminal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");
    lastFakeSocket!.connected = false;

    const sendPromise = service.sendMessage({
      conversationId: "conv-a__b",
      senderId: "a@example.com",
      text: "hello",
    });

    lastFakeSocket!.active = false;
    lastFakeSocket!.trigger("connect_error", new Error("unauthorized"));

    await expect(sendPromise).rejects.toThrow(/unauthorized/i);
    // No emit before rejection, and none after — exactly-once guarantee
    // must hold even when the connect wait ends in a terminal error.
    expect(lastFakeSocket!.emitted.find((e) => e.event === "send_message")).toBeUndefined();
  });
});

describe("RealChatService typing", () => {
  it("sendTyping emits a 'typing' socket event with the correct payload shape", async () => {
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");
    service.sendTyping({ conversationId: "conv-a__b", isTyping: true });

    const sent = lastFakeSocket!.emitted.find((e) => e.event === "typing");
    expect(sent).toBeTruthy();
    expect(sent!.payload).toEqual({ conversationId: "conv-a__b", isTyping: true });
  });

  it("fans out an inbound 'peer_typing' event to all onTyping listeners with senderEmail mapped to senderId", async () => {
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");

    const received: unknown[] = [];
    const receivedTwo: unknown[] = [];
    service.onTyping((update) => received.push(update));
    service.onTyping((update) => receivedTwo.push(update));

    lastFakeSocket!.trigger("peer_typing", {
      conversationId: "conv-a__b",
      senderEmail: "b@example.com",
      isTyping: true,
    });

    const expected = { conversationId: "conv-a__b", senderId: "b@example.com", isTyping: true };
    expect(received).toEqual([expected]);
    expect(receivedTwo).toEqual([expected]);
  });

  it("stops notifying an onTyping listener after its unsubscribe function is called", async () => {
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await service.getMessages("conv-a__b");

    const received: unknown[] = [];
    const unsubscribe = service.onTyping((update) => received.push(update));
    unsubscribe();

    lastFakeSocket!.trigger("peer_typing", {
      conversationId: "conv-a__b",
      senderEmail: "b@example.com",
      isTyping: false,
    });

    expect(received).toEqual([]);
  });
});

describe("RealChatService missing auth token", () => {
  it("does not open a socket and sets state to \"error\" when no auth token is available", async () => {
    const { getAuthToken } = await import("../api/client");
    vi.mocked(getAuthToken).mockReturnValue(null as unknown as string);
    const { RealChatService } = await import("./RealChatService");
    const service = new RealChatService();

    await expect(
      service.sendMessage({ conversationId: "conv-a__b", senderId: "a@example.com", text: "hi" }),
    ).rejects.toThrow(/not signed in/i);

    expect(service.getConnectionState()).toBe("error");
    // The io() mock (and thus lastFakeSocket) must never have been touched —
    // a doomed handshake shouldn't even attempt a connection.
    expect(lastFakeSocket).toBeNull();
  });
});
