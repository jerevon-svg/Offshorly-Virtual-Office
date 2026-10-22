// vo3d avatar — S6: THE CRASH, ON THE SKELETON. A post-animation layer (like avatar/riderPose) that plays one
// frame of world/accidentMotion's crash on whatever rig the body has: the whole body turned about its HIPS (not
// tipped about its feet like a plank), then the spine, neck, arms and legs posed on the body's own axes, every
// rotation a WORLD-space delta carried into the bone's parent space — so it suits any rig with the standard
// chain (the same reason riderPose solves instead of playing a clip).
//
// Then the two things that make it look like it touches the world:
//   GROUND   the body's lowest point is measured on its actual (skinned) vertices and the whole body moved so it
//            rests ON the ground — never sunk into it, never floating over it (in the air it is only kept out
//            of it)
//   FEET     while getting up, the feet stay where they were planted: the hips move over them, not the
//            other way round
// It starts from the riding pose (captured, blended away over BLEND_IN — the rider pose is handed back at once,
// so the two layers never fight over a bone) and gives the body back to its own clip as the frame's weight
// falls to zero. Idle and locomotion are frozen by the owner (avatar/Avatar, world/Coworkers) meanwhile.
import * as THREE from "three";
import { LIMB } from "../world/accidentMotion";

/** one frame of a crash, in the world (world/accidentMotion RiderCrashFrame, placed on the ground there) */
export interface CrashBodyFrame {
  /** where the hips joint goes (world, absolute y) and how the body is turned (world) */
  hip: THREE.Vector3Like;
  q: THREE.Quaternion;
  /** the ground's world height under the body */
  ground: number;
  contact: number; anchor: number; weight: number;
  limbs: readonly number[];
  /** S7 — 0 … 1: the soles kept as flat as the clip had them (a squat bends the ankles; a tumble does not) */
  footLevel?: number;
}

/** seconds to blend from the riding pose into the crash */
export const CRASH_BLEND_IN = 0.12;
/** how long the rig's own hips offset (stance on the deck, its own hip height) takes to give way to the plan's */
const OFFSET_DECAY = 0.3;
/** most vertices sampled per mesh, and meshes, for the ground contact */
const SAMPLES_PER_MESH = 220;
const MAX_MESHES = 8;

type Sample = { mesh: THREE.Mesh; skinned: boolean; idx: number[] };
type Rig = {
  scene: THREE.Object3D;
  hips: THREE.Bone; spines: THREE.Bone[]; neck: THREE.Bone | null;
  arms: [THREE.Bone, THREE.Bone | null][]; legs: [THREE.Bone, THREE.Bone | null][]; feet: THREE.Bone[];
  bones: THREE.Bone[];
  samples: Sample[];
};

function findRig(scene: THREE.Object3D): Rig | null {
  const bone = (n: string) => (scene.getObjectByName(n) as THREE.Bone | undefined) ?? null;
  const hips = bone("Hips");
  if (!hips || !hips.parent) return null;
  const spines = ["Spine", "Spine01"].map(bone).filter((b): b is THREE.Bone => b !== null);
  const neck = bone("neck");
  const pair = (a: string, b: string): [THREE.Bone, THREE.Bone | null] | null => { const x = bone(a); return x ? [x, bone(b)] : null; };
  const arms = [pair("LeftArm", "LeftForeArm"), pair("RightArm", "RightForeArm")];
  const legs = [pair("LeftUpLeg", "LeftLeg"), pair("RightUpLeg", "RightLeg")];
  if (arms.some((a) => !a) || legs.some((l) => !l)) return null;
  const feet = ["LeftFoot", "RightFoot"].map(bone).filter((b): b is THREE.Bone => b !== null);
  const bones = [hips, ...spines, ...(neck ? [neck] : []), ...arms.flatMap((a) => a!.filter((b): b is THREE.Bone => b !== null)), ...legs.flatMap((l) => l!.filter((b): b is THREE.Bone => b !== null)), ...feet];
  // the meshes the body is drawn with, most detailed first, a spread of their vertices from each
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry?.getAttribute("position")) meshes.push(m); });
  meshes.sort((x, y) => y.geometry.getAttribute("position").count - x.geometry.getAttribute("position").count);
  const samples = meshes.slice(0, MAX_MESHES).map((mesh) => {
    const n = mesh.geometry.getAttribute("position").count, stride = Math.max(1, Math.floor(n / SAMPLES_PER_MESH));
    const idx: number[] = [];
    for (let i = 0; i < n; i += stride) idx.push(i);
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true && !!mesh.geometry.getAttribute("skinIndex");
    return { mesh, skinned, idx };
  });
  return { scene, hips, spines, neck, arms: arms as Rig["arms"], legs: legs as Rig["legs"], feet, bones, samples };
}

// scratch — nothing is allocated per frame
const _rp = new THREE.Quaternion(), _rb = new THREE.Quaternion(), _r = new THREE.Quaternion(), _d = new THREE.Quaternion(), _fw = new THREE.Quaternion();
const _chest = new THREE.Quaternion(), _limb = new THREE.Quaternion(), _lq = new THREE.Quaternion();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _ax = new THREE.Vector3(), _v = new THREE.Vector3(), _t = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** rotate a bone by a WORLD-space rotation, expressed in its parent's frame; refreshes its subtree */
function rotateWorld(bone: THREE.Object3D, r: THREE.Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(_rp).invert();
  const boneQ = bone.getWorldQuaternion(_rb);
  bone.quaternion.copy(parentQ.multiply(r).multiply(boneQ));
  bone.updateMatrixWorld(true);
}
const about = (axis: THREE.Vector3, angle: number): THREE.Quaternion => _r.setFromAxisAngle(axis, angle);
function setWorldPosition(bone: THREE.Object3D, p: THREE.Vector3): void {
  bone.position.copy(bone.parent!.worldToLocal(_v.copy(p)));
  bone.updateMatrixWorld(true);
}

export type CrashPoseStats = { active: boolean; weight: number; lowest: number; shift: number; feetDrift: number };

export class CrashPose {
  private rig: Rig | null = null;
  private frameIn: CrashBodyFrame | null = null;
  private active = false;
  private elapsed = 0;
  /** the riding pose it starts from, and the model frame's transform then and at rest */
  private readonly from: THREE.Quaternion[] = [];
  private readonly fromHip = new THREE.Vector3();
  private readonly frameFromPos = new THREE.Vector3();
  private readonly frameFromQuat = new THREE.Quaternion();
  private readonly frameRestPos = new THREE.Vector3();
  private readonly frameRestQuat = new THREE.Quaternion();
  /** the rig's own hips against the plan's at the start (decays over OFFSET_DECAY) */
  private readonly offset0 = new THREE.Vector3();
  /** the mixer's pose of each bone, what this layer last wrote (a frozen clip never rewrites a bone), and the pose */
  private readonly saved: THREE.Quaternion[] = [];
  private readonly written: THREE.Quaternion[] = [];
  private readonly posed: THREE.Quaternion[] = [];
  private readonly savedHip = new THREE.Vector3();
  private readonly writtenHip = new THREE.Vector3();
  private wrote = false;
  private anchorAt: THREE.Vector2 | null = null;
  private readonly footQ: THREE.Quaternion[] = [];
  readonly stats: CrashPoseStats = { active: false, weight: 0, lowest: 0, shift: 0, feetDrift: 0 };

  private readonly frame: THREE.Object3D;
  private readonly handOver: () => void;
  /** `frame` is the body's model group (the rider pose's too); `handOver` takes the rider pose off at once */
  constructor(frame: THREE.Object3D, handOver: () => void = () => {}) {
    this.frame = frame;
    this.handOver = handOver;
  }

  setScene(scene: THREE.Object3D | null): void {
    this.release();
    this.wrote = false;
    this.rig = scene ? findRig(scene) : null;
  }
  /** can this body be posed (it has the standard chain)? When not, the owner tips the whole body instead */
  get rigged(): boolean { return this.rig !== null; }
  /** this frame of the crash, or null: the body is its own again */
  set(f: CrashBodyFrame | null): void { this.frameIn = f; }

  /** after the mixer (and the rider pose), every frame */
  update(dt: number): void {
    const f = this.frameIn, rig = this.rig;
    if (!f || !rig) { this.release(); return; }
    const { bones } = rig;
    while (this.saved.length < bones.length) { this.saved.push(new THREE.Quaternion()); this.written.push(new THREE.Quaternion()); this.posed.push(new THREE.Quaternion()); this.from.push(new THREE.Quaternion()); }
    if (!this.active) this.begin(rig, f);
    this.elapsed += Math.max(0, dt);
    // the clip's own pose underneath (a bone still holding what we wrote was not rewritten by the mixer)
    for (let i = 0; i < bones.length; i++) {
      if (this.wrote && bones[i].quaternion.equals(this.written[i])) bones[i].quaternion.copy(this.saved[i]);
      else this.saved[i].copy(bones[i].quaternion);
    }
    if (this.wrote && rig.hips.position.equals(this.writtenHip)) rig.hips.position.copy(this.savedHip);
    else this.savedHip.copy(rig.hips.position);
    const bIn = Math.min(1, this.elapsed / CRASH_BLEND_IN), w = Math.max(0, Math.min(1, f.weight));
    // the model frame comes back from the rider's lean as the crash takes over
    this.frame.position.lerpVectors(this.frameFromPos, this.frameRestPos, bIn);
    this.frame.quaternion.slerpQuaternions(this.frameFromQuat, this.frameRestQuat, bIn);
    this.frame.updateMatrixWorld(true);

    this.pose(rig, f);
    // blend: from the clip by the frame's weight, and from the riding pose over the first moment
    for (let i = 0; i < bones.length; i++) {
      this.posed[i].copy(bones[i].quaternion);
      bones[i].quaternion.slerpQuaternions(this.saved[i], this.posed[i], w);
      if (bIn < 1) bones[i].quaternion.slerpQuaternions(this.from[i], bones[i].quaternion, bIn);
    }
    const posedHip = _t.copy(rig.hips.position);
    rig.hips.position.lerpVectors(this.savedHip, posedHip, w);
    if (bIn < 1) rig.hips.position.lerpVectors(this.fromHip, rig.hips.position, bIn);
    rig.scene.updateMatrixWorld(true);

    // ON THE GROUND: the lowest vertex onto it (in the air: only never under it)
    const lowest = this.lowest(rig);
    const need = f.ground - lowest;
    const c = Math.max(0, Math.min(1, f.contact));
    // (not scaled by the weight: as the crash lets go the blended pose nears the clip's own, standing on its feet)
    const shift = c * need + (1 - c) * Math.max(0, need);
    // FEET PLANTED while getting up
    let fx = 0, fz = 0;
    if (f.anchor > 1e-3 && rig.feet.length) {
      const mid = this.feetMid(rig);
      if (!this.anchorAt) this.anchorAt = new THREE.Vector2(mid.x, mid.z);
      const a = Math.min(1, f.anchor) * w;
      fx = (this.anchorAt.x - mid.x) * a; fz = (this.anchorAt.y - mid.z) * a;
      this.stats.feetDrift = Math.hypot(this.anchorAt.x - mid.x - fx, this.anchorAt.y - mid.z - fz);
    } else this.anchorAt = null;
    if (shift !== 0 || fx !== 0 || fz !== 0) {
      rig.hips.getWorldPosition(_v).add(_t.set(fx, shift, fz));
      setWorldPosition(rig.hips, _v);
    }
    for (let i = 0; i < bones.length; i++) this.written[i].copy(bones[i].quaternion);
    this.writtenHip.copy(rig.hips.position);
    this.wrote = true;
    Object.assign(this.stats, { active: true, weight: w, lowest: lowest + shift, shift });
  }

  private begin(rig: Rig, f: CrashBodyFrame): void {
    // the riding pose, as it is this frame, then the rider pose off (it gives back its bones and the frame)
    rig.bones.forEach((b, i) => this.from[i].copy(b.quaternion));
    this.fromHip.copy(rig.hips.position);
    this.frameFromPos.copy(this.frame.position); this.frameFromQuat.copy(this.frame.quaternion);
    rig.hips.getWorldPosition(this.offset0);
    this.handOver();
    this.frameRestPos.copy(this.frame.position); this.frameRestQuat.copy(this.frame.quaternion);
    this.offset0.sub(_t.copy(f.hip as THREE.Vector3));
    this.wrote = false;
    this.elapsed = 0;
    this.anchorAt = null;
    this.active = true;
  }

  /** the crash pose on the clip's: the body turned about the hips, then each joint on the body's own axes */
  private pose(rig: Rig, f: CrashBodyFrame): void {
    const L = f.limbs;
    // the soles as the clip holds them (the body upright, as it is before the crash turns it)
    const level = Math.max(0, Math.min(1, f.footLevel ?? 0));
    if (level > 0) { rig.scene.updateMatrixWorld(true); rig.feet.forEach((b, i) => { (this.footQ[i] ??= new THREE.Quaternion()).copy(b.getWorldQuaternion(_rb)); }); }
    // 1. the whole body: the hips take the frame's orientation (relative to the upright body) and place
    const bodyQ = this.frame.getWorldQuaternion(_fw);
    _d.copy(f.q).multiply(bodyQ.invert());
    rotateWorld(rig.hips, _d);
    const decay = Math.max(0, 1 - this.elapsed / OFFSET_DECAY);
    setWorldPosition(rig.hips, _t.copy(f.hip as THREE.Vector3).addScaledVector(this.offset0, decay));
    _X.copy(X).applyQuaternion(f.q); _Y.copy(Y).applyQuaternion(f.q); _Z.copy(Z).applyQuaternion(f.q);
    // 2. the spine curls (split over its joints) and bends to the side; the chest's axes follow
    _chest.identity();
    const n = Math.max(1, rig.spines.length);
    for (const s of rig.spines) {
      const d = _limb.setFromAxisAngle(_ax.copy(_X).applyQuaternion(_chest), L[LIMB.SPINE] / n);
      d.multiply(_d.setFromAxisAngle(_ax.copy(_Z).applyQuaternion(_chest), -L[LIMB.SPINE_SIDE] / n));
      rotateWorld(s, d);
      _chest.premultiply(d);
    }
    if (rig.neck) {
      const d = _limb.setFromAxisAngle(_ax.copy(_X).applyQuaternion(_chest), L[LIMB.NECK]);
      d.multiply(_d.setFromAxisAngle(_ax.copy(_Z).applyQuaternion(_chest), -L[LIMB.NECK_SIDE]));
      rotateWorld(rig.neck, d);
    }
    // 3. arms (from the chest) and legs (from the hips): out to the side, forward, then the elbow / knee
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? 1 : -1;
      const o = i === 0 ? LIMB.ARM_L : LIMB.ARM_R;
      this.limb(rig.arms[i], _chest, sign, L[o], L[o + 1], -L[o + 2]);
      const g = i === 0 ? LIMB.LEG_L : LIMB.LEG_R;
      this.limb(rig.legs[i], _limb.identity(), sign, L[g], L[g + 1], L[g + 2]);
    }
    // 4. the ankles bend so the soles stay flat on the ground (a squat, not tiptoes)
    if (level > 0) rig.feet.forEach((b, i) => {
      const now = b.getWorldQuaternion(_rb).clone().slerp(this.footQ[i], level);
      b.quaternion.copy(b.parent!.getWorldQuaternion(_rp).invert().multiply(now));
      b.updateMatrixWorld(true);
    });
  }

  /** a two-joint limb on the axes `base` turns the body's: raise out by `abd`, forward by `flex`, bend the second
   *  joint by `bend` about the first one's own (turned) side axis */
  private limb([upper, lower]: [THREE.Bone, THREE.Bone | null], base: THREE.Quaternion, sign: number, flex: number, abd: number, bend: number): void {
    const q = _lq.copy(base);
    const out = _r.setFromAxisAngle(_ax.copy(_Z).applyQuaternion(q), sign * abd);
    rotateWorld(upper, out);
    q.premultiply(out);
    const fwd = _r.setFromAxisAngle(_ax.copy(_X).applyQuaternion(q), -flex);
    rotateWorld(upper, fwd);
    q.premultiply(fwd);
    if (lower) rotateWorld(lower, about(_ax.copy(_X).applyQuaternion(q), bend));
  }

  /** the lowest point of the drawn body (world y), on a spread of its real vertices */
  private lowest(rig: Rig): number {
    let lo = Infinity;
    for (const s of rig.samples) {
      if (!s.mesh.visible) continue;
      const pos = s.mesh.geometry.getAttribute("position");
      for (const i of s.idx) {
        _v.fromBufferAttribute(pos, i);
        if (s.skinned) (s.mesh as THREE.SkinnedMesh).applyBoneTransform(i, _v);
        _v.applyMatrix4(s.mesh.matrixWorld);
        if (_v.y < lo) lo = _v.y;
      }
    }
    if (lo === Infinity) lo = Math.min(...rig.feet.map((b) => b.getWorldPosition(_v).y));
    return lo;
  }
  private feetMid(rig: Rig): THREE.Vector3 {
    const m = new THREE.Vector3();
    for (const b of rig.feet) m.add(b.getWorldPosition(_v));
    return m.divideScalar(rig.feet.length);
  }

  /** the body is its own again: the clip's pose wherever the clip has not already rewritten a bone */
  private release(): void {
    if (!this.active) return;
    const rig = this.rig;
    if (this.wrote && rig) {
      rig.bones.forEach((b, i) => { if (b.quaternion.equals(this.written[i])) b.quaternion.copy(this.saved[i]); });
      if (rig.hips.position.equals(this.writtenHip)) rig.hips.position.copy(this.savedHip);
      rig.scene.updateMatrixWorld(true);
    }
    this.frame.position.copy(this.frameRestPos);
    this.frame.quaternion.copy(this.frameRestQuat);
    this.frame.updateMatrixWorld(true);
    this.wrote = false;
    this.active = false;
    this.anchorAt = null;
    this.stats.active = false;
  }
}
