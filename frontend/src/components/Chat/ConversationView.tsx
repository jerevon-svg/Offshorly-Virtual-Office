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
  onClose: () => void;
  onIncomingMessage?: (msg: ChatMessage) => void;
};

export function ConversationView({
  peer,
  selfId,
  peerChatId,
  onClose,
  onIncomingMessage,
}: ConversationViewProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
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
          if (!cancelled) setMessages(msgs);
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
  }, [conversationId, messages]);

  function sendText(text: string) {
    if (!conversationId) return;
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
      <div className={styles.backdrop} onClick={onClose}>
        <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <span className={styles.title}>{formatCharacterName(peer)}</span>
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close chat">
              ×
            </button>
          </div>
          <div className={styles.messages}>
            <div className={styles.message}>
              Chat isn't available for {formatCharacterName(peer)} yet — no linked account.
            </div>
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

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{formatCharacterName(peer)}</span>
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
            messages.map((msg) => (
              <div
                key={msg.id}
                className={
                  msg.senderId === selfId
                    ? `${styles.message} ${styles.own}`
                    : `${styles.message} ${styles.peer}`
                }
              >
                {msg.text}
              </div>
            ))
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
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button type="button" className={styles.sendButton} onClick={handleSend}>
            {isNotConnected ? "Connecting…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConversationView;
