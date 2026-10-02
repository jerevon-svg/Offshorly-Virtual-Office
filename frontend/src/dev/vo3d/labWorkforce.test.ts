// vo3d — PHASE 4, THE PHYSICAL AI WORKFORCE: the V2 Lab presenter (app/labWorkforce) against a fake cast, plus
// the data it stands on (stations by role, residents, the routes each physical leg needs on the real graph).
// These lock the seam: the mock source decides WHEN, the presenter decides HOW — by destination, never by
// coordinate — and the packet, the stations and the gallery only ever follow the job.
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MockOrchestrationSource } from "./world/agentOrchestrationMock";
import { JobClient } from "./world/jobStore";
import { LabWorkforce } from "./app/labWorkforce";
import type { MonkeyCastRunner } from "./avatar/MonkeyCastRunner";
import type { AgentAssignment, AgentExecState } from "./world/monkeyAgentContract";
import type { ToucanSummonState } from "../../components/OfficeMap/toucanSummon";
import { STATIONS, assignStation, workForRole } from "./world/labStations";
import { LAB_RESIDENTS, residentFor } from "./world/labPopulation";
import { buildLabV2Graph } from "./world/ailabV2";
import { buildPlan } from "./world/monkeyTraversal";
import { personaFor } from "./world/monkeyPersona";
import { DEMO_COMMAND } from "./world/agentOrchestration";
import type { AiLabDemoStatus } from "./app/aiLabDemo";

/** A fake cast: every walk takes `walk` seconds, a handoff transfers 1.15 s after both have arrived. It keeps
 *  the packet's holder the way the runner does (external → glide → agent, agent → agent, agent → rest). */
function fakeCast(walk = 2) {
  const g = buildLabV2Graph();
  const node = (d: string) => g.destinations[d] ?? d;
  const at = new Map<string, { node: string; free: number }>();
  const exec = new Map<string, { exec: AgentExecState; assignment: AgentAssignment | null }>();
  const log: string[] = [];
  let holder: string | null = null;
  let pendingHolder: { who: string | null; t: number } | null = null;
  const nodeXZ = (n: string) => { const x = g.nodes.find((k) => k.id === n)!.at; return new THREE.Vector3(x.x, x.y, x.z); };
  const cast = {
    t: 0,
    agents: new Map(["nova", "milo", "pip"].map((id) => [id, { id, body: {
      get exec() { return exec.get(id)?.exec ?? "idle"; }, get assignment() { return exec.get(id)?.assignment ?? null; },
      identity: { id, name: id[0].toUpperCase() + id.slice(1) },
    } }])),
    pills: { say: (id: string, text: string | null) => { if (text) log.push(`say ${id}: ${text}`); }, clear: () => {} },
    ensurePacket: () => {},
    startLive: (start: Record<string, { node: string }>) => { at.clear(); for (const [id, s] of Object.entries(start)) at.set(id, { node: s.node, free: 0 }); holder = null; pendingHolder = null; log.push("startLive"); },
    setExec: (id: string, e: AgentExecState, a?: AgentAssignment | null) => {
      const cur = exec.get(id); exec.set(id, { exec: e, assignment: a === undefined ? cur?.assignment ?? null : a });
      if (cur?.exec !== e) log.push(`exec ${id}:${e}`);
    },
    nodeOf: node,
    isAt: (id: string, d: string) => { const a = at.get(id); return !!a && a.node === node(d) && a.free <= cast.t; },
    isFree: (id: string) => (at.get(id)?.free ?? 0) <= cast.t,
    freeAt: (id: string) => at.get(id)?.free ?? 0,
    isPresent: (id: string) => at.has(id),
    positionOf: (id: string, out: THREE.Vector3) => { const a = at.get(id); return a ? out.copy(nodeXZ(a.node)) : null; },
    headOf: (id: string, out: THREE.Vector3) => { const a = at.get(id); return a ? out.copy(nodeXZ(a.node)).setY(30) : null; },
    holderOf: () => { if (pendingHolder && cast.t >= pendingHolder.t) { holder = pendingHolder.who; pendingHolder = null; } return holder; },
    holdExternally: (_p: string, c: unknown) => { holder = c ? "external" : holder; },
    receiveFromExternal: (_p: string, id: string) => { const t1 = Math.max(cast.t, at.get(id)!.free) + 1.1; pendingHolder = { who: id, t: t1 }; log.push(`receive ${id}`); return t1; },
    collectToExternal: () => { if (cast.holderOf() !== null) return cast.t; pendingHolder = { who: "toucan", t: cast.t + 1 }; log.push("collect toucan"); return cast.t + 1; },
    passExternal: () => { pendingHolder = { who: "user", t: cast.t + 1.3 }; log.push("deliver user"); return cast.t + 1.3; },
    setPacketTint: () => {}, setSpeaking: () => {},
    enterFromResidence: (id: string) => { at.set(id, { node: node("RESIDENCE_INSIDE"), free: 0 }); return true; },
    retireToResidence: () => {},
    issue: (c: { op: string; a?: string; to?: string; giver?: string; receiver?: string; target?: unknown; packet?: string | null }) => {
      if (c.op === "go") {
        const a = at.get(c.a!)!; const start = Math.max(cast.t, a.free);
        if (a.node !== node(c.to!)) { at.set(c.a!, { node: node(c.to!), free: start + walk }); log.push(`go ${c.a} ${c.to}`); }
      } else if (c.op === "handoff") {
        const t0 = Math.max(cast.t, at.get(c.giver!)!.free, at.get(c.receiver!)!.free);
        pendingHolder = { who: c.receiver!, t: t0 + 1.15 };
        log.push(`handoff ${c.giver}>${c.receiver}`);
      } else if (c.op === "place") { log.push(`place ${c.a}`); const a = at.get(c.a!)!; pendingHolder = { who: null, t: Math.max(cast.t, a.free) }; }
      else if (c.op === "carry") { log.push(`carry ${c.a}`); holder = c.a!; }
    },
  };
  return { cast: cast as unknown as MonkeyCastRunner & { t: number }, log, raw: cast, holderNow: () => cast.holderOf() };
}

function rig() {
  const f = fakeCast();
  const stationLog: string[] = [], slots: string[] = [];
  let birdState: ToucanSummonState = "attending";
  const bird = new THREE.Vector3(1400, 34, 1200);
  const player = { x: 1400, z: 1200 };
  let target: { x: number; z: number } | null = null, landing: { x: number; y: number; z: number } | null = null;
  const cam = { restores: 0, follows: 0, frames: 0, delivers: 0 };
  const source = new MockOrchestrationSource();
  const jobs = new JobClient(source);
  const w = new LabWorkforce({
    jobs,
    cast: f.cast,
    lab: { setStationActivity: (id, s) => stationLog.push(`${id}:${s}`), setArtifactSlot: (i, s) => slots.push(`${i}:${s}`), resetLive: () => stationLog.push("reset") },
    toucan: {
      setTarget: (at) => { target = at; }, setFace: () => {}, setLanding: (p) => { landing = p; }, setPace: () => {},
      settle: (c, l) => { target = c; landing = l; bird.set(l.x, l.y, l.z); birdState = "attending"; },
      state: () => birdState, landed: () => !!landing && bird.distanceTo(new THREE.Vector3(landing.x, landing.y, landing.z)) < 1,
      position: () => bird, carry: () => null,
    },
    player: () => player,
    userCarry: () => null,
    camera: { follow: () => { cam.follows++; }, frame: () => { cam.frames++; }, deliver: () => { cam.delivers++; }, restore: () => { cam.restores++; } },
    available: () => true,
  });
  /** the bird flies to wherever it is sent in 3 s (to the perch: it lands; to the player: it parks) */
  let flying = 0;
  const step = (dt: number) => {
    f.raw.t += dt;
    const goal = landing ?? (target ? { x: target.x, y: 34, z: target.z } : null);
    if (goal && bird.distanceTo(new THREE.Vector3(goal.x, goal.y, goal.z)) > 1) {
      birdState = "approaching"; flying += dt;
      if (flying >= 3) { flying = 0; bird.set(landing ? landing.x : player.x, goal.y, landing ? landing.z : player.z); birdState = "attending"; }
    }
    jobs.tick(dt);
    w.update(dt);
  };
  /** the demo controller's Ask Toucan (world.ts labDemo.start): a command to the job system, nothing to the scene */
  const start = () => { jobs.reset(); w.reset(); return source.sendSync({ type: "submit", request: DEMO_COMMAND }); };
  const status = () => { let s: AiLabDemoStatus = { phase: "idle", step: "", source: "mock", transcript: [] }; w.subscribe((x) => { s = x; })(); return s; };
  return { w, f, jobs, source, stationLog, slots, cam, step, bird, player, start, status };
}

describe("LabWorkforce — the physical presenter", () => {
  it("runs the job end to end: briefing, three stations, three handoffs, a READY slot, and the bird back with you", () => {
    const r = rig();
    r.start();
    for (let i = 0; i < 4000 && r.status().phase !== "complete"; i++) r.step(0.05);
    expect(r.status()).toMatchObject({ phase: "complete", step: "Result delivered", delivered: true });
    // the deliverable the HUD shows is the job's own result payload
    expect(r.status().result).toMatchObject({ title: "Landing page refresh for Alex", source: "mock", deliverable: { kind: "landing-page" } });
    const log = r.f.log.join("\n");
    // the team comes down from home to the ring (destinations, never coordinates)
    for (const id of ["nova", "milo", "pip"]) expect(log).toContain(`go ${id} ${LAB_RESIDENTS[id].brief}`);
    // the packet's whole journey, in order: beak → Nova → Milo → Pip → dock
    const order = ["receive nova", "handoff nova>milo", "handoff milo>pip", "go pip ARTIFACT_DOCK_1", "collect toucan", "deliver user"].map((k) => log.indexOf(k));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // each agent walked to its own compatible station, by id
    expect(log).toContain("go nova DESIGN_01");
    expect(log).toContain("go milo BUILD_01");
    expect(log).toContain("go pip QA_01");
    // every station woke, worked, finished and went back to standby — none is left working
    for (const id of ["DESIGN_01", "BUILD_01", "QA_01"]) {
      const s = r.stationLog.filter((x) => x.startsWith(id)).map((x) => x.split(":")[1]);
      expect(s.slice(0, 3)).toEqual(["active", "working", "done"]);
    }
    expect(r.slots).toEqual(["0:ready"]);
    // ONE ownership chain, exactly: Toucan → Nova → Milo → Pip → Artifact → Toucan → User
    expect(r.w.debug().owners).toEqual(["toucan", "nova", "milo", "pip", "artifact", "toucan", "user"]);
    // the bird came all the way back, and the camera was handed back
    expect(Math.hypot(r.bird.x - r.player.x, r.bird.z - r.player.z)).toBeLessThan(1);
    expect(r.cam.restores).toBeGreaterThanOrEqual(1);
    // pills only ever moved through the job's own states
    const nova = r.f.log.filter((l) => l.startsWith("exec nova"));
    expect(nova.slice(nova.indexOf("exec nova:assigned"))).toEqual(["exec nova:assigned", "exec nova:working", "exec nova:done", "exec nova:idle"]);
  });

  it("never shows Lab work before the bird has landed, and holds the briefing for the team", () => {
    const r = rig();
    r.start();
    let firstAssignedAt = -1, firstBriefAt = -1;
    for (let i = 0; i < 1200; i++) {
      r.step(0.05);
      if (firstAssignedAt < 0 && r.f.log.includes("exec nova:assigned")) firstAssignedAt = r.f.raw.t;
      if (firstBriefAt < 0 && r.f.log.some((l) => l.startsWith("go nova BRIEFING"))) firstBriefAt = r.f.raw.t;
    }
    expect(firstBriefAt).toBeGreaterThan(0);
    expect(firstAssignedAt).toBeGreaterThan(firstBriefAt);
  });

  it("resets cleanly mid-job and reruns: everyone home, stations reset, nothing duplicated", () => {
    const r = rig();
    r.start();
    for (let i = 0; i < 900; i++) r.step(0.05);
    r.f.log.length = 0;
    r.jobs.reset(); r.w.reset();
    expect(r.stationLog.at(-1)).toBe("reset");
    expect(r.status()).toMatchObject({ phase: "idle", delivered: false, result: null });
    // everyone back home (a fresh live start), every agent idle
    expect(r.f.log[0]).toBe("startLive");
    expect(["nova", "milo", "pip"].every((id) => r.f.cast.agents.get(id)!.body.exec === "idle")).toBe(true);
    r.f.log.length = 0; r.slots.length = 0;
    r.start();
    for (let i = 0; i < 4000 && r.status().phase !== "complete"; i++) r.step(0.05);
    expect(r.status().phase).toBe("complete");
    expect(r.f.log.filter((l) => l.startsWith("receive")).length).toBe(1);
    expect(r.f.log.filter((l) => l === "collect toucan" || l === "deliver user")).toEqual(["collect toucan", "deliver user"]);
    expect(r.f.holderNow()).toBe("user");
    expect(r.slots).toEqual(["0:ready"]);
  });
});

/** run until the presenter has shown everything and the job waits on the human (or `max` steps) */
function settle(r: ReturnType<typeof rig>, max = 6000) {
  for (let i = 0; i < max; i++) {
    r.step(0.05);
    const id = r.jobs.latest, j = id ? r.jobs.job(id) : null;
    if (r.status().phase === "complete" && j && (j.status === "ready" || j.status === "approved") && !r.source.running && (r.status().unseen ?? []).length === 0) return;
  }
}
const sinceMark = (log: string[], mark: number) => log.slice(mark).join("\n");

describe("Phase 5 — the job system and the scene", () => {
  it("one message record feeds the thread AND the bubble — once each, the same text", () => {
    const r = rig();
    r.start();
    settle(r);
    const job = r.jobs.job(r.jobs.latest!)!;
    const msgs = job.conversation.filter((c) => c.kind === "message");
    // every message is ONE record (ids unique) …
    expect(new Set(msgs.map((m) => (m as { messageId: string }).messageId)).size).toBe(msgs.length);
    // … and each spoken line was bubbled exactly once, with the record's own text
    const spoken = msgs.filter((m) => m.kind === "message" && m.tone === "speech" && m.to !== "user") as { from: string; text: string }[];
    for (const m of spoken) expect(r.f.log.filter((l) => l === `say ${m.from}: ${m.text}`).length, m.text).toBe(1);
    expect(msgs.filter((m) => m.kind === "message" && m.text === "Direction's ready. All yours.")).toHaveLength(1);
    // notes are the thread's only: never a bubble
    for (const m of msgs.filter((m) => m.kind === "message" && m.tone === "note") as { from: string; text: string }[]) expect(r.f.log).not.toContain(`say ${m.from}: ${m.text}`);
  });

  it("the thread never runs ahead of the scene while the Lab is shown; once caught up it is the whole truth", () => {
    const r = rig();
    r.start();
    let ahead = false;
    for (let i = 0; i < 1500; i++) {
      r.step(0.05);
      const id = r.jobs.latest!, unseen = new Set(r.status().unseen ?? []);
      const seen = r.jobs.store.seen(id, unseen)!, truth = r.jobs.job(id)!;
      if (unseen.size > 0) { ahead = true; expect(seen.conversation.length).toBeLessThanOrEqual(truth.conversation.length); }
    }
    expect(ahead).toBe(true); // the scene really did lag (flights, walks) …
    settle(r);
    const id = r.jobs.latest!;
    expect(r.status().unseen).toEqual([]); // … and caught up
    expect(r.jobs.store.seen(id, new Set())).toEqual(r.jobs.job(id));
  });

  it("Approve is a job command: the job is approved, nothing new starts", async () => {
    const r = rig();
    r.start();
    settle(r);
    const id = r.jobs.latest!, rev = r.jobs.job(id)!.artifacts[0].revisionId;
    const mark = r.f.log.length;
    expect(await r.jobs.approve(id, rev)).toEqual({ ok: true, jobId: id });
    settle(r, 400);
    expect(r.jobs.job(id)).toMatchObject({ status: "approved", approvedRevisionId: rev });
    expect(r.jobs.job(id)!.artifacts[0]).toMatchObject({ approved: true, delivered: true });
    expect(sinceMark(r.f.log, mark)).not.toMatch(/exec |go |handoff/);
    expect(r.status().step).toBe("Approved");
    // nothing can be approved twice, or revised after approval
    expect((await r.jobs.approve(id, rev)).ok).toBe(false);
    expect((await r.jobs.requestChanges(id, rev, "more")).ok).toBe(false);
  });

  it("Request Changes continues the SAME job: Revision 2 through the routed stages, Revision 1 kept, packet chain continued", async () => {
    const r = rig();
    r.start();
    settle(r);
    const id = r.jobs.latest!;
    const r1 = r.jobs.job(id)!.artifacts[0];
    const r1Copy = structuredClone(r1);
    const mark = r.f.log.length;
    expect((await r.jobs.requestChanges(id, r1.revisionId, "The hero feels too corporate. Make it more playful and give the CTA more emphasis.")).ok).toBe(true);
    settle(r);
    const job = r.jobs.job(id)!;
    expect(r.jobs.latest).toBe(id); // the same job, not a new one
    expect(job.status).toBe("ready");
    expect(job.artifacts.map((a) => a.revisionId)).toEqual([`${id}-artifact-r1`, `${id}-artifact-r2`]);
    expect(job.artifacts[0]).toEqual({ ...r1Copy }); // Revision 1 untouched
    expect(job.artifacts[1]).toMatchObject({ artifactId: r1.artifactId, revision: 2, delivered: true, result: { basedOn: r1.revisionId, source: "mock", deliverable: { ctaStyle: "bold" } } });
    // the human's feedback is a message in the same thread
    expect(job.conversation.some((c) => c.kind === "message" && c.from === "user" && c.text.startsWith("The hero feels"))).toBe(true);
    // physically: no second briefing; the packet goes back to the bird, then through the same team, into slot 2
    const rev = sinceMark(r.f.log, mark);
    expect(rev).not.toMatch(/go \w+ BRIEFING/);
    expect(rev).toContain("go nova DESIGN_01");
    expect(rev).toContain("go pip ARTIFACT_DOCK_2");
    expect(r.slots).toEqual(["0:ready", "1:ready"]);
    expect(r.w.debug().owners).toEqual(["toucan", "nova", "milo", "pip", "artifact", "toucan", "user", "toucan", "nova", "milo", "pip", "artifact", "toucan", "user"]);
    expect(r.cam.delivers).toBe(2); // every delivery is framed
  });

  it("a revision can skip stages: copy-only goes to Design alone and Nova docks the result", async () => {
    const r = rig();
    r.start();
    settle(r);
    const id = r.jobs.latest!;
    const mark = r.f.log.length;
    await r.jobs.requestChanges(id, r.jobs.job(id)!.artifacts[0].revisionId, "Fix the typo in the headline copy.");
    settle(r);
    const rev = sinceMark(r.f.log, mark);
    expect(rev).toContain("exec nova:working");
    expect(rev).not.toMatch(/exec (milo|pip):(assigned|working|reviewing)/);
    expect(rev).toContain("go nova ARTIFACT_DOCK_2");
    expect(r.jobs.job(id)!.artifacts[1].result?.stages.map((s) => s.role)).toEqual(["Design"]);
    expect(r.w.debug().owners.slice(7)).toEqual(["toucan", "nova", "artifact", "toucan", "user"]);
  });

  it("a worker waiting for the human shows WAITING (no fake work) until answered, then carries on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = rig();
    r.start();
    settle(r);
    const id = r.jobs.latest!;
    await r.jobs.requestChanges(id, r.jobs.job(id)!.artifacts[0].revisionId, "Make the CTA bolder and deploy it.");
    let waited = false;
    for (let i = 0; i < 6000 && !waited; i++) { r.step(0.05); waited = r.jobs.job(id)!.status === "waiting" && (r.status().unseen ?? []).length === 0; }
    expect(waited).toBe(true);
    expect(r.f.cast.agents.get("milo")!.body.exec).toBe("awaiting-approval");
    expect(r.stationLog.filter((x) => x.startsWith("BUILD_01")).at(-1)).toBe("BUILD_01:active");
    // nothing moves on while it waits
    const n = r.jobs.store.records(id).length;
    for (let i = 0; i < 400; i++) r.step(0.05);
    expect(r.jobs.store.records(id).length).toBe(n);
    const req = r.jobs.job(id)!.attention!.requestId;
    await r.jobs.respond(id, req, { kind: "approval", approved: true });
    settle(r);
    expect(r.jobs.job(id)).toMatchObject({ status: "ready", attention: null });
    expect(r.jobs.job(id)!.artifacts).toHaveLength(2);
    // the request was said at the station (a bubble over Milo), and no physical gate ever had to be forced
    expect(r.f.log).toContain("say milo: Needs your OK to deploy.");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a DECLINED approval: the scene shows the stop the job reports — no deploy, no review, the work handed back to you", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = rig();
    r.start();
    settle(r);
    const id = r.jobs.latest!;
    await r.jobs.requestChanges(id, r.jobs.job(id)!.artifacts[0].revisionId, "Make the CTA bolder and deploy it.");
    let waited = false;
    for (let i = 0; i < 6000 && !waited; i++) { r.step(0.05); waited = r.jobs.job(id)!.status === "waiting" && (r.status().unseen ?? []).length === 0; }
    const mark = r.f.log.length;
    await r.jobs.respond(id, r.jobs.job(id)!.attention!.requestId, { kind: "approval", approved: false });
    settle(r);
    const log = sinceMark(r.f.log, mark);
    expect(log).toContain("say milo: Okay. Not deploying.");
    expect(log).toContain("go milo PERCH_SPOT");
    expect(log).toContain("collect toucan");
    expect(log).toContain("deliver user");
    expect(log).not.toMatch(/go pip|ARTIFACT_DOCK|exec pip:/);
    expect(r.slots).toEqual(["0:ready"]); // no second result ever lit
    expect(r.w.debug().owners.slice(-3)).toEqual(["milo", "toucan", "user"]);
    expect(r.status()).toMatchObject({ phase: "complete" });
    expect(r.jobs.job(id)).toMatchObject({ status: "ready", revision: 1 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("RE-ENTRY: a job that ran unwatched is staged in its current state — nothing replayed — and carries on live", async () => {
    const r = rig();
    for (let i = 0; i < 5; i++) r.step(0.05); // the cast is ready
    const id = r.source.seedOffline(DEMO_COMMAND, (e) => e.type === "message" && e.kind === "note" && e.from === "milo");
    r.f.log.length = 0;
    await r.jobs.reconnect(id);
    const job = r.jobs.job(id)!;
    expect(job.agents).toMatchObject({ nova: { state: "idle" }, milo: { state: "working", role: "Dev" } });
    expect(job.agents.pip).toBeUndefined();
    expect(job.owner).toBe("milo");
    expect(job.conversation.filter((c) => c.kind === "message").length).toBeGreaterThan(8);
    // staged at once: one live start, Milo at his Build station, nobody walking a replay of the briefing
    for (let i = 0; i < 3; i++) r.step(0.05);
    const log = r.f.log.join("\n");
    expect(r.f.log.filter((l) => l === "startLive")).toHaveLength(1);
    expect(r.f.cast.isAt("milo", "BUILD_01")).toBe(true);
    expect(log).not.toMatch(/BRIEFING|receive nova|handoff nova>milo/);
    expect(r.f.cast.agents.get("milo")!.body.exec).toBe("working");
    expect(r.stationLog).toContain("BUILD_01:working");
    expect(r.w.debug()).toMatchObject({ bird: "atLab", owner: "milo", owners: ["milo"] });
    expect(r.status().unseen).toEqual([]);
    // … and the rest of the job continues from there, live
    settle(r);
    expect(r.jobs.job(id)!.status).toBe("ready");
    expect(r.w.debug().owners).toEqual(["milo", "pip", "artifact", "toucan", "user"]);
  });

  it("Reset during a revision clears the job, the thread, revisions and the scene", async () => {
    const r = rig();
    r.start();
    settle(r);
    const id = r.jobs.latest!;
    await r.jobs.requestChanges(id, r.jobs.job(id)!.artifacts[0].revisionId, "More playful, please.");
    for (let i = 0; i < 600; i++) r.step(0.05);
    expect(r.jobs.job(id)!.status).toBe("active");
    r.jobs.reset(); r.w.reset();
    expect(r.jobs.latest).toBeNull();
    expect(r.jobs.job(id)).toBeNull();
    expect(r.source.running).toBe(false);
    expect(r.status()).toMatchObject({ phase: "idle", delivered: false, result: null, jobId: null, unseen: [] });
    expect(r.w.debug()).toMatchObject({ jobId: null, revision: 1, owner: null, owners: [], slots: [], queue: [] });
    expect(r.stationLog.at(-1)).toBe("reset");
    for (let i = 0; i < 400; i++) r.step(0.05);
    expect(r.jobs.latest).toBeNull(); // nothing comes back
  });
});

describe("Phase 4 data: stations by role, residents, routes", () => {
  it("maps orchestration roles to compatible stations — founders first, others to the next compatible one", () => {
    expect(workForRole("Design")).toBe("design");
    expect(workForRole("Dev")).toBe("build");
    expect(workForRole("Review")).toBe("review");
    expect(assignStation(workForRole("Design"), new Set(), "nova")?.id).toBe("DESIGN_01");
    expect(assignStation(workForRole("Dev"), new Set(), "milo")?.id).toBe("BUILD_01");
    expect(assignStation(workForRole("Review"), new Set(), "pip")?.id).toBe("QA_01");
    // a future agent, or a busy founder's station: the next compatible free one
    expect(assignStation(workForRole("Dev"), new Set(["BUILD_01"]), "kai")?.id).toBe("BUILD_02");
    expect(assignStation(workForRole("Design"), new Set(["DESIGN_01", "DESIGN_02"]), "kai")?.id).toBe("FLEX_01");
  });

  it("founders live outside; anyone else lives inside the residence", () => {
    for (const id of ["nova", "milo", "pip"]) expect(residentFor(id).hidden).toBeFalsy();
    expect(residentFor("kai")).toMatchObject({ home: "RESIDENCE_INSIDE", hidden: true });
  });

  it("every physical leg of the job has a route on the real graph, with the packet where it is carried", () => {
    const g = buildLabV2Graph();
    const leg = (who: string, from: string, to: string, carry: boolean) => {
      const plan = buildPlan(g, g.destinations[from] ?? from, to, personaFor(who).profile, 0, { carry });
      expect(plan, `${who}: ${from} → ${to}${carry ? " (carrying)" : ""}`).not.toBeNull();
    };
    for (const id of ["nova", "milo", "pip"]) {
      const r = LAB_RESIDENTS[id];
      leg(id, r.home, r.brief, false);
      leg(id, r.brief, "PERCH_SPOT", false);
      leg(id, r.brief, r.standby, false);
      leg(id, "PERCH_SPOT", r.home, false);
    }
    leg("nova", "PERCH_SPOT", "DESIGN_01", true);
    leg("nova", "DESIGN_01", "HANDOFF_NOVA_MILO", true);
    leg("milo", LAB_RESIDENTS.milo.standby, "HANDOFF_NOVA_MILO_RECV", false);
    leg("milo", "HANDOFF_NOVA_MILO_RECV", "BUILD_01", true);
    leg("milo", "BUILD_01", "HANDOFF_MILO_PIP", true);
    leg("pip", LAB_RESIDENTS.pip.standby, "HANDOFF_MILO_PIP_RECV", false);
    leg("pip", "HANDOFF_MILO_PIP_RECV", "QA_01", true);
    for (const d of ["ARTIFACT_DOCK_1", "ARTIFACT_DOCK_2", "ARTIFACT_DOCK_3"]) leg("pip", "QA_01", d, true);
    leg("pip", "ARTIFACT_DOCK_1", "PERCH_SPOT", false);
    // revisions: an agent called from home straight to the perch, a copy-only result docked by its designer
    for (const id of ["nova", "milo", "pip"]) leg(id, LAB_RESIDENTS[id].home, "PERCH_SPOT", false);
    for (const d of ["ARTIFACT_DOCK_2", "ARTIFACT_DOCK_3"]) leg("nova", "DESIGN_01", d, true);
    // every floor station a future agent could be given is reachable carrying work
    for (const st of STATIONS.filter((s) => s.at.y === 0 && s.state !== "future")) leg("milo", "PERCH_SPOT", st.id, true);
  });
});
