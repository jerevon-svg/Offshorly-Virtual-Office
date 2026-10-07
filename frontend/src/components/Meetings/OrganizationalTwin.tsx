import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import HudIcon from "../HudIcon";
import { MAX_QUESTION, type TwinTurn } from "../../services/meetings/meetingTwin";
import type { OrganizationalTwinState } from "../../services/meetings/organizationalTwin";
import type { Evidence, OrgTwinAnswer, OrgTwinMemory, OrgTwinSource } from "../../services/meetings/meetingReceiptClient";
import { formatDay } from "../../services/meetings/meetingTime";
import { EvidenceList } from "./MeetingReceipt";
import panel from "./MeetingsPanel.module.css";
import twinStyles from "./MeetingTwin.module.css";
import styles from "./OrganizationalTwin.module.css";

// PHASE 9B — ORGANIZATIONAL TWIN: "Ask your Memory". Opened from the Memory tab (not from one Receipt — that is
// "Ask this meeting"), it answers across every meeting the employee can access. Every answer is the server's:
// grounded or honestly not established, with "Sources · N meetings" grouped by meeting in meeting order, each
// memory labelled by what it is (a decision, something discussed…) and who stands behind it (reviewed wording,
// confirmed, a VO suggestion), and a source's Receipt one tap away. Suggestions take the same path as typing.
// The conversation lives in the Meetings panel (organizationalTwin.ts) so a Receipt and back keeps it.

type Resolve = (email: string) => string;

const SUGGESTIONS = ["What have we decided recently?", "What am I responsible for?", "What is still unresolved?"];

const TYPE_LABEL: Record<OrgTwinMemory["type"], string> = {
  decision: "Decision",
  commitment: "Commitment",
  open_loop: "Open question",
  discussion: "Discussed",
  topic: "Discussed",
  key_point: "Key point",
  summary: "Summary",
};

const REVIEW_LABEL: Record<NonNullable<OrgTwinMemory["reviewState"]>, string> = {
  edited: "Reviewed wording",
  confirmed: "Confirmed",
  suggested: "VO suggestion",
};

const INSUFFICIENT_EYEBROW: Record<string, string> = {
  no_memories: "Nothing found in your meetings",
  unclear: "Say a little more",
};

export const sourceTitle = (m: OrgTwinSource["meeting"]): string =>
  m.title ?? (m.kind === "instant" ? "Instant meeting" : "Meeting");

export interface OrganizationalTwinProps {
  twin: OrganizationalTwinState;
  resolveDisplayName: Resolve;
  onBack: () => void;
  onClose: () => void;
  onOpenReceipt: (sessionId: string) => void;
}

export function OrganizationalTwin({ twin, resolveDisplayName, onBack, onClose, onOpenReceipt }: OrganizationalTwinProps) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [twin.turns]);

  const send = (text: string) => {
    if (twin.asking) return;
    void twin.ask(text).then((sent) => {
      if (sent) setDraft("");
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const blocked = twin.blocked === "generator_unavailable";
  return (
    <>
      <header className={panel.header}>
        <button type="button" className={panel.backButton} onClick={onBack} aria-label="Back to Memory"
          data-testid="orgtwin-back">
          ‹
        </button>
        <span className={panel.headerIcon} aria-hidden="true">
          <HudIcon name="memory" size="34px" />
        </span>
        <div className={panel.headerText}>
          <h2 className={panel.title}>Ask your Memory</h2>
          <p className={panel.subtitle}>Across the meetings you can access</p>
        </div>
        <button type="button" className={panel.closeButton} onClick={onClose} aria-label="Close meetings">
          ✕
        </button>
      </header>
      <div className={panel.body} data-testid="org-twin" aria-live="polite">
        {blocked ? (
          <div className={panel.emptyState} data-testid="orgtwin-blocked">
            <p className={panel.emptyTitle}>Ask your Memory isn't available here yet</p>
            <p className={panel.empty}>Answers need a Twin generator, which this environment doesn't have.</p>
          </div>
        ) : (
          <>
            {twin.turns.length === 0 && (
              <div className={twinStyles.intro} data-testid="orgtwin-intro">
                <p className={twinStyles.introText}>
                  Ask about decisions, commitments, discussions and open questions across the meetings you can
                  access. Every answer shows the meetings it comes from.
                </p>
                <div className={twinStyles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className={twinStyles.suggestion} onClick={() => send(s)}
                      data-testid="orgtwin-suggestion">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {twin.turns.map((t) => (
              <Turn key={t.id} turn={t} resolve={resolveDisplayName} onOpenReceipt={onOpenReceipt} />
            ))}
            <div ref={end} />
          </>
        )}
      </div>
      {!blocked && (
        <form className={twinStyles.composer} onSubmit={(e) => { e.preventDefault(); send(draft); }}
          data-testid="orgtwin-composer">
          <textarea className={`${panel.input} ${twinStyles.field}`} rows={1} value={draft}
            maxLength={MAX_QUESTION} placeholder="Ask about your meetings…" aria-label="Ask your Memory"
            onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} data-testid="orgtwin-input" />
          <button type="submit" className={panel.primary} disabled={twin.asking || !draft.trim()}
            data-testid="orgtwin-send">
            {twin.asking ? "Asking…" : "Ask"}
          </button>
        </form>
      )}
    </>
  );
}

function Turn({ turn, resolve, onOpenReceipt }: {
  turn: TwinTurn<OrgTwinAnswer>; resolve: Resolve; onOpenReceipt: (sessionId: string) => void;
}) {
  return (
    <div className={twinStyles.turn} data-testid="orgtwin-turn" data-state={turn.state}>
      <p className={twinStyles.question} data-testid="orgtwin-question">{turn.question}</p>
      {turn.state === "asking" && (
        <p className={twinStyles.thinking} data-testid="orgtwin-asking">Reading your meetings…</p>
      )}
      {turn.state === "failed" && (
        <p className={panel.error} role="alert" data-testid="orgtwin-error">{turn.error}</p>
      )}
      {turn.state === "answered" && turn.answer && (
        <Answer answer={turn.answer} resolve={resolve} onOpenReceipt={onOpenReceipt} />
      )}
    </div>
  );
}

/** What the answer leans on, once each: a human's reading, a VO suggestion, speech, an earlier transcript. */
function basisOf(sources: OrgTwinSource[]): { key: string; label: string }[] {
  const all = sources.flatMap((s) => s.memories);
  const out: { key: string; label: string }[] = [];
  const add = (key: string, label: string, when: boolean) => when && out.push({ key, label });
  add("edited", REVIEW_LABEL.edited, all.some((m) => m.reviewState === "edited"));
  add("confirmed", REVIEW_LABEL.confirmed, all.some((m) => m.reviewState === "confirmed"));
  add("suggested", REVIEW_LABEL.suggested, all.some((m) => m.reviewState === "suggested"));
  add("discussion", "From what was said", all.some((m) => m.source === "transcript"));
  add("stale", "Receipt predates transcript changes", all.some((m) => m.stale));
  return out;
}

function Answer({ answer, resolve, onOpenReceipt }: {
  answer: OrgTwinAnswer; resolve: Resolve; onOpenReceipt: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const insufficient = answer.status === "insufficient";
  const n = answer.sources.length;
  const basis = basisOf(answer.sources);
  return (
    <article className={`${twinStyles.answer} ${insufficient ? twinStyles.insufficient : ""}`} data-testid="orgtwin-answer"
      data-status={answer.status} data-reason={answer.reason ?? undefined}>
      {insufficient && (
        <span className={twinStyles.eyebrow} data-testid="orgtwin-not-established">
          {INSUFFICIENT_EYEBROW[answer.reason ?? ""] ?? "Not established in your meetings"}
        </span>
      )}
      <p className={twinStyles.answerText} data-testid="orgtwin-answer-text">{answer.answer}</p>
      {answer.uncertainty && <p className={twinStyles.uncertainty} data-testid="orgtwin-uncertainty">{answer.uncertainty}</p>}
      {(basis.length > 0 || n > 0) && (
        <div className={twinStyles.meta}>
          {basis.map((b) => (
            <span key={b.key} className={`${twinStyles.basis} ${twinStyles[`basis_${b.key}`] ?? styles[`basis_${b.key}`] ?? ""}`} data-testid="orgtwin-basis"
              data-kind={b.key}>
              {b.label}
            </span>
          ))}
          {n > 0 && (
            <button type="button" className={twinStyles.sources} aria-expanded={open} onClick={() => setOpen((v) => !v)}
              data-testid="orgtwin-sources-toggle">
              {open ? "Hide sources" : `Sources · ${n} meeting${n === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
      {open && (
        <ol className={styles.sources} data-testid="orgtwin-sources">
          {answer.sources.map((s) => (
            <SourceMeeting key={s.meeting.sessionId} source={s} resolve={resolve} onOpenReceipt={onOpenReceipt} />
          ))}
        </ol>
      )}
    </article>
  );
}

function SourceMeeting({ source, resolve, onOpenReceipt }: {
  source: OrgTwinSource; resolve: Resolve; onOpenReceipt: (sessionId: string) => void;
}) {
  const m = source.meeting;
  return (
    <li className={styles.meeting} data-testid="orgtwin-source" data-session-id={m.sessionId}>
      <div className={styles.meetingHead}>
        <span className={styles.meetingName} data-testid="orgtwin-source-title">
          {sourceTitle(m)} · {formatDay(m.startedAt)}
        </span>
        {!m.viewer.attended && <span className={styles.absent}>Shared with you</span>}
        <button type="button" className={styles.openReceipt} onClick={() => onOpenReceipt(m.sessionId)}
          data-testid="orgtwin-open-receipt">
          Receipt ›
        </button>
      </div>
      <ul className={styles.memories}>
        {source.memories.map((mem, i) => (
          <MemoryLine key={i} memory={mem} resolve={resolve} />
        ))}
      </ul>
    </li>
  );
}

function MemoryLine({ memory, resolve }: { memory: OrgTwinMemory; resolve: Resolve }) {
  const [open, setOpen] = useState(false);
  const owner = memory.type === "commitment" ? memory.details.ownerEmail : null;
  const deadline = memory.type === "commitment" ? memory.details.deadline : null;
  // The Receipt's evidence list, in the order the lines were said.
  const evidence: Evidence[] = memory.evidence.map((e, position) => ({ ...e, position, captureId: "", revision: 0 }));
  const n = evidence.length;
  return (
    <li className={styles.memory} data-testid="orgtwin-memory" data-type={memory.type}>
      <span className={styles.memoryTags}>
        <span className={`${styles.type} ${styles[`type_${memory.type}`] ?? ""}`}>{TYPE_LABEL[memory.type]}</span>
        {memory.reviewState && (
          <span className={`${twinStyles.basis} ${twinStyles[`basis_${memory.reviewState}`]}`} data-testid="orgtwin-memory-review">
            {REVIEW_LABEL[memory.reviewState]}
          </span>
        )}
        {memory.stale && <span className={styles.stale} data-testid="orgtwin-memory-stale">Earlier transcript</span>}
      </span>
      <span className={styles.memoryText}>
        {memory.source === "transcript" ? `“${memory.text}”` : memory.text}
        {owner && <span className={styles.owner}> · {resolve(owner)}{deadline ? `, ${deadline}` : ""}</span>}
      </span>
      {n > 0 && (
        <button type="button" className={styles.lines} aria-expanded={open} onClick={() => setOpen((v) => !v)}
          data-testid="orgtwin-evidence-toggle">
          {open ? "Hide lines" : `${n} line${n === 1 ? "" : "s"}${memory.evidenceComplete ? "" : " · some changed since"}`}
        </button>
      )}
      {open && <EvidenceList evidence={evidence} resolve={resolve} />}
    </li>
  );
}

export default OrganizationalTwin;
