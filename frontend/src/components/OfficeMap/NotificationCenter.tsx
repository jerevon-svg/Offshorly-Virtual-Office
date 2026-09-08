import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./NotificationCenter.module.css";
import {
  markAllRead,
  markRead,
  useNotifications,
} from "../../services/notifications/notificationsStore";
import type { AppNotification } from "../../services/notifications/notificationsClient";

// Global Notifications V1 — the 🔔 pill in the office's right-hand control column plus its
// anchored panel. One component owns both, so the panel is a CHILD of the button and therefore
// always positioned and layered relative to it (see NotificationCenter.module.css's layering
// note before touching any z-index).
//
// The component holds NO notification state: everything comes from
// services/notifications/notificationsStore.ts, which is server-authoritative and refetches on
// mount, tab focus, `online` and socket reconnect. Local state here is open/closed only.

/** What a notification wants to open. The server sends `navKind`/`navPayload`; OfficeMap turns
 * a resolved destination into the actual UI action. */
export type NotificationDestination =
  | { kind: "profileFeed"; email: string; postId: string | null }
  | { kind: "conversation"; conversationId: string }
  | { kind: "quests" }
  | { kind: "missions" }
  | { kind: "achievements" }
  | { kind: "hub" };

export interface NotificationCenterProps {
  /** Performs the destination. Return false (or leave it undefined) when the destination could
   * not be opened — the panel then stays put instead of closing on a navigation that did not
   * happen. */
  onNavigate?: (destination: NotificationDestination) => boolean | void;
  /** True while a full-screen modal owns the view. The panel closes rather than sitting hidden
   * behind the modal's backdrop — belt and braces beside the z-index rule that already puts
   * this whole control below the modal family. */
  modalOpen?: boolean;
}

function str(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/** Maps one notification onto a destination this build knows how to open, or null.
 *
 * NULL IS A SUPPORTED ANSWER, not a failure: an unrecognised kind (a newer server, a type this
 * build predates, a malformed payload) is marked read and navigates nowhere. Exported for the
 * routing tests. */
export function destinationFor(notification: AppNotification): NotificationDestination | null {
  const payload = notification.navPayload ?? null;
  switch (notification.navKind) {
    case "profile_feed": {
      const email = str(payload, "email");
      return email ? { kind: "profileFeed", email, postId: str(payload, "postId") } : null;
    }
    case "conversation": {
      const conversationId = str(payload, "conversationId");
      return conversationId ? { kind: "conversation", conversationId } : null;
    }
    case "quests":
      return { kind: "quests" };
    case "missions":
      return { kind: "missions" };
    case "achievements":
      return { kind: "achievements" };
    case "hub":
      return { kind: "hub" };
    default:
      return null;
  }
}

/** Coarse "how long ago", enough for a bell. Server timestamps always carry an offset (see
 * backend/app/schemas/notification.py's _as_utc), so this never mis-reads a UTC time as local. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function NotificationCenter({ onNavigate, modalOpen = false }: NotificationCenterProps) {
  const { notifications, unreadCount, loading, error } = useNotifications();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  // A modal taking over the view closes the panel — it would otherwise sit invisible behind the
  // modal's backdrop and reappear when the modal closed.
  useEffect(() => {
    if (modalOpen) setOpen(false);
  }, [modalOpen]);

  // Click-outside / Escape, rather than a full-screen backdrop element: a backdrop would be one
  // more office-wide layer to reason about, and this control deliberately adds none.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const activate = useCallback(
    (notification: AppNotification) => {
      // Clicking ALWAYS marks read, whether or not anywhere can be opened.
      void markRead(notification.id);
      const destination = destinationFor(notification);
      if (!destination) return; // unsupported destination: read, and safely nothing else
      const navigated = onNavigate?.(destination);
      if (navigated !== false) setOpen(false);
    },
    [onNavigate],
  );

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div className={styles.anchor} ref={anchorRef}>
      <button
        className={`${styles.bell}${open ? ` ${styles.bellActive}` : ""}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        aria-expanded={open}
      >
        🔔
        {unreadCount > 0 && (
          <span className={styles.badge} data-testid="notification-badge">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Notifications" data-testid="notification-panel">
          <div className={styles.header}>
            <h2 className={styles.title}>Notifications</h2>
            <button
              className={styles.markAll}
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              Mark all as read
            </button>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.list}>
            {notifications.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyEmoji}>🔔</span>
                {loading ? "Loading…" : "Nothing new yet — Kudos and updates will show up here."}
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  className={`${styles.item} ${notification.readAt ? styles.read : styles.unread}`}
                  onClick={() => activate(notification)}
                  data-testid="notification-item"
                  data-read={notification.readAt ? "true" : "false"}
                >
                  <div className={styles.itemTitle}>{notification.title}</div>
                  {notification.body && <div className={styles.itemBody}>{notification.body}</div>}
                  <div className={styles.itemTime}>{relativeTime(notification.createdAt)}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;
