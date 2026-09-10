import { useEffect, useMemo, useState } from "react";
import HudIcon from "../HudIcon";
import { PlusIcon } from "./ChatHeaderIcons";
import { profileImageFor } from "../../data/portraits";
import type { Conversation } from "../../services/chat/types";
import styles from "./ConversationListPanel.module.css";

// The Chat dock tool: a right-side list of every conversation, opened from the dock's Chat tile
// (OfficeMap's dockTool === "chat", which is what hides the dock and the Toucan while it is up).
// It owns NO chat state — the rows are the same useUnreadTotal conversations the 💬 badge always
// rendered, in the same order, and picking one hands the caller the full Conversation so
// OfficeMap's existing onSelectConversation decides spatial vs remote, DM vs group.

export type ConversationListPanelProps = {
  open: boolean;
  /** ALL conversations (DM + group, including 0-unread), newest first — straight from
   *  useUnreadTotal. Empty in mock mode, which is rendered as an honest empty state. */
  conversations: Conversation[];
  selfId: string;
  resolveDisplayName: (email: string) => string;
  onSelectConversation: (conv: Conversation) => void;
  onNewMessage: () => void;
  onFindPerson: () => void;
  onNewGroupChat: () => void;
  onClose: () => void;
};

/** "2h ago" style age for a conversation's last message. */
function relativeAge(iso: string, now: number): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ConversationListPanel({
  open,
  conversations,
  selfId,
  resolveDisplayName,
  onSelectConversation,
  onNewMessage,
  onFindPerson,
  onNewGroupChat,
  onClose,
}: ConversationListPanelProps) {
  const [query, setQuery] = useState("");
  const now = Date.now();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Same labelling rule the 💬 badge used: a group's title, else its other members' names; a
  // DM's peer.
  const othersOf = (conv: Conversation) =>
    conv.participantIds.filter((id) => id.toLowerCase() !== selfId.toLowerCase());

  const labelFor = (conv: Conversation): string => {
    const others = othersOf(conv);
    if (conv.type === "group") return conv.title || others.map(resolveDisplayName).join(", ") || "Group";
    return others[0] ? resolveDisplayName(others[0]) : "Unknown";
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return conversations;
    return conversations.filter((conv) => {
      const haystack = [labelFor(conv), ...othersOf(conv)].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
    // labelFor/othersOf are pure over the props in this closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, query, selfId, resolveDisplayName]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-label="Chats"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <span className={styles.headerIcon}>
            <HudIcon name="chat" size="26px" />
          </span>
          <h2 className={styles.title}>Chats</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close chats">
            ✕
          </button>
        </header>

        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search conversations..."
            aria-label="Search conversations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.actionRow} onClick={onNewMessage}>
            <span className={styles.actionIcon} aria-hidden="true">
              <PlusIcon />
            </span>
            New Message
          </button>
          <button type="button" className={styles.actionRow} onClick={onFindPerson}>
            <span className={styles.actionIcon} aria-hidden="true">
              <HudIcon name="search" size="18px" />
            </span>
            Find Person
          </button>
          <button type="button" className={styles.actionRow} onClick={onNewGroupChat}>
            <span className={styles.actionIcon} aria-hidden="true">
              <PlusIcon />
            </span>
            New Group Chat
          </button>
        </div>

        <div className={styles.list}>
          {conversations.length === 0 ? (
            <p className={styles.empty}>No conversations yet.</p>
          ) : rows.length === 0 ? (
            <p className={styles.empty}>No conversations match “{query.trim()}”.</p>
          ) : (
            <ul className={styles.rows} aria-label="Conversations">
              {rows.map((conv) => {
                const others = othersOf(conv);
                const name = labelFor(conv);
                const isGroup = conv.type === "group";
                // A group's avatar is its first other member's portrait — the same real portrait
                // source every other surface uses. No generated art, no placeholder identity.
                const portrait = others[0] ? profileImageFor(others[0], () => "") : "";
                const age = relativeAge(conv.lastMessageAt, now);
                return (
                  <li key={conv.id}>
                    <button type="button" className={styles.row} onClick={() => onSelectConversation(conv)}>
                      <span className={styles.avatarWrap}>
                        {portrait ? (
                          <img className={styles.avatar} src={portrait} alt="" draggable={false} />
                        ) : (
                          <span className={styles.avatarInitials}>{initialsOf(name)}</span>
                        )}
                        {isGroup && (
                          <span className={styles.groupMark} title="Group conversation" aria-hidden="true">
                            {Math.min(99, others.length + 1)}
                          </span>
                        )}
                      </span>
                      <span className={styles.rowText}>
                        <span className={styles.rowName}>{name}</span>
                        <span className={styles.rowMeta}>
                          {isGroup ? `Group · ${others.length + 1} people` : "Direct message"}
                          {age ? ` · ${age}` : ""}
                        </span>
                      </span>
                      <span className={styles.rowBadges}>
                        {!!conv.mentionCount && conv.mentionCount > 0 && (
                          <span className={styles.mentionCount} aria-label={`${conv.mentionCount} mentions`}>
                            @{conv.mentionCount}
                          </span>
                        )}
                        {!!conv.unreadCount && conv.unreadCount > 0 && (
                          <span className={styles.unreadCount}>{conv.unreadCount > 99 ? "99+" : conv.unreadCount}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

export default ConversationListPanel;
