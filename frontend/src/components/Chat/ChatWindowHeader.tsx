import styles from "./ConversationView.module.css";

type ChatWindowHeaderProps = {
  name: string;
  // Optional status line under the name (e.g. a presence label) — omitted when unknown.
  subtitle?: string;
  // True for a "Character -> Chat" spatial conversation — shows the "📍 Spatial Conversation"
  // badge so the user can tell this window apart from a Global Chat (remote) one.
  isSpatial?: boolean;
  minimized?: boolean;
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
  subtitle,
  isSpatial,
  minimized,
  onMinimizeToggle,
  onClose,
}: ChatWindowHeaderProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className={styles.header}>
      <div className={styles.headerAvatar} data-initials-avatar="true">
        {initial}
      </div>
      <div className={styles.headerText}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{name}</span>
          {isSpatial && <span className={styles.spatialBadge}>📍 Spatial Conversation</span>}
        </div>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </div>
      <div className={styles.headerActions}>
        {onMinimizeToggle && (
          <button
            type="button"
            className={styles.minimizeButton}
            onClick={onMinimizeToggle}
            aria-label={minimized ? "Restore chat" : "Minimize chat"}
          >
            {minimized ? "▢" : "−"}
          </button>
        )}
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </div>
    </div>
  );
}

export default ChatWindowHeader;
