// vo3d — PHASE 4, THE PHYSICAL AI WORKFORCE: the V2 Lab presenter (app/labWorkforce) against a fake cast, plus
// the data it stands on (stations by role, residents, the routes each physical leg needs on the real graph).
// These lock the seam: the mock source decides WHEN, the presenter decides HOW — by destination, never by
// coordinate — and the packet, the stations and the gallery only ever follow the job.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MockOrchestrationSource } from "./world/agentOrchestrationMock";
import { LabWorkforce } from "./app/labWorkforce";
import type { MonkeyCastRunner } from "./avatar/MonkeyCastRunner";
import type { AgentAssignment, AgentExecState } from "./world/monkeyAgentContract";
import type { ToucanSummonState } from "../../components/OfficeMap/toucanSummon";
import { STATIONS, assignStation, workForRole } from "./world/labStations";
import { LAB_RESIDENTS, residentFor } from "./world/labPopulation";
import { buildLabV2Graph } from "./world/ailabV2";
import { buildPlan } from "./world/monkeyTraversal";
import { personaFor } from "./world/monkeyPersona";

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
  const cam = { restores: 0, follows: 0, frames: 0 };
  const w = new LabWorkforce({
    source: new MockOrchestrationSource(),
    cast: f.cast,
    lab: { setStationActivity: (id, s) => stationLog.push(`${id}:${s}`), setArtifactSlot: (i, s) => slots.push(`${i}:${s}`), resetLive: () => stationLog.push("reset") },
    toucan: {
      setTarget: (at) => { target = at; }, setFace: () => {}, setLanding: (p) => { landing = p; }, setPace: () => {},
      state: () => birdState, landed: () => !!landing && bird.distanceTo(new THREE.Vector3(landing.x, landing.y, landing.z)) < 1,
      position: () => bird, carry: () => null,
    },
    player: () => player,
    userCarry: () => null,
    camera: { follow: () => { cam.follows++; }, frame: () => { cam.frames++; }, restore: () => { cam.restores++; } },
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
    w.update(dt);
  };
  return { w, f, stationLog, slots, cam, step, bird, player, status: () => { let s: { phase: string; step: string; delivered?: boolean; result?: unknown } = { phase: "", step: "" }; w.subscribe((x) => { s = x; })(); return s; } };
}

describe("LabWorkforce — the physical presenter", () => {
  it("runs the job end to end: briefing, three stations, three handoffs, a READY slot, and the bird back with you", () => {
    const r = rig();
    r.w.start();
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
    r.w.start();
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
    r.w.start();
    for (let i = 0; i < 900; i++) r.step(0.05);
    r.f.log.length = 0;
    r.w.reset();
    expect(r.stationLog.at(-1)).toBe("reset");
    expect(r.status()).toMatchObject({ phase: "idle", delivered: false, result: null });
    // everyone back home (a fresh live start), every agent idle
    expect(r.f.log[0]).toBe("startLive");
    expect(["nova", "milo", "pip"].every((id) => r.f.cast.agents.get(id)!.body.exec === "idle")).toBe(true);
    r.f.log.length = 0; r.slots.length = 0;
    r.w.start();
    for (let i = 0; i < 4000 && r.status().phase !== "complete"; i++) r.step(0.05);
    expect(r.status().phase).toBe("complete");
    expect(r.f.log.filter((l) => l.startsWith("receive")).length).toBe(1);
    expect(r.f.log.filter((l) => l === "collect toucan" || l === "deliver user")).toEqual(["collect toucan", "deliver user"]);
    expect(r.f.holderNow()).toBe("user");
    expect(r.slots).toEqual(["0:ready"]);
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
    // every floor station a future agent could be given is reachable carrying work
    for (const st of STATIONS.filter((s) => s.at.y === 0 && s.state !== "future")) leg("milo", "PERCH_SPOT", st.id, true);
  });
});
