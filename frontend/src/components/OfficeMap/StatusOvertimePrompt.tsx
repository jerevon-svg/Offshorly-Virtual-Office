import styles from "./StatusOvertimePrompt.module.css";
import { setManualStatus } from "../../services/presence/selfStatusStore";
import { useStatusOvertime } from "../../services/presence/useStatusOvertime";
import type { OfficeStatus } from "../../services/presence/status";

const TITLE_BY_STATUS: Partial<Record<OfficeStatus, string>> = {
  BREAK: "Your break's running long",
  LUNCH: "Lunch is running long",
};

const ACTIVITY_LABEL_BY_STATUS: Partial<Record<OfficeStatus, string>> = {
  BREAK: "Break",
  LUNCH: "Lunch",
};

const LIMIT_LABEL_BY_STATUS: Partial<Record<OfficeStatus, string>> = {
  BREAK: "15 min",
  LUNCH: "1 hour",
};

// Formats an overage duration per the confirmed spec: minutes for anything
// >=1 min ("3 min over"), seconds only for sub-1-minute overage
// ("40 sec over") — never raw seconds like "187 sec over".
function formatOverage(overMs: number): string {
  if (overMs >= 60_000) {
    const minutes = Math.floor(overMs / 60_000);
    return `${minutes} min`;
  }
  const seconds = Math.floor(overMs / 1000);
  return `${seconds} sec`;
}

// Self-contained: owns its own overtime-detection hook, renders nothing
// when not overtime. Cloned visual pattern from checkout/CheckoutConfirmModal
// — fully independent component/hook, no coupling with the auto-walk
// manualStatus-transition effect in OfficeMap.tsx.
export function StatusOvertimePrompt() {
  const { overtime, dismiss } = useStatusOvertime();

  if (!overtime) return null;

  const title = TITLE_BY_STATUS[overtime.status] ?? "Running long";
  const activityLabel = ACTIVITY_LABEL_BY_STATUS[overtime.status] ?? overtime.status;
  const limitLabel = LIMIT_LABEL_BY_STATUS[overtime.status] ?? "the limit";
  const overageLabel = formatOverage(overtime.overMs);

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>{title}</div>
        <div className={styles.body}>
          You've been on {activityLabel} {overageLabel} past the {limitLabel} limit.
        </div>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={() => setManualStatus("AVAILABLE")}>
            Go available
          </button>
          <button className={styles.secondary} onClick={dismiss}>
            Keep going
          </button>
        </div>
      </div>
    </div>
  );
}

export default StatusOvertimePrompt;
