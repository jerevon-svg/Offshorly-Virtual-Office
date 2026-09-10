import type { ReactNode } from "react";
import { profileImageFor } from "../../data/portraits";
import { CloseIcon, MinimizeIcon, RestoreIcon } from "./ChatHeaderIcons";
import styles from "./ConversationView.module.css";

type ChatWindowHeaderProps = {
  name: string;
  /** Whose portrait to show beside the name — the DM peer, or a group's first other member.
   *  Falls back to the initial when there is no portrait for that email. */
  avatarEmail?: string;
  // Optional status line under the name (e.g. a presence label) — omitted when unknown.
  subtitle?: string;
  // True for a "Character -> Chat" spatial conversation — shows the "📍 Spatial Conversation"
  // badge so the user can tell this window apart from a Global Chat (remote) one.
  isSpatial?: boolean;
  minimized?: boolean;
  // Optional controls rendered just before the minimize/close buttons. Only the SPATIAL chat
  // slots pass anything here (voice-call controls — see OfficeMap.tsx); remote Global Chat
  // windows leave it undefined, so no DM or remote group can show call controls.
  headerExtra?: ReactNode;
  // Omitted entirely hides the minimize control (used by ConversationView's chatDisabled
  // fallback where there's nothing to minimize into).
  onMinimizeToggle?: () => void;
  onClose: () => void;
};

// Shared Messenger-style window header — used by both ConversationView (DM) and
// GroupConversationView (group), which already share ConversationView.module.css for the rest of
// their chrome. Kept as its own file only to avoid duplicating this JSX in both components.
export function ChatWindowHeader({
  name,
  avatarEmail,
  subtitle,
  isSpatial,
  minimized,
  headerExtra,
  onMinimizeToggle,
  onClose,
}: ChatWindowHeaderProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const portrait = avatarEmail ? profileImageFor(avatarEmail, () => "") : "";
  return (
    <div className={styles.header}>
      {portrait ? (
        <img className={styles.headerAvatar} src={portrait} alt="" draggable={false} />
      ) : (
        <div className={styles.headerAvatar} data-initials-avatar="true">
          {initial}
        </div>
      )}
      <div className={styles.headerText}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{name}</span>
        </div>
        {/* "Spatial Conversation" is a secondary STATUS, styled exactly like the DND /
            delayed-response line it sits beside — never inline with the name, where it ate the
            header width the call actions now need. */}
        {(isSpatial || subtitle) && (
          <span className={styles.subtitle}>
            {isSpatial && <span className={styles.spatialBadge}>📍 Spatial Conversation</span>}
            {isSpatial && subtitle ? " · " : null}
            {subtitle}
          </span>
        )}
      </div>
      {!minimized && headerExtra}
      <div className={styles.headerActions}>
        {onMinimizeToggle && (
          <button
            type="button"
            className={styles.minimizeButton}
            onClick={onMinimizeToggle}
            aria-label={minimized ? "Restore chat" : "Minimize chat"}
          >
            {minimized ? <RestoreIcon /> : <MinimizeIcon />}
          </button>
        )}
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close chat">
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

export default ChatWindowHeader;
