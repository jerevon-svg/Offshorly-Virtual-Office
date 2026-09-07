import type { Badge } from "./questsClient";

// Pure view derivations over the server's badge list (no state, no math the server doesn't
// already imply). Kept out of the component file so Fast Refresh sees only components there.

export type BadgeState = "locked" | "progressing" | "earned" | "claimable" | "complete";

/** One visual state per card. Claimable wins over earned; complete = Platinum and everything claimed. */
export function badgeState(b: Badge): BadgeState {
  const unclaimed = b.tiersClaimedAt.slice(0, b.tier).some((c) => c === null);
  if (unclaimed) return "claimable";
  if (b.tier >= 4) return "complete";
  if (b.tier > 0) return "earned";
  return b.metric > 0 ? "progressing" : "locked";
}

/** Strongest first: higher tier, then closest to the next tier, then title. */
export function strongestBadges(badges: Badge[], count: number): Badge[] {
  const ratio = (b: Badge) => {
    if (b.nextThreshold === null) return 1;
    const floor = b.tier > 0 ? b.thresholds[b.tier - 1] : 0;
    return (b.metric - floor) / Math.max(1, b.nextThreshold - floor);
  };
  return badges
    .filter((b) => b.tier > 0)
    .sort((a, b) => b.tier - a.tier || ratio(b) - ratio(a) || a.title.localeCompare(b.title))
    .slice(0, count);
}
