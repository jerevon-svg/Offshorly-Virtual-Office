import type { CheckoutState } from "../../../data/checkoutState";
import styles from "./checkout.module.css";

type Props = {
  state: CheckoutState;
  workedLabel: string;
};

// Small persistent "Working · {label}" pill — visible once checked in
// (timeInMs stamped), hidden once the flow reaches CHECKED_OUT.
export function WorkingStatusIndicator({ state, workedLabel }: Props) {
  if (state === "CHECKED_OUT") return null;
  if (workedLabel === "Not checked in yet") return null;
  return <div className={styles.statusBadge}>Working · {workedLabel}</div>;
}

export default WorkingStatusIndicator;
