import { useSyncExternalStore } from "react";
import { fetchMyBadges, fetchMyProgression, type Badge, type ClaimResult, type Progression } from "./questsClient";

// THE ONE client-side copy of the caller's progression (Level / XP / Coins), in the same
// module-store idiom as auth/currentUserStore.ts. Every surface (Player HUD, Onboarding
// Questline, Missions panel, own Profile) reads it through useProgressionStore; nobody keeps a
// private useState of progression any more. Values only ever come from the server: a refresh
// (GET /progression/me) or a confirmed claim response (POST /progression/claim).
//
// COLLECTION STAGING. A confirmed claim (grantedNow=true) can be *staged* instead of applied:
// the server's new balances are held in `staged` while the reward-collection animation runs,
// and committed part by part when the coins / XP icons arrive at the HUD (commitStaged). The
// HUD therefore never shows a number the server has not confirmed, and never shows it before
// the reward has visibly arrived. Nothing is ever staged for grantedNow=false.

export interface ClaimFeedback {
  /** Monotonic per claim so a repeated identical reward still re-triggers feedback. */
  id: number;
  xp: number;
  coins: number;
  /** Progression before and after the claim, as the server reported them. */
  from: Progression;
  to: Progression;
  leveledUp: boolean;
  at: number;
}

export interface BadgeAwardFeedback {
  id: number;
  badgeId: string;
  title: string;
  tier: number;
  tierName: string;
  at: number;
}

export interface ProgressionSnapshot {
  /** What the HUD shows: confirmed values, staged in during a collection animation. */
  progression: Progression | null;
  /** Badge Progression, server-computed; null until the first successful fetch. */
  badges: Badge[] | null;
  /** The newest tier the server reported as crossed since the previous badge fetch. */
  lastAward: BadgeAwardFeedback | null;
  /** The most recent claim the server actually granted (grantedNow=true); replays set nothing. */
  lastClaim: ClaimFeedback | null;
  /** Confirmed post-claim balances not yet shown because their icons are still travelling. */
  staged: Progression | null;
  /** Bump counters — the HUD pulses its Coins / XP destination whenever these change. */
  coinsPulse: number;
  xpPulse: number;
}

const EMPTY: ProgressionSnapshot = {
  progression: null,
  badges: null,
  lastAward: null,
  lastClaim: null,
  staged: null,
  coinsPulse: 0,
  xpPulse: 0,
};

let snapshot: ProgressionSnapshot = EMPTY;
let seq = 0;
let inflight: Promise<Progression | null> | null = null;
let badgesInflight: Promise<Badge[] | null> | null = null;
let stagedParts: { coins: boolean; xp: boolean } = { coins: false, xp: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProgressionSnapshot(): ProgressionSnapshot {
  return snapshot;
}

export function useProgressionStore(): ProgressionSnapshot {
  return useSyncExternalStore(subscribe, getProgressionSnapshot, getProgressionSnapshot);
}

export function useProgression(): Progression | null {
  return useProgressionStore().progression;
}

/** Re-ask the server. Concurrent callers share one request; a failure leaves the last known
 * value in place and resolves null (balances are decorative — never break a surface over them). */
export function refreshProgression(): Promise<Progression | null> {
  if (inflight) return inflight;
  inflight = fetchMyProgression()
    .then((p) => {
      snapshot = { ...snapshot, progression: p };
      emit();
      return p;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Re-ask the server for badges. Awards are detected purely by diffing the server's tiers
 * against the previously fetched list — no client-side badge math. The first fetch of a session
 * never reports an award (there is nothing to compare against). */
export function refreshBadges(): Promise<Badge[] | null> {
  if (badgesInflight) return badgesInflight;
  badgesInflight = Promise.resolve()
    .then(() => fetchMyBadges())
    .then((list) => {
      if (!Array.isArray(list)) return null;
      const previous = snapshot.badges;
      let lastAward = snapshot.lastAward;
      if (previous) {
        const before = new Map(previous.map((b) => [b.id, b.tier]));
        const crossed = list.filter((b) => b.tier > (before.get(b.id) ?? 0));
        // Several tiers at once: surface the highest one; the Profile shows the rest.
        const top = crossed.sort((a, b) => b.tier - a.tier)[0];
        if (top) {
          lastAward = { id: ++seq, badgeId: top.id, title: top.title, tier: top.tier, tierName: top.tierName, at: Date.now() };
        }
      }
      snapshot = { ...snapshot, badges: list, lastAward };
      emit();
      return list;
    })
    .catch(() => null)
    .finally(() => {
      badgesInflight = null;
    });
  return badgesInflight;
}

function feedbackFor(result: ClaimResult): ClaimFeedback {
  const from = snapshot.progression ?? result.progression;
  const to = result.progression;
  return {
    id: ++seq,
    xp: result.reward.xp,
    coins: result.reward.coins,
    from,
    to,
    leveledUp: to.level > from.level,
    at: Date.now(),
  };
}

/** Fold a claim response in immediately. Balances always take the server's snapshot; feedback
 * (lastClaim + destination pulses) is recorded only when the server granted on this call. */
export function applyClaim(result: ClaimResult): void {
  const granted = result.grantedNow;
  snapshot = {
    ...snapshot,
    progression: result.progression,
    lastClaim: granted ? feedbackFor(result) : snapshot.lastClaim,
    staged: null,
    coinsPulse: snapshot.coinsPulse + (granted ? 1 : 0),
    xpPulse: snapshot.xpPulse + (granted ? 1 : 0),
  };
  stagedParts = { coins: false, xp: false };
  emit();
}

/** Fold in a server progression snapshot from a non-claim action (a Coin debit or refund). Pulses
 * the Coins destination as the only feedback — spending has no burst or travel FX. */
export function applyProgression(progression: Progression): void {
  const coinsChanged = snapshot.progression?.coins !== progression.coins;
  snapshot = { ...snapshot, progression, staged: null, coinsPulse: snapshot.coinsPulse + (coinsChanged ? 1 : 0) };
  stagedParts = { coins: false, xp: false };
  emit();
}

/** Hold a confirmed claim's balances until commitStaged is called for each part. Ignores
 * grantedNow=false (nothing to collect) by applying it plainly instead. */
export function stageClaim(result: ClaimResult): void {
  if (!result.grantedNow) {
    applyClaim(result);
    return;
  }
  snapshot = { ...snapshot, lastClaim: feedbackFor(result), staged: result.progression };
  stagedParts = { coins: false, xp: false };
  emit();
}

/** Reveal one part of the staged balances (icons arrived). No-op when nothing is staged or the
 * part was already committed. */
export function commitStaged(part: "coins" | "xp"): void {
  const staged = snapshot.staged;
  if (!staged || stagedParts[part]) return;
  stagedParts = { ...stagedParts, [part]: true };
  const base = snapshot.progression ?? staged;
  const progression: Progression =
    part === "coins"
      ? { ...base, coins: staged.coins }
      : { ...base, xp: staged.xp, level: staged.level, levelStartXp: staged.levelStartXp, nextLevelXp: staged.nextLevelXp };
  const done = stagedParts.coins && stagedParts.xp;
  snapshot = {
    ...snapshot,
    progression,
    staged: done ? null : staged,
    coinsPulse: snapshot.coinsPulse + (part === "coins" ? 1 : 0),
    xpPulse: snapshot.xpPulse + (part === "xp" ? 1 : 0),
  };
  emit();
}

export function resetProgressionForTests(): void {
  snapshot = EMPTY;
  seq = 0;
  inflight = null;
  badgesInflight = null;
  stagedParts = { coins: false, xp: false };
}

/** Earned tiers whose XP/Coins bonus is still unclaimed, across all badges (derived, no state). */
export function unclaimedTierCount(badges: Badge[] | null): number {
  if (!badges) return 0;
  return badges.reduce((n, b) => n + b.tiersClaimedAt.slice(0, b.tier).filter((c) => c === null).length, 0);
}
