import { useState } from "react";
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
  const remainingMs = useDndRemainingMs();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (manualStatus === "DND") {
    const label = remainingMs !== null ? formatDurationShort(remainingMs) : "";
    return (
      <div className={styles.picker}>
        <div className={styles.dndChip}>
          <span>
            {STATUS_META.DND.emoji} DND{label ? ` · ${label}` : ""}
          </span>
          <button type="button" className={styles.dndChipCancel} onClick={() => endDnd()} aria-label="Cancel DND">
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.picker}>
      <select
        className={styles.select}
        value={manualStatus}
        onChange={(e) => {
          const next = e.target.value as OfficeStatus;
          if (next === "DND") {
            setPickerOpen(true);
            return;
          }
          setManualStatus(next);
        }}
        aria-label="Set your status"
      >
        {MANUAL_STATUSES.filter((status) => status !== "DND" || checkedIn).map((status) => {
          const meta = STATUS_META[status];
          return (
            <option key={status} value={status}>
              {meta.emoji} {meta.label}
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
