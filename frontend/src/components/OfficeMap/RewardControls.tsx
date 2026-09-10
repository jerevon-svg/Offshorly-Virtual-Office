import HudIcon from "../HudIcon";
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
        <HudIcon name="coin" size="15px" /> {progression.coins}
      </span>
    </div>
  );
}

export function RewardTag({ xp, coins }: { xp: number; coins: number }) {
  return (
    <span className={styles.reward} data-testid="reward-tag">
      <HudIcon name="xp" size="15px" />
      {`+${xp} XP`}
      <span className={styles.rewardGap} aria-hidden="true" />
      <HudIcon name="coin" size="15px" />
      {`+${coins}`}
    </span>
  );
}

export interface ClaimButtonProps {
  completed: boolean;
  claimed: boolean;
  pending: boolean;
  /** Receives the clicked control's rect — the origin of the reward collection FX. */
  onClaim: (source: DOMRect) => void;
  label: string;
}

/** Always rendered, so the row's action column never changes width and nothing beside it shifts
 *  between states. Only the middle state is actionable — claim ELIGIBILITY is unchanged, and only
 *  that state carries the "Claim reward for X" accessible name, so the two disabled states remain
 *  invisible to anything looking for a claimable action. */
export function ClaimButton({ completed, claimed, pending, onClaim, label }: ClaimButtonProps) {
  if (claimed) {
    return (
      <button className={styles.claimDone} disabled aria-label={`Reward claimed for ${label}`} data-testid="claimed">
        Claimed
      </button>
    );
  }
  if (!completed) {
    return (
      <button className={styles.claimIdle} disabled aria-label={`${label} is not complete yet`}>
        Claim
      </button>
    );
  }
  return (
    <button
      className={styles.claim}
      onClick={(e) => onClaim(e.currentTarget.getBoundingClientRect())}
      disabled={pending}
      aria-label={`Claim reward for ${label}`}
    >
      {pending ? "Claiming…" : "Claim"}
    </button>
  );
}
