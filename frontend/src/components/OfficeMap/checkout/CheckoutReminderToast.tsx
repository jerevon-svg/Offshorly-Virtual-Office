import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import HudIcon from "../../HudIcon";
import styles from "./checkout.module.css";

type Props = {
  visible: boolean;
  /** Post-"Later" follow-up: softer "Still here?" copy quoting the live worked time. */
  followUp?: boolean;
  /** The HUD's worked-time label ("8h 30m"), quoted by the follow-up copy. */
  workedLabel?: string;
  onLater: () => void;
  onStartCheckout: () => void;
};

/** The dock's Working Hours group (HudDock renders every node entry with its key as
 *  `data-dock-item`; OfficeMap's time group is keyed "time"). */
export const WORKING_HOURS_ANCHOR = '[data-dock-item="time"]';
const VIEWPORT_INSET = 16; // the floating-panel family's inset
const GAP_ABOVE_ANCHOR = 14;
const TAIL_HALF = 8; // half the rotated tail's footprint
const TAIL_MIN_INSET = 28; // keeps the tail clear of the card's 22px corner radius

export interface ReminderPlacement {
  /** Card's left edge, viewport px. */
  left: number;
  /** Card's bottom offset, viewport px. */
  bottom: number;
  /** Tail centre, px from the card's left edge — aimed at the anchor even when the card clamped. */
  tailX: number;
}

/** Pure geometry, all in VIEWPORT coordinates: centre the card over the anchor's horizontal
 *  centre, clamp the card inside the viewport, then aim the tail at that same centre
 *  independently of where the card ended up. Exported for tests. */
export function placeReminder(
  anchor: { left: number; width: number; top: number },
  card: { width: number },
  viewport: { width: number; height: number },
): ReminderPlacement {
  const anchorCenter = anchor.left + anchor.width / 2;
  const maxLeft = Math.max(VIEWPORT_INSET, viewport.width - VIEWPORT_INSET - card.width);
  const left = Math.min(maxLeft, Math.max(VIEWPORT_INSET, anchorCenter - card.width / 2));
  const tailX = Math.min(card.width - TAIL_MIN_INSET, Math.max(TAIL_MIN_INSET, anchorCenter - left));
  return { left, bottom: viewport.height - anchor.top + GAP_ABOVE_ANCHOR, tailX };
}

/** Where the tail's tip lands on screen for a placement — what must equal the anchor's centre. */
export function tailTipX(placement: ReminderPlacement): number {
  return placement.left + placement.tailX;
}

function samePlacement(a: ReminderPlacement | null, b: ReminderPlacement | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.left === b.left && a.bottom === b.bottom && a.tailX === b.tailX;
}

// The 8-hour checkout reminder — a floating cream VO action card, NOT a blocking modal: the
// office stays usable behind it. Shown while useCheckoutFlow's state === "REMINDER_SHOWN"; every
// action is the flow's own (Later = dismissReminderForLater, which snoozes 30 minutes; Start
// checkout = startCheckout, the same entry Reception and the dock button use). The ✕ is Later.
// The clock is the HUD's existing production icon (HudIcon "clock"), not new art.
//
// ANCHORED to the dock's Working Hours group. Two things make this hold:
//  1. The card is PORTALED to <body>, so `position: fixed` is viewport-relative no matter what
//     transformed ancestor OfficeMap's world layer puts around its render site, and the values
//     below (all from getBoundingClientRect / window.inner*) are viewport values throughout.
//  2. Placement is re-measured every animation frame while the card is visible — not once on
//     mount. The dock mounts LATER than the card on a refresh past 8h (it waits for check-in,
//     onboarding and self-placement), and it slides in with a transform transition that no
//     ResizeObserver or resize event reports; a one-shot effect measured "no anchor" and stayed
//     on the stylesheet fallback forever. One rect read per frame is negligible, and state only
//     changes when the numbers do. With no anchor in the DOM the stylesheet's dock-clearance
//     fallback applies until it appears.
export function CheckoutReminderToast({
  visible,
  followUp = false,
  workedLabel,
  onLater,
  onStartCheckout,
}: Props) {
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<ReminderPlacement | null>(null);

  useEffect(() => {
    if (!visible || !card) return;
    let frame = 0;
    const tick = () => {
      const anchor = document.querySelector<HTMLElement>(WORKING_HOURS_ANCHOR);
      const a = anchor?.getBoundingClientRect();
      const next =
        a && (a.width > 0 || a.height > 0)
          ? placeReminder(a, { width: card.offsetWidth }, { width: window.innerWidth, height: window.innerHeight })
          : null;
      setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(frame);
  }, [visible, card]);

  if (!visible) return null;
  const title = followUp ? "Still here?" : "8 hours reached";
  const body = followUp
    ? `It’s been ${workedLabel ?? "a while"}. Ready to check out?`
    : "Ready to wrap up for today?";
  const style = placement
    ? ({
        "--reminder-left": `${placement.left}px`,
        "--reminder-bottom": `${placement.bottom}px`,
        "--reminder-tail-x": `${placement.tailX - TAIL_HALF}px`,
      } as CSSProperties)
    : undefined;
  return createPortal(
    <div
      ref={setCard}
      className={styles.reminderCard}
      style={style}
      role="status"
      aria-live="polite"
      aria-label={`${title} ${body}`}
      data-testid="checkout-reminder"
      data-anchored={placement ? "true" : "false"}
    >
      <span className={styles.reminderIcon} aria-hidden="true">
        <HudIcon name="clock" size="52px" />
      </span>
      <div className={styles.reminderMain}>
        <div className={styles.reminderTitle}>{title}</div>
        <div className={styles.reminderBody}>{body}</div>
        <div className={styles.reminderActions}>
          <button type="button" className={styles.reminderLater} onClick={onLater}>
            Later
          </button>
          <button type="button" className={styles.reminderStart} onClick={onStartCheckout}>
            Start checkout
          </button>
        </div>
      </div>
      <button
        type="button"
        className={styles.reminderClose}
        onClick={onLater}
        aria-label="Dismiss reminder"
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}

export default CheckoutReminderToast;
