import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./HudDock.module.css";

// ---- BOTTOM DOCK ----------------------------------------------------------------------------
// The Virtual Office's single persistent control surface:
//
//   Profile | Coins + XP | Search | Hub | Tasks | Chat | Rewards | Boards | Map |
//   Working + Check out | 🔔 | ••• (Settings)
//
// THIS COMPONENT OWNS LAYOUT AND NOTHING ELSE. It holds no feature state, performs no fetches and
// knows nothing about progression, chat, quests or checkout. Every control is either
//   * an `action`    — a label + an aria-label + the caller's EXISTING handler,
//   * a `node`       — the caller's EXISTING component rendered in place (PlayerHud,
//                      StatusPicker, NotificationCenter, MessageNotificationBadge,
//                      WorkingStatusIndicator), or
//   * a `flyout`     — a tile that reveals the caller's panel ABOVE the dock (Search, Settings).
// Ordering and every visibility gate live with the caller (OfficeMap.tsx), so "which controls
// exist right now" is still decided in exactly one place.
//
// ••• IS SETTINGS, NOT AN OVERFLOW DRAWER. Product features are tiles; they are never hidden in
// a menu, at any viewport width. Narrow viewports compact spacing and drop the tile captions
// (CSS only) — see HudDock.module.css.
//
// See HudDock.module.css for the layering rationale and for the --vo-chrome-* / --vo-flyout-*
// custom-property contract that lets the fixed-corner chrome components sit in here unforked.

export interface HudDockAction {
  kind: "action";
  key: string;
  /** Emoji or glyph. Kept as the caller's own string so the dock invents no iconography. */
  icon: ReactNode;
  /** Short caption under the icon; hidden by CSS on narrow viewports. */
  label: string;
  /** Accessible name — must stay byte-identical to the control's pre-dock aria-label. */
  ariaLabel: string;
  onClick: () => void;
  /** Soft highlighted icon tile: this control's panel is currently open. */
  active?: boolean;
  disabled?: boolean;
}

export interface HudDockNode {
  kind: "node";
  key: string;
  node: ReactNode;
}

export interface HudDockFlyout {
  kind: "flyout";
  key: string;
  icon: ReactNode;
  /** Omitted for the trailing utilities (•••), which are icon-only in the reference. */
  label?: string;
  ariaLabel: string;
  /** Panel content, rendered above the dock while open. */
  panel: ReactNode;
  /** Right-aligns the panel to the tile instead of centring it — for tiles near the dock's end. */
  align?: "center" | "end";
  /** "dark" keeps the flyout on the office's dark panel treatment, for content that already
   *  carries it (CharacterSearch's input and result list). Defaults to the dock's light surface. */
  surface?: "light" | "dark";
}

export interface HudDockSeparator {
  kind: "separator";
  key: string;
}

export type HudDockEntry = HudDockAction | HudDockNode | HudDockFlyout | HudDockSeparator;

export interface HudDockProps {
  /** Profile + Coins/XP group (PlayerHud in dock layout) — the dock's widest section. */
  identity?: ReactNode;
  /** Availability picker, when it is not nested inside `identity`. */
  status?: ReactNode;
  entries: HudDockEntry[];
  /** True while a modal from the z-index 60 family that the viewer must read in full is open —
   *  steps the dock below it, exactly as the Player HUD's `behindModal` always did. */
  behindModal?: boolean;
  /** True while the z-index 30/31 overlay family owns the screen (check-in, status overtime, any
   *  checkout step). Steps the dock below THOSE, which 50 would not clear. */
  behindOverlay?: boolean;
}

export function HudDock({
  identity,
  status,
  entries,
  behindModal = false,
  behindOverlay = false,
}: HudDockProps) {
  // A separator is only ever a divider BETWEEN entries — never leading, trailing or doubled once
  // gating has removed the entries around it.
  const visible = entries.filter((entry, index) => {
    if (entry.kind !== "separator") return true;
    const before = entries.slice(0, index).some((e) => e.kind !== "separator");
    const after = entries.slice(index + 1).some((e) => e.kind !== "separator");
    return before && after && entries[index - 1]?.kind !== "separator";
  });

  const classes = [styles.dock];
  // The lower step wins: an overlay at 30/31 needs the dock under 30, which 50 would not clear.
  if (behindOverlay) classes.push(styles.behindOverlay);
  else if (behindModal) classes.push(styles.behindModal);

  return (
    <div
      className={classes.join(" ")}
      data-testid="hud-dock"
      role="toolbar"
      aria-label="Office controls"
    >
      {identity && (
        <div className={styles.identityGroup} data-testid="hud-dock-identity">
          {identity}
        </div>
      )}
      {status && <div className={styles.group}>{status}</div>}
      {(identity || status) && visible.length > 0 && <div className={styles.separator} />}
      {visible.map((entry) => {
        switch (entry.kind) {
          case "separator":
            return <div key={entry.key} className={styles.separator} />;
          case "node":
            return (
              <div key={entry.key} className={styles.group}>
                {entry.node}
              </div>
            );
          case "flyout":
            return <FlyoutTile key={entry.key} entry={entry} />;
          default:
            return <Tile key={entry.key} action={entry} />;
        }
      })}
    </div>
  );
}

function Tile({ action }: { action: HudDockAction }) {
  return (
    <button
      type="button"
      className={action.active ? `${styles.tile} ${styles.tileActive}` : styles.tile}
      onClick={action.onClick}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      data-dock-item={action.key}
    >
      <span className={styles.tileIcon} aria-hidden="true">
        {action.icon}
      </span>
      <span className={styles.tileLabel}>{action.label}</span>
    </button>
  );
}

/** A dock tile whose panel is revealed above the dock — Search and Settings. Dismissal is
 *  click-outside + Escape, the same pattern NotificationCenter's panel already uses, so the dock
 *  still introduces no office-wide backdrop layer. */
function FlyoutTile({ entry }: { entry: HudDockFlyout }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
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

  return (
    <div className={styles.flyoutAnchor} ref={anchorRef}>
      <button
        type="button"
        className={open ? `${styles.tile} ${styles.tileActive}` : styles.tile}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-label={entry.ariaLabel}
        aria-expanded={open}
        data-dock-item={entry.key}
      >
        <span className={styles.tileIcon} aria-hidden="true">
          {entry.icon}
        </span>
        {entry.label && <span className={styles.tileLabel}>{entry.label}</span>}
      </button>
      {open && (
        <div
          className={[
            styles.flyout,
            entry.align === "end" ? styles.flyoutEnd : "",
            entry.surface === "dark" ? styles.flyoutDark : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid={`hud-dock-flyout-${entry.key}`}
        >
          {entry.panel}
        </div>
      )}
    </div>
  );
}

export default HudDock;
