import HudIcon from "../HudIcon";
import styles from "./ClaimHud.module.css";
import { HUD_TARGET_ATTR } from "./rewardFx";
import { useProgression } from "../../services/quests/progressionStore";
import { useClaimHudVisible } from "../../services/quests/claimHudStore";

// CLAIM-TIME PROGRESSION STRIP.
//
// Tasks hides the bottom dock, so the Coins/XP elements the reward FX aims at are off screen and
// a claim's particles fly somewhere the viewer cannot see. This is a compact stand-in that
// appears only while a claim is running, carrying the SAME [data-hud-target] hooks the Player HUD
// uses — so rewardFx.ts finds it with no change to how particles are spawned or flown.
//
// It owns no numbers: the balances come from the same progression store the Player HUD reads, and
// they update through the existing claim flow (rewardFx commits on particle arrival). Rendered
// BEFORE HudDock in OfficeMap so that, while it is mounted, findHudTargets' querySelector picks
// this visible strip rather than the hidden dock's copy.

export function ClaimHud() {
  const visible = useClaimHudVisible();
  const progression = useProgression();

  if (!visible || !progression) return null;

  const span = progression.nextLevelXp - progression.levelStartXp;
  const into = progression.xp - progression.levelStartXp;
  const pct = span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 100;

  return (
    <div className={styles.strip} data-testid="claim-hud" aria-live="polite">
      <div className={styles.coins} {...{ [HUD_TARGET_ATTR]: "coins" }} aria-label="Coins balance">
        <HudIcon name="coin" size="19px" />
        <span className={styles.coinsValue} data-testid="claim-hud-coins">
          {progression.coins.toLocaleString()}
        </span>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.xp} {...{ [HUD_TARGET_ATTR]: "xp" }}>
        <HudIcon name="xp" size="17px" />
        <div className={styles.xpBlock}>
          <span className={styles.xpValue} data-testid="claim-hud-xp">
            {`${into} / ${span} XP`}
          </span>
          <div
            className={styles.bar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={span}
            aria-valuenow={into}
            aria-label="XP to next level"
          >
            <div className={styles.fill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClaimHud;
