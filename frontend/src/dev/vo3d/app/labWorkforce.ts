// vo3d app — THE PHYSICAL AI WORKFORCE (Phase 4): orchestration events in, a physical Lab out.
// DEV-ONLY, behind `?ailab=v2&aidemo=1` (see world.ts).
//
//   Human = intent + judgment · Toucan = knowledge + communication + orchestration · MonkeyAgents = execution
//
// THIS FILE DECIDES NOTHING ABOUT THE JOB. It subscribes to an OrchestrationSource (world/agentOrchestration —
// today the deterministic mock, later an Agent Harness adapter) and decides only HOW each event is shown, using
// what the world already has:
//   job.created/accepted → the Toucan comes to you with the job (the work packet, in its beak)
//   job.dispatched       → it flies to the Lab and LANDS on the briefing perch; the team, at home, notices it and
//                          comes down to the briefing ring by its own routes (their personas pick them)
//   message              → the existing speech bubble over the speaker; listeners turn to it
//   agent.assigned       → the assignment record; a compatible free station is chosen (labStations.assignStation)
//                          and WAKES
//   work.handoff         → the packet physically changes hands: beak → hands under the perch, or agent → agent
//                          at the handoff spot that suits the pair (the runner's own handoff)
//   agent.state working  → the agent walks to its station, sets the packet down, and the screens WORK
//   agent.state done     → screens DONE, the packet is picked up again
//   agent.state idle     → the agent goes home; its station settles back to standby
//   artifact.ready       → the holder docks the packet at the result gallery; one slot turns READY (its lamp too)
//   artifact.collected   → the Toucan hops from the perch to that dock and lifts the SAME packet into its beak
//   job.completed        → the Toucan leaves the Lab and flies all the way back to you, carrying it
//   artifact.delivered   → beside you, it passes the packet into your hands; View Result is offered
//
// THE ONE PRESENTATION CLOCK: an event is shown no sooner than the source sent it, and later only while the
// scene physically catches up (a flight, a walk, a hand-over). Held events replay with the source's own
// spacing, so reported work still reads as its reported length. A walk is never cut short and a state is never
// invented. Every physical request is a DESTINATION (traversal graph names, station ids), never a coordinate.
import * as THREE from "three";
import type { ArtifactResult, OrchestrationEvent, OrchestrationSource } from "../world/agentOrchestration";
import { DEMO_COMMAND } from "../world/agentOrchestration";
import type { Carrier, MonkeyCastRunner } from "../avatar/MonkeyCastRunner";
import { HANDOFF_S } from "../avatar/MonkeyLocomotion";
import type { ToucanSummonState } from "../../../components/OfficeMap/toucanSummon";
import { parkPointFor } from "../../../components/OfficeMap/toucanSummon";
import type { Rect } from "../core/coords";
import type { AiLabDemoStatus } from "./aiLabDemo";
import { ARTIFACT, HANDOFFS, LAB2_FLOOR_Y, PERCH_SPOT, TOUCAN_PERCH } from "../world/ailabV2";
import { STATIONS, assignStation, stationTemplate, toWorld, workForRole, type StationDef } from "../world/labStations";
import { LAB_RESIDENTS, residentFor } from "../world/labPopulation";
import type { ScreenState } from "../build/labMaterials";
import type { ArtifactSlotState } from "../build/labWork";

export type LabWorkforceDeps = {
  source: OrchestrationSource;
  cast: MonkeyCastRunner;
  lab: {
    setStationActivity(id: string, state: ScreenState | null): void;
    setArtifactSlot(index: number, state: ArtifactSlotState): void;
    resetLive(): void;
  };
  toucan: {
    /** the summon centre (the bird parks beside it); null = release */
    setTarget(at: { x: number; z: number } | null): void;
    setFace(at: { x: number; z: number } | null): void;
    setLanding(at: { x: number; y: number; z: number } | null): void;
    /** how much faster than a summon its long errands fly (1 = V1's summon timing) */
    setPace(k: number): void;
    state(): ToucanSummonState;
    landed(): boolean;
    position(): THREE.Vector3;
    /** where a packet hangs from its beak */
    carry(out: THREE.Matrix4): THREE.Matrix4 | null;
  };
  player(): { x: number; z: number };
  /** where a packet sits in the user's hands (their avatar's body frame) */
  userCarry: Carrier;
  camera: {
    follow(get: () => { x: number; z: number }, half?: { w: number; d: number }): void;
    frame(rect: Rect): void;
    restore(): void;
  };
  /** can the job be shown now (the Lab is on Floor 1) */
  available(): boolean;
};

/** the one physical work packet a job travels in */
const PACKET = "job";
/** what the packet looks like as the work matures: the brief, the design, the build, the reviewed result */
const PACKET_TINT = { brief: 0xf1ead8, design: 0x7fb3ff, build: 0x8fe0a8, review: 0xffcf7a, ready: 0x7fe0c8 } as const;
const STAGE_TINT: Readonly<Record<string, number>> = { design: PACKET_TINT.design, build: PACKET_TINT.build, review: PACKET_TINT.review };
/** the perch in world space (the Lab group sits at the floor datum) */
const PERCH = { x: TOUCAN_PERCH.x, y: TOUCAN_PERCH.y + LAB2_FLOOR_Y, z: TOUCAN_PERCH.z };
/** the Lab errand flies this much faster than a summon (V1's 99 u/s, capped at 18 s, crosses campus too slowly) */
const ERRAND_PACE = 1.6;
/** the team starts to stir when the bird is this close to the perch */
const WAKE_RANGE = 340;
/** a toucan that cannot reach you within this long carries on anyway */
const MEET_TIMEOUT_S = 15;
/** the briefing starts when everyone is on the ring — or after this long, whoever is there */
const GATHER_TIMEOUT_S = 40;
/** SAFETY ONLY: a physical gate that has not opened after this long is let through (logged), so a broken route
 *  can never strand the demo. It never fires in a healthy run. */
const GATE_TIMEOUT_S = 60;
/** a station keeps showing DONE this long after its agent has left, then goes back to standby */
const DONE_HOLD_S = 8;
/** the camera's framing sizes (half extents) */
const CAM = { flight: { w: 260, d: 170 }, agent: { w: 190, d: 125 }, pair: { w: 230, d: 150 } } as const;
const TREEHOUSE: Rect = { x: 540, z: -900, w: 400, d: 380 };
const BRIEFING_FRAME: Rect = { x: 590, z: -690, w: 300, d: 210 };

type BirdStage = "standby" | "toUser" | "atUser" | "toLab" | "atLab" | "leaving" | "back";
type Item = { e: OrchestrationEvent; at: number; prepared: boolean; gateSince: number; t1?: number; slot?: number };
type Spot = { x: number; y: number; z: number };
/** where the bird stands on the delivery counter to collect from a dock: just behind and beside the packet */
const dockLanding = (slot: number): Spot => {
  const d = ARTIFACT.docks[slot % ARTIFACT.docks.length];
  return { x: d.x + 7, y: ARTIFACT.counter.h + LAB2_FLOOR_Y + 0.5, z: d.z - 3 };
};
type AgentJob = { role?: string; station?: StationDef };

const v = new THREE.Vector3();

export class LabWorkforce {
  private bird: BirdStage = "standby";
  private birdT = 0;
  private queue: Item[] = [];
  private clock = 0;
  private lag = 0;
  private hold = 0;
  private speaking: string | null = null;
  private team: string[] = [];
  private woke = false;
  private wokeAt = 0;
  private gathered = false;
  private briefFramed = false;
  private jobs = new Map<string, AgentJob>();
  private occupied = new Set<string>();
  private releases: { station: string; at: number }[] = [];
  private filledSlots = new Set<number>();
  /** where in the Lab the bird is standing: the briefing perch, or a result dock it is collecting from */
  private labSpot: Spot = PERCH;
  /** artifact id → the gallery slot it was docked in */
  private slotOf = new Map<string, number>();
  /** WHO OWNS THE WORK right now, as the job says (toucan → agents → artifact → toucan → user); the packet shows it */
  private owner: string | null = null;
  private owners: string[] = [];
  private own(who: string): void { this.owner = who; this.owners.push(who); }
  /** the finished deliverable (from artifact.ready), handed to the HUD on delivery */
  private result: ArtifactResult | null = null;
  private pending: { at: number; run: () => void }[] = [];
  private firstStation = true;
  private status: AiLabDemoStatus;
  private listeners = new Set<(s: AiLabDemoStatus) => void>();
  private unsub: () => void;
  private readonly deps: LabWorkforceDeps;
  private ready = false;

  constructor(deps: LabWorkforceDeps) {
    this.deps = deps;
    this.status = { phase: "idle", step: "", source: deps.source.kind, transcript: [] };
    this.unsub = deps.source.subscribe((e) => this.queue.push({ e, at: this.clock, prepared: false, gateSince: -1 }));
  }

  // ---- the HUD's side (the same chip and status shape as the V1 hall's presenter) -------------------------
  subscribe(fn: (s: AiLabDemoStatus) => void): () => void {
    this.listeners.add(fn); fn(this.status);
    return () => { this.listeners.delete(fn); };
  }
  private setStatus(patch: Partial<AiLabDemoStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  /** the one demo command */
  start(): void {
    if (!this.deps.available()) { this.setStatus({ phase: "idle", step: "The AI Lab is on Floor 1" }); return; }
    this.reset();
    this.deps.source.submit(DEMO_COMMAND);
  }

  /** EVERYTHING BACK: no job, the bird with you, every agent at home and idle, stations in standby, the
   *  packet gone, the gallery empty, no bubbles, the camera yours again. Rerunnable at any moment. */
  reset(): void {
    const { source, cast, lab, toucan } = this.deps;
    source.cancel();
    this.queue = []; this.hold = 0; this.speaking = null; this.lag = 0;
    if (this.bird !== "standby" && this.bird !== "atUser") this.deps.camera.restore();
    this.bird = "standby"; this.birdT = 0;
    this.team = []; this.woke = false; this.gathered = false; this.briefFramed = false; this.firstStation = true;
    this.jobs.clear(); this.occupied.clear(); this.releases = []; this.filledSlots.clear(); this.pending = [];
    this.labSpot = PERCH; this.slotOf.clear(); this.result = null; this.owner = null; this.owners = [];
    toucan.setFace(null); toucan.setLanding(null); toucan.setPace(1);
    if (cast.agents.size > 0) {
      cast.ensurePacket(PACKET, PACKET_TINT.brief);
      cast.startLive(this.homes());
      for (const id of cast.agents.keys()) cast.setExec(id, "idle", null);
      cast.setPacketTint(PACKET, PACKET_TINT.brief);
      this.ready = true;
    }
    lab.resetLive();
    this.setStatus({ phase: "idle", step: "", title: undefined, transcript: [], result: null, delivered: false });
  }

  /** where everyone is when nothing is happening: the founders at their homes (others stay inside) */
  private homes(): Record<string, { node: string }> {
    const out: Record<string, { node: string }> = {};
    for (const id of this.deps.cast.agents.keys()) {
      const r = LAB_RESIDENTS[id];
      if (r && !r.hidden) out[id] = { node: this.deps.cast.nodeOf(r.home) };
    }
    return out;
  }

  get running(): boolean { return this.status.phase === "running"; }

  // ---- small physical vocabulary on top of the runner ------------------------------------------------------
  /** GO SOMEWHERE (a destination name or station id): looking where it walks, not at whatever it last watched */
  private go(id: string, to: string): void {
    const { cast } = this.deps;
    cast.issue({ a: id, op: "attend", target: null });
    cast.issue({ a: id, op: "go", to });
  }
  private look(id: string, at: THREE.Vector3 | string | null, afterArrival = false): void {
    const target = at === null || typeof at === "string" ? at : ([at.x, at.y, at.z] as const);
    this.deps.cast.issue({ a: id, op: "attend", target, afterArrival });
  }
  private near(id: string, x: number, z: number, r: number): boolean {
    const p = this.deps.cast.positionOf(id, v);
    return !!p && Math.hypot(p.x - x, p.z - z) <= r;
  }
  /** summon a hidden agent out of the residence (the population seam); founders are already outside */
  private onStage(id: string): void {
    if (!this.deps.cast.isPresent(id)) this.deps.cast.enterFromResidence(id);
  }
  private name(id: string): string { return this.deps.cast.agents.get(id)?.body.identity.name ?? (id === "toucan" ? "Toucan" : id); }
  private later(s: number, run: () => void): void { this.pending.push({ at: this.clock + s, run }); }

  /** the summon CENTRE that makes the bird PARK at `park` (V1's parkPointFor puts it beside the centre) */
  private centreFor(park: { x: number; z: number }): { x: number; z: number } {
    const p = parkPointFor({ x: park.x, y: park.z });
    return { x: park.x - (p.x - park.x), z: park.z };
  }

  // ---- the camera: soft follow and framing, never a locked cutscene ----------------------------------------
  private follow(id: string, half: { w: number; d: number } = CAM.agent): void {
    this.deps.camera.follow(() => { const p = this.deps.cast.positionOf(id, v); return p ? { x: p.x, z: p.z } : { x: PERCH.x, z: PERCH.z }; }, half);
  }
  private followPair(a: string, b: string): void {
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    this.deps.camera.follow(() => {
      const A = this.deps.cast.positionOf(a, pa), B = this.deps.cast.positionOf(b, pb);
      if (A && B) return { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 };
      const one = A ?? B; return one ? { x: one.x, z: one.z } : { x: PERCH.x, z: PERCH.z };
    }, CAM.pair);
  }
  private followBird(): void {
    this.deps.camera.follow(() => { const p = this.deps.toucan.position(); return { x: p.x, z: p.z }; }, CAM.flight);
  }

  // ---- the frame ---------------------------------------------------------------------------------------
  update(dt: number): void {
    if (!this.ready) { if (this.deps.cast.agents.size > 0) this.reset(); else return; }
    this.clock += dt;
    this.deps.source.tick(dt);
    this.birdTravel(dt);
    this.timers();
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold > 0) return;
      this.endLine();
    }
    while (this.queue.length > 0 && this.hold <= 0) {
      const item = this.queue[0];
      // PREPARATION runs as soon as an event is next in line: the walk to where it will be shown starts now,
      // so the scene is ready by the time the source's spacing says to show it
      if (!item.prepared) { item.prepared = true; this.prepare(item); }
      if (this.clock < item.at + this.lag) break;
      if (!this.gate(item)) {
        if (item.gateSince < 0) item.gateSince = this.clock;
        if (this.clock - item.gateSince < GATE_TIMEOUT_S) break;
        console.warn("[vo3d] lab workforce: gate timed out, showing anyway:", item.e);
      }
      this.queue.shift();
      this.lag = Math.max(this.lag, this.clock - item.at);
      this.apply(item);
    }
  }

  private timers(): void {
    const { lab } = this.deps;
    for (const r of this.releases) if (this.clock >= r.at) lab.setStationActivity(r.station, null);
    this.releases = this.releases.filter((r) => this.clock < r.at);
    const due = this.pending.filter((p) => this.clock >= p.at);
    this.pending = this.pending.filter((p) => this.clock < p.at);
    for (const p of due) p.run();
  }

  /** THE BIRD'S LEG OF THE STORY, each frame */
  private birdTravel(dt: number): void {
    const t = this.deps.toucan;
    this.birdT += dt;
    const p = t.position();
    switch (this.bird) {
      case "standby": case "atUser": case "back":
        t.setTarget(this.deps.player());
        return;
      case "toUser":
        t.setTarget(this.deps.player());
        if (t.state() === "attending" || this.birdT > MEET_TIMEOUT_S) { this.enterBird("atUser"); this.setStatus({ step: "Toucan is with you" }); }
        return;
      case "toLab": {
        this.labSpot = PERCH;
        t.setTarget(this.centreFor(PERCH));
        t.setLanding(PERCH);
        // THE TEAM NOTICES: the bird coming in over the treehouse is what wakes them
        if (!this.woke && Math.hypot(p.x - PERCH.x, p.z - PERCH.z) < WAKE_RANGE) this.wake();
        if (t.landed()) {
          this.enterBird("atLab");
          t.setPace(1);
          if (!this.woke) this.wake();
          // the treehouse reveal: the homes, the routes down, the ring
          this.deps.camera.frame(TREEHOUSE);
          this.setStatus({ step: "Toucan is at the AI Lab" });
        }
        return;
      }
      case "atLab":
        // the perch, or a dock it has hopped over to (the same summon + landing, aimed at another spot)
        t.setTarget(this.centreFor(this.labSpot));
        t.setLanding(this.labSpot);
        if (!this.gathered && this.team.length > 0 && this.team.every((id) => this.deps.cast.isAt(id, residentFor(id).brief))) {
          this.gathered = true;
        }
        // the camera comes down to the ring once the first of them is there
        if (!this.briefFramed && this.team.some((id) => this.near(id, PERCH.x, PERCH.z + 50, 110))) {
          this.briefFramed = true;
          this.deps.camera.frame(BRIEFING_FRAME);
        }
        return;
      case "leaving": {
        t.setTarget(this.deps.player());
        // back when it is parked beside YOU (not merely still parked where it was a frame ago)
        const me = this.deps.player();
        if (t.state() === "attending" && Math.hypot(p.x - me.x, p.z - me.z) < 120) {
          this.enterBird("back");
          this.deps.toucan.setPace(1);
          // close on you for the hand-over
          this.deps.camera.follow(() => this.deps.player(), CAM.agent);
          // the camera stays on the bird through its report to you; it is handed back once the job is complete
          this.setStatus({ step: "Toucan is back with you" });
        }
        return;
      }
    }
  }
  private enterBird(s: BirdStage): void { this.bird = s; this.birdT = 0; }

  /** THE TEAM STIRS: each looks up at the bird, then — at its own pace — comes down from home to the ring */
  private wake(): void {
    this.woke = true; this.wokeAt = this.clock;
    for (const id of this.team) {
      this.onStage(id);
      this.look(id, new THREE.Vector3(PERCH.x, PERCH.y, PERCH.z));
      const r = residentFor(id);
      this.later(r.react, () => {
        this.go(id, r.brief);
        this.look(id, new THREE.Vector3(PERCH.x, PERCH.y, PERCH.z), true);
      });
    }
    this.setStatus({ step: "The team is gathering" });
  }

  // ---- PRESENTATION GATES: never about the job, only whether the scene can show this yet --------------------
  private prepare(item: Item): void {
    const { cast } = this.deps;
    const e = item.e;
    if (e.type === "agent.state" && (e.state === "working" || e.state === "reviewing")) {
      const st = this.jobs.get(e.agentId)?.station;
      if (st && !cast.isAt(e.agentId, st.id)) {
        this.go(e.agentId, st.id);
        // the packet goes down on the desk, at the operator's working hand
        const at = toWorld(st, 36, -20), y = st.at.y + stationTemplate(st).surfaceY + LAB2_FLOOR_Y + 0.36;
        cast.issue({ a: e.agentId, op: "place", packet: PACKET, at: [at.x, y, at.z], yaw: st.yaw });
        this.follow(e.agentId);
        this.setStatus({ step: `${this.name(e.agentId)} is heading to a ${st.type} station` });
      }
    } else if (e.type === "work.handoff") {
      if (e.from === "toucan") {
        // UNDER THE PERCH, facing the bird
        this.go(e.to, "PERCH_SPOT");
        this.look(e.to, new THREE.Vector3(PERCH.x, PERCH.y, PERCH.z), true);
        this.follow(e.to, CAM.pair);
      } else {
        const spot = this.handoffSpot(e.from, e.to);
        this.go(e.from, spot.give);
        this.go(e.to, spot.take);
        this.look(e.from, e.to, true);
        this.look(e.to, e.from, true);
        const t0 = Math.max(cast.t, cast.freeAt(e.from), cast.freeAt(e.to));
        cast.issue({ op: "handoff", giver: e.from, receiver: e.to, packet: PACKET });
        item.t1 = t0 + HANDOFF_S.transfer;
        this.followPair(e.from, e.to);
        this.setStatus({ step: `${this.name(e.from)} is taking the work to ${this.name(e.to)}` });
      }
    } else if (e.type === "artifact.ready") {
      const slot = [0, 1, 2, 3, 4, 5].find((i) => !this.filledSlots.has(i)) ?? 0;
      item.slot = slot;
      const dock = ARTIFACT.docks[slot % ARTIFACT.docks.length];
      this.go(e.by, `ARTIFACT_DOCK_${(slot % ARTIFACT.docks.length) + 1}`);
      cast.issue({ a: e.by, op: "place", packet: PACKET, at: [dock.x, ARTIFACT.counter.h + LAB2_FLOOR_Y + 0.86, dock.z], yaw: Math.PI });
      this.follow(e.by);
      this.setStatus({ step: `${this.name(e.by)} is delivering the result` });
    } else if (e.type === "artifact.collected") {
      // THE BIRD GOES TO THE RESULT: off the perch, onto the delivery counter beside the docked packet
      const slot = this.slotOf.get(e.artifactId) ?? 0;
      this.labSpot = dockLanding(slot);
      const d = ARTIFACT.docks[slot % ARTIFACT.docks.length];
      this.deps.toucan.setFace({ x: d.x, z: d.z });
      this.followBird();
      this.setStatus({ step: "Toucan is collecting the result" });
    } else if (e.type === "message" && e.to === "toucan" && e.from !== "toucan" && this.bird === "atLab") {
      // reporting to the bird is done in person, under its perch
      if (!this.near(e.from, PERCH_SPOT.x, PERCH_SPOT.z, 40)) {
        this.go(e.from, "PERCH_SPOT");
        this.look(e.from, new THREE.Vector3(PERCH.x, PERCH.y, PERCH.z), true);
        this.deps.camera.frame(BRIEFING_FRAME);
      }
    }
  }

  private gate(item: Item): boolean {
    const { cast } = this.deps;
    const e = item.e;
    switch (e.type) {
      case "job.created": case "job.accepted": return true;
      case "job.dispatched": return this.bird === "atUser" || this.bird === "toUser";
      case "message": {
        if (e.to === "user") return this.bird === "atUser" || this.bird === "back";
        if (this.bird !== "atLab") return false;
        if (e.from === "toucan") return e.to !== "team" || this.gathered || this.clock - this.wokeAt > GATHER_TIMEOUT_S;
        if (e.to === "toucan") return cast.isFree(e.from) && this.near(e.from, PERCH_SPOT.x, PERCH_SPOT.z, 40);
        // agent to agent: said face to face
        const a = cast.positionOf(e.from, new THREE.Vector3()), b = cast.positionOf(e.to, new THREE.Vector3());
        return !!a && !!b && Math.hypot(a.x - b.x, a.z - b.z) < 70;
      }
      case "agent.assigned": return this.bird === "atLab";
      case "agent.state": {
        if (this.bird !== "atLab") return false;
        if (e.state === "working" || e.state === "reviewing" || e.state === "done") {
          const st = this.jobs.get(e.agentId)?.station;
          return !st || cast.isAt(e.agentId, st.id);
        }
        return true;
      }
      case "work.handoff": {
        if (this.bird !== "atLab") return false;
        if (e.from === "toucan") {
          if (item.t1 === undefined) {
            if (!cast.isAt(e.to, "PERCH_SPOT")) return false;
            item.t1 = cast.receiveFromExternal(PACKET, e.to);
          }
          return cast.t >= item.t1 + 0.2;
        }
        return item.t1 !== undefined && cast.t >= item.t1 + 0.25;
      }
      case "artifact.ready": {
        const dock = `ARTIFACT_DOCK_${((item.slot ?? 0) % ARTIFACT.docks.length) + 1}`;
        return cast.isAt(e.by, dock) && cast.holderOf(PACKET) === null;
      }
      case "artifact.collected": {
        if (this.bird !== "atLab") return false;
        if (item.t1 === undefined) {
          if (!this.deps.toucan.landed() || this.labSpot === PERCH) return false;
          // the SAME packet lifts off the dock into the beak — no second packet, no jump
          item.t1 = cast.collectToExternal(PACKET, (out) => this.deps.toucan.carry(out), 1.0);
        }
        return cast.t >= item.t1 + 0.3;
      }
      case "job.completed": return this.bird === "atLab";
      case "artifact.delivered": {
        if (this.bird !== "back") return false;
        if (item.t1 === undefined) {
          const me = this.deps.player();
          this.deps.toucan.setFace({ x: me.x, z: me.z });
          item.t1 = cast.passExternal(PACKET, this.deps.userCarry, 1.3);
        }
        return cast.t >= item.t1;
      }
    }
  }

  /** the handoff spot pair that suits these two: the least total walking for both, the receiver's next leg
   *  included (founders' named spots today — any number of pairs later) */
  private handoffSpot(giver: string, receiver: string): { give: string; take: string } {
    const { cast } = this.deps;
    const g = cast.positionOf(giver, new THREE.Vector3()), r = cast.positionOf(receiver, new THREE.Vector3());
    const next = this.jobs.get(receiver)?.station?.at;
    const pairs = [
      { give: "HANDOFF_NOVA_MILO", take: "HANDOFF_NOVA_MILO_RECV", at: HANDOFFS.novaMilo },
      { give: "HANDOFF_MILO_PIP", take: "HANDOFF_MILO_PIP_RECV", at: HANDOFFS.miloPip },
    ];
    const d = (a: { x: number; z: number } | null | undefined, b: { x: number; z: number }) => (a ? Math.hypot(a.x - b.x, a.z - b.z) : 0);
    const score = (p: (typeof pairs)[number]) => d(g, p.at.give) + d(r, p.at.take) + d(next, p.at.take);
    return pairs.reduce((best, p) => (score(p) < score(best) ? p : best));
  }

  // ---- applying an event --------------------------------------------------------------------------------
  private apply(item: Item): void {
    const { cast, lab, toucan } = this.deps;
    const e = item.e;
    switch (e.type) {
      case "job.created":
        this.enterBird("toUser");
        // THE JOB IS A THING: from the moment the request exists, the bird carries it
        cast.setPacketTint(PACKET, PACKET_TINT.brief);
        cast.holdExternally(PACKET, (out) => toucan.carry(out));
        this.own("toucan");
        this.setStatus({ phase: "running", title: e.title, step: "Toucan is coming to you" });
        return;
      case "job.accepted":
        return;
      case "job.dispatched":
        this.team = [...e.team];
        toucan.setPace(ERRAND_PACE);
        this.enterBird("toLab");
        toucan.setFace(null);
        this.followBird();
        this.setStatus({ step: "Toucan is flying to the AI Lab" });
        return;
      case "message":
        this.speak(e.from, e.to, e.text);
        return;
      case "agent.assigned": {
        const job = this.jobs.get(e.agentId) ?? {};
        job.role = e.role;
        // A COMPATIBLE FREE STATION, by capability (founders get the one set up for them) — and it wakes
        if (!job.station) {
          const st = assignStation(workForRole(e.role), this.occupied, e.agentId);
          if (st) { job.station = st; this.occupied.add(st.id); this.releases = this.releases.filter((r) => r.station !== st.id); lab.setStationActivity(st.id, "active"); }
        }
        this.jobs.set(e.agentId, job);
        const b = cast.agents.get(e.agentId)?.body;
        cast.setExec(e.agentId, b?.exec ?? "idle", { agentId: e.agentId, role: e.role });
        return;
      }
      case "agent.state": {
        const job = this.jobs.get(e.agentId);
        const st = job?.station;
        cast.setExec(e.agentId, e.state);
        const nm = this.name(e.agentId);
        if (e.state === "assigned") this.setStatus({ step: `${nm} is assigned` });
        else if (e.state === "working" || e.state === "reviewing") {
          if (st) {
            lab.setStationActivity(st.id, "working");
            if (this.firstStation) { this.firstStation = false; this.follow(e.agentId, CAM.agent); }
          }
          this.setStatus({ step: `${nm} is ${e.state}` });
        } else if (e.state === "done") {
          if (st) lab.setStationActivity(st.id, "done");
          // the work is picked up again, matured by this stage
          cast.issue({ a: e.agentId, op: "carry", packet: PACKET });
          const tint = st ? STAGE_TINT[st.type] : undefined;
          if (tint !== undefined) this.later(0.4, () => cast.setPacketTint(PACKET, tint));
          this.setStatus({ step: `${nm} is done` });
        } else if (e.state === "idle") {
          // released: the station settles back to standby once its DONE has been seen, the agent goes home
          if (st) { this.occupied.delete(st.id); this.releases.push({ station: st.id, at: this.clock + DONE_HOLD_S }); }
          this.jobs.delete(e.agentId);
          cast.setExec(e.agentId, "idle", null);
          this.goHome(e.agentId);
        }
        return;
      }
      case "work.handoff": {
        // ownership has physically moved (the gate waited for the packet to land in the new hands)
        if (e.from === "toucan") {
          // briefed and not on the job yet: wait somewhere sensible until it reaches them
          for (const id of this.team) if (id !== e.to && !this.jobs.get(id)?.station) this.later(0.6, () => this.go(id, residentFor(id).standby));
        }
        this.own(e.to);
        this.setStatus({ step: `${this.name(e.to)} has the work` });
        return;
      }
      case "artifact.ready": {
        const slot = item.slot ?? 0;
        this.filledSlots.add(slot);
        this.slotOf.set(e.artifactId, slot);
        this.own("artifact");
        this.result = e.result;
        lab.setArtifactSlot(slot, "ready");
        cast.setPacketTint(PACKET, PACKET_TINT.ready);
        this.setStatus({ step: "Result ready in the AI Lab" });
        return;
      }
      case "artifact.collected":
        // the gallery keeps its READY record; the one physical packet is the bird's now
        this.own("toucan");
        this.setStatus({ step: "Toucan has the result" });
        return;
      case "artifact.delivered":
        // in your hands: the deliverable is yours to inspect
        this.own("user");
        this.setStatus({ step: "Result delivered", result: this.result, delivered: true });
        return;
      case "job.completed":
        // THE BIRD TAKES THE RESULT BACK: off the Lab and all the way to you
        this.endLine();
        toucan.setLanding(null); toucan.setFace(null); toucan.setPace(ERRAND_PACE);
        this.enterBird("leaving");
        this.followBird();
        for (const id of this.team) if (!this.jobs.has(id) && !cast.isAt(id, residentFor(id).home)) this.goHome(id);
        this.setStatus({ step: e.outcome === "ready-for-review" ? "Toucan is bringing you the result" : "The job failed" });
        // the HUD's READY indication arrives with the bird (its closing line is gated on reaching you)
        return;
    }
  }

  private goHome(id: string): void {
    const r = residentFor(id);
    if (r.hidden) this.deps.cast.retireToResidence(id);
    else this.go(id, r.home);
  }

  /** the existing speech bubble over the speaker; listeners on the ring turn to it */
  private speak(from: string, to: string, text: string): void {
    const { cast, toucan } = this.deps;
    this.endLine();
    cast.pills.say(from, text);
    if (from !== "toucan") cast.setSpeaking(from, true);
    this.setStatus({ transcript: [...this.status.transcript, { who: this.name(from), text }].slice(-4) });
    this.speaking = from;
    this.hold = Math.min(3.2, Math.max(1.9, 1.0 + text.length * 0.042));
    const head = (who: string): THREE.Vector3 | null => {
      if (who === "toucan") return toucan.position().clone();
      if (who === "user") { const p = this.deps.player(); return new THREE.Vector3(p.x, 30, p.z); }
      if (who === "team") return new THREE.Vector3(PERCH_SPOT.x, 24, PERCH_SPOT.z + 40);
      return cast.headOf(who, new THREE.Vector3());
    };
    const speakerHead = head(from), addressee = head(to);
    const birdFace = from === "toucan" ? addressee : speakerHead;
    toucan.setFace(birdFace ? { x: birdFace.x, z: birdFace.z } : null);
    if (from === "toucan" && to === "user") return;
    // people who are standing about (not walking, not working) look at whoever is talking
    for (const id of this.team) {
      if (!cast.isFree(id)) continue;
      const busy = this.jobs.get(id)?.station && cast.isAt(id, this.jobs.get(id)!.station!.id);
      if (busy) continue;
      if (id === from) { if (addressee && to !== "team") this.look(id, to === "toucan" ? addressee : to); }
      else if (speakerHead && (from === "toucan" || to === id)) this.look(id, from === "toucan" ? speakerHead : from);
    }
  }

  private endLine(): void {
    if (this.speaking) { this.deps.cast.pills.say(this.speaking, null); this.deps.cast.setSpeaking(this.speaking, false); }
    this.speaking = null;
    this.hold = 0;
    // the closing line to you completes the job
    if (this.bird === "back" && this.queue.length === 0 && this.status.phase === "running") {
      this.deps.camera.restore();
      this.setStatus({ phase: "complete", step: this.status.delivered ? "Result delivered" : "Result ready" });
    }
  }

  /** for the dev panel / capture harness: what the presenter is doing */
  debug(): { bird: BirdStage; queue: string[]; lag: number; gathered: boolean; holder: string | null; owner: string | null; owners: string[]; slots: number[]; stations: Record<string, string> } {
    return {
      owner: this.owner, owners: [...this.owners],
      bird: this.bird, queue: this.queue.slice(0, 3).map((q) => q.e.type + ("agentId" in q.e ? `:${q.e.agentId}` : "") + ("state" in q.e ? `:${q.e.state}` : "")),
      lag: Math.round(this.lag * 10) / 10, gathered: this.gathered, holder: this.deps.cast.holderOf(PACKET), slots: [...this.filledSlots],
      stations: Object.fromEntries([...this.jobs].map(([id, j]) => [id, j.station?.id ?? "-"])),
    };
  }

  dispose(): void {
    this.deps.toucan.setTarget(null);
    this.deps.toucan.setLanding(null);
    this.unsub();
    this.listeners.clear();
  }
}

/** every floor station the presenter may wake (tests read this to check nothing outside the registry is used) */
export const LIVE_STATIONS: readonly string[] = STATIONS.filter((s) => s.at.y === 0 && s.state !== "future").map((s) => s.id);
