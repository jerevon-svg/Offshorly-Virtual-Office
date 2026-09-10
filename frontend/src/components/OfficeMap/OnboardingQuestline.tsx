import { useEffect, useMemo, useState, type ReactNode } from "react";
import styles from "./OnboardingQuestline.module.css";
import HudIcon from "../HudIcon";
import questsArt from "../../assets/tasks-art/quests.png";
import { taskRowGlyph } from "./taskRowGlyph";
import { refreshClaimable } from "../../services/quests/claimableStore";
import { beginClaimSession, endClaimSession } from "../../services/quests/claimHudStore";
import { ClaimButton, RewardTag } from "./RewardControls";
import { collectReward } from "./rewardFx";
import { refreshProgression } from "../../services/quests/progressionStore";
import { claimReward, fetchMyQuests, type Quest } from "../../services/quests/questsClient";

// Onboarding Questline panel — a read-only view of GET /quests/me plus the one write the user
// can make: Claim a completed quest's reward (POST /progression/claim, idempotent server-side).
// Mounted only while open (see OfficeMap.tsx's questlineOpen), so fetching on mount IS fetching
// on open; there is no local progress state to drift from the server. Modal shell mirrors
// EmployeeProfile.tsx.

export interface OnboardingQuestlineProps {
  onClose: () => void;
  /** Rendered at the top of the panel, above the header. The bottom dock's Tasks control passes
   *  its Quests | Missions tab bar here (see TasksPanel.tsx); nothing else does. The panel is
   *  otherwise untouched — it still owns its own fetch, its own claims and its own FX. */
  tabs?: ReactNode;
}

export function OnboardingQuestline({ onClose, tabs }: OnboardingQuestlineProps) {
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyQuests()
      .then((data) => {
        if (!cancelled) setQuests(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load your quests");
      });
    // Balances are decorative here: a failed refresh leaves the last known value in the store.
    void refreshProgression();
    return () => {
      cancelled = true;
    };
  }, []);

  const claim = async (q: Quest, source: DOMRect) => {
    if (claiming) return; // one claim in flight at a time — a double-click is one claim
    setClaiming(q.id);
    // Show the claim-time progression strip so the reward FX has a visible destination
    // while Tasks hides the dock. Reference-counted, so Claim All keeps it up across the
    // whole run rather than flashing per item.
    beginClaimSession();
    try {
      const res = await claimReward(q.id, "");
      // Server-confirmed only: grantedNow=true bursts from the Claim button and travels to the
      // HUD (rewardFx.ts); a replay just syncs the confirmed balances silently.
      void collectReward(res, source);
      setQuests((prev) =>
        prev ? prev.map((x) => (x.id === q.id ? { ...x, claimed: true, claimedAt: new Date().toISOString() } : x)) : prev,
      );
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

  // Claim All is ORCHESTRATION ONLY — it walks the same claim() above, one quest at a time, so
  // every claim is still the single existing POST /progression/claim with its own reward FX.
  const claimAll = async (source: DOMRect) => {
    if (claiming) return;
    // Held open around the WHOLE run so the strip cannot dip out between items.
    beginClaimSession();
    try {
      for (const q of readyToClaim) {
        // eslint-disable-next-line no-await-in-loop -- sequential on purpose: one claim in flight.
        await claim(q, source);
      }
    } finally {
      endClaimSession();
    }
  };

  const done = quests?.filter((q) => q.completed).length ?? 0;
  const readyToClaim = useMemo(
    () => (quests ?? []).filter((q) => q.completed && !q.claimed),
    [quests],
  );
  const claimedQuests = useMemo(() => (quests ?? []).filter((q) => q.claimed), [quests]);
  const pending = useMemo(() => (quests ?? []).filter((q) => !q.completed), [quests]);
  const readyXp = readyToClaim.reduce((sum, q) => sum + q.rewardXp, 0);
  const readyCoins = readyToClaim.reduce((sum, q) => sum + q.rewardCoins, 0);
  const total = quests?.length ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Onboarding Questline"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.topBar}>
          {tabs}
          <button className={styles.closeButton} onClick={onClose} aria-label="Close quests">
            ✕
          </button>
        </div>

        <header className={styles.hero}>
          <div className={styles.heroText}>
            <span className={styles.eyebrow}>Onboarding</span>
            <h2 className={styles.title}>
              {total > 0 && done === total ? "You know your way around!" : "Find your way around."}
            </h2>
            {quests && (
              <p className={styles.summary} data-testid="questline-summary">
                {`${done} of ${total} quests complete`}
              </p>
            )}
            <div
              className={styles.heroBar}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-label="Quests complete"
            >
              <div className={styles.heroFill} style={{ width: `${pct}%` }} />
            </div>
          </div>
          <img className={styles.heroArt} src={questsArt} alt="" />
        </header>

        <div className={styles.body}>
          {error && <p className={styles.error}>{error}</p>}
          {!error && !quests && <p className={styles.muted}>Loading…</p>}

          {readyToClaim.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Ready to claim</h3>
                <span className={styles.sectionCount}>{readyToClaim.length}</span>
              </div>
              <ol className={styles.list}>
                {readyToClaim.map((q) => (
                  <QuestRow key={q.id} quest={q} pending={claiming === q.id} onClaim={(r) => void claim(q, r)} />
                ))}
              </ol>
            </section>
          )}

          {pending.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>In progress</h3>
                <span className={styles.sectionCount}>{pending.length}</span>
              </div>
              <ol className={styles.list}>
                {pending.map((q) => (
                  <QuestRow key={q.id} quest={q} pending={claiming === q.id} onClaim={(r) => void claim(q, r)} />
                ))}
              </ol>
            </section>
          )}

          {claimedQuests.length > 0 && (
            <details className={styles.claimedGroup}>
              <summary className={styles.claimedSummary}>{`Claimed quests · ${claimedQuests.length}`}</summary>
              <ol className={styles.list}>
                {claimedQuests.map((q) => (
                  <QuestRow key={q.id} quest={q} pending={false} onClaim={() => {}} />
                ))}
              </ol>
            </details>
          )}
        </div>

        {readyToClaim.length > 0 && (
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
              aria-label={`Claim all ${readyToClaim.length} rewards`}
            >
              {claiming ? "Claiming…" : `Claim all (${readyToClaim.length})`}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function QuestRow({
  quest: q,
  pending,
  onClaim,
}: {
  quest: Quest;
  pending: boolean;
  onClaim: (source: DOMRect) => void;
}) {
  return (
    <li
      className={q.completed ? styles.rowDone : styles.row}
      data-testid={`quest-${q.id}`}
      data-completed={q.completed ? "true" : "false"}
    >
      <span className={styles.rowGlyph} aria-hidden="true">
        <HudIcon name={taskRowGlyph(q.eventType)} size="26px" />
      </span>
      <span className={styles.check} aria-hidden="true">
        {q.completed ? "✓" : "○"}
      </span>
      <span className={styles.rowTitle}>{q.title}</span>
      {q.mode === "unique_count" && (
        <span className={styles.progress}>
          {Math.min(q.count, q.target)}/{q.target}
        </span>
      )}
      <RewardTag xp={q.rewardXp} coins={q.rewardCoins} />
      <ClaimButton
        completed={q.completed}
        claimed={q.claimed}
        pending={pending}
        onClaim={onClaim}
        label={q.title}
      />
    </li>
  );
}

export default OnboardingQuestline;
