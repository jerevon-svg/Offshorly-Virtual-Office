import { useEffect, useState } from "react";
import { formatDuration } from "../../../data/workedTime";
import styles from "./checkout.module.css";

type Props = {
  timeInMs: number | null;
  breakMinutes: number;
  workedLabel: string;
  /** Frozen checkout time (submit timestamp), null while still live-ticking. */
  frozenCheckoutAtMs: number | null;
};

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Read-only summary: Time in / Break time / Worked time / Checkout time.
// Checkout time ticks live (current time) until frozenCheckoutAtMs is set
// (i.e. after final submit), then it freezes at that stamp.
export function TimeSummaryPanel({ timeInMs, breakMinutes, workedLabel, frozenCheckoutAtMs }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (frozenCheckoutAtMs !== null) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [frozenCheckoutAtMs]);

  const checkoutTimeMs = frozenCheckoutAtMs ?? nowMs;

  return (
    <div className={styles.summaryGrid}>
      <div className={styles.summaryLabel}>Time in</div>
      <div className={styles.summaryValue}>{timeInMs !== null ? formatClock(timeInMs) : "—"}</div>

      <div className={styles.summaryLabel}>Break time</div>
      <div className={styles.summaryValue}>{formatDuration(breakMinutes)}</div>

      <div className={styles.summaryLabel}>Worked time</div>
      <div className={styles.summaryValue}>{workedLabel}</div>

      <div className={styles.summaryLabel}>Checkout time</div>
      <div className={styles.summaryValue}>{formatClock(checkoutTimeMs)}</div>
    </div>
  );
}

export default TimeSummaryPanel;
