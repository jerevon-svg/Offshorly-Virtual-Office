// vo3d interact — FIXED lounge seating: approach → sit → seated → stand → leave.
//
// The counterpart to SeatInteraction, and deliberately a different shape because the furniture is a
// different kind of thing:
//
//   SeatInteraction  (MOVABLE desk chair)  approach → pull chair out → enter gap → sit → tuck chair in
//                                          → seated → slide chair out → stand → leave gap → return chair
//   LoungeSeat       (FIXED sofa/tub)      approach → sit → seated → stand → leave
//
// A sofa or tub chair NEVER moves, so this controller never writes to the furniture transform at all —
// furniture drift is zero by construction rather than by careful restoration. The avatar is likewise not
// parented to the furniture (nothing to follow), so a seated avatar cannot be dragged by anything.
//
// One piece of furniture may expose several slots (sofa seat-left / seat-center / seat-right); each slot
// carries its own contact point, facing, approach and occupancy id.
import * as THREE from "three";
import type { Avatar } from "../avatar/Avatar";
import { stepAlong, type ControllerStack } from "../avatar/Controller";
import { CLIP_IDLE, CLIP_SIT } from "../adapters/v1Avatar";
import { stepAngle, type Vec2 } from "../core/coords";
import type { NavResult } from "../nav/planner";
import type { LoungeSeatSlot } from "../world/WorldState";
import { seatedRoot } from "./seatContact";

export type LoungeSeatState = "idle" | "approaching" | "sitting" | "seated" | "standing" | "leaving";

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class LoungeSeatInteraction {
  state: LoungeSeatState = "idle";
  status = "idle";
  /** slot id currently held — the hook a future multi-avatar pass keys occupancy on */
  occupiedBy: string | null = null;
  private t = 0;
  private walk: Vec2[] = [];
  private readonly glideFrom = new THREE.Vector3();
  private readonly glideTo = new THREE.Vector3();
  private readonly avatar: Avatar;
  private readonly stack: ControllerStack;
  /** the furniture, read ONLY for its world matrix; never written to */
  private readonly furniture: THREE.Object3D;
  readonly slot: LoungeSeatSlot;
  private readonly requestWalk: (to: Vec2) => NavResult;
  private readonly walkSpeed: () => number;
  /** furniture transform captured at construction, purely so a test can prove it never moved */
  private readonly furnitureAtStart = new THREE.Vector3();

  constructor(avatar: Avatar, stack: ControllerStack, furniture: THREE.Object3D, slot: LoungeSeatSlot, requestWalk: (to: Vec2) => NavResult, walkSpeed: () => number = () => 30) {
    this.avatar = avatar;
    this.stack = stack;
    this.furniture = furniture;
    this.slot = slot;
    this.requestWalk = requestWalk;
    this.walkSpeed = walkSpeed;
    this.furnitureAtStart.copy(furniture.position);
  }

  /** world point on the cushion this slot seats you at */
  contactWorld(): THREE.Vector3 {
    this.furniture.updateMatrixWorld(true);
    return new THREE.Vector3(this.slot.contactLocal.x, this.slot.contactLocal.y, this.slot.contactLocal.z).applyMatrix4(this.furniture.matrixWorld);
  }
  /** the avatar root transform that rests the pelvis on this slot's cushion */
  seatedRootPosition(): THREE.Vector3 {
    return seatedRoot(this.avatar, this.contactWorld(), this.slot.seatedYaw, this.slot.sink ?? 0);
  }
  /** proof the furniture never moved (always 0 — nothing here writes to it) */
  furnitureDrift(): number {
    return this.furniture.position.distanceTo(this.furnitureAtStart);
  }

  sit(): NavResult | null {
    if (this.state !== "idle") return null;
    const res = this.requestWalk(this.slot.approach);
    if (!res.ok) {
      this.status = `approach rejected: ${res.reason}`;
      return res;
    }
    if (!this.stack.acquire("Interaction")) {
      this.status = "avatar owned elsewhere";
      return null;
    }
    this.walk = [...res.path];
    this.setState("approaching");
    return res;
  }
  stand(): void {
    if (this.state === "seated") {
      this.glideFrom.copy(this.avatar.root.position);
      const back = this.slot.approachToSeat[this.slot.approachToSeat.length - 1] ?? this.slot.approach;
      this.glideTo.set(back.x, 0, back.z);
      this.avatar.play(CLIP_IDLE, this.slot.timings.standMs / 1000);
      this.setState("standing");
    }
  }
  reset(): void {
    this.avatar.play(CLIP_IDLE, 0.15);
    this.walk = [];
    this.occupiedBy = null;
    this.stack.release("Interaction");
    this.setState("idle");
  }

  private setState(s: LoungeSeatState): void {
    this.state = s;
    this.t = 0;
    this.status = s;
  }
  private tick(ms: number, dt: number): boolean {
    this.t = Math.min(1, this.t + (dt * 1000) / ms);
    return this.t >= 1;
  }
  private walkStep(dt: number): boolean {
    stepAlong(this.avatar, this.walk, this.walkSpeed(), 7, dt);
    this.avatar.play(this.walk.length ? "walking" : CLIP_IDLE);
    this.avatar.setClipTimeScale("walking", this.walkSpeed() / 30);
    return this.walk.length === 0;
  }

  update(dt: number): void {
    const a = this.avatar, T = this.slot.timings;
    switch (this.state) {
      case "idle":
      case "seated":
        return;
      case "approaching":
        if (this.walkStep(dt)) {
          this.walk = [...this.slot.approachToSeat];
          this.glideFrom.copy(a.root.position);
          this.glideTo.copy(this.seatedRootPosition());
          a.play(CLIP_SIT, T.sitMs / 1000);
          this.setState("sitting");
        }
        return;
      case "sitting":
        a.root.position.lerpVectors(this.glideFrom, this.glideTo, easeInOut(this.t));
        a.setYaw(stepAngle(a.yaw, this.slot.seatedYaw, dt * 8));
        if (this.tick(T.sitMs, dt)) {
          a.root.position.copy(this.glideTo);
          a.setYaw(this.slot.seatedYaw);
          this.occupiedBy = this.slot.id;
          this.setState("seated");
        }
        return;
      case "standing":
        a.root.position.lerpVectors(this.glideFrom, this.glideTo, easeInOut(this.t));
        if (this.tick(T.standMs, dt)) {
          a.root.position.copy(this.glideTo);
          this.occupiedBy = null;
          this.walk = [...this.slot.approachToSeat].reverse().slice(1).concat([this.slot.approach]);
          this.setState("leaving");
        }
        return;
      case "leaving":
        if (this.walkStep(dt)) {
          this.stack.release("Interaction");
          this.setState("idle");
        }
        return;
    }
  }
}
