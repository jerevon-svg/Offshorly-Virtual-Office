import type { ToucanCatchUp } from "../../services/toucan";

// A5 follow-up — PROACTIVE RETURN BRIEFING, the pure half.
//
// The trigger is the server's own catch-up result and nothing else: no timer, no second
// absence window, no presence heuristics on the client. A return "counts" exactly when the
// backend says the window is a real observed absence (`sinceReason === "last_active"`, i.e.
// ToucanAttentionCursor.away_since was frozen on an arrival after ABSENCE_GAP_SECONDS) AND the
// result carries something worth saying: conversations to open, or the digest's own
// needs-attention roll-up (mentions, missed calls, priority Hub items), or requester-declared
// urgency. Ordinary Hub volume alone does not summon the bird.
//
// DEDUPLICATION IS KEYED ON THE ABSENCE BOUNDARY. `activity.since` is frozen server-side until
// the next genuine absence, so "have I already briefed this return?" is answered by remembering
// that one timestamp — per viewer, in localStorage, so a refresh, a second tab, a socket blip or
// closing and reopening the browser inside the same return never briefs twice, while the next
// real absence (a new `since`) briefs once more. Nothing is persisted server-side.

const STORAGE_PREFIX = "toucan:return-briefed:";

export function isMeaningfulReturn(catchUp: ToucanCatchUp | null | undefined): boolean {
  if (!catchUp || catchUp.activity?.sinceReason !== "last_active") return false;
  const rows = Array.isArray(catchUp.conversations) ? catchUp.conversations.length : 0;
  const attention = (catchUp.activity.importantCount ?? 0) + (catchUp.delegatedUrgentCount ?? 0);
  return rows > 0 || attention > 0;
}

/** True when this catch-up should summon Toucan: a meaningful real absence whose boundary the
 *  viewer has not been briefed about yet. */
export function shouldBriefOnReturn(
  catchUp: ToucanCatchUp | null | undefined,
  briefedSince: string | null,
): boolean {
  if (!isMeaningfulReturn(catchUp)) return false;
  return catchUp!.activity.since !== briefedSince;
}

function storageKey(viewerId: string): string {
  return `${STORAGE_PREFIX}${(viewerId || "anon").trim().toLowerCase()}`;
}

export function readBriefedSince(viewerId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(viewerId));
  } catch {
    return null;
  }
}

export function writeBriefedSince(viewerId: string, since: string): void {
  try {
    window.localStorage.setItem(storageKey(viewerId), since);
  } catch {
    // Storage unavailable (private mode, quota): the in-memory guard in OfficeMap still
    // prevents a repeat within this page; a reload may brief once more. Acceptable.
  }
}

export function resetBriefedSinceForTests(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
