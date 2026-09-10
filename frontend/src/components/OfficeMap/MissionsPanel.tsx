import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import styles from "./MissionsPanel.module.css";
import HudIcon from "../HudIcon";
import missionsArt from "../../assets/tasks-art/missions.png";
import { taskRowGlyph } from "./taskRowGlyph";
import { refreshClaimable } from "../../services/quests/claimableStore";
import { beginClaimSession, endClaimSession } from "../../services/quests/claimHudStore";
import { formatResetsIn } from "./formatResetsIn";
import { ClaimButton, RewardTag } from "./RewardControls";
import { collectReward } from "./rewardFx";
import { refreshProgression } from "../../services/quests/progressionStore";
import {
  claimReward,
  fetchMyMissions,
  type Mission,
  type MissionPeriod,
  type MyMissions,
} from "../../services/quests/questsClient";

// Daily/Weekly Missions panel — a read-only view of GET /missions/me plus Claim (POST
// /progression/claim, idempotent server-side), shell shared with OnboardingQuestline. Mounted
// only while open (OfficeMap.tsx's missionsOpen), so fetching on mount IS fetching on open.
// There is no local progress state to drift from the server; the panel simply refetches when
// the tab becomes visible again, when the browser comes back online (reconnect), and the moment
// the daily period rolls over while it is open.

export interface MissionsPanelProps {
  onClose: () => void;
  /** Rendered at the top of the panel, above the header — the bottom dock's Tasks control passes
   *  its Quests | Missions tab bar here (see TasksPanel.tsx). Nothing else about this panel
   *  changes: same fetch-on-open, same visibility/online/rollover refetches, same claims. */
  tabs?: ReactNode;
}

export function MissionsPanel({ onClose, tabs }: MissionsPanelProps) {
  const [data, setData] = useState<MyMissions | null>(null);
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
    void refreshProgression();
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

  const claim = async (m: Mission, period: MissionPeriod, source: DOMRect) => {
    if (claiming) return; // one claim in flight at a time — a double-click is one claim
    const key = `${m.id}@${period.periodKey}`;
    setClaiming(key);
    // Show the claim-time progression strip so the reward FX has a visible destination
    // while Tasks hides the dock. Reference-counted, so Claim All keeps it up across the
    // whole run rather than flashing per item.
    beginClaimSession();
    try {
      const res = await claimReward(m.id, period.periodKey);
      // Server-confirmed only: grantedNow=true bursts from the Claim button and travels to the
      // HUD (rewardFx.ts); a replay just syncs the confirmed balances silently.
      void collectReward(res, source);
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
      void refreshClaimable(); // drops the dock's Tasks badge as soon as the server confirms
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't claim that reward");
    } finally {
      setClaiming(null);
      endClaimSession();
    }
    return false;
  };

  // Every period's still-claimable missions, for the footer summary and Claim All.
  const ready = useMemo(() => {
    const out: Array<{ mission: Mission; period: MissionPeriod }> = [];
    for (const period of [data?.daily, data?.weekly]) {
      for (const mission of period?.missions ?? []) {
        if (period && mission.completed && !mission.claimed) out.push({ mission, period });
      }
    }
    return out;
  }, [data]);
  // Overall completion across BOTH periods — derived from the same mission objects the rows
  // render. No new state, no extra request.
  const allMissions = useMemo(
    () => [...(data?.daily.missions ?? []), ...(data?.weekly.missions ?? [])],
    [data],
  );
  const doneCount = allMissions.filter((m) => m.completed).length;
  const totalCount = allMissions.length;
  const donePct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const readyXp = ready.reduce((sum, r) => sum + r.mission.rewardXp, 0);
  const readyCoins = ready.reduce((sum, r) => sum + r.mission.rewardCoins, 0);

  // Claim All is ORCHESTRATION ONLY — it walks the same claim() above, one mission at a time, so
  // every claim is still the single existing POST /progression/claim with its own reward FX.
  const claimAll = async (source: DOMRect) => {
    if (claiming) return;
    // Held open around the WHOLE run so the strip cannot dip out between items.
    beginClaimSession();
    try {
      for (const { mission, period } of ready) {
        // eslint-disable-next-line no-await-in-loop -- sequential on purpose: one claim in flight.
        await claim(mission, period, source);
      }
    } finally {
      endClaimSession();
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-label="Missions" onClick={(e) => e.stopPropagation()}>
        <div className={styles.topBar}>
          {tabs}
          <button className={styles.closeButton} onClick={onClose} aria-label="Close missions">
            ✕
          </button>
        </div>

        <header className={styles.hero}>
          <div className={styles.heroText}>
            <h2 className={styles.title}>Make today count.</h2>
            <p className={styles.subtitle}>Fresh goals every day and every week.</p>
            {data && (
              <p className={styles.summary} data-testid="missions-summary">
                {`${doneCount} of ${totalCount} missions complete`}
              </p>
            )}
            <div
              className={styles.heroBar}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={totalCount}
              aria-valuenow={doneCount}
              aria-label="Missions complete"
            >
              <div className={styles.heroFill} style={{ width: `${donePct}%` }} />
            </div>
          </div>
          <img className={styles.heroArt} src={missionsArt} alt="" />
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

        {ready.length > 0 && (
          <footer className={styles.footer}>
            <div className={styles.footerSummary}>
              <span className={styles.footerLabel}>Rewards ready</span>
              <span className={styles.footerAmount}>
                <HudIcon name="xp" size="15px" />
                {`${readyXp} XP`}
              </span>
              <span className={styles.footerAmount}>
                <HudIcon name="coin" size="15px" />
                {`${readyCoins} coins`}
              </span>
            </div>
            <button
              className={styles.claimAll}
              disabled={Boolean(claiming)}
              onClick={(e) => void claimAll(e.currentTarget.getBoundingClientRect())}
              aria-label={`Claim all ${ready.length} rewards`}
            >
              {claiming ? "Claiming…" : `Claim all (${ready.length})`}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

interface PeriodSectionProps {
  label: string;
  period: MissionPeriod;
  claiming: string | null;
  onClaim: (m: Mission, period: MissionPeriod, source: DOMRect) => void;
}

function PeriodSection({ label, period, claiming, onClaim }: PeriodSectionProps) {
  const done = period.missions.filter((m) => m.completed).length;
  return (
    <section className={styles.section} data-testid={`missions-${period.cadence}`}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{label}</h3>
        <span className={styles.sectionMeta} data-testid={`missions-${period.cadence}-summary`}>
          {`${done}/${period.missions.length} complete`}
        </span>
        <span className={styles.sectionReset}>{formatResetsIn(period.endsAt)}</span>
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
              onClaim={(source) => onClaim(m, period, source)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function MissionRow({ mission: m, pending, onClaim }: { mission: Mission; pending: boolean; onClaim: (source: DOMRect) => void }) {
  const count = Math.min(m.count, m.target);
  return (
    <li
      className={m.completed ? styles.rowDone : styles.row}
      data-testid={`mission-${m.id}`}
      data-completed={m.completed ? "true" : "false"}
    >
      <span className={styles.rowGlyph} aria-hidden="true">
        <HudIcon name={taskRowGlyph(m.eventType)} size="26px" />
      </span>
      <div className={styles.rowMain}>
        {/* Same one-line grid Quests uses — title, count, rewards, action — with this row's
            progress bar directly beneath it. */}
        <div className={styles.rowTop}>
          <span className={styles.rowTitle}>{m.title}</span>
          {/* The per-row bar is gone; this chip carries the same count, quieter than Claim. */}
          <span
            className={m.completed ? `${styles.count} ${styles.countDone}` : styles.count}
            data-testid={`mission-count-${m.id}`}
            aria-label={`${count} of ${m.target} complete`}
          >
            {`${count}/${m.target}`}
          </span>
          <RewardTag xp={m.rewardXp} coins={m.rewardCoins} />
          <ClaimButton completed={m.completed} claimed={m.claimed} pending={pending} onClaim={onClaim} label={m.title} />
        </div>
      </div>
    </li>
  );
}

export default MissionsPanel;
