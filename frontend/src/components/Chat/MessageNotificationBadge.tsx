import { useState } from "react";
import HudIcon from "../HudIcon";
import type { Conversation } from "../../services/chat/types";
import dock from "../OfficeMap/HudDock.module.css";
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
  // Global Chat entry points, all opened remote/non-spatial by the caller — see
  // OfficeMap.tsx's chatPickerMode wiring. New Message and Find Person both resolve to the same
  // single-employee-search flow (open/create that person's DM); New Group Chat opens the
  // multi-select flow.
  onNewMessage: () => void;
  onFindPerson: () => void;
  onNewGroupChat: () => void;
  /** Optional caption under the 💬 glyph, so the control reads as a captioned tile in the bottom
   *  dock (see HudDock.tsx). Omitted everywhere else, where it stays the round icon chip it was.
   *  Presentation only — the accessible name still comes from aria-label below. */
  label?: string;
  /** When provided the badge is JUST the dock tile: clicking calls this instead of opening the
   *  built-in dropdown, because the conversation list now lives in its own panel
   *  (ConversationListPanel, opened as the dock's Chat tool). The dropdown below stays for any
   *  caller that does not pass this. */
  onOpen?: () => void;
  /** Reflects the dock tool's open state for the tile's pressed styling. */
  active?: boolean;
};

// Persistent Global Chat entry point (💬) — always visible once real chat is enabled, not just
// when there's something unread. Clicking opens a list of ALL conversations (Stage B1) plus the
// New Message / Find Person / New Group Chat actions above it; clicking a conversation entry
// hands the caller the full Conversation object so it can branch on `type` (dm vs group) and
// reopen by id.
export function MessageNotificationBadge({
  total,
  conversations,
  selfId,
  resolveDisplayName,
  onSelectConversation,
  onNewMessage,
  onFindPerson,
  onNewGroupChat,
  label,
  onOpen,
  active,
}: MessageNotificationBadgeProps) {
  const [open, setOpen] = useState(false);

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
        className={label ? `${styles.iconButton} ${styles.iconButtonLabeled}` : styles.iconButton}
        aria-label={total > 0 ? `${total} unread message${total === 1 ? "" : "s"}` : "Conversations"}
        aria-pressed={onOpen ? Boolean(active) : undefined}
        onClick={() => (onOpen ? onOpen() : setOpen((v) => !v))}
      >
        {/* The unread badge is a child of the glyph, so in the dock's captioned form it hugs the
            💬 square (as in the reference) instead of the taller button's corner. */}
        <span className={styles.glyph}>
          <HudIcon name="chat" />
          {/* The dock's OWN badge class (HudDock's .tileBadge, the one Tasks uses) rather than a
              second variant, so diameter, type, colour, ring and offset can never drift apart. */}
          {total > 0 && <span className={dock.tileBadge}>{total > 99 ? "99+" : total}</span>}
        </span>
        {label && <span className={styles.label}>{label}</span>}
      </button>
      {open && !onOpen && (
        <div className={styles.dropdown}>
          <button
            type="button"
            className={styles.actionRow}
            onClick={() => {
              setOpen(false);
              onNewMessage();
            }}
          >
            + New Message
          </button>
          <button
            type="button"
            className={styles.actionRow}
            onClick={() => {
              setOpen(false);
              onFindPerson();
            }}
          >
            🔍 Find Person
          </button>
          <button
            type="button"
            className={styles.actionRow}
            onClick={() => {
              setOpen(false);
              onNewGroupChat();
            }}
          >
            + New Group Chat
          </button>
          <div className={styles.divider} />
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
              <span className={styles.rowBadges}>
                {/* @mentions V1 — lightweight indicator, feature spec section 15: shown
                    alongside (not instead of) the existing unread count. */}
                {!!conv.mentionCount && conv.mentionCount > 0 && (
                  <span className={styles.rowMentionCount} aria-label={`${conv.mentionCount} mentions`}>
                    @{conv.mentionCount}
                  </span>
                )}
                {!!conv.unreadCount && conv.unreadCount > 0 && (
                  <span className={styles.rowCount}>{conv.unreadCount}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageNotificationBadge;
