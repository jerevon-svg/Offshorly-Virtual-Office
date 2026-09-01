import { useEffect, useRef, useState } from "react";
import { chatService } from "../../services/chat";
import { hasOwnReaction } from "../../services/chat/reactions";
import type { MessageReaction } from "../../services/chat/types";
import styles from "./MessageReactions.module.css";

// ONE component, rendered by BOTH ConversationView (DM) and GroupConversationView. Spatial
// Chat needs no implementation of its own — it renders those same two views (see
// OfficeMap.tsx's SPATIAL_WINDOW_KEY slot), so it inherits reactions for free.

// Small fixed set, deliberately NOT a full emoji browser. Must stay in sync with
// ALLOWED_REACTION_EMOJIS in backend/app/repositories/chat.py — the server rejects anything
// outside its own list.
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉"] as const;

interface MessageReactionsProps {
  messageId: string;
  reactions: MessageReaction[] | undefined;
  /** Authenticated caller — used only to highlight/toggle their own chips. The server derives
   *  the real reactor from the socket session; this is never trusted as identity. */
  selfId: string;
  /** Own messages render right-aligned, matching the bubble they hang under. */
  isOwn: boolean;
  /** Maps an email to a display name where the view already knows one (group member list, DM
   *  peer). Falls back to the raw email — hover text only, so it's cheap either way. */
  resolveDisplayName?: (email: string) => string;
}

export function MessageReactions({
  messageId,
  reactions,
  selfId,
  isOwn,
  resolveDisplayName,
}: MessageReactionsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const groups = reactions ?? [];

  // Close the picker on any outside click. Registered only while open so the common case
  // (every message in a long history) adds no document-level listeners at all.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDocPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [pickerOpen]);

  function toggle(emoji: string) {
    // No optimistic local apply: the server echoes `message_reaction` back to the reactor's own
    // socket too, so the chip appears from the same code path a peer's reaction takes.
    // MockChatService fires its listeners synchronously for the same effect.
    if (hasOwnReaction(groups, emoji, selfId)) {
      chatService.removeReaction?.({ messageId, emoji, reactorEmail: selfId });
    } else {
      chatService.addReaction?.({ messageId, emoji, reactorEmail: selfId });
    }
  }

  function tooltipFor(group: MessageReaction): string {
    const names = group.reactors.map((r) =>
      r.toLowerCase() === selfId.toLowerCase() ? "You" : (resolveDisplayName?.(r) ?? r),
    );
    return `${names.join(", ")} reacted with ${group.emoji}`;
  }

  const wrapClass = [
    styles.wrap,
    isOwn ? styles.wrapSelf : "",
    groups.length === 0 ? styles.wrapEmpty : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClass} ref={wrapRef} data-testid={`reactions-${messageId}`}>
      {groups.map((group) => {
        const own = hasOwnReaction(groups, group.emoji, selfId);
        return (
          <button
            key={group.emoji}
            type="button"
            className={own ? `${styles.chip} ${styles.chipOwn}` : styles.chip}
            onClick={() => toggle(group.emoji)}
            title={tooltipFor(group)}
            aria-label={`${group.emoji} ${group.count}${own ? ", remove your reaction" : ", react"}`}
            aria-pressed={own}
          >
            <span aria-hidden="true">{group.emoji}</span>
            <span className={styles.count}>{group.count}</span>
          </button>
        );
      })}

      {pickerOpen ? (
        <span className={styles.picker} role="group" aria-label="Choose a reaction">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={styles.pickerOption}
              onClick={() => {
                toggle(emoji);
                setPickerOpen(false);
              }}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </span>
      ) : (
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setPickerOpen(true)}
          aria-label="Add a reaction"
        >
          🙂
        </button>
      )}
    </div>
  );
}

export default MessageReactions;
