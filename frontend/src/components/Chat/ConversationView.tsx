import { useEffect, useRef, useState } from "react";
import { formatCharacterName } from "../../data/office-layout";
import { chatMode, chatService } from "../../services/chat";
import { TOUCAN_AVATAR_GLYPH, TOUCAN_DISPLAY_NAME, isToucanSender } from "../../services/chat/toucanSender";
import { applyReactionUpdate } from "../../services/chat/reactions";
import type { ChatMessage, ConnectionState } from "../../services/chat";
import type { AssetLayer } from "../../types/office";
import { ChatComposer } from "./ChatComposer";
import { ChatWindowHeader } from "./ChatWindowHeader";
import { MessageReactions } from "./MessageReactions";
import { renderMessageText } from "./MentionText";
import { useMentionComposer } from "./useMentionComposer";
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
  // Optional status line shown under the name (e.g. a presence label) — omitted when unknown.
  subtitle?: string;
  // True for a "Character -> Chat" spatial conversation — shows the "📍 Spatial Conversation"
  // header badge. False/omitted for a Global Chat (remote) window, which never shows it.
  isSpatial?: boolean;
  // Passthrough only — see ChatWindowHeader's headerExtra. This component neither creates nor
  // interprets these controls.
  headerExtra?: React.ReactNode;
  // Collapses the window to just its header row — same conversation stays mounted (socket
  // subscriptions, draft text, etc. are untouched), only the body is hidden.
  minimized?: boolean;
  onMinimizeToggle?: () => void;
  onIncomingMessage?: (msg: ChatMessage) => void;
  // Fired exactly once, the moment this panel's conversation id first resolves (real mode's
  // openConversationWith response) — the edge-triggered "chat actually opened" signal callers
  // use to start a spatial session (see OfficeMap.tsx's emitSpatialSessionStart wiring). Never
  // fired again for the same mount (see the guard around setConversationId below) — a
  // re-render from an unrelated prop change must not re-fire this.
  onConversationOpen?: (conversationId: string) => void;
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
  glyph,
}: {
  src?: string;
  label: string;
  className?: string;
  /** A fixed glyph instead of the initial — used for the non-human Toucan author. */
  glyph?: string;
}) {
  if (src && !ALWAYS_USE_INITIALS) {
    return <img className={className} src={src} alt="" />;
  }
  const initial = glyph ?? (label.trim().charAt(0).toUpperCase() || "?");
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
  subtitle,
  isSpatial,
  headerExtra,
  minimized,
  onMinimizeToggle,
  onIncomingMessage,
  onTypingChange,
  onConversationOpen,
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
  const peerName = formatCharacterName(peer);

  // @mentions V1: DM autocomplete offers exactly the other participant — never the whole
  // company roster (feature spec: "Do NOT search the entire company roster from an existing
  // conversation"). No candidate at all when there's no stable routing identity.
  const mention = useMentionComposer(routingPeerId ? [{ email: routingPeerId, displayName: peerName }] : []);

  useEffect(() => {
    if (chatDisabled || routingPeerId === null) return;
    let cancelled = false;
    setIsOpening(true);

    chatService
      .openConversationWith(routingPeerId, selfId)
      .then((conv) => {
        if (cancelled) return;
        setConversationId(conv.id);
        onConversationOpen?.(conv.id);
        return chatService.getMessages(conv.id).then((msgs) => {
          if (cancelled) return;
          setMessages(msgs);
          // Bootstrap peer watermarks from history — ONLY from the viewer's
          // own messages. For a given message, deliveredTo/readBy reflect the
          // *recipients'* per-reader watermark state: for the viewer's own
          // messages that includes the peer's delivered/read state (what we
          // need); for peer messages it's the viewer's own read state (not
          // what we need here) — mixing the two in would corrupt the peer
          // watermark. 1:1 DM only here — derive a single peer watermark by
          // checking whether the peer's email appears in each array.
          if (chatMode === "real" && routingPeerId) {
            // Invariant: routingPeerId is already lowercase here — both real-mode callers
            // (OfficeMap's resolvePeerChatId and ChatTestPage's active.peer) lowercase the
            // email before it ever reaches peerChatId, matching the lowercased emails the
            // backend stores/emits in deliveredTo/readBy. If a future caller stops guaranteeing
            // that, lowercase routingPeerId at derivation time instead of here.
            let deliveredMax: string | null = null;
            let readMax: string | null = null;
            for (const m of msgs) {
              if (m.senderId !== selfId) continue;
              if (m.deliveredTo.includes(routingPeerId)) deliveredMax = maxIso(deliveredMax, m.sentAt);
              if (m.readBy.includes(routingPeerId)) readMax = maxIso(readMax, m.sentAt);
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

  // Live reactions — folds each `message_reaction` delta into the message already in state
  // (see applyReactionUpdate). Deliberately does NOT touch unread/mention/receipt state: a
  // reaction is not a message, and the server never emits a count or receipt event for one.
  useEffect(() => {
    if (!chatService.onMessageReaction) return;
    return chatService.onMessageReaction((update) => {
      setMessages((prev) => applyReactionUpdate(prev, update));
    });
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
      if (conversationId) chatService.sendTyping?.({ conversationId, isTyping: false });
      return;
    }
    onTypingChange?.(true);
    if (conversationId) chatService.sendTyping?.({ conversationId, isTyping: true });
    typingTimerRef.current = window.setTimeout(() => {
      onTypingChange?.(false);
      if (conversationId) chatService.sendTyping?.({ conversationId, isTyping: false });
    }, TYPING_IDLE_MS);
  }

  function sendText(text: string) {
    if (!conversationId) return;
    window.clearTimeout(typingTimerRef.current);
    onTypingChange?.(false);
    chatService.sendTyping?.({ conversationId, isTyping: false });
    setSendError(null);
    setFailedText(null);
    const mentionedEmails = mention.mentionsForSend(text);
    // Own message arrives via the onMessage subscription above (sendMessage
    // notifies listeners synchronously) — no need to also append it here.
    chatService.sendMessage({ conversationId, senderId: selfId, text, mentionedEmails }).catch((err: Error) => {
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
    mention.resetAfterSend();
  }

  function handleRetry() {
    if (!failedText) return;
    sendText(failedText);
  }

  if (chatDisabled) {
    const disabledName = formatCharacterName(peer);
    return (
      <div className={minimized ? `${styles.panel} ${styles.panelMinimized}` : styles.panel}>
        <ChatWindowHeader
          name={disabledName}
          subtitle={subtitle}
          isSpatial={isSpatial}
          minimized={minimized}
          onMinimizeToggle={onMinimizeToggle}
          onClose={onClose}
        />
        {!minimized && (
          <div className={styles.messages}>
            <div className={`${styles.message} ${styles.peer}`}>
              Chat isn't available for {disabledName} yet — no linked account.
            </div>
          </div>
        )}
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
    <div className={minimized ? `${styles.panel} ${styles.panelMinimized}` : styles.panel}>
      <ChatWindowHeader
        name={peerName}
        subtitle={subtitle}
        isSpatial={isSpatial}
        headerExtra={headerExtra}
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
          messages.map((msg, index) => {
            const dayLabel = formatDayDivider(msg.sentAt);
            const showDivider = dayLabel !== lastDayLabel;
            lastDayLabel = dayLabel;
            const isOwn = msg.senderId === selfId;
            // A1.4 — a DM has exactly one human peer, but Toucan can also author messages here.
            // Never dress its messages as the peer's: distinct avatar + explicit name line.
            const fromToucan = !isOwn && isToucanSender(msg.senderId);
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
                <div
                  className={isOwn ? `${styles.row} ${styles.rowSelf}` : styles.row}
                  data-sender={fromToucan ? "toucan" : isOwn ? "self" : "peer"}
                >
                  {fromToucan && (
                    <Avatar
                      className={`${styles.avatar} ${styles.toucanAvatar}`}
                      label={TOUCAN_DISPLAY_NAME}
                      glyph={TOUCAN_AVATAR_GLYPH}
                    />
                  )}
                  {!isOwn && !fromToucan && (
                    <Avatar className={styles.avatar} src={peer.path || undefined} label={peerName} />
                  )}
                  <div className={styles.bubbleColumn}>
                    {fromToucan && <span className={styles.timestamp}>{TOUCAN_DISPLAY_NAME}</span>}
                    <div className={isOwn ? `${styles.message} ${styles.own}` : `${styles.message} ${styles.peer}`}>
                      {renderMessageText(
                        msg.text,
                        msg.mentionedEmails,
                        (email) => (routingPeerId && email.toLowerCase() === routingPeerId.toLowerCase() ? peerName : email),
                        selfId,
                      )}
                    </div>
                    <span className={isOwn ? `${styles.timestamp} ${styles.timestampRight}` : styles.timestamp}>
                      {formatMessageTime(msg.sentAt)}
                    </span>
                    <MessageReactions
                      messageId={msg.id}
                      reactions={msg.reactions}
                      selfId={selfId}
                      isOwn={isOwn}
                      resolveDisplayName={(email) =>
                        routingPeerId && email.toLowerCase() === routingPeerId.toLowerCase()
                          ? peerName
                          : email
                      }
                    />
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
      {/* Pinned above the composer, outside the scrolling .messages list — never scrolls away,
          never persists as a message, never affects unread/mention counts. Reuses the same
          `subtitle` signal the header's "🔴 DND · Notifications muted" already derives from
          (see OfficeMap.tsx), which is only ever set for a remote (non-spatial) DND peer — so
          this never shows in spatial chat and disappears immediately once DND ends. */}
      {!isSpatial && subtitle && <div className={styles.dndHelperText}>Expect delayed response</div>}
      <ChatComposer
        draft={draft}
        setDraft={setDraft}
        mention={mention}
        placeholder={isNotConnected ? "Connecting…" : undefined}
        onDraftInput={(text, caret) => {
          handleDraftChange(text);
          mention.onDraftChanged(text, caret);
        }}
        onSend={handleSend}
      />
      </>
      )}
    </div>
  );
}

export default ConversationView;
