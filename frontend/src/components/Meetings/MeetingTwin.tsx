import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import HudIcon from "../HudIcon";
import { MAX_QUESTION, useMeetingTwin, type TwinBlock, type TwinTurn } from "../../services/meetings/meetingTwin";
import type { Evidence, MeetingSessionInfo, TwinAnswer, TwinBasis } from "../../services/meetings/meetingReceiptClient";
import { formatDay, formatTime } from "../../services/meetings/meetingTime";
import { EvidenceList } from "./MeetingReceipt";
import panel from "./MeetingsPanel.module.css";
import styles from "./MeetingTwin.module.css";

// PHASE 8B — MEETING TWIN: "Ask this meeting". A focused view inside the Meetings panel, opened from one
// Receipt and bound to that one Meeting Session; the header keeps the meeting's identity in view. Every answer
// is the server's (services/meetings/meetingTwin.ts): grounded or honestly not established, with the exact
// transcript lines it rests on behind a compact "N sources" toggle. Suggestions only fill the composer's
// question — they take the same grounded path as anything typed. Nothing is stored; Back returns to the Receipt.

type Resolve = (email: string) => string;

const SUGGESTIONS = ["What did we decide?", "What did I agree to?", "What is still unresolved?", "Summarize the meeting"];

const BLOCKED: Record<TwinBlock, { title: string; body: string }> = {
  unavailable: { title: "Not available", body: "This meeting isn't shared with you." },
  no_transcript: { title: "Nothing to ask yet", body: "This meeting has no transcript, so there's nothing to answer from." },
  generator_unavailable: { title: "Meeting Twin isn't available here yet", body: "Answers need a Twin generator, which this environment doesn't have." },
  meeting_active: { title: "Still in progress", body: "Ask this meeting once it has ended." },
};

const BASIS_LABEL: Record<TwinBasis["reviewState"], string> = {
  edited: "Reviewed wording",
  confirmed: "Confirmed",
  suggested: "VO suggestion",
};

const roomLabel = (roomId: string | null): string | null => {
  if (!roomId) return null;
  const slug = roomId.split("/")[1] ?? roomId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};

export interface MeetingTwinProps {
  session: MeetingSessionInfo;
  resolveDisplayName: Resolve;
  onBack: () => void;
  onClose: () => void;
}

export function MeetingTwin({ session, resolveDisplayName, onBack, onClose }: MeetingTwinProps) {
  const twin = useMeetingTwin(session.sessionId);
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

  const title = session.title ?? (session.kind === "instant" ? "Instant meeting" : "Meeting");
  const room = roomLabel(session.roomId);
  const when = `${formatDay(session.startedAt)} ${formatTime(session.startedAt)}`;
  const block = twin.blocked ? BLOCKED[twin.blocked] : null;
  return (
    <>
      <header className={panel.header}>
        <button type="button" className={panel.backButton} onClick={onBack} aria-label="Back to receipt"
          data-testid="twin-back">
          ‹
        </button>
        <span className={panel.headerIcon} aria-hidden="true">
          <HudIcon name="chat" size="34px" />
        </span>
        <div className={panel.headerText}>
          <h2 className={panel.title} data-testid="twin-title">{title}</h2>
          <p className={panel.subtitle} data-testid="twin-subtitle">
            Ask this meeting · {when}
            {room && ` · ${room}`}
            {session.isPrivate && <span className={panel.privateTag}> Private</span>}
          </p>
        </div>
        <button type="button" className={panel.closeButton} onClick={onClose} aria-label="Close meetings">
          ✕
        </button>
      </header>
      <div className={panel.body} data-testid="meeting-twin" aria-live="polite">
        {block ? (
          <div className={panel.emptyState} data-testid={`twin-blocked-${twin.blocked}`}>
            <p className={panel.emptyTitle}>{block.title}</p>
            <p className={panel.empty}>{block.body}</p>
          </div>
        ) : (
          <>
            {twin.turns.length === 0 && (
              <div className={styles.intro} data-testid="twin-intro">
                <p className={styles.introText}>
                  Answers come only from this meeting — its transcript and receipt — with the lines they rest on.
                </p>
                <div className={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className={styles.suggestion} onClick={() => send(s)}
                      data-testid="twin-suggestion">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {twin.turns.map((t) => (
              <Turn key={t.id} turn={t} resolve={resolveDisplayName} />
            ))}
            <div ref={end} />
          </>
        )}
      </div>
      {!block && (
        <form className={styles.composer} onSubmit={(e) => { e.preventDefault(); send(draft); }}
          data-testid="twin-composer">
          <textarea className={`${panel.input} ${styles.field}`} rows={1} value={draft}
            maxLength={MAX_QUESTION} placeholder="Ask about this meeting…" aria-label="Ask this meeting"
            onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} data-testid="twin-input" />
          <button type="submit" className={panel.primary} disabled={twin.asking || !draft.trim()}
            data-testid="twin-send">
            {twin.asking ? "Asking…" : "Ask"}
          </button>
        </form>
      )}
    </>
  );
}

function Turn({ turn, resolve }: { turn: TwinTurn; resolve: Resolve }) {
  return (
    <div className={styles.turn} data-testid="twin-turn" data-state={turn.state}>
      <p className={styles.question} data-testid="twin-question">{turn.question}</p>
      {turn.state === "asking" && (
        <p className={styles.thinking} data-testid="twin-asking">Reading the meeting…</p>
      )}
      {turn.state === "failed" && (
        <p className={panel.error} role="alert" data-testid="twin-error">{turn.error}</p>
      )}
      {turn.state === "answered" && turn.answer && <Answer answer={turn.answer} resolve={resolve} />}
    </div>
  );
}

function Answer({ answer, resolve }: { answer: TwinAnswer; resolve: Resolve }) {
  const [open, setOpen] = useState(false);
  const insufficient = answer.status === "insufficient";
  const n = answer.evidence.length;
  // The Receipt's evidence list, in the server's (transcript) order.
  const evidence: Evidence[] = answer.evidence.map((e, position) => ({ ...e, position, captureId: "", revision: 0 }));
  return (
    <article className={`${styles.answer} ${insufficient ? styles.insufficient : ""}`} data-testid="twin-answer"
      data-status={answer.status}>
      {insufficient && <span className={styles.eyebrow} data-testid="twin-not-established">Not established in this meeting</span>}
      <p className={styles.answerText} data-testid="twin-answer-text">{answer.answer}</p>
      {answer.uncertainty && <p className={styles.uncertainty}>{answer.uncertainty}</p>}
      {(answer.basis.length > 0 || n > 0 || answer.intelligence !== "current") && (
        <div className={styles.meta}>
          {answer.basis.map((b, i) => (
            <span key={i} className={`${styles.basis} ${styles[`basis_${b.reviewState}`]}`} data-testid="twin-basis"
              data-state={b.reviewState}>
              {BASIS_LABEL[b.reviewState]}
              {b.stale && " · earlier transcript"}
            </span>
          ))}
          {answer.intelligence === "none" && <span className={styles.note}>From the transcript · no receipt yet</span>}
          {answer.intelligence === "stale" && <span className={styles.note}>Receipt predates transcript changes</span>}
          {n > 0 && (
            <button type="button" className={styles.sources} aria-expanded={open} onClick={() => setOpen((v) => !v)}
              data-testid="twin-sources-toggle">
              {open ? "Hide sources" : `${n} source${n === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
      {open && <EvidenceList evidence={evidence} resolve={resolve} />}
    </article>
  );
}

export default MeetingTwin;
