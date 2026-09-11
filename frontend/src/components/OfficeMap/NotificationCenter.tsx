import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import HudIcon from "../HudIcon";
import { PanelTabs } from "./PanelTabs";
import { RewardTag } from "./RewardControls";
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
  /** Short caption under the bell, for the dock's captioned tile row. Omitted standalone, where
   *  the bell stays the bare round chip it has always been. */
  label?: string;
  /** Told whenever the panel opens or closes, so the caller can feed the EXISTING officeToolOpen
   *  condition (see OfficeMap.tsx) and step the dock, the Toucan and the minimized chat-head rail
   *  aside while this screen-owning tool is up. No new visibility mechanism. */
  onOpenChange?: (open: boolean) => void;
  /** Real employee portrait for the person a notification is about, or null when there is no
   *  clear match. Injected because only the caller has the roster — see data/portraits.ts and
   *  `actorNameFor` below. Falling back to the type icon is a supported answer. */
  resolvePortrait?: (notification: AppNotification) => string | null;
}

/** Which soft-3D production icon leads a row. Kudos has its own; everything else (including a
 *  type this build predates) gets the bell. No emoji, no generated art. */
function iconFor(notification: AppNotification): "kudos" | "notifications" {
  return notification.type.startsWith("kudos") ? "kudos" : "notifications";
}

/** The server renders titles at write time and some carry a leading emoji ("🏆 You received
 *  Kudos!"). The row shows a production icon in that slot instead, so the glyph is dropped for
 *  DISPLAY only — the stored title is untouched. */
export function displayTitle(title: string): string {
  return title.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "") || title;
}

/** Splits a stored body into the sentence and, when the server appended one, the reward line.
 *  PURELY PRESENTATIONAL: the amounts are re-shown as the existing RewardTag chips instead of as
 *  plain text. Nothing is computed — an unparseable line stays part of the text. */
export function splitBody(body: string | null): { text: string | null; reward: { xp: number; coins: number } | null } {
  if (!body) return { text: null, reward: null };
  const lines = body.split("\n");
  const last = lines[lines.length - 1]?.trim() ?? "";
  const match = /^\+(\d+)\s*XP\s*·\s*\+(\d+)\s*Coins?$/i.exec(last);
  if (!match || lines.length < 2) return { text: body, reward: null };
  return {
    text: lines.slice(0, -1).join("\n") || null,
    reward: { xp: Number(match[1]), coins: Number(match[2]) },
  };
}

/** The display name the server put at the head of the body ("Angelo: “…”" / "Angelo gave you
 *  Kudos."), or null. This is the only place a notification names a PERSON, so it is what a
 *  caller matches against the roster to find a portrait. Read-only parsing of existing copy. */
export function actorNameFor(notification: AppNotification): string | null {
  const first = (notification.body ?? "").split("\n")[0]?.trim() ?? "";
  if (!first) return null;
  const quoted = /^(.+?):\s*[“"]/.exec(first);
  if (quoted) return quoted[1].trim() || null;
  const gave = /^(.+?)\s+gave you\b/.exec(first);
  return gave ? gave[1].trim() || null : null;
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

export function NotificationCenter({
  onNavigate,
  modalOpen = false,
  label,
  onOpenChange,
  resolvePortrait,
}: NotificationCenterProps) {
  const { notifications, unreadCount, loading, error } = useNotifications();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // A modal taking over the view closes the panel — it would otherwise sit invisible behind the
  // modal's backdrop and reappear when the modal closed.
  useEffect(() => {
    if (modalOpen) setOpen(false);
  }, [modalOpen]);

  // Screen-owning: the caller feeds this straight into officeToolOpen, which is what hides the
  // dock, the Toucan and the minimized chat-head rail (and restores them on close).
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // Click-outside / Escape. The panel is PORTALED to <body> (see below), so containment is
  // checked against the panel as well as the bell — otherwise a click inside the panel would
  // read as a click outside the anchor and dismiss it. A pointerdown on the scrim matches
  // neither and therefore closes, which is what a modal backdrop should do.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
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
  // FILTERING IS A VIEW, not a fetch: the store still holds every notification the server sent,
  // in the server's order, and Unread is a predicate over it.
  const shown = useMemo(
    () => (filter === "unread" ? notifications.filter((n) => !n.readAt) : notifications),
    [filter, notifications],
  );

  const panel = (
    <div className={styles.backdrop} data-testid="notification-backdrop">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        data-testid="notification-panel"
        ref={panelRef}
      >
        <div className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <HudIcon name="notifications" size="26px" />
          </span>
          <h2 className={styles.title}>Notifications</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => setOpen(false)}
            aria-label="Close notifications"
          >
            ✕
          </button>
        </div>

        <div className={styles.controls}>
          {/* The SHARED tab bar — the same component and stylesheet as Tasks' Quests | Missions
              (see PanelTabs.tsx). Only the labels and the predicate differ. */}
          <PanelTabs
            ariaLabel="Notifications"
            tabs={[
              { value: "all", label: "All" },
              { value: "unread", label: "Unread" },
            ]}
            active={filter}
            onChange={setFilter}
          />
          <button
            type="button"
            className={styles.markAll}
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
          >
            Mark all read
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.list}>
          {shown.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <HudIcon name="notifications" size="34px" />
              </span>
              <p className={styles.emptyText}>
                {loading
                  ? "Loading…"
                  : filter === "unread"
                    ? "You're all caught up — nothing unread."
                    : "Nothing new yet — Kudos and updates will show up here."}
              </p>
            </div>
          ) : (
            shown.map((notification) => {
              const { text, reward } = splitBody(notification.body);
              const portrait = resolvePortrait?.(notification) ?? null;
              return (
                <button
                  key={notification.id}
                  className={`${styles.item} ${notification.readAt ? styles.read : styles.unread}`}
                  onClick={() => activate(notification)}
                  data-testid="notification-item"
                  data-read={notification.readAt ? "true" : "false"}
                >
                  <span className={styles.itemIcon} aria-hidden="true">
                    <HudIcon name={iconFor(notification)} size="26px" />
                  </span>
                  {portrait && <img className={styles.itemPortrait} src={portrait} alt="" />}
                  <span className={styles.itemMain}>
                    <span className={styles.itemTitle}>{displayTitle(notification.title)}</span>
                    {text && <span className={styles.itemBody}>{text}</span>}
                    {reward && (
                      <span className={styles.itemReward}>
                        <RewardTag xp={reward.xp} coins={reward.coins} />
                      </span>
                    )}
                    <span className={styles.itemTime}>{relativeTime(notification.createdAt)}</span>
                  </span>
                  {!notification.readAt && <span className={styles.itemDot} aria-hidden="true" />}
                  <span className={styles.itemChevron} aria-hidden="true">
                    ›
                  </span>
                </button>
              );
            })
          )}
        </div>

        {shown.length > 0 && <p className={styles.hint}>Select a notification to see more.</p>}
      </div>
    </div>
  );

  return (
    <div className={styles.anchor} ref={anchorRef}>
      <button
        className={`${styles.bell}${open ? ` ${styles.bellActive}` : ""}${label ? ` ${styles.bellLabeled}` : ""}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        aria-expanded={open}
      >
        {/* The badge is a child of the glyph so that in the captioned dock form it hugs the icon
            square instead of the taller button's corner — the same arrangement the neighbouring
            chat control uses. Unlabelled, .glyph is display:contents and nothing moves. */}
        <span className={styles.glyph}>
          <HudIcon name="notifications" />
          {unreadCount > 0 && (
            <span className={styles.badge} data-testid="notification-badge">
              {badge}
            </span>
          )}
        </span>
        {label && <span className={styles.label}>{label}</span>}
      </button>

      {/* PORTALED to <body> on purpose. The bell is a tile inside the bottom dock, and a
          screen-owning tool HIDES that dock (transform + inert) — a panel nested under it would
          be hidden and inert with it. The portal is placement only: no z-index above the modal
          family, and the bell keeps owning the open/closed state. */}
      {open && createPortal(panel, document.body)}
    </div>
  );
}

export default NotificationCenter;
