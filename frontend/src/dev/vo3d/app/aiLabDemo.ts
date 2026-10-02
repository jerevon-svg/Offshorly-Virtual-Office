// vo3d app — THE AI-WORKFORCE DEMO PRESENTER: orchestration events in, choreography out.
// DEV-ONLY, behind `?aidemo=1` (see world.ts).
//
// THIS FILE DECIDES NOTHING ABOUT THE JOB. It subscribes to an OrchestrationSource (world/
// agentOrchestration.ts — today the mock, later an Agent Harness adapter) and turns each event into what
// VO already knows how to show:
//   job.created / job.accepted  → the toucan comes to YOU (its existing summon flight)
//   message                     → the existing overhead speech bubble over the speaker; the speaker's
//                                 mouth moves, listeners look at it, the toucan turns to it
//   job.dispatched              → the toucan flies to the AI Lab (the same summon flight, aimed at the Lab)
//                                 and the camera follows it, then frames the team
//   agent.assigned / agent.state→ the agents' EXISTING external state API (MonkeyAgentProof.setExec), so
//                                 the pills, clips, faces and work layers follow from the contract
//   job.completed               → the camera returns to where you were and the toucan flies back to YOU
//                                 (where the result + Approve / Request Changes step will start)
// STANDBY: with the demo on, the bird keeps you company before and after a job (the same summon), so a
// command is answered at once instead of after a long flight in from wherever it was roaming.
//
// ITS ONLY CLOCK IS PRESENTATION PACING: a line stays up long enough to read, and Lab events wait until the
// bird has actually landed there. Events that had to wait are REPLAYED WITH THE SOURCE'S OWN SPACING,
// shifted by however long the scene was held — so seven seconds of reported work still READS as seven
// seconds of work, however long the flight took. It never invents a state, never ends work early, never
// moves the job on — if the source stops sending, the scene simply holds.
import * as THREE from "three";
import type { ArtifactResult, OrchestrationEvent, OrchestrationSource } from "../world/agentOrchestration";
import { DEMO_COMMAND } from "../world/agentOrchestration";
import type { MonkeyAgentProof } from "../avatar/MonkeyAgentProof";
import type { ToucanSummonState } from "../../../components/OfficeMap/toucanSummon";
import { parkPointFor } from "../../../components/OfficeMap/toucanSummon";
import type { Rect } from "../core/coords";

export type AiLabDemoStatus = {
  phase: "idle" | "running" | "complete";
  /** a short human line for the HUD chip */
  step: string;
  title?: string;
  source: OrchestrationSource["kind"];
  /** the conversation so far, newest last (the in-world bubbles clamp at three lines; this never does) */
  transcript: readonly { who: string; text: string }[];
  /** the finished deliverable, once there is one (the V2 Lab's presenter fills it; Phase 5 consumes it) */
  result?: ArtifactResult | null;
  /** the deliverable has physically reached the human: the View Result action is offered */
  delivered?: boolean;
};

export type AiLabDemoDeps = {
  source: OrchestrationSource;
  cast: MonkeyAgentProof;
  toucan: {
    /** the summon centre (the bird parks beside it); null = release (it flies home) */
    setTarget(at: { x: number; z: number } | null): void;
    setFace(at: { x: number; z: number } | null): void;
    state(): ToucanSummonState;
    position(): THREE.Vector3;
  };
  player(): { x: number; z: number };
  camera: {
    follow(get: () => { x: number; z: number }): void;
    frame(rect: Rect): void;
    restore(): void;
  };
};

/** where the bird hovers at the Lab: just south of the team, so the agents turn to face it */
const LAB_PARK_OFFSET = { x: -10, z: 45 };
/** the camera's frame for the delegation */
const TEAM_FRAME_PAD = { w: 190, d: 120 };
/** a toucan that cannot reach you within this long carries on anyway */
const MEET_TIMEOUT_S = 15;
const LAB_ARRIVE = 30;

type Stage = "standby" | "toUser" | "atUser" | "toLab" | "atLab" | "done";

export class AiLabDemo {
  private stage: Stage = "standby";
  /** received events, stamped with presenter time on arrival */
  private queue: { e: OrchestrationEvent; at: number }[] = [];
  /** presenter clock, and how far presentation currently trails the source (grows only while held) */
  private clock = 0;
  private lag = 0;
  private hold = 0;
  private speaking: string | null = null;
  private stageT = 0;
  private homeHold = -1;
  private status: AiLabDemoStatus;
  private listeners = new Set<(s: AiLabDemoStatus) => void>();
  private unsub: () => void;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  private readonly deps: AiLabDemoDeps;

  constructor(deps: AiLabDemoDeps) {
    this.deps = deps;
    this.status = { phase: "idle", step: "", source: deps.source.kind, transcript: [] };
    this.unsub = deps.source.subscribe((e) => this.queue.push({ e, at: this.clock }));
  }

  // ---- the HUD's side ----------------------------------------------------------------------------------
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
    this.reset();
    this.deps.source.submit(DEMO_COMMAND);
  }

  /** stop everything and put the scene back: bird home, agents idle, camera where you were */
  reset(): void {
    this.deps.source.cancel();
    this.queue = []; this.hold = 0; this.speaking = null; this.homeHold = -1; this.lag = 0;
    if (this.stage === "toLab" || this.stage === "atLab" || this.stage === "done") this.deps.camera.restore();
    this.stage = "standby";
    this.deps.toucan.setFace(null);
    this.deps.cast.resetPresentation();
    this.setStatus({ phase: "idle", step: "", title: undefined, transcript: [] });
  }

  get running(): boolean { return this.stage !== "standby"; }

  // ---- geometry -----------------------------------------------------------------------------------------
  /** the summon CENTRE that makes the bird PARK at `park` (V1's parkPointFor puts it beside the centre) */
  private centreFor(park: { x: number; z: number }): { x: number; z: number } {
    const p = parkPointFor({ x: park.x, y: park.z });
    return { x: park.x - (p.x - park.x), z: park.z };
  }
  private labPark(): { x: number; z: number } {
    const c = this.deps.cast.teamCentre();
    return { x: c.x + LAB_PARK_OFFSET.x, z: c.z + LAB_PARK_OFFSET.z };
  }
  private headOf(who: string, out: THREE.Vector3): THREE.Vector3 | null {
    if (who === "toucan") return out.copy(this.deps.toucan.position());
    if (who === "user") { const p = this.deps.player(); return out.set(p.x, 30, p.z); }
    if (who === "team") { const c = this.deps.cast.teamCentre(); return out.set(c.x, 30, c.z); }
    return this.deps.cast.headOf(who, out);
  }

  // ---- the frame -----------------------------------------------------------------------------------------
  update(dt: number): void {
    this.clock += dt;
    this.deps.source.tick(dt);
    this.stageT += dt;
    this.travel();
    if (this.stage === "standby" && this.queue.length === 0) return;
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) this.endLine();
      else return;
    }
    if (this.homeHold >= 0) {
      this.homeHold -= dt;
      if (this.homeHold < 0) this.goHome();
      return;
    }
    while (this.queue.length > 0 && this.hold <= 0) {
      const { e, at } = this.queue[0];
      // due at its own source time plus the current lag — the source's spacing survives any hold
      if (this.clock < at + this.lag) break;
      if (!this.ready(e)) break;
      this.queue.shift();
      this.lag = Math.max(this.lag, this.clock - at);
      this.apply(e);
    }
  }

  /** the bird's leg of the story, each frame */
  private travel(): void {
    const t = this.deps.toucan;
    if (this.stage === "standby") {
      t.setTarget(this.deps.player());
    } else if (this.stage === "toUser") {
      t.setTarget(this.deps.player());
      if (t.state() === "attending" || this.stageT > MEET_TIMEOUT_S) { this.enter("atUser"); this.setStatus({ step: "Toucan is with you" }); }
    } else if (this.stage === "atUser") {
      t.setTarget(this.deps.player());
    } else if (this.stage === "toLab") {
      const park = this.labPark();
      t.setTarget(this.centreFor(park));
      const p = t.position();
      if (t.state() === "attending" && Math.hypot(p.x - park.x, p.z - park.z) < LAB_ARRIVE + 40) {
        this.enter("atLab");
        const c = this.deps.cast.teamCentre();
        this.deps.camera.frame({ x: c.x - TEAM_FRAME_PAD.w / 2, z: c.z - TEAM_FRAME_PAD.d / 2 - 20, w: TEAM_FRAME_PAD.w, d: TEAM_FRAME_PAD.d });
        this.setStatus({ step: "Toucan is briefing the team" });
      }
    } else if (this.stage === "atLab" || this.stage === "done") {
      t.setTarget(this.centreFor(this.labPark()));
    }
  }

  private enter(s: Stage): void { this.stage = s; this.stageT = 0; }

  /** PRESENTATION GATES — never about the job, only about whether the scene can show this yet */
  private ready(e: OrchestrationEvent): boolean {
    const atLabEvent = (e.type === "message" && !(e.from === "toucan" && e.to === "user"))
      || e.type === "agent.assigned" || e.type === "agent.state" || e.type === "job.completed"
      || e.type === "work.handoff" || e.type === "artifact.ready" || e.type === "artifact.collected";
    if (atLabEvent) return this.stage === "atLab";
    if ((e.type === "message" && e.to === "user") || e.type === "artifact.delivered") return this.stage === "atUser";
    return true;
  }

  private apply(e: OrchestrationEvent): void {
    const { cast, toucan } = this.deps;
    switch (e.type) {
      case "job.created":
        this.enter("toUser");
        this.setStatus({ phase: "running", title: e.title, step: "Toucan is coming to you" });
        return;
      case "job.accepted":
        return;
      case "message": {
        this.speak(e.from, e.to, e.text);
        return;
      }
      case "job.dispatched":
        this.enter("toLab");
        this.deps.camera.follow(() => { const p = toucan.position(); return { x: p.x, z: p.z }; });
        this.setStatus({ step: "Toucan is flying to the AI Lab" });
        return;
      case "agent.assigned": {
        const b = cast.body(e.agentId);
        if (b) cast.setExec(e.agentId, b.exec, { agentId: e.agentId, role: e.role });
        return;
      }
      case "agent.state": {
        cast.setExec(e.agentId, e.state);
        const b = cast.body(e.agentId);
        const name = b?.identity.name ?? e.agentId;
        if (e.state === "working" || e.state === "reviewing") {
          const spot = cast.workSpot(e.agentId);
          b?.faceToward(spot ? this.tmp.set(spot.x, 0, spot.z) : null);
          cast.setGaze(e.agentId, null);
          this.setStatus({ step: `${name} is ${e.state === "reviewing" ? "reviewing" : "working"}` });
        } else if (e.state === "done") {
          b?.faceToward(this.tmp.copy(toucan.position()));
          this.setStatus({ step: `${name} is done` });
        }
        return;
      }
      case "work.handoff":
        return; // the V1 hall has no physical packet; the V2 Lab's presenter (app/labWorkforce) shows it
      case "artifact.ready":
        this.setStatus({ step: "Result ready" });
        return;
      case "artifact.collected": case "artifact.delivered":
        return; // the V1 hall has no physical packet (the V2 Lab's presenter carries it)
      case "job.completed":
        this.enter("done");
        this.setStatus({ phase: "complete", step: e.outcome === "ready-for-review" ? "Ready for review" : "Job failed" });
        this.homeHold = 2.5;
        return;
    }
  }

  /** the existing speech bubble over the speaker; everyone else looks at it */
  private speak(from: string, to: string, text: string): void {
    const { cast, toucan } = this.deps;
    this.endLine();
    cast.say(from, text);
    const who = from === "toucan" ? "Toucan" : cast.body(from)?.identity.name ?? from;
    this.setStatus({ transcript: [...this.status.transcript, { who, text }].slice(-4) });
    this.speaking = from;
    this.hold = Math.min(4.2, Math.max(2.6, 1.4 + text.length * 0.045));
    const speakerHead = this.headOf(from, this.tmp);
    const addressee = this.headOf(to, this.tmp2);
    // the toucan turns to whoever speaks — or, when it speaks, to whom it is speaking
    const toucanFace = from === "toucan" ? addressee : speakerHead;
    toucan.setFace(toucanFace ? { x: toucanFace.x, z: toucanFace.z } : null);
    for (const id of ["nova", "milo", "pip"]) {
      const b = cast.body(id);
      if (!b) continue;
      const busy = b.exec === "working" || b.exec === "reviewing";
      if (id === from) {
        if (addressee) { cast.setGaze(id, addressee); if (!busy) b.faceToward(addressee); }
      } else if (speakerHead && !busy) {
        cast.setGaze(id, speakerHead);
        if (from === "toucan" || to === id) b.faceToward(speakerHead);
      }
    }
  }

  private endLine(): void {
    if (this.speaking) this.deps.cast.say(this.speaking, null);
    this.speaking = null;
    this.hold = 0;
  }

  /** back to you: the camera returns, the bird flies back to your side (standby) */
  private goHome(): void {
    this.homeHold = -1;
    this.deps.toucan.setFace(null);
    this.deps.camera.restore();
    for (const id of ["nova", "milo", "pip"]) { this.deps.cast.setGaze(id, null); this.deps.cast.body(id)?.faceToward(null); }
    // back at your side: the bird's closing line to you is shown from here (it is gated on "atUser")
    this.enter("toUser");
    this.setStatus({ phase: "complete", step: "Ready for review — Toucan is bringing it to you" });
  }

  dispose(): void {
    this.deps.toucan.setTarget(null);
    this.unsub();
    this.listeners.clear();
  }
}
