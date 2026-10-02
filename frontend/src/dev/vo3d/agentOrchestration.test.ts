// vo3d — the AI-workforce demo's ORCHESTRATION SEAM: the mock source (the only place timers decide
// anything) and the presenter (which only paces what is shown). The presenter runs against fakes here — no
// WebGL — so these lock the contract: who decides (the source), who shows (the presenter), and that
// presentation never invents, skips or shortens a state.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEMO_COMMAND, type OrchestrationEvent } from "./world/agentOrchestration";
import { MOCK_WORK_S, MockOrchestrationSource } from "./world/agentOrchestrationMock";
import { AiLabDemo } from "./app/aiLabDemo";
import type { AgentExecState, AgentAssignment } from "./world/monkeyAgentContract";
import type { MonkeyAgentProof } from "./avatar/MonkeyAgentProof";
import type { ToucanSummonState } from "../../components/OfficeMap/toucanSummon";

function runMock(seconds: number, step = 0.1): OrchestrationEvent[] {
  const src = new MockOrchestrationSource();
  const out: OrchestrationEvent[] = [];
  src.subscribe((e) => out.push(e));
  src.submit(DEMO_COMMAND);
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
    const lines = runMock(120).filter((e) => e.type === "message").map((e) => (e as { from: string; to: string; text: string }));
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
    src.subscribe((e) => out.push(e));
    src.submit(DEMO_COMMAND);
    src.tick(2);
    const n = out.length;
    src.cancel();
    for (let i = 0; i < 100; i++) src.tick(1);
    expect(out.length).toBe(n);
  });
});

// ---- the presenter, against fakes ---------------------------------------------------------------------------
function rig() {
  const execLog: string[] = [];
  const execs = new Map<string, AgentExecState>([["nova", "idle"], ["milo", "idle"], ["pip", "idle"]]);
  const said: string[] = [];
  const body = (id: string) => ({
    get exec() { return execs.get(id)!; }, identity: { name: id[0].toUpperCase() + id.slice(1) }, faceToward: () => {},
  });
  const cast = {
    body, setGaze: () => {}, say: (id: string, text: string | null) => { if (text) said.push(`${id}: ${text}`); },
    setExec: (id: string, s: AgentExecState, a?: AgentAssignment | null) => { if (execs.get(id) !== s) execLog.push(`${id}:${s}`); execs.set(id, s); void a; },
    headOf: (_id: string, out: THREE.Vector3) => out.set(0, 30, 0), workSpot: () => ({ x: 0, z: 0 }),
    teamCentre: () => ({ x: 700, z: -485 }), resetPresentation: () => { for (const k of execs.keys()) execs.set(k, "idle"); },
  } as unknown as MonkeyAgentProof;
  let toucanState: ToucanSummonState = "attending";
  let atLab = false;
  const pos = new THREE.Vector3(0, 34, 0);
  const camera = { follow: [] as number[], frames: 0, restores: 0 };
  const demo = new AiLabDemo({
    source: new MockOrchestrationSource(),
    cast,
    toucan: {
      setTarget: (at) => { if (at && at.z < -300) { if (!atLab) toucanState = "approaching"; } },
      setFace: () => {}, state: () => toucanState, position: () => pos,
    },
    player: () => ({ x: 0, z: 0 }),
    camera: { follow: () => camera.follow.push(1), frame: () => { camera.frames++; }, restore: () => { camera.restores++; } },
  });
  /** the bird "lands" at the Lab after `flight` seconds of being sent there */
  const run = (seconds: number, flight: number, step = 0.05) => {
    let sentAt = -1;
    const times: { t: number; e: string }[] = [];
    for (let t = 0; t < seconds; t += step) {
      if (toucanState === "approaching" && sentAt < 0) sentAt = t;
      if (sentAt >= 0 && !atLab && t - sentAt >= flight) { atLab = true; toucanState = "attending"; pos.set(690, 34, -440); }
      const before = execLog.length;
      demo.update(step);
      for (let k = before; k < execLog.length; k++) times.push({ t, e: execLog[k] });
    }
    return times;
  };
  return { demo, execLog, said, camera, run, reset: () => { atLab = false; toucanState = "attending"; pos.set(0, 34, 0); } };
}

describe("AiLabDemo presenter", () => {
  it("shows the whole job in the source's order, then hands the camera back", () => {
    const r = rig();
    r.demo.start();
    r.run(140, 6);
    expect(r.execLog).toEqual(["nova:assigned", "nova:working", "nova:done", "milo:assigned", "nova:idle", "milo:working", "milo:done", "pip:assigned", "milo:idle", "pip:reviewing", "pip:done", "pip:idle"]);
    expect(r.said[0]).toBe("toucan: Got it. Taking it to the Lab.");
    expect(r.said.at(-1)).toBe("toucan: Here's your landing page.");
    expect(r.camera.follow.length).toBe(1);
    expect(r.camera.frames).toBe(1);
    expect(r.camera.restores).toBe(1);
  });

  it("holds every Lab event until the bird has landed — however long the flight", () => {
    const r = rig();
    r.demo.start();
    const times = r.run(160, 40); // a 40 s flight: far beyond the mock's dispatch allowance
    expect(times[0].e).toBe("nova:assigned");
    expect(times[0].t).toBeGreaterThan(40);
  });

  it("replays held work with the source's own spacing — a long flight never shortens visible work", () => {
    const r = rig();
    r.demo.start();
    const times = r.run(160, 40);
    const at = (e: string) => times.find((x) => x.e === e)!.t;
    expect(at("nova:done") - at("nova:working")).toBeGreaterThanOrEqual(MOCK_WORK_S.nova - 0.1);
    expect(at("milo:done") - at("milo:working")).toBeGreaterThanOrEqual(MOCK_WORK_S.milo - 0.1);
    expect(at("pip:done") - at("pip:reviewing")).toBeGreaterThanOrEqual(MOCK_WORK_S.pip - 0.1);
  });

  it("never moves the job on by itself: with no source events, nothing changes", () => {
    const r = rig();
    r.run(30, 1); // no start()
    expect(r.execLog).toEqual([]);
    expect(r.said).toEqual([]);
  });

  it("resets cleanly and runs again from the top", () => {
    const r = rig();
    r.demo.start();
    r.run(30, 6);
    r.demo.reset();
    r.reset();
    r.execLog.length = 0; r.said.length = 0;
    r.demo.start();
    r.run(140, 6);
    expect(r.execLog[0]).toBe("nova:assigned");
    expect(r.execLog.at(-1)).toBe("pip:idle");
    expect(r.said[0]).toBe("toucan: Got it. Taking it to the Lab.");
  });
});
