import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./WorldActionMenu.module.css";

// THE shared world interaction menu. Every click-to-interact surface in the office — an
// employee, the Reception desk, an empty seat — renders THIS: one card, one row treatment, one
// dismissal contract. The three former menus (CharacterActionMenu, ReceptionActionMenu,
// SeatActionMenu) are now thin wrappers that only decide WHICH rows exist and what they do;
// their actions, conditions, permissions and handlers are untouched, because none of that lives
// here. This file owns presentation and dismissal and nothing else.
//
// Dismissal: Escape, or a pointerdown anywhere outside the card. The full-screen backdrop is
// pointer-events:none on purpose — it is a layer marker, not a click shield — so a press on
// ANOTHER CHARACTER reaches that character's own click handler and its menu simply replaces this
// one in a single click (see the [data-character-id] rule below). Every other outside press
// closes through onClose exactly as before; a press inside the card never closes it.
//
// PLACEMENT. The card hangs off the anchor POINT — for a character that is the centre of their
// avatar (OfficeMap computes it from the layer box and the current zoom), so it sits just beside
// and slightly over the character's edge, the same for every employee regardless of how wide
// their 2D sprite or live-3D box is. (Placing from the avatar's outer box was tried and produced
// visibly different gaps per avatar.) Right of the point by ANCHOR_OFFSET_PX; flips to the LEFT
// of the point when the right side would run off the viewport; the viewport clamp is the final
// fallback. `notch` marks a character anchor so the pointer notch is drawn toward them.

/** Horizontal offset from the anchor point to the card's near edge (the pre-existing +8px). */
export const ANCHOR_OFFSET_PX = 8;
const VIEWPORT_MARGIN_PX = 8;
/** Used for the first paint and in environments that cannot measure (jsdom); the card's CSS
 *  min-width is 188px, so this is a slight overestimate that only ever flips a hair early. */
const FALLBACK_MENU_WIDTH_PX = 200;

export interface WorldActionMenuAnchor {
  clientX: number;
  clientY: number;
  /** True for a character anchor: draw the pointer notch toward them. Desks/seats leave it off. */
  notch?: boolean;
}

/** Which side of the anchor the card ended up on — drives the pointer notch. Null = no notch. */
export type MenuSide = "right" | "left" | null;

/** Pure placement, exported for tests. `size` is the card's measured size (0 before measuring). */
export function placeMenu(
  anchor: WorldActionMenuAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; side: MenuSide } {
  const width = size.width || FALLBACK_MENU_WIDTH_PX;
  let left = anchor.clientX + ANCHOR_OFFSET_PX;
  let side: "right" | "left" = "right";
  // Flip to the other side of the point when the right side has no room.
  if (left + width > viewport.width - VIEWPORT_MARGIN_PX) {
    left = anchor.clientX - ANCHOR_OFFSET_PX - width;
    side = "left";
  }
  return {
    left: Math.max(VIEWPORT_MARGIN_PX, Math.min(left, viewport.width - width - VIEWPORT_MARGIN_PX)),
    // Unchanged from the original menus: the click/centre point, never off the bottom edge.
    top: Math.min(anchor.clientY, viewport.height - 160),
    side: anchor.notch ? side : null,
  };
}

export interface WorldActionMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** Real count shown as the dock's HUD badge at the row's end. 0/undefined renders nothing;
   *  above 9 renders "9+", exactly as the dock tiles do. The caller owns the number. */
  badge?: number;
}

export interface WorldActionMenuProps {
  anchor: WorldActionMenuAnchor;
  onClose: () => void;
  /** Accessible name for the menu, e.g. "Actions for Alex" / "Reception". */
  ariaLabel: string;
  /** Contextual title. Omit for a menu whose rows need no framing. */
  title?: string;
  /** Contextual status beside the title — the employee menu's presence dot + label. Omit for
   *  anything that is not a person; no surface is forced to carry information it has none of. */
  meta?: { color: string; label: string };
  items: WorldActionMenuItem[];
}

export function WorldActionMenu({ anchor, onClose, ariaLabel, title, meta, items }: WorldActionMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || menuRef.current?.contains(target)) return;
      // QUICK SWITCH. A press on a character is not a dismissal: that character's existing
      // click path (OfficeMap.handleCharacterClick) opens ITS menu, replacing this one — no
      // close-then-reopen, so no intermediate zoom-out and no second click.
      if (target instanceof Element && target.closest("[data-character-id]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  // Measure once the card exists so the flip decision uses its real width; useLayoutEffect
  // runs before paint, so the first frame is already in the right place.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    if (next.width !== size.width || next.height !== size.height) setSize(next);
  });
  const { left, top, side } = placeMenu(anchor, size, { width: window.innerWidth, height: window.innerHeight });

  return (
    <div className={styles.backdrop} data-testid="world-menu-backdrop">
      <div
        ref={menuRef}
        className={styles.menu}
        style={{ left, top }}
        data-side={side ?? undefined}
        // Presses that land on the card end here. OfficeStage walks the character from a
        // click-vs-drag pointer-up on room/character/seat layers, so pointer-up is stopped along
        // with click; pointer-down is left alone so the document-level dismissal listeners
        // (this menu's own, the dock's flyouts) still see an inside press as inside.
        onClick={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        role="menu"
        aria-label={ariaLabel}
        data-testid="world-menu"
      >
        {(title || meta) && (
          <div className={styles.header}>
            {title && <div className={styles.title}>{title}</div>}
            {meta && (
              <div className={styles.meta} data-testid="world-menu-meta">
                <span className={styles.metaDot} style={{ backgroundColor: meta.color }} aria-hidden="true" />
                {meta.label}
              </div>
            )}
          </div>
        )}
        {items.map((item) => (
          <button key={item.key} type="button" role="menuitem" className={styles.item} onClick={item.onSelect}>
            <span className={styles.itemLabel}>{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className={styles.badge} data-testid={`world-menu-badge-${item.key}`}>
                {item.badge > 9 ? "9+" : item.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default WorldActionMenu;
