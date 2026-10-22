import { useEffect, useState } from "react";
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
  /** V3a — "Check out anyway — hours not confirmed". Rendered only when supplied; it always asks
   *  for an explicit second confirmation before calling this. */
  onCheckOutAnyway?: () => void;
};

export function SubmissionFailedPanel({
  visible,
  error,
  onTryAgain,
  onSaveAndReturnLater,
  result,
  onCheckOutAnyway,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!visible) setConfirming(false);
  }, [visible]);
  if (!visible) return null;

  const failures = result?.failures ?? [];
  const created = result?.entriesCreated ?? 0;
  const partial = created > 0;
  // V3a — Atlas 409: it already holds a submission for this date. Retrying would only conflict again,
  // so there is no Try again here; the entries are kept for the employee to check against Zoho.
  const conflict = result?.conflict === true;
  // "transport" and "unknown" both mean the outcome is UNCONFIRMED — the
  // request may have reached Zoho before it failed to confirm, so a retry
  // risks a duplicate. Never word this as "Atlas is down": a 5xx/timeout can
  // just as easily mean missing upstream creds.
  const outcomeUnknown = !conflict && (result?.kind === "transport" || result?.kind === "unknown");

  if (confirming && onCheckOutAnyway) {
    return (
      <div className={styles.backdrop}>
        <div className={styles.panel} role="alertdialog" aria-labelledby="checkout-anyway-title">
          <div className={styles.title} id="checkout-anyway-title">
            Check out without confirmed project hours?
          </div>
          <div className={styles.body}>
            Your attendance checkout will go through on its own. Your project hours have NOT been
            confirmed as saved in Zoho Projects — check Zoho and add any missing entries there. Your
            entries stay available on the checkout card.
          </div>
          <div className={styles.actions}>
            <button className={styles.primary} onClick={onCheckOutAnyway}>
              Yes, check out — hours not confirmed
            </button>
            <button className={styles.secondary} onClick={() => setConfirming(false)}>
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>
          {conflict
            ? "Your project hours could not be confirmed as saved"
            : partial
              ? "Some entries are confirmed in Zoho Projects"
              : outcomeUnknown
                ? "Couldn't confirm submission through Atlas"
              : "We couldn't submit your work log to Zoho Projects"}
        </div>
        <div className={styles.body}>
          {conflict ? (
            <>
              Atlas reported a submission conflict: it already has a submission for today. Your
              entries have been kept and you have not been checked out. Check Zoho Projects before
              entering anything again, so nothing is logged twice.
            </>
          ) : partial ? (
            <>
              {created} {created === 1 ? "entry is" : "entries are"} confirmed in Zoho.
              Your draft is saved and you have not been checked out.
              Contact the Atlas team to reconcile the earlier attempt before
              retrying; editing or removing entries does not clear that attempt.
            </>
          ) : (
            <>
              Your information has been saved as a draft. You have not been
              checked out yet. A failed request can still have saved some
              entries — check Zoho Projects before trying again.
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
        {failures.length === 0 && error && !conflict && <div className={styles.error}>{error}</div>}
        {outcomeUnknown && (
          <div className={styles.error}>
            We can&apos;t tell whether this reached Zoho before it failed. These entries may
            already be logged — check Zoho before trying again to avoid duplicates.
          </div>
        )}
        <div className={styles.actions}>
          {!conflict && (
            <button className={styles.primary} onClick={onTryAgain}>
              Try again
            </button>
          )}
          <button className={conflict ? styles.primary : styles.secondary} onClick={onSaveAndReturnLater}>
            Save and return later
          </button>
          {onCheckOutAnyway && (
            <button className={styles.secondary} onClick={() => setConfirming(true)}>
              Check out anyway — hours not confirmed
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SubmissionFailedPanel;
