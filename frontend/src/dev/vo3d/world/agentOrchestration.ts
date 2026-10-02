// vo3d world — THE ORCHESTRATION CONTRACT. Pure types, no THREE, no timers, no React.
//
// THIS IS THE SEAM between VO and whatever EXECUTES a job. Everything that DECIDES what happens to a job (who it
// is delegated to, what each agent is doing, what they say, when a revision is ready, what the human approved)
// arrives as one of these events, wrapped in an ordered JobRecord, from an OrchestrationSource. Everything that
// SHOWS it consumes the records:
//   world/jobStore      JobStore (the client-side projection: current truth per job) + JobClient (the facade the
//                       UI, the presenter and a future mobile client use: commands out, records in, reconnect)
//   app/labWorkforce    the physical presenter in the V2 Lab (Toucan, MonkeyAgents, stations, packet, camera)
//   app/AiLabTaskChat   the task conversation · app/AiLabResultPreview the result, Approve / Request Changes
//
// Today the only source is world/agentOrchestrationMock.ts (a scripted, tick-driven "backend": the ONLY place a
// timer decides anything). When Agent Harness is connected, an adapter implementing OrchestrationSource replaces
// it and nothing downstream changes — see AGENT_HARNESS_SEAM.md beside this folder.
import type { AgentExecState } from "./monkeyAgentContract";

/** who can speak or hold work: the human requester, the orchestrator, or an agent identity id */
export type Speaker = "user" | "toucan" | string;

/** how a message reaches people:
 *   speech — said aloud at that moment of the work (an in-world bubble when the speaker can be seen)
 *   note   — a written progress update in the job's thread, at that point of the work (never a bubble)
 *   chat   — direct conversation with the human (their own messages and the replies), independent of the scene */
export type MessageKind = "speech" | "note" | "chat";

export type OrchestrationEvent =
  /** a request entered the system */
  | { type: "job.created"; jobId: string; title: string; requestedBy: string; command: string }
  /** the orchestrator took it (Toucan is now responsible) */
  | { type: "job.accepted"; jobId: string }
  /** the orchestrator is handing it (or a revision of it) to a team at a place */
  | { type: "job.dispatched"; jobId: string; location: "ai-lab"; team: readonly string[]; revision: number }
  /** something said or written — to the requester, to the whole team, or to one participant. `messageId` is the
   *  message's stable identity: the conversation, the bubble and any later reference all mean this one record. */
  | { type: "message"; jobId: string; messageId: string; kind: MessageKind; from: Speaker; to: "user" | "team" | string; text: string }
  /** a runtime assignment (role) — never an identity change */
  | { type: "agent.assigned"; jobId: string; agentId: string; role: string }
  /** an agent's execution state — the ONLY truth about whether it is working */
  | { type: "agent.state"; jobId: string; agentId: string; state: AgentExecState }
  /** responsibility for the job's work moved (user → toucan with feedback, toucan → agent, agent → agent).
   *  The ONLY truth about who holds the work — the physical packet follows it, never the other way round. */
  | { type: "work.handoff"; jobId: string; from: Speaker; to: Speaker }
  /** the work became a deliverable — ONE revision of the job's artifact. `artifactId` is the job's artifact (stable
   *  across revisions); `revisionId` is this revision's own stable identity (a future backend's artifact
   *  reference). `result` is the content when the source has it inline; otherwise JobClient.artifact() fetches it. */
  | { type: "artifact.ready"; jobId: string; artifactId: string; revisionId: string; revision: number; title: string; by: string; result?: ArtifactResult }
  /** the orchestrator took the deliverable from where it was left, to bring it to the requester */
  | { type: "artifact.collected"; jobId: string; artifactId: string; revisionId: string; by: "toucan" }
  /** the deliverable reached the requester */
  | { type: "artifact.delivered"; jobId: string; artifactId: string; revisionId: string; to: "user" }
  /** this revision of the job reached its outcome (the human now reviews it) */
  | { type: "job.completed"; jobId: string; outcome: "ready-for-review" | "failed" }
  /** the human asked for changes: the SAME job continues as `revision`, built on `basedOn` */
  | { type: "revision.requested"; jobId: string; revision: number; basedOn: string; feedback: string; by: "user" }
  /** the human approved a revision: the job is done */
  | { type: "job.approved"; jobId: string; revisionId: string; by: "user" }
  /** a worker (or the orchestrator) is waiting for the human. Work does not continue until it is resolved.
   *  `action` names what an approval GUARDS (e.g. "Deploy Revision 2"): it is performed only if approved. */
  | { type: "attention.requested"; jobId: string; requestId: string; from: Speaker; kind: "needs-input" | "needs-approval"; prompt: string; action?: string }
  /** the human answered — once per request. A declined approval means the guarded action is NOT performed: the
   *  source must not continue down the path that needed it (it halts or reroutes, and says so in later records). */
  | { type: "attention.resolved"; jobId: string; requestId: string; response: AttentionResponse }
  /** this revision stopped without a result (e.g. its guarded action was declined). Nothing it was blocked on was
   *  done. The job goes back to the human on its latest delivered revision (or, with none, to "halted"). */
  | { type: "revision.halted"; jobId: string; revision: number; reason: "approval-declined" | "cancelled" | "failed"; requestId?: string };

export type AttentionResponse = { kind: "input"; text: string } | { kind: "approval"; approved: boolean; note?: string };

/** ONE ORDERED RECORD of a job's history. `seq` is per job, gapless, starting at 1 — what makes replay, reconnect
 *  and de-duplication exact. `at` is when it happened (epoch ms), as the source reports it. */
export type JobRecord = { seq: number; at: number; event: OrchestrationEvent };

// ---- THE RESULT PAYLOAD ------------------------------------------------------------------------------------
/** What a finished revision hands the human. Pure data: the delivery UI renders ANY payload of this shape, so a
 *  real Agent Harness artifact replaces the mock one without the UI changing. `source` is always shown — a mock
 *  result is never presented as real execution. */
export type ArtifactResult = {
  artifactId: string;
  /** this revision's stable identity (the same id the events carry) */
  revisionId: string;
  revision: number;
  /** the revision this one revised (absent on Revision 1) */
  basedOn?: string;
  /** the human feedback this revision answers (absent on Revision 1) */
  feedback?: string;
  /** what changed from `basedOn`, one line each (absent on Revision 1) */
  changes?: readonly string[];
  title: string;
  requestedBy: string;
  source: OrchestrationSource["kind"];
  /** one line on what this is */
  summary: string;
  /** who did what, in order — every stage this revision passed through */
  stages: readonly { role: string; by: string; outcome: "completed" | "passed"; note: string }[];
  deliverable: LandingPageDeliverable;
};
/** today's one deliverable kind: a prepared landing page (more kinds join this union later) */
export type LandingPageDeliverable = {
  kind: "landing-page";
  brand: string;
  nav: readonly string[];
  hero: { eyebrow: string; headline: string; subhead: string; primaryCta: string; secondaryCta: string };
  /** how loudly the primary call to action is drawn */
  ctaStyle?: "standard" | "bold";
  features: readonly { title: string; body: string }[];
  proof: string;
  palette: { bg: string; surface: string; ink: string; muted: string; accent: string; accentInk: string };
  checks: readonly string[];
};

// ---- HUMAN → JOB -------------------------------------------------------------------------------------------
/** A request the human makes. The demo has one, with a predefined payload (no Meeting Intelligence yet). */
export type DemoCommand = { text: string; requestedBy: string; title: string };

/** Everything a human can ask of the job system — from desktop VO, a phone, or anything else. None of them
 *  needs the 3D office: they go to the source, and their effects come back as records like everything else. */
export type JobCommand =
  | { type: "submit"; request: DemoCommand }
  | { type: "message"; jobId: string; text: string }
  | { type: "approve"; jobId: string; revisionId: string }
  | { type: "request-revision"; jobId: string; revisionId: string; feedback: string }
  | { type: "respond"; jobId: string; requestId: string; response: AttentionResponse };

/** the source's answer to a command: accepted (its effects follow as records) or refused, with why */
export type JobCommandResult = { ok: true; jobId: string } | { ok: false; jobId?: string; error: string };

/** what a client needs to rebuild a job after reconnecting: an optional snapshot (the source's own compaction)
 *  plus every record after it, in order. Either part may be empty; together they are the whole truth so far. */
export type JobHistory<Snapshot = unknown> = { jobId: string; snapshot: Snapshot | null; records: readonly JobRecord[] };

export type RecordListener = (r: JobRecord) => void;

/** WHAT VO NEEDS FROM ANY EXECUTION BACKEND, mock or real. Transport (HTTP, WebSocket, SSE, polling) is the
 *  implementation's business; VO only sees ordered records and command results. */
export interface OrchestrationSource {
  readonly kind: "mock" | "agent-harness";
  /** live records for every job this client can see, in order per job (an adapter may poll or stream) */
  subscribe(fn: RecordListener): () => void;
  /** human → job. Resolves once the source has accepted or refused it; its effects arrive as records. */
  send(cmd: JobCommand): Promise<JobCommandResult>;
  /** the jobs this client can reconnect to, most recent first */
  jobs(): Promise<readonly string[]>;
  /** a job's truth so far: snapshot + every record after `afterSeq` (0 = from the start) */
  history(jobId: string, afterSeq?: number): Promise<JobHistory>;
  /** one revision's content, for a record that carried only its reference */
  artifact(revisionId: string): Promise<ArtifactResult | null>;
  /** DEMO RESET ONLY: forget every job (the mock's in-memory "backend"). A real adapter detaches; it never
   *  cancels server-side work because a page was reset or closed. */
  cancel(): void;
  /** advance by real seconds — a real backend ignores this; the mock is driven by it */
  tick(dt: number): void;
}

export const DEMO_COMMAND: DemoCommand = {
  text: "Toucan, handle what Alex asked us to build.",
  requestedBy: "Alex",
  title: "Landing page refresh for Alex",
};

/** the example the Request Changes field offers (the demo's scripted revision) */
export const DEMO_FEEDBACK = "The hero feels too corporate. Make it more playful and give the CTA more emphasis.";
