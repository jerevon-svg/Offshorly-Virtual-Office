// vo3d avatar — THE SCOOTER RIDER'S POSE: both hands on the grips, elbows bent, a slight forward lean,
// the body leaning with the deck. A post-animation layer, applied after the mixer each frame, that owns
// nothing the mixer does not overwrite on the next frame — which is what makes switching it off clean.
//
// WHY A SOLVER AND NOT A CLIP. The ten roster rigs share joint NAMES but not rest rotations, bone lengths or
// even bone axes (the repaired rigs' forearms are off-axis), and each one's arm correction was solved from
// its own bind offline (render3d/live3dCharacters). A fixed pose or a shared clip lands every rig's hands
// somewhere different. So nothing here is authored in local bone space: every rotation is a WORLD-space
// delta measured from where the rig's joints actually are this frame, carried into the bone's parent space
// (parent⁻¹ · R · world) — the same method the offline arm fixes use — so it adapts to any rig that has the
// standard chain, including future employees, with no per-character data.
//
// WHAT IT DOES, per frame, on top of the frozen neutral idle:
//   1. the deck's lean is the whole body's: the model group rolls about the scooter's own ground pivot
//   2. the torso pitches forward from the spine base; the neck gives the pitch back (and half the roll), so
//      the head stays level instead of inheriting the scooter's attitude
//   3. each arm is an analytic two-bone solve — shoulder → elbow → PALM, the palm measured once from the
//      rig's own hand vertices — with the elbow bent out, down and back; the hand then continues the
//      forearm and turns palm-down, the turn shared between forearm and hand so neither wrist candy-wraps
//   4. the rider stands where their arms reach: each rig is placed along the deck once, so its shoulder
//      sits at a comfortable fraction of its own reach from the grips (short arms stand closer)
//   5. everything blends in and out over BLEND seconds; at zero weight the model group is back at identity
//      and the bones are the mixer's own — nothing leaks into walking.
import * as THREE from "three";

/** the rider's frame: feet at the origin on the deck, facing +z, +x the rider's left (world/scooters) */
export type RiderFrameGeometry = {
  left: THREE.Vector3Like;
  right: THREE.Vector3Like;
  /** the point the deck leans about (the scooter's origin, on the ground) */
  pivot: THREE.Vector3Like;
};

/** seconds to blend fully in or out */
export const RIDER_BLEND = 0.2;
/** forward torso pitch, radians, from the spine base */
export const RIDER_TORSO_LEAN = 0.14;
/** how much of the deck's roll the head gives back (it leans a little with the scooter, not all the way) */
const HEAD_ROLL_KEEP = 0.5;
/** the fraction of each arm's own reach (shoulder → palm) the rider stands from the grips */
export const RIDER_REACH_FRACTION = 0.92;
/** how far along the deck a rig may be moved to reach comfortably */
export const RIDER_STANCE_LIMIT = 3;
/** the elbow's preferred direction in the rider frame, for the left arm (x mirrors for the right) */
const POLE = new THREE.Vector3(0.55, -0.7, -0.45).normalize();

const ARMS = [
  { side: "left" as const, names: ["LeftArm", "LeftForeArm", "LeftHand"], sign: 1 },
  { side: "right" as const, names: ["RightArm", "RightForeArm", "RightHand"], sign: -1 },
];

type Arm = {
  side: "left" | "right";
  sign: 1 | -1;
  arm: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  /** the palm's centre in the hand bone's own frame (measured from the rig's hand vertices) */
  palm: THREE.Vector3;
};
type Rig = { scene: THREE.Object3D; spine: THREE.Bone; neck: THREE.Bone; arms: Arm[]; bones: THREE.Bone[]; stance: number | null };

/** The palm's centre in the hand bone's frame: the centroid of the bind vertices the hand owns (weight ≥ 0.6),
 *  carried from bind space into the bone's frame. null when the mesh gives nothing to measure. */
export function measurePalm(mesh: THREE.SkinnedMesh, handName: string): THREE.Vector3 | null {
  const bones = mesh.skeleton.bones;
  const hi = bones.findIndex((b) => b.name === handName);
  const pos = mesh.geometry.getAttribute("position"), si = mesh.geometry.getAttribute("skinIndex"), sw = mesh.geometry.getAttribute("skinWeight");
  if (hi < 0 || !pos || !si || !sw) return null;
  const toBone = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[hi], mesh.bindMatrix);
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    let best = -1, bw = 0;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    if (best !== hi || bw < 0.6) continue;
    c.add(v.fromBufferAttribute(pos, i).applyMatrix4(toBone));
    n++;
  }
  return n ? c.divideScalar(n) : null;
}

function findRig(scene: THREE.Object3D): Rig | null {
  const bone = (n: string) => scene.getObjectByName(n) as THREE.Bone | undefined;
  const spine = bone("Spine"), neck = bone("neck");
  const mesh = scene.getObjectByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh | undefined;
  if (!spine || !neck) return null;
  const arms: Arm[] = [];
  for (const a of ARMS) {
    const [arm, fore, hand] = a.names.map(bone);
    if (!arm || !fore || !hand) return null;
    // no mesh to measure: assume the palm sits half a forearm beyond the wrist along the hand bone
    const palm = (mesh && measurePalm(mesh, a.names[2])) ?? new THREE.Vector3(0, hand.position.length() * 0.5, 0);
    arms.push({ side: a.side, sign: a.sign as 1 | -1, arm, fore, hand, palm });
  }
  return { scene, spine, neck, arms, bones: [spine, neck, ...arms.flatMap((a) => [a.arm, a.fore, a.hand])], stance: null };
}

// scratch — the solve allocates nothing per frame
const _q = new THREE.Quaternion(), _hq = new THREE.Quaternion();
const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _W = new THREE.Vector3(), _T = new THREE.Vector3(), _P = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _pole = new THREE.Vector3(), _v = new THREE.Vector3();
const _lat = new THREE.Vector3(), _fwd = new THREE.Vector3(), _down = new THREE.Vector3(), _med = new THREE.Vector3();
const _roll = new THREE.Quaternion(), _pivot = new THREE.Vector3(), _shift = new THREE.Vector3();
const _r = new THREE.Quaternion(), _rp = new THREE.Quaternion(), _rb = new THREE.Quaternion();
const _nl = new THREE.Vector3(), _dir = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** rotate a bone by a WORLD-space rotation, expressed in its parent's frame; refreshes its subtree */
function rotateWorld(bone: THREE.Object3D, r: THREE.Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(_rp).invert();
  const boneQ = bone.getWorldQuaternion(_rb);
  bone.quaternion.copy(parentQ.multiply(r).multiply(boneQ));
  bone.updateMatrixWorld(true);
}
const fromTo = (from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion => _r.setFromUnitVectors(from, to);
const about = (axis: THREE.Vector3, angle: number): THREE.Quaternion => _r.setFromAxisAngle(axis, angle);

export type RiderPoseStats = { weight: number; stance: number; error: { left: number; right: number } };

export class RiderPose {
  private rig: Rig | null = null;
  private w = 0;
  private on = false;
  private lean = 0;
  private pitch = 0;
  /** the frame group's transform when the pose took it over — restored exactly at zero weight */
  private readonly restPos = new THREE.Vector3();
  private readonly restQuat = new THREE.Quaternion();
  private owned = false;
  /** the mixer's own pose of each touched bone (the base the pose is laid on) */
  private readonly saved: THREE.Quaternion[] = [];
  private readonly posed: THREE.Quaternion[] = [];
  /** what this layer last WROTE to each bone. three's PropertyMixer only writes a bone when its mixed value
   *  CHANGES — a frozen clip (the riding idle) never changes, so the mixer leaves our pose in place and it
   *  would compound frame on frame. A bone still holding exactly what we wrote was not rewritten, so the
   *  mixer's pose for it is still `saved`. */
  private readonly written: THREE.Quaternion[] = [];
  private wrote = false;
  private readonly frame: THREE.Object3D;
  private readonly geo: RiderFrameGeometry;
  /** the last solve's palm-to-grip distances, for tests and the dev panel */
  readonly stats: RiderPoseStats = { weight: 0, stance: 0, error: { left: 0, right: 0 } };

  /** `frame` is the avatar's model group: a child of its root, parent of the loaded scene */
  constructor(frame: THREE.Object3D, geo: RiderFrameGeometry) {
    this.frame = frame;
    this.geo = geo;
  }

  /** the rig changed (a load, an LOD swap) or went away */
  setScene(scene: THREE.Object3D | null): void {
    this.release();
    this.wrote = false;
    this.rig = scene ? findRig(scene) : null;
  }
  /** mount (true) or dismount (false); the pose blends over RIDER_BLEND either way */
  set(on: boolean): void { this.on = on; }
  /** the deck's roll, radians (world/scooters' lean: + rolls about the rider's forward axis) */
  setLean(lean: number): void { this.lean = Number.isFinite(lean) ? lean : 0; }
  /** the deck's pitch, radians, nose up + (a ramp, a kerb): the body pitches with it about the same pivot */
  setPitch(pitch: number): void { this.pitch = Number.isFinite(pitch) ? pitch : 0; }
  get weight(): number { return this.w; }
  get mounted(): boolean { return this.on; }

  /** after the mixer, every frame */
  update(dt: number): void {
    const step = RIDER_BLEND > 0 ? Math.max(0, dt) / RIDER_BLEND : 1;
    this.w = this.on ? Math.min(1, this.w + step) : Math.max(0, this.w - step);
    this.stats.weight = this.w;
    if (this.w <= 0 || !this.rig) { this.release(); return; }
    this.apply(this.rig, this.w);
  }

  /** hand the frame group back exactly as it was (the bones are the mixer's again next frame) */
  private release(): void {
    // the bones: hand back the mixer's pose wherever the mixer has not already rewritten it
    if (this.wrote && this.rig) {
      const { bones } = this.rig;
      for (let i = 0; i < bones.length; i++) if (bones[i].quaternion.equals(this.written[i])) bones[i].quaternion.copy(this.saved[i]);
      this.wrote = false;
    }
    if (!this.owned) return;
    this.frame.position.copy(this.restPos);
    this.frame.quaternion.copy(this.restQuat);
    this.frame.updateMatrixWorld(true);
    this.owned = false;
  }

  private apply(rig: Rig, w: number): void {
    if (!this.owned) { this.restPos.copy(this.frame.position); this.restQuat.copy(this.frame.quaternion); this.owned = true; }
    const { bones } = rig;
    while (this.saved.length < bones.length) { this.saved.push(new THREE.Quaternion()); this.posed.push(new THREE.Quaternion()); this.written.push(new THREE.Quaternion()); }
    for (let i = 0; i < bones.length; i++) {
      if (this.wrote && bones[i].quaternion.equals(this.written[i])) bones[i].quaternion.copy(this.saved[i]); // the mixer did not write it
      else this.saved[i].copy(bones[i].quaternion);
    }

    // 1. the body rides the deck: roll about the pivot, and stand where the arms reach
    const stance = rig.stance ?? 0;
    // the deck's attitude in the rider's frame (the scooter turned half a revolution): its nose-up pitch is
    // a pitch about the rider's −x, its lean a roll about the rider's +z
    _roll.setFromAxisAngle(X, -this.pitch * w).multiply(_q.setFromAxisAngle(Z, this.lean * w));
    _pivot.copy(this.geo.pivot);
    _shift.set(0, 0, stance * w);
    this.frame.quaternion.copy(this.restQuat).multiply(_roll);
    this.frame.position.copy(_pivot).sub(_v.copy(_pivot).applyQuaternion(_roll)).add(_v.copy(_shift).applyQuaternion(_roll)).applyQuaternion(this.restQuat).add(this.restPos);
    this.frame.updateMatrixWorld(true);

    // the rider's axes in world space (the frame includes the roll)
    const frameQ = this.frame.getWorldQuaternion(_hq);
    _lat.copy(X).applyQuaternion(frameQ);
    _down.copy(Y).applyQuaternion(frameQ).negate();
    _fwd.copy(Z).applyQuaternion(this.frame.parent ? this.frame.parent.getWorldQuaternion(_q) : _q.identity());

    // 2. torso forward; the neck gives it back, plus half the roll
    rotateWorld(rig.spine, about(_lat, RIDER_TORSO_LEAN));
    rotateWorld(rig.neck, about(_lat, -RIDER_TORSO_LEAN));
    rotateWorld(rig.neck, about(_fwd, -this.lean * w * HEAD_ROLL_KEEP));

    // 4. the stance, once per rig: measured on this very pose (lean applied, arms still the idle's)
    if (rig.stance === null) {
      rig.stance = this.measureStance(rig);
      this.stats.stance = rig.stance;
      // re-enter with the stance in place — this frame and every one after it
      for (let i = 0; i < bones.length; i++) bones[i].quaternion.copy(this.saved[i]);
      this.apply(rig, w);
      return;
    }

    // 3. both arms
    for (const arm of rig.arms) {
      const g = arm.side === "left" ? this.geo.left : this.geo.right;
      // the grip in the frame group's own space is the rider-frame grip less the stance shift
      _T.set(g.x, g.y, g.z - stance * w);
      this.frame.localToWorld(_T);
      this.solveArm(arm, _T, frameQ);
    }

    // 5. blend from the mixer's pose by the weight
    for (let i = 0; i < bones.length; i++) {
      this.posed[i].copy(bones[i].quaternion);
      bones[i].quaternion.slerpQuaternions(this.saved[i], this.posed[i], w);
      this.written[i].copy(bones[i].quaternion);
    }
    this.wrote = true;
  }

  /** how far along the deck this rig stands (+z = toward the bar) so each shoulder is RIDER_REACH_FRACTION of
   *  its own shoulder→palm reach from its grip — the mean of both sides, within ±RIDER_STANCE_LIMIT */
  private measureStance(rig: Rig): number {
    let sum = 0;
    for (const arm of rig.arms) {
      const g = arm.side === "left" ? this.geo.left : this.geo.right;
      arm.arm.getWorldPosition(_S); arm.fore.getWorldPosition(_E); arm.hand.getWorldPosition(_W);
      const reach = _S.distanceTo(_E) + _E.distanceTo(_W) + this.palmLength(arm);
      // lengths are world units; the frame has no scale of its own, so model-frame lengths are the same
      this.frame.worldToLocal(_S);
      const D = RIDER_REACH_FRACTION * reach, dx = g.x - _S.x, dy = g.y - _S.y;
      sum += g.z - _S.z - Math.sqrt(Math.max(0, D * D - dx * dx - dy * dy));
    }
    return Math.max(-RIDER_STANCE_LIMIT, Math.min(RIDER_STANCE_LIMIT, sum / rig.arms.length));
  }

  private palmLength(arm: Arm): number {
    arm.hand.getWorldScale(_v);
    return arm.palm.length() * _v.x;
  }

  /** shoulder → elbow → palm onto `target` (world), elbow toward the pole, hand palm-down along the forearm */
  private solveArm(arm: Arm, target: THREE.Vector3, frameQ: THREE.Quaternion): void {
    // the palm-facing direction the idle's corrected arm holds (toward the body's midline), in hand space
    _med.copy(_lat).multiplyScalar(-arm.sign);
    const nLocal = _nl.copy(_med).applyQuaternion(arm.hand.getWorldQuaternion(_q).invert());

    arm.arm.getWorldPosition(_S); arm.fore.getWorldPosition(_E); arm.hand.getWorldPosition(_W);
    const a = _S.distanceTo(_E), b = _E.distanceTo(_W) + this.palmLength(arm);
    _n.subVectors(target, _S);
    const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, _n.length()));
    _n.normalize();
    // elbow plane: the pole, less its component along the shoulder→target line
    _pole.set(POLE.x * arm.sign, POLE.y, POLE.z).applyQuaternion(frameQ);
    _pole.addScaledVector(_n, -_pole.dot(_n));
    if (_pole.lengthSq() < 1e-8) _pole.copy(_down);
    _pole.normalize();
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    // upper arm: swing the elbow onto its solved position
    _P.copy(_S).addScaledVector(_n, a * cosA).addScaledVector(_pole, a * sinA);
    rotateWorld(arm.arm, fromTo(_a.subVectors(_E, _S).normalize(), _b.subVectors(_P, _S).normalize()));
    // forearm: point the wrist (and so the palm, which continues it) at the target
    arm.fore.getWorldPosition(_E); arm.hand.getWorldPosition(_W);
    const dir = _dir.subVectors(target, _E).normalize();
    rotateWorld(arm.fore, fromTo(_a.subVectors(_W, _E).normalize(), dir));
    // hand: continue the forearm (a straight wrist puts the palm on the grip)
    arm.hand.getWorldPosition(_W);
    _a.copy(arm.palm).normalize().applyQuaternion(arm.hand.getWorldQuaternion(_q));
    rotateWorld(arm.hand, fromTo(_a, dir));
    // palm down: turn about the forearm axis until the palm faces the deck — half in the forearm, half in the hand
    const nNow = _a.copy(nLocal).applyQuaternion(arm.hand.getWorldQuaternion(_q));
    nNow.addScaledVector(dir, -nNow.dot(dir));
    _v.copy(_down).addScaledVector(dir, -_down.dot(dir));
    if (nNow.lengthSq() > 1e-8 && _v.lengthSq() > 1e-8) {
      nNow.normalize(); _v.normalize();
      const phi = Math.atan2(_P.crossVectors(nNow, _v).dot(dir), nNow.dot(_v));
      rotateWorld(arm.fore, about(dir, phi / 2));
      rotateWorld(arm.hand, about(dir, phi / 2));
    }
    // what the solve achieved: the palm's world position against the target
    arm.hand.localToWorld(_P.copy(arm.palm));
    this.stats.error[arm.side] = _P.distanceTo(target);
  }
}
