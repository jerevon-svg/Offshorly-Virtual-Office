// vo3d world — THE JOB, AS TRUTH: a pure projection of a job's ordered records. No THREE, no React, no timers.
//
// reduceJob(snapshot, record) is the ONE place a record changes what a job IS — its status, revisions, who holds
// the work, what each agent is doing, the conversation, what the human has asked for. Everything else reads the
// result: the task conversation, the result viewer, Approve / Request Changes, the physical Lab (which only
// decides how it LOOKS), and later a phone, a notification service or a persistent server.
//
// It is the same function whether the records arrive live, are replayed after a reconnect, or start from a
// snapshot the backend compacted: projectJob(history) and folding live records one by one give the same answer.
import type { AgentExecState } from "./monkeyAgentContract";
import type { ArtifactResult, JobRecord, MessageKind, OrchestrationEvent, Speaker } from "./agentOrchestration";

export type JobStatus = "created" | "accepted" | "active" | "waiting" | "ready" | "approved" | "halted" | "failed";

/** one line of the task conversation. Status / artifact / attention entries are DERIVED from the job's own
 *  records — nobody writes them twice, so the thread can never disagree with the job. */
export type ConversationEntry =
  | { kind: "message"; seq: number; at: number; messageId: string; tone: MessageKind; from: Speaker; to: string; text: string }
  | { kind: "status"; seq: number; at: number; text: string }
  | { kind: "artifact"; seq: number; at: number; revisionId: string; revision: number; title: string; by: string; delivered: boolean }
  | { kind: "attention"; seq: number; at: number; requestId: string; from: Speaker; need: "needs-input" | "needs-approval"; prompt: string; action: string | null;
      resolved: boolean; outcome: Decision["outcome"] | null };

export type ArtifactRevision = {
  artifactId: string;
  revisionId: string;
  revision: number;
  title: string;
  by: string;
  /** the content, when it arrived inline (else JobClient.artifact fetches it by revisionId) */
  result: ArtifactResult | null;
  readyAt: number;
  delivered: boolean;
  approved: boolean;
};

export type HumanAttention = { requestId: string; from: Speaker; kind: "needs-input" | "needs-approval"; prompt: string; action: string | null; seq: number };
/** what the human decided on one request — kept for good, in order */
export type Decision = { requestId: string; kind: "needs-input" | "needs-approval"; action: string | null; outcome: "approved" | "declined" | "answered"; text?: string; seq: number; at: number };

/** EVERYTHING A CLIENT NEEDS TO KNOW ABOUT ONE JOB. Plain, serialisable data: a backend can hand it over as a
 *  snapshot, a phone can render it, the Lab can stage itself from it. */
export type JobSnapshot = {
  jobId: string;
  title: string;
  requestedBy: string;
  command: string;
  status: JobStatus;
  /** the revision currently being worked on, or last delivered (1 = the original) */
  revision: number;
  /** everyone in the task conversation: the human, the orchestrator, then each agent as it joins */
  participants: readonly Speaker[];
  /** the team the current revision was dispatched to */
  team: readonly string[];
  agents: Readonly<Record<string, { role: string | null; state: AgentExecState }>>;
  /** WHO HOLDS THE WORK: toucan → an agent → … → "artifact" (resting, ready) → toucan → user */
  owner: string | null;
  conversation: readonly ConversationEntry[];
  /** every revision ever made ready, oldest first — none is ever overwritten */
  artifacts: readonly ArtifactRevision[];
  /** every change the human asked for, in order */
  feedback: readonly { revision: number; basedOn: string; text: string; seq: number }[];
  approvedRevisionId: string | null;
  /** what the job is waiting on the human for (null = nothing) */
  attention: HumanAttention | null;
  /** every request the human has answered, and how */
  decisions: readonly Decision[];
  /** every revision that stopped without a result, and why */
  halted: readonly { revision: number; reason: string; requestId: string | null; seq: number }[];
  lastSeq: number;
  updatedAt: number;
};

export function emptyJob(jobId: string): JobSnapshot {
  return {
    jobId, title: "", requestedBy: "", command: "", status: "created", revision: 1,
    participants: ["user", "toucan"], team: [], agents: {}, owner: null, conversation: [], artifacts: [], feedback: [],
    approvedRevisionId: null, attention: null, decisions: [], halted: [], lastSeq: 0, updatedAt: 0,
  };
}

/** display names for derived lines (the agents' own names come from the roster; this is enough for status text) */
export const nameOf = (who: string): string => (who === "user" ? "You" : who === "toucan" ? "Toucan" : who.charAt(0).toUpperCase() + who.slice(1));

/** which agent states count as "doing the work" (a status line marks the start of each) */
const WORK_STATES: ReadonlySet<AgentExecState> = new Set(["working", "reviewing"]);

/** FOLD ONE RECORD. Pure: returns a new snapshot (the input is never mutated). A record at or before lastSeq is
 *  ignored, so replaying an overlap after a reconnect can never duplicate anything. */
export function reduceJob(job: JobSnapshot, r: JobRecord): JobSnapshot {
  if (r.seq <= job.lastSeq) return job;
  const e = r.event;
  const j: JobSnapshot = { ...job, lastSeq: r.seq, updatedAt: r.at };
  const line = (entry: ConversationEntry) => { j.conversation = [...j.conversation, entry]; };
  const status = (text: string) => line({ kind: "status", seq: r.seq, at: r.at, text });
  const join = (who: Speaker) => { if (!j.participants.includes(who)) j.participants = [...j.participants, who]; };
  const agent = (id: string) => j.agents[id] ?? { role: null, state: "idle" as AgentExecState };
  switch (e.type) {
    case "job.created":
      j.title = e.title; j.requestedBy = e.requestedBy; j.command = e.command; j.status = "created"; j.owner = "toucan";
      // the request itself is the human's first message in the thread
      line({ kind: "message", seq: r.seq, at: r.at, messageId: `${e.jobId}-request`, tone: "chat", from: "user", to: "toucan", text: e.command });
      return j;
    case "job.accepted":
      j.status = "accepted";
      return j;
    case "job.dispatched":
      j.status = "active"; j.team = [...e.team]; j.revision = e.revision;
      for (const id of e.team) join(id);
      status(e.revision > 1 ? `Toucan took Revision ${e.revision} to the AI Lab` : "Toucan took the job to the AI Lab");
      return j;
    case "message":
      join(e.from);
      line({ kind: "message", seq: r.seq, at: r.at, messageId: e.messageId, tone: e.kind, from: e.from, to: e.to, text: e.text });
      return j;
    case "agent.assigned":
      join(e.agentId);
      j.agents = { ...j.agents, [e.agentId]: { ...agent(e.agentId), role: e.role } };
      return j;
    case "agent.state": {
      const a = agent(e.agentId);
      j.agents = { ...j.agents, [e.agentId]: { role: e.state === "idle" ? null : a.role, state: e.state } };
      const role = a.role ?? "work";
      if (WORK_STATES.has(e.state) && !WORK_STATES.has(a.state)) status(`${nameOf(e.agentId)} started ${role}`);
      // (back to done after waiting on the human is not a second completion)
      else if (e.state === "done" && a.state !== "done" && a.state !== "awaiting-approval" && a.state !== "needs-input") status(`${role} completed`);
      return j;
    }
    case "work.handoff":
      j.owner = e.to;
      if (e.from !== "user") status(e.to === "user" ? `${nameOf(e.from)} handed the work back to you` : `${nameOf(e.from)} handed the work to ${nameOf(e.to)}`);
      return j;
    case "artifact.ready":
      j.owner = "artifact";
      j.artifacts = [...j.artifacts, {
        artifactId: e.artifactId, revisionId: e.revisionId, revision: e.revision, title: e.title, by: e.by,
        result: e.result ?? null, readyAt: r.at, delivered: false, approved: false,
      }];
      line({ kind: "artifact", seq: r.seq, at: r.at, revisionId: e.revisionId, revision: e.revision, title: e.title, by: e.by, delivered: false });
      return j;
    case "artifact.collected":
      j.owner = "toucan";
      return j;
    case "artifact.delivered":
      j.owner = "user";
      j.artifacts = j.artifacts.map((a) => (a.revisionId === e.revisionId ? { ...a, delivered: true } : a));
      // the thread's card for this revision becomes the delivered one (one card per revision, never two)
      j.conversation = j.conversation.map((c) => (c.kind === "artifact" && c.revisionId === e.revisionId ? { ...c, delivered: true } : c));
      status(`Toucan delivered Revision ${revisionOf(j, e.revisionId)} to you`);
      return j;
    case "job.completed":
      j.status = e.outcome === "failed" ? "failed" : "ready";
      return j;
    case "revision.requested":
      j.status = "active"; j.revision = e.revision; j.approvedRevisionId = null;
      j.feedback = [...j.feedback, { revision: e.revision, basedOn: e.basedOn, text: e.feedback, seq: r.seq }];
      status(`Revision ${e.revision} requested`);
      return j;
    case "job.approved":
      j.status = "approved"; j.approvedRevisionId = e.revisionId;
      j.artifacts = j.artifacts.map((a) => ({ ...a, approved: a.revisionId === e.revisionId }));
      status(`You approved Revision ${revisionOf(j, e.revisionId)}`);
      return j;
    case "attention.requested":
      j.status = "waiting";
      j.attention = { requestId: e.requestId, from: e.from, kind: e.kind, prompt: e.prompt, action: e.action ?? null, seq: r.seq };
      line({ kind: "attention", seq: r.seq, at: r.at, requestId: e.requestId, from: e.from, need: e.kind, prompt: e.prompt, action: e.action ?? null, resolved: false, outcome: null });
      return j;
    case "attention.resolved": {
      // ONE ANSWER PER REQUEST: a second resolution of the same request changes nothing
      const req = j.conversation.find((c) => c.kind === "attention" && c.requestId === e.requestId);
      if (!req || req.kind !== "attention" || req.resolved) return j;
      const resp = e.response;
      const outcome: Decision["outcome"] = resp.kind === "approval" ? (resp.approved ? "approved" : "declined") : "answered";
      if (j.attention?.requestId === e.requestId) j.attention = null;
      // approved / answered: the work it was blocked on carries on. Declined: nothing it guarded happens — the job
      // is no longer waiting on the human, and the source says next (halted or rerouted)
      if (j.status === "waiting") j.status = "active";
      j.decisions = [...j.decisions, { requestId: e.requestId, kind: req.need, action: req.action, outcome, text: resp.kind === "input" ? resp.text : resp.note, seq: r.seq, at: r.at }];
      j.conversation = j.conversation.map((c) => (c.kind === "attention" && c.requestId === e.requestId ? { ...c, resolved: true, outcome } : c));
      const what = req.action ?? "the request";
      status(outcome === "approved" ? `You approved: ${what}` : outcome === "declined" ? `You declined: ${what}` : "You answered");
      return j;
    }
    case "revision.halted": {
      const last = latestDelivered(j);
      j.halted = [...j.halted, { revision: e.revision, reason: e.reason, requestId: e.requestId ?? null, seq: r.seq }];
      // back to the human on what was last delivered (still theirs to approve or change); nothing delivered → halted
      j.status = last ? "ready" : "halted";
      j.revision = last?.revision ?? e.revision;
      status(`Revision ${e.revision} stopped${e.reason === "approval-declined" ? " — declined, nothing was done" : ""}`);
      return j;
    }
  }
}

const revisionOf = (j: JobSnapshot, revisionId: string) => j.artifacts.find((a) => a.revisionId === revisionId)?.revision ?? j.revision;

/** a job's truth from its history: an optional snapshot, then every later record in order */
export function projectJob(jobId: string, snapshot: JobSnapshot | null, records: readonly JobRecord[]): JobSnapshot {
  let j = snapshot ?? emptyJob(jobId);
  for (const r of records) j = reduceJob(j, r);
  return j;
}

/** the revision the human is reviewing now (the latest one delivered), if any */
/** IS THE JOB STILL OPEN — anything left for the team or the human to do on it. Approved, failed and halted (stopped
 *  with nothing delivered) are over; the Preview's one-task-at-a-time rule and the job card both read this. */
export function jobOpen(j: Pick<JobSnapshot, "status"> | null): boolean {
  return !!j && j.status !== "approved" && j.status !== "failed" && j.status !== "halted";
}

/** HOW FAR AN OPEN TASK WINDOW HAS BEEN READ: everything shown — but never past a record the live Lab is still holding
 *  back (`unseen`). A chat reply skips the Lab's queue, so it can be shown while earlier Lab records are not yet; reading
 *  "through" it would mark those read before anyone saw them, and a minimized window would never badge them. */
export function readThrough(shown: Pick<JobSnapshot, "lastSeq">, unseen: readonly number[]): number {
  return unseen.length ? Math.min(shown.lastSeq, Math.min(...unseen) - 1) : shown.lastSeq;
}

export function latestDelivered(j: JobSnapshot): ArtifactRevision | null {
  for (let i = j.artifacts.length - 1; i >= 0; i--) if (j.artifacts[i].delivered) return j.artifacts[i];
  return null;
}

/** can the human act on this revision now (Approve / Request Changes)? Only the latest delivered one, only while
 *  the job is waiting for that review. The source enforces the same rule; this keeps the buttons honest. */
export function reviewable(j: JobSnapshot, revisionId: string): boolean {
  const last = latestDelivered(j);
  return j.status === "ready" && !!last && last.revisionId === revisionId && j.artifacts.at(-1)?.revisionId === revisionId;
}

/** WHAT THE HUMAN SHOULD BE TOLD, if anything: the one signal a future notification service subscribes to.
 *  needs-input / needs-approval while a worker waits; ready once a revision is delivered for review. */
export type AttentionSignal = { jobId: string; kind: "needs-input" | "needs-approval" | "ready"; text: string; key: string };
export function attentionSignal(j: JobSnapshot): AttentionSignal | null {
  if (j.attention) {
    const who = nameOf(j.attention.from);
    return { jobId: j.jobId, kind: j.attention.kind, key: j.attention.requestId,
      text: j.attention.kind === "needs-approval" ? `Toucan: ${who} needs your approval — ${j.attention.prompt}` : `Toucan: ${who} needs your input — ${j.attention.prompt}` };
  }
  // ready = the NEWEST revision is in the human's hands (not an older one while the next is still on its way)
  const last = latestDelivered(j);
  if (last && reviewable(j, last.revisionId)) {
    return { jobId: j.jobId, kind: "ready", key: last.revisionId,
      text: last.revision > 1 ? `Toucan: Revision ${last.revision} of ${j.title} is ready when you are.` : `Toucan: The team finished ${j.title}. It's ready when you are.` };
  }
  return null;
}

/** is this a record the scene has nothing to show for (direct conversation with the human)? */
export function conversationOnly(e: OrchestrationEvent): boolean {
  return e.type === "message" && e.kind === "chat";
}
