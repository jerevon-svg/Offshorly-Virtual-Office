// Design Room true-3D POC — CHAIR PULL + SIT + STAND interaction proof (one chair).
//
// Clip inspection (bon-v3 LOD1, Hips translation tracks, native cm):
//   idle-9 / walking          standing loops, hips y ≈ 49 / 45
//   agree / listening         standing gesture loops, hips y ≈ 53
//   sit-on-chair-arms         SEATED LOOP, hips y ≈ 37, pelvis offset (+13.7, −16) cm from the root
//   sitting-answering         SEATED LOOP, hips y ≈ 38, pelvis offset (−9, −16) cm
// There is NO stand→sit or sit→stand transition clip in the shipped set, so
// the sit-down / stand-up are CODE-DRIVEN: a timed cross-fade between idle-9
// and sit-on-chair-arms while the root glides to / from the seat anchor and
// is lifted so the clip's seated pelvis lands on the cushion. The offsets are
// read from the clip tracks at runtime (no hardcoded numbers), so a
// different avatar or LOD keeps working.
//
// Chair transform: the chair's Group (built by build.ts, named by manifest id)
// is animated along its pull axis with an ease-in-out; its resting transform
// is captured once and restored EXACTLY at the end of every cycle.
// Attachment: while seated the avatar root is re-parented INTO the chair group
// (THREE.Object3D.attach keeps the world transform), so the chair carries Bon
// during slide-in / slide-out with no per-frame copying and no drift.
import * as THREE from "three";
import type { Avatar, Ground } from "./avatar";
import { headingFor, stepAngle } from "./avatar";
import type { NavResult } from "./nav";

export const CLIP_SIT = "sit-on-chair-arms";
export const CLIP_IDLE = "idle-9";
export const CLIP_WALK = "walking";

/** Isolated metadata for the ONE chair used by this proof (design-member-chair-4). */
export type SeatSpec = {
  chairId: string;
  /** production stand-here cell centre for this seat (room-relative) — A* target and exit point */
  approach: Ground;
  /** point in the gap between the pulled-out chair and the desk where the sit-down starts (room-relative) */
  preSeat: Ground;
  /** waypoints from `approach` into `preSeat` (walked with the walking clip, not A*: the grid blocks this gap) */
  approachToSeat: Ground[];
  /** world-space unit vector the chair pulls along (away from the desk) */
  pullDir: Ground;
  pullDistance: number;
  /** cushion top height and local seat centre offset inside the chair group */
  cushionTopY: number;
  cushionLocal: { x: number; z: number };
  /** heading (rotation.y) the sitter faces; north = π */
  seatedHeading: number;
  /** pelvis offset from the cushion centre toward the backrest (chair-local +z), units */
  sitDepth: number;
  /** how far short of the resting transform the chair stops while OCCUPIED (units along pullDir); 0 = fully tucked */
  seatedTuck: number;
  timings: { pullMs: number; sitMs: number; slideMs: number; standMs: number; returnMs: number };
};

export const CHAIR_4_SPEC: SeatSpec = {
  chairId: "design-member-chair-4",
  approach: { x: 174.5, z: 187.8 }, // grid stand cell (11,31)
  preSeat: { x: 155.3, z: 178.5 },
  approachToSeat: [
    { x: 168, z: 178.5 },
    { x: 155.3, z: 178.5 },
  ],
  pullDir: { x: 0, z: 1 },
  pullDistance: 22,
  cushionTopY: 14.4,
  cushionLocal: { x: 0, z: 0.3 },
  seatedHeading: Math.PI,
  // Seated alignment: pelvis 3.5 units back on the cushion + chair parked 7 units short of the
  // desk while occupied → torso clears the desk edge, head sits behind the laptop. Both are
  // per-seat data; the resting transform itself is untouched and restored exactly on stand.
  sitDepth: 3.5,
  seatedTuck: 7,
  timings: { pullMs: 900, sitMs: 650, slideMs: 1000, standMs: 650, returnMs: 900 },
};

export type SeatState =
  | "idle"
  | "approaching"
  | "pullingOut"
  | "enteringGap"
  | "sitting"
  | "slidingIn"
  | "seated"
  | "slidingOut"
  | "standing"
  | "leavingGap"
  | "returningChair";

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Hips translation of a clip's first key, in model-local metres (armature scale applied). */
function hipsOfClip(clip: THREE.AnimationClip, armatureScale: number): THREE.Vector3 {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name)) as THREE.VectorKeyframeTrack | undefined;
  if (!track) return new THREE.Vector3();
  return new THREE.Vector3(track.values[0], track.values[1], track.values[2]).multiplyScalar(armatureScale);
}

export class SeatInteraction {
  state: SeatState = "idle";
  /** progress 0..1 inside timed states */
  private t = 0;
  private restPos = new THREE.Vector3();
  private restQuat = new THREE.Quaternion();
  private pulledPos = new THREE.Vector3();
  /** where the chair parks while occupied (rest + seatedTuck along the pull axis) */
  private tuckedPos = new THREE.Vector3();
  private chair: THREE.Object3D;
  private sceneParent: THREE.Object3D | null = null;
  /** root pose at the start of the sit glide / end of the stand glide */
  private glideFrom = new THREE.Vector3();
  private glideTo = new THREE.Vector3();
  private lastNav: NavResult | null = null;
  status = "idle";
  private readonly avatar: Avatar;
  readonly spec: SeatSpec;
  private readonly requestWalk: (to: Ground) => NavResult;

  constructor(avatar: Avatar, chair: THREE.Object3D, spec: SeatSpec, requestWalk: (to: Ground) => NavResult) {
    this.avatar = avatar;
    this.spec = spec;
    this.requestWalk = requestWalk;
    this.chair = chair;
    this.restPos.copy(chair.position);
    this.restQuat.copy(chair.quaternion);
    const dir = new THREE.Vector3(spec.pullDir.x, 0, spec.pullDir.z);
    this.pulledPos.copy(this.restPos).addScaledVector(dir, spec.pullDistance);
    this.tuckedPos.copy(this.restPos).addScaledVector(dir, spec.seatedTuck);
  }

  get busy(): boolean {
    return this.state !== "idle" && this.state !== "seated";
  }
  get ownsAvatar(): boolean {
    return this.state !== "idle";
  }

  /** World position of the cushion centre for the chair's CURRENT position. */
  private seatWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.spec.cushionLocal.x, this.spec.cushionTopY, this.spec.cushionLocal.z + this.spec.sitDepth).applyMatrix4(this.chair.matrixWorld);
  }

  /** Root position that puts the sit clip's pelvis on the cushion centre (computed from clip data). */
  private seatedRootFor(seat: THREE.Vector3): THREE.Vector3 {
    const gltf = this.avatar.gltf;
    if (!gltf) return seat.clone();
    const armature = gltf.scene.getObjectByName("Armature");
    const armScale = (armature?.scale.x ?? 1) * gltf.scene.scale.x; // cm → model → world
    const sit = gltf.animations.find((c) => c.name === CLIP_SIT);
    const idle = gltf.animations.find((c) => c.name === CLIP_IDLE);
    if (!sit || !idle) return seat.clone();
    const hipsSit = hipsOfClip(sit, armScale);
    const hipsIdle = hipsOfClip(idle, armScale);
    // pelvis horizontal offset relative to the standing pose, rotated by the seated heading
    const dx = hipsSit.x - hipsIdle.x, dz = hipsSit.z - hipsIdle.z;
    const h = this.spec.seatedHeading;
    const wx = dx * Math.cos(h) + dz * Math.sin(h);
    const wz = -dx * Math.sin(h) + dz * Math.cos(h);
    // lift so the seated pelvis (hipsSit.y above the root) rests on the cushion, sunk 0.6 into it
    const lift = seat.y - hipsSit.y - 0.6;
    return new THREE.Vector3(seat.x - wx, Math.max(0, lift), seat.z - wz);
  }

  sit(): NavResult | null {
    if (this.state !== "idle") return null;
    const res = this.requestWalk(this.spec.approach); // PRODUCTION A* to the stand-here cell
    this.lastNav = res;
    if (!res.ok) {
      this.status = `approach rejected: ${res.reason}`;
      return res;
    }
    this.avatar.mode = "controlled";
    this.avatar.walkOverride = "auto";
    this.avatar.playing = true;
    this.avatar.setPath(res.path);
    this.setState("approaching");
    return res;
  }

  stand(): void {
    if (this.state !== "seated") return;
    this.setState("slidingOut");
  }

  /** Abort anything in flight: chair back to rest, Bon to the exit point, idle. */
  reset(): void {
    if (this.sceneParent && this.avatar.root.parent !== this.sceneParent) this.sceneParent.attach(this.avatar.root);
    this.chair.position.copy(this.restPos);
    this.chair.quaternion.copy(this.restQuat);
    this.avatar.root.position.set(this.spec.approach.x, 0, this.spec.approach.z);
    this.avatar.root.rotation.set(0, headingFor(-1, 0), 0);
    this.avatar.heading = headingFor(-1, 0);
    this.avatar.play(CLIP_IDLE, 0.15);
    this.avatar.setPath([]);
    this.avatar.mode = "free";
    this.setState("idle");
  }

  private setState(s: SeatState): void {
    this.state = s;
    this.t = 0;
    this.status = s;
  }

  update(dtSec: number): void {
    const a = this.avatar;
    const sp = this.spec;
    switch (this.state) {
      case "idle":
      case "seated":
        return;
      case "approaching": {
        // avatar.update() is bypassed in controlled mode; consume the A* path here
        a.stepPath(dtSec, true);
        if (!a.moving) this.setState("pullingOut");
        return;
      }
      case "pullingOut": {
        // from the stand-here cell: face the chair while it pulls back from the desk
        this.t = Math.min(1, this.t + (dtSec * 1000) / sp.timings.pullMs);
        this.chair.position.lerpVectors(this.restPos, this.pulledPos, easeInOut(this.t));
        const faceChair = headingFor(this.pulledPos.x - a.root.position.x, this.pulledPos.z - a.root.position.z);
        a.heading = stepAngle(a.heading, faceChair, dtSec * 6);
        a.root.rotation.set(0, a.heading, 0);
        a.play(CLIP_IDLE, 0.2);
        if (this.t >= 1) {
          this.chair.position.copy(this.pulledPos);
          a.setPath(sp.approachToSeat); // the gap between desk and pulled chair is now clear
          this.setState("enteringGap");
        }
        return;
      }
      case "enteringGap": {
        a.stepPath(dtSec, true);
        if (!a.moving) {
          this.chair.updateMatrixWorld(true);
          this.glideFrom.copy(a.root.position);
          this.glideTo.copy(this.seatedRootFor(this.seatWorld()));
          a.play(CLIP_SIT, sp.timings.sitMs / 1000);
          this.setState("sitting");
        }
        return;
      }
      case "sitting": {
        // code-driven sit-down: glide back onto the seat + lift while the clips cross-fade
        this.t = Math.min(1, this.t + (dtSec * 1000) / sp.timings.sitMs);
        const k = easeInOut(this.t);
        a.root.position.lerpVectors(this.glideFrom, this.glideTo, k);
        a.heading = stepAngle(a.heading, sp.seatedHeading, dtSec * 8);
        a.root.rotation.set(0, a.heading, 0);
        if (this.t >= 1) {
          this.sceneParent = a.root.parent;
          this.chair.attach(a.root); // ride the chair from here on
          // attach() re-derives the Euler from the world quaternion; at yaw ≈ π that comes back as
          // (±π, 0, ±π), which later `rotation.y` writes would mirror. Re-express as pure local yaw.
          a.root.rotation.set(0, a.heading - this.chair.rotation.y, 0);
          this.setState("slidingIn");
        }
        return;
      }
      case "slidingIn": {
        this.t = Math.min(1, this.t + (dtSec * 1000) / sp.timings.slideMs);
        this.chair.position.lerpVectors(this.pulledPos, this.tuckedPos, easeInOut(this.t));
        if (this.t >= 1) {
          this.chair.position.copy(this.tuckedPos);
          this.setState("seated");
        }
        return;
      }
      case "slidingOut": {
        this.t = Math.min(1, this.t + (dtSec * 1000) / sp.timings.slideMs);
        this.chair.position.lerpVectors(this.tuckedPos, this.pulledPos, easeInOut(this.t));
        if (this.t >= 1) {
          this.chair.position.copy(this.pulledPos);
          this.chair.updateMatrixWorld(true);
          if (this.sceneParent) this.sceneParent.attach(a.root); // detach, keep world pose
          a.root.rotation.set(0, a.heading, 0); // same Euler-residue guard as the attach above
          this.glideFrom.copy(a.root.position);
          this.glideTo.set(sp.preSeat.x, 0, sp.preSeat.z);
          a.play(CLIP_IDLE, sp.timings.standMs / 1000);
          this.setState("standing");
        }
        return;
      }
      case "standing": {
        this.t = Math.min(1, this.t + (dtSec * 1000) / sp.timings.standMs);
        a.root.position.lerpVectors(this.glideFrom, this.glideTo, easeInOut(this.t));
        if (this.t >= 1) {
          a.root.position.copy(this.glideTo);
          a.setPath([...sp.approachToSeat].reverse().slice(1).concat([sp.approach]));
          this.setState("leavingGap");
        }
        return;
      }
      case "leavingGap": {
        a.stepPath(dtSec, true);
        if (!a.moving) this.setState("returningChair");
        return;
      }
      case "returningChair": {
        this.t = Math.min(1, this.t + (dtSec * 1000) / sp.timings.returnMs);
        this.chair.position.lerpVectors(this.pulledPos, this.restPos, easeInOut(this.t));
        a.play(CLIP_IDLE, 0.2);
        if (this.t >= 1) {
          this.chair.position.copy(this.restPos); // exact restore
          this.chair.quaternion.copy(this.restQuat);
          a.mode = "free";
          this.setState("idle");
        }
        return;
      }
    }
  }

  /** For tests / overlay: how far the chair currently is from its resting transform. */
  chairRestError(): number {
    return this.chair.position.distanceTo(this.restPos) + 100 * (1 - Math.abs(this.chair.quaternion.dot(this.restQuat)));
  }
  get lastNavResult(): NavResult | null {
    return this.lastNav;
  }
}
