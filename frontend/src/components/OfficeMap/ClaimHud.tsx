import HudIcon from "../HudIcon";
import styles from "./ClaimHud.module.css";
import { HUD_TARGET_ATTR } from "./rewardFx";
import { useProgressionMeter } from "./progressionMeter";
import { useProgressionStore, type ClaimFeedback } from "../../services/quests/progressionStore";
import type { Progression } from "../../services/quests/questsClient";
import { useClaimHudVisible } from "../../services/quests/claimHudStore";

// CLAIM-TIME PROGRESSION STRIP.
//
// Tasks hides the bottom dock, so the Coins/XP elements the reward FX aims at are off screen and
// a claim's particles fly somewhere the viewer cannot see. This is a compact stand-in that
// appears only while a claim is running, carrying the SAME [data-hud-target] hooks the Player HUD
// uses — so rewardFx.ts finds it with no change to how particles are spawned or flown.
//
// It owns no numbers: the balances come from the same progression store the Player HUD reads, and
// they update through the existing claim flow (rewardFx commits on particle arrival). The count-up,
// bar fill, level rollover and Level Up timing are PlayerHud's own (progressionMeter.ts), so the
// strip never shows the final value before the icons land.
//
// Rendered BEFORE HudDock in OfficeMap (and Vo3dHud); findHudTargets also skips any target inside
// an inert / aria-hidden / off-screen HUD, so the hidden dock's copy can never win.

export function ClaimHud() {
  const visible = useClaimHudVisible();
  const store = useProgressionStore();

  if (!visible || !store.progression) return null;
  return (
    <ClaimHudBody
      progression={store.progression}
      lastClaim={store.lastClaim}
      coinsPulse={store.coinsPulse}
      xpPulse={store.xpPulse}
    />
  );
}

interface ClaimHudBodyProps {
  progression: Progression;
  lastClaim: ClaimFeedback | null;
  coinsPulse: number;
  xpPulse: number;
}

function ClaimHudBody({ progression, lastClaim, coinsPulse, xpPulse }: ClaimHudBodyProps) {
  const { coins, coinsPulsing, xpPulsing, bounds, span, into, pct, levelUpActive } = useProgressionMeter(
    progression,
    lastClaim,
    coinsPulse,
    xpPulse,
  );

  return (
    <div className={styles.strip} data-testid="claim-hud" aria-live="polite">
      <div className={coinsPulsing ? styles.coinsPulse : styles.coins} {...{ [HUD_TARGET_ATTR]: "coins" }} aria-label="Coins balance">
        <HudIcon name="coin" size="19px" />
        <span className={styles.coinsValue} data-testid="claim-hud-coins">
          {coins.toLocaleString()}
        </span>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={xpPulsing ? styles.xpPulse : styles.xp} {...{ [HUD_TARGET_ATTR]: "xp" }}>
        <HudIcon name="xp" size="17px" />
        <div className={styles.xpBlock}>
          <span className={styles.xpHeader}>
            <span className={levelUpActive ? styles.levelUp : styles.level} data-testid="claim-hud-level">
              Lv {bounds.level}
            </span>
            <span className={styles.xpValue} data-testid="claim-hud-xp">
              {`${into} / ${span} XP`}
            </span>
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

      {levelUpActive && (
        <span className={styles.levelUpCaption} data-testid="claim-hud-level-up" role="status">
          Level up
        </span>
      )}
    </div>
  );
}

export default ClaimHud;
