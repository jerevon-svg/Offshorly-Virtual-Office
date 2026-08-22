import { useEffect, useRef, useState } from "react";
import { formatCharacterName } from "../../data/office-layout";
import { chatMode, chatService } from "../../services/chat";
import type { ChatMessage, ConnectionState } from "../../services/chat";
import type { AssetLayer } from "../../types/office";
import styles from "./ConversationView.module.css";

type ConversationViewProps = {
  peer: AssetLayer;
  selfId: string;
  // Peer identity used for actual routing (openConversationWith/message
  // send/receive) — `peer` stays display-only (name/avatar). Undefined
  // falls back to `peer.id` for callers that haven't been updated yet
  // (keeps the mock path's pre-Phase-3 behavior unchanged). `null` means
  // "no stable identity is available for this person" — real mode disables
  // opening a chat rather than silently routing on a sprite/layer id.
  peerChatId?: string | null;
  // The current user's own sprite/preview image, for the small avatar shown
  // next to their own messages. Display-only — falls back to an initials
  // circle when omitted or empty.
  selfAvatarUrl?: string;
  onClose: () => void;
  onIncomingMessage?: (msg: ChatMessage) => void;
  // Fired ONLY from real composer keystroke activity (onChange) and the
  // send/unmount paths below — never from a focus/mount/open effect. true on
  // any non-empty content change (re-arming a 2.5s inactivity timer that
  // fires false), false immediately if the content becomes empty, and false
  // immediately (clearing any pending timer) on send.
  onTypingChange?: (isTyping: boolean) => void;
};

// Inactivity window after the last keystroke before we consider the user to
// have stopped typing.
const TYPING_IDLE_MS = 2500;

// "Today" / "Yesterday" / a locale date string, compared against calendar
// days (not a rolling 24h window) so a message sent at 11:59pm yesterday
// still buckets under "Yesterday" even if it's only minutes old.
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

// Derives a viewer's own message's visible status from the peer's
// delivered/read watermarks — mirrors the backend's own inclusive `>=`
// derivation in compute_message_receipts. Only ever meaningful for the
// viewer's own messages (senderId === selfId) — callers must guard this,
// this helper doesn't re-check sender. Raw ISO strings are compared
// directly (lexicographic order matches chronological order for ISO 8601)
// — do NOT round-trip through `new Date()` first.
export function deriveMessageStatus(
  msg: ChatMessage,
  selfId: string,
  peerDeliveredUpTo: string | null,
  peerReadUpTo: string | null,
): "sent" | "delivered" | "read" {
  void selfId;
  if (peerReadUpTo && msg.sentAt <= peerReadUpTo) return "read";
  if (peerDeliveredUpTo && msg.sentAt <= peerDeliveredUpTo) return "delivered";
  return "sent";
}

// Monotonic merge for watermark state — returns whichever ISO string is
// lexicographically greater (or the non-null one, or null if both null).
// Prevents an out-of-order/stale event from regressing a watermark and
// causing a visible flicker from read back to delivered.
function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

// TEMPORARY (per Bon, 2026-08-14): always render the initials-circle
// fallback for per-message avatars, regardless of `src`. Image avatars
// (peer.path / selfAvatarUrl) may come back later — flip this to false
// to restore the <img> rendering path below.
const ALWAYS_USE_INITIALS = true;

function Avatar({
  src,
  label,
  className,
}: {
  src?: string;
  label: string;
  className?: string;
}) {
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

// Sent = single gray checkmark, delivered = double gray checkmark, read =
// double checkmark in the accent blue matching the existing `.own` bubble.
// No icon library is installed in this project — inline SVG, consistent
// with the header/composer icons already in this file.
function StatusIcon({ status }: { status: "sent" | "delivered" | "read" }) {
  const className = status === "read" ? `${styles.statusIcon} ${styles.statusIconRead}` : styles.statusIcon;
  if (status === "sent") {
    return (
      <svg className={className} width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 8.5L6 12L14 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className={className} width="17" height="13" viewBox="0 0 20 16" fill="none" aria-hidden="true">
      <path d="M1 8.5L5 12L13 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 8.5L11 12L19 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ConversationView({
  peer,
  selfId,
  peerChatId,
  selfAvatarUrl,
  onClose,
  onIncomingMessage,
  onTypingChange,
}: ConversationViewProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  // Watermarks the peer has acked our messages up to — single source of
  // truth, no per-message status stored anywhere. Real-mode only; stay null
  // forever in mock mode (MockChatService has zero receipt support).
  const [peerDeliveredUpTo, setPeerDeliveredUpTo] = useState<string | null>(null);
  const [peerReadUpTo, setPeerReadUpTo] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Text of the last send that failed — preserved so Retry can resend it
  // without the user having to retype (manual retry only, no auto-retry:
  // there's no server-side idempotency to make an automatic retry safe).
  const [failedText, setFailedText] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    chatService.getConnectionState?.() ?? "connected",
  );
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<number | undefined>(undefined);

  // Clear any pending typing-inactivity timer on unmount — same rationale as
  // OfficeMap.tsx's talkingTimersRef cleanup, prevents a stray timer firing
  // onTypingChange(false) after this component is gone.
  useEffect(() => {
    return () => {
      window.clearTimeout(typingTimerRef.current);
    };
  }, []);

  const resolvedPeerId = peerChatId !== undefined ? peerChatId : peer.id;
  // Real backend requires a stable email to route on — a sprite/layer id
  // (or no id at all, for an unmapped roster entry) can't be trusted as a
  // real identity. Mock mode never disables — it never talks to a backend
  // that cares about the difference, so it always falls back to peer.id.
  const chatDisabled = chatMode === "real" && resolvedPeerId === null;
  const routingPeerId =
    resolvedPeerId ?? (chatMode === "mock" ? peer.id : null);

  useEffect(() => {
    if (chatDisabled || routingPeerId === null) return;
    let cancelled = false;
    setIsOpening(true);

    chatService
      .openConversationWith(routingPeerId, selfId)
      .then((conv) => {
        if (cancelled) return;
        setConversationId(conv.id);
        return chatService.getMessages(conv.id).then((msgs) => {
          if (cancelled) return;
          setMessages(msgs);
          // Bootstrap peer watermarks from history — ONLY from the viewer's
          // own messages. For a given message, deliveredAt/readAt reflect the
          // *recipient's* watermark: for the viewer's own messages that's the
          // peer's delivered/read state (what we need); for peer messages it's
          // the viewer's own read state (not what we need here) — mixing the
          // two in would corrupt the peer watermark.
          if (chatMode === "real") {
            let deliveredMax: string | null = null;
            let readMax: string | null = null;
            for (const m of msgs) {
              if (m.senderId !== selfId) continue;
              if (m.deliveredAt) deliveredMax = maxIso(deliveredMax, m.deliveredAt);
              if (m.readAt) readMax = maxIso(readMax, m.readAt);
            }
            if (deliveredMax) setPeerDeliveredUpTo((prev) => maxIso(prev, deliveredMax));
            if (readMax) setPeerReadUpTo((prev) => maxIso(prev, readMax));
          }
        });
      })
      .finally(() => {
        if (!cancelled) setIsOpening(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routingPeerId, selfId, chatDisabled]);

  // Real-mode-only: mirrors the socket's connection lifecycle so the panel
  // can show a "waking up the chat server" banner instead of looking broken
  // during a Render free-tier cold start. Mock mode has no
  // onConnectionState, so this stays a no-op there.
  useEffect(() => {
    if (!chatService.onConnectionState) return;
    setConnectionState(chatService.getConnectionState?.() ?? "connected");
    return chatService.onConnectionState(setConnectionState);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = chatService.onMessage((msg) => {
      if (msg.conversationId !== conversationId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      });
      onIncomingMessage?.(msg);
    });
    return unsubscribe;
  }, [conversationId]);

  // Live delivery/read receipts — real-mode only (mock has no server-side
  // receipt tracking, MockChatService doesn't implement these optional
  // methods). Merges each update into the watermarks via maxIso so a
  // stale/out-of-order event can't regress a watermark.
  useEffect(() => {
    if (chatMode !== "real" || !conversationId) return;
    const unsubscribeDelivery = chatService.onDeliveryReceipt?.((update) => {
      if (update.conversationId !== conversationId) return;
      setPeerDeliveredUpTo((prev) => maxIso(prev, update.deliveredUpTo));
    });
    const unsubscribeRead = chatService.onReadReceipt?.((update) => {
      if (update.conversationId !== conversationId) return;
      setPeerReadUpTo((prev) => maxIso(prev, update.readUpTo));
    });
    return () => {
      unsubscribeDelivery?.();
      unsubscribeRead?.();
    };
  }, [conversationId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Marks the conversation read up to the latest visible message —
  // real-mode only (mock has no server-side read tracking, MockChatService
  // doesn't implement markRead). Runs on open (once messages first load)
  // and again whenever a new incoming message lands while this panel is
  // still open, since being open IS "actually viewed" for this simple v1.
  useEffect(() => {
    if (chatMode !== "real" || !conversationId || messages.length === 0) return;
    const latest = messages[messages.length - 1];
    chatService.markRead?.({ conversationId, upToSentAt: latest.sentAt });
    // Ack delivery for pre-existing history too — without this, a peer's
    // messages already on screen at open wouldn't flip to "delivered" from
    // the current viewer's perspective as an acker until a new live message
    // arrives.
    chatService.markDelivered?.({ conversationId, upToSentAt: latest.sentAt });
  }, [conversationId, messages]);

  function handleDraftChange(text: string) {
    setDraft(text);
    window.clearTimeout(typingTimerRef.current);
    if (text.length === 0) {
      onTypingChange?.(false);
      return;
    }
    onTypingChange?.(true);
    typingTimerRef.current = window.setTimeout(() => {
      onTypingChange?.(false);
    }, TYPING_IDLE_MS);
  }

  function sendText(text: string) {
    if (!conversationId) return;
    window.clearTimeout(typingTimerRef.current);
    onTypingChange?.(false);
    setSendError(null);
    setFailedText(null);
    // Own message arrives via the onMessage subscription above (sendMessage
    // notifies listeners synchronously) — no need to also append it here.
    chatService.sendMessage({ conversationId, senderId: selfId, text }).catch((err: Error) => {
      // No automatic retry: the backend has no client_temp_id-based
      // idempotency, so re-emitting from here (rather than a fresh,
      // user-initiated click) risks a duplicate message. Preserve the text
      // so the user doesn't lose what they typed.
      setSendError(err?.message || "Failed to send message.");
      setFailedText(text);
    });
  }

  function handleSend() {
    const text = draft.trim();
    if (!text || !conversationId) return;
    setDraft("");
    sendText(text);
  }

  function handleRetry() {
    if (!failedText) return;
    sendText(failedText);
  }

  if (chatDisabled) {
    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M4 4h16v12H8l-4 4V4z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className={styles.title}>{formatCharacterName(peer)}</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close chat">
            ×
          </button>
        </div>
        <div className={styles.messages}>
          <div className={`${styles.message} ${styles.peer}`}>
            Chat isn't available for {formatCharacterName(peer)} yet — no linked account.
          </div>
        </div>
      </div>
    );
  }

  // Real-mode-only — mock mode has no onConnectionState, so
  // connectionState stays at its "connected" default and this never fires.
  const isNotConnected = connectionState !== "connected";
  // Terminal failure (auth rejected, no token) — distinct from the
  // in-progress "waking up" states below; socket.io will not retry this on
  // its own, so it needs its own banner + a manual Retry affordance.
  const isConnectionError = connectionState === "error";
  const showOpeningPlaceholder = isOpening && messages.length === 0;

  function handleReconnect() {
    chatService.reconnect?.();
  }

  const peerName = formatCharacterName(peer);
  let lastDayLabel: string | null = null;

  // Index of the most recent own message whose derived status is "read" —
  // the ONE Messenger-style "Seen HH:MM" label is shown only here, not
  // repeated on every read message (avoids clutter).
  let lastReadOwnIndex = -1;
  if (chatMode === "real") {
    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      if (m.senderId !== selfId) continue;
      if (deriveMessageStatus(m, selfId, peerDeliveredUpTo, peerReadUpTo) === "read") {
        lastReadOwnIndex = i;
      }
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerIcon} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4h16v12H8l-4 4V4z" fill="currentColor" />
          </svg>
        </span>
        <span className={styles.title}>{peerName}</span>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </div>
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
          messages.map((msg, index) => {
            const dayLabel = formatDayDivider(msg.sentAt);
            const showDivider = dayLabel !== lastDayLabel;
            lastDayLabel = dayLabel;
            const isOwn = msg.senderId === selfId;
            const showStatus = chatMode === "real" && isOwn;
            const status = showStatus
              ? deriveMessageStatus(msg, selfId, peerDeliveredUpTo, peerReadUpTo)
              : null;
            const showSeenLabel =
              showStatus && status === "read" && index === lastReadOwnIndex && peerReadUpTo;
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
                  {!isOwn && <Avatar className={styles.avatar} src={peer.path || undefined} label={peerName} />}
                  <div className={styles.bubbleColumn}>
                    <div className={isOwn ? `${styles.message} ${styles.own}` : `${styles.message} ${styles.peer}`}>
                      {msg.text}
                    </div>
                    <span className={isOwn ? `${styles.timestamp} ${styles.timestampRight}` : styles.timestamp}>
                      {formatMessageTime(msg.sentAt)}
                    </span>
                    {status && (
                      <span className={styles.statusRow} data-status={status}>
                        {showSeenLabel && (
                          <span className={styles.seenLabel}>Seen {formatMessageTime(peerReadUpTo)}</span>
                        )}
                        <StatusIcon status={status} />
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
        <textarea
          className={styles.textarea}
          value={draft}
          placeholder={isNotConnected ? "Connecting…" : "Type a message…"}
          onChange={(e) => handleDraftChange(e.target.value)}
          onKeyDown={(e) => {
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
    </div>
  );
}

export default ConversationView;
