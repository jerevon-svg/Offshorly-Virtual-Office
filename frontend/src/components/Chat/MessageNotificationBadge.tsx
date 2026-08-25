import { useState } from "react";
import type { Conversation } from "../../services/chat/types";
import styles from "./MessageNotificationBadge.module.css";

type MessageNotificationBadgeProps = {
  total: number;
  /** ALL conversations (dm and group alike, including 0-unread), sorted by
   *  lastMessageAt descending — Stage B1 evolved this from an
   *  unread-only list so groups (which can't be represented by a single
   *  peerId) are reopenable from here too. */
  conversations: Conversation[];
  selfId: string;
  resolveDisplayName: (email: string) => string;
  onSelectConversation: (conv: Conversation) => void;
};

// Placeholder notification icon + count badge (Phase 3 real-time unread
// tracking) — Bon will restyle this once the underlying wiring is
// confirmed working. Clicking opens a list of ALL conversations (Stage
// B1); clicking an entry hands the caller the full Conversation object so
// it can branch on `type` (dm vs group) and reopen by id.
export function MessageNotificationBadge({
  total,
  conversations,
  selfId,
  resolveDisplayName,
  onSelectConversation,
}: MessageNotificationBadgeProps) {
  const [open, setOpen] = useState(false);

  // Keep the icon visible whenever there's anything to show (unread OR any
  // conversation at all) — it's now a general conversation-list entry
  // point, not purely an unread badge.
  if (total <= 0 && conversations.length === 0) return null;

  function labelFor(conv: Conversation): string {
    if (conv.type === "group") {
      if (conv.title) return conv.title;
      return conv.participantIds
        .filter((id) => id.toLowerCase() !== selfId.toLowerCase())
        .map(resolveDisplayName)
        .join(", ");
    }
    const peerId = conv.participantIds.find((id) => id.toLowerCase() !== selfId.toLowerCase());
    return peerId ? resolveDisplayName(peerId) : "Unknown";
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={total > 0 ? `${total} unread message${total === 1 ? "" : "s"}` : "Conversations"}
        onClick={() => setOpen((v) => !v)}
      >
        💬
        {total > 0 && <span className={styles.badge}>{total > 99 ? "99+" : total}</span>}
      </button>
      {open && (
        <div className={styles.dropdown}>
          {conversations.length === 0 && <div className={styles.emptyRow}>No conversations yet.</div>}
          {conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              className={styles.row}
              onClick={() => {
                setOpen(false);
                onSelectConversation(conv);
              }}
            >
              <span>{labelFor(conv)}</span>
              {!!conv.unreadCount && conv.unreadCount > 0 && (
                <span className={styles.rowCount}>{conv.unreadCount}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageNotificationBadge;
