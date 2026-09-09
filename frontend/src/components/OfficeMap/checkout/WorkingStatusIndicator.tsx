import type { CheckoutState } from "../../../data/checkoutState";
import styles from "./checkout.module.css";

type Props = {
  state: CheckoutState;
  workedLabel: string;
  /** Dock form: "🕐 {label}" instead of "Working · {label}", since the dock groups it directly
   *  above the Check out button and the clock glyph already says what the number is. Same
   *  visibility rules, same value, same component. */
  compact?: boolean;
};

// Small persistent worked-time pill — visible once checked in (timeInMs stamped), hidden once the
// flow reaches CHECKED_OUT.
export function WorkingStatusIndicator({ state, workedLabel, compact = false }: Props) {
  if (state === "CHECKED_OUT") return null;
  if (workedLabel === "Not checked in yet") return null;
  return (
    <div className={compact ? `${styles.statusBadge} ${styles.statusBadgeCompact}` : styles.statusBadge}>
      {compact ? (
        <>
          <span aria-hidden="true">🕐</span> {workedLabel}
        </>
      ) : (
        <>Working · {workedLabel}</>
      )}
    </div>
  );
}

export default WorkingStatusIndicator;
