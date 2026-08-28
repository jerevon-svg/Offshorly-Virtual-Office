import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ChatMessage, ChatService, Conversation } from "../../services/chat/types";

afterEach(() => {
  cleanup();
  vi.doUnmock("../../services/chat");
  vi.resetModules();
});

const SELF = "bon@example.com";
const OTHER_A = "alex@example.com";
const OTHER_B = "lui@example.com";
const CONVERSATION_ID = "conv-group-1";

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1",
    conversationId: CONVERSATION_ID,
    senderId: SELF,
    text: "hi",
    sentAt: "2026-08-22T10:00:00.000Z",
    deliveredTo: [],
    readBy: [],
    mentionedEmails: [],
    ...overrides,
  };
}

function resolveDisplayName(email: string): string {
  return email.split("@")[0];
}

function makeFakeService(overrides: Partial<ChatService> = {}): ChatService {
  const conv: Conversation = {
    id: CONVERSATION_ID,
    participantIds: [SELF, OTHER_A, OTHER_B],
    lastMessageAt: "2026-08-22T10:00:00.000Z",
    type: "group",
  };
  const listeners = new Set<(msg: ChatMessage) => void>();
  return {
    listConversations: async () => [conv],
    getMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async (input: { conversationId: string; senderId: string; text: string }) =>
      makeMessage({ id: `new-${Date.now()}`, ...input }),
    ),
    openConversationWith: vi.fn(async () => {
      throw new Error("GroupConversationView must never call openConversationWith");
    }),
    onMessage: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    markRead: vi.fn(),
    markDelivered: vi.fn(),
    onDeliveryReceipt: () => () => {},
    onReadReceipt: () => () => {},
    ...overrides,
  } as ChatService;
}

async function mountWith(service: ChatService, extraProps: Record<string, unknown> = {}) {
  vi.resetModules();
  vi.doMock("../../services/chat", () => ({
    chatMode: "real",
    chatService: service,
  }));
  const { GroupConversationView } = await import("./GroupConversationView");
  return render(
    <GroupConversationView
      conversationId={CONVERSATION_ID}
      selfId={SELF}
      participantEmails={[SELF, OTHER_A, OTHER_B]}
      resolveDisplayName={resolveDisplayName}
      onClose={() => {}}
      {...extraProps}
    />,
  );
}

describe("GroupConversationView", () => {
  it("calls getMessages(conversationId) exactly once on mount and renders the returned history", async () => {
    const history = [makeMessage({ id: "h1", text: "hello group", senderId: OTHER_A })];
    const getMessages = vi.fn(async () => history);
    const service = makeFakeService({ getMessages });

    await mountWith(service);

    await waitFor(() => expect(screen.getByText("hello group")).toBeInTheDocument());
    expect(getMessages).toHaveBeenCalledTimes(1);
    expect(getMessages).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("never calls openConversationWith or any conversation-creation path", async () => {
    const openConversationWith = vi.fn();
    const service = makeFakeService({ openConversationWith });

    await mountWith(service);
    await waitFor(() => expect(service.getMessages).toHaveBeenCalled());

    expect(openConversationWith).not.toHaveBeenCalled();
  });

  it("fires onConversationOpen exactly once", async () => {
    const service = makeFakeService();
    const onConversationOpen = vi.fn();

    const { rerender } = await mountWith(service, { onConversationOpen });
    await waitFor(() => expect(service.getMessages).toHaveBeenCalled());
    expect(onConversationOpen).toHaveBeenCalledTimes(1);
    expect(onConversationOpen).toHaveBeenCalledWith(CONVERSATION_ID);

    const { GroupConversationView } = await import("./GroupConversationView");
    rerender(
      <GroupConversationView
        conversationId={CONVERSATION_ID}
        selfId={SELF}
        participantEmails={[SELF, OTHER_A, OTHER_B]}
        resolveDisplayName={resolveDisplayName}
        onClose={() => {}}
        onConversationOpen={onConversationOpen}
        title="renamed re-render trigger"
      />,
    );

    expect(onConversationOpen).toHaveBeenCalledTimes(1);
  });

  it("appends an incoming message for this conversationId, ignoring one for a different id", async () => {
    let deliver: ((msg: ChatMessage) => void) | undefined;
    const service = makeFakeService({
      onMessage: (cb) => {
        deliver = cb;
        return () => {};
      },
    });

    await mountWith(service);
    await waitFor(() => expect(service.getMessages).toHaveBeenCalled());

    deliver?.(makeMessage({ id: "own-conv", text: "belongs here", senderId: OTHER_A }));
    deliver?.(makeMessage({ id: "other-conv", text: "belongs elsewhere", conversationId: "conv-different", senderId: OTHER_A }));

    await waitFor(() => expect(screen.getByText("belongs here")).toBeInTheDocument());
    expect(screen.queryByText("belongs elsewhere")).not.toBeInTheDocument();
  });

  it("sends via sendMessage with the correct conversationId", async () => {
    const sendMessage = vi.fn(async (input: { conversationId: string; senderId: string; text: string }) =>
      makeMessage({ id: "sent-1", ...input }),
    );
    const service = makeFakeService({ sendMessage });

    await mountWith(service);
    await waitFor(() => expect(service.getMessages).toHaveBeenCalled());

    const textarea = screen.getByPlaceholderText("Type a message…");
    fireEvent.change(textarea, { target: { value: "hey team" } });
    fireEvent.click(screen.getByLabelText("Send"));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        senderId: SELF,
        text: "hey team",
        mentionedEmails: [],
      }),
    );
  });

  it("shows the title prop in the header when present", async () => {
    const service = makeFakeService();
    await mountWith(service, { title: "Project Chat" });
    await waitFor(() => expect(service.getMessages).toHaveBeenCalled());
    expect(screen.getByText("Project Chat")).toBeInTheDocument();
  });

  it("falls back to joined non-self participant display names when title is absent", async () => {
    const service = makeFakeService();
    await mountWith(service);
    await waitFor(() => expect(service.getMessages).toHaveBeenCalled());
    expect(screen.getByText("alex, lui")).toBeInTheDocument();
  });

  it("shows a reader's initial-avatar under the own message once read, no plain text label", async () => {
    const history = [
      makeMessage({ id: "own-1", senderId: SELF, text: "hey", readBy: [OTHER_A] }),
    ];
    const service = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountWith(service);
    await waitFor(() => expect(screen.getByText("hey")).toBeInTheDocument());

    expect(screen.getByTestId("seen-stack")).toBeInTheDocument();
    expect(screen.getByTestId("seen-stack")).toHaveTextContent("A");
    expect(screen.queryByText(/Read by/)).not.toBeInTheDocument();
  });

  it("anchors each reader's avatar to the newest own message they've read, not duplicated", async () => {
    const history = [
      makeMessage({
        id: "own-1",
        senderId: SELF,
        text: "first",
        sentAt: "2026-08-22T10:00:00.000Z",
        readBy: [OTHER_A, OTHER_B],
      }),
      makeMessage({
        id: "own-2",
        senderId: SELF,
        text: "second",
        sentAt: "2026-08-22T10:01:00.000Z",
        readBy: [OTHER_A],
      }),
    ];
    const service = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountWith(service);
    await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());

    const stacks = screen.getAllByTestId("seen-stack");
    expect(stacks).toHaveLength(2);
    // OTHER_A read the newer message ("second") -> anchored there only.
    expect(stacks[1]).toHaveTextContent("A");
    // OTHER_B never read "second", only "first" -> anchored to "first".
    expect(stacks[0]).toHaveTextContent("L");
    expect(stacks[1]).not.toHaveTextContent("L");
  });

  it("shows all readers' avatars in one stack when everyone has read the latest message, no delivery text", async () => {
    const history = [
      makeMessage({ id: "own-1", senderId: SELF, text: "hi all", readBy: [OTHER_A, OTHER_B] }),
    ];
    const service = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountWith(service);
    await waitFor(() => expect(screen.getByText("hi all")).toBeInTheDocument());

    const stack = screen.getByTestId("seen-stack");
    expect(stack).toHaveTextContent("A");
    expect(stack).toHaveTextContent("L");
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
  });

  it("overflows past MAX_VISIBLE_READERS into a +N badge", async () => {
    const readers = ["a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"];
    const history = [makeMessage({ id: "own-1", senderId: SELF, text: "big group", readBy: readers })];
    const service = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountWith(service, { participantEmails: [SELF, ...readers] });
    await waitFor(() => expect(screen.getByText("big group")).toBeInTheDocument());

    const stack = screen.getByTestId("seen-stack");
    expect(stack.querySelectorAll('[data-initials-avatar="true"]')).toHaveLength(4);
    expect(stack).toHaveTextContent("+1");
  });

  it("shows delivered fallback text with no avatar stack when nobody has read the latest message", async () => {
    const history = [
      makeMessage({ id: "own-1", senderId: SELF, text: "delivered only", deliveredTo: [OTHER_A], readBy: [] }),
    ];
    const service = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountWith(service);
    await waitFor(() => expect(screen.getByText("delivered only")).toBeInTheDocument());

    expect(screen.getByText("Delivered to 1")).toBeInTheDocument();
    expect(screen.queryByTestId("seen-stack")).not.toBeInTheDocument();
  });

  it("shows Sent fallback text with no avatar stack when nothing delivered or read", async () => {
    const history = [
      makeMessage({ id: "own-1", senderId: SELF, text: "brand new", deliveredTo: [], readBy: [] }),
    ];
    const service = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountWith(service);
    await waitFor(() => expect(screen.getByText("brand new")).toBeInTheDocument());

    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.queryByTestId("seen-stack")).not.toBeInTheDocument();
  });

  it("does not render a seen-stack under a peer's message, and shows no receipt UI at all in mock mode", async () => {
    const history = [
      makeMessage({ id: "peer-1", senderId: OTHER_A, text: "peer msg", readBy: [SELF, OTHER_B] }),
    ];
    const service = makeFakeService({ getMessages: vi.fn(async () => history) });

    await mountWith(service);
    await waitFor(() => expect(screen.getByText("peer msg")).toBeInTheDocument());
    expect(screen.queryByTestId("seen-stack")).not.toBeInTheDocument();

    cleanup();
    vi.resetModules();
    vi.doMock("../../services/chat", () => ({
      chatMode: "mock",
      chatService: makeFakeService({ getMessages: vi.fn(async () => [makeMessage({ id: "own-1", senderId: SELF, text: "mock own", readBy: [OTHER_A] })]) }),
    }));
    const { GroupConversationView: MockView } = await import("./GroupConversationView");
    render(
      <MockView
        conversationId={CONVERSATION_ID}
        selfId={SELF}
        participantEmails={[SELF, OTHER_A, OTHER_B]}
        resolveDisplayName={resolveDisplayName}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText("mock own")).toBeInTheDocument());
    expect(screen.queryByTestId("seen-stack")).not.toBeInTheDocument();
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
  });
});

describe("computeSeenByMessage", () => {
  it("buckets each reader under their own newest-read own-message id", async () => {
    const { computeSeenByMessage } = await import("./GroupConversationView");
    const messages: ChatMessage[] = [
      makeMessage({ id: "own-1", senderId: SELF, sentAt: "2026-08-22T10:00:00.000Z", readBy: [OTHER_A, OTHER_B] }),
      makeMessage({ id: "own-2", senderId: SELF, sentAt: "2026-08-22T10:01:00.000Z", readBy: [OTHER_A] }),
    ];
    const result = computeSeenByMessage(messages, SELF, [OTHER_A, OTHER_B]);
    expect(result.get("own-2")).toEqual([OTHER_A]);
    expect(result.get("own-1")).toEqual([OTHER_B]);
  });

  it("ignores a reader's presence in a peer message's readBy — only own messages count as anchors", async () => {
    const { computeSeenByMessage } = await import("./GroupConversationView");
    const messages: ChatMessage[] = [
      makeMessage({ id: "peer-1", senderId: OTHER_A, sentAt: "2026-08-22T09:00:00.000Z", readBy: [OTHER_B] }),
      makeMessage({ id: "own-1", senderId: SELF, sentAt: "2026-08-22T10:00:00.000Z", readBy: [] }),
    ];
    const result = computeSeenByMessage(messages, SELF, [OTHER_A, OTHER_B]);
    expect(result.size).toBe(0);
  });

  it("never includes self as a reader of their own messages", async () => {
    const { computeSeenByMessage } = await import("./GroupConversationView");
    const messages: ChatMessage[] = [
      makeMessage({ id: "own-1", senderId: SELF, readBy: [SELF, OTHER_A] }),
    ];
    const result = computeSeenByMessage(messages, SELF, [SELF, OTHER_A]);
    expect(result.get("own-1")).toEqual([OTHER_A]);
  });

  it("compares emails case-insensitively", async () => {
    const { computeSeenByMessage } = await import("./GroupConversationView");
    const messages: ChatMessage[] = [
      makeMessage({ id: "own-1", senderId: SELF, readBy: ["ALEX@EXAMPLE.COM"] }),
    ];
    const result = computeSeenByMessage(messages, SELF, [OTHER_A]);
    expect(result.get("own-1")).toEqual([OTHER_A]);
  });
});

describe("deriveGroupDeliveryLabel", () => {
  it("returns null when readBy is non-empty", async () => {
    const { deriveGroupDeliveryLabel } = await import("./GroupConversationView");
    const msg = makeMessage({ readBy: [OTHER_A], deliveredTo: [OTHER_A] });
    expect(deriveGroupDeliveryLabel(msg, 2)).toBeNull();
  });

  it('returns "Delivered" when everyone (given the count) has received it', async () => {
    const { deriveGroupDeliveryLabel } = await import("./GroupConversationView");
    const msg = makeMessage({ readBy: [], deliveredTo: [OTHER_A, OTHER_B] });
    expect(deriveGroupDeliveryLabel(msg, 2)).toBe("Delivered");
  });

  it("returns Delivered to N for a partial count", async () => {
    const { deriveGroupDeliveryLabel } = await import("./GroupConversationView");
    const msg = makeMessage({ readBy: [], deliveredTo: [OTHER_A] });
    expect(deriveGroupDeliveryLabel(msg, 2)).toBe("Delivered to 1");
  });

  it('returns "Sent" when both arrays are empty', async () => {
    const { deriveGroupDeliveryLabel } = await import("./GroupConversationView");
    const msg = makeMessage({ readBy: [], deliveredTo: [] });
    expect(deriveGroupDeliveryLabel(msg, 2)).toBe("Sent");
  });

  describe("@mentions", () => {
    it("typing @ suggests the other GC participants, not the whole roster", async () => {
      const service = makeFakeService();
      await mountWith(service);
      await waitFor(() => expect(service.getMessages).toHaveBeenCalled());

      const textarea = screen.getByPlaceholderText("Type a message…");
      fireEvent.change(textarea, { target: { value: "@", selectionStart: 1 } });

      await waitFor(() => {
        expect(screen.getByRole("option", { name: "alex" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "lui" })).toBeInTheDocument();
      });
      // Only the two OTHER participants — never the sender themselves.
      expect(screen.queryByRole("option", { name: "bon" })).toBeNull();
    });

    it("selecting one candidate mentions only that employee, not the other participant", async () => {
      const sendMessage = vi.fn(async (input: { conversationId: string; senderId: string; text: string; mentionedEmails?: string[] }) =>
        makeMessage({ id: "sent-mention", ...input }),
      );
      const service = makeFakeService({ sendMessage });
      await mountWith(service);
      await waitFor(() => expect(service.getMessages).toHaveBeenCalled());

      const textarea = screen.getByPlaceholderText("Type a message…") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hey @al", selectionStart: 7 } });
      const option = await screen.findByRole("option", { name: "alex" });
      fireEvent.mouseDown(option);

      await waitFor(() => expect(textarea.value).toBe("hey @alex "));

      fireEvent.click(screen.getByLabelText("Send"));

      await waitFor(() =>
        // handleSend() trims the draft before sending, so the trailing space insertMention adds
        // is gone by the time sendMessage is called.
        expect(sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ text: "hey @alex", mentionedEmails: [OTHER_A] }),
        ),
      );
      const [call] = sendMessage.mock.calls;
      expect(call[0].mentionedEmails).not.toContain(OTHER_B);
    });
  });
});
