// vo3d world — THE MOCK ORCHESTRATION SOURCE. Stands in for Agent Harness (and for the persistent server behind it).
//
// MOCK BOUNDARY: this file is the ONLY place in the AI-workforce path where a timer decides anything. It plays
// scripted jobs as deterministic timelines of contract records (world/agentOrchestration.ts), driven by tick(dt)
// from the world's frame loop — pausable, testable without fake timers, identical every run. It keeps every job's
// history like a backend would (history(), jobs(), artifact()), validates commands against the job's own truth
// (world/agentJob projectJob — the same reducer the client uses), and decides REVISION ROUTING itself.
//
// It is IN-MEMORY: it lives and dies with this page. Closing VO stops it — that is the mock's limit, not the
// model's. A real backend keeps running; the client reconnects with JobClient.reconnect().
//
// Nothing here touches THREE, the toucan, the agents, React or the camera.
import type { AgentExecState } from "./monkeyAgentContract";
import type {
  ArtifactResult, DemoCommand, JobCommand, JobCommandResult, JobHistory, JobRecord, MessageKind, OrchestrationEvent, OrchestrationSource, RecordListener,
} from "./agentOrchestration";
import { latestDelivered, nameOf, projectJob, reviewable, type JobSnapshot } from "./agentJob";

/** Mock work durations (seconds) — what a real backend would report as it happens. */
export const MOCK_WORK_S = { nova: 4.5, milo: 5, pip: 4 } as const;
/** Allowance between dispatch and the first Lab message: the real orchestrator would be "travelling" too (spinning
 *  agents up). The visual layer additionally waits for the bird to land and the team to gather. */
export const MOCK_DISPATCH_S = 8;

// ---- the capabilities the mock can route work through --------------------------------------------------------
export type StageId = "design" | "build" | "review";
type StageDef = { agent: string; role: string; work: AgentExecState; dur: number; release: number; label: string };
const STAGES: Record<StageId, StageDef> = {
  design: { agent: "nova", role: "Design", work: "working", dur: MOCK_WORK_S.nova, release: 1.8, label: "Design" },
  build: { agent: "milo", role: "Dev", work: "working", dur: MOCK_WORK_S.milo, release: 1.6, label: "Build" },
  review: { agent: "pip", role: "Review", work: "reviewing", dur: MOCK_WORK_S.pip, release: 1.6, label: "Review" },
};
/** what the giver and the receiver say at a handoff (≤32 characters: the overhead bubble's three lines) */
const PAIR_LINES: Record<string, { first: readonly [string, string]; again: readonly [string, string] }> = {
  "nova>milo": { first: ["Direction's ready. All yours.", "Thanks. Building it now."], again: ["Design's ready. Handing it over.", "Updating the build."] },
  "milo>pip": { first: ["Build's ready for review.", "I'll check it."], again: ["Update's ready for review.", "Checking it now."] },
};
const LAST_LINE: Record<StageId, string> = { design: "Copy's updated. It's ready.", build: "Build's updated. It's ready.", review: "Review passed. It's ready." };

/** THE MOCK'S ROUTING DECISION for a revision: which capabilities need another pass. A keyword heuristic — the
 *  stand-in for the orchestrator's judgment. The presenter never assumes the answer. */
export type RevisionPlan = { stages: readonly StageId[]; approvalAfter?: StageId };
export function planRevision(feedback: string): RevisionPlan {
  const bug = /\b(bug|broken|crash|error|doesn'?t work|not working|404|link)/i.test(feedback);
  const visual = /\b(playful|colou?r|palette|layout|visual|design|hero|cta|button|font|style|corporate|bold|image|spacing)/i.test(feedback);
  const copy = /\b(copy|wording|typo|text|headline|tagline|spelling)/i.test(feedback);
  const deploy = /\b(deploy|publish|go live|ship it)/i.test(feedback);
  const stages: StageId[] = bug && !visual ? ["build", "review"] : copy && !visual ? ["design"] : ["design", "build", "review"];
  return deploy && stages.includes("build") ? { stages, approvalAfter: "build" } : { stages };
}

/** THE MOCK DELIVERABLE, Revision 1: a prepared landing page, as data. Nothing generated it — it is the demo's
 *  stand-in for what Agent Harness will return, and it says so (`source: "mock"`). */
export function mockLandingPageResult(cmd: DemoCommand, jobId: string): ArtifactResult {
  const artifactId = `${jobId}-artifact`;
  return {
    artifactId, revisionId: `${artifactId}-r1`, revision: 1,
    title: cmd.title, requestedBy: cmd.requestedBy, source: "mock",
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
      ctaStyle: "standard",
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

/** THE MOCK REVISION: the previous revision, changed the way the feedback asks (deterministically). A new
 *  revisionId; the previous revision is never touched. */
export function reviseResult(prev: ArtifactResult, feedback: string, plan: RevisionPlan, revision: number): ArtifactResult {
  const d = prev.deliverable;
  const playful = /\b(playful|fun|friendly|warm|corporate)/i.test(feedback);
  const cta = /\b(cta|call to action|button)/i.test(feedback);
  const changes: string[] = [];
  let hero = { ...d.hero }, palette = { ...d.palette }, ctaStyle = d.ctaStyle ?? "standard", checks = [...d.checks];
  if (plan.stages.includes("design")) {
    if (playful) {
      hero = { ...hero, eyebrow: "Remote teams, minus the stiffness", headline: "Your dream team, just a wave away.", subhead: "Friendly specialists who feel like the desk next door." };
      palette = { bg: "#fff8f1", surface: "#ffe9d6", ink: "#2b1d3a", muted: "#7a6585", accent: "#ff6b5a", accentInk: "#ffffff" };
      changes.push("Warmer, more playful palette and hero copy");
    } else if (/\b(copy|wording|typo|text|headline|tagline)/i.test(feedback)) {
      hero = { ...hero, headline: "Build your dream team — offshore.", subhead: "Hand-picked specialists who work like they're right beside you." };
      changes.push("Hero copy rewritten");
    }
    if (cta) { hero = { ...hero, primaryCta: "Book a free call →" }; ctaStyle = "bold"; changes.push("Bigger, bolder primary call to action"); }
    if (changes.length === 0) changes.push("Design pass on the feedback");
  }
  if (plan.stages.includes("build") && !plan.stages.includes("design")) { changes.push("Build fix applied"); checks = [...checks.filter((c) => !c.startsWith("Fixed")), "Fixed: reported issue"]; }
  if (plan.stages.includes("review")) checks = [...new Set([...checks, playful ? "Contrast AA on new palette" : "Regression check"])];
  const by = (s: StageId) => nameOf(STAGES[s].agent);
  return {
    ...prev,
    revisionId: `${prev.artifactId}-r${revision}`, revision, basedOn: prev.revisionId, feedback, changes,
    summary: `Revision ${revision}: ${changes.join("; ").toLowerCase()}.`,
    stages: plan.stages.map((s) => ({
      role: STAGES[s].label, by: by(s), outcome: s === "review" ? "passed" as const : "completed" as const,
      note: s === "design" ? "Revised to the feedback" : s === "build" ? "Build updated" : "Re-reviewed",
    })),
    deliverable: { ...d, hero, palette, ctaStyle, checks },
  };
}

/** one written progress update per stage (a "note": the thread, never a bubble) */
function stageNote(s: StageId, revision: number, result: ArtifactResult): string {
  if (revision === 1) {
    return s === "design" ? "Direction: warm and confident — a big hero, three feature blocks, one clear call to action."
      : s === "build" ? "Building it responsive at three breakpoints; hero, features and CTA wired up."
      : "Checked layout at three breakpoints, contrast AA and the copy. All good.";
  }
  const ch = (result.changes ?? []).join("; ").toLowerCase();
  return s === "design" ? `Revision ${revision} design: ${ch}.` : s === "build" ? `Rebuilt with the Revision ${revision} changes.` : `Re-reviewed Revision ${revision}: ${result.deliverable.checks.at(-1)?.toLowerCase() ?? "all good"}.`;
}

// ---- the script ---------------------------------------------------------------------------------------------
type Make = (jobId: string, mid: () => string) => OrchestrationEvent;
/** One scripted step: emitted `after` seconds after the previous one. `block` holds the timeline at this step
 *  until the human answers that request (respond). */
type Step = { after: number; make?: Make; block?: string; onDecline?: Step[] };

const say = (kind: MessageKind, from: string, to: string, text: string): Make => (jobId, mid) => ({ type: "message", jobId, messageId: mid(), kind, from, to, text });
const assign = (agentId: string, role: string): Make => (jobId) => ({ type: "agent.assigned", jobId, agentId, role });
const state = (agentId: string, s: AgentExecState): Make => (jobId) => ({ type: "agent.state", jobId, agentId, state: s });
const handoff = (from: string, to: string): Make => (jobId) => ({ type: "work.handoff", jobId, from, to });

/** the work itself: each stage in the plan, the handoffs between them, the deliverable, the trip back */
function stagesScript(plan: RevisionPlan, revision: number, result: ArtifactResult, title: string): Step[] {
  const out: Step[] = [];
  const st = plan.stages.map((s) => ({ id: s, ...STAGES[s] }));
  const ref = { artifactId: result.artifactId, revisionId: result.revisionId };
  st.forEach((s, i) => {
    if (i === 0) {
      out.push({ after: 1.8, make: assign(s.agent, s.role) }, { after: 0.1, make: state(s.agent, "assigned") },
        { after: 0.2, make: handoff("toucan", s.agent) }, { after: 0.2, make: say("speech", s.agent, "toucan", "On it.") },
        { after: 1.5, make: state(s.agent, s.work) });
    }
    out.push({ after: 2, make: say("note", s.agent, "team", stageNote(s.id, revision, result)) }, { after: s.dur - 2, make: state(s.agent, "done") });
    if (plan.approvalAfter === s.id) {
      // THE GUARDED ACTION: deploying. Approved → it is done, then the revision carries on. Declined → it is NOT
      // done: the revision stops here and the job goes back to the human on what they already have.
      const req = `${result.revisionId}-approval`, action = `Deploy Revision ${revision}`;
      const declined: Step[] = [
        { after: 0.4, make: state(s.agent, "done") },
        { after: 0.3, make: say("speech", s.agent, "user", "Okay. Not deploying.") },
        { after: 0.2, make: say("note", "toucan", "team", `Deploy declined — Revision ${revision} stopped. Nothing was deployed.`) },
        { after: 0.6, make: handoff(s.agent, "toucan") },
        { after: 1.6, make: state(s.agent, "idle") },
        { after: 0.4, make: (jobId) => ({ type: "revision.halted", jobId, revision, reason: "approval-declined", requestId: req }) },
        { after: 0.5, make: say("speech", "toucan", "user", "Nothing was deployed.") },
        { after: 2, make: handoff("toucan", "user") },
        { after: 0.4, make: say("speech", "toucan", "user", `Revision ${revision - 1} still stands.`) },
      ];
      out.push(
        { after: 0.4, make: (jobId) => ({ type: "attention.requested", jobId, requestId: req, from: s.agent, kind: "needs-approval", prompt: "Ready to publish. Approve the deploy?", action }) },
        { after: 0, make: state(s.agent, "awaiting-approval") },
        { after: 0.2, make: say("speech", s.agent, "user", "Needs your OK to deploy.") },
        { after: 0, block: req, onDecline: declined },
        { after: 0.4, make: state(s.agent, "done") },
        { after: 0.3, make: say("note", s.agent, "team", `Deployed Revision ${revision} to staging.`) },
      );
    }
    const next = st[i + 1];
    if (next) {
      const lines = PAIR_LINES[`${s.agent}>${next.agent}`]?.[revision > 1 ? "again" : "first"] ?? ["Over to you.", "Got it."];
      out.push(
        { after: 0.6, make: assign(next.agent, next.role) }, { after: 0.1, make: state(next.agent, "assigned") },
        { after: 0.2, make: handoff(s.agent, next.agent) }, { after: 0.2, make: say("speech", s.agent, next.agent, lines[0]) },
        { after: 2.2, make: say("speech", next.agent, s.agent, lines[1]) }, { after: s.release, make: state(s.agent, "idle") },
        { after: 0.4, make: state(next.agent, next.work) },
      );
    } else {
      out.push(
        { after: 0.6, make: (jobId) => ({ type: "artifact.ready", jobId, ...ref, revision, title, by: s.agent, result }) },
        { after: 0.4, make: say("speech", s.agent, "toucan", LAST_LINE[s.id]) },
        { after: 2.4, make: say("speech", "toucan", "team", revision > 1 ? "Thanks, team." : "Great work, team.") },
        { after: s.release, make: state(s.agent, "idle") },
      );
    }
  });
  out.push(
    { after: 0.4, make: (jobId) => ({ type: "artifact.collected", jobId, ...ref, by: "toucan" }) },
    { after: 0.4, make: (jobId) => ({ type: "job.completed", jobId, outcome: "ready-for-review" }) },
    // back with the human (shown once the bird has flown all the way back)
    { after: 0.5, make: say("speech", "toucan", "user", revision > 1 ? `Revision ${revision} is ready.` : "The team finished.") },
    { after: 2, make: (jobId) => ({ type: "artifact.delivered", jobId, ...ref, to: "user" }) },
    { after: 0.4, make: say("speech", "toucan", "user", revision > 1 ? `Here's Revision ${revision}.` : "Here's your landing page.") },
  );
  return out;
}

/** THE ORIGINAL JOB. Every spoken line fits the overhead bubble (three lines of ~11 characters — Vo3dOverheads'
 *  7.6em clamp). The spacing is the source's — the presenter shows each record no sooner than this. */
export function demoScript(cmd: DemoCommand, jobId: string): Step[] {
  const result = mockLandingPageResult(cmd, jobId);
  return [
    { after: 0, make: (id) => ({ type: "job.created", jobId: id, title: cmd.title, requestedBy: cmd.requestedBy, command: cmd.text }) },
    { after: 0.4, make: (id) => ({ type: "job.accepted", jobId: id }) },
    { after: 0.2, make: say("speech", "toucan", "user", "Got it. Taking it to the Lab.") },
    { after: 2.6, make: (id) => ({ type: "job.dispatched", jobId: id, location: "ai-lab", team: ["nova", "milo", "pip"], revision: 1 }) },
    // THE BRIEFING
    { after: MOCK_DISPATCH_S, make: say("speech", "toucan", "team", "Alex wants a new landing page.") },
    { after: 2.2, make: say("speech", "toucan", "team", "Nova designs. Milo builds.") },
    { after: 2, make: say("speech", "toucan", "team", "Pip reviews it.") },
    ...stagesScript({ stages: ["design", "build", "review"] }, 1, result, cmd.title),
  ];
}

/** A REVISION OF THE SAME JOB: the human's feedback, routed to the capabilities the plan names */
export function revisionScript(prev: ArtifactResult, feedback: string, revision: number, title: string): Step[] {
  const plan = planRevision(feedback);
  const result = reviseResult(prev, feedback, plan, revision);
  const first = STAGES[plan.stages[0]].agent;
  const route = plan.stages.map((s) => STAGES[s].label).join(" → ");
  return [
    { after: 0, make: say("chat", "user", "toucan", feedback) },
    { after: 0, make: (jobId) => ({ type: "revision.requested", jobId, revision, basedOn: prev.revisionId, feedback, by: "user" }) },
    { after: 0.3, make: say("speech", "toucan", "user", "Got it. Back to the team.") },
    // the work goes back into the bird's care, feedback and all
    { after: 1.6, make: handoff("user", "toucan") },
    { after: 0.6, make: (jobId) => ({ type: "job.dispatched", jobId, location: "ai-lab", team: plan.stages.map((s) => STAGES[s].agent), revision }) },
    { after: 0.2, make: say("note", "toucan", "team", `Revision ${revision}: ${route}. “${feedback}”`) },
    { after: MOCK_DISPATCH_S, make: say("speech", "toucan", first, `${nameOf(first)}, Revision ${revision}. Notes inside.`) },
    ...stagesScript(plan, revision, result, title),
  ];
}

// ---- the source -----------------------------------------------------------------------------------------------
type Timeline = { steps: Step[]; wait: number; blocked: string | null; onDecline?: Step[] };

export class MockOrchestrationSource implements OrchestrationSource {
  readonly kind = "mock" as const;
  private listeners = new Set<RecordListener>();
  /** THE "BACKEND": every job's full history, in order */
  private hist = new Map<string, JobRecord[]>();
  private lines = new Map<string, Timeline>();
  private seq = 0;
  private mids = 0;
  private readonly now: () => number;
  /** records are stamped with this clock, minus whatever offset an offline seed applies */
  private offset = 0;
  private silent = false;

  constructor(opts: { now?: () => number } = {}) { this.now = opts.now ?? (() => Date.now()); }

  subscribe(fn: RecordListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** a job's truth on the "server" side (the same reducer the client uses) */
  private truth(jobId: string): JobSnapshot { return projectJob(jobId, null, this.hist.get(jobId) ?? []); }

  async send(cmd: JobCommand): Promise<JobCommandResult> { return this.sendSync(cmd); }

  /** the same as send(), synchronously (the mock's effects are immediate; tests and the world use this) */
  sendSync(cmd: JobCommand): JobCommandResult {
    if (cmd.type === "submit") {
      const jobId = `mock-job-${++this.seq}`;
      this.hist.set(jobId, []);
      this.play(jobId, demoScript(cmd.request, jobId));
      return { ok: true, jobId };
    }
    const { jobId } = cmd;
    if (!this.hist.has(jobId)) return { ok: false, jobId, error: "No such job" };
    const job = this.truth(jobId);
    switch (cmd.type) {
      case "message": {
        const text = cmd.text.trim();
        if (!text) return { ok: false, jobId, error: "Empty message" };
        const reply = job.status === "ready" ? "Thanks! Approve it, or tell me what to change."
          : job.status === "approved" ? "Noted. This one's approved." : "Noted — I'll pass it to the team.";
        this.play(jobId, [{ after: 0, make: say("chat", "user", "toucan", text) }, { after: 0.6, make: say("chat", "toucan", "user", reply) }], "side");
        return { ok: true, jobId };
      }
      case "approve": {
        if (!reviewable(job, cmd.revisionId)) return { ok: false, jobId, error: "That revision is not waiting for review" };
        this.play(jobId, [
          { after: 0, make: (id) => ({ type: "job.approved", jobId: id, revisionId: cmd.revisionId, by: "user" }) },
          { after: 0.3, make: say("speech", "toucan", "user", "Approved. I'll tell the team.") },
        ]);
        return { ok: true, jobId };
      }
      case "request-revision": {
        const feedback = cmd.feedback.trim();
        if (!feedback) return { ok: false, jobId, error: "Say what should change" };
        if (!reviewable(job, cmd.revisionId)) return { ok: false, jobId, error: "That revision is not waiting for review" };
        const prev = job.artifacts.find((a) => a.revisionId === cmd.revisionId)?.result ?? latestDelivered(job)?.result;
        if (!prev) return { ok: false, jobId, error: "No result to revise" };
        this.play(jobId, revisionScript(prev, feedback, job.artifacts.length + 1, job.title));
        return { ok: true, jobId };
      }
      case "respond": {
        const line = this.lines.get(jobId);
        // one answer per request: an answered (or unknown) request is refused
        if (!job.attention || job.attention.requestId !== cmd.requestId) return { ok: false, jobId, error: "Nothing is waiting for that" };
        const kind = job.attention.kind;
        if ((kind === "needs-approval") !== (cmd.response.kind === "approval")) return { ok: false, jobId, error: kind === "needs-approval" ? "This needs an approve or decline" : "This needs an answer" };
        this.emit(jobId, (id) => ({ type: "attention.resolved", jobId: id, requestId: cmd.requestId, response: cmd.response }));
        if (line && line.blocked === cmd.requestId) {
          // DECLINED: the path that needed the approval is dropped, not walked — the decline path replaces it
          const declined = cmd.response.kind === "approval" && !cmd.response.approved;
          if (declined) { line.steps = [...(line.onDecline ?? [])]; line.wait = line.steps[0]?.after ?? 0; }
          line.blocked = null; line.onDecline = undefined;
          this.run(jobId, 0);
        }
        return { ok: true, jobId };
      }
    }
  }

  async jobs(): Promise<readonly string[]> { return [...this.hist.keys()].reverse(); }

  /** the job's truth so far. From the start, the "server" compacts all but the last few records into a snapshot
   *  (as a real backend might), so a reconnect exercises snapshot + history together. */
  async history(jobId: string, afterSeq = 0): Promise<JobHistory<JobSnapshot>> {
    const all = this.hist.get(jobId) ?? [];
    if (afterSeq === 0 && all.length > 6) {
      const cut = all.length - 4;
      return { jobId, snapshot: projectJob(jobId, null, all.slice(0, cut)), records: all.slice(cut) };
    }
    return { jobId, snapshot: null, records: all.filter((r) => r.seq > afterSeq) };
  }

  async artifact(revisionId: string): Promise<ArtifactResult | null> {
    for (const id of this.hist.keys()) {
      const a = this.truth(id).artifacts.find((x) => x.revisionId === revisionId);
      if (a?.result) return a.result;
    }
    return null;
  }

  cancel(): void {
    this.hist.clear(); this.lines.clear();
  }

  get running(): boolean { return [...this.lines.values()].some((l) => l.steps.length > 0); }

  /** RECONNECT PROOF: start a job that has been running while nobody was watching. Its timeline runs instantly up
   *  to `until` (records kept, nothing emitted — "the backend worked while VO was closed"), stamped as if it
   *  started `minutesAgo` ago; the rest continues live on tick(). Returns the job id to reconnect to. */
  seedOffline(cmd: DemoCommand, until: (e: OrchestrationEvent) => boolean, minutesAgo = 35): string {
    const jobId = `mock-job-${++this.seq}`;
    this.hist.set(jobId, []);
    const line: Timeline = { steps: demoScript(cmd, jobId), wait: 0, blocked: null };
    this.lines.set(jobId, line);
    this.silent = true;
    this.offset = -minutesAgo * 60_000;
    const per = (minutesAgo * 60_000) / 60;
    let hit = false;
    while (!hit && line.steps.length > 0) {
      const step = line.steps.shift()!;
      if (step.make) hit = until(this.emit(jobId, step.make).event);
      this.offset += per;
    }
    this.silent = false; this.offset = 0;
    line.wait = line.steps[0]?.after ?? 0;
    return jobId;
  }

  tick(dt: number): void {
    for (const id of [...this.lines.keys()]) this.run(id, dt);
  }

  // ---- internals ------------------------------------------------------------------------------------------
  /** queue steps on a job: "append" continues its timeline (after whatever is still to come — a command never
   *  cuts the job's own story short); "side" runs beside it (a chat reply never waits for, or delays, the work) */
  private play(jobId: string, steps: Step[], mode: "append" | "side" = "append"): void {
    const cur = this.lines.get(jobId);
    if (cur && cur.steps.length > 0) {
      if (mode === "append") { cur.steps.push(...steps); return; }
      this.lines.set(`${jobId}#side${++this.mids}`, { steps: [...steps], wait: steps[0]?.after ?? 0, blocked: null });
      this.run(`${jobId}#side${this.mids}`, 0);
      return;
    }
    this.lines.set(jobId, { steps: [...steps], wait: steps[0]?.after ?? 0, blocked: null });
    this.run(jobId, 0);
  }

  private run(key: string, dt: number): void {
    const line = this.lines.get(key);
    if (!line) return;
    const jobId = key.split("#")[0];
    if (!this.hist.has(jobId)) { this.lines.delete(key); return; }
    if (line.blocked) return;
    line.wait -= dt;
    while (line.steps.length > 0 && line.wait <= 0 && !line.blocked) {
      const step = line.steps.shift()!;
      if (step.block) { line.blocked = step.block; line.onDecline = step.onDecline; }
      else if (step.make) this.emit(jobId, step.make);
      if (line.steps.length > 0) line.wait += line.steps[0].after;
    }
    if (line.steps.length === 0 && !line.blocked) this.lines.delete(key);
  }

  private emit(jobId: string, make: Make): JobRecord {
    const h = this.hist.get(jobId)!;
    const r: JobRecord = { seq: h.length + 1, at: this.now() + this.offset, event: make(jobId, () => `${jobId}-m${++this.mids}`) };
    h.push(r);
    if (!this.silent) for (const fn of this.listeners) fn(r);
    return r;
  }
}
