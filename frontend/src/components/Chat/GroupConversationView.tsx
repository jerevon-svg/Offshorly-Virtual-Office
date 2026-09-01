import { useEffect, useRef, useState } from "react";
import { chatMode, chatService } from "../../services/chat";
import type { ChatMessage, ConnectionState } from "../../services/chat";
import type { DeliveryReceiptUpdate, ReadReceiptUpdate } from "../../services/chat/types";
import { ChatWindowHeader } from "./ChatWindowHeader";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { renderMessageText } from "./MentionText";
import { useMentionComposer } from "./useMentionComposer";
import styles from "./ConversationView.module.css";

export type GroupConversationViewProps = {
  conversationId: string;
  selfId: string;
  participantEmails: string[];
  title?: string | null;
  resolveDisplayName: (email: string) => string;
  selfAvatarUrl?: string;
  onClose: () => void;
  // Optional status line shown under the name (e.g. "3 members") — omitted when unknown.
  subtitle?: string;
  // True for a "Character -> Chat" spatial conversation — shows the "📍 Spatial Conversation"
  // header badge. False/omitted for a Global Chat (remote) window.
  isSpatial?: boolean;
  // Collapses the window to just its header row — same conversation stays mounted.
  minimized?: boolean;
  onMinimizeToggle?: () => void;
  onIncomingMessage?: (msg: ChatMessage) => void;
  // Fired exactly once, the moment this panel mounts for a given
  // conversationId — mirrors ConversationView's onConversationOpen "fire
  // once" contract (see its doc comment), used by callers to start a
  // spatial session. This panel is only ever handed an EXISTING
  // conversationId (never creates one), so there's no async resolve step —
  // the guard exists purely to survive an unrelated re-render, not an async
  // race.
  onConversationOpen?: (conversationId: string) => void;
  onTypingChange?: (isTyping: boolean) => void;
};

const TYPING_IDLE_MS = 2500;

function formatDayDivider(sentAt: string): string {
  const date = new Date(sentAt);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function formatMessageTime(sentAt: string): string {
  return new Date(sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// TEMPORARY, mirrors ConversationView's own ALWAYS_USE_INITIALS flag — see
// its comment. Kept in sync manually since these two files intentionally
// duplicate this small bit of render logic rather than sharing a module.
const ALWAYS_USE_INITIALS = true;

function Avatar({ src, label, className }: { src?: string; label: string; className?: string }) {
  if (src && !ALWAYS_USE_INITIALS) {
    return <img className={className} src={src} alt="" />;
  }
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className={className} data-initials-avatar="true">
      {initial}
    </div>
  );
}

// Messenger-style per-reader avatar stacks (per approved spec): each OTHER
// participant's avatar appears exactly once, positioned under the NEWEST of
// your own messages that they've read up to — not repeated on every message
// they've read. Show up to MAX_VISIBLE_READERS avatars, then a "+N" overflow
// badge. Only used for own messages (showStatus gate at the call site).
const MAX_VISIBLE_READERS = 4; // show up to 4 avatars, then a "+N" overflow badge

// For each of your own messages, figure out which other participants' "newest
// read" lands on that message — i.e., for each other participant, scan your
// own messages newest-to-oldest and find the first one whose readBy
// (case-insensitive) includes them; that's their anchor message. Returns a
// map from message id -> array of reader emails anchored there (preserving
// otherParticipants' original order within each bucket).
export function computeSeenByMessage(
  messages: ChatMessage[],
  selfId: string,
  otherParticipants: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const ownMessagesNewestFirst = messages
    .filter((m) => m.senderId === selfId)
    .slice()
    .reverse();
  for (const email of otherParticipants) {
    const lowerEmail = email.toLowerCase();
    if (lowerEmail === selfId.toLowerCase()) continue;
    for (const msg of ownMessagesNewestFirst) {
      const readByLower = msg.readBy.map((r) => r.toLowerCase());
      if (readByLower.includes(lowerEmail)) {
        const bucket = result.get(msg.id) ?? [];
        bucket.push(email);
        result.set(msg.id, bucket);
        break;
      }
    }
  }
  return result;
}

// Live receipt merge (real mode). A read_receipt/delivery_receipt is a per-conversation
// watermark from ONE participant (readerEmail/recipientEmail — server-verified, never
// client-supplied); history's readBy/deliveredTo are the server's derivation of exactly these
// watermarks (compute_message_receipts), so mirroring them here keeps live state identical to
// what a reopen would fetch. Immutable: returns the same array when nothing changes so React
// state/memo stays stable. Rules — only the CURRENT USER's own messages are touched (peers'
// arrays are never inferred); only messages with sentAt <= upTo (inclusive, matching the
// server's >=); case-insensitive dedupe; a missing identity (legacy server) or self identity
// is a no-op.
export function applyReceiptToMessages(
  messages: ChatMessage[],
  selfId: string,
  field: "readBy" | "deliveredTo",
  participantEmail: string | undefined,
  upTo: string,
): ChatMessage[] {
  const who = participantEmail?.trim().toLowerCase();
  if (!who || who === selfId.toLowerCase()) return messages;
  let changed = false;
  const next = messages.map((m) => {
    if (m.senderId !== selfId || m.sentAt > upTo) return m;
    if (m[field].some((e) => e.toLowerCase() === who)) return m;
    changed = true;
    return { ...m, [field]: [...m[field], who] };
  });
  return changed ? next : messages;
}

// For the LATEST own message only: returns null if anyone has read it
// (avatars handle that case), otherwise returns a plain delivery/sent status
// string.
export function deriveGroupDeliveryLabel(
  latestOwnMsg: ChatMessage,
  otherParticipantCount: number,
): string | null {
  if (latestOwnMsg.readBy.length > 0) return null;
  const deliveredCount = latestOwnMsg.deliveredTo.length;
  if (otherParticipantCount > 0 && deliveredCount >= otherParticipantCount) return "Delivered";
  if (deliveredCount > 0) return `Delivered to ${deliveredCount}`;
  return "Sent";
}

function SeenAvatarStack({
  readers,
  resolveDisplayName,
}: {
  readers: string[];
  resolveDisplayName: (email: string) => string;
}) {
  const visible = readers.slice(0, MAX_VISIBLE_READERS);
  const overflow = readers.length - visible.length;
  return (
    <div
      className={styles.seenAvatarStack}
      data-testid="seen-stack"
      aria-label={`Seen by ${readers.map(resolveDisplayName).join(", ")}`}
    >
      {visible.map((email) => (
        <Avatar key={email} className={styles.seenAvatar} label={resolveDisplayName(email)} />
      ))}
      {overflow > 0 && <span className={styles.seenOverflow}>+{overflow}</span>}
    </div>
  );
}

export function GroupConversationView({
  conversationId,
  selfId,
  participantEmails,
  title,
  resolveDisplayName,
  selfAvatarUrl,
  onClose,
  subtitle,
  isSpatial,
  minimized,
  onMinimizeToggle,
  onIncomingMessage,
  onConversationOpen,
  onTypingChange,
}: GroupConversationViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isOpening, setIsOpening] = useState(true);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    chatService.getConnectionState?.() ?? "connected",
  );
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<number | undefined>(undefined);
  // Fire-once guard for onConversationOpen — see ConversationView's
  // analogous guard/doc comment for the rationale (must survive unrelated
  // re-renders without re-firing).
  const hasFiredOpenRef = useRef(false);

  const otherParticipants = participantEmails.filter(
    (e) => e.toLowerCase() !== selfId.toLowerCase(),
  );
  const headerTitle = title ?? otherParticipants.map(resolveDisplayName).join(", ");

  // @mentions V1: GC autocomplete offers the current conversation's OTHER participants only —
  // never the whole company roster (same "existing conversation" scoping as the DM case).
  const mention = useMentionComposer(
    otherParticipants.map((email) => ({ email, displayName: resolveDisplayName(email) })),
  );

  useEffect(() => {
    return () => {
      window.clearTimeout(typingTimerRef.current);
    };
  }, []);

  // Mount effect: open by EXISTING id only — never openConversationWith/any
  // creation path. getMessages() does double duty (fetch history + rejoin
  // the socket room server-side), per Stage A's confirmed contract.
  useEffect(() => {
    let cancelled = false;
    setIsOpening(true);
    if (!hasFiredOpenRef.current) {
      hasFiredOpenRef.current = true;
      onConversationOpen?.(conversationId);
    }
    chatService
      .getMessages(conversationId)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(msgs);
      })
      .finally(() => {
        if (!cancelled) setIsOpening(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!chatService.onConnectionState) return;
    setConnectionState(chatService.getConnectionState?.() ?? "connected");
    return chatService.onConnectionState(setConnectionState);
  }, []);

  useEffect(() => {
    const unsubscribe = chatService.onMessage((msg) => {
      if (msg.conversationId !== conversationId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      });
      onIncomingMessage?.(msg);
    });
    return unsubscribe;
  }, [conversationId, onIncomingMessage]);

  // Live read/delivery receipts — real-mode only (mock has no server-side receipt tracking).
  // Same subscription shape as ConversationView's, but merged into per-message readBy/
  // deliveredTo (see applyReceiptToMessages) since a group has to attribute each receipt to a
  // specific participant's avatar rather than a single implied peer.
  useEffect(() => {
    if (chatMode !== "real") return;
    const unsubscribeRead = chatService.onReadReceipt?.((update: ReadReceiptUpdate) => {
      if (update.conversationId !== conversationId) return;
      setMessages((prev) => applyReceiptToMessages(prev, selfId, "readBy", update.readerEmail, update.readUpTo));
    });
    const unsubscribeDelivery = chatService.onDeliveryReceipt?.((update: DeliveryReceiptUpdate) => {
      if (update.conversationId !== conversationId) return;
      setMessages((prev) =>
        applyReceiptToMessages(prev, selfId, "deliveredTo", update.recipientEmail, update.deliveredUpTo),
      );
    });
    return () => {
      unsubscribeRead?.();
      unsubscribeDelivery?.();
    };
  }, [conversationId, selfId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Marks read/delivered up to the latest visible message — same "being
  // open IS viewed" simple v1 semantics as ConversationView.
  useEffect(() => {
    if (chatMode !== "real" || messages.length === 0) return;
    const latest = messages[messages.length - 1];
    chatService.markRead?.({ conversationId, upToSentAt: latest.sentAt });
    chatService.markDelivered?.({ conversationId, upToSentAt: latest.sentAt });
  }, [conversationId, messages]);

  function handleDraftChange(text: string) {
    setDraft(text);
    window.clearTimeout(typingTimerRef.current);
    if (text.length === 0) {
      onTypingChange?.(false);
      chatService.sendTyping?.({ conversationId, isTyping: false });
      return;
    }
    onTypingChange?.(true);
    chatService.sendTyping?.({ conversationId, isTyping: true });
    typingTimerRef.current = window.setTimeout(() => {
      onTypingChange?.(false);
      chatService.sendTyping?.({ conversationId, isTyping: false });
    }, TYPING_IDLE_MS);
  }

  function sendText(text: string) {
    window.clearTimeout(typingTimerRef.current);
    onTypingChange?.(false);
    chatService.sendTyping?.({ conversationId, isTyping: false });
    setSendError(null);
    setFailedText(null);
    const mentionedEmails = mention.mentionsForSend(text);
    chatService.sendMessage({ conversationId, senderId: selfId, text, mentionedEmails }).catch((err: Error) => {
      setSendError(err?.message || "Failed to send message.");
      setFailedText(text);
    });
  }

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    sendText(text);
    mention.resetAfterSend();
  }

  function handleRetry() {
    if (!failedText) return;
    sendText(failedText);
  }

  function handleReconnect() {
    chatService.reconnect?.();
  }

  const isNotConnected = connectionState !== "connected";
  const isConnectionError = connectionState === "error";
  const showOpeningPlaceholder = isOpening && messages.length === 0;
  let lastDayLabel: string | null = null;
  const seenByMessage = computeSeenByMessage(messages, selfId, otherParticipants);
  const ownMessages = messages.filter((m) => m.senderId === selfId);
  const latestOwnId = ownMessages.length ? ownMessages[ownMessages.length - 1].id : null;

  return (
    <div className={minimized ? `${styles.panel} ${styles.panelMinimized}` : styles.panel}>
      <ChatWindowHeader
        name={headerTitle}
        subtitle={subtitle}
        isSpatial={isSpatial}
        minimized={minimized}
        onMinimizeToggle={onMinimizeToggle}
        onClose={onClose}
      />
      {!minimized && (
      <>
      {isConnectionError ? (
        <div className={styles.errorBanner}>
          <span>
            Couldn't connect to chat: {chatService.getConnectionError?.() ?? "connection error"}
          </span>
          <button type="button" className={styles.retryButton} onClick={handleReconnect}>
            Retry
          </button>
        </div>
      ) : (
        isNotConnected && (
          <div className={styles.connectionBanner}>
            Waking up the chat server — this can take up to a minute after a period of inactivity.
          </div>
        )
      )}
      <div className={styles.messages}>
        {showOpeningPlaceholder ? (
          <div className={styles.message}>Connecting to chat…</div>
        ) : (
          messages.map((msg) => {
            const dayLabel = formatDayDivider(msg.sentAt);
            const showDivider = dayLabel !== lastDayLabel;
            lastDayLabel = dayLabel;
            const isOwn = msg.senderId === selfId;
            const senderName = isOwn ? "" : resolveDisplayName(msg.senderId);
            const showStatus = chatMode === "real" && isOwn;
            const readersHere = isOwn ? seenByMessage.get(msg.id) : undefined;
            const deliveryLabel =
              showStatus && msg.id === latestOwnId
                ? deriveGroupDeliveryLabel(msg, otherParticipants.length)
                : null;
            return (
              <div key={msg.id} className={styles.messageGroup}>
                {showDivider && (
                  <div className={styles.dayDivider}>
                    <hr className={styles.dayDividerLine} />
                    <span className={styles.dayDividerLabel}>{dayLabel}</span>
                    <hr className={styles.dayDividerLine} />
                  </div>
                )}
                <div className={isOwn ? `${styles.row} ${styles.rowSelf}` : styles.row}>
                  {!isOwn && <Avatar className={styles.avatar} label={senderName} />}
                  <div className={styles.bubbleColumn}>
                    {!isOwn && <span className={styles.timestamp}>{senderName}</span>}
                    <div className={isOwn ? `${styles.message} ${styles.own}` : `${styles.message} ${styles.peer}`}>
                      {renderMessageText(msg.text, msg.mentionedEmails, resolveDisplayName, selfId)}
                    </div>
                    <span className={isOwn ? `${styles.timestamp} ${styles.timestampRight}` : styles.timestamp}>
                      {formatMessageTime(msg.sentAt)}
                    </span>
                    {showStatus && readersHere && readersHere.length > 0 && (
                      <SeenAvatarStack readers={readersHere} resolveDisplayName={resolveDisplayName} />
                    )}
                    {deliveryLabel && (
                      <span className={styles.statusRow} data-status={deliveryLabel}>
                        {deliveryLabel}
                      </span>
                    )}
                  </div>
                  {isOwn && <Avatar className={styles.avatar} src={selfAvatarUrl || undefined} label={selfId} />}
                </div>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>
      {sendError && (
        <div className={styles.sendError}>
          <span>{sendError}</span>
          <button type="button" className={styles.retryButton} onClick={handleRetry}>
            Retry
          </button>
        </div>
      )}
      <div className={styles.composer}>
        {mention.trigger && mention.filtered.length > 0 && (
          <MentionAutocomplete
            candidates={mention.filtered}
            highlightedIndex={mention.highlightedIndex}
            onHover={mention.setHighlightedIndex}
            onSelect={(c) => mention.selectCandidate(c, draft, setDraft)}
          />
        )}
        <textarea
          ref={mention.textareaRef}
          className={styles.textarea}
          value={draft}
          placeholder={isNotConnected ? "Connecting…" : "Type a message…"}
          onChange={(e) => {
            handleDraftChange(e.target.value);
            mention.onDraftChanged(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (mention.trigger && mention.filtered.length > 0 && e.key === "Enter") {
              e.preventDefault();
              mention.selectCandidate(mention.filtered[mention.highlightedIndex], draft, setDraft);
              return;
            }
            if (mention.handleKeyDown(e)) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button type="button" className={styles.sendButton} onClick={handleSend} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M3 11.5L21 3l-7.5 18-2.5-7.5L3 11.5z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>
      </>
      )}
    </div>
  );
}

export default GroupConversationView;
