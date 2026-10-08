import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "./rewardFx";
import type { ClaimFeedback } from "../../services/quests/progressionStore";
import type { Progression } from "../../services/quests/questsClient";

// PRESENTATION ONLY — how a progression surface animates the numbers the store already holds.
// Extracted from PlayerHud so the claim-time strip (ClaimHud) counts up, fills and rolls over
// exactly as the dock does, instead of jumping to the final value. No progression state lives
// here: every input is the store's confirmed (or staged-then-committed) value.

export const XP_MS = 900;
export const COINS_MS = 700;
export const PULSE_MS = 650;
export const LEVEL_UP_MS = 2400;

/** Ease a displayed number toward `target` over `ms` (ease-out cubic). Reduced motion: jump. */
export function useAnimatedNumber(target: number, ms: number): number {
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
export function usePulse(trigger: number): boolean {
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

export interface LevelBounds {
  level: number;
  start: number;
  next: number;
}

/** Which level window the animated XP is currently inside. During a level-crossing claim the
 * meter first fills the OLD window to the threshold, then flips to the new level and continues —
 * a single claim can cross at most one level (max reward 100 XP, smallest window 100 XP). */
export function boundsFor(animatedXp: number, progression: Progression, lastClaim: ClaimFeedback | null): LevelBounds {
  if (lastClaim?.leveledUp && animatedXp < lastClaim.to.levelStartXp) {
    return { level: lastClaim.from.level, start: lastClaim.from.levelStartXp, next: lastClaim.from.nextLevelXp };
  }
  return { level: progression.level, start: progression.levelStartXp, next: progression.nextLevelXp };
}

export interface ProgressionMeter {
  coins: number;
  coinsPulsing: boolean;
  xpPulsing: boolean;
  bounds: LevelBounds;
  span: number;
  into: number;
  pct: number;
  /** Level Up treatment: on once the animated XP has actually crossed into the new level. */
  levelUpActive: boolean;
}

export function useProgressionMeter(
  progression: Progression,
  lastClaim: ClaimFeedback | null,
  coinsPulse: number,
  xpPulse: number,
): ProgressionMeter {
  const xp = useAnimatedNumber(progression.xp, XP_MS);
  const coins = useAnimatedNumber(progression.coins, COINS_MS);
  const coinsPulsing = usePulse(coinsPulse);
  const xpPulsing = usePulse(xpPulse);
  const bounds = boundsFor(xp, progression, lastClaim);
  const span = Math.max(1, bounds.next - bounds.start);
  const into = Math.max(0, Math.min(span, xp - bounds.start));
  const pct = Math.round((into / span) * 100);

  const crossed = Boolean(lastClaim?.leveledUp) && lastClaim !== null && xp >= lastClaim.to.levelStartXp;
  const [levelUpFor, setLevelUpFor] = useState<number | null>(null);
  useEffect(() => {
    if (!crossed || !lastClaim) return;
    setLevelUpFor(lastClaim.id);
    const t = window.setTimeout(() => setLevelUpFor(null), LEVEL_UP_MS);
    return () => window.clearTimeout(t);
  }, [crossed, lastClaim]);
  const levelUpActive = levelUpFor !== null && levelUpFor === lastClaim?.id;

  return { coins, coinsPulsing, xpPulsing, bounds, span, into, pct, levelUpActive };
}
