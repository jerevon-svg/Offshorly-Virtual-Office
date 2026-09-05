import { useEffect, useState } from "react";
import styles from "./OnboardingQuestline.module.css";
import { fetchMyQuests, type Quest } from "../../services/quests/questsClient";

// Onboarding Questline panel — a read-only view of GET /quests/me. Mounted only while open (see
// OfficeMap.tsx's questlineOpen), so fetching on mount IS fetching on open; there is no local
// progress state to drift from the server. Modal shell mirrors EmployeeProfile.tsx.

export interface OnboardingQuestlineProps {
  onClose: () => void;
}

export function OnboardingQuestline({ onClose }: OnboardingQuestlineProps) {
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyQuests()
      .then((data) => {
        if (!cancelled) setQuests(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load your quests");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
