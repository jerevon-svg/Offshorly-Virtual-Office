// vo3d world — THE ORCHESTRATION EVENT CONTRACT. Pure types, no THREE, no timers.
//
// THIS IS THE SEAM. Everything that DECIDES what happens to a job (who it is delegated to, what each agent
// is doing, what they say, when it is finished) arrives as one of these events from an
// OrchestrationSource. Everything that SHOWS it (the toucan's flight, speech bubbles, the agents' pills,
// clips, faces and work layers, the camera) consumes them — app/labWorkforce.ts in the V2 Lab, app/aiLabDemo.ts in
// the V1 hall.
//
// Today the only source is world/agentOrchestrationMock.ts (a scripted, tick-driven timeline: the ONLY
// place timers decide anything). When Agent Harness is connected, an adapter that turns its events into
// these replaces the mock and nothing downstream changes.
import type { AgentExecState } from "./monkeyAgentContract";

/** who can speak: the orchestrator or an agent identity id */
export type Speaker = "toucan" | string;

export type OrchestrationEvent =
  /** a request entered the system */
  | { type: "job.created"; jobId: string; title: string; requestedBy: string; command: string }
  /** the orchestrator took it (Toucan is now responsible) */
  | { type: "job.accepted"; jobId: string }
  /** the orchestrator is handing it to a team at a place */
  | { type: "job.dispatched"; jobId: string; location: "ai-lab"; team: readonly string[] }
  /** something said — to the requester, to the whole team, or to one agent */
  | { type: "message"; jobId: string; from: Speaker; to: "user" | "team" | string; text: string }
  /** a runtime assignment (role) — never an identity change */
  | { type: "agent.assigned"; jobId: string; agentId: string; role: string }
  /** an agent's execution state — the ONLY truth about whether it is working */
  | { type: "agent.state"; jobId: string; agentId: string; state: AgentExecState }
  /** responsibility for the job's work moved: from the orchestrator ("toucan") or one agent, to another agent.
   *  The ONLY truth about who holds the work — the physical packet follows it, never the other way round. */
  | { type: "work.handoff"; jobId: string; from: Speaker; to: string }
  /** the job's work became a deliverable, held by the agent that produced it, ready for the human. `result` is the
   *  deliverable itself — what the human inspects (app/AiLabResultPreview renders it, whatever produced it) */
  | { type: "artifact.ready"; jobId: string; artifactId: string; title: string; by: string; result: ArtifactResult }
  /** the orchestrator took the deliverable from where it was left, to bring it to the requester */
  | { type: "artifact.collected"; jobId: string; artifactId: string; by: "toucan" }
  /** the deliverable reached the requester */
  | { type: "artifact.delivered"; jobId: string; artifactId: string; to: "user" }
  /** the job reached its outcome */
  | { type: "job.completed"; jobId: string; outcome: "ready-for-review" | "failed" };

// ---- THE RESULT PAYLOAD ------------------------------------------------------------------------------------
/** What a finished job hands the human. Pure data: the delivery UI renders ANY payload of this shape, so a real
 *  Agent Harness artifact replaces the mock one without the UI changing. `source` is always shown — a mock result
 *  is never presented as real execution. */
export type ArtifactResult = {
  artifactId: string;
  title: string;
  requestedBy: string;
  source: OrchestrationSource["kind"];
  /** one line on what this is */
  summary: string;
  /** who did what, in order — every stage the job passed through */
  stages: readonly { role: string; by: string; outcome: "completed" | "passed"; note: string }[];
  deliverable: LandingPageDeliverable;
};
/** today's one deliverable kind: a prepared landing page (more kinds join this union later) */
export type LandingPageDeliverable = {
  kind: "landing-page";
  brand: string;
  nav: readonly string[];
  hero: { eyebrow: string; headline: string; subhead: string; primaryCta: string; secondaryCta: string };
  features: readonly { title: string; body: string }[];
  proof: string;
  palette: { bg: string; surface: string; ink: string; muted: string; accent: string; accentInk: string };
  checks: readonly string[];
};

export type OrchestrationListener = (e: OrchestrationEvent) => void;

/** What the visual layer needs from any orchestration backend, mock or real. */
export interface OrchestrationSource {
  readonly kind: "mock" | "agent-harness";
  subscribe(fn: OrchestrationListener): () => void;
  /** submit a command; resolves to the job id the events will carry */
  submit(command: DemoCommand): string;
  /** abandon whatever is running (a reset, or the world going away) */
  cancel(): void;
  /** advance by real seconds — a real backend ignores this; the mock is driven by it */
  tick(dt: number): void;
}

/** A user command. The demo has exactly one, with a predefined payload (no Meeting Intelligence yet). */
export type DemoCommand = { text: string; requestedBy: string; title: string };

export const DEMO_COMMAND: DemoCommand = {
  text: "Toucan, handle what Alex asked us to build.",
  requestedBy: "Alex",
  title: "Landing page refresh for Alex",
};
