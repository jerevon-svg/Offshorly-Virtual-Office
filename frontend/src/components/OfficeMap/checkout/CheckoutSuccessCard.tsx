import { useState } from "react";
import type { CheckoutState } from "../../../data/checkoutState";
import type { SubmitTimeLogsResult, TimeLogEntry } from "../../../services/zoho/types";
import { formatDuration } from "../../../data/workedTime";
import styles from "./checkout.module.css";

type Props = {
  state: CheckoutState;
  workedLabel: string;
  entries: TimeLogEntry[];
  submissionResult: SubmitTimeLogsResult | null;
};

// CHECKOUT_SUCCESS -> "You're all set. Have a great evening!" is now spoken
// as Arisha's speech bubble (see OfficeMap.tsx's CHECKOUT_SUCCESS effect +
// playGreetingBeats) rather than a card here, so this component only renders
// once. CHECKED_OUT -> final "You're checked out!" card with the summary +
// a simple read-only "View today's log" expansion.
export function CheckoutSuccessCard({ state, workedLabel, entries, submissionResult }: Props) {
  const [showLog, setShowLog] = useState(false);

  if (state !== "CHECKED_OUT") return null;

  const totalLoggedMinutes = entries.reduce((sum, e) => sum + (e.timeSpentMinutes || 0), 0);

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>You're checked out! 🎉</div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryLabel}>Worked</div>
          <div className={styles.summaryValue}>{workedLabel}</div>
          <div className={styles.summaryLabel}>Logged</div>
          <div className={styles.summaryValue}>{formatDuration(totalLoggedMinutes)}</div>
          <div className={styles.summaryLabel}>Checkout time</div>
          <div className={styles.summaryValue}>
            {submissionResult?.submittedAt
              ? new Date(submissionResult.submittedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </div>
        </div>
        <div className={styles.actions}>
          <button className={styles.secondary} onClick={() => setShowLog((v) => !v)}>
            {showLog ? "Hide today's log" : "View today's log"}
          </button>
        </div>
        {showLog && (
          <div className={styles.entryCard}>
            {entries.map((e, i) => (
              <div key={i} className={styles.body}>
                {e.category ?? e.projectId ?? "—"} · {formatDuration(e.timeSpentMinutes)} —{" "}
                {e.workDescription}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CheckoutSuccessCard;
