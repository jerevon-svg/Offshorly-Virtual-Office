// vo3d avatar — THE MONKEYAGENT CAST RUNNER: real MonkeyAgents on a traversal graph, driven by a timed scenario.
//
// A scenario is a list of timed REQUESTS — go to a destination, pick up / put down a packet, hand it over,
// look at someone or something, talk. `seek(t)` replays them from scratch (they are deterministic) and poses
// every agent at t, so any instant can be shown or captured exactly. It decides nothing about jobs: it is the
// physical-presentation harness the playground and the AI Lab V2 blockout share, and the shape the
// orchestration presenter will drive later (destinations, never coordinates).
import * as THREE from "three";
import { MonkeyAgentBody } from "./MonkeyAgentBody";
import { DEMO_IDENTITIES } from "./MonkeyAgentProof";
import { MonkeyLocomotion, WorkPacket, HANDOFF_S } from "./MonkeyLocomotion";
import { personaFor } from "../world/monkeyPersona";
import type { TraversalGraph } from "../world/monkeyTraversal";

/** A scenario request. `t` is the earliest it may start; `go` and `place` also wait for the agent's previous plan. */
export type CastCmd =
  | { t: number; a: string; op: "go"; to: string }
  | { t: number; a: string; op: "carry"; packet: string | null }
  | { t: number; a: string; op: "place"; packet: string; at: readonly [number, number, number]; yaw?: number }
  | { t: number; op: "handoff"; giver: string; receiver: string; packet: string }
  | { t: number; a: string; op: "attend"; target: string | readonly [number, number, number] | null; afterArrival?: boolean }
  | { t: number; a: string; op: "say"; dur: number; afterArrival?: boolean }
  /** stay where you are, doing what the place is for (working, resting), for `dur` after arriving */
  | { t: number; a: string; op: "wait"; dur: number };
/** where each agent starts, and the requests it receives (run in AUTHORED order: `go(0, …)` reads "and then";
 *  `afterArrival` makes a look / a line wait until the agent has got where it was going) */
export type CastScenario = { id: string; note: string; start: Record<string, { node: string; yaw?: number }>; cmds: readonly CastCmd[]; length: number };

export type CastAgent = { id: string; body: MonkeyAgentBody; loco: MonkeyLocomotion };

export class MonkeyCastRunner {
  readonly root = new THREE.Group();
  readonly agents = new Map<string, CastAgent>();
  readonly packets = new Map<string, WorkPacket>();
  scenario: CastScenario;
  /** a paused runner holds its clock (captures seek it explicitly) */
  paused = false;
  t = 0;
  private sayWindows: { a: string; t0: number; t1: number }[] = [];
  /** the agents this scenario has in the world (drawn unless inside the residence) */
  private readonly present = new Set<string>();
  /** where unheld packets rest, by time */
  private rests = new Map<string, { t: number; m: THREE.Matrix4 }[]>();

  readonly graph: TraversalGraph;
  readonly scenarios: Readonly<Record<string, CastScenario>>;

  constructor(graph: TraversalGraph, scenarios: Readonly<Record<string, CastScenario>>, packets: readonly (readonly [string, number])[] = [["design", 0x7fb3ff], ["build", 0x8fe0a8], ["review", 0xffcf7a]]) {
    this.graph = graph;
    this.scenarios = scenarios;
    this.root.name = "monkey-cast";
    this.scenario = Object.values(scenarios)[0];
    for (const [id, tint] of packets) { const p = new WorkPacket(tint); this.packets.set(id, p); this.root.add(p.root); }
  }

  async load(ids = ["milo", "nova", "pip"]): Promise<void> {
    for (const identity of DEMO_IDENTITIES.filter((i) => ids.includes(i.id))) {
      const body = new MonkeyAgentBody(identity);
      await body.load();
      const loco = new MonkeyLocomotion(body, this.graph, personaFor(identity.id).profile, this.graph.nodes[0].id);
      this.agents.set(identity.id, { id: identity.id, body, loco });
      this.root.add(body.root);
    }
  }

  play(id: string): void {
    this.scenario = this.scenarios[id] ?? Object.values(this.scenarios)[0];
    this.seek(0);
  }

  private schedule(): void {
    const sc = this.scenario;
    this.sayWindows = [];
    this.rests = new Map();
    for (const [id, a] of this.agents) {
      const st = sc.start[id];
      a.body.root.visible = !!st;
      if (st) this.present.add(id); else this.present.delete(id);
      a.loco = new MonkeyLocomotion(a.body, this.graph, a.loco.profile, st?.node ?? this.graph.nodes[0].id, st?.yaw ?? this.graph.nodes.find((n) => n.id === st?.node)?.yaw ?? 0);
    }
    for (const p of this.packets.values()) p.holder = null;
    for (const c of sc.cmds) {
      if (c.op === "go") this.agents.get(c.a)?.loco.goTo(c.to, c.t);
      // a pick-up (or a drop) happens when the agent is free to do it — where its last request left it
      else if (c.op === "carry") { const a = this.agents.get(c.a); if (a) a.loco.setCarry(c.packet ? this.packets.get(c.packet) ?? null : null, Math.max(c.t, a.loco.freeAt)); }
      else if (c.op === "place") {
        const a = this.agents.get(c.a);
        if (!a) continue;
        const t = Math.max(c.t, a.loco.freeAt);
        a.loco.setCarry(null, t);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(...c.at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw ?? 0), new THREE.Vector3(1, 1, 1));
        const list = this.rests.get(c.packet) ?? [];
        list.push({ t, m });
        this.rests.set(c.packet, list);
      } else if (c.op === "attend") {
        const a = this.agents.get(c.a);
        if (!a) continue;
        const t = c.afterArrival ? Math.max(c.t, a.loco.freeAt) : c.t;
        const tg = c.target;
        if (tg === null) a.loco.attend(null, t);
        else if (typeof tg === "string") {
          const other = this.agents.get(tg);
          if (other) a.loco.attend(() => (other.loco.lastPose?.pos.clone() ?? new THREE.Vector3()).add(new THREE.Vector3(0, 24, 0)), t);
        } else { const p = new THREE.Vector3(...tg); a.loco.attend(() => p, t); }
      } else if (c.op === "wait") {
        const a = this.agents.get(c.a);
        if (a) a.loco.busyUntil = Math.max(c.t, a.loco.freeAt) + c.dur;
      } else if (c.op === "say") {
        const a = this.agents.get(c.a);
        const t = c.afterArrival && a ? Math.max(c.t, a.loco.freeAt) : c.t;
        this.sayWindows.push({ a: c.a, t0: t, t1: t + c.dur });
      }
      else if (c.op === "handoff") {
        const g = this.agents.get(c.giver), r = this.agents.get(c.receiver), p = this.packets.get(c.packet);
        if (!g || !r || !p) continue;
        const t0 = Math.max(c.t, g.loco.freeAt, r.loco.freeAt);
        const h = { giver: g.loco, receiver: r.loco, packet: p, t0 };
        // a handoff OCCUPIES both of them: neither walks off until the packet has changed hands and settled
        g.loco.busyUntil = Math.max(g.loco.busyUntil, t0 + HANDOFF_S.settle);
        r.loco.busyUntil = Math.max(r.loco.busyUntil, t0 + HANDOFF_S.settle);
        g.loco.handoffs.push(h); r.loco.handoffs.push(h);
        g.loco.setCarry(null, t0 + HANDOFF_S.transfer);
        r.loco.setCarry(p, t0 + HANDOFF_S.transfer);
      }
    }
  }

  seek(t: number): void {
    this.schedule();
    this.t = t;
    this.frame(0);
  }

  advance(dt: number, camera: THREE.Camera | null = null, viewportH = 900): void {
    if (!this.paused) this.t += dt;
    this.frame(dt, camera, viewportH);
  }

  /** when a scheduled agent's last plan ends (for "what is everyone doing" read-outs) */
  timeline(): { id: string; freeAt: number; node: string }[] {
    return [...this.agents.values()].filter((a) => this.present.has(a.id)).map((a) => ({ id: a.id, freeAt: a.loco.freeAt, node: a.loco.node }));
  }

  private frame(dt: number, camera: THREE.Camera | null = null, viewportH = 900): void {
    const t = this.t;
    for (const a of this.agents.values()) {
      if (!this.present.has(a.id)) continue;
      a.loco.pose(t);
      // INSIDE THE RESIDENCE (or on its way through it): not drawn — the seam a population manager will use
      a.body.root.visible = !a.loco.hidden;
      a.body.speaking = this.sayWindows.some((w) => w.a === a.id && t >= w.t0 && t <= w.t1);
    }
    // the second pass lets a handoff partner read the other's pose from this frame
    for (const a of this.agents.values()) if (this.present.has(a.id)) { a.loco.pose(t); if (a.body.root.visible) a.body.update(dt > 0 ? dt : 1 / 60, camera, viewportH); }
    for (const [id, p] of this.packets) {
      const m = new THREE.Matrix4();
      let placed = false;
      for (const a of this.agents.values()) if (this.present.has(a.id) && a.loco.packetMatrix(p, m)) { placed = true; break; }
      if (!placed) {
        const rest = (this.rests.get(id) ?? []).filter((r) => r.t <= t).at(-1);
        // a rest only counts once nobody has picked the packet up again since
        const heldSince = [...this.agents.values()].some((a) => a.loco.carrying(t) === p);
        if (rest && !heldSince) { m.copy(rest.m); placed = true; }
      }
      p.root.visible = placed;
      if (placed) { p.root.matrixAutoUpdate = false; p.root.matrix.copy(m); p.root.matrixWorldNeedsUpdate = true; }
    }
  }
}
