// vo3d human — THE HUMANBASE RIG LAYER: procedural posing on top of the shared clips.
//
// Generalised from what the MonkeyAgent proved (avatar/monkeyRig, avatar/riderPose) WITHOUT importing or changing
// either: nothing here is authored in a bone's LOCAL axes. Every edit is a world/model-space rotation measured
// from where the joints really are this frame, carried into the bone's parent space (parent⁻¹ · R · world), so
// the same call works on any body built on HumanBase_V1 — and would keep working if a future build varied its
// silhouette. Runs AFTER the mixer every frame; a bone the mixer animates is rewritten by the next clip sample,
// and the digits (no clip tracks) are SET, never accumulated.
//
//   bindPoint      a bind-space point carried rigidly by a bone, in world (sockets, hand frames, the face)
//   solveArm       analytic two-bone IK, shoulder → elbow → wrist, elbow toward a pole
//   reach          put a HAND FRAME (grip / palm / pinch / tip) on a world point with a chosen palm orientation
//   curl           thumb / index / fingers, 0 straight … 1 closed
//   aimHead        neck + head toward a direction, clamped
import * as THREE from "three";
import { DIGITS, HAND_FRAMES, SIDE_PREFIX, handFramePosition, type Digit, type HandFrame, type HumanJoint, type Side } from "./humanBaseContract";

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

/** rotate a bone by a WORLD-space rotation, expressed in its parent's frame; refreshes its subtree */
export function rotateWorld(bone: THREE.Object3D, r: THREE.Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(_q2).invert();
  const boneQ = bone.getWorldQuaternion(_q3);
  bone.quaternion.copy(parentQ.multiply(r).multiply(boneQ));
  bone.updateMatrixWorld(true);
}

/** curl limits per digit segment (radians at amount = 1) */
const CURL = { Thumb: [0.55, 0.7], Index: [1.25, 1.35], Fingers: [1.3, 1.45] } as const;

export class HumanRig {
  readonly model: THREE.Object3D;
  readonly body: THREE.SkinnedMesh;
  readonly bones: ReadonlyMap<string, THREE.Bone>;
  private readonly index = new Map<string, number>();
  /** model-frame rest orientation of each bone */
  private readonly restModelQ = new Map<string, THREE.Quaternion>();
  /** each digit's curl axis in its parent's (the hand's / segment 1's) local frame */
  private readonly curlAxis = new Map<string, THREE.Vector3>();
  /** hand rest directions in the model frame: fingers + palm normal */
  private readonly restHand: Record<Side, { fwd: THREE.Vector3; palm: THREE.Vector3 }>;

  constructor(model: THREE.Object3D, body: THREE.SkinnedMesh, bones: ReadonlyMap<string, THREE.Bone>) {
    this.model = model; this.body = body; this.bones = bones;
    body.skeleton.bones.forEach((b, i) => this.index.set(b.name, i));
    // the bind pose, whatever the mixer last wrote
    // Skeleton.pose() writes the ROOT bone's full bind world matrix into its local transform (the Armature's 0.01
    // scale included), so position, rotation AND scale are saved and restored around it
    const saved = body.skeleton.bones.map((b) => b.quaternion.clone());
    const savedP = body.skeleton.bones.map((b) => b.position.clone());
    const savedS = body.skeleton.bones.map((b) => b.scale.clone());
    body.skeleton.pose();
    model.updateMatrixWorld(true);
    const invModel = model.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const b of body.skeleton.bones) this.restModelQ.set(b.name, invModel.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())));
    const toModel = (v: THREE.Vector3) => v.applyQuaternion(invModel).normalize();
    const pos = (n: string) => this.bone(n).getWorldPosition(new THREE.Vector3());
    const rh = {} as Record<Side, { fwd: THREE.Vector3; palm: THREE.Vector3 }>;
    for (const side of ["L", "R"] as const) {
      const p = SIDE_PREFIX[side];
      const fwd = toModel(pos(`${p}Fingers2`).sub(pos(`${p}Hand`)));
      const palm = new THREE.Vector3(0, -1, 0); // palms face down in the bind (contract)
      rh[side] = { fwd, palm };
      const handRest = this.restModelQ.get(`${p}Hand`)!.clone().invert();
      for (const d of DIGITS) {
        const dir = toModel(pos(`${p}${d}2`).sub(pos(`${p}${d}1`)));
        // rotating about (dir × palm) by +θ turns the digit toward the palm
        const axisModel = new THREE.Vector3().crossVectors(dir, palm).normalize();
        if (d === "Thumb") axisModel.lerp(new THREE.Vector3().crossVectors(fwd, palm).normalize(), 0.35).normalize();
        this.curlAxis.set(`${p}${d}`, axisModel.applyQuaternion(handRest).normalize());
      }
    }
    this.restHand = rh;
    body.skeleton.bones.forEach((b, i) => { b.quaternion.copy(saved[i]); b.position.copy(savedP[i]); b.scale.copy(savedS[i]); });
    model.updateMatrixWorld(true);
  }

  bone(name: string): THREE.Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`humanbase rig: no bone ${name}`);
    return b;
  }

  /** the matrix that carries a BIND-space point rigidly with `bone` into world */
  bindMatrixOf(bone: string, out: THREE.Matrix4): THREE.Matrix4 {
    const i = this.index.get(bone);
    if (i === undefined) throw new Error(`humanbase rig: no bone ${bone}`);
    return out.copy(this.bone(bone).matrixWorld).multiply(this.body.skeleton.boneInverses[i]).multiply(this.body.bindMatrix);
  }
  bindPoint(bone: string, p: THREE.Vector3Like, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(p.x, p.y, p.z).applyMatrix4(this.bindMatrixOf(bone, _m));
  }
  /** a hand frame's world position now */
  handFrame(side: Side, f: HandFrame, out = new THREE.Vector3()): THREE.Vector3 {
    const [x, y, z] = handFramePosition(side, f);
    return this.bindPoint(`${SIDE_PREFIX[side]}${HAND_FRAMES[f].bone}`, { x, y, z }, out);
  }

  /** analytic two-bone IK: put the WRIST (hand bone origin) at `target`, the elbow toward `pole`. Returns the
   *  remaining distance (0 when reachable). Blended by w over whatever the bones hold now. */
  solveArm(side: Side, target: THREE.Vector3, pole: THREE.Vector3, w = 1): number {
    const p = SIDE_PREFIX[side];
    const arm = this.bone(`${p}Arm`), fore = this.bone(`${p}ForeArm`), hand = this.bone(`${p}Hand`);
    const q0a = arm.quaternion.clone(), q0f = fore.quaternion.clone();
    const S = arm.getWorldPosition(_a), E = fore.getWorldPosition(_b), Wr = hand.getWorldPosition(_c);
    const la = S.distanceTo(E), lb = E.distanceTo(Wr);
    const toT = _d.copy(target).sub(S);
    const dist = Math.min(toT.length(), (la + lb) * 0.999), dir = toT.normalize();
    const poleDir = _e.copy(pole).sub(S); poleDir.addScaledVector(dir, -poleDir.dot(dir)).normalize();
    const cosA = Math.min(1, Math.max(-1, (la * la + dist * dist - lb * lb) / (2 * la * dist)));
    const elbow = S.clone().addScaledVector(dir, la * cosA).addScaledVector(poleDir, la * Math.sqrt(1 - cosA * cosA));
    rotateWorld(arm, _q.setFromUnitVectors(E.clone().sub(S).normalize(), elbow.clone().sub(S).normalize()));
    const E2 = fore.getWorldPosition(new THREE.Vector3()), W2 = hand.getWorldPosition(new THREE.Vector3());
    rotateWorld(fore, _q.setFromUnitVectors(W2.clone().sub(E2).normalize(), target.clone().sub(E2).normalize()));
    if (w < 1) { arm.quaternion.slerpQuaternions(q0a, arm.quaternion.clone(), w); fore.quaternion.slerpQuaternions(q0f, fore.quaternion.clone(), w); arm.updateMatrixWorld(true); }
    return hand.getWorldPosition(new THREE.Vector3()).distanceTo(target) * (w >= 1 ? 1 : 0);
  }

  /** the world orientation a hand must have for its fingers to point along `fwd` with the palm facing `palm`
   *  (both world directions) */
  handOrientation(side: Side, fwd: THREE.Vector3, palm: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
    const modelQ = this.model.getWorldQuaternion(_q3);
    const inv = modelQ.clone().invert();
    const f = fwd.clone().applyQuaternion(inv).normalize();
    const pl = palm.clone().applyQuaternion(inv); pl.addScaledVector(f, -pl.dot(f)).normalize();
    const r = this.restHand[side];
    const rp = r.palm.clone(); rp.addScaledVector(r.fwd, -rp.dot(r.fwd)).normalize();
    const basis = (x: THREE.Vector3, y: THREE.Vector3) => _m2.makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
    const want = new THREE.Quaternion().setFromRotationMatrix(basis(f, pl));
    const rest = new THREE.Quaternion().setFromRotationMatrix(basis(r.fwd, rp));
    const delta = want.multiply(rest.invert());
    return out.copy(modelQ).multiply(delta).multiply(this.restModelQ.get(`${SIDE_PREFIX[side]}Hand`)!);
  }

  /** REACH: put hand frame `f` on `target` with the hand oriented (fwd, palm). Two passes (the frame's offset
   *  from the wrist depends on the orientation reached). Returns the frame's remaining error. */
  reach(side: Side, f: HandFrame, target: THREE.Vector3, fwd: THREE.Vector3, palm: THREE.Vector3, pole: THREE.Vector3, w = 1): number {
    if (w <= 0.001) return 0;
    const p = SIDE_PREFIX[side];
    const hand = this.bone(`${p}Hand`), arm = this.bone(`${p}Arm`), fore = this.bone(`${p}ForeArm`);
    const q0 = [arm.quaternion.clone(), fore.quaternion.clone(), hand.quaternion.clone()];
    const want = this.handOrientation(side, fwd, palm);
    const clav = this.bone(`${p}Shoulder`), qc = clav.quaternion.clone();
    for (let pass = 0; pass < 3; pass++) {
      // orient the hand, measure the frame's offset from the wrist, solve the arm for wrist = target − offset
      const parentQ = hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      hand.quaternion.copy(parentQ.multiply(want)); hand.updateMatrixWorld(true);
      const off = this.handFrame(side, f, new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3()));
      const wrist = target.clone().sub(off);
      // CLAVICLE PROTRACTION: a chibi arm is short (contract REACH.arm); past ~95% of the chain the shoulder blade
      // rolls toward the target (≤ 20°) the way a person reaches, instead of the hand stopping short
      if (pass === 0) {
        const S = arm.getWorldPosition(new THREE.Vector3()), C = clav.getWorldPosition(new THREE.Vector3());
        const chain = S.distanceTo(fore.getWorldPosition(new THREE.Vector3())) + fore.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()));
        const over = S.distanceTo(wrist) / chain - 0.95;
        if (over > 0) {
          const from = S.clone().sub(C).normalize(), to = wrist.clone().sub(C).normalize();
          const full = new THREE.Quaternion().setFromUnitVectors(from, to);
          const k = Math.min(1, over / 0.12) * Math.min(1, 0.35 / Math.max(1e-6, 2 * Math.acos(Math.min(1, Math.abs(full.w)))));
          rotateWorld(clav, new THREE.Quaternion().slerp(full, k));
        }
      }
      this.solveArm(side, wrist, pole, 1);
    }
    const parentQ = hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    hand.quaternion.copy(parentQ.multiply(want)); hand.updateMatrixWorld(true);
    if (w < 1) {
      const sol = [arm.quaternion.clone(), fore.quaternion.clone(), hand.quaternion.clone()];
      [arm, fore, hand].forEach((b, k) => b.quaternion.slerpQuaternions(q0[k], sol[k], w));
      clav.quaternion.slerpQuaternions(qc, clav.quaternion.clone(), w);
      clav.updateMatrixWorld(true);
    }
    return this.handFrame(side, f, new THREE.Vector3()).distanceTo(target);
  }

  /** set a digit's curl (0 straight … 1 closed); segment 2 bends a little more than segment 1 */
  curl(side: Side, digit: Digit, amount: number): void {
    const p = SIDE_PREFIX[side];
    const axis = this.curlAxis.get(`${p}${digit}`)!;
    const [a1, a2] = CURL[digit];
    this.bone(`${p}${digit}1`).quaternion.setFromAxisAngle(axis, a1 * amount);
    this.bone(`${p}${digit}2`).quaternion.setFromAxisAngle(axis, a2 * amount);
  }
  setHand(side: Side, curls: Partial<Record<Digit, number>>): void {
    for (const d of DIGITS) this.curl(side, d, curls[d] ?? 0);
    this.bone(`${SIDE_PREFIX[side]}Hand`).updateMatrixWorld(true);
  }

  /** neck + head toward a world direction, clamped (yaw, pitch in radians), blended by w */
  aimHead(dir: THREE.Vector3, w = 1, maxYaw = 0.75, maxPitch = 0.45): void {
    if (w <= 0.001) return;
    const head = this.bone("Head"), neck = this.bone("neck");
    const modelQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const inv = modelQ.clone().invert();
    const d = dir.clone().applyQuaternion(inv).normalize();
    const yaw = Math.max(-maxYaw, Math.min(maxYaw, Math.atan2(d.x, d.z)));
    const pitch = Math.max(-maxPitch, Math.min(maxPitch, Math.asin(Math.max(-1, Math.min(1, d.y)))));
    const wantM = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // current facing: the head's rest forward (+z) carried by its current rotation
    const headM = inv.clone().multiply(head.getWorldQuaternion(new THREE.Quaternion()));
    const cur = new THREE.Vector3(0, 0, 1).applyQuaternion(headM.multiply(this.restModelQ.get("Head")!.clone().invert())).normalize();
    const full = new THREE.Quaternion().setFromUnitVectors(cur, wantM);
    const share = (b: THREE.Bone, k: number) => {
      const qm = new THREE.Quaternion().slerp(full, k * w);
      rotateWorld(b, modelQ.clone().multiply(qm).multiply(inv));
    };
    // the same axis-angle split 40/60 between the neck and the head sums to the full turn
    share(neck, 0.4);
    share(head, 0.6);
  }

  /** bend the spine (model-frame pitch forward +, yaw) spread over the three spine bones */
  leanSpine(pitch: number, yaw = 0, w = 1): void {
    if (w <= 0.001) return;
    const modelQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const inv = modelQ.clone().invert();
    for (const [name, k] of [["Spine02", 0.25], ["Spine01", 0.35], ["Spine", 0.4]] as const) {
      const qm = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * k * w, yaw * k * w, 0, "YXZ"));
      rotateWorld(this.bone(name), modelQ.clone().multiply(qm).multiply(inv));
    }
  }

  /** every joint the contract names (tests: the base and every module must resolve all of them) */
  has(j: HumanJoint): boolean { return this.bones.has(j); }
}
