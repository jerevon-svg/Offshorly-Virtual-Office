import type { Conversation } from "../../services/chat/types";

// ---------------------------------------------------------------------------
// World-Space Chat Attention Indicator V1 — pure derivation.
//
// This module owns NO state. The 💬 indicator's existence is derived, every
// render, from the SAME conversation rows the existing HUD unread badge reads
// (services/chat/useUnreadTotal.ts -> `conversations`, whose unreadCount is
// kept live by the backend's unread_count push). There is deliberately no
// second unread/notification store, no local "seen" bookkeeping and no
// message-level tracking: when the server says a conversation's unread count
// hit 0, the indicator's input disappears and so does the indicator.
// ---------------------------------------------------------------------------

/** One coworker's unread state, already collapsed to a single indicator. */
export interface ChatAttention {
  /** The existing conversation to open on click — never a new chat path. */
  conversationId: string;
  /** Summed unread count for that coworker (>= 1 whenever an entry exists). */
  count: number;
}

/**
 * Maps "coworkers who have unread messages waiting for me" onto the CHARACTER
 * LAYER key-space OfficeStage renders in.
 *
 * Layer ids for roster people are their lowercased email (see
 * data/rosterLayers.ts's `id: person.email.trim().toLowerCase()`), which is
 * exactly what statusByLayerId and the peer movement/typing overrides already
 * key on — so no new identity concept is introduced here.
 *
 * Only DMs participate: a group conversation's unread count has no single
 * sender to float above, and the global HUD badge already covers it.
 *
 * The viewer is excluded twice over — by chat identity (`selfEmail`) and by
 * rendered layer (`selfLayerId`, i.e. OfficeMap's playerLayerId) — so the
 * indicator can never appear above your own avatar even in the odd cases
 * where those two differ.
 */
export function buildChatAttentionByLayerId({
  conversations,
  selfEmail,
  selfLayerId,
}: {
  conversations: Conversation[];
  selfEmail: string;
  selfLayerId?: string | null;
}): Record<string, ChatAttention> {
  const self = selfEmail.trim().toLowerCase();
  const selfLayer = selfLayerId?.trim().toLowerCase() ?? null;
  const byLayerId: Record<string, ChatAttention> = {};

  for (const conv of conversations) {
    // Missing type means "dm" — same convention as services/chat/types.ts.
    if ((conv.type ?? "dm") !== "dm") continue;
    const count = conv.unreadCount ?? 0;
    if (count <= 0) continue;
    const peer = conv.participantIds.find((id) => id.trim().toLowerCase() !== self);
    if (!peer) continue;
    const layerId = peer.trim().toLowerCase();
    if (layerId === self || layerId === selfLayer) continue;

    const existing = byLayerId[layerId];
    if (!existing) {
      byLayerId[layerId] = { conversationId: conv.id, count };
      continue;
    }
    // Degenerate case (two DM rows for the same pair): still ONE indicator.
    // Counts sum; the opened conversation is picked deterministically so the
    // click target never flips between renders on row-order changes.
    byLayerId[layerId] = {
      conversationId:
        conv.id < existing.conversationId ? conv.id : existing.conversationId,
      count: existing.count + count,
    };
  }

  return byLayerId;
}

// ---------------------------------------------------------------------------
// Overhead stacking.
//
// OfficeStage renders exactly ONE overhead element per character, by priority
// (greeting > sent chat text > typing dots > status nameplate > nothing) —
// see OfficeStage.tsx. The indicator is an ADDITIVE pass on top of that, so it
// needs to know how tall the element underneath it is in order to sit cleanly
// ABOVE it instead of overlapping.
//
// All values are WORLD px (the indicator, like StatusLabel/TalkingBubble, is a
// plain descendant of the TransformWrapper-scaled stage and carries no
// KeepScale), measured off the shared pill metrics in StatusLabel.module.css /
// TalkingBubble.module.css: head gap + pill height + a 3px separation.
// StatusLabel's nameplate is 2px gap + (font-size 6px x line-height 1.4 +
// 2px padding ~= 10.4px) ~= 15.4 -> 16. TalkingBubble's typing pill keeps the
// 4px gap + 7px x 1.4 + 2px ~= 12px line -> 19; .bubbleText wraps to at most
// 3 lines (-webkit-line-clamp: 3) ~= 32px.
// ---------------------------------------------------------------------------

export type OverheadKind = "greeting" | "sentText" | "typing" | "status" | "none";

export const OVERHEAD_CLEARANCE_PX: Record<OverheadKind, number> = {
  greeting: 39,
  sentText: 39,
  typing: 19,
  status: 16,
  // Nothing overhead at all (e.g. a rendered peer with no known status) —
  // the indicator takes the head gap itself.
  none: 6,
};

/** The single overhead element OfficeStage will render for a character. */
export function resolveOverheadKind({
  isGreeted,
  sentText,
  isTyping,
  hasStatus,
}: {
  isGreeted: boolean;
  sentText?: string;
  isTyping: boolean;
  hasStatus: boolean;
}): OverheadKind {
  if (isGreeted) return "greeting";
  if (sentText) return "sentText";
  if (isTyping) return "typing";
  if (hasStatus) return "status";
  return "none";
}
