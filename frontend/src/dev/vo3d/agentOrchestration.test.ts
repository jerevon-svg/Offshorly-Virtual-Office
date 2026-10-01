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
    expect(a.at(-1)).toMatchObject({ type: "job.completed", outcome: "ready-for-review" });
    expect(new Set(a.map((e) => e.jobId)).size).toBe(1);
  });

  it("hands work on in order: Nova designs, Milo builds, Pip reviews — each through assigned → working → done", () => {
    const states = runMock(120).filter((e): e is Extract<OrchestrationEvent, { type: "agent.state" }> => e.type === "agent.state")
      .map((e) => `${e.agentId}:${e.state}`);
    expect(states).toEqual(["nova:assigned", "nova:working", "nova:done", "milo:assigned", "milo:working", "milo:done", "pip:assigned", "pip:reviewing", "pip:done"]);
    const roles = runMock(120).filter((e) => e.type === "agent.assigned").map((e) => (e as { role: string }).role);
    expect(roles).toEqual(["Design", "Dev", "Review"]);
  });

  it("speaks the demo lines, acknowledgement first", () => {
    const lines = runMock(120).filter((e) => e.type === "message").map((e) => (e as { from: string; text: string }));
    expect(lines[0]).toMatchObject({ from: "toucan", to: "user", text: "Got it. I'll organize the team." });
    expect(lines.map((l) => l.from)).toEqual(["toucan", "toucan", "nova", "nova", "milo", "milo", "pip", "pip", "toucan"]);
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
    expect(r.execLog).toEqual(["nova:assigned", "nova:working", "nova:done", "milo:assigned", "milo:working", "milo:done", "pip:assigned", "pip:reviewing", "pip:done"]);
    expect(r.said[0]).toBe("toucan: Got it. I'll organize the team.");
    expect(r.said.at(-1)).toBe("toucan: Great. I'll take it from here.");
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
    expect(r.execLog.at(-1)).toBe("pip:done");
    expect(r.said[0]).toBe("toucan: Got it. I'll organize the team.");
  });
});
