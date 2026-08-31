import type { ChatMessage, MessageReaction, MessageReactionUpdate } from "./types";

// Pure folding of a realtime `message_reaction` delta into the grouped array a message already
// holds. Lives here (not in a component) because BOTH ConversationView and
// GroupConversationView apply the same delta — and Spatial Chat reuses those two views
// verbatim, so it inherits this with no separate code path.

/** Applies one delta to a single message's grouped reactions, returning a NEW array. */
export function foldReaction(
  reactions: MessageReaction[],
  update: MessageReactionUpdate,
): MessageReaction[] {
  const email = update.reactorEmail.toLowerCase();
  const existing = reactions.find((r) => r.emoji === update.emoji);

  if (update.action === "add") {
    // Idempotent: the server already suppresses no-op re-adds, but a reconnect catch-up could
    // still replay one — never let the same reactor be counted twice.
    if (existing?.reactors.some((r) => r.toLowerCase() === email)) return reactions;
    if (!existing) {
      return [...reactions, { emoji: update.emoji, count: 1, reactors: [email] }];
    }
    const reactors = [...existing.reactors, email].sort();
    return reactions.map((r) =>
      r.emoji === update.emoji ? { ...r, count: reactors.length, reactors } : r,
    );
  }

  if (!existing) return reactions;
  const reactors = existing.reactors.filter((r) => r.toLowerCase() !== email);
  // Last reactor removed — drop the chip entirely rather than leaving a count-0 ghost.
  if (reactors.length === 0) return reactions.filter((r) => r.emoji !== update.emoji);
  return reactions.map((r) =>
    r.emoji === update.emoji ? { ...r, count: reactors.length, reactors } : r,
  );
}

/**
 * Applies a delta across a message list, returning the SAME array reference when the target
 * message isn't present — so a reaction landing in another open conversation's window can't
 * trigger a pointless re-render here.
 */
export function applyReactionUpdate(
  messages: ChatMessage[],
  update: MessageReactionUpdate,
): ChatMessage[] {
  if (!messages.some((m) => m.id === update.messageId)) return messages;
  return messages.map((m) =>
    m.id === update.messageId
      ? { ...m, reactions: foldReaction(m.reactions ?? [], update) }
      : m,
  );
}

/** True when `email` already holds `emoji` on this message — drives the toggle + chip highlight. */
export function hasOwnReaction(
  reactions: MessageReaction[] | undefined,
  emoji: string,
  email: string,
): boolean {
  const self = email.toLowerCase();
  return Boolean(
    reactions
      ?.find((r) => r.emoji === emoji)
      ?.reactors.some((r) => r.toLowerCase() === self),
  );
}
