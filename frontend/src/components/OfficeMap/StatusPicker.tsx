import { MANUAL_STATUSES, STATUS_META } from "../../services/presence/status";
import { setManualStatus, useSelfStatus } from "../../services/presence/selfStatusStore";
import styles from "./StatusPicker.module.css";

// Compact manual-status control for the 5 user-settable statuses
// (Available/Busy/Break/Lunch/DND) — lives in the top chrome near
// WorkingStatusIndicator/checkout controls. Auto statuses (Away, In
// Conversation, In Call, Offline) are never offered here.
export function StatusPicker() {
  const { manualStatus } = useSelfStatus();

  return (
    <div className={styles.picker}>
      <select
        className={styles.select}
        value={manualStatus}
        onChange={(e) => setManualStatus(e.target.value as (typeof MANUAL_STATUSES)[number])}
        aria-label="Set your status"
      >
        {MANUAL_STATUSES.map((status) => {
          const meta = STATUS_META[status];
          return (
            <option key={status} value={status}>
              {meta.emoji} {meta.label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export default StatusPicker;
