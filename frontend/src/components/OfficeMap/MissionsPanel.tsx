import { useCallback, useEffect, useState } from "react";
import styles from "./MissionsPanel.module.css";
import { formatResetsIn } from "./formatResetsIn";
import { ClaimButton, ProgressionStrip, RewardTag } from "./RewardControls";
import {
  claimReward,
  fetchMyMissions,
  fetchMyProgression,
  type Mission,
  type MissionPeriod,
  type MyMissions,
  type Progression,
} from "../../services/quests/questsClient";

// Daily/Weekly Missions panel — a read-only view of GET /missions/me plus Claim (POST
// /progression/claim, idempotent server-side), shell shared with OnboardingQuestline. Mounted
// only while open (OfficeMap.tsx's missionsOpen), so fetching on mount IS fetching on open.
// There is no local progress state to drift from the server; the panel simply refetches when
// the tab becomes visible again, when the browser comes back online (reconnect), and the moment
// the daily period rolls over while it is open.

export interface MissionsPanelProps {
  onClose: () => void;
}

export function MissionsPanel({ onClose }: MissionsPanelProps) {
  const [data, setData] = useState<MyMissions | null>(null);
  const [progression, setProgression] = useState<Progression | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

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
    fetchMyProgression()
      .then((p) => {
        if (!cancelled) setProgression(p);
      })
      .catch(() => {});
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

  const claim = async (m: Mission, period: MissionPeriod) => {
    if (claiming) return; // one claim in flight at a time — a double-click is one claim
    const key = `${m.id}@${period.periodKey}`;
    setClaiming(key);
    try {
      const res = await claimReward(m.id, period.periodKey);
      setProgression(res.progression);
      setData((prev) => {
        if (!prev) return prev;
        const patch = (block: MissionPeriod): MissionPeriod =>
          block.periodKey !== period.periodKey
            ? block
            : {
                ...block,
                missions: block.missions.map((x) =>
                  x.id === m.id ? { ...x, claimed: true, claimedAt: new Date().toISOString() } : x,
                ),
              };
        return { ...prev, daily: patch(prev.daily), weekly: patch(prev.weekly) };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't claim that reward");
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-label="Missions" onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close missions">
          ✕
        </button>
        <header className={styles.header}>
          <h2 className={styles.title}>Missions</h2>
          <p className={styles.muted}>Fresh goals every day and every week.</p>
          <ProgressionStrip progression={progression} />
        </header>
        <div className={styles.body}>
          {error && <p className={styles.error}>{error}</p>}
          {!error && !data && <p className={styles.muted}>Loading…</p>}
          {data && (
            <>
              <PeriodSection label="Daily" period={data.daily} claiming={claiming} onClaim={claim} />
              <PeriodSection label="Weekly" period={data.weekly} claiming={claiming} onClaim={claim} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface PeriodSectionProps {
  label: string;
  period: MissionPeriod;
  claiming: string | null;
  onClaim: (m: Mission, period: MissionPeriod) => void;
}

function PeriodSection({ label, period, claiming, onClaim }: PeriodSectionProps) {
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
            <MissionRow
              key={m.id}
              mission={m}
              pending={claiming === `${m.id}@${period.periodKey}`}
              onClaim={() => onClaim(m, period)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function MissionRow({ mission: m, pending, onClaim }: { mission: Mission; pending: boolean; onClaim: () => void }) {
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
      <div className={styles.rowBottom}>
        <RewardTag xp={m.rewardXp} coins={m.rewardCoins} />
        <ClaimButton completed={m.completed} claimed={m.claimed} pending={pending} onClaim={onClaim} label={m.title} />
      </div>
    </li>
  );
}

export default MissionsPanel;
