import { eventLines, eventReview, type LineTag } from "../../services/meetings/meetingContinuity";
import type { Continuity, ContinuityEvent } from "../../services/meetings/meetingReceiptClient";
import { formatDay, formatTime } from "../../services/meetings/meetingTime";
import styles from "./MeetingContinuity.module.css";

// PHASE 8C — MEETING CONTINUITY in the Receipt: the related meetings this viewer may read, oldest first, with
// this meeting marked. Each stop shows its OWN active intelligence in a line or two — never a comparison the
// data can't support. The only transition drawn is "Raised again" (the same open loop, word for word, as at
// the previous stop the viewer can see); decisions are separate dated facts, nothing is "resolved" or
// "completed". Pressing another stop opens its existing Receipt; pressing a line opens it at that item, whose
// evidence is there.

const TAGS: Record<LineTag, string> = { decided: "Decided", committed: "Committed", open: "Open", raised: "Raised again" };
const REVIEW = { reviewed: "Reviewed", partly: "Partly reviewed", suggested: "VO suggestion" } as const;

export interface MeetingContinuityProps {
  continuity: Continuity;
  resolveDisplayName: (email: string) => string;
  /** Open another meeting's Receipt, optionally at one of its items. */
  onOpen: (sessionId: string, focusItemId?: string) => void;
  /** A line of THIS meeting was pressed: show that item here. */
  onFocusItem: (itemId: string) => void;
}

export function MeetingContinuity({ continuity, resolveDisplayName, onOpen, onFocusItem }: MeetingContinuityProps) {
  const current = continuity.events.find((e) => e.isCurrent);
  const others = continuity.events.length - 1;
  return (
    <section className={styles.section} aria-label="Before and after" data-testid="receipt-continuity">
      <h3 className={styles.title}>
        Before &amp; after <span className={styles.count}>{others} related</span>
      </h3>
      <ol className={styles.timeline}>
        {continuity.events.map((e) => (
          <Stop key={e.sessionId} event={e} currentTitle={current?.title ?? null} resolve={resolveDisplayName}
            onOpen={onOpen} onFocusItem={onFocusItem} />
        ))}
      </ol>
    </section>
  );
}

function Stop({
  event: e,
  currentTitle,
  resolve,
  onOpen,
  onFocusItem,
}: {
  event: ContinuityEvent;
  currentTitle: string | null;
  resolve: (email: string) => string;
  onOpen: MeetingContinuityProps["onOpen"];
  onFocusItem: MeetingContinuityProps["onFocusItem"];
}) {
  const lines = eventLines(e);
  const review = eventReview(e);
  const when = `${formatDay(e.startedAt)} · ${formatTime(e.startedAt)}`;
  // The series shares a title; a stop repeats it only when its own booking words it differently.
  const title = e.title && e.title !== currentTitle ? e.title : null;
  const open = (itemId?: string) => (e.isCurrent ? itemId && onFocusItem(itemId) : onOpen(e.sessionId, itemId));
  return (
    <li className={e.isCurrent ? `${styles.stop} ${styles.current}` : styles.stop} data-testid="continuity-event"
      data-session-id={e.sessionId} data-current={e.isCurrent ? "true" : undefined}>
      <span className={styles.dot} aria-hidden="true" />
      <div className={styles.body}>
        {e.isCurrent ? (
          <div className={styles.head}>
            <span className={styles.when}>{when}</span>
            <span className={styles.here}>This meeting</span>
          </div>
        ) : (
          <button type="button" className={styles.headButton} onClick={() => open()} data-testid="continuity-open"
            aria-label={`Open the receipt for ${e.title ?? "this meeting"}, ${when}`}>
            <span className={styles.when}>{when}</span>
            {title && <span className={styles.otherTitle}>{title}</span>}
            <span className={styles.chevron} aria-hidden="true">›</span>
          </button>
        )}
        <div className={styles.meta}>
          <span className={e.viewer.attended ? styles.attended : styles.shared}>
            {e.viewer.attended ? "You attended" : "Shared with you"}
          </span>
          {e.isPrivate && <span> · Private</span>}
          {review && <span className={styles[`review_${review}`]} data-testid="continuity-review"> · {REVIEW[review]}</span>}
          {e.intelligence?.stale && <span className={styles.stale} data-testid="continuity-stale"> · Transcript changed since</span>}
          {!e.intelligence && <span className={styles.noReceipt} data-testid="continuity-no-receipt"> · No receipt yet</span>}
        </div>
        {lines.map((l) => (
          <button key={l.itemId} type="button" className={l.reviewed ? styles.line : `${styles.line} ${styles.lineSuggested}`}
            onClick={() => open(l.itemId)} data-testid="continuity-line" data-tag={l.tag}
            data-reviewed={l.reviewed ? "true" : "false"}>
            <span className={`${styles.tag} ${styles[`tag_${l.tag}`]}`}>{TAGS[l.tag]}</span>
            <span className={styles.lineText}>
              {l.text}
              {l.tag === "committed" && l.ownerEmail && <span className={styles.owner}> — {resolve(l.ownerEmail)}</span>}
            </span>
            {!l.reviewed && <span className={styles.suggestedMark} title="VO suggestion, not yet reviewed">◌</span>}
          </button>
        ))}
      </div>
    </li>
  );
}

export default MeetingContinuity;
