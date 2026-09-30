import type { SubmitTimeLogsResult } from "../../../services/zoho";
import styles from "./checkout.module.css";

type Props = {
  visible: boolean;
  error: string | null;
  onTryAgain: () => void;
  onSaveAndReturnLater: () => void;
  /** Present on a PARTIAL failure — some entries reached Zoho and some
   *  did not. Retrying blindly would double-log the ones that worked, so
   *  the panel has to say which is which. */
  result?: SubmitTimeLogsResult | null;
};

export function SubmissionFailedPanel({
  visible,
  error,
  onTryAgain,
  onSaveAndReturnLater,
  result,
}: Props) {
  if (!visible) return null;

  const failures = result?.failures ?? [];
  const created = result?.entriesCreated ?? 0;
  const partial = created > 0;
  // "transport" and "unknown" both mean the outcome is UNCONFIRMED — the
  // request may have reached Zoho before it failed to confirm, so a retry
  // risks a duplicate. Never word this as "Atlas is down": a 5xx/timeout can
  // just as easily mean missing upstream creds.
  const outcomeUnknown = result?.kind === "transport" || result?.kind === "unknown";

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>
          {partial
            ? "Some entries reached Zoho Projects, others didn't"
            : outcomeUnknown
              ? "Couldn't confirm submission through Atlas"
              : "We couldn't submit your work log to Zoho Projects"}
        </div>
        <div className={styles.body}>
          {partial ? (
            <>
              {created} {created === 1 ? "entry" : "entries"} were logged
              successfully. Zoho has no way to undo those, so retrying will
              log them a second time — remove the ones that succeeded before
              trying again.
            </>
          ) : (
            <>
              Your information has been saved as a draft. You have not been
              checked out yet.
            </>
          )}
        </div>
        {failures.length > 0 && (
          <>
            <div className={styles.error}>Atlas responded; these entries could not be logged.</div>
            <ul className={styles.error}>
              {failures.map((f) => (
                <li key={f.taskId}>
                  {f.taskId}: Atlas could not log this entry — {f.error}
                </li>
              ))}
            </ul>
          </>
        )}
        {failures.length === 0 && error && <div className={styles.error}>{error}</div>}
        {outcomeUnknown && (
          <div className={styles.error}>
            We can&apos;t tell whether this reached Zoho before it failed. These entries may
            already be logged — check Zoho before trying again to avoid duplicates.
          </div>
        )}
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onTryAgain}>
            Try again
          </button>
          <button className={styles.secondary} onClick={onSaveAndReturnLater}>
            Save and return later
          </button>
        </div>
      </div>
    </div>
  );
}

export default SubmissionFailedPanel;
