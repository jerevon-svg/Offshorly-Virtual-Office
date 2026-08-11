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
  onSubmit: () => void;
};

// "Ready to check out?" review step — [Back] / [Submit log and check out].
// Submit disabled until allocation.isFullyAllocated with no validation errors.
export function TimeLogReview({ entries, allocation, workedLabel, onBack, onSubmit }: Props) {
  const canSubmit = allocation.isFullyAllocated && allocation.errors.length === 0;
  return (
    <div className={styles.panel}>
      <div className={styles.title}>Ready to check out?</div>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryLabel}>Worked time</div>
        <div className={styles.summaryValue}>{workedLabel}</div>
        <div className={styles.summaryLabel}>Projects logged</div>
        <div className={styles.summaryValue}>{entries.length}</div>
        <div className={styles.summaryLabel}>Total logged time</div>
        <div className={styles.summaryValue}>{formatDuration(allocation.totalLoggedMinutes)}</div>
      </div>
      {allocation.errors.length > 0 && (
        <div className={styles.error}>
          {allocation.errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <button className={styles.primary} onClick={onSubmit} disabled={!canSubmit}>
          Submit log and check out
        </button>
        <button className={styles.secondary} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

export default TimeLogReview;
