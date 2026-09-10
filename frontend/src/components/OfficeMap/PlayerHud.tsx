import { useEffect, useRef, useState, type ReactNode } from "react";
import HudIcon from "../HudIcon";
import styles from "./PlayerHud.module.css";
import { HUD_TARGET_ATTR, reducedMotion } from "./rewardFx";
import { useCurrentUser } from "../../auth/currentUserStore";
import { avatarIdForEmail } from "../../data/avatarIdentity";
import { profileImageFor } from "../../data/portraits";
import { SPRITE_SET_BY_AVATAR_ID, characterSprite } from "../../data/bonWalkFrames";
import { PLACEHOLDER_SPRITE_SET } from "../../services/avatar/placeholder";
import {
  refreshBadges,
  refreshProgression,
  useProgressionStore,
  type BadgeAwardFeedback,
  type ClaimFeedback,
} from "../../services/quests/progressionStore";
import type { Progression } from "../../services/quests/questsClient";
import { useSelfStatus } from "../../services/presence/selfStatusStore";
import { STATUS_META } from "../../services/presence/status";

// Player HUD — avatar + first name, Level, XP meter with current / required XP, and a dedicated
// Coins balance. It used to own the office's top-left corner; it now renders as the
// profile/progression group at the left end of the bottom dock (`layout="dock"`, see
// HudDock.tsx), which is why the panel chrome and the vertical stack are variant-only.
// Everything shown is the server's number:
// the store only changes on a refresh, a confirmed claim, or a staged commit when the reward
// icons land (see rewardFx.ts), so the counters and meter animate strictly AFTER confirmation.
// The Coins area and the XP meter carry [data-hud-target] so the collection FX can find its
// destinations live, wherever this HUD is laid out.

const XP_MS = 900;
const COINS_MS = 700;
const PULSE_MS = 650;
const LEVEL_UP_MS = 2400;

/** Ease a displayed number toward `target` over `ms` (ease-out cubic). Reduced motion: jump. */
function useAnimatedNumber(target: number, ms: number): number {
  const [value, setValue] = useState(target);
  const shown = useRef(target);
  useEffect(() => {
    const start = shown.current;
    if (start === target) return;
    if (reducedMotion()) {
      shown.current = target;
      setValue(target);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const next = Math.round(start + (target - start) * eased);
      shown.current = next;
      setValue(next);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

/** True for PULSE_MS after `trigger` changes (skipping the initial value). */
function usePulse(trigger: number): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const t = window.setTimeout(() => setOn(false), PULSE_MS);
    return () => window.clearTimeout(t);
  }, [trigger]);
  return on;
}

interface LevelBounds {
  level: number;
  start: number;
  next: number;
}

/** Which level window the animated XP is currently inside. During a level-crossing claim the
 * meter first fills the OLD window to the threshold, then flips to the new level and continues —
 * a single claim can cross at most one level (max reward 100 XP, smallest window 100 XP). */
function boundsFor(animatedXp: number, progression: Progression, lastClaim: ClaimFeedback | null): LevelBounds {
  if (lastClaim?.leveledUp && animatedXp < lastClaim.to.levelStartXp) {
    return { level: lastClaim.from.level, start: lastClaim.from.levelStartXp, next: lastClaim.from.nextLevelXp };
  }
  return { level: progression.level, start: progression.levelStartXp, next: progression.nextLevelXp };
}

function firstNameFor(fullName: string | undefined, email: string | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  if (first) return first;
  const local = (email ?? "").split("@")[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "You";
}

/** New Portrait when one exists (data/portraits.ts), else the sprite's front idle frame. */
function avatarSrcFor(email: string | undefined): string {
  return profileImageFor(email, () => {
    const avatarId = email ? avatarIdForEmail(email) : null;
    const set = avatarId ? SPRITE_SET_BY_AVATAR_ID[avatarId] : undefined;
    return characterSprite(set ?? PLACEHOLDER_SPRITE_SET, "idle", "front");
  });
}

export interface PlayerHudProps {
  /** True while a modal from the z-index 60 family (e.g. the Global Team Map) is open. Standalone
   *  the HUD sits ABOVE those backdrops on purpose — reward FX fly into it — but a modal that the
   *  viewer is meant to read in full must dim it like the rest of the office. Inside the dock the
   *  dock owns this step instead, so the prop is left at its default there. */
  behindModal?: boolean;
  /** "dock": lay out as one horizontal group on the bottom dock's light surface instead of the
   *  standalone floating top-left panel. Presentation only — identical data, identical FX
   *  targets, identical store wiring. */
  layout?: "standalone" | "dock";
  /** Rendered under the name in dock layout (the availability picker). */
  statusSlot?: ReactNode;
  /** Makes the avatar + name block open the viewer's own profile, the action the old 👤 Profile
   *  pill performed. */
  onProfileClick?: () => void;
}

export function PlayerHud({
  behindModal = false,
  layout = "standalone",
  statusSlot,
  onProfileClick,
}: PlayerHudProps = {}) {
  const store = useProgressionStore();
  const user = useCurrentUser();

  useEffect(() => {
    const refresh = () => {
      void refreshProgression();
      void refreshBadges();
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onOnline = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!store.progression) {
    // Nothing to show until the server answers. In the dock that must not take the availability
    // picker down with it — the picker is handed to us and is offered independently of
    // progression, so it keeps rendering while the first fetch is in flight.
    return layout === "dock" && statusSlot ? <div className={styles.hudDockPending}>{statusSlot}</div> : null;
  }
  return (
    <HudBody
      progression={store.progression}
      lastClaim={store.lastClaim}
      lastAward={store.lastAward}
      coinsPulse={store.coinsPulse}
      xpPulse={store.xpPulse}
      name={firstNameFor(user?.full_name, user?.email)}
      avatar={avatarSrcFor(user?.email)}
      behindModal={behindModal}
      layout={layout}
      statusSlot={statusSlot}
      onProfileClick={onProfileClick}
    />
  );
}

interface HudBodyProps {
  progression: Progression;
  lastClaim: ClaimFeedback | null;
  lastAward: BadgeAwardFeedback | null;
  coinsPulse: number;
  xpPulse: number;
  name: string;
  avatar: string;
  behindModal: boolean;
  layout: "standalone" | "dock";
  statusSlot?: ReactNode;
  onProfileClick?: () => void;
}

function HudBody({
  progression,
  lastClaim,
  lastAward,
  coinsPulse,
  xpPulse,
  name,
  avatar,
  behindModal,
  layout,
  statusSlot,
  onProfileClick,
}: HudBodyProps) {
  // Same self-status store the availability picker beside it writes to — the dock avatar's
  // presence dot is the live effective status, never a hardcoded colour.
  const { currentStatus: status } = useSelfStatus();
  const xp = useAnimatedNumber(progression.xp, XP_MS);
  const coins = useAnimatedNumber(progression.coins, COINS_MS);
  const coinsPulsing = usePulse(coinsPulse);
  const xpPulsing = usePulse(xpPulse);
  const bounds = boundsFor(xp, progression, lastClaim);
  const span = Math.max(1, bounds.next - bounds.start);
  const into = Math.max(0, Math.min(span, xp - bounds.start));
  const pct = Math.round((into / span) * 100);

  // Level Up treatment: once the animated XP has actually crossed into the new level.
  const crossed = Boolean(lastClaim?.leveledUp) && lastClaim !== null && xp >= lastClaim.to.levelStartXp;
  const [levelUpFor, setLevelUpFor] = useState<number | null>(null);
  useEffect(() => {
    if (!crossed || !lastClaim) return;
    setLevelUpFor(lastClaim.id);
    const t = window.setTimeout(() => setLevelUpFor(null), LEVEL_UP_MS);
    return () => window.clearTimeout(t);
  }, [crossed, lastClaim]);
  const levelUpActive = levelUpFor !== null && levelUpFor === lastClaim?.id;

  // Badge earned: same restrained caption treatment as Level Up, shown when a badge refresh
  // reports a newly crossed tier. Level Up wins the slot if both happen at once.
  const [awardFor, setAwardFor] = useState<number | null>(null);
  useEffect(() => {
    if (!lastAward) return;
    setAwardFor(lastAward.id);
    const t = window.setTimeout(() => setAwardFor(null), LEVEL_UP_MS);
    return () => window.clearTimeout(t);
  }, [lastAward]);
  const awardActive = !levelUpActive && awardFor !== null && awardFor === lastAward?.id;

  const dock = layout === "dock";

  const bar = (
    <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into} aria-label="XP to next level">
      <div className={styles.fill} style={{ width: `${pct}%` }} />
    </div>
  );

  const captions = (
    <>
      {levelUpActive && (
        <span className={styles.levelUpCaption} data-testid="level-up" role="status" aria-live="polite">
          Level up
        </span>
      )}
      {awardActive && lastAward && (
        <span className={styles.levelUpCaption} data-testid="badge-earned" role="status" aria-live="polite">
          {lastAward.title} · {lastAward.tierName}
        </span>
      )}
    </>
  );

  // ---- DOCK LAYOUT: matches the approved reference ------------------------------------------
  // [avatar + presence dot] [name · Lv chip / status picker]  ‖  [coins / xp numbers + XP bar]
  // The XP BAR and the XP NUMBERS are one group in the progression block — the bar reads the same
  // animated `xp` the numbers do and is still the only bar rendered. The FX target attributes stay
  // on the coins block and on the numbers block, so rewardFx.ts finds them unchanged.
  if (dock) {
    const avatarBlock = (
      <span className={styles.avatarWrap}>
        <img className={styles.avatar} src={avatar} alt="" />
        <span
          className={styles.presenceDot}
          style={{ background: STATUS_META[status].color }}
          aria-hidden="true"
        />
      </span>
    );
    const nameLine = (
      <span className={styles.nameLine}>
        <span className={styles.name}>{name}</span>
        <span className={levelUpActive ? styles.levelUp : styles.level} data-testid="hud-level">
          <HudIcon name="level" /> Lv {bounds.level}
        </span>
      </span>
    );
    return (
      <div className={`${styles.hud} ${styles.hudDock}`} data-testid="player-hud" aria-label="Your progression">
        <div className={styles.dockProfile}>
          {/* The avatar is the single Profile entry point (the action the old 👤 Profile pill
              performed). Deliberately ONE control rather than avatar-and-name both being
              buttons: two buttons with the same accessible name is a worse experience than one
              obvious 44px target. */}
          {onProfileClick ? (
            <button
              type="button"
              className={styles.identityButton}
              onClick={onProfileClick}
              aria-label="Open my profile"
              title="Open my profile"
            >
              {avatarBlock}
            </button>
          ) : (
            avatarBlock
          )}
          <div className={styles.dockProfileText}>
            {nameLine}
            {statusSlot && <div className={styles.statusSlot}>{statusSlot}</div>}
            {captions}
          </div>
        </div>
        <div className={styles.dockDivider} />
        <div className={styles.dockProgress}>
          <div className={coinsPulsing ? styles.coinsPulse : styles.coins} {...{ [HUD_TARGET_ATTR]: "coins" }} aria-label="Coins balance">
            <span className={styles.coinIcon} aria-hidden="true">
              <HudIcon name="coin" />
            </span>
            <span className={styles.coinsValue} data-testid="hud-coins">
              {coins.toLocaleString()}
            </span>
          </div>
          <div className={xpPulsing ? styles.meterPulse : styles.meter} {...{ [HUD_TARGET_ATTR]: "xp" }}>
            <span className={styles.xpDiamond} aria-hidden="true">
              <HudIcon name="xp" />
            </span>
            <span className={styles.meterValue} data-testid="hud-xp">
              {into} / {span} XP
            </span>
          </div>
          {bar}
        </div>
      </div>
    );
  }

  return (
    <div
      className={behindModal ? `${styles.hud} ${styles.behindModal}` : styles.hud}
      data-testid="player-hud"
      aria-label="Your progression"
    >
      <div className={styles.identity}>
        <img className={styles.avatar} src={avatar} alt="" />
        <div className={styles.identityText}>
          <span className={styles.name}>{name}</span>
          <span className={levelUpActive ? styles.levelUp : styles.level} data-testid="hud-level">
            Level {bounds.level}
          </span>
        </div>
        {captions}
      </div>

      <div className={xpPulsing ? styles.meterPulse : styles.meter} {...{ [HUD_TARGET_ATTR]: "xp" }}>
        <div className={styles.meterHeader}>
          <span className={styles.meterLabel}>XP</span>
          <span className={styles.meterValue} data-testid="hud-xp">
            {into} / {span}
          </span>
        </div>
        {bar}
      </div>

      <div className={coinsPulsing ? styles.coinsPulse : styles.coins} {...{ [HUD_TARGET_ATTR]: "coins" }} aria-label="Coins balance">
        <span className={styles.coinIcon} aria-hidden="true">
          <HudIcon name="coin" />
        </span>
        <span className={styles.coinsValue} data-testid="hud-coins">
          {coins.toLocaleString()}
        </span>
        <span className={styles.coinsLabel}>Coins</span>
      </div>
    </div>
  );
}

export default PlayerHud;
