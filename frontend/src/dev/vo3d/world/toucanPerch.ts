// vo3d world — THE TOUCAN'S ARM PERCH, the decision between a summoned bird and the body it was called to: when to raise
// the arm (human/armPerch), hand the bird its landing on the fist (world/Toucan setLanding) and let both go. Lifted out of
// app/world so the whole summon → land → release sequence can be driven in a test with the real bird and a real body.
//
// A LATCHED ENGAGEMENT, NOT A PER-FRAME VERDICT. Summoned while the body stands free, the perch ENGAGES at once: the arm
// starts to rise and the bird is given the fist as its landing in the same frame (it flies straight to it; the arm is up
// long before it arrives, and the landing follows the fist as it rises). It then holds until something REAL ends it —
// the employee lets the bird go, walks off (the body leaves the spot it engaged on), an interaction takes the body (a
// seat, an approach), or an AI Workforce job takes the bird. An earlier version re-derived "may perch" every frame from
// the body's current clip and owner and only handed over the landing once the arm was fully up: any one-frame flicker
// dropped the landing and restarted the arm, so the arm hovered half-raised and the bird waited beside the shoulder.
import * as THREE from "three";
import type { ArmPerch } from "../human/armPerch";
import type { Toucan } from "./Toucan";

/** the perched bird's size: a companion, measured clear of a chibi's face and hair on the presented fist */
export const PERCH_SCALE = 0.75;
/** walking further than this from where the perch engaged ends it (world units) */
const LEAVE_SPOT = 4;

export type PerchBody = {
  /** the body is its own: no seat, approach or other interaction owns it (walking is told apart by `pos`) */
  free: boolean;
  /** the body's root (world) and its facing (horizontal, world) */
  pos: THREE.Vector3;
  forward: THREE.Vector3;
};

export class ToucanPerch {
  /** engaged: the arm is offered and the bird has the fist as its landing */
  perched = false;
  /** the bird still holds a landing this perch gave it (until it has left the fist after a release) */
  private handedOff = false;
  private readonly spot = new THREE.Vector3();
  private readonly last = new THREE.Vector3(Infinity, 0, 0);
  private readonly toucan: Toucan;
  constructor(toucan: Toucan) { this.toucan = toucan; }

  /** once per frame, BEFORE the bird's own update. `called` = the employee summoned it; `directed` = an AI Workforce job
   *  owns the bird (and its landing). */
  update(arm: ArmPerch | null, body: PerchBody, called: boolean, directed: boolean): void {
    if (!arm) return;
    const t = this.toucan;
    const still = body.pos.distanceTo(this.last) < 0.05;
    this.last.copy(body.pos);
    if (this.perched) {
      const released = !called;
      if (released || directed || !body.free || body.pos.distanceTo(this.spot) > LEAVE_SPOT) {
        this.perched = false;
        // let go ON the fist: the landing stays until the bird has opened its wings there and left (Toucan liftoff).
        // Anything else (walking off, sitting, a job) hands the bird straight back to its own hover.
        if (!(released && t.landed)) this.clear();
      }
    } else if (called && !directed && body.free && still) {
      this.perched = true;
      this.spot.copy(body.pos);
    }
    if (this.perched) {
      const p = arm.perchPoint(), face = arm.headCentre().addScaledVector(body.forward, 6);   // the face's front
      t.setLanding({ x: p.x, y: p.y + t.footOffset * PERCH_SCALE, z: p.z }, PERCH_SCALE);
      t.setFaceOverride({ x: face.x, z: face.z });
      this.handedOff = true;
    } else if (this.handedOff && !t.liftingOff && !t.landed) {
      this.clear();   // gone from the fist
    }
    // the arm is offered while engaged, and stays up while a released bird is still on it
    const up = this.perched || (this.handedOff && body.free);
    arm.want = up ? 1 : 0;
    arm.lookAt = up && t.worldPosition.distanceTo(body.pos) < 60 ? t.worldPosition.clone() : null;
  }

  private clear(): void {
    this.handedOff = false;
    this.toucan.setLanding(null);
    this.toucan.setFaceOverride(null);
  }
}
