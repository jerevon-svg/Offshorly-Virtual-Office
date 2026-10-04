// vo3d human — THE SHARED BEHAVIOUR FOUNDATION: props, carriers, hand contacts, and the first two behaviours.
//
// The MonkeyAgent proved the shape (avatar/MonkeyLocomotion: a packet's pose is COMPUTED, never simulated; it is
// always in someone's hands or on a surface; hands are solved onto the prop's grips; a handoff is a timed blend
// between two holders). This is that shape for humans, in new modules — MonkeyAgent code is only READ (the
// WorkPacket geometry is reused as-is), never changed.
//
//   PROP        a world object with per-hand GRIPS in its own frame; held by a CARRIER, resting at a matrix, or
//               gliding between the two. Ownership is state (`holder`), never inferred from animation.
//   CARRIER     anything that can hold a prop: an avatar's hands, the Toucan's beak, a dock, a table.
//   CONTACTS    the per-avatar hand layer: for each hand a goal (a HAND FRAME on a world point, fingers + palm
//               directions, an elbow pole, digit curls) eased in/out by weight, the head's attention, a spine lean.
//               Runs after the shared clip: the clip moves the body, contacts put the hands where the world is.
//   BEHAVIOURS  state machines that drive contacts + props + the body: PacketCarry (receive → reach/grip → hold →
//               offer (handoff-ready) → place / cancel at any point) and DeskWork (approach → sit → type with the
//               fingertips on real keys, mouse sessions → stand). Both can be interrupted.
import * as THREE from "three";
import { WorkPacket } from "../avatar/MonkeyLocomotion";
import { HUMAN_WORLD_SCALE as W, SIDE_PREFIX, idleClip, type Digit, type HandFrame, type Side } from "./humanBaseContract";
import type { HumanAvatar } from "./HumanAvatar";
import { SEATED_CLIP, targetWorld, type Interactable } from "./humanInteraction";

const SIDES: readonly Side[] = ["L", "R"];
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

// ==================================== props & carriers ====================================================

export interface Carrier { readonly id: string; holdMatrix(out: THREE.Matrix4): THREE.Matrix4 | null }
/** a fixed place a prop can rest (a dock, a table spot) */
export class Spot implements Carrier {
  readonly id: string;
  readonly at: THREE.Matrix4;
  constructor(id: string, at: THREE.Matrix4) { this.id = id; this.at = at; }
  holdMatrix(out: THREE.Matrix4): THREE.Matrix4 { return out.copy(this.at); }
}

export type Grip = { pos: THREE.Vector3; fwd: THREE.Vector3; palm: THREE.Vector3; frame: HandFrame; curl: Partial<Record<Digit, number>> };

export class Prop {
  readonly root: THREE.Object3D;
  holder: Carrier | null = null;
  readonly world = new THREE.Matrix4();
  private glide: { from: THREE.Matrix4; to: Carrier; t: number; dur: number; done?: () => void } | null = null;
  readonly id: string;
  readonly grips: Partial<Record<Side, Grip>>;
  constructor(id: string, root: THREE.Object3D, grips: Partial<Record<Side, Grip>>) { this.id = id; this.root = root; this.grips = grips; root.matrixAutoUpdate = false; }
  get gliding(): boolean { return this.glide !== null; }
  /** progress of the current glide, 0..1 (1 when not gliding) */
  get glideU(): number { return this.glide ? smooth(this.glide.t / this.glide.dur) : 1; }
  /** move to a carrier over `dur` seconds (the target is re-read every frame: it may be walking) */
  glideTo(to: Carrier, dur: number, done?: () => void): void {
    this.glide = { from: this.world.clone(), to, t: 0, dur, done };
    this.holder = null;
  }
  place(on: Carrier): void { this.glide = null; this.holder = on; }
  update(dt: number): void {
    const m = new THREE.Matrix4();
    if (this.glide) {
      const g = this.glide; g.t += dt;
      const target = g.to.holdMatrix(m) ?? g.from;
      const u = smooth(g.t / g.dur);
      const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), s = new THREE.Vector3();
      g.from.decompose(pa, qa, s); target.decompose(pb, qb, s);
      // a gentle arc, never a straight slide through the body
      const lift = Math.sin(u * Math.PI) * 0.06 * W;
      this.world.compose(pa.lerp(pb, u).add(new THREE.Vector3(0, lift, 0)), qa.slerp(qb, u), new THREE.Vector3(1, 1, 1));
      if (g.t >= g.dur) { this.glide = null; this.holder = g.to; g.done?.(); }
    } else if (this.holder) this.holder.holdMatrix(this.world);
    this.root.matrix.copy(this.world);
    this.root.matrixWorldNeedsUpdate = true;
  }
  /** a grip in world space */
  gripWorld(side: Side): Grip | null {
    const g = this.grips[side];
    if (!g) return null;
    const q = new THREE.Quaternion(); this.world.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return { ...g, pos: g.pos.clone().applyMatrix4(this.world), fwd: g.fwd.clone().applyQuaternion(q), palm: g.palm.clone().applyQuaternion(q) };
  }
}

/** the AI Workforce packet (avatar/MonkeyLocomotion's WorkPacket geometry, reused unchanged) with human grips on
 *  its two short edges: palms facing each other, fingers forward, thumbs over the top */
export function makePacketProp(tint = 0x6fb6ff): Prop {
  const p = new WorkPacket(tint);
  // the NEAR half of each short edge: at the edge's middle the grip sat exactly at the chibi arm's full reach
  // (0.46 native from the shoulder, contract REACH.arm); here the arms stay bent (~0.37)
  const grip = (s: 1 | -1): Grip => ({ pos: new THREE.Vector3(s * 4.95, -0.1, -1.6), fwd: new THREE.Vector3(0, -0.25, 1).normalize(), palm: new THREE.Vector3(-s, 0, 0), frame: "palm", curl: { Fingers: 0.42, Index: 0.38, Thumb: 0.5 } });
  return new Prop("packet", p.root, { L: grip(1), R: grip(-1) });
}

// ==================================== hand contacts ========================================================

export type HandGoal = { frame: HandFrame; pos: THREE.Vector3; fwd: THREE.Vector3; palm: THREE.Vector3; pole: THREE.Vector3; curl: Partial<Record<Digit, number>> };
const RELAXED: Partial<Record<Digit, number>> = { Thumb: 0.12, Index: 0.1, Fingers: 0.16 };

export class HandContacts {
  readonly goal: Record<Side, (() => HandGoal | null) | null> = { L: null, R: null };
  readonly w: Record<Side, number> = { L: 0, R: 0 };
  readonly want: Record<Side, number> = { L: 0, R: 0 };
  /** seconds to blend a hand fully in or out */
  blend = 0.32;
  look: { target: (() => THREE.Vector3 | null) | null; w: number; want: number } = { target: null, w: 0, want: 0 };
  lean = { pitch: 0, w: 0, want: 0 };
  readonly error: Record<Side, number> = { L: 0, R: 0 };
  /** the last frame's cost (ms) — the proof reports the behaviour layer's price */
  lastMs = 0;

  layer(): { id: string; order: number; update: (dt: number, a: HumanAvatar) => void } {
    return { id: "hand-contacts", order: 50, update: (dt, a) => this.update(dt, a) };
  }

  private update(dt: number, a: HumanAvatar): void {
    const t0 = performance.now();
    const step = dt / this.blend;
    const ease = (cur: number, to: number) => (cur < to ? Math.min(to, cur + step) : Math.max(to, cur - step));
    this.lean.w = ease(this.lean.w, this.lean.want);
    a.rig.leanSpine(this.lean.pitch, 0, smooth(this.lean.w));
    for (const s of SIDES) {
      this.w[s] = ease(this.w[s], this.want[s]);
      const w = smooth(this.w[s]);
      const g = w > 0 ? this.goal[s]?.() ?? null : null;
      if (g) {
        // digits FIRST: a fingertip / pinch frame moves with its finger, so the arm is solved for the final hand
        const c: Partial<Record<Digit, number>> = {};
        for (const d of ["Thumb", "Index", "Fingers"] as const) c[d] = (RELAXED[d] ?? 0) * (1 - w) + (g.curl[d] ?? 0) * w;
        a.rig.setHand(s, c);
        this.error[s] = a.rig.reach(s, g.frame, g.pos, g.fwd, g.palm, g.pole, w);
      } else { this.error[s] = 0; a.rig.setHand(s, RELAXED); }
    }
    this.look.w = ease(this.look.w, this.look.want);
    const target = this.look.w > 0 ? this.look.target?.() ?? null : null;
    if (target) {
      const head = a.rig.bone("Head").getWorldPosition(new THREE.Vector3());
      a.rig.aimHead(target.clone().sub(head), smooth(this.look.w) * 0.85);
    }
    if (a.face) a.face.lookTarget = target && this.look.w > 0.4 ? target : null;
    this.lastMs = performance.now() - t0;
  }
}

/** an elbow pole that keeps the elbows out, down and a little back of the body — natural for chibi arms */
export function elbowPole(a: HumanAvatar, side: Side): THREE.Vector3 {
  const sh = a.rig.bone(`${SIDE_PREFIX[side]}Arm`).getWorldPosition(new THREE.Vector3());
  const q = a.root.getWorldQuaternion(new THREE.Quaternion());
  return sh.add(new THREE.Vector3(side === "L" ? 0.5 * W : -0.5 * W, -0.45 * W, -0.25 * W).applyQuaternion(q));
}

// ==================================== packet: receive → hold → offer → place ===============================

export type PacketState = "empty" | "receiving" | "holding" | "offering" | "placing" | "returning";

/** the avatar's hands as a CARRIER: the carry frame (belly height, below the chin, screen tilted up) eases to the
 *  offer frame (forward, presented: handoff-ready) and back */
export class PacketCarry implements Carrier {
  readonly id: string;
  state: PacketState = "empty";
  private offerK = 0;
  private source: Carrier | null = null;
  private owning = false;
  private readonly a: HumanAvatar;
  private readonly contacts: HandContacts;
  readonly packet: Prop;
  constructor(a: HumanAvatar, contacts: HandContacts, packet: Prop) {
    this.a = a; this.contacts = contacts; this.packet = packet;
    this.id = `${a.config.employeeId}:hands`;
  }
  static readonly CARRY = { pos: new THREE.Vector3(0, 0.545 * W, 0.335 * W), tilt: -0.6 };
  // presented forward at the edge of the chibi reach (contract REACH.arm 0.46): arms long, not locked
  static readonly OFFER = { pos: new THREE.Vector3(0, 0.585 * W, 0.395 * W), tilt: -0.25 };

  holdMatrix(out: THREE.Matrix4): THREE.Matrix4 {
    const k = smooth(this.offerK);
    const p = PacketCarry.CARRY.pos.clone().lerp(PacketCarry.OFFER.pos, k);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PacketCarry.CARRY.tilt + (PacketCarry.OFFER.tilt - PacketCarry.CARRY.tilt) * k);
    this.a.root.updateMatrixWorld();
    return out.compose(p, q, new THREE.Vector3(1, 1, 1)).premultiply(this.a.root.matrixWorld);
  }

  /** the packet comes to the hands; the hands go out to meet it */
  receive(from: Carrier): void {
    if (this.state !== "empty") return;
    this.source = from; this.state = "receiving"; this.owning = true;
    this.packet.glideTo(this, 1.25, () => { this.state = "holding"; });
    this.wireHands();
  }
  /** handoff-ready: presented forward, head toward the receiver */
  offer(): void { if (this.state === "holding") this.state = "offering"; }
  hold(): void { if (this.state === "offering") this.state = "holding"; }
  /** set it down on a carrier (a table spot, a dock); the hands follow it most of the way, then let go */
  place(on: Carrier): void {
    if (this.state !== "holding" && this.state !== "offering") return;
    this.state = "placing";
    this.packet.glideTo(on, 0.95, () => { this.state = "empty"; });
  }
  /** INTERRUPT at any point: an incoming packet goes back where it came from; an offer is withdrawn; a
   *  placement is taken back into the hands. Holding stays holding. */
  cancel(): void {
    if (this.state === "receiving" && this.source) { this.state = "returning"; const src = this.source; this.packet.glideTo(src, 0.8, () => { this.state = "empty"; }); }
    else if (this.state === "offering") this.state = "holding";
    else if (this.state === "placing") { this.state = "receiving"; this.packet.glideTo(this, 0.6, () => { this.state = "holding"; }); }
  }
  get holding(): boolean { return this.state === "holding" || this.state === "offering"; }

  private wireHands(): void {
    for (const s of SIDES) this.contacts.goal[s] = () => {
      const g = this.packet.gripWorld(s);
      return g ? { ...g, pole: elbowPole(this.a, s) } : null;
    };
    this.contacts.look.target = () => new THREE.Vector3().setFromMatrixPosition(this.packet.world);
  }

  layer(): { id: string; order: number; update: (dt: number) => void } { return { id: "packet-carry", order: 40, update: (dt) => this.update(dt) }; }

  private update(dt: number): void {
    this.offerK = Math.min(1, Math.max(0, this.offerK + (this.state === "offering" ? dt : -dt) / 0.55));
    const c = this.contacts;
    let hands = 0, look = 0;
    switch (this.state) {
      case "receiving": hands = this.packet.glideU > 0.3 ? 1 : 0; look = 1; break;   // reach out as it arrives
      case "holding": hands = 1; look = 0.35; break;
      case "offering": hands = 1; look = 0; break;
      case "placing": hands = this.packet.glideU < 0.78 ? 1 : 0; look = 1; break;   // let go near the end
      case "returning": hands = 0; look = 0.6; break;
      default: hands = 0; look = 0;
    }
    // the hands are this behaviour's only while it owns them (another behaviour — the desk — may be using them)
    if (this.owning) {
      c.want.L = c.want.R = hands; c.look.want = look;
      if (this.state === "empty" && c.w.L === 0 && c.w.R === 0) { c.goal.L = c.goal.R = null; c.look.target = null; this.owning = false; }
    }
    this.packet.update(dt);
  }
}

// ==================================== desk work: approach → sit → type → stand =============================

export type DeskPhase = "idle" | "approach" | "turn" | "sit" | "work" | "stand";

export class DeskWork {
  phase: DeskPhase = "idle";
  private t = 0;
  private from = new THREE.Vector3();
  private fromYaw = 0;
  private seatRoot = new THREE.Vector3();
  private readonly keys: Record<Side, THREE.Vector3[]>;
  private readonly tip: Record<Side, { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number }>;
  private mouseT = 4;
  private mouseOn = false;
  private readonly mouseRest: THREE.Vector3;
  /** keys pressed so far (per hand) — the proof shows the fingers are really on the keys */
  readonly presses: Record<Side, number> = { L: 0, R: 0 };
  private readonly a: HumanAvatar;
  private readonly contacts: HandContacts;
  private readonly station: { root: THREE.Object3D; keys: Record<Side, THREE.Vector3[]>; mouse: THREE.Object3D };
  private readonly it: Interactable;
  private readonly slotId: string;
  constructor(a: HumanAvatar, contacts: HandContacts, station: { root: THREE.Object3D; keys: Record<Side, THREE.Vector3[]>; mouse: THREE.Object3D }, it: Interactable, slotId = "seat") {
    this.a = a; this.contacts = contacts; this.station = station; this.it = it; this.slotId = slotId;
    this.keys = station.keys;
    this.tip = { L: { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.15 }, R: { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.15 } };
    this.mouseRest = station.mouse.position.clone();
  }
  private get slot() { return this.it.slots.find((s) => s.id === this.slotId)!; }
  private worldPoint(local: THREE.Vector3): THREE.Vector3 { this.station.root.updateMatrixWorld(true); return local.clone().applyMatrix4(this.station.root.matrixWorld); }
  private stationYaw(): number { return new THREE.Euler().setFromQuaternion(this.station.root.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y; }

  start(): void {
    if (this.phase !== "idle") return;
    this.phase = "approach"; this.t = 0; this.from.copy(this.a.root.position);
  }
  /** INTERRUPT: whatever the phase, get up and step back out to the approach point */
  standUp(): void {
    if (this.phase === "idle" || this.phase === "stand") return;
    if (this.phase === "approach" || this.phase === "turn") { this.finish(); return; }
    this.phase = "stand"; this.t = 0; this.from.copy(this.a.root.position);
    this.contacts.want.L = this.contacts.want.R = 0; this.contacts.look.want = 0; this.contacts.lean.want = 0;
    this.a.play(idleClip(this.a.config.idleProfile), 0.45);
    if (this.a.face) this.a.face.expression = "neutral";
  }
  private finish(): void {
    this.phase = "idle";
    this.contacts.goal.L = this.contacts.goal.R = null; this.contacts.look.target = null;
    this.a.play(idleClip(this.a.config.idleProfile), 0.3);
  }

  layer(): { id: string; order: number; update: (dt: number) => void } { return { id: "desk-work", order: 40, update: (dt) => this.update(dt) }; }

  private update(dt: number): void {
    if (this.phase === "idle") return;
    this.t += dt;
    const s = this.slot, root = this.a.root;
    const approach = this.worldPoint(new THREE.Vector3(s.approach.point[0], 0, s.approach.point[1]));
    const yawSeat = this.stationYaw() + (s.seat?.yaw ?? s.approach.yaw);
    if (this.phase === "approach") {
      const d = approach.clone().sub(this.from); d.y = 0;
      const dist = d.length(), dur = Math.max(0.2, dist / (1.25 * W));
      const u = Math.min(1, this.t / dur);
      root.position.copy(this.from).addScaledVector(d, u);
      if (dist > 0.01) root.rotation.y = Math.atan2(d.x, d.z);
      this.a.play("walking", 0.2);
      if (u >= 1) { this.phase = "turn"; this.t = 0; this.fromYaw = root.rotation.y; this.a.play(idleClip(this.a.config.idleProfile), 0.25); }
    } else if (this.phase === "turn") {
      const u = smooth(this.t / 0.45);
      let dy = yawSeat - this.fromYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      root.rotation.y = this.fromYaw + dy * u;
      if (u >= 1) {
        this.phase = "sit"; this.t = 0; this.from.copy(root.position);
        this.a.hold(SEATED_CLIP.name, SEATED_CLIP.phase, 0.5);
        // the root that puts the seated pose's Hips (a measured contract offset) exactly on the seat point
        const seatW = this.worldPoint(new THREE.Vector3(...s.seat!.point));
        const off = new THREE.Vector3(...SEATED_CLIP.hips).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawSeat);
        this.seatRoot.copy(seatW).sub(off);
      }
    } else if (this.phase === "sit") {
      root.position.lerpVectors(this.from, this.seatRoot, smooth(this.t / 0.75));
      if (this.t > 0.55) this.beginWork();
      if (this.t > 0.8) this.phase = "work";
    } else if (this.phase === "work") {
      this.work(dt);
    } else if (this.phase === "stand") {
      const u = smooth(this.t / 0.7);
      root.position.lerpVectors(this.from, approach, u);
      if (u >= 1) this.finish();
    }
  }

  private wired = false;
  private beginWork(): void {
    if (this.wired) { this.contacts.want.L = this.contacts.want.R = 1; return; }
    this.wired = true;
    const c = this.contacts;
    c.blend = 0.4;
    for (const side of SIDES) {
      const tp = this.tip[side];
      const k = this.keys[side][Math.floor(this.keys[side].length / 2)];
      tp.from.copy(k); tp.to.copy(k); tp.t = 1;
      c.goal[side] = () => this.handGoal(side);
    }
    c.want.L = c.want.R = 1;
    c.look.target = () => targetWorld(this.station.root, this.it, this.slot.look ?? "monitor").pos;
    c.look.want = 0.9;
    c.lean.pitch = 0.16; c.lean.want = 1;
    if (this.a.face) this.a.face.expression = "focused";
  }

  private handGoal(side: Side): HandGoal | null {
    if (this.phase !== "work" && this.phase !== "sit") return null;
    const kbd = targetWorld(this.station.root, this.it, side === "L" ? "keyboard.left" : "keyboard.right");
    if (side === "R" && this.mouseOn) {
      const m = this.worldPoint(this.station.mouse.position.clone().add(new THREE.Vector3(0, 0.026 * W, 0.012 * W)));
      return { frame: "palm", pos: m, fwd: kbd.fwd, palm: kbd.palm, pole: elbowPole(this.a, side), curl: { Thumb: 0.35, Index: 0.3, Fingers: 0.42 } };
    }
    const tp = this.tip[side];
    const u = smooth(Math.min(1, tp.t / tp.dur));
    const p = this.worldPoint(tp.from.clone().lerp(tp.to, u));
    p.y += Math.sin(u * Math.PI) * 0.018 * W - (u > 0.85 ? 0.003 * W : 0); // lift between keys, a press at the end
    // fingers point over the keys, palm down with a natural inward roll
    const palm = kbd.palm.clone().add(new THREE.Vector3(side === "L" ? 0.35 : -0.35, 0, 0).applyQuaternion(this.station.root.getWorldQuaternion(new THREE.Quaternion()))).normalize();
    return { frame: "tip", pos: p, fwd: kbd.fwd.clone().add(new THREE.Vector3(0, -0.35, 0)).normalize(), palm, pole: elbowPole(this.a, side), curl: { Thumb: 0.3, Index: 0.18, Fingers: 0.55 } };
  }

  private work(dt: number): void {
    for (const side of SIDES) {
      if (side === "R" && this.mouseOn) continue;
      const tp = this.tip[side];
      tp.t += dt;
      if (tp.t >= tp.dur) {
        this.presses[side]++;
        tp.from.copy(tp.to);
        const ks = this.keys[side];
        // stay near the current key: typing is local
        const near = ks.filter((k) => k.distanceTo(tp.from) < 0.12 * W);
        tp.to.copy(near[Math.floor(Math.random() * near.length)] ?? ks[0]);
        tp.t = 0; tp.dur = 0.11 + Math.random() * 0.13;
      }
    }
    // mouse sessions for the right hand
    this.mouseT -= dt;
    if (this.mouseT <= 0) { this.mouseOn = !this.mouseOn; this.mouseT = this.mouseOn ? 2 + Math.random() * 1.5 : 4 + Math.random() * 4; }
    const m = this.station.mouse;
    if (this.mouseOn && this.contacts.w.R > 0.95) {
      const tt = performance.now() / 1000;
      m.position.set(this.mouseRest.x + Math.sin(tt * 1.7) * 0.025 * W, this.mouseRest.y, this.mouseRest.z + Math.sin(tt * 2.3) * 0.018 * W);
    }
  }
}
