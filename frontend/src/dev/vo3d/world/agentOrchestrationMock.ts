// vo3d world — THE MOCK ORCHESTRATION SOURCE (Wednesday demo). Stands in for Agent Harness.
//
// MOCK BOUNDARY: this file is the ONLY place in the AI-workforce path where a timer decides anything.
// It plays one scripted job as a deterministic timeline of contract events (world/agentOrchestration.ts),
// driven by tick(dt) from the world's frame loop — so it is pausable, testable without fake timers, and
// identical every run. Nothing here touches THREE, the toucan, the agents or the camera: the visual layer
// (app/aiLabDemo.ts) consumes the events and decides how they look and how fast they are shown.
//
// Replacing it: an Agent Harness adapter implements the same OrchestrationSource and emits the same events.
import type { DemoCommand, OrchestrationEvent, OrchestrationListener, OrchestrationSource } from "./agentOrchestration";

/** One scripted step: emitted `after` seconds after the previous one. */
type Step = { after: number; event: (jobId: string) => OrchestrationEvent };

/** Mock work durations (seconds) — what a real backend would report as it happens. */
export const MOCK_WORK_S = { nova: 7, milo: 8, pip: 6 } as const;
/** Allowance between dispatch and the first team message: the real orchestrator would be "travelling"
 *  too (spinning agents up). The visual layer additionally waits for the bird to land, whichever is later. */
export const MOCK_DISPATCH_S = 14;

const say = (from: string, to: string, text: string) => (jobId: string): OrchestrationEvent => ({ type: "message", jobId, from, to, text });
const assign = (agentId: string, role: string) => (jobId: string): OrchestrationEvent => ({ type: "agent.assigned", jobId, agentId, role });
const state = (agentId: string, s: Extract<OrchestrationEvent, { type: "agent.state" }>["state"]) =>
  (jobId: string): OrchestrationEvent => ({ type: "agent.state", jobId, agentId, state: s });

export function demoScript(cmd: DemoCommand): Step[] {
  return [
    { after: 0, event: (jobId) => ({ type: "job.created", jobId, title: cmd.title, requestedBy: cmd.requestedBy, command: cmd.text }) },
    { after: 0.4, event: (jobId) => ({ type: "job.accepted", jobId }) },
    { after: 0.2, event: say("toucan", "user", "Got it. I'll organize the team.") },
    { after: 3, event: (jobId) => ({ type: "job.dispatched", jobId, location: "ai-lab", team: ["nova", "milo", "pip"] }) },
    { after: MOCK_DISPATCH_S, event: say("toucan", "team", "Team, we have a new request. Nova, prepare the visual direction.") },
    { after: 0.2, event: assign("nova", "Design") },
    { after: 0.1, event: state("nova", "assigned") },
    { after: 3.4, event: say("nova", "toucan", "Got it. I'll start with the direction and references.") },
    { after: 3, event: state("nova", "working") },
    { after: MOCK_WORK_S.nova, event: state("nova", "done") },
    { after: 0.6, event: say("nova", "milo", "Direction is ready. Milo, passing it to you.") },
    { after: 3.4, event: assign("milo", "Dev") },
    { after: 0.1, event: state("milo", "assigned") },
    { after: 0.1, event: say("milo", "nova", "Got it. Building the first version.") },
    { after: 3, event: state("milo", "working") },
    { after: MOCK_WORK_S.milo, event: state("milo", "done") },
    { after: 0.6, event: say("milo", "pip", "Build is ready for review.") },
    { after: 3, event: assign("pip", "Review") },
    { after: 0.1, event: state("pip", "assigned") },
    { after: 0.1, event: say("pip", "milo", "I'll check it.") },
    { after: 2.6, event: state("pip", "reviewing") },
    { after: MOCK_WORK_S.pip, event: state("pip", "done") },
    { after: 0.6, event: say("pip", "toucan", "Review passed. Everything looks ready.") },
    { after: 3.4, event: say("toucan", "team", "Great. I'll take it from here.") },
    { after: 3, event: (jobId) => ({ type: "job.completed", jobId, outcome: "ready-for-review" }) },
  ];
}

export class MockOrchestrationSource implements OrchestrationSource {
  readonly kind = "mock" as const;
  private listeners = new Set<OrchestrationListener>();
  private steps: Step[] = [];
  private jobId: string | null = null;
  private wait = 0;
  private seq = 0;

  subscribe(fn: OrchestrationListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  submit(cmd: DemoCommand): string {
    this.cancel();
    this.jobId = `mock-job-${++this.seq}`;
    this.steps = demoScript(cmd);
    this.wait = this.steps[0].after;
    this.tick(0); // job.created is immediate
    return this.jobId;
  }

  cancel(): void {
    this.steps = [];
    this.jobId = null;
  }

  get running(): boolean { return this.jobId !== null && this.steps.length > 0; }

  tick(dt: number): void {
    if (!this.jobId) return;
    this.wait -= dt;
    while (this.jobId && this.steps.length > 0 && this.wait <= 0) {
      const step = this.steps.shift()!;
      const e = step.event(this.jobId);
      for (const fn of this.listeners) fn(e);
      if (this.steps.length > 0) this.wait += this.steps[0].after;
    }
    if (this.steps.length === 0) this.jobId = null;
  }
}
