import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_STORAGE_KEY, MockChatService } from "./MockChatService";

beforeEach(() => {
  window.localStorage.clear();
});

describe("MockChatService.openConversationWith", () => {
  it("produces a deterministic id independent of argument order", async () => {
    const service = new MockChatService();
    const a = await service.openConversationWith("alex", "bon");
    const b = new MockChatService();
    const conv = await b.openConversationWith("bon", "alex");
    expect(conv.id).toBe(a.id);
  });

  it("persists conversations to localStorage", async () => {
    const service = new MockChatService();
    await service.openConversationWith("alex", "bon");

    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw as string);
    expect(stored.conversations).toHaveLength(1);
  });
});

describe("MockChatService.sendMessage", () => {
  it("appends a message and returns it", async () => {
    const service = new MockChatService();
    const conv = await service.openConversationWith("alex", "bon");
    const msg = await service.sendMessage({
      conversationId: conv.id,
      senderId: "bon",
      text: "hello",
    });

    expect(msg.text).toBe("hello");
    const messages = await service.getMessages(conv.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(msg.id);
  });

  it("orders messages by sentAt", async () => {
    const service = new MockChatService();
    const conv = await service.openConversationWith("alex", "bon");

    await service.sendMessage({ conversationId: conv.id, senderId: "bon", text: "first" });
    await service.sendMessage({ conversationId: conv.id, senderId: "bon", text: "second" });

    const messages = await service.getMessages(conv.id);
    expect(messages.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("round-trips persisted messages via a fresh service instance", async () => {
    const service = new MockChatService();
    const conv = await service.openConversationWith("alex", "bon");
    await service.sendMessage({ conversationId: conv.id, senderId: "bon", text: "hi" });

    const reloaded = new MockChatService();
    const messages = await reloaded.getMessages(conv.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("hi");
  });

  it("notifies onMessage subscribers on send", async () => {
    const service = new MockChatService();
    const conv = await service.openConversationWith("alex", "bon");
    const cb = vi.fn();
    service.onMessage(cb);

    await service.sendMessage({ conversationId: conv.id, senderId: "bon", text: "hey" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].text).toBe("hey");
  });

  it("unsubscribe stops further notifications", async () => {
    const service = new MockChatService();
    const conv = await service.openConversationWith("alex", "bon");
    const cb = vi.fn();
    const unsubscribe = service.onMessage(cb);
    unsubscribe();

    await service.sendMessage({ conversationId: conv.id, senderId: "bon", text: "hey" });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("MockChatService.onConversationUpgraded", () => {
  it("is not implemented (mock mode has no server-side DM->group upgrade concept) — same optional-listener pattern as onUnreadCount et al", () => {
    const service = new MockChatService();
    expect(service.onConversationUpgraded).toBeUndefined();
  });
});

describe("MockChatService echo reply", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("schedules a mock:true reply from the peer after a user-originated send", async () => {
    const service = new MockChatService();
    const conv = await service.openConversationWith("alex", "bon");
    const cb = vi.fn();
    service.onMessage(cb);

    await service.sendMessage({ conversationId: conv.id, senderId: "bon", text: "hi" });
    expect(cb).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1600);

    const messages = await service.getMessages(conv.id);
    expect(messages).toHaveLength(2);
    const reply = messages[1];
    expect(reply.mock).toBe(true);
    expect(reply.senderId).toBe("alex");
    expect(cb).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("never echoes a mock:true message (no reply loops)", async () => {
    const service = new MockChatService();
    const conv = await service.openConversationWith("alex", "bon");

    await service.sendMessage({ conversationId: conv.id, senderId: "bon", text: "hi" });
    await vi.advanceTimersByTimeAsync(1600);

    // Only the original send + the single echo reply should exist — advancing
    // time further must not produce a second echo of the echo.
    await vi.advanceTimersByTimeAsync(5000);
    const messages = await service.getMessages(conv.id);
    expect(messages).toHaveLength(2);

    vi.useRealTimers();
  });
});
