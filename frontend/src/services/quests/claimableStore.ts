import { useSyncExternalStore } from "react";
import { fetchMyMissions, fetchMyQuests } from "./questsClient";

// HOW MANY REWARDS ARE WAITING TO BE CLAIMED — the dock's Tasks badge, and nothing else.
//
// This holds NO claim state of its own. "Claimable" is derived, on every refresh, from the exact
// same server payloads the Quests and Missions panels render (GET /quests/me, GET /missions/me):
// an item is claimable when it is `completed` and not yet `claimed`. There is no second copy of
// what has been claimed, and nothing here can disagree with a panel — a stale count is corrected
// by the next refresh, never by separate bookkeeping.
//
// The panels call refreshClaimable() after a successful claim so the badge drops immediately.

let count = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Total rewards ready to claim across BOTH Quests and Missions. */
export function getClaimableCount(): number {
  return count;
}

/**
 * Refetch both sources and recompute the count.
 *
 * Failures are swallowed on purpose: this drives a decorative badge, so a flaky
 * /quests/me must never surface an error or clear a count that is probably still right — the
 * last known value simply stands until the next refresh succeeds.
 */
export function refreshClaimable(): Promise<void> {
  // One refresh at a time; a burst of claims coalesces into a single pair of requests.
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // Everything inside is best-effort. A mocked/partial client or a network failure must not
      // reject this promise — callers fire it with `void`, so a rejection would surface as an
      // unhandled rejection for a badge nobody depends on.
      const [quests, missions] = await Promise.all([
        fetchMyQuests().catch(() => null),
        fetchMyMissions().catch(() => null),
      ]);
      if (quests === null && missions === null) return;

      let next = 0;
      for (const quest of quests ?? []) {
        if (quest.completed && !quest.claimed) next += 1;
      }
      for (const period of [missions?.daily, missions?.weekly]) {
        for (const mission of period?.missions ?? []) {
          if (mission.completed && !mission.claimed) next += 1;
        }
      }
      if (next !== count) {
        count = next;
        notify();
      }
    } catch {
      /* keep the last known count */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test seam — mirrors the reset helpers the other stores expose. */
export function resetClaimableForTests(): void {
  count = 0;
  inFlight = null;
  listeners.clear();
}

/** Subscribe a component to the claimable count. */
export function useClaimableCount(): number {
  return useSyncExternalStore(subscribe, getClaimableCount, getClaimableCount);
}
