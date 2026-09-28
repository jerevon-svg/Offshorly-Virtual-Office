import { useState, type ReactNode } from "react";
import HudIcon from "../HudIcon";
import {
  EDIT_FIELDS,
  effectiveContent,
  isActive,
  itemsOf,
  newerAttempt,
  offsetLabel,
  OPEN_LOOP_LABELS,
  openLoopLabel,
  editPayload,
  useMeetingReceipt,
} from "../../services/meetings/meetingReceipt";
import {
  ReceiptError,
  type Attendee,
  type Evidence,
  type IntelligenceItem,
  type ItemContent,
  type MeetingSessionInfo,
  type ReviewAction,
} from "../../services/meetings/meetingReceiptClient";
import { formatDay, formatDuration, formatTime, formatTimeRange } from "../../services/meetings/meetingTime";
import panel from "./MeetingsPanel.module.css";
import styles from "./MeetingReceipt.module.css";

// PHASE 7C — MEETING RECEIPT. One completed Meeting Session: what it was, who ACTUALLY came, and what the
// latest successful intelligence run says happened — each conclusion with the transcript lines it rests on.
// It lives in the Meetings panel's cream shell. Everything shown is the server's answer for this identity
// (services/meetings/meetingReceipt.ts); review controls appear only when the server says the viewer may
// curate, and every review goes through the existing Phase 7A endpoint. Nothing here creates a task.

type Resolve = (email: string) => string;

const roomLabel = (roomId: string | null): string | null => {
  if (!roomId) return null;
  const slug = roomId.split("/")[1] ?? roomId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

const GENERATE_ERRORS: Record<string, string> = {
  no_transcript: "This meeting has no transcript to work from.",
  generator_unavailable: "Receipt generation isn't available here yet.",
  meeting_active: "The meeting is still going.",
  capture_active: "Capture is still running for this meeting.",
  generation_in_progress: "A receipt is already being generated.",
};

export interface MeetingReceiptProps {
  sessionId: string;
  resolveDisplayName: Resolve;
  onBack: () => void;
  onClose: () => void;
}

export function MeetingReceipt({ sessionId, resolveDisplayName, onBack, onClose }: MeetingReceiptProps) {
  const r = useMeetingReceipt(sessionId);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const session = r.session;
  const run = r.latest?.run ?? null;
  const canCurate = Boolean(session?.viewer.mayCurate);
  const attempt = newerAttempt(r.runs, run?.version ?? null);

  const generate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      await r.generate();
    } catch (err) {
      const code = err instanceof ReceiptError ? err.message : "";
      setGenerateError(GENERATE_ERRORS[code] ?? "Couldn't generate the receipt.");
    } finally {
      setGenerating(false);
    }
  };

  const title = session ? session.title ?? (session.kind === "instant" ? "Instant meeting" : "Meeting") : "Meeting receipt";
  return (
    <>
      <header className={panel.header}>
        <button type="button" className={panel.backButton} onClick={onBack} aria-label="Back to meetings">
          ‹
        </button>
        <span className={panel.headerIcon} aria-hidden="true">
          <HudIcon name="memory" size="34px" />
        </span>
        <div className={panel.headerText}>
          <h2 className={panel.title} data-testid="receipt-title">{title}</h2>
          <p className={panel.subtitle}>Meeting receipt</p>
        </div>
        <button type="button" className={panel.closeButton} onClick={onClose} aria-label="Close meetings">
          ✕
        </button>
      </header>
      <div className={panel.body} data-testid="meeting-receipt">
        {r.loading && <p className={panel.empty}>Loading…</p>}
        {r.unavailable && (
          <div className={panel.emptyState} data-testid="receipt-unavailable">
            <p className={panel.emptyTitle}>Receipt not available</p>
            <p className={panel.empty}>This meeting's receipt isn't shared with you.</p>
          </div>
        )}
        {r.error && !r.loading && <p className={panel.error}>{r.error}</p>}
        {session && (
          <>
            <Facts session={session} resolve={resolveDisplayName} />
            <Attendance attendees={session.attendees} resolve={resolveDisplayName} />
            {run && r.latest?.stale && (
              <Notice testId="receipt-stale">
                Generated from an earlier version of the transcript, which has changed since.
                {canCurate && (
                  <button type="button" className={panel.ghost} disabled={generating} onClick={() => void generate()}
                    data-testid="receipt-regenerate">
                    {generating ? "Regenerating…" : "Regenerate"}
                  </button>
                )}
              </Notice>
            )}
            {run && attempt && (
              <Notice testId="receipt-attempt">
                {attempt.status === "running"
                  ? `A newer version is being generated — showing version ${run.version}.`
                  : `The latest attempt didn't finish — showing version ${run.version}.`}
              </Notice>
            )}
            {generateError && <p className={panel.error} role="alert">{generateError}</p>}
            {run ? (
              <Intelligence items={run.items} canCurate={canCurate} session={session} resolve={resolveDisplayName}
                review={r.review} />
            ) : (
              <div className={styles.notYet} data-testid="receipt-empty">
                <p className={panel.emptyTitle}>No receipt yet</p>
                <p className={panel.empty}>
                  {attempt?.status === "failed"
                    ? "The last attempt to generate this meeting's receipt didn't finish."
                    : canCurate
                      ? "Generate it from the meeting's transcript. Everything stays a suggestion until you review it."
                      : "The meeting's owner hasn't generated a receipt for it yet."}
                </p>
                {canCurate && (
                  <button type="button" className={panel.primary} disabled={generating} onClick={() => void generate()}
                    data-testid="receipt-generate">
                    {generating ? "Generating…" : "Generate receipt"}
                  </button>
                )}
              </div>
            )}
            {run && (
              <p className={styles.version} data-testid="receipt-version">
                Version {run.version}
                {run.completedAt && ` · generated ${formatDay(run.completedAt)} ${formatTime(run.completedAt)}`}
                {" · "}AI suggestions until the meeting owner reviews them
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Notice({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className={styles.notice} role="status" data-testid={testId}>
      {children}
    </div>
  );
}

// ---- header facts + attendance ----------------------------------------------------------------------------

function Facts({ session, resolve }: { session: MeetingSessionInfo; resolve: Resolve }) {
  const room = roomLabel(session.roomId);
  const planned = session.planned;
  const owner = planned ? `Organized by ${resolve(planned.organizerEmail)}` : `Started by ${resolve(session.startedBy)}`;
  const count = session.attendees.length;
  return (
    <div className={styles.facts} data-testid="receipt-facts">
      <div className={styles.factRow}>
        <span className={styles.factLabel}>Planned</span>
        <span>
          {session.kind === "scheduled" ? "Scheduled" : "Instant"}
          {room && <> · <strong>{room}</strong></>}
          {planned && ` · ${formatDay(planned.startsAt)} ${formatTimeRange(planned.startsAt, planned.endsAt)}`}
          {session.isPrivate && <span className={panel.privateTag}> Private</span>}
        </span>
      </div>
      <div className={styles.factRow}>
        <span className={styles.factLabel}>Actual</span>
        <span data-testid="receipt-actual">
          {session.endedAt
            ? `${formatDay(session.startedAt)} ${formatTimeRange(session.startedAt, session.endedAt)} · ${formatDuration(
                minutes(Date.parse(session.endedAt) - Date.parse(session.startedAt)),
              )}`
            : `Started ${formatTime(session.startedAt)} · still running`}
          {` · ${count} attended · ${owner}`}
        </span>
      </div>
    </div>
  );
}

function Attendance({ attendees, resolve }: { attendees: Attendee[]; resolve: Resolve }) {
  if (!attendees.length) return null;
  return (
    <section className={styles.section} aria-label="Who was there">
      <h3 className={styles.sectionTitle}>Who was there</h3>
      <ul className={styles.attendees} data-testid="receipt-attendees">
        {attendees.map((a) => (
          <li key={a.email} className={styles.attendee} data-testid="receipt-attendee" data-email={a.email}>
            <span className={styles.attendeeName}>{resolve(a.email)}</span>
            <span className={styles.attendeeTime}>
              {a.leftAt ? formatTimeRange(a.joinedAt, a.leftAt) : `from ${formatTime(a.joinedAt)}`} ·{" "}
              {formatDuration(minutes(a.presentMs))}
              {a.intervals.length > 1 && ` · rejoined ${a.intervals.length - 1}×`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- intelligence -----------------------------------------------------------------------------------------

interface IntelProps {
  canCurate: boolean;
  session: MeetingSessionInfo;
  resolve: Resolve;
  review: (itemId: string, action: ReviewAction, content?: ItemContent) => Promise<void>;
}

const CORE: { type: "decision" | "commitment" | "open_loop"; title: string; empty: string }[] = [
  { type: "decision", title: "Decisions", empty: "decisions" },
  { type: "commitment", title: "Commitments", empty: "commitments" },
  { type: "open_loop", title: "Still open", empty: "open questions" },
];

function Intelligence({ items, ...props }: IntelProps & { items: IntelligenceItem[] }) {
  const [summary] = itemsOf(items, "summary");
  const topics = itemsOf(items, "topic");
  const keyPoints = itemsOf(items, "key_point");
  const missing = CORE.filter((c) => !items.some((i) => i.type === c.type && isActive(i))).map((c) => c.empty);
  return (
    <>
      {summary && (
        <section className={styles.section} aria-label="Summary">
          <h3 className={styles.sectionTitle}>Summary</h3>
          <ItemCard item={summary} {...props} variant="summary" />
        </section>
      )}
      {CORE.map(({ type, title }) => {
        const list = itemsOf(items, type);
        if (!list.length) return null;
        return (
          <section key={type} className={styles.section} aria-label={title} data-testid={`receipt-${type}s`}>
            <h3 className={styles.sectionTitle}>
              {title} <span className={styles.count}>{list.filter(isActive).length}</span>
            </h3>
            {list.map((item) => (
              <ItemCard key={item.itemId} item={item} {...props} />
            ))}
          </section>
        );
      })}
      {(topics.length > 0 || keyPoints.length > 0) && (
        <section className={styles.section} aria-label="Topics and key points" data-testid="receipt-secondary">
          <h3 className={styles.sectionTitle}>Topics &amp; key points</h3>
          {topics.length > 0 && <Topics topics={topics} {...props} />}
          {keyPoints.map((item) => (
            <ItemCard key={item.itemId} item={item} {...props} variant="compact" />
          ))}
        </section>
      )}
      {missing.length > 0 && (
        <p className={styles.nothing} data-testid="receipt-missing">
          No {missing.join(", ").replace(/, ([^,]*)$/, " or $1")} identified in this meeting.
        </p>
      )}
    </>
  );
}

function Topics({ topics, ...props }: IntelProps & { topics: IntelligenceItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const selected = topics.find((t) => t.itemId === open) ?? null;
  return (
    <>
      <div className={styles.topics} data-testid="receipt-topics">
        {topics.map((t) => (
          <button key={t.itemId} type="button" aria-pressed={open === t.itemId}
            className={`${styles.topic} ${isActive(t) ? "" : styles.topicRejected} ${open === t.itemId ? styles.topicOn : ""}`}
            onClick={() => setOpen(open === t.itemId ? null : t.itemId)} data-testid="receipt-topic">
            {effectiveContent(t).text}
          </button>
        ))}
      </div>
      {selected && <ItemCard key={selected.itemId} item={selected} {...props} variant="compact" evidenceOpen />}
    </>
  );
}

const STATE_LABEL = { suggested: "Suggested", confirmed: "Confirmed", edited: "Edited", rejected: "Rejected" } as const;

function ItemCard({
  item,
  canCurate,
  session,
  resolve,
  review,
  variant = "full",
  evidenceOpen = false,
}: IntelProps & { item: IntelligenceItem; variant?: "full" | "compact" | "summary"; evidenceOpen?: boolean }) {
  const [showEvidence, setShowEvidence] = useState(evidenceOpen);
  const [showOriginal, setShowOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const content = effectiveContent(item);
  const rejected = !isActive(item);

  const act = async (action: ReviewAction, payload?: ItemContent) => {
    setBusy(true);
    setError(null);
    try {
      await review(item.itemId, action, payload);
      setEditing(false);
      setConfirmReject(false);
    } catch (err) {
      setError(err instanceof ReceiptError && err.status === 422 ? "That edit isn't valid." : "Couldn't save the review.");
    } finally {
      setBusy(false);
    }
  };

  const cls = [styles.item, styles[`state_${item.reviewState}`], variant !== "full" ? styles.itemCompact : ""].join(" ");
  return (
    <article className={cls} data-testid="receipt-item" data-type={item.type} data-state={item.reviewState}
      data-item-id={item.itemId}>
      {item.type === "open_loop" && <span className={styles.eyebrow}>{openLoopLabel(content.kind)}</span>}
      {editing ? (
        <EditForm item={item} session={session} resolve={resolve} busy={busy}
          onCancel={() => setEditing(false)} onSave={(payload) => void act("edit", payload)} />
      ) : (
        <p className={variant === "summary" ? styles.summaryText : styles.itemText} data-testid="receipt-item-text">
          {content.text}
        </p>
      )}
      {!editing && item.type === "commitment" && (
        <dl className={styles.details}>
          <div>
            <dt>Owner</dt>
            <dd data-testid="receipt-owner">{content.ownerEmail ? resolve(content.ownerEmail) : "Not established"}</dd>
          </div>
          {content.deadline && (
            <div>
              <dt>When</dt>
              <dd data-testid="receipt-deadline">{content.deadline}</dd>
            </div>
          )}
        </dl>
      )}
      {!editing && item.uncertainty && !rejected && <p className={styles.uncertainty}>{item.uncertainty}</p>}
      {showOriginal && item.reviewState === "edited" && (
        <div className={styles.original} data-testid="receipt-original">
          <span className={styles.originalLabel}>Original suggestion</span>
          {item.content.text}
        </div>
      )}
      <div className={styles.meta}>
        <span className={styles.state} data-testid="receipt-state">
          {STATE_LABEL[item.reviewState]}
          {item.reviewedBy && item.reviewState !== "suggested" && ` · ${resolve(item.reviewedBy)}`}
        </span>
        {item.confidenceLevel === "medium" && !rejected && <span className={styles.lessCertain}>Less certain</span>}
        {item.reviewState === "edited" && (
          <button type="button" className={styles.link} onClick={() => setShowOriginal((v) => !v)}
            data-testid="receipt-toggle-original">
            {showOriginal ? "Hide original" : "Original"}
          </button>
        )}
        {item.evidence.length > 0 && (
          <button type="button" className={styles.link} aria-expanded={showEvidence}
            onClick={() => setShowEvidence((v) => !v)} data-testid="receipt-evidence-toggle">
            {showEvidence ? "Hide evidence" : `View evidence (${item.evidence.length})`}
          </button>
        )}
        {canCurate && !editing && (
          <span className={styles.actions}>
            {confirmReject ? (
              <>
                <button type="button" className={panel.danger} disabled={busy} onClick={() => void act("reject")}
                  data-testid="receipt-reject-confirm">
                  Reject it
                </button>
                <button type="button" className={panel.ghost} onClick={() => setConfirmReject(false)}>
                  Keep
                </button>
              </>
            ) : (
              <>
                {item.reviewState !== "confirmed" && (
                  <button type="button" className={panel.ghost} disabled={busy} onClick={() => void act("confirm")}
                    data-testid="receipt-confirm">
                    Confirm
                  </button>
                )}
                <button type="button" className={panel.ghost} disabled={busy} onClick={() => setEditing(true)}
                  data-testid="receipt-edit">
                  Edit
                </button>
                {!rejected && (
                  <button type="button" className={panel.ghost} disabled={busy} onClick={() => setConfirmReject(true)}
                    data-testid="receipt-reject">
                    Reject
                  </button>
                )}
              </>
            )}
          </span>
        )}
      </div>
      {error && <p className={panel.error} role="alert">{error}</p>}
      {showEvidence && <EvidenceList evidence={item.evidence} resolve={resolve} />}
    </article>
  );
}

function EvidenceList({ evidence, resolve }: { evidence: Evidence[]; resolve: Resolve }) {
  const ordered = [...evidence].sort((a, b) => a.position - b.position);
  return (
    <ol className={styles.evidence} data-testid="receipt-evidence">
      {ordered.map((e) => (
        <li key={e.segmentId} className={styles.quote} data-testid="receipt-quote" data-segment-id={e.segmentId}>
          <span className={styles.quoteWho}>
            {e.speakerName || resolve(e.speakerEmail)}
            <span className={styles.quoteAt}>{offsetLabel(e.startOffsetMs)}</span>
          </span>
          <span className={styles.quoteText}>“{e.text}”</span>
        </li>
      ))}
    </ol>
  );
}

function EditForm({
  item,
  session,
  resolve,
  busy,
  onCancel,
  onSave,
}: {
  item: IntelligenceItem;
  session: MeetingSessionInfo;
  resolve: Resolve;
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: ItemContent) => void;
}) {
  const start = effectiveContent(item);
  const fields = EDIT_FIELDS[item.type];
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, start[f.key] ?? ""])),
  );
  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const owners = [...new Set([...session.attendees.map((a) => a.email), ...(start.ownerEmail ? [start.ownerEmail] : [])])];
  const incomplete = fields.some((f) => f.required && !(draft[f.key] ?? "").trim());
  return (
    <div className={styles.editForm} data-testid="receipt-edit-form">
      {fields.map((f) => (
        <label key={f.key} className={panel.field}>
          <span className={panel.label}>{f.label}</span>
          {f.key === "ownerEmail" ? (
            <select className={panel.input} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}
              data-testid="receipt-edit-ownerEmail">
              <option value="">Not established</option>
              {owners.map((email) => (
                <option key={email} value={email}>{resolve(email)}</option>
              ))}
            </select>
          ) : f.key === "kind" ? (
            <select className={panel.input} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}
              data-testid="receipt-edit-kind">
              {Object.entries(OPEN_LOOP_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          ) : f.multiline ? (
            <textarea className={`${panel.input} ${styles.textarea}`} value={draft[f.key]} rows={2}
              onChange={(e) => set(f.key, e.target.value)} data-testid={`receipt-edit-${f.key}`} />
          ) : (
            <input className={panel.input} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}
              data-testid={`receipt-edit-${f.key}`} />
          )}
        </label>
      ))}
      <div className={styles.editActions}>
        <button type="button" className={panel.ghost} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={panel.primary} disabled={busy || incomplete}
          onClick={() => onSave(editPayload(item.type, start, draft))} data-testid="receipt-edit-save">
          Save edit
        </button>
      </div>
    </div>
  );
}

export default MeetingReceipt;
