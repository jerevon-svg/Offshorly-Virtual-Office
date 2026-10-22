import type { TimeLogEntry } from "../../../services/zoho/types";
import type { validateAllocation } from "../../../data/workedTime";
import { formatDuration } from "../../../data/workedTime";
import styles from "./checkout.module.css";

type Allocation = ReturnType<typeof validateAllocation>;

type Props = {
  entries: TimeLogEntry[];
  allocation: Allocation;
  workedLabel: string;
  onBack: () => void;
  /** PHASE 7E — OPTIONAL: rendered only when supplied, so V1's review is unchanged. */
  onCancel?: () => void;
  onSubmit: () => void;
};

const UNALLOCATED_NOTE =
  "Only your project entries are sent to Zoho Projects. Unallocated time is not submitted as project work.";

function entryCountLabel(n: number): string {
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}

// "Ready to check out?" review step — [Back] / [Submit log and check out].
// Submit is enabled whenever the log is valid (allocation.canSubmit): logging less than the checked-in
// time is allowed, so the session clock ticking on while the employee reads this can never disable it.
export function TimeLogReview({ entries, allocation, workedLabel, onBack, onCancel, onSubmit }: Props) {
  const canSubmit = allocation.canSubmit;
  return (
    <div className={styles.panel}>
      <div className={styles.title}>Ready to check out?</div>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryLabel}>Checked in for</div>
        <div className={styles.summaryValue}>{workedLabel}</div>
        <div className={styles.summaryLabel}>Sent to Zoho Projects</div>
        <div className={styles.summaryValue}>
          {formatDuration(allocation.loggedMinutes)} ({entryCountLabel(entries.length)})
        </div>
        <div className={styles.summaryLabel}>Not logged</div>
        <div className={styles.summaryValue}>{formatDuration(allocation.unallocatedMinutes)}</div>
      </div>
      <div className={styles.note}>{UNALLOCATED_NOTE}</div>
      {allocation.errors.length > 0 && (
        <div className={styles.error} role="alert">
          {allocation.errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <button className={styles.primary} onClick={onSubmit} disabled={!canSubmit}>
          Submit log and check out
        </button>
        {onCancel && (
          <button className={styles.secondary} onClick={onCancel}>
            Cancel checkout
          </button>
        )}
        <button className={styles.secondary} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

export default TimeLogReview;
