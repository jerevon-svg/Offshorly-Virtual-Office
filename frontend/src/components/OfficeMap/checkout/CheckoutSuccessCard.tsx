import { useState } from "react";
import type { CheckoutState } from "../../../data/checkoutState";
import type { CheckoutRecovery } from "../../../data/checkoutStorage";
import type { SubmitTimeLogsResult, TimeLogEntry } from "../../../services/zoho/types";
import { formatDuration } from "../../../data/workedTime";
import styles from "./checkout.module.css";

type Props = {
  state: CheckoutState;
  workedLabel: string;
  entries: TimeLogEntry[];
  submissionResult: SubmitTimeLogsResult | null;
  /** Closes the card. Visibility is UI state owned by the caller — dismissing
   * never touches the stored checkout result (history), attendance, or the
   * checkout state machine; the employee stays CHECKED_OUT on the sidewalk
   * with the normal reception UI (and Check In) reachable again. */
  onDismiss?: () => void;
  /** V3a — the entries kept after an unconfirmed submission (survives a reload). */
  recovery?: CheckoutRecovery | null;
};

// CHECKOUT_SUCCESS -> "You're all set. Have a great evening!" is now spoken
// as Arisha's speech bubble (see OfficeMap.tsx's CHECKOUT_SUCCESS effect +
// playGreetingBeats) rather than a card here, so this component only renders
// once. CHECKED_OUT -> final "You're checked out!" card with the summary +
// a simple read-only "View today's log" expansion.
export function CheckoutSuccessCard({ state, workedLabel, entries, submissionResult, onDismiss, recovery }: Props) {
  const [showLog, setShowLog] = useState(false);

  if (state !== "CHECKED_OUT") return null;

  // V3a — attendance-only checkout after an unconfirmed submission. Never the success card: it says
  // plainly that the hours were not confirmed and keeps the entries in view to re-enter in Zoho.
  if (submissionResult?.hoursNotConfirmed) {
    const kept = recovery?.entries?.length ? recovery.entries : entries;
    return (
      <div className={styles.backdrop}>
        <div className={styles.panel} data-testid="checkout-hours-not-confirmed">
          <div className={styles.title}>You're checked out — project hours not confirmed</div>
          <div className={styles.body}>
            Your project hours were NOT confirmed as saved in Zoho Projects. Check Zoho Projects for
            today and add any missing entries there. Your entries are kept below.
          </div>
          <div className={styles.entryCard}>
            {kept.length === 0 ? (
              <div className={styles.body}>No entries were kept.</div>
            ) : (
              kept.map((e, i) => (
                <div key={i} className={styles.body}>
                  {e.category ?? e.projectId ?? "—"} · {formatDuration(e.timeSpentMinutes)} — {e.workDescription}
                </div>
              ))
            )}
          </div>
          {onDismiss && (
            <div className={styles.actions}>
              <button className={styles.primary} onClick={onDismiss}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // A confirmed submission carries the figures the employee saw at submit (useCheckoutFlow). Results
  // saved before that existed — and a duplicate-submission recovery, which sent nothing new — have no
  // summary, and keep the original two rows rather than claiming anything was "sent".
  const summary = submissionResult?.checkoutSummary;
  const totalLoggedMinutes = entries.reduce((sum, e) => sum + (e.timeSpentMinutes || 0), 0);

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>You're checked out! 🎉</div>
        <div className={styles.summaryGrid}>
          {summary ? (
            <>
              <div className={styles.summaryLabel}>Checked in for</div>
              <div className={styles.summaryValue}>{formatDuration(summary.sessionMinutes)}</div>
              <div className={styles.summaryLabel}>Sent to Zoho Projects</div>
              <div className={styles.summaryValue}>
                {formatDuration(summary.loggedMinutes)} ({summary.entryCount}{" "}
                {summary.entryCount === 1 ? "entry" : "entries"})
              </div>
              <div className={styles.summaryLabel}>Not logged</div>
              <div className={styles.summaryValue}>{formatDuration(summary.unallocatedMinutes)}</div>
            </>
          ) : (
            <>
              <div className={styles.summaryLabel}>Checked in for</div>
              <div className={styles.summaryValue}>{workedLabel}</div>
              <div className={styles.summaryLabel}>Logged</div>
              <div className={styles.summaryValue}>{formatDuration(totalLoggedMinutes)}</div>
            </>
          )}
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
        {summary && (
          <div className={styles.note}>
            Checked-in time is as of your submission. Only your project entries were sent to Zoho Projects.
          </div>
        )}
        <div className={styles.actions}>
          {onDismiss && (
            <button className={styles.primary} onClick={onDismiss}>
              Close
            </button>
          )}
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
