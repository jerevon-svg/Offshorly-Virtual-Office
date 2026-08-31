import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import type {
  ChatMessage,
  ChatService,
  Conversation,
  MessageReactionListener,
  MessageReactionUpdate,
} from "../../services/chat/types";

// ONE component under test, mounted through BOTH conversation renderers — that shared mounting
// is exactly why Spatial Chat needs no reaction implementation of its own: it renders these
// same two views (see OfficeMap.tsx's spatial window slot).

afterEach(() => {
  cleanup();
  vi.doUnmock("../../services/chat");
  vi.resetModules();
});

const SELF = "bon@example.com";
const PEER = "alex@example.com";
const THIRD = "lui@example.com";
const CONVERSATION_ID = "conv-1";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversationId: CONVERSATION_ID,
    senderId: PEER,
    text: "hi",
    sentAt: "2026-08-31T10:00:00.000Z",
    deliveredTo: [],
    readBy: [],
    mentionedEmails: [],
    reactions: [],
    ...overrides,
  };
}

/** Fake service with a live `message_reaction` channel the test can drive. */
function makeFakeService(overrides: Partial<ChatService> = {}) {
  const conv: Conversation = {
    id: CONVERSATION_ID,
    participantIds: [SELF, PEER, THIRD],
    lastMessageAt: "2026-08-31T10:00:00.000Z",
    type: "group",
  };
  const reactionListeners = new Set<MessageReactionListener>();
  const addReaction = vi.fn();
  const removeReaction = vi.fn();

  const service = {
    listConversations: async () => [conv],
    getMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async () => makeMessage()),
    openConversationWith: vi.fn(async () => conv),
    onMessage: () => () => {},
    markRead: vi.fn(),
    markDelivered: vi.fn(),
    onDeliveryReceipt: () => () => {},
    onReadReceipt: () => () => {},
    addReaction,
    removeReaction,
    onMessageReaction: (cb: MessageReactionListener) => {
      reactionListeners.add(cb);
      return () => reactionListeners.delete(cb);
    },
    ...overrides,
  } as unknown as ChatService;

  return {
    service,
    addReaction,
    removeReaction,
    emitReaction(update: MessageReactionUpdate) {
      act(() => reactionListeners.forEach((cb) => cb(update)));
    },
  };
}

async function mountDm(service: ChatService) {
  vi.resetModules();
  vi.doMock("../../services/chat", () => ({ chatMode: "real", chatService: service }));
  const { ConversationView } = await import("./ConversationView");
  return render(
    <ConversationView
      peer={{ id: "alex", name: "Alex", path: "" } as never}
      peerChatId={PEER}
      selfId={SELF}
      onClose={() => {}}
    />,
  );
}

async function mountGroup(service: ChatService) {
  vi.resetModules();
  vi.doMock("../../services/chat", () => ({ chatMode: "real", chatService: service }));
  const { GroupConversationView } = await import("./GroupConversationView");
  return render(
    <GroupConversationView
      conversationId={CONVERSATION_ID}
      selfId={SELF}
      participantEmails={[SELF, PEER, THIRD]}
      resolveDisplayName={(email) => email.split("@")[0]}
      onClose={() => {}}
    />,
  );
}

describe("MessageReactions in ConversationView (DM)", () => {
  it("renders grouped emoji with a count from hydrated history", async () => {
    const history = [
      makeMessage({
        id: "h1",
        text: "hello",
        reactions: [
          { emoji: "👍", count: 2, reactors: [PEER, THIRD] },
          { emoji: "🎉", count: 1, reactors: [PEER] },
        ],
      }),
    ];
    const { service } = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountDm(service);

    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    // One chip per distinct emoji, each carrying its aggregated count.
    expect(screen.getByRole("button", { name: /👍 2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /🎉 1/ })).toBeInTheDocument();
  });

  it("adds a reaction via the picker, then toggles it off by clicking the chip", async () => {
    const history = [makeMessage({ id: "h1", text: "hello" })];
    const { service, addReaction, removeReaction, emitReaction } = makeFakeService({
      getMessages: vi.fn(async () => history),
    });

    await mountDm(service);
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Add a reaction" }));
    fireEvent.click(screen.getByRole("button", { name: "React with 👍" }));

    expect(addReaction).toHaveBeenCalledWith({
      messageId: "h1",
      emoji: "👍",
      reactorEmail: SELF,
    });
    // No optimistic apply — the chip only exists once the server echoes back.
    expect(screen.queryByRole("button", { name: /👍 1/ })).not.toBeInTheDocument();

    emitReaction({ messageId: "h1", emoji: "👍", reactorEmail: SELF, action: "add" });

    const chip = await screen.findByRole("button", { name: /👍 1/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");

    // Clicking your own chip removes it rather than adding a duplicate.
    fireEvent.click(chip);
    expect(removeReaction).toHaveBeenCalledWith({
      messageId: "h1",
      emoji: "👍",
      reactorEmail: SELF,
    });
    expect(addReaction).toHaveBeenCalledTimes(1);

    emitReaction({ messageId: "h1", emoji: "👍", reactorEmail: SELF, action: "remove" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /👍 1/ })).not.toBeInTheDocument(),
    );
  });

  it("folds another participant's realtime reaction into the existing message", async () => {
    const history = [makeMessage({ id: "h1", text: "hello" })];
    const { service, emitReaction } = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountDm(service);
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());

    emitReaction({ messageId: "h1", emoji: "👍", reactorEmail: PEER, action: "add" });
    const chip = await screen.findByRole("button", { name: /👍 1/ });
    // Someone else's reaction — not highlighted as our own.
    expect(chip).toHaveAttribute("aria-pressed", "false");

    emitReaction({ messageId: "h1", emoji: "👍", reactorEmail: SELF, action: "add" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /👍 2/ })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("exposes reactor names on hover, labelling the caller as You", async () => {
    const history = [
      makeMessage({
        id: "h1",
        text: "hello",
        reactions: [{ emoji: "👍", count: 2, reactors: [PEER, SELF] }],
      }),
    ];
    const { service } = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountDm(service);
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /👍 2/ })).toHaveAttribute(
      "title",
      expect.stringContaining("You"),
    );
  });
});

describe("MessageReactions in GroupConversationView", () => {
  it("renders grouped reactions from history", async () => {
    const history = [
      makeMessage({
        id: "g1",
        text: "hello group",
        reactions: [{ emoji: "👍", count: 2, reactors: [PEER, THIRD] }],
      }),
    ];
    const { service } = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountGroup(service);

    await waitFor(() => expect(screen.getByText("hello group")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /👍 2/ })).toBeInTheDocument();
  });

  it("applies a realtime reaction and toggles the caller's own", async () => {
    const history = [makeMessage({ id: "g1", text: "hello group" })];
    const { service, addReaction, emitReaction } = makeFakeService({
      getMessages: vi.fn(async () => history),
    });

    await mountGroup(service);
    await waitFor(() => expect(screen.getByText("hello group")).toBeInTheDocument());

    emitReaction({ messageId: "g1", emoji: "🎉", reactorEmail: THIRD, action: "add" });
    await screen.findByRole("button", { name: /🎉 1/ });

    fireEvent.click(screen.getByRole("button", { name: /🎉 1/ }));
    // Caller doesn't hold 🎉 yet, so clicking the chip ADDS rather than removes.
    expect(addReaction).toHaveBeenCalledWith({
      messageId: "g1",
      emoji: "🎉",
      reactorEmail: SELF,
    });

    emitReaction({ messageId: "g1", emoji: "🎉", reactorEmail: SELF, action: "add" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /🎉 2/ })).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("uses resolveDisplayName for the hover tooltip", async () => {
    const history = [
      makeMessage({
        id: "g1",
        text: "hello group",
        reactions: [{ emoji: "👍", count: 1, reactors: [THIRD] }],
      }),
    ];
    const { service } = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountGroup(service);
    await waitFor(() => expect(screen.getByText("hello group")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /👍 1/ })).toHaveAttribute(
      "title",
      "lui reacted with 👍",
    );
  });
});

describe("mock parity", () => {
  it("MockChatService add/remove drives the same listener contract the views consume", async () => {
    vi.resetModules();
    const { MockChatService } = await import("../../services/chat/MockChatService");
    const mock = new MockChatService();

    const conv = await mock.openConversationWith(PEER, SELF);
    const sent = await mock.sendMessage({
      conversationId: conv.id,
      senderId: SELF,
      text: "hi there",
    });
    expect(sent.reactions).toEqual([]);

    const seen: MessageReactionUpdate[] = [];
    const unsubscribe = mock.onMessageReaction((u) => seen.push(u));

    mock.addReaction({ messageId: sent.id, emoji: "👍", reactorEmail: SELF });
    // Duplicate is suppressed locally, exactly as the server suppresses it.
    mock.addReaction({ messageId: sent.id, emoji: "👍", reactorEmail: SELF });
    mock.addReaction({ messageId: sent.id, emoji: "👍", reactorEmail: PEER });

    let history = await mock.getMessages(conv.id);
    expect(history.find((m) => m.id === sent.id)?.reactions).toEqual([
      { emoji: "👍", count: 2, reactors: [PEER, SELF].sort() },
    ]);

    mock.removeReaction({ messageId: sent.id, emoji: "👍", reactorEmail: SELF });
    history = await mock.getMessages(conv.id);
    expect(history.find((m) => m.id === sent.id)?.reactions).toEqual([
      { emoji: "👍", count: 1, reactors: [PEER] },
    ]);

    expect(seen.map((u) => u.action)).toEqual(["add", "add", "remove"]);
    unsubscribe();
  });
});
