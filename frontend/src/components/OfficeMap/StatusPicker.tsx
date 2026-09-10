import { useState, type CSSProperties } from "react";
import { MANUAL_STATUSES, STATUS_META, type OfficeStatus } from "../../services/presence/status";
import {
  endDnd,
  getDndAllowanceSnapshot,
  setManualStatus,
  startDnd,
  useSelfStatus,
} from "../../services/presence/selfStatusStore";
import { useDndRemainingMs } from "../../services/presence/useDndCountdown";
import { DND_POLICY, formatDurationShort } from "../../services/presence/dndPolicy";
import styles from "./StatusPicker.module.css";

// Compact manual-status control for the 5 user-settable statuses
// (Available/Busy/Break/Lunch/DND) — lives in the top chrome near
// WorkingStatusIndicator/checkout controls. Auto statuses (Away, In
// Conversation, In Call, Offline) are never offered here.
//
// DND V1: picking "DND" from the select no longer sets it immediately — it opens a small
// duration/reason popover (startDnd), and once active the select is replaced by a live "🔴 DND ·
// Xm" countdown chip with a Cancel action (endDnd). Every other status keeps its original
// immediate-set behavior, unrestricted/unlimited, exactly as before.
//
// `checkedIn` (defaults true so existing callers/tests are unaffected) scopes ONLY the DND
// option — "DND should only operate meaningfully for an actively checked-in employee" (feature
// spec section 16). Available/Busy/Break/Lunch stay offered exactly as before regardless, since
// that gating is a pre-existing product decision this feature doesn't touch.
type Props = {
  checkedIn?: boolean;
};

export function StatusPicker({ checkedIn = true }: Props) {
  const { manualStatus } = useSelfStatus();
  // Sole source of DND remaining time — and, because the same hook fires endDnd() at zero, the
  // sole driver of DND auto-expiry. It must stay mounted here whether or not DND is active.
  const remainingMs = useDndRemainingMs();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className={styles.picker}>
      <select
        className={styles.select}
        // The pill's tint and border are derived from the ONE existing colour source
        // (STATUS_META) rather than a second status->colour table in CSS. Everything else about
        // the control — options, handler, DND branch — is unchanged.
        style={{ "--status-color": STATUS_META[manualStatus].color } as CSSProperties}
        value={manualStatus}
        onChange={(e) => {
          const next = e.target.value as OfficeStatus;
          if (next === "DND") {
            setPickerOpen(true);
            return;
          }
          // Leaving DND by picking another status is the SAME exit the removed chip's ✕ was:
          // endDnd() is what credits the session against the daily allowance and clears the
          // expiry/previous-status bookkeeping. setManualStatus() refuses DND and would otherwise
          // walk straight past all of that, silently leaking the allowance.
          if (manualStatus === "DND") endDnd();
          setManualStatus(next);
        }}
        aria-label="Set your status"
      >
        {MANUAL_STATUSES.filter(
          // DND stays in the list while it IS the current status even if `checkedIn` has since
          // gone false — a <select> whose value matches no option renders empty.
          (status) => status !== "DND" || checkedIn || manualStatus === "DND",
        ).map((status) => {
          const meta = STATUS_META[status];
          // The live countdown rides on the DND option's own label, so the pill keeps exactly the
          // geometry every other status has and simply grows to fit its text. formatDurationShort
          // already yields "30m" / "1h" / "1h 30m"; no second formatter.
          const label =
            status === "DND" && manualStatus === "DND" && remainingMs !== null
              ? `${meta.label} · ${formatDurationShort(remainingMs)}`
              : meta.label;
          return (
            <option key={status} value={status}>
              {label}
            </option>
          );
        })}
      </select>
      {pickerOpen && checkedIn && <DndDurationPopover onClose={() => setPickerOpen(false)} />}
    </div>
  );
}

function DndDurationPopover({ onClose }: { onClose: () => void }) {
  const [reason, setReason] = useState<string>("");
  const allowance = getDndAllowanceSnapshot();
  const exhausted = allowance.remainingMs <= 0;

  function pick(ms: number) {
    const started = startDnd({ durationMs: ms, reason: reason || null });
    if (started) onClose();
  }

  return (
    <div className={styles.popover}>
      <div className={styles.popoverTitle}>{STATUS_META.DND.emoji} Do Not Disturb</div>
      {exhausted ? (
        <>
          <div className={styles.exhaustedMessage}>You've used your normal DND focus time for today.</div>
          <button
            type="button"
            className={styles.requestExtendedButton}
            disabled
            title="Extended DND requests aren't available yet"
          >
            Request Extended DND
          </button>
        </>
      ) : (
        <>
          <div className={styles.durationRow}>
            {DND_POLICY.durationOptions.map((opt) => (
              <button
                key={opt.label}
                type="button"
                className={styles.durationButton}
                disabled={opt.ms > allowance.remainingMs}
                onClick={() => pick(opt.ms)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <select
            className={styles.reasonSelect}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason (optional)"
          >
            <option value="">Reason (optional)</option>
            {DND_POLICY.reasonOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </>
      )}
      <div className={styles.allowanceLine}>
        DND today: {formatDurationShort(allowance.usedMs)} / {formatDurationShort(allowance.dailyAllowanceMs)}
      </div>
    </div>
  );
}

export default StatusPicker;
