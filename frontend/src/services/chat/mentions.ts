// @mentions V1 — pure text-processing helpers shared by ConversationView (DM) and
// GroupConversationView (GC). Identity is never derived by re-parsing "@DisplayName" after the
// fact (see backend/app/repositories/chat.py's insert_message, the actual source of truth) —
// these helpers only decide (a) when to show the autocomplete while composing and (b) where to
// draw the highlight when rendering an ALREADY-validated mentionedEmails list. Manually typing
// "@randomtext" that was never selected from the autocomplete never appears in mentionedEmails,
// so it renders as ordinary text and never reaches insert_message's participant check either.

export interface MentionCandidate {
  email: string;
  displayName: string;
}

export interface MentionTrigger {
  /** Text typed after "@" so far (no leading "@"). */
  query: string;
  /** Index of the "@" character within the full draft text. */
  start: number;
}

// Detects an in-progress "@word" immediately before `cursor` — must be at the start of the text
// or preceded by whitespace (so an email like "foo@bar.com" or mid-word "@" never triggers), and
// contain no whitespace itself (a space ends the mention attempt).
export function findMentionTrigger(text: string, cursor: number): MentionTrigger | null {
  const pos = Math.max(0, Math.min(cursor, text.length));
  let i = pos - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === "@") {
      const prev = i === 0 ? "" : text[i - 1];
      if (i === 0 || /\s/.test(prev)) {
        return { query: text.slice(i + 1, pos), start: i };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i -= 1;
  }
  return null;
}

export function filterMentionCandidates(candidates: MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((c) => c.displayName.toLowerCase().includes(q));
}

// Replaces the "@query" span [start, end) with "@DisplayName " (trailing space so typing
// continues naturally after the inserted mention). Returns the new full text and the cursor
// position right after the inserted mention.
export function insertMention(
  text: string,
  start: number,
  end: number,
  displayName: string,
): { text: string; cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const inserted = `@${displayName} `;
  return { text: before + inserted + after, cursor: (before + inserted).length };
}

// Send-time sanity filter: only candidates whose "@DisplayName" token is still literally present
// in the final text count as mentions — if the user inserted one then deleted/edited it away, it
// shouldn't be sent as a mention even though it's still in the composer's pending-selection list.
export function activeMentionEmails(text: string, pending: MentionCandidate[]): string[] {
  const seen = new Set<string>();
  for (const c of pending) {
    if (text.includes(`@${c.displayName}`)) seen.add(c.email);
  }
  return Array.from(seen);
}
