import { useEffect, useState } from "react";
import styles from "./OnboardingQuestline.module.css";
import { ClaimButton, ProgressionStrip, RewardTag } from "./RewardControls";
import {
  claimReward,
  fetchMyProgression,
  fetchMyQuests,
  type Progression,
  type Quest,
} from "../../services/quests/questsClient";

// Onboarding Questline panel — a read-only view of GET /quests/me plus the one write the user
// can make: Claim a completed quest's reward (POST /progression/claim, idempotent server-side).
// Mounted only while open (see OfficeMap.tsx's questlineOpen), so fetching on mount IS fetching
// on open; there is no local progress state to drift from the server. Modal shell mirrors
// EmployeeProfile.tsx.

export interface OnboardingQuestlineProps {
  onClose: () => void;
}

export function OnboardingQuestline({ onClose }: OnboardingQuestlineProps) {
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [progression, setProgression] = useState<Progression | null>(null);
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
    // Balances are decorative here: a failure leaves the strip hidden, not the panel broken.
    fetchMyProgression()
      .then((p) => {
        if (!cancelled) setProgression(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const claim = async (q: Quest) => {
    if (claiming) return; // one claim in flight at a time — a double-click is one claim
    setClaiming(q.id);
    try {
      const res = await claimReward(q.id, "");
      setProgression(res.progression);
      setQuests((prev) =>
        prev ? prev.map((x) => (x.id === q.id ? { ...x, claimed: true, claimedAt: new Date().toISOString() } : x)) : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't claim that reward");
    } finally {
      setClaiming(null);
    }
  };

  const done = quests?.filter((q) => q.completed).length ?? 0;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Onboarding Questline"
        onClick={(e) => e.stopPropagation()}
      >
        <button className={styles.closeButton} onClick={onClose} aria-label="Close quests">
          ✕
        </button>
        <header className={styles.header}>
          <h2 className={styles.title}>Onboarding Questline</h2>
          {quests && (
            <p className={styles.summary} data-testid="questline-summary">
              {done} of {quests.length} complete
            </p>
          )}
          <ProgressionStrip progression={progression} />
        </header>
        <div className={styles.body}>
          {error && <p className={styles.error}>{error}</p>}
          {!error && !quests && <p className={styles.muted}>Loading…</p>}
          {quests && (
            <ol className={styles.list}>
              {quests.map((q) => (
                <li
                  key={q.id}
                  className={q.completed ? styles.rowDone : styles.row}
                  data-testid={`quest-${q.id}`}
                  data-completed={q.completed ? "true" : "false"}
                >
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
                    pending={claiming === q.id}
                    onClaim={() => void claim(q)}
                    label={q.title}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

export default OnboardingQuestline;
