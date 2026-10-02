// vo3d app — THE TASK CONVERSATION (AI Workforce, Phase 6B: a real VO chat window): one job = one thread = one
// window = one chat head. It is NOT the employee's personal Toucan conversation: Toucan delegated the work, and the
// job's own workspace conversation (you, Toucan, and every agent that joins) lives here. The window is mounted by the
// overlay's Global Chat lifecycle (focus / minimize to the rail / restore / close) — none of which touches the job.
//
// It renders ONE JobSnapshot's conversation (world/agentJob) — the human, Toucan and every agent that joined the
// job — in VO's own chat chrome: the shared window header, the Messenger bubbles, the system-record rows and the
// shared ChatComposer (components/Chat). It holds no job state of its own: close it, reopen it, mount it on a
// phone — the thread is whatever the job's records say, so nothing is ever lost or doubled by the window.
//
// What it shows is derived, never authored twice: a spoken line here is the same message record the bubble over
// the speaker came from; status rows and the result card are the job's own records (handoffs, stages, revisions).
// The result card opens the SAME viewer the chip's View Result does, from the same artifact record.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationEntry, JobSnapshot } from "../world/agentJob";
import { nameOf } from "../world/agentJob";
import type { AttentionResponse } from "../world/agentOrchestration";
import { ChatWindowHeader } from "../../../components/Chat/ChatWindowHeader";
import { ChatComposer } from "../../../components/Chat/ChatComposer";
import { useMentionComposer } from "../../../components/Chat/useMentionComposer";
import { TOUCAN_AVATAR_GLYPH } from "../../../services/chat/toucanSender";
import chat from "../../../components/Chat/ConversationView.module.css";
import styles from "./AiLabTaskChat.module.css";

export interface AiLabTaskChatProps {
  job: JobSnapshot;
  /** the window is minimized to its chat head (it stays mounted, exactly like a DM window) */
  minimized?: boolean;
  onMinimizeToggle?: () => void;
  onClose: () => void;
  onSend: (text: string) => void;
  onOpenResult: (revisionId: string) => void;
  onRespond: (requestId: string, response: AttentionResponse) => void;
}

const STATUS_LABEL: Record<JobSnapshot["status"], string> = {
  created: "Starting", accepted: "Accepted", active: "Working", waiting: "Needs you", ready: "Ready for review", approved: "Approved", halted: "Stopped", failed: "Failed",
};
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function AiLabTaskChat({ job, minimized, onMinimizeToggle, onClose, onSend, onOpenResult, onRespond }: AiLabTaskChatProps) {
  const [draft, setDraft] = useState("");
  const mention = useMentionComposer([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const count = job.conversation.length;
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }); }, [count]);
  const people = useMemo(() => job.participants.filter((p) => p !== "user").map(nameOf).join(", "), [job.participants]);
  const waitingOnYou = job.attention?.kind === "needs-input" ? job.attention.requestId : null;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (waitingOnYou) onRespond(waitingOnYou, { kind: "input", text });
    else onSend(text);
    setDraft("");
  };

  return (
    <div className={chat.panel} data-testid="ailab-task-chat" role="dialog" aria-label={`Task conversation: ${job.title}`}>
      <ChatWindowHeader
        name={job.title || "Task"}
        subtitle={`AI Workforce task · You, ${people} · ${STATUS_LABEL[job.status]}${job.revision > 1 ? ` · Revision ${job.revision}` : ""}`}
        headerExtra={<span className={styles.taskBadge}>Preview</span>}
        minimized={minimized}
        onMinimizeToggle={onMinimizeToggle}
        onClose={onClose}
      />
      <div className={chat.messages} data-testid="ailab-task-thread">
        {job.conversation.map((c, i) => <Entry key={key(c)} c={c} prev={job.conversation[i - 1]} onOpenResult={onOpenResult} onRespond={onRespond} />)}
        <div ref={endRef} />
      </div>
      <ChatComposer
        draft={draft}
        setDraft={setDraft}
        mention={mention}
        placeholder={waitingOnYou ? "Answer the team" : "Message Toucan"}
        onDraftInput={(text, caret) => { setDraft(text); mention.onDraftChanged(text, caret); }}
        onSend={send}
      />
      <div className={styles.mockLine}>{job.title ? "Preview — scripted sample, not real AI work" : ""}</div>
    </div>
  );
}

const key = (c: ConversationEntry) => (c.kind === "message" ? c.messageId : `${c.kind}-${c.seq}`);

function Entry({ c, prev, onOpenResult, onRespond }: {
  c: ConversationEntry; prev?: ConversationEntry; onOpenResult: (revisionId: string) => void; onRespond: AiLabTaskChatProps["onRespond"];
}) {
  if (c.kind === "status") {
    return <div className={chat.systemRow} data-entry="status"><span className={chat.systemText}>{c.text}</span><span className={chat.systemTime}>{time(c.at)}</span></div>;
  }
  if (c.kind === "attention") {
    return (
      <div className={styles.attention} data-entry="attention" data-resolved={c.resolved ? "true" : "false"}>
        <div className={styles.attentionHead}>{nameOf(c.from)} needs your {c.need === "needs-approval" ? "approval" : "input"}</div>
        <div>{c.prompt}</div>
        {c.outcome && <div className={styles.hint} data-outcome={c.outcome}>{c.outcome === "approved" ? `Approved${c.action ? `: ${c.action}` : ""}` : c.outcome === "declined" ? `Declined${c.action ? `: ${c.action}` : ""} — not done` : "Answered"}</div>}
        {!c.resolved && c.need === "needs-approval" && (
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => onRespond(c.requestId, { kind: "approval", approved: true })}>Approve</button>
            <button type="button" className={styles.secondary} onClick={() => onRespond(c.requestId, { kind: "approval", approved: false })}>Decline</button>
          </div>
        )}
        {!c.resolved && c.need === "needs-input" && <div className={styles.hint}>Reply below to answer.</div>}
        {/* the Preview's guarded actions are scripted: the decision is real, the deploy it guards is not */}
        {c.need === "needs-approval" && <div className={styles.hint} data-testid="ailab-approval-preview">Preview — nothing real is deployed or changed.</div>}
      </div>
    );
  }
  const from = c.kind === "artifact" ? c.by : c.from;
  const own = c.kind === "message" && from === "user";
  const sameRun = !!prev && prev.kind !== "status" && prev.kind !== "attention" && (prev.kind === "artifact" ? prev.by : prev.from) === from;
  const toucan = from === "toucan";
  const to = c.kind === "message" && c.to !== "user" && c.to !== "toucan" && c.to !== "team" && !own ? ` → ${nameOf(c.to)}` : "";
  return (
    <div className={chat.messageGroup}>
      <div className={own ? `${chat.row} ${chat.rowSelf}` : chat.row} data-sender={own ? "self" : toucan ? "toucan" : "agent"} data-entry={c.kind}>
        <div className={chat.bubbleColumn}>
          {!own && !sameRun && <span className={chat.senderName}>{nameOf(from)}{to}</span>}
          <div className={chat.bubbleLine}>
            {!own && (
              <div className={toucan ? `${chat.avatar} ${chat.toucanAvatar}` : `${chat.avatar} ${styles.agentAvatar}`} data-initials-avatar="true" data-agent={from}>
                {toucan ? TOUCAN_AVATAR_GLYPH : nameOf(from).charAt(0)}
              </div>
            )}
            {c.kind === "artifact" ? (
              <div className={`${chat.message} ${chat.peer} ${styles.artifact}`}>
                <span className={styles.artifactKicker}>Revision {c.revision} · {c.delivered ? "Delivered" : "Ready in the AI Lab"}</span>
                <b>{c.title}</b>
                {c.delivered
                  ? <button type="button" className={styles.primary} onClick={() => onOpenResult(c.revisionId)}>View Result</button>
                  : <span className={styles.hint}>Toucan is bringing it to you.</span>}
              </div>
            ) : (
              <div className={[chat.message, own ? chat.own : chat.peer, c.tone === "note" ? styles.note : ""].filter(Boolean).join(" ")} data-tone={c.tone}>
                {c.text}
              </div>
            )}
          </div>
          <div className={chat.meta}><span className={own ? `${chat.timestamp} ${chat.timestampRight}` : chat.timestamp}>{time(c.at)}</span></div>
        </div>
      </div>
    </div>
  );
}

export default AiLabTaskChat;
