// vo3d world — THE MOCK ORCHESTRATION SOURCE (Wednesday demo). Stands in for Agent Harness.
//
// MOCK BOUNDARY: this file is the ONLY place in the AI-workforce path where a timer decides anything.
// It plays one scripted job as a deterministic timeline of contract events (world/agentOrchestration.ts),
// driven by tick(dt) from the world's frame loop — so it is pausable, testable without fake timers, and
// identical every run. Nothing here touches THREE, the toucan, the agents or the camera: the visual layer
// (app/aiLabDemo.ts) consumes the events and decides how they look and how fast they are shown.
//
// Replacing it: an Agent Harness adapter implements the same OrchestrationSource and emits the same events.
import type { ArtifactResult, DemoCommand, OrchestrationEvent, OrchestrationListener, OrchestrationSource } from "./agentOrchestration";

/** One scripted step: emitted `after` seconds after the previous one. */
type Step = { after: number; event: (jobId: string) => OrchestrationEvent };

/** Mock work durations (seconds) — what a real backend would report as it happens. */
export const MOCK_WORK_S = { nova: 4.5, milo: 5, pip: 4 } as const;
/** Allowance between dispatch and the first team message: the real orchestrator would be "travelling"
 *  too (spinning agents up). The visual layer additionally waits for the bird to land and the team to
 *  gather, whichever is later. */
export const MOCK_DISPATCH_S = 8;

const say = (from: string, to: string, text: string) => (jobId: string): OrchestrationEvent => ({ type: "message", jobId, from, to, text });
const assign = (agentId: string, role: string) => (jobId: string): OrchestrationEvent => ({ type: "agent.assigned", jobId, agentId, role });
const state = (agentId: string, s: Extract<OrchestrationEvent, { type: "agent.state" }>["state"]) =>
  (jobId: string): OrchestrationEvent => ({ type: "agent.state", jobId, agentId, state: s });
const handoff = (from: string, to: string) => (jobId: string): OrchestrationEvent => ({ type: "work.handoff", jobId, from, to });

/** THE MOCK DELIVERABLE: a prepared landing page, as data. Nothing generated it — it is the demo's stand-in for what
 *  Agent Harness will return, and it says so (`source: "mock"`). */
export function mockLandingPageResult(cmd: DemoCommand, jobId: string): ArtifactResult {
  return {
    artifactId: `${jobId}-artifact`,
    title: cmd.title,
    requestedBy: cmd.requestedBy,
    source: "mock",
    summary: "A refreshed landing page: new hero, three feature blocks and a clear call to action.",
    stages: [
      { role: "Design", by: "Nova", outcome: "completed", note: "Visual direction, layout and palette" },
      { role: "Build", by: "Milo", outcome: "completed", note: "Responsive page from the design" },
      { role: "Review", by: "Pip", outcome: "passed", note: "Layout, copy and accessibility checks" },
    ],
    deliverable: {
      kind: "landing-page",
      brand: "Offshorly",
      nav: ["Services", "Work", "About", "Contact"],
      hero: {
        eyebrow: "Remote teams, done right",
        headline: "Build your dream team, offshore.",
        subhead: "Hand-picked specialists who work like they sit next to you.",
        primaryCta: "Book a call",
        secondaryCta: "See our work",
      },
      features: [
        { title: "Vetted talent", body: "Top 3% of applicants" },
        { title: "Fast start", body: "Teams in two weeks" },
        { title: "One partner", body: "Hiring to payroll" },
      ],
      proof: "Trusted by 120+ growing companies",
      palette: { bg: "#fdfcfa", surface: "#f3efe6", ink: "#241f30", muted: "#6c6577", accent: "#f2b134", accentInk: "#241f30" },
      checks: ["Responsive at 3 breakpoints", "Contrast AA", "Copy proofread"],
    },
  };
}

/** THE ONE SCRIPTED JOB. Every line fits the overhead bubble (three lines of ~11 characters — Vo3dOverheads'
 *  7.6em clamp): a bubble is read in passing, never studied, and is never cut off with an ellipsis. The
 *  spacing is the source's — the presenter shows each event no sooner than this, later only while the
 *  scene physically catches up (a flight, a walk, a handoff). */
export function demoScript(cmd: DemoCommand): Step[] {
  return [
    { after: 0, event: (jobId) => ({ type: "job.created", jobId, title: cmd.title, requestedBy: cmd.requestedBy, command: cmd.text }) },
    { after: 0.4, event: (jobId) => ({ type: "job.accepted", jobId }) },
    { after: 0.2, event: say("toucan", "user", "Got it. Taking it to the Lab.") },
    { after: 2.6, event: (jobId) => ({ type: "job.dispatched", jobId, location: "ai-lab", team: ["nova", "milo", "pip"] }) },
    // THE BRIEFING
    { after: MOCK_DISPATCH_S, event: say("toucan", "team", "Alex wants a new landing page.") },
    { after: 2.2, event: say("toucan", "team", "Nova designs. Milo builds.") },
    { after: 2, event: say("toucan", "team", "Pip reviews it.") },
    { after: 1.8, event: assign("nova", "Design") },
    { after: 0.1, event: state("nova", "assigned") },
    { after: 0.2, event: handoff("toucan", "nova") },
    { after: 0.2, event: say("nova", "toucan", "On it.") },
    // DESIGN
    { after: 1.5, event: state("nova", "working") },
    { after: MOCK_WORK_S.nova, event: state("nova", "done") },
    { after: 0.6, event: assign("milo", "Dev") },
    { after: 0.1, event: state("milo", "assigned") },
    { after: 0.2, event: handoff("nova", "milo") },
    { after: 0.2, event: say("nova", "milo", "Direction's ready. All yours.") },
    { after: 2.2, event: say("milo", "nova", "Thanks. Building it now.") },
    { after: 1.8, event: state("nova", "idle") },
    // BUILD
    { after: 0.4, event: state("milo", "working") },
    { after: MOCK_WORK_S.milo, event: state("milo", "done") },
    { after: 0.6, event: assign("pip", "Review") },
    { after: 0.1, event: state("pip", "assigned") },
    { after: 0.2, event: handoff("milo", "pip") },
    { after: 0.2, event: say("milo", "pip", "Build's ready for review.") },
    { after: 2.2, event: say("pip", "milo", "I'll check it.") },
    { after: 1.6, event: state("milo", "idle") },
    // REVIEW
    { after: 0.4, event: state("pip", "reviewing") },
    { after: MOCK_WORK_S.pip, event: state("pip", "done") },
    { after: 0.6, event: (jobId) => ({ type: "artifact.ready", jobId, artifactId: `${jobId}-artifact`, title: cmd.title, by: "pip", result: mockLandingPageResult(cmd, jobId) }) },
    { after: 0.4, event: say("pip", "toucan", "Review passed. It's ready.") },
    { after: 2.4, event: say("toucan", "team", "Great work, team.") },
    { after: 1.6, event: state("pip", "idle") },
    // THE ORCHESTRATOR TAKES THE RESULT TO THE HUMAN: the same packet, from the gallery
    { after: 0.4, event: (jobId) => ({ type: "artifact.collected", jobId, artifactId: `${jobId}-artifact`, by: "toucan" }) },
    { after: 0.4, event: (jobId) => ({ type: "job.completed", jobId, outcome: "ready-for-review" }) },
    // BACK WITH THE HUMAN (shown once the bird has flown all the way back)
    { after: 0.5, event: say("toucan", "user", "The team finished.") },
    { after: 2, event: (jobId) => ({ type: "artifact.delivered", jobId, artifactId: `${jobId}-artifact`, to: "user" }) },
    { after: 0.4, event: say("toucan", "user", "Here's your landing page.") },
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
