// Presentation helpers for the Boards gallery cards. Both are pure and derive everything from
// data the list endpoint already returns (id, title, updatedAt) — no board document is fetched
// and no thumbnail is stored anywhere, so a card's preview is a calm deterministic sheet rather
// than a screenshot of the drawing.

/** Stable non-negative hash of a board id, so a board keeps the same preview tint forever. */
function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** The five sticky-note tints the office UI already uses (green / cream / peach / sky / lilac). */
const PREVIEW_TINTS = ["#e7f1e4", "#fbf3dc", "#fbe6dd", "#e2ecf5", "#ece5f4"] as const;

export interface BoardPreview {
  /** Background for the card's preview sheet. */
  tint: string;
  /** One or two letters taken from the board title, shown on the sheet. */
  mark: string;
}

export function boardPreview(id: string, title: string): BoardPreview {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const mark =
    words.length === 0
      ? "?"
      : words.length === 1
        ? words[0].slice(0, 2).toUpperCase()
        : (words[0][0] + words[1][0]).toUpperCase();
  return { tint: PREVIEW_TINTS[hashOf(id) % PREVIEW_TINTS.length], mark };
}

/** "Updated 2h ago" style age. Coarser than teamMap's formatSharedAgo, which caps at hours and
 *  would read "121 h ago" for a board last touched last week. */
export function relativeAge(iso: string, now: Date = new Date()): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
