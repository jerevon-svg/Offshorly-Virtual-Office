// vo3d human — ARM PERCH: the summoned Toucan's landing place. The right arm is raised STRAIGHT AHEAD, a little above
// level, the elbow extended and the fist closed thumb-up — the falconer's offered glove — and the employee looks at the
// bird. Eased in and out, solved with the rig's own two-bone reach (no clip, no per-employee pose).
//
// WHY THE BIRD STANDS ON THE FIST. The chibi arm chain is ~8 u long while the face sits ~6–7 u ahead of the shoulder joint
// (measured on the shared body), so a bird on the forearm is in the face. On top of the closed fist the same arm puts it a
// hand's length further out — far enough for a companion-sized bird (app/world PERCH_SCALE) to stand there turned to face
// the employee, clear of face and hair (human/armPerch.test.ts keeps that clearance). The host reads `perchPoint` and
// hands it to the bird's existing landing (world/Toucan setLanding); flying in, folding its wings and leaving are its own.
import * as THREE from "three";
import { HUMAN_WORLD_SCALE as W, SIDE_PREFIX, type Side } from "./humanBaseContract";
import type { HumanAvatar } from "./HumanAvatar";

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const FIST = { Thumb: 0.55, Index: 0.85, Fingers: 0.9 } as const;
const RELAXED = { Thumb: 0.12, Index: 0.1, Fingers: 0.16 } as const;
/** the presented arm: its aim from straight ahead (−5°, a touch inward: the reaching shoulder rolls the fist outward, so it
 *  lands in front of its own shoulder), how far above level (15°), and where the palm is aimed as a share of the arm's
 *  length (well past 1: the arm straightens and the IK clamps it — elbow extended). Chosen by sweeping a folded-toucan
 *  proxy against the real body over several idle phases. */
export const PERCH_POSE = { out: (-5 * Math.PI) / 180, up: (15 * Math.PI) / 180, extend: 1.25 } as const;

export class ArmPerch {
  /** 1 = offer the arm, 0 = lower it; the arm eases toward it over BLEND seconds */
  want = 0;
  readonly side: Side = "R";
  /** seconds to raise / lower the arm fully */
  blend = 0.6;
  /** where the bird is (world), for the head to turn to; null = no look */
  lookAt: THREE.Vector3 | null = null;
  private w = 0;
  private look = 0;
  private eyesOn = false;
  private readonly h: HumanAvatar;
  constructor(h: HumanAvatar) { this.h = h; }

  /** fully offered: the arm is up and still, ready to take the bird */
  get extended(): boolean { return this.w >= 1; }
  get weight(): number { return this.w; }

  layer(): { id: string; order: number; update: (dt: number) => void } { return { id: "arm-perch", order: 55, update: (dt) => this.update(dt) }; }

  /** the presented arm's direction from the shoulder (world), for this frame's body */
  private direction(): { sh: THREE.Vector3; dir: THREE.Vector3; out: THREE.Vector3 } {
    const rig = this.h.rig, p = SIDE_PREFIX[this.side];
    const sh = rig.bone(`${p}Arm`).getWorldPosition(new THREE.Vector3());
    const out = this.outward();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.h.root.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    const flat = fwd.multiplyScalar(Math.cos(PERCH_POSE.out)).addScaledVector(out, Math.sin(PERCH_POSE.out));
    const dir = flat.multiplyScalar(Math.cos(PERCH_POSE.up)).add(new THREE.Vector3(0, Math.sin(PERCH_POSE.up), 0)).normalize();
    return { sh, dir, out };
  }

  private update(dt: number): void {
    const was = this.w;
    this.w = this.want > this.w ? Math.min(this.want, this.w + dt / this.blend) : Math.max(this.want, this.w - dt / this.blend);
    if (this.w <= 0) {
      this.look = 0;
      if (was > 0) { this.h.clearance.intentional = () => false; if (this.eyesOn && this.h.face) this.h.face.lookTarget = null; this.eyesOn = false; }
      return;
    }
    const rig = this.h.rig, p = SIDE_PREFIX[this.side], w = smooth(this.w);
    const chain = rig.bone(`${p}Arm`).getWorldPosition(new THREE.Vector3()).distanceTo(rig.bone(`${p}ForeArm`).getWorldPosition(new THREE.Vector3()))
      + rig.bone(`${p}ForeArm`).getWorldPosition(new THREE.Vector3()).distanceTo(rig.bone(`${p}Hand`).getWorldPosition(new THREE.Vector3()));
    const { sh, dir, out } = this.direction();
    const wrist = sh.clone().addScaledVector(dir, chain * PERCH_POSE.extend);
    // a thumb-up fist: knuckles along the arm, palm facing in toward the body's midline
    const palm = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    if (palm.dot(out) > 0) palm.negate();
    // the elbow points down and a little back: an almost-straight arm with a natural soft bend
    const pole = wrist.clone().lerp(sh, 0.5).add(new THREE.Vector3(0, -2 * W, 0)).addScaledVector(dir, -0.6 * W);
    const c: Partial<Record<"Thumb" | "Index" | "Fingers", number>> = {};
    for (const d of ["Thumb", "Index", "Fingers"] as const) c[d] = RELAXED[d] * (1 - w) + FIST[d] * w;
    rig.setHand(this.side, c);
    rig.reach(this.side, "palm", wrist, dir, palm, pole, w);
    // and look at the bird once it is close (eased, never past a comfortable turn)
    this.look += ((this.lookAt ? 1 : 0) - this.look) * Math.min(1, dt * 3);
    if (this.lookAt && this.look > 0.01) {
      const head = rig.bone("Head").getWorldPosition(new THREE.Vector3());
      rig.aimHead(this.lookAt.clone().sub(head), smooth(this.look) * 0.75 * w);
    }
    // the eyes meet the bird's (and are handed back once it has gone)
    const eyes = this.lookAt !== null && this.look > 0.4;
    if (this.h.face && (eyes || this.eyesOn)) this.h.face.lookTarget = eyes ? this.lookAt : null;
    this.eyesOn = eyes;
    // the presented arm is intentional: body clearance leaves it where it was put
    this.h.clearance.intentional = (s) => s === this.side;
  }

  /** where a perching bird's feet go: on top of the closed fist, just past the wrist (world space, this frame's pose) */
  perchPoint(out = new THREE.Vector3()): THREE.Vector3 {
    const rig = this.h.rig, p = SIDE_PREFIX[this.side];
    const fore = rig.bone(`${p}ForeArm`).getWorldPosition(new THREE.Vector3()), hand = rig.bone(`${p}Hand`).getWorldPosition(new THREE.Vector3());
    out.copy(hand).addScaledVector(hand.clone().sub(fore).normalize(), 0.07 * W);
    out.y += this.h.clearance.radius(`forearm${this.side}`) + 0.005 * W;
    return out;
  }
  /** the body's sideways direction toward the presented arm's side (horizontal) */
  outward(out = new THREE.Vector3()): THREE.Vector3 {
    const rig = this.h.rig, p = SIDE_PREFIX[this.side];
    return out.copy(rig.bone(`${p}Arm`).getWorldPosition(new THREE.Vector3())).sub(rig.bone(`${SIDE_PREFIX[this.side === "R" ? "L" : "R"]}Arm`).getWorldPosition(new THREE.Vector3())).setY(0).normalize();
  }
  /** the head's centre (world): where a perched bird faces to talk */
  headCentre(out = new THREE.Vector3()): THREE.Vector3 { return this.h.rig.bone("Head").getWorldPosition(out); }
}
