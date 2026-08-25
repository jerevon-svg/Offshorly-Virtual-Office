import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatMode, chatService } from "./index";
import type { Conversation } from "./types";

// Live per-conversation unread counts + a summed total, for the
// notification-badge placeholder (frontend/src/components/Chat/
// MessageNotificationBadge.tsx). Mock mode has no real unread semantics —
// this hook just reports an empty/zero state there rather than attempting
// any of the real-mode wiring below.
export interface UnreadConversation {
  conversationId: string;
  /** The other participant's email — undefined for the rare case of a
   *  malformed/self-only conversation row. */
  peerId?: string;
  count: number;
}

export interface UnreadTotalState {
  /** Sum of every conversation's unread count — what the badge renders. */
  total: number;
  /** Conversations with count > 0, for the placeholder click-through list. */
  unreadConversations: UnreadConversation[];
  /** ALL conversations (dm and group alike, including 0-unread), sorted by
   *  lastMessageAt descending — for the full conversation-list UI (Stage
   *  B1). Populated from the same conversationsRef this hook already
   *  maintains for peer-id resolution. Empty in mock mode, same gating as
   *  everything else in this hook. */
  conversations: Conversation[];
  /** Stage B2: manually re-fetches the conversation list — used when a live
   *  event (e.g. conversation_upgraded) means a brand-new conversation exists
   *  that this hook wouldn't otherwise learn about until some unrelated
   *  future unread-count push. No-op promise in mock mode (chatMode !== "real"
   *  guard below, same as everywhere else in this hook). */
  refetch: () => Promise<void>;
}

export function useUnreadTotal(selfId: string): UnreadTotalState {
  const [countsByConversation, setCountsByConversation] = useState<Record<string, number>>({});
  // Keyed by conversationId — holds enough of each Conversation to resolve
  // a peer id for the click-through list. Filled from the initial fetch;
  // refetched wholesale if a live push ever references a conversation this
  // tab hasn't seen yet (e.g. a brand-new conversation created elsewhere).
  const conversationsRef = useRef<Record<string, Conversation>>({});
  // Same data as conversationsRef, but as state so the full-list consumer
  // (Stage B1's conversation-list UI) re-renders when it changes — the ref
  // alone is invisible to React. Only unread PUSH updates (onUnreadCount)
  // mutate countsByConversation without a refetch, and those never change
  // the underlying conversation set, so this only needs to be set here.
  const [conversationsList, setConversationsList] = useState<Conversation[]>([]);

  const refetch = useCallback(() => {
    return chatService.listConversations().then((conversations: Conversation[]) => {
      const byId: Record<string, Conversation> = {};
      const counts: Record<string, number> = {};
      for (const conv of conversations) {
        byId[conv.id] = conv;
        if (conv.unreadCount) counts[conv.id] = conv.unreadCount;
      }
      conversationsRef.current = byId;
      setConversationsList(conversations);
      setCountsByConversation(counts);
    });
  }, []);

  useEffect(() => {
    if (chatMode !== "real") return;
    let cancelled = false;

    void refetch();

    const unsubscribe = chatService.onUnreadCount?.(({ conversationId, count }) => {
      if (cancelled) return;
      if (!(conversationId in conversationsRef.current)) {
        // Unknown conversation (e.g. its first-ever message just arrived) —
        // refetch to pick up its participantIds, then let the fetch's own
        // setCountsByConversation apply the latest counts.
        void refetch();
        return;
      }
      setCountsByConversation((prev) => {
        if (count <= 0) {
          if (!(conversationId in prev)) return prev;
          const next = { ...prev };
          delete next[conversationId];
          return next;
        }
        return { ...prev, [conversationId]: count };
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [refetch]);

  const total = useMemo(
    () => Object.values(countsByConversation).reduce((sum, n) => sum + n, 0),
    [countsByConversation],
  );

  const unreadConversations = useMemo<UnreadConversation[]>(() => {
    return Object.entries(countsByConversation)
      .filter(([, count]) => count > 0)
      .map(([conversationId, count]) => {
        const conv = conversationsRef.current[conversationId];
        const peerId = conv?.participantIds.find((id) => id.toLowerCase() !== selfId.toLowerCase());
        return { conversationId, peerId, count };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsByConversation, selfId]);

  // Overlay live push-driven counts (countsByConversation) onto the fetched
  // list so a conversation's badge count in the full list stays current
  // between refetches, then sort most-recently-active first.
  const conversations = useMemo<Conversation[]>(() => {
    return conversationsList
      .map((conv) => ({
        ...conv,
        unreadCount: countsByConversation[conv.id] ?? 0,
      }))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [conversationsList, countsByConversation]);

  return { total, unreadConversations, conversations, refetch };
}
