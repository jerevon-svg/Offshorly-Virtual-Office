import { describe, expect, it } from "vitest";
import { applyReactionUpdate, foldReaction, hasOwnReaction } from "./reactions";
import type { ChatMessage, MessageReactionUpdate } from "./types";

// Pure folding logic shared by ConversationView, GroupConversationView and (by reuse of those
// two views) Spatial Chat.

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    conversationId: "conv-1",
    senderId: "a@example.com",
    text: "hi",
    sentAt: "2026-08-31T10:00:00.000Z",
    deliveredTo: [],
    readBy: [],
    mentionedEmails: [],
    reactions: [],
    ...overrides,
  };
}

function update(overrides: Partial<MessageReactionUpdate> = {}): MessageReactionUpdate {
  return {
    messageId: "m1",
    emoji: "👍",
    reactorEmail: "b@example.com",
    action: "add",
    ...overrides,
  };
}

describe("foldReaction", () => {
  it("creates a new group for the first reactor", () => {
    expect(foldReaction([], update())).toEqual([
      { emoji: "👍", count: 1, reactors: ["b@example.com"] },
    ]);
  });

  it("aggregates a second reactor into the same emoji group", () => {
    const first = foldReaction([], update());
    const second = foldReaction(first, update({ reactorEmail: "c@example.com" }));
    expect(second).toEqual([
      { emoji: "👍", count: 2, reactors: ["b@example.com", "c@example.com"] },
    ]);
  });

  it("keeps different emojis from the same user as separate groups", () => {
    const first = foldReaction([], update());
    const second = foldReaction(first, update({ emoji: "🎉" }));
    expect(second.map((r) => r.emoji)).toEqual(["👍", "🎉"]);
    expect(second.every((r) => r.count === 1)).toBe(true);
  });

  it("is idempotent — a replayed add never double-counts a reactor", () => {
    const first = foldReaction([], update());
    expect(foldReaction(first, update())).toBe(first);
  });

  it("removes only the named reactor", () => {
    const two = foldReaction(foldReaction([], update()), update({ reactorEmail: "c@example.com" }));
    expect(foldReaction(two, update({ action: "remove" }))).toEqual([
      { emoji: "👍", count: 1, reactors: ["c@example.com"] },
    ]);
  });

  it("drops the group entirely when the last reactor leaves", () => {
    const one = foldReaction([], update());
    expect(foldReaction(one, update({ action: "remove" }))).toEqual([]);
  });

  it("ignores a remove for an emoji nobody holds", () => {
    expect(foldReaction([], update({ action: "remove" }))).toEqual([]);
  });

  it("matches reactors case-insensitively", () => {
    const one = foldReaction([], update({ reactorEmail: "B@Example.com" }));
    expect(foldReaction(one, update({ action: "remove" }))).toEqual([]);
  });
});

describe("applyReactionUpdate", () => {
  it("updates only the target message", () => {
    const messages = [msg({ id: "m1" }), msg({ id: "m2" })];
    const next = applyReactionUpdate(messages, update({ messageId: "m2" }));
    expect(next[0].reactions).toEqual([]);
    expect(next[1].reactions).toEqual([
      { emoji: "👍", count: 1, reactors: ["b@example.com"] },
    ]);
  });

  it("returns the same array reference when the message isn't in this list", () => {
    const messages = [msg({ id: "m1" })];
    expect(applyReactionUpdate(messages, update({ messageId: "other" }))).toBe(messages);
  });

  it("tolerates a message with no reactions field (older cached row)", () => {
    const legacy = { ...msg(), reactions: undefined } as unknown as ChatMessage;
    const next = applyReactionUpdate([legacy], update());
    expect(next[0].reactions).toEqual([{ emoji: "👍", count: 1, reactors: ["b@example.com"] }]);
  });
});

describe("hasOwnReaction", () => {
  it("detects the caller's own reaction case-insensitively", () => {
    const groups = [{ emoji: "👍", count: 1, reactors: ["b@example.com"] }];
    expect(hasOwnReaction(groups, "👍", "B@Example.com")).toBe(true);
    expect(hasOwnReaction(groups, "👍", "c@example.com")).toBe(false);
    expect(hasOwnReaction(groups, "🎉", "b@example.com")).toBe(false);
    expect(hasOwnReaction(undefined, "👍", "b@example.com")).toBe(false);
  });
});
