import { useCallback, useEffect, useState } from "react";
import styles from "./MissionsPanel.module.css";
import { formatResetsIn } from "./formatResetsIn";
import { fetchMyMissions, type Mission, type MissionPeriod, type MyMissions } from "../../services/quests/questsClient";

// Daily/Weekly Missions panel — a read-only view of GET /missions/me, shell shared with
// OnboardingQuestline. Mounted only while open (OfficeMap.tsx's missionsOpen), so fetching on
// mount IS fetching on open. There is no local progress state to drift from the server; the
// panel simply refetches when the tab becomes visible again, when the browser comes back
// online (reconnect), and the moment the daily period rolls over while it is open.

export interface MissionsPanelProps {
  onClose: () => void;
}

export function MissionsPanel({ onClose }: MissionsPanelProps) {
  const [data, setData] = useState<MyMissions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetchMyMissions()
      .then((next) => {
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load your missions");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  // Refresh/reconnect persistence: the server owns state, so re-asking is always correct.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", load);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", load);
    };
  }, [load]);

  // Rollover: when the daily period ends while open, fetch the new day's draw.
  useEffect(() => {
    if (!data) return;
    const delay = new Date(data.daily.endsAt).getTime() - Date.now() + 1000;
    const timer = window.setTimeout(load, Math.min(Math.max(delay, 1000), 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [data, load]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-label="Missions" onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close missions">
          ✕
        </button>
        <header className={styles.header}>
          <h2 className={styles.title}>Missions</h2>
          <p className={styles.muted}>Fresh goals every day and every week.</p>
        </header>
        <div className={styles.body}>
          {error && <p className={styles.error}>{error}</p>}
          {!error && !data && <p className={styles.muted}>Loading…</p>}
          {data && (
            <>
              <PeriodSection label="Daily" period={data.daily} />
              <PeriodSection label="Weekly" period={data.weekly} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PeriodSection({ label, period }: { label: string; period: MissionPeriod }) {
  const done = period.missions.filter((m) => m.completed).length;
  return (
    <section className={styles.section} data-testid={`missions-${period.cadence}`}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{label}</h3>
        <span className={styles.sectionMeta} data-testid={`missions-${period.cadence}-summary`}>
          {done}/{period.missions.length} · {formatResetsIn(period.endsAt)}
        </span>
      </div>
      {period.missions.length === 0 ? (
        <p className={styles.muted}>No missions this period.</p>
      ) : (
        <ol className={styles.list}>
          {period.missions.map((m) => (
            <MissionRow key={m.id} mission={m} />
          ))}
        </ol>
      )}
    </section>
  );
}

function MissionRow({ mission: m }: { mission: Mission }) {
  const count = Math.min(m.count, m.target);
  const pct = m.target > 0 ? Math.round((count / m.target) * 100) : 0;
  return (
    <li
      className={m.completed ? styles.rowDone : styles.row}
      data-testid={`mission-${m.id}`}
      data-completed={m.completed ? "true" : "false"}
    >
      <div className={styles.rowTop}>
        <span className={styles.check} aria-hidden="true">
          {m.completed ? "✓" : "○"}
        </span>
        <span className={styles.rowTitle}>{m.title}</span>
        <span className={styles.progress}>
          {count}/{m.target}
        </span>
      </div>
      <div
        className={styles.bar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={m.target}
        aria-valuenow={count}
        aria-label={`${m.title} progress`}
      >
        <div className={styles.barFill} style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
}

export default MissionsPanel;
