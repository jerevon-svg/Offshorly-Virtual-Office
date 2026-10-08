// vo3d avatar — THE MONKEYAGENT RIG POSER: rest-aligned FK, analytic two-bone IK, contact orientation.
//
// WHY A POSER AT ALL. The production base carries the seven EMPLOYEE clips. They are human motion: a walk, a
// run, a sit. A MonkeyAgent needs its own physical vocabulary (knuckle-running, climbing, hanging, poles,
// jumps), and almost all of it is defined by CONTACT — a hand on a rung, a foot on a branch, knuckles on the
// floor. So that vocabulary is built here as (1) a body pose authored in the MODEL frame and (2) limb contacts
// solved by IK onto real geometry, never as clips that hope the geometry happens to be where they reach.
//
// THE AUTHORING FRAME. Every rotation in a Pose is expressed in the model's OWN rest axes (+x the body's left,
// +y up, +z the face) and composes DOWN the chain: a joint's rotation is applied in the frame its parent's
// rotation has already carried it to. So "pitch the chest 30° forward" then "swing the arm 40° forward" means
// exactly that, whatever the bind orientations of the bones (Meshy's are arbitrary). With every rotation
// identity, the rig is in its bind T-pose.
//
// IT HOLDS NO STATE ABOUT MOTION. Each frame: applyPose (optionally blended over whatever the mixer posed),
// then solveLimb per contact, then orientEnd / aimHead. Same inputs → same pose, which is what keeps the
// locomotion sampler deterministic.
import * as THREE from "three";
import { MONKEY_SKELETON_JOINTS, MONKEY_SKELETON_PARENTS, type MonkeyJoint } from "../world/monkeyAgentContract";

export type Limb = "armL" | "armR" | "legL" | "legR";
export const LIMB_CHAIN: Readonly<Record<Limb, readonly [MonkeyJoint, MonkeyJoint, MonkeyJoint]>> = {
  armL: ["LeftArm", "LeftForeArm", "LeftHand"],
  armR: ["RightArm", "RightForeArm", "RightHand"],
  legL: ["LeftUpLeg", "LeftLeg", "LeftFoot"],
  legR: ["RightUpLeg", "RightLeg", "RightFoot"],
};
export const LIMBS: readonly Limb[] = ["armL", "armR", "legL", "legR"];

/** A body pose: rest-aligned model-frame rotations per joint, plus a model-frame offset of the pelvis (WORLD
 *  units — the model is uniformly scaled, so this is converted once). Unlisted joints keep their rest. */
export type Pose = { rot: Partial<Record<MonkeyJoint, THREE.Quaternion>>; hips?: THREE.Vector3 };

/** model-axis rotation helpers (radians). Composed right-to-left: q(x,y,z) applies z, then y, then x? No — it
 *  is the explicit product below, so callers build exactly the order they mean. */
export const qx = (a: number, out = new THREE.Quaternion()) => out.setFromAxisAngle(AX.x, a);
export const qy = (a: number, out = new THREE.Quaternion()) => out.setFromAxisAngle(AX.y, a);
export const qz = (a: number, out = new THREE.Quaternion()) => out.setFromAxisAngle(AX.z, a);
/** product a·b·c… (the LAST factor is applied first) */
export function qmul(...qs: THREE.Quaternion[]): THREE.Quaternion {
  const out = new THREE.Quaternion();
  for (const q of qs) out.multiply(q);
  return out;
}
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export class MonkeyRig {
  readonly model: THREE.Object3D;
  readonly bones: ReadonlyMap<string, THREE.Bone>;
  /** joints parent-first (the contract order already is) */
  private readonly order: MonkeyJoint[] = MONKEY_SKELETON_JOINTS.filter((j) => j !== "head_end" && j !== "headfront");
  private readonly restLocalQ = new Map<MonkeyJoint, THREE.Quaternion>();
  private readonly restModelQ = new Map<MonkeyJoint, THREE.Quaternion>();
  private readonly restHipsLocal = new THREE.Vector3();
  /** model-frame rest position of each joint, in WORLD units (the model's scale applied) */
  readonly restPos = new Map<MonkeyJoint, THREE.Vector3>();
  /** world-unit segment lengths of each limb: [upper, lower] */
  readonly len = {} as Record<Limb, [number, number]>;
  /** model scale (world units per native unit) */
  readonly scale: number;
  /** scratch: the procedural pose's model-frame orientations, reused every frame */
  private readonly posedModelQ = new Map<MonkeyJoint, THREE.Quaternion>();

  constructor(h: { model: THREE.Object3D; bones: ReadonlyMap<string, THREE.Bone>; skeleton: THREE.Skeleton }) {
    this.model = h.model;
    this.bones = h.bones;
    h.skeleton.pose(); // the bind pose: the contract's T-pose, whatever the mixer last wrote
    h.model.updateMatrixWorld(true);
    this.scale = h.model.getWorldScale(V1).x;
    const invModel = h.model.getWorldQuaternion(Q1).invert();
    const invModelM = M1.copy(h.model.matrixWorld).invert();
    for (const j of this.order) {
      const b = this.bone(j);
      this.restLocalQ.set(j, b.quaternion.clone());
      this.restModelQ.set(j, invModel.clone().multiply(b.getWorldQuaternion(Q2)));
      // model-frame position in world units: model-local × scale
      this.restPos.set(j, b.getWorldPosition(new THREE.Vector3()).applyMatrix4(invModelM).multiplyScalar(this.scale));
      this.posedModelQ.set(j, new THREE.Quaternion());
    }
    this.restHipsLocal.copy(this.bone("Hips").position);
    for (const l of LIMBS) {
      const [a, b, c] = LIMB_CHAIN[l];
      this.len[l] = [this.restPos.get(a)!.distanceTo(this.restPos.get(b)!), this.restPos.get(b)!.distanceTo(this.restPos.get(c)!)];
    }
  }

  bone(j: MonkeyJoint): THREE.Bone {
    const b = this.bones.get(j);
    if (!b) throw new Error(`monkey rig: no bone ${j}`);
    return b;
  }

  /** Write `pose` onto the bones, blended by `w` over whatever they hold now (the mixer's clip pose). */
  applyPose(pose: Pose, w = 1): void {
    for (const j of this.order) {
      const parent = MONKEY_SKELETON_PARENTS[j];
      const r = pose.rot[j];
      // D_j = D_parent · R_j, and the joint's model orientation is D_j · rest_j
      const dParent = parent ? D.get(parent)! : IDENT;
      const d = (D.get(j) ?? (D.set(j, new THREE.Quaternion()), D.get(j)!)).copy(dParent);
      if (r) d.multiply(r);
      const modelQ = this.posedModelQ.get(j)!.copy(d).multiply(this.restModelQ.get(j)!);
      // local = parentModel⁻¹ · model  (the root bone's parent IS the model frame)
      const local = parent ? Q1.copy(this.posedModelQ.get(parent)!).invert().multiply(modelQ) : Q1.copy(modelQ);
      const b = this.bone(j);
      if (w >= 1) b.quaternion.copy(local);
      else b.quaternion.slerp(local, w);
    }
    const hips = this.bone("Hips");
    V1.copy(this.restHipsLocal);
    if (pose.hips) V1.addScaledVector(pose.hips, 1 / this.scale);
    if (w >= 1) hips.position.copy(V1);
    else hips.position.lerp(V1, w);
    this.model.updateMatrixWorld(true);
  }

  /** world position of a joint now */
  pos(j: MonkeyJoint, out = new THREE.Vector3()): THREE.Vector3 {
    return this.bone(j).getWorldPosition(out);
  }

  /** Rotate bone `j` by a WORLD rotation `q` (about its own pivot); its subtree follows. */
  rotateWorld(j: MonkeyJoint, q: THREE.Quaternion): void {
    const b = this.bone(j);
    const parentW = b.parent!.getWorldQuaternion(Q3);
    const boneW = b.getWorldQuaternion(Q4);
    b.quaternion.copy(parentW.invert().multiply(Q5.copy(q).multiply(boneW)));
    b.updateMatrixWorld(true);
  }

  /** Set bone `j`'s WORLD orientation outright. */
  setWorldQ(j: MonkeyJoint, q: THREE.Quaternion): void {
    const b = this.bone(j);
    const parentW = b.parent!.getWorldQuaternion(Q3);
    b.quaternion.copy(parentW.invert().multiply(q));
    b.updateMatrixWorld(true);
  }

  /** Swing bone `j` minimally so the direction toward its child joint becomes `dir` (world), keeping twist. */
  private aimBone(j: MonkeyJoint, child: MonkeyJoint, dir: THREE.Vector3, w: number): void {
    const a = this.pos(j, V2), c = this.pos(child, V3);
    const cur = c.sub(a).normalize();
    const want = V4.copy(dir).normalize();
    const q = Q6.setFromUnitVectors(cur, want);
    if (w < 1) q.slerp(IDENT, 1 - w);
    this.rotateWorld(j, q);
  }

  /** ANALYTIC TWO-BONE IK. Places the limb's end joint at `target` (world), bending in the plane that holds
   *  `pole` (a world point the middle joint should bend toward). `w` blends from the FK pose. Out-of-reach
   *  targets straighten the limb along the line to them (never past it — no stretching). Returns the reach
   *  ratio |root→target| / (upper+lower), so a caller can see when a contact is asking too much. */
  solveLimb(limb: Limb, target: THREE.Vector3, pole: THREE.Vector3, w = 1): number {
    if (w <= 0) return 0;
    const [ja, jb, jc] = LIMB_CHAIN[limb];
    const [la, lb] = this.len[limb];
    const a = this.pos(ja, new THREE.Vector3());
    const toT = V5.copy(target).sub(a);
    const dist = toT.length();
    const reach = dist / (la + lb);
    const d = THREE.MathUtils.clamp(dist, Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
    const dirT = toT.normalize();
    // bend plane: the pole projected off the root→target line
    const toP = V6.copy(pole).sub(a);
    const bend = toP.addScaledVector(dirT, -toP.dot(dirT));
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(dirT, -dirT.z);
    bend.normalize();
    // angle at the root between the target line and the upper bone (law of cosines)
    const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const midWant = V7.copy(a).addScaledVector(dirT, cosA * la).addScaledVector(bend, sinA * la);
    this.aimBone(ja, jb, V8.copy(midWant).sub(a), w);
    const b = this.pos(jb, new THREE.Vector3());
    const endWant = V8.copy(a).addScaledVector(dirT, d);
    this.aimBone(jb, jc, endWant.sub(b), w);
    return reach;
  }

  /** ORIENT AN END JOINT (hand or foot) onto a contact: its rest "forward" (fingers/toes, model +x for the left
   *  hand, −x for the right, +z for the feet) goes to `fwd`, and its rest "down" (palm/sole, model −y) to
   *  `down`. Both world directions; orthonormalised with `down` winning. */
  orientEnd(j: MonkeyJoint, fwd: THREE.Vector3, down: THREE.Vector3, w = 1): void {
    if (w <= 0) return;
    const restF = j === "LeftHand" ? AX.x : j === "RightHand" ? NEG_X : AX.z;
    // the joint's rest axes in WORLD now = modelWorldQ · rest_frame; we build the world frame we want and
    // solve the world orientation that carries the rest frame (restF, −y) onto it
    const modelQ = this.model.getWorldQuaternion(Q7);
    const restWorldF = V2.copy(restF).applyQuaternion(modelQ);
    const restWorldD = V3.set(0, -1, 0).applyQuaternion(modelQ);
    const fromM = basis(restWorldF, restWorldD, M2);
    const toM = basis(V4.copy(fwd), V5.copy(down), M3);
    const delta = Q8.setFromRotationMatrix(toM.multiply(fromM.transpose()));
    // the rest-frame world orientation of this joint: modelQ · restModel_j
    const want = Q9.copy(delta).multiply(modelQ).multiply(this.restModelQ.get(j)!);
    if (w < 1) want.slerp(this.bone(j).getWorldQuaternion(Q10), 1 - w);
    this.setWorldQ(j, want);
  }

  /** HEAD AIM: turn neck + head so the face looks along `dir` (world), shared 35/65, each clamped. */
  aimHead(dir: THREE.Vector3, w = 1, maxNeck = 0.9, maxHead = 1.1): void {
    if (w <= 0) return;
    for (const [j, share, max] of [["neck", 0.35, maxNeck], ["Head", 1, maxHead]] as const) {
      const b = this.bone(j);
      // current face direction: the model's +z carried by this joint's delta from rest
      const wq = b.getWorldQuaternion(Q3);
      const delta = Q4.copy(wq).multiply(Q5.copy(this.restModelQ.get(j)!).invert()).premultiply(Q6.copy(this.model.getWorldQuaternion(Q7)).invert());
      const face = V2.set(0, 0, 1).applyQuaternion(delta).applyQuaternion(this.model.getWorldQuaternion(Q7));
      const q = Q8.setFromUnitVectors(face.normalize(), V3.copy(dir).normalize());
      const ang = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(q.w), 0, 1));
      const k = Math.min(1, max / Math.max(1e-6, ang)) * share * w;
      q.slerp(IDENT, 1 - k);
      this.rotateWorld(j, q);
    }
  }
}

/** an orthonormal basis matrix with columns (fwd, up = −down × …) — down wins */
function basis(fwd: THREE.Vector3, down: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  const d = down.normalize();
  const f = fwd.addScaledVector(d, -fwd.dot(d)).normalize();
  const s = V9.crossVectors(d, f).normalize();
  return out.makeBasis(f, d, s);
}

const D = new Map<MonkeyJoint, THREE.Quaternion>();
const IDENT = new THREE.Quaternion();
const NEG_X = new THREE.Vector3(-1, 0, 0);
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), V4 = new THREE.Vector3(), V5 = new THREE.Vector3();
const V6 = new THREE.Vector3(), V7 = new THREE.Vector3(), V8 = new THREE.Vector3(), V9 = new THREE.Vector3();
const Q1 = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), Q3 = new THREE.Quaternion(), Q4 = new THREE.Quaternion(), Q5 = new THREE.Quaternion();
const Q6 = new THREE.Quaternion(), Q7 = new THREE.Quaternion(), Q8 = new THREE.Quaternion(), Q9 = new THREE.Quaternion(), Q10 = new THREE.Quaternion();
const M1 = new THREE.Matrix4(), M2 = new THREE.Matrix4(), M3 = new THREE.Matrix4();
