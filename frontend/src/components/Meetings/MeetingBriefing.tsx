import type { ReactNode } from "react";
import HudIcon from "../HudIcon";
import { ownerLabel, useMeetingBriefing } from "../../services/meetings/meetingBriefing";
import type { BriefingEntry, BriefingSource, MeetingBriefing as Briefing } from "../../services/meetings/scheduledMeetingsClient";
import { formatDay, formatTime, formatTimeRange } from "../../services/meetings/meetingTime";
import panel from "./MeetingsPanel.module.css";
import styles from "./MeetingBriefing.module.css";

// PHASE 9C — PRE-MEETING BRIEFING: "here's what matters before you walk in", for one upcoming booking. Every
// line is an item a past meeting RECORDED — the viewer's own authorized history only, in its own words — and
// opens that meeting's Receipt at the item, where its evidence is. Nothing here is a status: a commitment is
// what someone committed to, an open item is what a meeting recorded as open, and two different decisions are
// two dated facts. "Change recorded" appears only when a decision's own words state the change. The wording
// never says "last" or "previous" meeting, so nothing implies what the viewer can't see happened in between.

const REVIEW = { reviewed: "Reviewed", partly: "Partly reviewed", suggested: "VO suggestion" } as const;
const NOTES: Record<BriefingSource["notes"], string | null> = {
  structured: null,
  nothing_useful: "Nothing to brief from",
  transcript_only: "Transcript only · no notes",
  none: "No receipt yet",
};

const roomName = (roomId: string) => {
  const slug = roomId.split("/")[1] ?? roomId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export interface MeetingBriefingProps {
  meetingId: string;
  resolveDisplayName: (email: string) => string;
  /** Open a source meeting's Receipt, optionally at one of its items. */
  onOpenReceipt: (sessionId: string, focusItemId?: string) => void;
  onBack: () => void;
  onClose: () => void;
}

export function MeetingBriefing({ meetingId, resolveDisplayName, onOpenReceipt, onBack, onClose }: MeetingBriefingProps) {
  const state = useMeetingBriefing(meetingId);
  const b = state.status === "ready" ? state.briefing : null;
  return (
    <>
      <header className={panel.header}>
        <button type="button" className={panel.backButton} onClick={onBack} aria-label="Back to meetings"
          data-testid="brief-back">
          ‹
        </button>
        <span className={panel.headerIcon} aria-hidden="true">
          <HudIcon name="memory" size="34px" />
        </span>
        <div className={panel.headerText}>
          <h2 className={panel.title} data-testid="brief-title">{b?.meeting.title ?? "Brief"}</h2>
          <p className={panel.subtitle}>
            {b
              ? <>Brief · {formatDay(b.meeting.startsAt)} · {formatTimeRange(b.meeting.startsAt, b.meeting.endsAt)} · {roomName(b.meeting.roomId)}
                  {b.meeting.isPrivate && <span className={panel.privateTag}> Private</span>}</>
              : "Before you walk in"}
          </p>
        </div>
        <button type="button" className={panel.closeButton} onClick={onClose} aria-label="Close meetings">
          ✕
        </button>
      </header>
      <div className={panel.body} data-testid="meeting-brief">
        {state.status === "loading" && <p className={panel.empty}>Loading…</p>}
        {state.status === "failed" && <p className={panel.empty} role="alert">Couldn't load the brief. Try again.</p>}
        {state.status === "missing" && (
          <div className={panel.emptyState} data-testid="brief-missing">
            <p className={panel.emptyTitle}>This meeting is no longer on your schedule</p>
          </div>
        )}
        {b && <Body briefing={b} resolve={resolveDisplayName} onOpen={onOpenReceipt} />}
      </div>
    </>
  );
}

function Body({ briefing: b, resolve, onOpen }: {
  briefing: Briefing;
  resolve: (email: string) => string;
  onOpen: MeetingBriefingProps["onOpenReceipt"];
}) {
  if (!b.available) {
    return (
      <>
        <div className={panel.emptyState} data-testid="brief-empty">
          <p className={panel.emptyTitle}>Nothing to brief yet</p>
          <p className={panel.empty}>
            {b.sources.length
              ? "The earlier meetings you can open have no notes to draw on."
              : `No earlier ${b.meeting.title} meetings you can open.`}
          </p>
        </div>
        {b.sources.length > 0 && <Sources sources={b.sources} onOpen={onOpen} />}
      </>
    );
  }
  const yours = b.commitments.filter((c) => c.isYours);
  const others = b.commitments.filter((c) => !c.isYours);
  const changes = b.decisions.filter((d) => d.recordedChange).length;
  const count = b.sources.length;
  return (
    <>
      <p className={styles.intro} data-testid="brief-intro">
        From your {b.meeting.title} history · {count} earlier {count === 1 ? "meeting" : "meetings"} you can open
        {changes > 0 && <> · <span className={styles.changeCount}>{changes} recorded {changes === 1 ? "change" : "changes"}</span></>}
      </p>

      {b.decisions.length > 0 && (
        <Section title="Decided" testId="brief-decisions">
          {b.decisions.map((d) => (
            <Line key={d.itemId} entry={d} onOpen={onOpen} tag="decision"
              chips={d.recordedChange ? <span className={styles.change} data-testid="brief-change">Change recorded</span> : null}
              meta={d.rationale ? <>Reason recorded: {d.rationale}</> : null} />
          ))}
        </Section>
      )}

      {b.commitments.length > 0 && (
        <Section title="Commitments recorded" testId="brief-commitments">
          {yours.length > 0 && <p className={styles.subhead}>Yours</p>}
          {[...yours, ...others].map((c) => (
            <Line key={c.itemId} entry={c} onOpen={onOpen} tag="commitment" mine={c.isYours}
              meta={<>{ownerLabel(c, resolve)} committed{c.deadline && <> · {c.deadline}</>}</>} />
          ))}
        </Section>
      )}

      {b.openLoops.length > 0 && (
        <Section title="Recorded as open" testId="brief-open"
          note="As each meeting recorded it when it ended — not whether it is open now.">
          {b.openLoops.map((o) => (
            <Line key={o.itemId} entry={o} onOpen={onOpen} tag="open" hideDate
              meta={<>Recorded open · {o.recorded.map((r) => shortDay(r.at)).join(", ")}</>} />
          ))}
        </Section>
      )}

      {b.keyContext.length > 0 && (
        <Section title="Key context" testId="brief-context">
          {b.keyContext.map((k) => <Line key={k.itemId} entry={k} onOpen={onOpen} tag="context" />)}
        </Section>
      )}

      <Sources sources={b.sources} onOpen={onOpen} />
      <p className={styles.footnote}>A brief from what these meetings recorded — not a prediction.</p>
    </>
  );
}

function Section({ title, testId, note, children }: { title: string; testId: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.section} data-testid={testId}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {note && <p className={styles.note}>{note}</p>}
      <div className={styles.lines}>{children}</div>
    </section>
  );
}

function Line({ entry: e, tag, meta, chips, mine, hideDate, onOpen }: {
  entry: BriefingEntry;
  tag: "decision" | "commitment" | "open" | "context";
  meta?: ReactNode;
  chips?: ReactNode;
  mine?: boolean;
  hideDate?: boolean;
  onOpen: MeetingBriefingProps["onOpenReceipt"];
}) {
  const suggested = e.reviewState === "suggested";
  return (
    <button type="button" className={`${styles.line} ${styles[`line_${tag}`]} ${mine ? styles.mine : ""}`}
      onClick={() => onOpen(e.sessionId, e.itemId)} data-testid="brief-line" data-tag={tag}
      data-reviewed={suggested ? "false" : "true"} data-mine={mine ? "true" : undefined}
      aria-label={`${e.text} — open the receipt from ${formatDay(e.at)}`}>
      {!hideDate && <span className={styles.date}>{shortDay(e.at)}</span>}
      <span className={styles.lineBody}>
        <span className={suggested ? `${styles.text} ${styles.textSuggested}` : styles.text}>{e.text}</span>
        {(meta || chips || suggested || e.stale || e.reviewState === "edited") && (
          <span className={styles.meta}>
            {meta}
            {chips}
            {e.reviewState === "edited" && <span className={styles.edited}>Edited by a person</span>}
            {suggested && <span className={styles.suggested} data-testid="brief-suggested">VO suggestion</span>}
            {e.stale && <span className={styles.stale} data-testid="brief-stale">Earlier transcript</span>}
          </span>
        )}
      </span>
      <span className={styles.chevron} aria-hidden="true">›</span>
    </button>
  );
}

function Sources({ sources, onOpen }: { sources: BriefingSource[]; onOpen: MeetingBriefingProps["onOpenReceipt"] }) {
  return (
    <section className={styles.section} data-testid="brief-sources">
      <h3 className={styles.sectionTitle}>Receipts</h3>
      <div className={styles.sources}>
        {sources.map((s) => (
          <button key={s.sessionId} type="button" className={styles.source} onClick={() => onOpen(s.sessionId)}
            data-testid="brief-source" aria-label={`Open the receipt from ${formatDay(s.startedAt)}`}>
            <span className={styles.sourceWhen}>{formatDay(s.startedAt)} · {formatTime(s.startedAt)}</span>
            <span className={styles.sourceMeta}>
              <span className={s.viewer.attended ? styles.attended : styles.shared}>
                {s.viewer.attended ? "You attended" : "Shared with you"}
              </span>
              {s.isPrivate && <span> · Private</span>}
              {s.review && <span className={styles[`review_${s.review}`]}> · {REVIEW[s.review]}</span>}
              {NOTES[s.notes] && <span className={styles.quiet} data-testid="brief-source-notes"> · {NOTES[s.notes]}</span>}
              {s.stale && <span className={styles.stale}> · Transcript changed since</span>}
              {s.omittedStale > 0 && (
                <span className={styles.stale} data-testid="brief-source-omitted">
                  {" "}· {s.omittedStale} left out (earlier transcript)
                </span>
              )}
            </span>
            <span className={styles.chevron} aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default MeetingBriefing;
