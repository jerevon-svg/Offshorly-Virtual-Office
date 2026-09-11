// vo3d interact — chair pull → sit → slide-in → seated → slide-out → stand → leave → return chair.
// Promoted from designRoom3d/sit.ts. Data comes from the entity's `seat` capability; the chair's view
// is the moving carrier; the avatar is OWNED ("Interaction") for the whole sequence.
// Clip inspection (bon-v3): both seated clips are LOOPS, no stand↔sit transition exists, so sit-down /
// stand-up are code-driven cross-fades while the root glides and is lifted from clip Hips data.
import * as THREE from "three";
import type { Avatar } from "../avatar/Avatar";
import { stepAlong, type ControllerStack } from "../avatar/Controller";
import { CLIP_IDLE, CLIP_SIT } from "../adapters/v1Avatar";
import { headingFor, stepAngle, type Vec2 } from "../core/coords";
import type { NavResult } from "../nav/planner";
import type { SeatCapability } from "../world/WorldState";

export type SeatState =
  | "idle" | "approaching" | "pullingOut" | "enteringGap" | "sitting" | "slidingIn"
  | "seated" | "slidingOut" | "standing" | "leavingGap" | "returningChair";

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
function hipsOfClip(clip: THREE.AnimationClip, scale: number): THREE.Vector3 {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name)) as THREE.VectorKeyframeTrack | undefined;
  return track ? new THREE.Vector3(track.values[0], track.values[1], track.values[2]).multiplyScalar(scale) : new THREE.Vector3();
}

export class SeatInteraction {
  state: SeatState = "idle";
  status = "idle";
  private t = 0;
  private readonly restPos = new THREE.Vector3();
  private readonly restQuat = new THREE.Quaternion();
  private readonly pulledPos = new THREE.Vector3();
  private readonly tuckedPos = new THREE.Vector3();
  private sceneParent: THREE.Object3D | null = null;
  private readonly glideFrom = new THREE.Vector3();
  private readonly glideTo = new THREE.Vector3();
  private walk: Vec2[] = [];
  private readonly avatar: Avatar;
  private readonly stack: ControllerStack;
  private readonly chair: THREE.Object3D;
  readonly spec: SeatCapability;
  private readonly requestWalk: (to: Vec2) => NavResult;
  private readonly walkSpeed: () => number;

  constructor(avatar: Avatar, stack: ControllerStack, chair: THREE.Object3D, spec: SeatCapability, requestWalk: (to: Vec2) => NavResult, walkSpeed: () => number = () => 30) {
    this.avatar = avatar; this.stack = stack; this.chair = chair; this.spec = spec; this.requestWalk = requestWalk; this.walkSpeed = walkSpeed;
    this.restPos.copy(chair.position);
    this.restQuat.copy(chair.quaternion);
    const dir = new THREE.Vector3(spec.pullDir.x, 0, spec.pullDir.z);
    this.pulledPos.copy(this.restPos).addScaledVector(dir, spec.pullDistance);
    this.tuckedPos.copy(this.restPos).addScaledVector(dir, spec.seatedTuck);
  }
  get ownsAvatar(): boolean { return this.state !== "idle"; }

  private seatWorld(): THREE.Vector3 {
    this.chair.updateMatrixWorld(true);
    return new THREE.Vector3(this.spec.cushionLocal.x, this.spec.cushionTopY, this.spec.cushionLocal.z + this.spec.sitDepth).applyMatrix4(this.chair.matrixWorld);
  }
  /** root position that puts the sit clip's pelvis on the cushion (from clip data; no hard-coded offsets) */
  private seatedRootFor(seat: THREE.Vector3): THREE.Vector3 {
    const g = this.avatar.gltf;
    if (!g) return seat.clone();
    const arm = g.scene.getObjectByName("Armature");
    const scale = (arm?.scale.x ?? 1) * g.scene.scale.x;
    const sit = g.animations.find((c) => c.name === CLIP_SIT), idle = g.animations.find((c) => c.name === CLIP_IDLE);
    if (!sit || !idle) return seat.clone();
    const hs = hipsOfClip(sit, scale), hi = hipsOfClip(idle, scale);
    const dx = hs.x - hi.x, dz = hs.z - hi.z, h = this.spec.seatedYaw;
    const wx = dx * Math.cos(h) + dz * Math.sin(h), wz = -dx * Math.sin(h) + dz * Math.cos(h);
    return new THREE.Vector3(seat.x - wx, Math.max(0, seat.y - hs.y - 0.6), seat.z - wz);
  }

  sit(): NavResult | null {
    if (this.state !== "idle") return null;
    const res = this.requestWalk(this.spec.approach); // planner (composed walkability) to the stand-here cell
    if (!res.ok) { this.status = `approach rejected: ${res.reason}`; return res; }
    if (!this.stack.acquire("Interaction")) { this.status = "avatar owned elsewhere"; return null; }
    this.walk = [...res.path];
    this.setState("approaching");
    return res;
  }
  stand(): void { if (this.state === "seated") this.setState("slidingOut"); }
  reset(): void {
    if (this.sceneParent && this.avatar.root.parent !== this.sceneParent) this.avatar.detachTo(this.sceneParent);
    this.chair.position.copy(this.restPos);
    this.chair.quaternion.copy(this.restQuat);
    this.avatar.setPosition(this.spec.approach, 0);
    this.avatar.setYaw(headingFor(-1, 0));
    this.avatar.play(CLIP_IDLE, 0.15);
    this.walk = [];
    this.stack.release("Interaction");
    this.setState("idle");
  }
  private setState(s: SeatState): void { this.state = s; this.t = 0; this.status = s; }
  private tick(ms: number, dt: number): boolean { this.t = Math.min(1, this.t + (dt * 1000) / ms); return this.t >= 1; }
  private walkStep(dt: number): boolean {
    stepAlong(this.avatar, this.walk, this.walkSpeed(), 7, dt);
    this.avatar.play(this.walk.length ? "walking" : CLIP_IDLE);
    this.avatar.setClipTimeScale("walking", this.walkSpeed() / 30);
    return this.walk.length === 0;
  }

  update(dt: number): void {
    const a = this.avatar, sp = this.spec, T = sp.timings;
    switch (this.state) {
      case "idle": case "seated": return;
      case "approaching":
        if (this.walkStep(dt)) this.setState("pullingOut");
        return;
      case "pullingOut": {
        this.chair.position.lerpVectors(this.restPos, this.pulledPos, easeInOut(this.t));
        a.setYaw(stepAngle(a.yaw, headingFor(this.pulledPos.x - a.root.position.x, this.pulledPos.z - a.root.position.z), dt * 6));
        a.play(CLIP_IDLE, 0.2);
        if (this.tick(T.pullMs, dt)) { this.chair.position.copy(this.pulledPos); this.walk = [...sp.approachToSeat]; this.setState("enteringGap"); }
        return;
      }
      case "enteringGap":
        if (this.walkStep(dt)) {
          this.glideFrom.copy(a.root.position);
          this.glideTo.copy(this.seatedRootFor(this.seatWorld()));
          a.play(CLIP_SIT, T.sitMs / 1000);
          this.setState("sitting");
        }
        return;
      case "sitting": {
        a.root.position.lerpVectors(this.glideFrom, this.glideTo, easeInOut(this.t));
        a.setYaw(stepAngle(a.yaw, sp.seatedYaw, dt * 8));
        if (this.tick(T.sitMs, dt)) { this.sceneParent = a.root.parent; a.attachTo(this.chair); this.setState("slidingIn"); }
        return;
      }
      case "slidingIn":
        this.chair.position.lerpVectors(this.pulledPos, this.tuckedPos, easeInOut(this.t));
        if (this.tick(T.slideMs, dt)) { this.chair.position.copy(this.tuckedPos); this.setState("seated"); }
        return;
      case "slidingOut":
        this.chair.position.lerpVectors(this.tuckedPos, this.pulledPos, easeInOut(this.t));
        if (this.tick(T.slideMs, dt)) {
          this.chair.position.copy(this.pulledPos);
          if (this.sceneParent) a.detachTo(this.sceneParent);
          this.glideFrom.copy(a.root.position);
          this.glideTo.set(sp.preSeat.x, 0, sp.preSeat.z);
          a.play(CLIP_IDLE, T.standMs / 1000);
          this.setState("standing");
        }
        return;
      case "standing":
        a.root.position.lerpVectors(this.glideFrom, this.glideTo, easeInOut(this.t));
        if (this.tick(T.standMs, dt)) { a.root.position.copy(this.glideTo); this.walk = [...sp.approachToSeat].reverse().slice(1).concat([sp.approach]); this.setState("leavingGap"); }
        return;
      case "leavingGap":
        if (this.walkStep(dt)) this.setState("returningChair");
        return;
      case "returningChair":
        this.chair.position.lerpVectors(this.pulledPos, this.restPos, easeInOut(this.t));
        a.play(CLIP_IDLE, 0.2);
        if (this.tick(T.returnMs, dt)) {
          this.chair.position.copy(this.restPos);
          this.chair.quaternion.copy(this.restQuat);
          this.stack.release("Interaction");
          this.setState("idle");
        }
        return;
    }
  }
  chairRestError(): number { return this.chair.position.distanceTo(this.restPos) + 100 * (1 - Math.abs(this.chair.quaternion.dot(this.restQuat))); }
}
