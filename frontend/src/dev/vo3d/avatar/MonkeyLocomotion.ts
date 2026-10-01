// vo3d avatar — MONKEYAGENT LOCOMOTION: one agent's body, driven by traversal plans.
//
// WHAT IT OWNS. Where this agent is in the traversal graph, the plan it is executing (and any it has queued),
// the work packet it may be carrying, and close interactions with another agent (looking at a speaker, handing
// a packet over). Every frame it samples the plan at the shared clock, builds the BodyPose (avatar/
// monkeyMotion), lays interaction overrides on top, and writes it onto the real MonkeyAgent body through the
// body's `driver` seam — after the mixer, so a clip-based action (a chair sit) can still show through.
//
// THE CLOCK IS PASSED IN. Nothing here accumulates time: `goTo(dest, t)` schedules a plan at t, and `pose(t)`
// is a function of the plans scheduled so far. Two clients replaying the same requests at the same times see
// the same agent.
import * as THREE from "three";
import type { MonkeyAgentBody } from "./MonkeyAgentBody";
import { MonkeyRig } from "./monkeyRig";
import { applyBodyPose, blendPose, frame, HAND_L, poseAt, type BodyPose, type Contact } from "./monkeyMotion";
import {
  buildPlan, dirOfYaw, endHeading, samplePlan, smooth, type MotionProfile, type Plan, type TraversalGraph, type V3,
} from "../world/monkeyTraversal";

const UP = new THREE.Vector3(0, 1, 0);
const tv = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);

// ============================== THE WORK PACKET =============================================================

/** A physical work packet: a small tablet in the stage's colour. It is always IN someone's hands or ON a
 *  surface — never floating — and its pose is computed, not simulated. */
export class WorkPacket {
  readonly root = new THREE.Group();
  holder: MonkeyLocomotion | null = null;
  /** where it rests when nobody holds it */
  readonly restAt = new THREE.Matrix4();
  private readonly screen: THREE.MeshStandardMaterial;
  constructor(tint = 0x6fb6ff) {
    this.root.name = "work-packet";
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 0.7, 6.4), new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.2 }));
    this.screen = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.65, roughness: 0.35 });
    const face = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 5.4), this.screen);
    face.position.y = 0.38;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 0.6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 }));
    bar.position.set(-0.8, 0.45, -1.6);
    this.root.add(body, face, bar);
    this.root.traverse((o) => { o.castShadow = true; });
  }
  setTint(hex: number): void { this.screen.color.setHex(hex); this.screen.emissive.setHex(hex); }
}

/** the packet's carry pose in a holder's model frame: held at the belly, below the chin, screen tilted up */
const CARRY = { pos: new THREE.Vector3(0, 10.4, 6.6), tilt: -0.55 };
function carryMatrix(root: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), CARRY.tilt);
  return out.compose(CARRY.pos, q, new THREE.Vector3(1, 1, 1)).premultiply(root.matrixWorld);
}
/** grips on a packet's two short edges, in the packet's own frame */
const EDGE_L = new THREE.Vector3(4.6, -0.6, 0.6), EDGE_R = new THREE.Vector3(-4.6, -0.6, 0.6);

// ============================== ONE AGENT ===================================================================

export type Handoff = { giver: MonkeyLocomotion; receiver: MonkeyLocomotion; packet: WorkPacket; t0: number };
export const HANDOFF_S = { extend: 0.7, grip: 1.05, transfer: 1.15, settle: 1.9 } as const;

export class MonkeyLocomotion {
  readonly body: MonkeyAgentBody;
  readonly graph: TraversalGraph;
  readonly profile: MotionProfile;
  private rig: MonkeyRig | null = null;
  /** every plan this agent has been given, in time order (kept so any t can be re-posed) */
  private plans: Plan[] = [];
  private readonly startNode: string;
  private readonly startYaw: number;
  /** close attention: look at / turn toward a point from time t */
  private attention: { at: () => THREE.Vector3; t0: number; turn: boolean } | null = null;
  /** handoffs this agent takes part in */
  handoffs: Handoff[] = [];
  /** packets it holds at scheduled times: [t, packet | null] */
  private carryLog: { t: number; packet: WorkPacket | null }[] = [];
  /** the time the last pose was built for, and the pose */
  time = 0;
  lastPose: BodyPose | null = null;
  /** true while the agent is inside a building that is not modelled (the residence) — the runner hides it */
  hidden = false;
  /** live read-out for the dev panel / harness */
  readonly debug = { mode: "still", gait: "-", node: "", reach: [0, 0, 0, 0] as number[] };

  constructor(body: MonkeyAgentBody, graph: TraversalGraph, profile: MotionProfile, startNode: string, startYaw = 0) {
    this.body = body; this.graph = graph; this.profile = profile;
    this.startNode = startNode; this.startYaw = startYaw;
    body.driver = () => this.drive();
    body.workScreenEnabled = false;
  }

  /** forget everything scheduled (a scenario restart) */
  reset(): void { this.plans = []; this.attention = null; this.handoffs = []; this.carryLog = []; this.busyUntil = -Infinity; }

  /** the node the agent is at (or will be at when its last scheduled plan ends) */
  get node(): string {
    const p = this.plans.at(-1);
    return p ? p.end.id : this.startNode;
  }
  /** where the agent IS at time t: the node it has arrived at and stays on, or null while it is travelling
   *  (plans may be scheduled ahead, so this reads the plan that is current at t, not the last one) */
  nodeAt(t: number): string | null {
    let cur: Plan | null = null;
    for (const p of this.plans) if (p.t0 <= t && (!cur || p.t0 >= cur.t0)) cur = p;
    if (!cur) return this.startNode;
    return t >= cur.t1 ? cur.end.id : null;
  }
  /** busy with something that is not a plan (a handoff) until this time */
  busyUntil = -Infinity;
  /** when the agent is next free: its last plan's end, or the end of whatever is occupying it */
  get freeAt(): number { return Math.max(this.plans.at(-1)?.t1 ?? -Infinity, this.busyUntil); }

  carrying(t: number): WorkPacket | null {
    let p: WorkPacket | null = null;
    for (const e of this.carryLog) if (e.t <= t) p = e.packet;
    return p;
  }
  /** schedule picking up / putting down a packet at time t */
  setCarry(packet: WorkPacket | null, t: number): void {
    this.carryLog.push({ t, packet });
    this.carryLog.sort((a, b) => a.t - b.t);
    if (packet) packet.holder = this;
  }

  /** GO TO A DESTINATION. Starts at t, or when the current plan ends if later. Returns the plan (or null if
   *  there is no route — e.g. a climb asked of an agent carrying a packet). */
  goTo(destination: string, t: number): Plan | null {
    const start = Math.max(t, this.freeAt);
    const plan = buildPlan(this.graph, this.node, destination, this.profile, start, { carry: !!this.carrying(start) });
    if (plan) this.plans.push(plan);
    return plan;
  }

  /** look at (and optionally turn to face) a moving point from time t; null clears */
  attend(at: (() => THREE.Vector3) | null, t: number, turn = true): void {
    this.attention = at ? { at, t0: t, turn } : null;
  }

  private planAt(t: number): { plan: Plan | null; idx: number } {
    let idx = -1;
    for (let i = 0; i < this.plans.length; i++) if (this.plans[i].t0 <= t) idx = i;
    return { plan: idx >= 0 ? this.plans[idx] : null, idx };
  }

  /** the heading the body has at the start of segment `i` of plan `p` */
  private entryHeading(pi: number, segIndex: number): THREE.Vector3 {
    const p = this.plans[pi];
    if (segIndex > 0) return tv(endHeading(p.segs[segIndex - 1]));
    const prev = this.plans[pi - 1];
    if (prev) return tv(prev.end.yaw !== undefined ? dirOfYaw(prev.end.yaw) : endHeading(prev.segs[prev.segs.length - 1]));
    return tv(dirOfYaw(this.startYaw));
  }

  /** DEV ONLY: replace the whole pose (rig verification — T-pose, single-contact tests) */
  debugOverride: ((t: number, base: BodyPose) => BodyPose) | null = null;

  /** THE POSE AT TIME t: plan sample → vocabulary pose → carry / handoff / attention overrides. */
  pose(t: number): BodyPose {
    const P = this.poseInner(t);
    if (this.debugOverride) this.lastPose = this.debugOverride(t, P);
    return this.lastPose!;
  }

  private poseInner(t: number): BodyPose {
    const { plan, idx } = this.planAt(t);
    let P: BodyPose;
    if (!plan) {
      const node = this.graph.nodes.find((n) => n.id === this.startNode)!;
      const still = { t0: t + 1, t1: t + 1, segs: [], start: node, end: node, action: node.action ?? "stand", carry: false, profile: this.profile } as Plan;
      P = poseAt(still, { kind: "still", seg: null, local: 0, u: 0, s: 0, gaitS: 0, speed: 0, pos: node.at, heading: dirOfYaw(this.startYaw), since: -1 }, { t, prof: this.profile });
      this.hidden = node.action === "inside";
      this.debug.mode = "still"; this.debug.gait = "-"; this.debug.node = node.id;
    } else {
      const s = samplePlan(plan, t);
      const segIndex = s.seg ? plan.segs.indexOf(s.seg) : 0;
      if (s.kind === "still" && s.since < 0) {
        // before this plan starts: hold the previous plan's end (or the start)
        s.heading = tv(this.entryHeading(idx, 0));
      }
      const entry = s.kind === "still" ? null : this.entryHeading(idx, segIndex);
      P = poseAt(plan, s, { t, prof: this.profile, entryHeading: entry });
      this.hidden = s.kind === "interior" || (s.kind === "still" && (s.since >= 0 ? plan.end : plan.start).action === "inside");
      this.debug.mode = s.kind; this.debug.gait = s.seg?.run?.gait ?? "-"; this.debug.node = s.since >= 0 ? plan.end.id : s.seg ? `${s.seg.from.id}→${s.seg.to.id}` : plan.start.id;
    }
    // ---- attention: look at the point; at rest, also turn the whole body to it (eased over 0.6 s) --------
    if (this.attention && t >= this.attention.t0) {
      const at = this.attention.at();
      const k = smooth((t - this.attention.t0) / 0.6);
      const head = P.pos.clone().addScaledVector(UP, 26);
      P.look.lerp(at.clone().sub(head).normalize(), k).normalize();
      P.lookW = Math.max(P.lookW, k);
      // at a handoff spot the body KEEPS its authored side-by-side facing — only the head turns (two chibi
      // heads turned bodily toward each other at 22 apart would touch)
      const atHandoff = this.debug.mode === "still" && (this.planAt(t).plan?.action === "handoff");
      if (this.attention.turn && !atHandoff && this.debug.mode === "still" && P.w > 0) {
        const want = at.clone().sub(P.pos).setY(0);
        if (want.lengthSq() > 1) P.q.slerp(frame(want.normalize()), k);
      }
    }
    // ---- carrying: hands on the packet's edges, wherever the gait would have put them --------------------
    const packet = this.carrying(t);
    const hand = this.handoffs.find((h) => t >= h.t0 && t <= h.t0 + HANDOFF_S.settle);
    if (packet && !hand) this.gripPacket(P, null, 1);
    if (hand) this.handoffPose(P, hand, t);
    this.time = t;
    this.lastPose = P;
    return P;
  }

  /** hands onto the packet's edges, with the packet at `m` (world matrix; null = the carry pose) */
  private gripPacket(P: BodyPose, m: THREE.Matrix4 | null, w: number): THREE.Matrix4 {
    const tmp = new THREE.Object3D();
    tmp.position.copy(P.pos); tmp.quaternion.copy(P.q); tmp.updateMatrixWorld(true);
    const M = m ?? carryMatrix(tmp, new THREE.Matrix4());
    const L = EDGE_L.clone().applyMatrix4(M), R = EDGE_R.clone().applyMatrix4(M);
    const into = new THREE.Vector3(0, 0, 1).applyQuaternion(P.q);
    const pole = (x: number) => new THREE.Vector3(x, 9, -5).applyQuaternion(P.q).add(P.pos);
    const grip = (p: THREE.Vector3, x: number): Contact => ({ p, pole: pole(x), w, fwd: into.clone(), down: new THREE.Vector3(-Math.sign(x), 0, 0).applyQuaternion(P.q), ow: 0.7 * w });
    P.hand = [grip(L, 8), grip(R, -8)];
    return M;
  }

  /** THE HANDOFF, seen from either side — SIDE BY SIDE, never face to face. Two chibi heads (radius ~9.5)
   *  collide long before two 8.4-unit arms can meet in front of them, so partners stand ~22 apart turned in
   *  toward each other, and the packet passes LATERALLY at belly height: the giver's far hand lets go as it
   *  offers the packet out to its side on the near hand, the receiver's near hand takes the other end, and
   *  after the transfer the receiver draws it in to a two-handed carry. Both turn their heads to each other. */
  private handoffPose(P: BodyPose, h: Handoff, t: number): void {
    const lt = t - h.t0;
    const giverPose = h.giver === this ? P : h.giver.lastPose;
    const recvPose = h.receiver === this ? P : h.receiver.lastPose;
    if (!giverPose || !recvPose) return;
    const mk = (pose: BodyPose) => { const o = new THREE.Object3D(); o.position.copy(pose.pos); o.quaternion.copy(pose.q); o.updateMatrixWorld(true); return carryMatrix(o, new THREE.Matrix4()); };
    const gM = mk(giverPose), rM = mk(recvPose);
    const gp = new THREE.Vector3().setFromMatrixPosition(gM), rp = new THREE.Vector3().setFromMatrixPosition(rM);
    // the pass point: between the two carry positions, a little forward of both, the packet's long axis
    // along the line between them
    const across = rp.clone().sub(gp).setY(0).normalize();
    const fwdAvg = new THREE.Vector3(0, 0, 1).applyQuaternion(giverPose.q).add(new THREE.Vector3(0, 0, 1).applyQuaternion(recvPose.q)).setY(0).normalize();
    const mid = gp.clone().lerp(rp, 0.5).addScaledVector(fwdAvg, 1.5).addScaledVector(UP, 0.6);
    const midQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across.clone().negate(), UP, new THREE.Vector3().crossVectors(across.clone().negate(), UP)));
    const midM = new THREE.Matrix4().compose(mid, midQ, new THREE.Vector3(1, 1, 1));
    const lerpM = (a: THREE.Matrix4, b: THREE.Matrix4, k: number) => {
      const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sc = new THREE.Vector3();
      a.decompose(pa, qa, sc); b.decompose(pb, qb, sc);
      return new THREE.Matrix4().compose(pa.lerp(pb, k), qa.slerp(qb, k), new THREE.Vector3(1, 1, 1));
    };
    const ext = smooth(lt / HANDOFF_S.extend);
    const back = smooth((lt - HANDOFF_S.transfer) / (HANDOFF_S.settle - HANDOFF_S.transfer));
    const packetM = lt < HANDOFF_S.transfer ? lerpM(gM, midM, ext) : lerpM(midM, rM, back);
    h.packet.restAt.copy(packetM);
    // the packet's own +x, and the grip on whichever end faces `who`
    const px = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(packetM));
    const endToward = (who: THREE.Vector3) => (who.clone().sub(new THREE.Vector3().setFromMatrixPosition(packetM)).dot(px) > 0 ? 1 : -1);
    const nearHand = (self: BodyPose, other: BodyPose) => (other.pos.clone().sub(self.pos).dot(new THREE.Vector3(1, 0, 0).applyQuaternion(self.q)) > 0 ? 0 : 1);
    const gripEnd = (self: BodyPose, hand: 0 | 1, sign: number, w: number): Contact => {
      const p = new THREE.Vector3(sign * 4.4, -0.5, 0.4).applyMatrix4(packetM);
      return { p, pole: new THREE.Vector3(hand === 0 ? 8 : -8, 9, -5).applyQuaternion(self.q).add(self.pos), w, fwd: px.clone().multiplyScalar(-sign), down: UP.clone().negate(), ow: 0.6 * w };
    };
    const keep = P.hand;
    if (this === h.giver) {
      const near = nearHand(P, recvPose), far = (1 - near) as 0 | 1;
      const holdW = lt < HANDOFF_S.transfer ? 1 : 1 - back;
      const end = endToward(P.pos);
      const nearC = gripEnd(P, near as 0 | 1, end, 1);
      // the far hand keeps the packet's other end only until the offer is under way
      const farC = gripEnd(P, far, -end, 1);
      const out: [Contact | null, Contact | null] = [null, null];
      out[near] = lerpC(keep[near], nearC, holdW);
      out[far] = lerpC(keep[far], farC, (1 - smooth(lt / 0.35)) * holdW);
      P.hand = out;
      P.spine.y += (near === 0 ? 0.12 : -0.12) * ext * (1 - back);
    } else {
      const near = nearHand(P, giverPose), far = (1 - near) as 0 | 1;
      const reach = smooth((lt - (HANDOFF_S.grip - 0.55)) / 0.55);
      const end = endToward(P.pos);
      const out: [Contact | null, Contact | null] = [keep[0], keep[1]];
      out[near] = lerpC(keep[near], gripEnd(P, near as 0 | 1, end, 1), reach);
      // the far hand joins only as the packet comes in to the carry
      if (back > 0) out[far] = lerpC(keep[far], gripEnd(P, far, -end, 1), back);
      P.hand = out;
      P.spine.y += (near === 0 ? 0.12 : -0.12) * reach * (1 - back);
    }
    // the two look at each other's faces, the receiver at the packet as it takes it
    const other = this === h.giver ? recvPose : giverPose;
    const head = P.pos.clone().addScaledVector(UP, 26);
    const target = this === h.receiver && lt > HANDOFF_S.grip - 0.4 && lt < HANDOFF_S.transfer + 0.2 ? mid.clone() : other.pos.clone().addScaledVector(UP, 26);
    P.look.lerp(target.sub(head).normalize(), smooth(lt / 0.3)).normalize();
    P.lookW = 1;
  }

  /** where the packet should be drawn now, if this agent holds it */
  packetMatrix(packet: WorkPacket, out: THREE.Matrix4): THREE.Matrix4 | null {
    const t = this.time;
    const h = this.handoffs.find((x) => x.packet === packet && t >= x.t0 && t <= x.t0 + HANDOFF_S.settle);
    if (h) return out.copy(packet.restAt);
    if (this.carrying(t) !== packet || !this.lastPose) return null;
    const o = new THREE.Object3D(); o.position.copy(this.lastPose.pos); o.quaternion.copy(this.lastPose.q); o.updateMatrixWorld(true);
    return carryMatrix(o, out);
  }

  /** the body's driver: runs inside MonkeyAgentBody.update, after the mixer */
  private drive(): void {
    const h = this.body.rigHandles();
    if (!h) return;
    if (!this.rig) this.rig = new MonkeyRig(h);
    const P = this.lastPose ?? this.pose(this.time);
    applyBodyPose(this.body.root, this.rig, P);
    const r = this.rig;
    if (P.w > 0) {
      const ends = ["LeftHand", "RightHand", "LeftFoot", "RightFoot"] as const;
      const cs = [P.hand[0], P.hand[1], P.foot[0], P.foot[1]];
      for (let i = 0; i < 4; i++) this.debug.reach[i] = cs[i] ? r.pos(ends[i]).distanceTo(cs[i]!.p) : -1;
    }
  }

  /** the rig, once the body has loaded (for tests / the dev panel) */
  get rigReady(): MonkeyRig | null { return this.rig; }
}

const lerpC = (a: Contact | null, b: Contact | null, t: number): Contact | null => {
  const P = blendPose(
    { ...emptyPose(), hand: [a, null] } as BodyPose,
    { ...emptyPose(), hand: [b, null] } as BodyPose,
    t,
  );
  return P.hand[0];
};
function emptyPose(): BodyPose {
  return {
    pos: new THREE.Vector3(), q: new THREE.Quaternion(), hips: new THREE.Vector3(), pelvis: new THREE.Vector3(), spine: new THREE.Vector3(), neck: new THREE.Vector3(),
    arm: [{ swing: 0, out: 0, bend: 0, end: 0 }, { swing: 0, out: 0, bend: 0, end: 0 }], leg: [{ swing: 0, out: 0, bend: 0, end: 0 }, { swing: 0, out: 0, bend: 0, end: 0 }],
    hand: [null, null], foot: [null, null], look: new THREE.Vector3(0, 0, 1), lookW: 0, w: 1,
  };
}
export { HAND_L };
