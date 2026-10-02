// vo3d avatar — THE MONKEYAGENT CAST RUNNER: real MonkeyAgents on a traversal graph, driven by a timed scenario.
//
// A scenario is a list of timed REQUESTS — go to a destination, pick up / put down a packet, hand it over,
// look at someone or something, talk. `seek(t)` replays them from scratch (they are deterministic) and poses
// every agent at t, so any instant can be shown or captured exactly. It decides nothing about jobs: it is the
// physical-presentation harness the playground and the AI Lab V2 blockout share, and the shape the
// orchestration presenter drives (destinations, never coordinates).
//
// LIVE MODE (app/labWorkforce): `startLive(homes)` begins an open-ended scenario and `issue(cmd)` appends each
// request at the runner's own clock as the presenter decides it — the same request types, the same scheduling
// rules, so a live run is exactly a scenario that is being written while it plays.
import * as THREE from "three";
import { MonkeyAgentBody } from "./MonkeyAgentBody";
import { FOUNDER_IDENTITIES } from "../world/monkeyIdentities";
import { MonkeyLocomotion, WorkPacket, HANDOFF_S } from "./MonkeyLocomotion";
import { personaFor } from "../world/monkeyPersona";
import type { TraversalGraph } from "../world/monkeyTraversal";
import type { AgentAssignment, AgentExecState } from "../world/monkeyAgentContract";
import { AgentPillBoard } from "./agentPills";

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
/** something that holds a packet: where it is right now (null = cannot say this frame) */
export type Carrier = (out: THREE.Matrix4) => THREE.Matrix4 | null;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const tmA = new THREE.Matrix4(), tmB = new THREE.Matrix4();
const bp = [new THREE.Vector3(), new THREE.Vector3()], bq = [new THREE.Quaternion(), new THREE.Quaternion()], bs = new THREE.Vector3();
/** an eased blend between two rigid placements (an arc over the top, so a hand-over never clips through a body) */
function blendMatrix(a: THREE.Matrix4, b: THREE.Matrix4, k: number, out: THREE.Matrix4): THREE.Matrix4 {
  const e = k * k * (3 - 2 * k);
  a.decompose(bp[0], bq[0], bs); b.decompose(bp[1], bq[1], bs);
  const p = bp[0].lerp(bp[1], e); p.y += Math.sin(Math.PI * e) * 3;
  return out.compose(p, bq[0].slerp(bq[1], e), bs.set(1, 1, 1));
}

export class MonkeyCastRunner {
  readonly root = new THREE.Group();
  /** the packets live apart from the cast: a packet the Toucan or the user is holding must stay visible wherever
   *  they are, even with the Lab (and so the cast) hidden */
  readonly packetRoot = new THREE.Group();
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
  /** LIVE: a packet held by something that is not an agent (the Toucan), and its glide into an agent's hands */
  private external = new Map<string, (out: THREE.Matrix4) => THREE.Matrix4 | null>();
  /** a packet moving between two holders that are not both agents (rest → beak, beak → hands, beak → the user) */
  private glides = new Map<string, { t0: number; t1: number; from: Carrier; to: Carrier; land: () => void }>();
  /** LIVE: who is speaking right now (the presenter's bubbles), on top of a scenario's say windows */
  private liveSpeaking = new Set<string>();
  /** THE PILLS, on the existing employee overhead layer — drawn only for agents that are */
  readonly pills = new AgentPillBoard(() => [...this.agents.values()].filter((a) => this.present.has(a.id)).map((a) => a.body), (b) => this.root.visible && b.root.visible);

  readonly graph: TraversalGraph;
  readonly scenarios: Readonly<Record<string, CastScenario>>;

  constructor(graph: TraversalGraph, scenarios: Readonly<Record<string, CastScenario>>, packets: readonly (readonly [string, number])[] = [["design", 0x7fb3ff], ["build", 0x8fe0a8], ["review", 0xffcf7a]]) {
    this.graph = graph;
    this.scenarios = scenarios;
    this.root.name = "monkey-cast";
    this.scenario = Object.values(scenarios)[0];
    this.packetRoot.name = "monkey-cast-packets";
    for (const [id, tint] of packets) { const p = new WorkPacket(tint); this.packets.set(id, p); this.packetRoot.add(p.root); }
  }

  async load(ids = ["milo", "nova", "pip"]): Promise<void> {
    for (const identity of FOUNDER_IDENTITIES.filter((i) => ids.includes(i.id))) {
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
    for (const c of sc.cmds) this.run(c);
  }

  /** one request, scheduled by the same rules whether it came from a scenario or live */
  private run(c: CastCmd): void {
    if (c.op === "go") this.agents.get(c.a)?.loco.goTo(c.to, c.t);
    // a pick-up (or a drop) happens when the agent is free to do it — where its last request left it
    else if (c.op === "carry") { const a = this.agents.get(c.a); if (a) a.loco.setCarry(c.packet ? this.packets.get(c.packet) ?? null : null, Math.max(c.t, a.loco.freeAt)); }
    else if (c.op === "place") {
      const a = this.agents.get(c.a);
      if (!a) return;
      const t = Math.max(c.t, a.loco.freeAt);
      a.loco.setCarry(null, t);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...c.at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw ?? 0), new THREE.Vector3(1, 1, 1));
      const list = this.rests.get(c.packet) ?? [];
      list.push({ t, m });
      this.rests.set(c.packet, list);
    } else if (c.op === "attend") {
      const a = this.agents.get(c.a);
      if (!a) return;
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
      if (!g || !r || !p) return;
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

  seek(t: number): void {
    this.schedule();
    this.t = t;
    this.frame(0);
  }

  /** `draw` false: the clock still runs (a live job keeps going while the Lab is off screen) but nothing is posed */
  advance(dt: number, camera: THREE.Camera | null = null, viewportH = 900, draw = true): void {
    if (!this.paused) this.t += dt;
    if (draw) this.frame(dt, camera, viewportH);
    else { this.track(); this.placePackets(false); }
  }
  /** NOT DRAWN, STILL TRUE: every present agent's pose is sampled (pure maths — no skinning, no animation), so a live
   *  job shown with the Lab off screen (Office View, an indoor view) reads real positions in its physical gates and
   *  the residence's comings and goings still happen. */
  private track(): void {
    const t = this.t;
    for (const a of this.agents.values()) {
      if (!this.present.has(a.id)) continue;
      a.loco.pose(t);
      if (this.retiring.get(a.id) === a.loco.nodeAt(t) && a.loco.freeAt <= t) { this.retiring.delete(a.id); this.present.delete(a.id); a.body.root.visible = false; this.pills.emit(); }
    }
  }

  // ============================== LIVE MODE ====================================================================
  /** Begin an open-ended live scenario: everyone in `start` at their node, nothing scheduled, the clock at 0.
   *  Also the RESET: any previous live run, packet, bubble and state is gone. */
  startLive(start: CastScenario["start"]): void {
    this.scenario = { id: "live", note: "live orchestration", start, cmds: [], length: Infinity };
    this.external.clear(); this.glides.clear(); this.liveSpeaking.clear(); this.retiring.clear();
    for (const p of this.packets.values()) p.root.visible = false;
    this.seek(0);
    for (const a of this.agents.values()) a.body.speaking = false;
    this.pills.clear();
  }
  /** a live request, at the runner's own clock (or later, by the request's own rules) */
  issue(c: DistributiveOmit<CastCmd, "t"> & { t?: number }): void {
    const cmd = { ...c, t: c.t ?? this.t } as CastCmd;
    (this.scenario.cmds as CastCmd[]).push(cmd);
    this.run(cmd);
  }
  /** the node a destination name resolves to (a node id passes through) */
  nodeOf(dest: string): string { return this.graph.destinations[dest] ?? dest; }
  /** ARRIVED AND STILL: at this destination, nothing left to do there that was asked of it */
  isAt(id: string, dest: string): boolean {
    const a = this.agents.get(id);
    return !!a && a.loco.freeAt <= this.t && a.loco.nodeAt(this.t) === this.nodeOf(dest);
  }
  /** nothing scheduled any more (arrived, handed over, settled) */
  isFree(id: string): boolean { const a = this.agents.get(id); return !!a && a.loco.freeAt <= this.t; }
  /** when it will next be free (its last plan / handoff ends) */
  freeAt(id: string): number { return this.agents.get(id)?.loco.freeAt ?? Infinity; }
  isPresent(id: string): boolean { return this.present.has(id); }
  /** where it is now, on the floor plane (null before its first pose) */
  positionOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const p = this.agents.get(id)?.loco.lastPose?.pos;
    return p ? out.copy(p) : null;
  }
  /** its head, for look-at / speaker targets */
  headOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const p = this.positionOf(id, out);
    return p ? p.setY(p.y + 30) : null;
  }
  /** who holds a packet right now (an agent id, "external", or null when it rests / is nowhere) */
  holderOf(packet: string): string | null {
    const p = this.packets.get(packet);
    if (!p) return null;
    for (const a of this.agents.values()) if (this.present.has(a.id) && a.loco.carrying(this.t) === p) return a.id;
    if (this.glides.has(packet)) return "external";
    return this.external.has(packet) ? "external" : null;
  }
  /** a packet held by something that is not an agent (the Toucan): drawn at whatever `carrier` returns */
  holdExternally(packet: string, carrier: ((out: THREE.Matrix4) => THREE.Matrix4 | null) | null): void {
    if (carrier) this.external.set(packet, carrier); else this.external.delete(packet);
  }
  /** THE BEAK-TO-HANDS TRANSFER: an externally held packet glides into an agent's hands over `dur`, and is
   *  the agent's from then on. Returns when it lands (runner time). */
  receiveFromExternal(packet: string, agent: string, dur = 1.1): number {
    const a = this.agents.get(agent), p = this.packets.get(packet), from = this.external.get(packet);
    if (!a || !p || !from) return this.t;
    const t0 = Math.max(this.t, a.loco.freeAt), t1 = t0 + dur;
    this.glides.set(packet, { t0, t1, from, to: (out) => a.loco.holdMatrix(out), land: () => this.external.delete(packet) });
    a.loco.busyUntil = Math.max(a.loco.busyUntil, t1 + 0.3);
    a.loco.setCarry(p, t1);
    return t1;
  }
  /** THE PICK-UP FROM A SURFACE: a packet resting where an agent set it down (the result dock) lifts into an
   *  external holder (the Toucan's beak), which carries it from then on. Returns when it lands. */
  collectToExternal(packet: string, carrier: Carrier, dur = 1): number {
    const rest = (this.rests.get(packet) ?? []).filter((r) => r.t <= this.t).at(-1);
    if (!rest || this.holderOf(packet) !== null) return this.t;
    const at = rest.m.clone(), t0 = this.t, t1 = t0 + dur;
    this.glides.set(packet, { t0, t1, from: (out) => out.copy(at), to: carrier, land: () => this.external.set(packet, carrier) });
    return t1;
  }
  /** THE PASS BETWEEN EXTERNAL HOLDERS: the Toucan presents the packet to the user, who holds it from then on */
  passExternal(packet: string, carrier: Carrier, dur = 1.2): number {
    const from = this.external.get(packet);
    if (!from) return this.t;
    const t0 = this.t, t1 = t0 + dur;
    this.glides.set(packet, { t0, t1, from, to: carrier, land: () => this.external.set(packet, carrier) });
    return t1;
  }
  setPacketTint(packet: string, hex: number): void { this.packets.get(packet)?.setTint(hex); }
  /** a packet by id, made on first use (a live job brings its own; the proof scenarios use theirs) */
  ensurePacket(id: string, tint: number): WorkPacket {
    let p = this.packets.get(id);
    if (!p) { p = new WorkPacket(tint); p.root.visible = false; this.packets.set(id, p); this.packetRoot.add(p.root); }
    return p;
  }
  /** the presenter's speech: the body's mouth moves while its bubble is up */
  setSpeaking(id: string, on: boolean): void { if (on) this.liveSpeaking.add(id); else this.liveSpeaking.delete(id); }
  /** THE ONLY STATE INPUT for a cast member (identity never changes): face, clip and pill follow it */
  setExec(id: string, exec: AgentExecState, assignment?: AgentAssignment | null): void {
    const a = this.agents.get(id);
    if (!a) return;
    a.body.setExec(exec, assignment === undefined ? a.body.assignment : assignment);
    this.pills.emit();
  }
  /** THE RESIDENCE SEAM: bring an agent that is not on stage into the world INSIDE the residence (not drawn
   *  until its route leaves through a door — the traversal graph's interior links), so a population manager
   *  can summon a hidden agent with one call and then send it anywhere. */
  enterFromResidence(id: string, insideNode = "RESIDENCE_INSIDE"): boolean {
    const a = this.agents.get(id);
    if (!a || this.present.has(id)) return false;
    this.present.add(id);
    a.loco = new MonkeyLocomotion(a.body, this.graph, a.loco.profile, this.nodeOf(insideNode), 0);
    a.body.root.visible = false;
    (this.scenario.start as Record<string, { node: string }>)[id] = { node: this.nodeOf(insideNode) };
    return true;
  }
  /** …and the reverse: walk it home into the residence; once inside it leaves the rendered population */
  retireToResidence(id: string, insideNode = "RESIDENCE_INSIDE"): void {
    if (!this.present.has(id)) return;
    this.issue({ a: id, op: "go", to: insideNode });
    this.retiring.set(id, this.nodeOf(insideNode));
  }
  private retiring = new Map<string, string>();

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
      a.body.speaking = this.liveSpeaking.has(a.id) || this.sayWindows.some((w) => w.a === a.id && t >= w.t0 && t <= w.t1);
      // a retiring agent that has got inside leaves the rendered population
      if (this.retiring.get(a.id) === a.loco.nodeAt(t) && a.loco.freeAt <= t) { this.retiring.delete(a.id); this.present.delete(a.id); a.body.root.visible = false; this.pills.emit(); }
    }
    // the second pass lets a handoff partner read the other's pose from this frame
    for (const a of this.agents.values()) if (this.present.has(a.id)) { a.loco.pose(t); if (a.body.root.visible) a.body.update(dt > 0 ? dt : 1 / 60, camera, viewportH); }
    this.placePackets(true);
  }

  /** WHERE EVERY PACKET IS: in an agent's hands, gliding between holders, held by the Toucan or the user, or
   *  resting where it was set down. With the cast not drawn, only packets outside the Lab (external) are shown. */
  private placePackets(drawn: boolean): void {
    const t = this.t;
    for (const [id, p] of this.packets) {
      const m = new THREE.Matrix4();
      let placed = false;
      const g = this.glides.get(id);
      if (g && t >= g.t1) { this.glides.delete(id); g.land(); }
      if (drawn) for (const a of this.agents.values()) if (this.present.has(a.id) && a.loco.packetMatrix(p, m)) { placed = true; break; }
      const glide = this.glides.get(id);
      if (!placed && glide) {
        const from = glide.from(tmA), to = glide.to(tmB);
        if (from && to) { blendMatrix(from, to, t <= glide.t0 ? 0 : (t - glide.t0) / (glide.t1 - glide.t0), m); placed = true; }
      }
      const ext = this.external.get(id);
      if (!placed && !glide && ext && ext(m)) placed = true;
      if (!placed && drawn && !ext && !glide) {
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
