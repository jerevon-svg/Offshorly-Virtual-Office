// vo3d — PHASE 5, THE JOB SYSTEM WITHOUT A SCENE: the shared domain (world/agentJob), the client store and facade
// (world/jobStore) and the mock "backend" (world/agentOrchestrationMock). No THREE, no presenter: these lock that the
// job's truth, its commands, its history and its reconnect all work with nothing rendering it — the property a phone
// client and a future Agent Harness adapter both rely on.
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { DEMO_COMMAND, DEMO_FEEDBACK, type JobRecord } from "./world/agentOrchestration";
import { MockOrchestrationSource, planRevision, reviseResult, mockLandingPageResult } from "./world/agentOrchestrationMock";
import { JobClient, JobStore } from "./world/jobStore";
import { attentionSignal, projectJob, readThrough, reviewable, type JobSnapshot } from "./world/agentJob";
import { AiLabTaskChat } from "./app/AiLabTaskChat";

const fixedNow = () => 1_700_000_000_000;
function system() {
  const source = new MockOrchestrationSource({ now: fixedNow });
  const jobs = new JobClient(source);
  const run = (s: number) => { for (let t = 0; t < s; t += 0.1) jobs.tick(0.1); };
  return { source, jobs, run };
}
const finish = (j: JobClient, run: (s: number) => void) => { run(120); return j.job(j.latest!)!; };

describe("the job exists without any scene, chat or viewer", () => {
  it("runs to a delivered, reviewable result with only the job client", async () => {
    const { jobs, run } = system();
    const res = await jobs.submit();
    expect(res.ok).toBe(true);
    const job = finish(jobs, run);
    expect(job).toMatchObject({ status: "ready", owner: "user", title: DEMO_COMMAND.title, revision: 1 });
    expect(job.participants).toEqual(["user", "toucan", "nova", "milo", "pip"]);
    expect(job.artifacts).toHaveLength(1);
    expect(job.artifacts[0]).toMatchObject({ revisionId: `${job.jobId}-artifact-r1`, delivered: true, result: { source: "mock" } });
    expect(attentionSignal(job)).toMatchObject({ kind: "ready", text: expect.stringContaining("ready when you are") });
  });

  it("records meaningful status in the thread — stages, handoffs, delivery — not animation telemetry", () => {
    const { jobs, run } = system();
    void jobs.submit();
    const job = finish(jobs, run);
    const status = job.conversation.filter((c) => c.kind === "status").map((c) => (c as { text: string }).text);
    expect(status).toEqual([
      "Toucan took the job to the AI Lab",
      "Toucan handed the work to Nova", "Nova started Design", "Design completed",
      "Nova handed the work to Milo", "Milo started Dev", "Dev completed",
      "Milo handed the work to Pip", "Pip started Review", "Review completed",
      "Toucan delivered Revision 1 to you",
    ]);
    // one result card per revision, marked delivered in place (never a second card)
    expect(job.conversation.filter((c) => c.kind === "artifact")).toMatchObject([{ revision: 1, delivered: true }]);
    // the human's request opens the thread
    expect(job.conversation[0]).toMatchObject({ kind: "message", from: "user", text: DEMO_COMMAND.text });
  });
});

describe("commands are job commands", () => {
  it("Approve and Request Changes leave VO as commands against the SAME job", async () => {
    const { source, jobs, run } = system();
    const sent = vi.spyOn(source, "send");
    await jobs.submit();
    const job = finish(jobs, run);
    const rev1 = job.artifacts[0].revisionId;
    await jobs.requestChanges(job.jobId, rev1, DEMO_FEEDBACK);
    expect(sent.mock.calls.at(-1)?.[0]).toEqual({ type: "request-revision", jobId: job.jobId, revisionId: rev1, feedback: DEMO_FEEDBACK });
    const after = finish(jobs, run);
    expect(after.jobId).toBe(job.jobId);
    const rev2 = after.artifacts[1].revisionId;
    await jobs.approve(job.jobId, rev2);
    expect(sent.mock.calls.at(-1)?.[0]).toEqual({ type: "approve", jobId: job.jobId, revisionId: rev2 });
    run(5);
    expect(jobs.job(job.jobId)).toMatchObject({ status: "approved", approvedRevisionId: rev2 });
    // an older revision can never be approved
    expect((await jobs.approve(job.jobId, rev1)).ok).toBe(false);
  });

  it("a typed message is the human's own line, answered beside the work — never delaying it", async () => {
    const { jobs, run } = system();
    await jobs.submit();
    run(20);
    const id = jobs.latest!;
    const before = jobs.store.records(id).length;
    await jobs.message(id, "Keep it on brand, please.");
    run(1);
    const job = jobs.job(id)!;
    const chat = job.conversation.filter((c) => c.kind === "message" && c.tone === "chat").map((c) => (c as { from: string; text: string }));
    expect(chat.slice(-2)).toEqual([{ ...chat.at(-2), from: "user", text: "Keep it on brand, please." }, { ...chat.at(-1), from: "toucan", text: "Noted — I'll pass it to the team." }]);
    expect(jobs.store.records(id).length).toBeGreaterThan(before);
    // the work still finishes on its own schedule
    expect(finish(jobs, run).status).toBe("ready");
  });
});

describe("revision routing (the mock decides; nothing downstream assumes)", () => {
  it("routes by what the feedback asks for", () => {
    expect(planRevision(DEMO_FEEDBACK).stages).toEqual(["design", "build", "review"]);
    expect(planRevision("Fix the typo in the headline copy.").stages).toEqual(["design"]);
    expect(planRevision("The signup link is broken on mobile.").stages).toEqual(["build", "review"]);
    expect(planRevision("Make the CTA bolder and deploy it.")).toEqual({ stages: ["design", "build", "review"], approvalAfter: "build" });
  });

  it("gives every revision a stable identity and never touches the one before it", () => {
    const r1 = mockLandingPageResult(DEMO_COMMAND, "mock-job-7");
    const frozen = structuredClone(r1);
    const r2 = reviseResult(r1, DEMO_FEEDBACK, planRevision(DEMO_FEEDBACK), 2);
    expect(r1).toEqual(frozen);
    expect([r1.revisionId, r2.revisionId]).toEqual(["mock-job-7-artifact-r1", "mock-job-7-artifact-r2"]);
    expect(r2).toMatchObject({ artifactId: r1.artifactId, basedOn: r1.revisionId, feedback: DEMO_FEEDBACK, source: "mock", deliverable: { ctaStyle: "bold" } });
    expect(reviseResult(r1, DEMO_FEEDBACK, planRevision(DEMO_FEEDBACK), 2)).toEqual(r2); // deterministic
  });
});

describe("human attention", () => {
  it("a waiting worker is representable, holds the job, and is the one signal a notifier needs", async () => {
    const { jobs, run } = system();
    const signals: (string | null)[] = [];
    jobs.onAttention((s) => signals.push(s ? s.kind : null));
    await jobs.submit();
    const job = finish(jobs, run);
    await jobs.requestChanges(job.jobId, job.artifacts[0].revisionId, "Make the CTA bolder and deploy it.");
    run(60);
    const waiting = jobs.job(job.jobId)!;
    expect(waiting).toMatchObject({ status: "waiting", agents: { milo: { state: "awaiting-approval" } }, attention: { from: "milo", kind: "needs-approval" } });
    expect(attentionSignal(waiting)?.text).toBe("Toucan: Milo needs your approval — Ready to publish. Approve the deploy?");
    expect(waiting.conversation.at(-1)).toMatchObject({ kind: "message", from: "milo" });
    await jobs.respond(job.jobId, waiting.attention!.requestId, { kind: "approval", approved: true });
    const done = finish(jobs, run);
    expect(done).toMatchObject({ status: "ready", attention: null });
    expect(done.conversation.find((c) => c.kind === "attention")).toMatchObject({ resolved: true });
    expect(signals).toEqual(["ready", null, "needs-approval", null, "ready"]);
  });
});

describe("approval decisions (generic: any guarded action)", () => {
  const DEPLOY = "Make the CTA bolder and deploy it.";
  /** a delivered Revision 1, then a revision blocked on approving its deploy */
  async function blocked() {
    const sys = system();
    await sys.jobs.submit();
    const job = finish(sys.jobs, sys.run);
    await sys.jobs.requestChanges(job.jobId, job.artifacts[0].revisionId, DEPLOY);
    sys.run(60);
    const w = sys.jobs.job(job.jobId)!;
    expect(w).toMatchObject({ status: "waiting", attention: { kind: "needs-approval", action: "Deploy Revision 2" } });
    return { ...sys, id: job.jobId, req: w.attention!.requestId, mark: sys.jobs.store.records(job.jobId).length };
  }
  const after = (j: JobClient, id: string, mark: number) => j.store.records(id).slice(mark).map((r) => r.event);
  const notes = (evs: ReturnType<typeof after>) => evs.filter((e) => e.type === "message").map((e) => (e as { text: string }).text);

  it("APPROVE performs the guarded action and continues the blocked path to a delivered revision", async () => {
    const { jobs, run, id, req, mark } = await blocked();
    expect((await jobs.respond(id, req, { kind: "approval", approved: true })).ok).toBe(true);
    const job = finish(jobs, run);
    const evs = after(jobs, id, mark);
    expect(notes(evs)).toContain("Deployed Revision 2 to staging.");
    expect(evs.some((e) => e.type === "agent.state" && e.agentId === "pip" && e.state === "reviewing")).toBe(true);
    expect(job).toMatchObject({ status: "ready", revision: 2, attention: null, halted: [] });
    expect(job.artifacts.map((a) => [a.revision, a.delivered])).toEqual([[1, true], [2, true]]);
    expect(job.decisions).toMatchObject([{ requestId: req, kind: "needs-approval", action: "Deploy Revision 2", outcome: "approved" }]);
    expect(job.conversation.find((c) => c.kind === "attention")).toMatchObject({ resolved: true, outcome: "approved" });
    expect(job.conversation.some((c) => c.kind === "status" && c.text === "You approved: Deploy Revision 2")).toBe(true);
  });

  it("DECLINE does not perform the guarded action: the revision stops safely and the job is back on Revision 1", async () => {
    const { jobs, run, id, req, mark } = await blocked();
    expect((await jobs.respond(id, req, { kind: "approval", approved: false })).ok).toBe(true);
    const job = finish(jobs, run);
    const evs = after(jobs, id, mark);
    // the blocked action never happens, and nothing downstream of it runs
    expect(notes(evs).some((t) => /^Deployed/.test(t))).toBe(false);
    expect(evs.some((e) => e.type === "artifact.ready" || e.type === "job.completed" || e.type === "artifact.delivered")).toBe(false);
    expect(evs.some((e) => e.type === "agent.assigned" || (e.type === "agent.state" && e.agentId === "pip"))).toBe(false);
    expect(evs.filter((e) => e.type === "revision.halted")).toEqual([{ type: "revision.halted", jobId: id, revision: 2, reason: "approval-declined", requestId: req }]);
    // a safe, accurate state: Revision 1 still the result, still the human's to approve or change; the work is back with them
    expect(job).toMatchObject({ status: "ready", revision: 1, owner: "user", attention: null, approvedRevisionId: null });
    expect(job.halted).toMatchObject([{ revision: 2, reason: "approval-declined", requestId: req }]);
    expect(job.artifacts.map((a) => a.revision)).toEqual([1]);
    expect(reviewable(job, job.artifacts[0].revisionId)).toBe(true);
    expect(job.agents).toMatchObject({ milo: { state: "idle" } });
    // the decision is recorded for good
    expect(job.decisions).toMatchObject([{ requestId: req, action: "Deploy Revision 2", outcome: "declined" }]);
    expect(job.conversation.find((c) => c.kind === "attention")).toMatchObject({ resolved: true, outcome: "declined" });
    expect(job.conversation.filter((c) => c.kind === "status").map((c) => (c as { text: string }).text).slice(-4))
      .toEqual(["You declined: Deploy Revision 2", "Milo handed the work to Toucan", "Revision 2 stopped — declined, nothing was done", "Toucan handed the work back to you"]);
    // and the job can carry on from there
    expect((await jobs.approve(id, job.artifacts[0].revisionId)).ok).toBe(true);
  });

  it("a request is answered once: duplicates and wrong-kind answers are refused, and a replayed resolution changes nothing", async () => {
    const { jobs, run, id, req } = await blocked();
    expect((await jobs.respond(id, req, { kind: "input", text: "sure" })).ok).toBe(false); // an approval needs approve/decline
    expect((await jobs.respond(id, req, { kind: "approval", approved: false })).ok).toBe(true);
    expect((await jobs.respond(id, req, { kind: "approval", approved: true })).ok).toBe(false);
    run(1);
    expect((await jobs.respond(id, req, { kind: "approval", approved: true })).ok).toBe(false);
    const job = finish(jobs, run);
    expect(jobs.store.records(id).filter((r) => r.event.type === "attention.resolved")).toHaveLength(1);
    // even a record that tried to resolve it again (a buggy backend) cannot flip the decision
    const forged = new JobStore();
    for (const r of jobs.store.records(id)) forged.apply(r);
    forged.apply({ seq: job.lastSeq + 1, at: 0, event: { type: "attention.resolved", jobId: id, requestId: req, response: { kind: "approval", approved: true } } });
    expect(forged.get(id)!.decisions).toEqual(job.decisions);
    expect(forged.get(id)!.decisions).toMatchObject([{ outcome: "declined" }]);
  });

  it("reconnect preserves the decision: a client hydrated afterwards sees the same answer, halt and thread", async () => {
    for (const approved of [true, false]) {
      const { source, jobs, run, id, req } = await blocked();
      await jobs.respond(id, req, { kind: "approval", approved });
      const live = finish(jobs, run);
      const late = new JobClient(source);
      const [hydrated] = await late.reconnect(id);
      expect(hydrated).toEqual(live);
      expect(hydrated.decisions).toMatchObject([{ requestId: req, outcome: approved ? "approved" : "declined" }]);
      expect(hydrated.halted.length).toBe(approved ? 0 : 1);
    }
    // and mid-decision: hydrated while waiting, it is still waiting — and the answer then arrives live
    const { source, jobs, run, id, req } = await blocked();
    const late = new JobClient(source);
    const [waiting] = await late.reconnect(id);
    expect(waiting).toMatchObject({ status: "waiting", attention: { requestId: req }, decisions: [] });
    await jobs.respond(id, req, { kind: "approval", approved: false });
    finish(jobs, run);
    expect(late.job(id)).toEqual(jobs.job(id));
  });
});

describe("reconnect / hydration", () => {
  it("a client that reconnects (snapshot + history) has exactly the truth a client that watched live has", async () => {
    const { source, jobs: live, run } = system();
    await live.submit();
    run(40); // mid-job
    const late = new JobClient(source);
    const [mid] = await late.reconnect(live.latest!);
    expect(mid).toEqual(live.job(live.latest!));
    // and from then on both follow the same live records
    finish(live, run);
    expect(late.job(live.latest!)).toEqual(live.job(live.latest!));
  });

  it("the source compacts: history from the start is a snapshot plus the newest records", async () => {
    const { source, jobs, run } = system();
    await jobs.submit();
    run(30);
    const h = await source.history(jobs.latest!);
    expect(h.snapshot).not.toBeNull();
    expect(h.records).toHaveLength(4);
    expect(projectJob(h.jobId, h.snapshot as JobSnapshot, h.records)).toEqual(jobs.job(jobs.latest!));
  });

  it("an offline job is rebuilt as it is NOW: Nova done, Milo building, Pip waiting, Milo holds the work", async () => {
    const { source, jobs } = system();
    const id = source.seedOffline(DEMO_COMMAND, (e) => e.type === "message" && e.kind === "note" && e.from === "milo");
    expect(jobs.job(id)).toBeNull(); // nothing reached the client while it was "closed"
    const [job] = await jobs.reconnect();
    expect(job).toMatchObject({ jobId: id, status: "active", owner: "milo", agents: { nova: { state: "idle" }, milo: { state: "working", role: "Dev" } } });
    expect(job.agents.pip).toBeUndefined();
    expect(job.conversation.at(-1)).toMatchObject({ kind: "message", from: "milo", tone: "note" });
    // stamped as having happened over the last half hour, not now
    expect(job.conversation[0].at).toBeLessThan(fixedNow() - 30 * 60_000);
  });

  it("the store applies each record once, in order — duplicates dropped, early records held until the gap fills", () => {
    const { jobs, run } = system();
    void jobs.submit();
    run(30);
    const recs = [...jobs.store.records(jobs.latest!)] as JobRecord[];
    const shuffled = [recs[2], recs[0], recs[0], recs[1], ...recs.slice(3).reverse(), recs[5]];
    const store = new JobStore();
    for (const r of shuffled) store.apply(r);
    expect(store.get(jobs.latest!)).toEqual(jobs.job(jobs.latest!));
  });
});

describe("reset", () => {
  it("forgets every job, its thread, its revisions and the mock's history", async () => {
    const { source, jobs, run } = system();
    await jobs.submit();
    const job = finish(jobs, run);
    await jobs.requestChanges(job.jobId, job.artifacts[0].revisionId, DEMO_FEEDBACK);
    run(10);
    jobs.reset();
    expect(jobs.latest).toBeNull();
    expect(jobs.job(job.jobId)).toBeNull();
    expect(await source.jobs()).toEqual([]);
    run(60);
    expect(jobs.latest).toBeNull();
  });
});

describe("the task conversation window owns nothing", () => {
  it("closing and reopening it loses nothing — what arrived while closed is there", async () => {
    const { jobs, run } = system();
    await jobs.submit();
    run(20);
    const props = { onClose: () => {}, onSend: () => {}, onOpenResult: () => {}, onRespond: () => {} };
    const first = render(<AiLabTaskChat job={jobs.job(jobs.latest!)!} {...props} />);
    const shownBefore = screen.getAllByText(/./, { selector: "[data-tone]" }).length;
    first.unmount();
    act(() => run(100)); // the job carries on with the window closed
    const job = jobs.job(jobs.latest!)!;
    render(<AiLabTaskChat job={job} {...props} />);
    const msgs = job.conversation.filter((c) => c.kind === "message");
    expect(screen.getAllByText(/./, { selector: "[data-tone]" })).toHaveLength(msgs.length);
    expect(msgs.length).toBeGreaterThan(shownBefore);
    expect(screen.getByText("Review passed. It's ready.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Result" })).toBeTruthy();
  });
});

describe("Phase 7 — Preview honesty on guarded actions", () => {
  it("a scripted deploy approval says nothing real is deployed — before and after the decision", async () => {
    const { jobs, run } = system();
    await jobs.submit();
    const job = finish(jobs, run);
    await jobs.requestChanges(job.jobId, job.artifacts[0].revisionId, "Make the CTA bolder and deploy it.");
    run(60);
    const props = { onClose: () => {}, onSend: () => {}, onOpenResult: () => {}, onRespond: () => {} };
    const view = render(<AiLabTaskChat job={jobs.job(job.jobId)!} {...props} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByTestId("ailab-approval-preview").textContent).toMatch(/Preview — nothing real is deployed/);
    view.unmount();
    const req = jobs.job(job.jobId)!.attention!.requestId;
    await jobs.respond(job.jobId, req, { kind: "approval", approved: true });
    run(60);
    render(<AiLabTaskChat job={jobs.job(job.jobId)!} {...props} />);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByTestId("ailab-approval-preview")).toBeTruthy();
  });
});

describe("Phase 7 — reading a task window never marks unshown records read", () => {
  it("reads through what is shown, but not past the earliest record the live Lab still holds", () => {
    expect(readThrough({ lastSeq: 12 }, [])).toBe(12);
    expect(readThrough({ lastSeq: 9 }, [10, 11, 12])).toBe(9);
    // a chat reply (seq 14) skipped the queue while 10–12 are held: read only through 9
    expect(readThrough({ lastSeq: 14 }, [10, 11, 12])).toBe(9);
  });
});
