import { useMemo } from "react";
import { formatDay, formatDuration, formatTime } from "../../services/meetings/meetingTime";
import { previewCounts, previewReview, type MeetingMemory as MemoryHook } from "../../services/meetings/meetingMemory";
import type { MemoryFilter, MemoryMatch, MemorySession } from "../../services/meetings/meetingReceiptClient";
import panel from "./MeetingsPanel.module.css";
import styles from "./MeetingMemory.module.css";

// PHASE 8A — MEETING MEMORY, the Meetings panel's second tab: ended Meeting Sessions this employee may read,
// newest first, grouped by day. It DISCOVERS a memory; the Phase 7C Receipt EXPLAINS it — a row opens the
// existing Receipt by Meeting Session id and repeats none of it. Everything shown is the server's answer
// (services/meeting_memory.py): attendance is real attendance, the preview is the latest succeeded run's
// active items with the Receipt's effective-content rule, and a missing or stale receipt is said plainly.

const FILTERS: { value: MemoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attended", label: "Attended" },
  { value: "absent", label: "Didn't attend" },
];

const ITEM_NOUN: Record<string, string> = {
  summary: "the summary",
  topic: "a topic",
  decision: "a decision",
  commitment: "a commitment",
  open_loop: "an open loop",
  key_point: "a key point",
};

const roomName = (roomId: string): string => {
  const slug = roomId.split("/")[1] ?? roomId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};

export const memoryTitle = (s: MemorySession): string =>
  s.title ?? (s.kind === "instant" ? "Instant meeting" : "Meeting");

function emptyCopy(filter: MemoryFilter, searching: boolean): { title: string; body: string } {
  if (searching) return { title: "No matching meetings", body: "Nothing you can access matches that search." };
  if (filter === "attended") return { title: "No attended meetings", body: "Meetings you join will be remembered here." };
  if (filter === "absent")
    return { title: "Nothing shared with you", body: "Meetings you were invited to but didn't join show up here." };
  return { title: "No past meetings yet", body: "When a meeting you're part of ends, you can come back to it here." };
}

export interface MeetingMemoryProps {
  memory: MemoryHook;
  resolveDisplayName: (email: string) => string;
  onOpen: (sessionId: string) => void;
}

export function MeetingMemory({ memory, resolveDisplayName, onOpen }: MeetingMemoryProps) {
  const groups = useMemo(() => {
    const now = new Date();
    const out: { day: string; items: MemorySession[] }[] = [];
    for (const s of memory.sessions) {
      const day = formatDay(s.startedAt, now);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(s);
    }
    return out;
  }, [memory.sessions]);
  const empty = !memory.loading && !memory.error && !memory.sessions.length;

  return (
    <div className={styles.library} data-testid="meeting-memory">
      <div className={styles.controls}>
        <input
          type="search"
          className={`${panel.input} ${styles.search}`}
          placeholder="Search titles, people, decisions…"
          value={memory.query}
          maxLength={100}
          onChange={(e) => memory.setQuery(e.target.value)}
          aria-label="Search meeting memory"
          data-testid="memory-search"
        />
        <div className={`${panel.segmented} ${styles.filters}`} role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" role="radio" aria-checked={memory.filter === f.value}
              className={memory.filter === f.value ? panel.segmentOn : panel.segment}
              onClick={() => memory.setFilter(f.value)} data-testid={`memory-filter-${f.value}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {memory.error && !memory.sessions.length && (
        <div className={panel.emptyState} role="alert" data-testid="memory-error">
          <p className={panel.emptyTitle}>Couldn't load your meetings</p>
          <p className={panel.empty}>{memory.error}</p>
          <button type="button" className={`${panel.ghost} ${styles.retry}`} onClick={() => void memory.refresh()}>
            Try again
          </button>
        </div>
      )}
      {memory.loading && !memory.sessions.length && <p className={panel.empty}>Loading…</p>}
      {empty && (
        <div className={panel.emptyState} data-testid="memory-empty">
          <p className={panel.emptyTitle}>{emptyCopy(memory.filter, memory.searching).title}</p>
          <p className={panel.empty}>{emptyCopy(memory.filter, memory.searching).body}</p>
        </div>
      )}

      {groups.length > 0 && (
      <div className={memory.loading ? `${styles.groups} ${styles.refreshing}` : styles.groups}>
        {groups.map((g) => (
          <section key={g.day} className={panel.group}>
            <h3 className={panel.dayLabel}>{g.day}</h3>
            {g.items.map((s) => (
              <MemoryRow key={s.sessionId} s={s} resolveDisplayName={resolveDisplayName} onOpen={onOpen} />
            ))}
          </section>
        ))}
      </div>
      )}

      {memory.nextCursor && (
        <button type="button" className={`${panel.ghost} ${styles.more}`} disabled={memory.loadingMore}
          onClick={() => void memory.loadMore()} data-testid="memory-more">
          {memory.loadingMore ? "Loading…" : "Show older meetings"}
        </button>
      )}
      {memory.error && memory.sessions.length > 0 && (
        <p className={panel.empty} role="alert">{memory.error}</p>
      )}
    </div>
  );
}

function MemoryRow({ s, resolveDisplayName, onOpen }: { s: MemorySession; resolveDisplayName: (e: string) => string; onOpen: (id: string) => void }) {
  const p = s.intelligence;
  // One line of substance: what was decided, when anything was; otherwise the summary.
  const decision = p?.decisions[0] ?? null;
  const line = decision ?? p?.summary ?? null;
  const review = p ? previewReview(p) : null;
  const counts = p ? previewCounts(p) : "";
  return (
    <button type="button" className={styles.row} onClick={() => onOpen(s.sessionId)}
      data-testid="memory-row" data-session-id={s.sessionId} data-attended={s.viewer.attended}>
      <span className={panel.when}>
        <span className={panel.whenTime}>{formatTime(s.startedAt)}</span>
        <span className={panel.whenLen}>{formatDuration(Math.max(1, Math.round(s.durationMs / 60_000)))}</span>
      </span>
      <span className={panel.itemBody}>
        <span className={panel.itemTitle}>
          <span className={panel.itemName}>{memoryTitle(s)}</span>
          {s.isPrivate && <span className={panel.privateTag}>Private</span>}
        </span>
        <span className={panel.itemMeta}>
          {s.roomId && <><strong>{roomName(s.roomId)}</strong> · </>}
          {s.kind === "instant" && "Instant · "}
          {s.attendeeCount} attended ·{" "}
          <span className={s.viewer.attended ? styles.attended : styles.absent} data-testid="memory-relation">
            {s.viewer.attended ? "You attended" : "Shared with you · you didn't attend"}
          </span>
        </span>
        {s.match && !(s.match.kind === "intelligence" && s.match.text === line?.text) && (
          <MatchLine match={s.match} resolveDisplayName={resolveDisplayName} />
        )}
        {p ? (
          <>
            {line?.text && (
              <span className={`${styles.preview} ${line.reviewState === "suggested" ? styles.previewSuggested : ""}`}
                data-testid="memory-preview">
                {decision && <span className={styles.previewLabel}>Decided </span>}
                {line.text}
              </span>
            )}
            <span className={styles.foot}>
              <span className={styles[`review_${review}`]} data-testid="memory-review">
                {review === "reviewed" ? "Reviewed" : review === "partly" ? "Partly reviewed" : "VO suggestion"}
              </span>
              {counts && <span data-testid="memory-counts"> · {counts}</span>}
              {p.stale && (
                <span className={styles.stale} data-testid="memory-stale"> · From an earlier transcript</span>
              )}
            </span>
          </>
        ) : (
          <span className={styles.foot}>
            <span className={styles.noReceipt} data-testid="memory-no-receipt">No receipt yet</span>
          </span>
        )}
      </span>
      <span className={styles.chevron} aria-hidden="true">›</span>
    </button>
  );
}

function MatchLine({ match, resolveDisplayName }: { match: MemoryMatch; resolveDisplayName: (e: string) => string }) {
  if (match.kind === "title") return null; // the title itself is the match — nothing to add
  const text =
    match.kind === "attendee"
      ? `Attended by ${resolveDisplayName(match.email)}`
      : match.kind === "room"
        ? "Matched the room"
        : `In ${ITEM_NOUN[match.itemType] ?? "the receipt"}${match.reviewState === "suggested" ? " (VO suggestion)" : ""}: “${match.text ?? ""}”`;
  return (
    <span className={styles.match} data-testid="memory-match">
      {text}
    </span>
  );
}

export default MeetingMemory;
