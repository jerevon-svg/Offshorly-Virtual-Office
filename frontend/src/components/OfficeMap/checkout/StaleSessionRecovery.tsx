import { useRef, useState } from "react";
import { attendanceService, type AttendanceRecord } from "../../../services/attendance";
import styles from "./checkout.module.css";

interface Props {
  employeeId: string;
  checkedInAt: string;
  onRecovered: (record: AttendanceRecord) => void;
  onRefresh: (record: AttendanceRecord) => void;
}

export function StaleSessionRecovery({ employeeId, checkedInAt, onRecovered, onRefresh }: Props) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recover() {
    if (pending.current || !window.confirm("End this old attendance session without submitting a time log? Your draft will be kept.")) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const record = await attendanceService.recoverStaleSession(employeeId, checkedInAt);
      onRecovered(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed. Try again.");
      // A conflict may mean another tab already recovered or started a new session.
      try {
        onRefresh(await attendanceService.getMine(employeeId));
      } catch {
        // A failed refresh keeps the last confirmed attendance and the draft.
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop}>
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="stale-session-title">
        <h2 id="stale-session-title">Recover an old work session</h2>
        <p>This session started {new Date(checkedInAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (Manila) and has been open for at least 24 hours.</p>
        <p>End it without submitting a time log, then check in separately. Your draft stays saved. Historical time logs need separate correction; this does not repair or retry them.</p>
        {error && <p role="alert">{error}</p>}
        <button className={styles.primary} disabled={busy} onClick={() => void recover()}>
          {busy ? "Recovering…" : "End old session without time log"}
        </button>
      </section>
    </div>
  );
}
