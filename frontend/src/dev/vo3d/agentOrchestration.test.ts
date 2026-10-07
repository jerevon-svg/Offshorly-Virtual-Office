// vo3d — the AI Workforce's ORCHESTRATION SEAM: the mock source, the only place timers decide anything. (The
// presenter that shows it is app/labWorkforce — see labWorkforce.test.ts.)
import { describe, expect, it } from "vitest";
import { DEMO_COMMAND, type OrchestrationEvent } from "./world/agentOrchestration";
import { MockOrchestrationSource } from "./world/agentOrchestrationMock";

function runMock(seconds: number, step = 0.1): OrchestrationEvent[] {
  const src = new MockOrchestrationSource();
  const out: OrchestrationEvent[] = [];
  src.subscribe((r) => out.push(r.event));
  src.sendSync({ type: "submit", request: DEMO_COMMAND });
  for (let t = 0; t < seconds; t += step) src.tick(step);
  return out;
}

describe("MockOrchestrationSource", () => {
  it("plays the scripted job deterministically, start to finish", () => {
    const a = runMock(120), b = runMock(120, 0.033);
    expect(a.map((e) => e.type)).toEqual(b.map((e) => e.type));
    expect(a[0].type).toBe("job.created");
    expect(a.find((e) => e.type === "job.completed")).toMatchObject({ outcome: "ready-for-review" });
    // after the job is complete, only the bird's report to the human remains
    expect(a.slice(a.findIndex((e) => e.type === "job.completed") + 1).every((e) => (e.type === "message" && e.to === "user") || e.type === "artifact.delivered")).toBe(true);
    expect(new Set(a.map((e) => e.jobId)).size).toBe(1);
  });

  it("hands work on in order: Nova designs, Milo builds, Pip reviews — each through assigned → working → done", () => {
    const states = runMock(120).filter((e): e is Extract<OrchestrationEvent, { type: "agent.state" }> => e.type === "agent.state")
      .map((e) => `${e.agentId}:${e.state}`);
    expect(states).toEqual(["nova:assigned", "nova:working", "nova:done", "milo:assigned", "nova:idle", "milo:working", "milo:done", "pip:assigned", "milo:idle", "pip:reviewing", "pip:done", "pip:idle"]);
    const roles = runMock(120).filter((e) => e.type === "agent.assigned").map((e) => (e as { role: string }).role);
    expect(roles).toEqual(["Design", "Dev", "Review"]);
  });

  it("speaks the demo lines, acknowledgement first — every one short enough for the overhead bubble", () => {
    const lines = runMock(120).filter((e) => e.type === "message" && e.kind === "speech").map((e) => (e as { from: string; to: string; text: string }));
    expect(lines[0]).toMatchObject({ from: "toucan", to: "user", text: "Got it. Taking it to the Lab." });
    expect(lines.map((l) => l.from)).toEqual(["toucan", "toucan", "toucan", "toucan", "nova", "nova", "milo", "milo", "pip", "pip", "toucan", "toucan", "toucan"]);
    // the bubble clamps to three lines of ~11 characters (Vo3dOverheads .bubbleText 7.6em): never an ellipsis
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(32);
  });

  it("moves the WORK explicitly: Toucan → Nova → Milo → Pip, each handoff after the giver is done, then a ready artifact", () => {
    const ev = runMock(120);
    const hand = ev.filter((e) => e.type === "work.handoff").map((e) => `${(e as { from: string }).from}>${(e as { to: string }).to}`);
    expect(hand).toEqual(["toucan>nova", "nova>milo", "milo>pip"]);
    const idx = (pred: (e: OrchestrationEvent) => boolean) => ev.findIndex(pred);
    const st = (id: string, s: string) => idx((e) => e.type === "agent.state" && e.agentId === id && e.state === s);
    const ho = (from: string) => idx((e) => e.type === "work.handoff" && e.from === from);
    expect(ho("nova")).toBeGreaterThan(st("nova", "done"));
    expect(ho("nova")).toBeGreaterThan(st("milo", "assigned"));
    expect(ho("milo")).toBeGreaterThan(st("milo", "done"));
    expect(ho("toucan")).toBeLessThan(st("nova", "working"));
    const art = idx((e) => e.type === "artifact.ready");
    expect(art).toBeGreaterThan(st("pip", "done"));
    expect(art).toBeLessThan(idx((e) => e.type === "job.completed"));
    expect(ev[art]).toMatchObject({ by: "pip", result: { source: "mock", deliverable: { kind: "landing-page" } } });
    // the SAME artifact goes back to the human: collected by the orchestrator, then delivered — in that order
    const col = idx((e) => e.type === "artifact.collected"), done = idx((e) => e.type === "job.completed"), del = idx((e) => e.type === "artifact.delivered");
    expect(art < col && col < done && done < del).toBe(true);
    const id = (ev[art] as { artifactId: string }).artifactId;
    expect([ev[col], ev[del]].every((e) => (e as { artifactId: string }).artifactId === id)).toBe(true);
  });

  it("stops dead on cancel", () => {
    const src = new MockOrchestrationSource();
    const out: OrchestrationEvent[] = [];
    src.subscribe((r) => out.push(r.event));
    src.sendSync({ type: "submit", request: DEMO_COMMAND });
    src.tick(2);
    const n = out.length;
    src.cancel();
    for (let i = 0; i < 100; i++) src.tick(1);
    expect(out.length).toBe(n);
  });
});
