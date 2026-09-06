import styles from "./RewardControls.module.css";
import type { Progression } from "../../services/quests/questsClient";

// Progression & Rewards UI atoms shared by OnboardingQuestline and MissionsPanel. Purely
// presentational: the panels own fetching and the claim call; the server owns every number.

/** Level, XP-to-next bar and Coins. Renders nothing until the first successful fetch. */
export function ProgressionStrip({ progression }: { progression: Progression | null }) {
  if (!progression) return null;
  const span = progression.nextLevelXp - progression.levelStartXp;
  const into = progression.xp - progression.levelStartXp;
  const pct = span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 100;
  return (
    <div className={styles.strip} data-testid="progression-strip">
      <span className={styles.level}>Lv {progression.level}</span>
      <div className={styles.xpBlock}>
        <div className={styles.xpBar} role="progressbar" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into} aria-label="XP to next level">
          <div className={styles.xpFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.xpText} data-testid="progression-xp">
          {progression.xp} XP · {into}/{span} to next
        </span>
      </div>
      <span className={styles.coins} data-testid="progression-coins">
        🪙 {progression.coins}
      </span>
    </div>
  );
}

export function RewardTag({ xp, coins }: { xp: number; coins: number }) {
  return (
    <span className={styles.reward} data-testid="reward-tag">
      +{xp} XP · +{coins} 🪙
    </span>
  );
}

export interface ClaimButtonProps {
  completed: boolean;
  claimed: boolean;
  pending: boolean;
  onClaim: () => void;
  label: string;
}

/** Nothing until completed; then Claim (disabled while a claim is in flight) or Claimed. */
export function ClaimButton({ completed, claimed, pending, onClaim, label }: ClaimButtonProps) {
  if (!completed) return null;
  if (claimed) {
    return (
      <span className={styles.claimed} data-testid="claimed">
        Claimed
      </span>
    );
  }
  return (
    <button className={styles.claim} onClick={onClaim} disabled={pending} aria-label={`Claim reward for ${label}`}>
      {pending ? "Claiming…" : "Claim"}
    </button>
  );
}
