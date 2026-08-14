import { useState } from "react";
import type { UnreadConversation } from "../../services/chat/useUnreadTotal";
import styles from "./MessageNotificationBadge.module.css";

type MessageNotificationBadgeProps = {
  total: number;
  unreadConversations: UnreadConversation[];
  onSelectPeer: (peerId: string) => void;
};

// Placeholder notification icon + count badge (Phase 3 real-time unread
// tracking) — Bon will restyle this once the underlying wiring is
// confirmed working. Clicking opens a bare list of conversations with
// unread messages; clicking an entry opens that conversation the same way
// clicking the peer's avatar already does.
export function MessageNotificationBadge({
  total,
  unreadConversations,
  onSelectPeer,
}: MessageNotificationBadgeProps) {
  const [open, setOpen] = useState(false);

  if (total <= 0) return null;

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`${total} unread message${total === 1 ? "" : "s"}`}
        onClick={() => setOpen((v) => !v)}
      >
        💬
        <span className={styles.badge}>{total > 99 ? "99+" : total}</span>
      </button>
      {open && (
        <div className={styles.dropdown}>
          {unreadConversations.length === 0 && <div className={styles.emptyRow}>No unread messages</div>}
          {unreadConversations.map((conv) => (
            <button
              key={conv.conversationId}
              type="button"
              className={styles.row}
              disabled={!conv.peerId}
              onClick={() => {
                if (!conv.peerId) return;
                setOpen(false);
                onSelectPeer(conv.peerId);
              }}
            >
              <span>{conv.peerId ?? "Unknown"}</span>
              <span className={styles.rowCount}>{conv.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageNotificationBadge;
