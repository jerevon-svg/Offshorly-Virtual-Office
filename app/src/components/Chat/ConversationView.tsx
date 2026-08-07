import { useEffect, useRef, useState } from "react";
import { formatCharacterName } from "../../data/office-layout";
import { chatService } from "../../services/chat";
import type { ChatMessage } from "../../services/chat";
import type { AssetLayer } from "../../types/office";
import styles from "./ConversationView.module.css";

type ConversationViewProps = {
  peer: AssetLayer;
  selfId: string;
  onClose: () => void;
  onIncomingMessage?: (msg: ChatMessage) => void;
};

export function ConversationView({ peer, selfId, onClose, onIncomingMessage }: ConversationViewProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    chatService.openConversationWith(peer.id, selfId).then((conv) => {
      if (cancelled) return;
      setConversationId(conv.id);
      chatService.getMessages(conv.id).then((msgs) => {
        if (!cancelled) setMessages(msgs);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [peer.id, selfId]);

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

  function handleSend() {
    const text = draft.trim();
    if (!text || !conversationId) return;
    setDraft("");
    // Own message arrives via the onMessage subscription above (sendMessage
    // notifies listeners synchronously) — no need to also append it here.
    chatService.sendMessage({ conversationId, senderId: selfId, text });
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
        <div className={styles.messages}>
          {messages.map((msg) => (
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
          ))}
          <div ref={listEndRef} />
        </div>
        <div className={styles.composer}>
          <textarea
            className={styles.textarea}
            value={draft}
            placeholder="Type a message…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button type="button" className={styles.sendButton} onClick={handleSend}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConversationView;
