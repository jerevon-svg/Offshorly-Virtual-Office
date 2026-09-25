import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChatComposer } from "./ChatComposer";
import { REACTION_EMOJIS } from "./MessageReactions";
import { useMentionComposer } from "./useMentionComposer";
import { getSticker, messageSpeechText, pickableStickers, STICKERS, stickerIdOf } from "../../services/chat/stickers";
import { isAuthoredMessage } from "../../services/chat/types";
import type { ChatMessage, ChatService, Conversation } from "../../services/chat/types";
import type { AssetLayer } from "../../types/office";

// Rich Chat Phase 1 — composer emoji picker + sticker messages, across the shared composer, the DM
// view (mock service, which persists to localStorage like history) and the group view (fake real service).

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.doUnmock("../../services/chat");
  vi.resetModules();
});

function Harness({ initial = "", onSendSticker }: { initial?: string; onSendSticker?: (id: string) => void }) {
  const [draft, setDraft] = useState(initial);
  const mention = useMentionComposer([]);
  return (
    <>
      <ChatComposer
        draft={draft}
        setDraft={setDraft}
        onDraftInput={(text) => setDraft(text)}
        onSend={() => {}}
        onSendSticker={onSendSticker}
        mention={mention}
      />
      <output data-testid="draft">{draft}</output>
    </>
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText("Message") as HTMLTextAreaElement;
}

describe("ChatComposer emoji picker", () => {
  it("inserts at the caret, not at the end", () => {
    render(<Harness initial="helloworld" />);
    textarea().setSelectionRange(5, 5);
    fireEvent.click(screen.getByLabelText("Insert emoji"));
    fireEvent.click(screen.getByLabelText("Insert 😀"));
    expect(screen.getByTestId("draft").textContent).toBe("hello😀world");
  });

  it("replaces the current selection", () => {
    render(<Harness initial="say XXX now" />);
    textarea().setSelectionRange(4, 7);
    fireEvent.click(screen.getByLabelText("Insert emoji"));
    fireEvent.click(screen.getByLabelText("Insert 😀"));
    expect(screen.getByTestId("draft").textContent).toBe("say 😀 now");
  });

  it("closes after a selection, on Escape, and on an outside press", () => {
    render(<Harness />);
    const toggle = screen.getByLabelText("Insert emoji");

    fireEvent.click(toggle);
    fireEvent.click(screen.getByLabelText("Insert 😀"));
    expect(screen.queryByRole("dialog", { name: "Emoji and stickers" })).toBeNull();

    fireEvent.click(toggle);
    const search = screen.getByLabelText("Search emoji");
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(textarea());

    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not let the picker's Escape reach an outer handler", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness />
      </div>,
    );
    fireEvent.click(screen.getByLabelText("Insert emoji"));
    fireEvent.keyDown(screen.getByLabelText("Search emoji"), { key: "Escape" });
    expect(outer).not.toHaveBeenCalled();
  });

  it("searches by keyword and offers categories", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Insert emoji"));
    expect(screen.getByRole("tab", { name: "Food & Drink" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search emoji"), { target: { value: "pizza" } });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Insert 🍕")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Insert 😀")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search emoji"), { target: { value: "zzqq" } });
    expect(within(dialog).getByText("No emoji found")).toBeInTheDocument();
  });

  it("remembers recently used emoji locally", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Insert emoji"));
    fireEvent.click(screen.getByRole("tab", { name: "Food & Drink" }));
    fireEvent.click(screen.getByLabelText("Insert 🍕"));
    fireEvent.click(screen.getByLabelText("Insert emoji"));
    expect(screen.getByRole("tab", { name: "Recently used", selected: true })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText("Insert 🍕")).toBeInTheDocument();
  });

  it("offers a Stickers tab only when the caller can send stickers, and sends by id", () => {
    const onSendSticker = vi.fn();
    const { unmount } = render(<Harness initial="keep me" onSendSticker={onSendSticker} />);
    fireEvent.click(screen.getByLabelText("Emoji and stickers"));
    fireEvent.click(screen.getByRole("tab", { name: "Stickers" }));
    fireEvent.click(screen.getByLabelText("Send sticker: Wave hello"));
    expect(onSendSticker).toHaveBeenCalledWith("wave");
    expect(screen.queryByRole("dialog")).toBeNull();
    // A sticker never touches the draft.
    expect(screen.getByTestId("draft").textContent).toBe("keep me");
    unmount();

    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Insert emoji"));
    expect(screen.queryByRole("tab", { name: "Stickers" })).toBeNull();
  });

  it("leaves the future media actions disabled", () => {
    render(<Harness />);
    for (const label of ["Voice message (coming soon)", "Attach image or file (coming soon)", "Send a GIF (coming soon)"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });
});

describe("sticker registry + reactions separation", () => {
  it("keeps the reaction allowlist exactly as it was", () => {
    expect([...REACTION_EMOJIS]).toEqual(["👍", "❤️", "😂", "😮", "😢", "🎉"]);
  });

  it("resolves known ids, fails soft on unknown or malformed ones", () => {
    expect(getSticker("wave")?.glyph).toBe("👋");
    expect(getSticker("no-such-sticker")).toBeNull();
    expect(stickerIdOf({ kind: "sticker", meta: { stickerId: "<img>" } })).toBeNull();
    expect(stickerIdOf({ kind: "text", meta: null })).toBeNull();
    expect(messageSpeechText({ kind: "sticker", meta: { stickerId: "wave" }, text: "" })).toBe("👋");
    expect(messageSpeechText({ kind: "sticker", meta: { stickerId: "gone" }, text: "" })).toBe("Sticker");
    expect(messageSpeechText({ kind: "text", meta: null, text: "hi" })).toBe("hi");
  });

  it("treats a sticker as authored and every starter id as a valid, unique slug", () => {
    expect(isAuthoredMessage({ kind: "sticker" })).toBe(true);
    expect(isAuthoredMessage({ kind: "call_missed" })).toBe(false);
    const ids = STICKERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,47}$/);
    expect(pickableStickers().length).toBeGreaterThan(0);
  });
});

function makePeer(id: string): AssetLayer {
  return { id, kind: "character", path: `characters/${id}.png`, transform: null, name: id, x: 0, y: 0, width: 40, height: 60 };
}

describe("DM stickers (mock service)", () => {
  it("sends a sticker, keeps the draft, and re-renders it from history after a remount", async () => {
    const { ConversationView } = await import("./ConversationView");
    const peer = makePeer("alex");
    const { unmount } = render(<ConversationView peer={peer} selfId="bon" onClose={() => {}} />);

    fireEvent.change(await screen.findByPlaceholderText("Message"), { target: { value: "draft stays" } });
    fireEvent.click(screen.getByLabelText("Emoji and stickers"));
    fireEvent.click(screen.getByRole("tab", { name: "Stickers" }));
    fireEvent.click(screen.getByLabelText("Send sticker: Celebrate"));

    const sticker = await screen.findByTestId("sticker");
    expect(sticker).toHaveAttribute("data-sticker-id", "celebrate");
    expect(screen.getByPlaceholderText("Message")).toHaveValue("draft stays");
    // Reactions still attach to a sticker message.
    expect(screen.getAllByLabelText("Add a reaction").length).toBeGreaterThan(0);
    unmount();

    render(<ConversationView peer={peer} selfId="bon" onClose={() => {}} />);
    expect(await screen.findByTestId("sticker")).toHaveAttribute("data-sticker-id", "celebrate");
  });

  it("still sends ordinary text", async () => {
    const { ConversationView } = await import("./ConversationView");
    render(<ConversationView peer={makePeer("arisha")} selfId="bon" onClose={() => {}} />);
    fireEvent.change(await screen.findByPlaceholderText("Message"), { target: { value: "plain text" } });
    fireEvent.click(screen.getByLabelText("Send"));
    expect(await screen.findByText("plain text")).toBeInTheDocument();
    expect(screen.queryByTestId("sticker")).toBeNull();
  });
});

const SELF = "bon@example.com";
const CONV = "conv-group-1";

function groupMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1", conversationId: CONV, senderId: SELF, text: "", sentAt: "2026-09-25T10:00:00.000Z",
    deliveredTo: [], readBy: [], mentionedEmails: [], reactions: [], kind: "text", meta: null,
    ...overrides,
  };
}

async function mountGroup(history: ChatMessage[]) {
  const listeners = new Set<(msg: ChatMessage) => void>();
  const conv: Conversation = { id: CONV, participantIds: [SELF, "alex@example.com", "lui@example.com"], lastMessageAt: "", type: "group" };
  const service = {
    listConversations: async () => [conv],
    getMessages: vi.fn(async () => history),
    sendMessage: vi.fn(async (input: { text: string; stickerId?: string }) =>
      groupMessage({ id: "sent-1", text: input.text, kind: input.stickerId ? "sticker" : "text", meta: input.stickerId ? { stickerId: input.stickerId } : null }),
    ),
    openConversationWith: vi.fn(),
    onMessage: (cb: (msg: ChatMessage) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    markRead: vi.fn(),
    markDelivered: vi.fn(),
    onDeliveryReceipt: () => () => {},
    onReadReceipt: () => () => {},
  } as unknown as ChatService;
  vi.resetModules();
  vi.doMock("../../services/chat", () => ({ chatMode: "real", chatService: service }));
  const { GroupConversationView } = await import("./GroupConversationView");
  render(
    <GroupConversationView
      conversationId={CONV}
      selfId={SELF}
      participantEmails={[SELF, "alex@example.com", "lui@example.com"]}
      resolveDisplayName={(e: string) => e.split("@")[0]}
      onClose={() => {}}
    />,
  );
  return { service, emit: (msg: ChatMessage) => act(() => listeners.forEach((cb) => cb(msg))) };
}

describe("group stickers", () => {
  it("renders stickers from history, with a fallback for an unknown id, alongside text", async () => {
    await mountGroup([
      groupMessage({ id: "h1", kind: "sticker", meta: { stickerId: "wave" }, senderId: "alex@example.com" }),
      groupMessage({ id: "h2", kind: "sticker", meta: { stickerId: "retired-long-ago" }, sentAt: "2026-09-25T10:01:00.000Z" }),
      groupMessage({ id: "h3", text: "normal words", sentAt: "2026-09-25T10:02:00.000Z" }),
    ]);
    expect(await screen.findByTestId("sticker")).toHaveAttribute("data-sticker-id", "wave");
    expect(screen.getByTestId("sticker-missing")).toHaveTextContent("Sticker unavailable");
    expect(screen.getByText("normal words")).toBeInTheDocument();
  });

  it("sends a sticker by id with empty text and no mentions", async () => {
    const { service } = await mountGroup([]);
    fireEvent.click(await screen.findByLabelText("Emoji and stickers"));
    fireEvent.click(screen.getByRole("tab", { name: "Stickers" }));
    fireEvent.click(screen.getByLabelText("Send sticker: Thank you"));
    await waitFor(() =>
      expect(service.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: CONV, text: "", stickerId: "thanks", mentionedEmails: [] }),
      ),
    );
  });

  it("renders a sticker received live through the realtime subscription", async () => {
    const { emit } = await mountGroup([]);
    await screen.findByPlaceholderText("Message");
    emit(groupMessage({ id: "live-1", senderId: "lui@example.com", kind: "sticker", meta: { stickerId: "on-it" } }));
    expect(await screen.findByTestId("sticker")).toHaveAttribute("data-sticker-id", "on-it");
  });
});
