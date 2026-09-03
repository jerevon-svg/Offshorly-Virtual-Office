import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ConversationView, deriveMessageStatus } from "./ConversationView";
import { mockChatService } from "../../services/chat";
import type { AssetLayer } from "../../types/office";
import type { ChatMessage, ChatService, Conversation } from "../../services/chat/types";

function makePeer(id: string): AssetLayer {
  return {
    id,
    kind: "character",
    path: `characters/${id}.png`,
    transform: null,
    name: id,
    x: 100,
    y: 100,
    width: 40,
    height: 60,
  };
}

const SELF_ID = "bon";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ConversationView", () => {
  it("renders existing seeded history from MockChatService", async () => {
    const peer = makePeer("alex");
    const conv = await mockChatService.openConversationWith(peer.id, SELF_ID);
    await mockChatService.sendMessage({
      conversationId: conv.id,
      senderId: SELF_ID,
      text: "seeded message",
    });

    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("seeded message")).toBeInTheDocument();
    });
  });

  it("clicking Send calls the service and appends the own message", async () => {
    const peer = makePeer("arisha");
    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    const textarea = await screen.findByPlaceholderText("Message");
    fireEvent.change(textarea, { target: { value: "hello there" } });
    fireEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(screen.getByText("hello there")).toBeInTheDocument();
    });
  });

  it("shows the echo reply after advancing fake timers, in scrollback order", async () => {
    const peer = makePeer("angelo");
    vi.useFakeTimers();
    const { container } = render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    // Flush the openConversationWith()/getMessages() promise chain (real
    // microtasks — unaffected by fake timers) before interacting.
    await vi.advanceTimersByTimeAsync(0);

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "ping" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await vi.advanceTimersByTimeAsync(0);

    expect(container.textContent).toContain("ping");

    await vi.advanceTimersByTimeAsync(1600);

    const bubbles = container.querySelectorAll('[class*="own"], [class*="peer"]');
    const texts = Array.from(bubbles).map((el) => el.textContent);
    expect(texts[0]).toBe("ping");
    expect(texts).toHaveLength(2);
  });

  it("shows a connecting placeholder while opening the conversation, then the panel once loaded", async () => {
    const peer = makePeer("cold-start");
    let releaseGetMessages: (msgs: import("../../services/chat").ChatMessage[]) => void = () => {};
    const getMessagesSpy = vi
      .spyOn(mockChatService, "getMessages")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseGetMessages = resolve;
          }),
      );

    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Connecting to chat…")).toBeInTheDocument();
    });

    releaseGetMessages([]);

    await waitFor(() => {
      expect(screen.queryByText("Connecting to chat…")).not.toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Message")).toBeInTheDocument();

    getMessagesSpy.mockRestore();
  });

  it("surfaces a Retry affordance and preserves the draft text when sendMessage rejects", async () => {
    const peer = makePeer("flaky");
    const sendMessageSpy = vi
      .spyOn(mockChatService, "sendMessage")
      .mockRejectedValueOnce(new Error("Timed out waiting for the server to confirm this message was sent."));

    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    const textarea = await screen.findByPlaceholderText("Message");
    fireEvent.change(textarea, { target: { value: "will fail" } });
    fireEvent.click(screen.getByLabelText("Send"));

    await waitFor(() => {
      expect(
        screen.getByText("Timed out waiting for the server to confirm this message was sent."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
    // The failed text must not silently vanish — it should still be
    // recoverable from the panel (not require the user to retype it).
    expect(screen.queryByText("will fail")).not.toBeInTheDocument();

    sendMessageSpy.mockRestore();

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByText("will fail")).toBeInTheDocument();
    });
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  it('renders a distinct error banner (not the "waking up" banner) with Retry when connectionState is "error", and wires Retry to reconnect()', async () => {
    const peer = makePeer("broken-auth");
    const reconnectSpy = vi.fn();
    // mockChatService normally has no onConnectionState/getConnectionState/
    // getConnectionError/reconnect (mock mode has no real socket) — stub
    // them on the singleton for this test only, mirroring what a real
    // ChatService in a terminal "error" state would expose.
    (mockChatService as unknown as { getConnectionState: () => string }).getConnectionState = () => "error";
    (mockChatService as unknown as { getConnectionError: () => string }).getConnectionError = () =>
      "invalid token";
    (mockChatService as unknown as { onConnectionState: (cb: (s: string) => void) => () => void }).onConnectionState =
      () => () => {};
    (mockChatService as unknown as { reconnect: () => void }).reconnect = reconnectSpy;

    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Couldn't connect to chat: invalid token/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/Waking up the chat server/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Retry"));
    expect(reconnectSpy).toHaveBeenCalledTimes(1);

    // Clean up the stubs so later tests see mock mode's normal shape again.
    delete (mockChatService as unknown as { getConnectionState?: () => string }).getConnectionState;
    delete (mockChatService as unknown as { getConnectionError?: () => string }).getConnectionError;
    delete (mockChatService as unknown as { onConnectionState?: () => void }).onConnectionState;
    delete (mockChatService as unknown as { reconnect?: () => void }).reconnect;
  });

  describe("onTypingChange (keystroke-driven typing signal)", () => {
    it("never calls onTypingChange merely from rendering/focusing the component, without typing", async () => {
      const peer = makePeer("silent-render");
      const onTypingChange = vi.fn();
      render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} onTypingChange={onTypingChange} />);

      const textarea = await screen.findByPlaceholderText("Message");
      fireEvent.focus(textarea);

      expect(onTypingChange).not.toHaveBeenCalled();
    });

    it("fires onTypingChange(true) on a real keystroke, then onTypingChange(false) after 2.5s of inactivity", async () => {
      vi.useFakeTimers();
      const peer = makePeer("typing-idle");
      const onTypingChange = vi.fn();
      const { container } = render(
        <ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} onTypingChange={onTypingChange} />,
      );
      await vi.advanceTimersByTimeAsync(0);

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "h" } });

      expect(onTypingChange).toHaveBeenCalledWith(true);
      onTypingChange.mockClear();

      await vi.advanceTimersByTimeAsync(2499);
      expect(onTypingChange).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(onTypingChange).toHaveBeenCalledWith(false);
    });

    it("re-arms the inactivity timer on every keystroke instead of firing false early", async () => {
      vi.useFakeTimers();
      const peer = makePeer("typing-rearm");
      const onTypingChange = vi.fn();
      const { container } = render(
        <ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} onTypingChange={onTypingChange} />,
      );
      await vi.advanceTimersByTimeAsync(0);

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "h" } });
      await vi.advanceTimersByTimeAsync(2000);
      fireEvent.change(textarea, { target: { value: "hi" } });
      onTypingChange.mockClear();
      await vi.advanceTimersByTimeAsync(2000);

      expect(onTypingChange).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      expect(onTypingChange).toHaveBeenCalledWith(false);
    });

    it("fires onTypingChange(false) immediately when the composer becomes empty", async () => {
      const peer = makePeer("typing-empty");
      const onTypingChange = vi.fn();
      render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} onTypingChange={onTypingChange} />);

      const textarea = await screen.findByPlaceholderText("Message");
      fireEvent.change(textarea, { target: { value: "h" } });
      expect(onTypingChange).toHaveBeenLastCalledWith(true);

      fireEvent.change(textarea, { target: { value: "" } });
      expect(onTypingChange).toHaveBeenLastCalledWith(false);
    });

    it("sending a message immediately fires onTypingChange(false) and clears the pending inactivity timer", async () => {
      vi.useFakeTimers();
      const peer = makePeer("typing-send");
      const onTypingChange = vi.fn();
      const { container } = render(
        <ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} onTypingChange={onTypingChange} />,
      );
      await vi.advanceTimersByTimeAsync(0);

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hello there" } });
      onTypingChange.mockClear();

      fireEvent.click(screen.getByLabelText("Send"));
      expect(onTypingChange).toHaveBeenCalledWith(false);
      onTypingChange.mockClear();

      // Pending inactivity timer must have been cleared by send — advancing
      // past the 2.5s window must not fire a second, redundant false.
      await vi.advanceTimersByTimeAsync(3000);
      expect(onTypingChange).not.toHaveBeenCalled();
    });
  });
});

function makeMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1",
    conversationId: "conv-1",
    senderId: "bon",
    text: "hi",
    sentAt: "2026-08-14T10:00:00.000Z",
    deliveredTo: [],
    readBy: [],
    mentionedEmails: [],
    reactions: [],
    ...overrides,
  };
}

describe("deriveMessageStatus", () => {
  it("returns sent when no watermarks are set", () => {
    const msg = makeMessage({ sentAt: "2026-08-14T10:00:00.000Z" });
    expect(deriveMessageStatus(msg, "bon", null, null)).toBe("sent");
  });

  it("returns delivered when sentAt is at-or-before peerDeliveredUpTo only", () => {
    const msg = makeMessage({ sentAt: "2026-08-14T10:00:00.000Z" });
    expect(deriveMessageStatus(msg, "bon", "2026-08-14T10:05:00.000Z", null)).toBe("delivered");
  });

  it("returns read when sentAt is at-or-before peerReadUpTo", () => {
    const msg = makeMessage({ sentAt: "2026-08-14T10:00:00.000Z" });
    expect(
      deriveMessageStatus(msg, "bon", "2026-08-14T10:05:00.000Z", "2026-08-14T10:06:00.000Z"),
    ).toBe("read");
  });

  it("returns sent when sentAt is after both watermarks", () => {
    const msg = makeMessage({ sentAt: "2026-08-14T10:10:00.000Z" });
    expect(
      deriveMessageStatus(msg, "bon", "2026-08-14T10:05:00.000Z", "2026-08-14T10:06:00.000Z"),
    ).toBe("sent");
  });

  it("treats exact equality with peerDeliveredUpTo as delivered (inclusive)", () => {
    const msg = makeMessage({ sentAt: "2026-08-14T10:05:00.000Z" });
    expect(deriveMessageStatus(msg, "bon", "2026-08-14T10:05:00.000Z", null)).toBe("delivered");
  });

  it("treats exact equality with peerReadUpTo as read (inclusive)", () => {
    const msg = makeMessage({ sentAt: "2026-08-14T10:06:00.000Z" });
    expect(
      deriveMessageStatus(msg, "bon", "2026-08-14T10:05:00.000Z", "2026-08-14T10:06:00.000Z"),
    ).toBe("read");
  });
});

describe("ConversationView (real mode, status indicators)", () => {
  // Builds a fake real ChatService pre-seeded with history so the panel
  // renders own messages with deliveredTo/readBy already reflecting the
  // peer's watermark (mirrors what RealChatService.getMessages returns).
  function makeFakeRealService(history: ChatMessage[]): ChatService {
    const conv: Conversation = { id: "conv-1", participantIds: ["bon", "alex"], lastMessageAt: history[0]?.sentAt ?? "" };
    return {
      listConversations: async () => [conv],
      getMessages: async () => history,
      sendMessage: async (input) => makeMessage({ id: "new", ...input }),
      openConversationWith: async () => conv,
      onMessage: () => () => {},
      markRead: () => {},
      onUnreadCount: () => () => {},
      markDelivered: () => {},
      onDeliveryReceipt: () => () => {},
      onReadReceipt: () => () => {},
    };
  }

  afterEach(() => {
    vi.doUnmock("../../services/chat");
    vi.resetModules();
  });

  it("shows a read-status marker with a single Seen label on the last read own message, none on peer messages, and nothing in mock mode", async () => {
    const history: ChatMessage[] = [
      makeMessage({
        id: "own-1",
        senderId: "bon",
        text: "first",
        sentAt: "2026-08-14T10:00:00.000Z",
        readBy: ["alex"],
      }),
      makeMessage({
        id: "peer-1",
        senderId: "alex",
        text: "peer reply",
        sentAt: "2026-08-14T10:01:00.000Z",
      }),
      makeMessage({
        id: "own-2",
        senderId: "bon",
        text: "second",
        sentAt: "2026-08-14T10:02:00.000Z",
        readBy: ["alex"],
      }),
    ];

    vi.resetModules();
    vi.doMock("../../services/chat", () => ({
      chatMode: "real",
      chatService: makeFakeRealService(history),
    }));

    const { ConversationView: RealConversationView } = await import("./ConversationView");
    const peer: AssetLayer = {
      id: "alex",
      kind: "character",
      path: "characters/alex.png",
      transform: null,
      name: "alex",
      x: 0,
      y: 0,
      width: 40,
      height: 60,
    };

    render(<RealConversationView peer={peer} selfId="bon" peerChatId="alex" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("second")).toBeInTheDocument();
    });

    // Exactly one "Seen" label, attached to the LAST read own message.
    const seenLabels = screen.getAllByText(/^Seen /);
    expect(seenLabels).toHaveLength(1);

    // Peer message never renders a status marker.
    const peerBubble = screen.getByText("peer reply").closest("div")?.parentElement;
    expect(peerBubble?.querySelector('[data-status]')).toBeNull();
  });

  it("shows no status marker for any message in mock mode", async () => {
    const peer: AssetLayer = {
      id: "morgan",
      kind: "character",
      path: "characters/morgan.png",
      transform: null,
      name: "morgan",
      x: 0,
      y: 0,
      width: 40,
      height: 60,
    };
    const conv = await mockChatService.openConversationWith(peer.id, "bon");
    await mockChatService.sendMessage({
      conversationId: conv.id,
      senderId: "bon",
      text: "mock mode message",
    });

    render(<ConversationView peer={peer} selfId="bon" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("mock mode message")).toBeInTheDocument();
    });

    expect(document.querySelector("[data-status]")).toBeNull();
  });

  describe("pinned DND helper text", () => {
    it("shows 'Expect delayed response' pinned above the composer for a remote DND peer", async () => {
      const peer = makePeer("dndpeer");
      render(
        <ConversationView
          peer={peer}
          selfId={SELF_ID}
          onClose={() => {}}
          subtitle="🔴 DND · Notifications muted"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Expect delayed response")).toBeInTheDocument();
      });
      // Header carries only the short subtitle — the delayed-response line lives separately.
      expect(screen.queryByText(/Expect a delayed response/)).toBeNull();
    });

    it("does not show the helper without a DND subtitle", async () => {
      const peer = makePeer("nodndpeer");
      render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);
      await screen.findByPlaceholderText("Message");

      expect(screen.queryByText("Expect delayed response")).toBeNull();
    });

    it("does not show the helper in spatial chat even with a subtitle", async () => {
      const peer = makePeer("spatialpeer");
      render(
        <ConversationView
          peer={peer}
          selfId={SELF_ID}
          onClose={() => {}}
          subtitle="🔴 DND · Notifications muted"
          isSpatial
        />,
      );
      await screen.findByPlaceholderText("Message");

      expect(screen.queryByText("Expect delayed response")).toBeNull();
    });
  });

  describe("@mentions", () => {
    it("typing @ opens autocomplete suggesting only the other DM participant", async () => {
      const peer = makePeer("alex");
      render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);
      const textarea = await screen.findByPlaceholderText("Message");

      fireEvent.change(textarea, { target: { value: "hi @al", selectionStart: 6 } });

      await waitFor(() => {
        expect(screen.getByRole("option", { name: "alex" })).toBeInTheDocument();
      });
    });

    it("selecting a suggestion inserts @DisplayName and sending includes mentionedEmails", async () => {
      const peer = makePeer("alex");
      render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);
      const textarea = (await screen.findByPlaceholderText("Message")) as HTMLTextAreaElement;

      fireEvent.change(textarea, { target: { value: "hi @al", selectionStart: 6 } });
      const option = await screen.findByRole("option", { name: "alex" });
      fireEvent.mouseDown(option);

      await waitFor(() => expect(textarea.value).toBe("hi @alex "));

      fireEvent.click(screen.getByLabelText("Send"));

      await waitFor(() => {
        // The rendered bubble highlights the mention in its own span (see MentionText.tsx) —
        // confirms the sent message actually carried mentionedEmails through to rendering.
        expect(document.querySelector('[class*="mention"]')).not.toBeNull();
      });
    });

    it("manually typed @text that was never selected from autocomplete sends as plain text", async () => {
      // Distinct peer id from the other @mentions tests — MockChatService reuses the same DM
      // conversation for a given (self, peer) pair across tests in this file (mirrors the real
      // backend's dm_key upsert idempotency), so a shared "alex" peer here would pick up the
      // earlier test's already-sent mention message too.
      const peer = makePeer("nomention");
      render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);
      const textarea = await screen.findByPlaceholderText("Message");

      fireEvent.change(textarea, { target: { value: "hi @randomtext", selectionStart: 14 } });
      fireEvent.click(screen.getByLabelText("Send"));

      await waitFor(() => {
        expect(screen.getByText("hi @randomtext")).toBeInTheDocument();
      });
      expect(document.querySelector('[class*="mention"]')).toBeNull();
    });

    it("Escape closes the autocomplete without sending", async () => {
      const peer = makePeer("alex");
      render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);
      const textarea = await screen.findByPlaceholderText("Message");

      fireEvent.change(textarea, { target: { value: "hi @al", selectionStart: 6 } });
      await screen.findByRole("option", { name: "alex" });

      fireEvent.keyDown(textarea, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("option", { name: "alex" })).toBeNull();
      });
    });
  });
});
