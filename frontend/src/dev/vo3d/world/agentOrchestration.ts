// vo3d world — THE ORCHESTRATION EVENT CONTRACT. Pure types, no THREE, no timers.
//
// THIS IS THE SEAM. Everything that DECIDES what happens to a job (who it is delegated to, what each agent
// is doing, what they say, when it is finished) arrives as one of these events from an
// OrchestrationSource. Everything that SHOWS it (the toucan's flight, speech bubbles, the agents' pills,
// clips, faces and work layers, the camera) consumes them — see app/aiLabDemo.ts.
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
  /** the job reached its outcome */
  | { type: "job.completed"; jobId: string; outcome: "ready-for-review" | "failed" };

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
