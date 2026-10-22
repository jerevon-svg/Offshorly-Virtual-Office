// vo3d avatar — THE GAIT, SHAPED. A post-mixer layer laid over the approved walk/run/idle clips (never replacing
// them, never editing an asset) that turns a fast run into a SPRINT and a stop from one into a SKID, for the local
// body and every replicated one alike.
//
//   sprint   the torso leans forward with the speed (up to LEAN, ~18°) and the neck gives most of it back so the
//            head looks ahead; the clip's own leg and arm swing is opened up (longer, harder strides, arms
//            pumping) and the elbows bend
//   bank     the whole body leans into a turn, about its feet
//   brake    a skid from a run: torso back, the lead foot planted ahead, knees bent to absorb it, arms out for
//            balance — laid over the idle the body is easing into, so it is a pose that is braking, not a run
//            cycle being dragged along
//
// WHY "OPENED UP" AND NOT A NEW CLIP: the swing is amplified about each joint's own running average, so the
// clip's timing, contact and character stay its own — the cycle is simply taken further — and it works on any
// rig with the standard chain. The lowest foot is kept where the clip had it (a bent-knee brake never floats
// or sinks). Everything fades in and out over BLEND; at zero weight the bones and the model frame are exactly
// the mixer's, so walking, riding, crashing and sitting are untouched.
import * as THREE from "three";

export interface GaitInput {
  /** 0 … 1: how much of a sprint this is (lean, stride, arm pump) */
  sprint: number;
  /** radians, + = toward the body's left: leaning into a turn */
  bank: number;
  /** 0 … 1: braking from a run */
  brake: number;
  /** which foot is planted ahead braking: +1 the left, −1 the right */
  lead: 1 | -1;
}

export const GAIT_POSE = {
  /** forward lean at a full sprint: the whole body from the feet, plus the spine's bend (weighted to the lower
   *  back) — together ~17° of the hips-to-neck line; and how much of it the neck gives back to look ahead */
  LEAN_BODY: 0.14,
  LEAN: 0.3,
  NECK_BACK: 0.65,
  /** extra swing at a full sprint: legs, arms; and the elbows' added bend */
  STRIDE: 0.5,
  ARM_SWING: 0.45,
  ELBOW: 0.7,
  /** the brake: torso back, lead thigh forward / knee, trail thigh back / knee, arms out and forward */
  BRAKE_BACK: 0.32,
  BRAKE_LEAD: 0.55, BRAKE_LEAD_KNEE: 0.5,
  BRAKE_TRAIL: 0.25, BRAKE_TRAIL_KNEE: 0.95,
  BRAKE_ARM_OUT: 0.55, BRAKE_ARM_FWD: 0.4,
  /** seconds to fade in or out, and the running average the swing is opened up about */
  BLEND: 0.15,
  MEAN_S: 0.35,
} as const;

type Rig = {
  scene: THREE.Object3D;
  spines: THREE.Bone[]; neck: THREE.Bone | null;
  arms: THREE.Bone[]; fores: THREE.Bone[]; thighs: THREE.Bone[]; shins: THREE.Bone[]; feet: THREE.Bone[];
  bones: THREE.Bone[];
};

function findRig(scene: THREE.Object3D): Rig | null {
  const b = (n: string) => (scene.getObjectByName(n) as THREE.Bone | undefined) ?? null;
  const two = (l: string, r: string) => { const x = b(l), y = b(r); return x && y ? [x, y] : null; };
  // THE WHOLE SPINE, hips to neck, whatever its joints are called (HumanBase counts them down: Spine02 is the
  // lowest) — a lean bent only near the neck is a hunch, not a sprinter's lean from the hips
  const neckBone = b("neck");
  const spines: THREE.Bone[] = [];
  for (let o = neckBone?.parent ?? null; o && o.name !== "Hips"; o = o.parent) if ((o as THREE.Bone).isBone) spines.push(o as THREE.Bone);
  if (!spines.length) for (const n of ["Spine", "Spine01"]) { const x = b(n); if (x) spines.push(x); }
  const arms = two("LeftArm", "RightArm"), fores = two("LeftForeArm", "RightForeArm"), thighs = two("LeftUpLeg", "RightUpLeg"), shins = two("LeftLeg", "RightLeg");
  if (!spines.length || !arms || !fores || !thighs || !shins) return null;
  const feet = two("LeftFoot", "RightFoot") ?? [];
  const neck = neckBone;
  return { scene, spines, neck, arms, fores, thighs, shins, feet, bones: [...spines, ...(neck ? [neck] : []), ...arms, ...fores, ...thighs, ...shins] };
}

const _rp = new THREE.Quaternion(), _rb = new THREE.Quaternion(), _r = new THREE.Quaternion(), _fq = new THREE.Quaternion(), _d = new THREE.Quaternion();
const _X = new THREE.Vector3(), _Z = new THREE.Vector3(), _v = new THREE.Vector3(), _ax = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
function rotateWorld(bone: THREE.Object3D, r: THREE.Quaternion): void {
  const parentQ = bone.parent!.getWorldQuaternion(_rp).invert();
  bone.quaternion.copy(parentQ.multiply(r).multiply(bone.getWorldQuaternion(_rb)));
  bone.updateMatrixWorld(true);
}
const about = (axis: THREE.Vector3, angle: number) => _r.setFromAxisAngle(axis, angle);
/** take a local rotation `k` times as far from `ref` as it already is (k > 1 opens the swing up) */
function amplify(q: THREE.Quaternion, ref: THREE.Quaternion, k: number): void {
  _d.copy(ref).invert().multiply(q);
  if (_d.w < 0) { _d.x = -_d.x; _d.y = -_d.y; _d.z = -_d.z; _d.w = -_d.w; }
  const angle = 2 * Math.acos(Math.min(1, _d.w)), s = Math.sqrt(Math.max(0, 1 - _d.w * _d.w));
  if (s < 1e-6) return;
  _ax.set(_d.x / s, _d.y / s, _d.z / s);
  q.copy(ref).multiply(_d.setFromAxisAngle(_ax, angle * k));
}

export class GaitPose {
  private rig: Rig | null = null;
  private target: GaitInput | null = null;
  private readonly cur: GaitInput = { sprint: 0, bank: 0, brake: 0, lead: 1 };
  private w = 0;
  private readonly frame: THREE.Object3D;
  private readonly restPos = new THREE.Vector3();
  private readonly restQuat = new THREE.Quaternion();
  private owned = false;
  private readonly saved: THREE.Quaternion[] = [];
  private readonly written: THREE.Quaternion[] = [];
  private wrote = false;
  /** each swinging joint's running average (local), what the swing is opened up about */
  private readonly mean = new Map<THREE.Bone, THREE.Quaternion>();
  readonly stats = { weight: 0, sprint: 0, brake: 0, lean: 0, footShift: 0 };

  constructor(frame: THREE.Object3D) { this.frame = frame; }

  setScene(scene: THREE.Object3D | null): void {
    this.release();
    this.wrote = false;
    this.mean.clear();
    this.rig = scene ? findRig(scene) : null;
  }
  get rigged(): boolean { return this.rig !== null; }
  /** this frame's gait, or null (standing, riding, seated, in a crash): the layer fades itself out */
  set(g: GaitInput | null): void { this.target = g; }
  /** off AT ONCE: something else (the rider pose, a crash) is taking the model frame this very frame */
  drop(): void { this.target = null; this.w = 0; Object.assign(this.cur, { sprint: 0, bank: 0, brake: 0 }); this.release(); }

  /** after the mixer, before the rider pose (the model frame is this layer's only while nothing else holds it) */
  update(dt: number): void {
    const rig = this.rig;
    const step = Math.min(1, Math.max(0, dt) / GAIT_POSE.BLEND);
    const g = this.target;
    this.w = g ? Math.min(1, this.w + step) : Math.max(0, this.w - step);
    if (g) {
      this.cur.sprint += (g.sprint - this.cur.sprint) * step;
      this.cur.bank += (g.bank - this.cur.bank) * step;
      this.cur.brake += (g.brake - this.cur.brake) * step;
      this.cur.lead = g.lead;
    }
    this.stats.weight = this.w;
    if (!rig || this.w <= 1e-3 || (this.cur.sprint < 1e-3 && Math.abs(this.cur.bank) < 1e-3 && this.cur.brake < 1e-3)) { this.release(); return; }
    this.apply(rig, dt);
  }

  private apply(rig: Rig, dt: number): void {
    const { bones } = rig;
    while (this.saved.length < bones.length) { this.saved.push(new THREE.Quaternion()); this.written.push(new THREE.Quaternion()); }
    for (let i = 0; i < bones.length; i++) {
      if (this.wrote && bones[i].quaternion.equals(this.written[i])) bones[i].quaternion.copy(this.saved[i]);
      else this.saved[i].copy(bones[i].quaternion);
    }
    if (!this.owned) { this.restPos.copy(this.frame.position); this.restQuat.copy(this.frame.quaternion); this.owned = true; }
    const w = this.w, sp = this.cur.sprint * w, br = this.cur.brake * w, bank = this.cur.bank * w;
    // the model frame: leaning into the turn, and forward into the sprint, about the feet (its origin is on the ground)
    this.frame.position.copy(this.restPos);
    this.frame.quaternion.copy(this.restQuat).multiply(about(Z, -bank)).multiply(_d.setFromAxisAngle(X, GAIT_POSE.LEAN_BODY * sp));
    this.frame.updateMatrixWorld(true);
    const footBefore = this.lowestFoot(rig);

    // 1. the clip's own swing, opened up (local, about each joint's running average)
    const a = 1 - Math.exp(-Math.max(0, dt) / GAIT_POSE.MEAN_S);
    const open = (b: THREE.Bone, k: number) => {
      let m = this.mean.get(b);
      if (!m) { m = b.quaternion.clone(); this.mean.set(b, m); }
      m.slerp(b.quaternion, a);
      if (k > 1e-4) amplify(b.quaternion, m, 1 + k);
    };
    for (const b of rig.thighs) open(b, GAIT_POSE.STRIDE * sp);
    for (const b of rig.shins) open(b, GAIT_POSE.STRIDE * 0.6 * sp);
    for (const b of rig.arms) open(b, GAIT_POSE.ARM_SWING * sp);
    rig.scene.updateMatrixWorld(true);

    // 2. the body's own axes (the frame: yaw and bank)
    const fq = this.frame.getWorldQuaternion(_fq);
    _X.copy(X).applyQuaternion(fq); _Z.copy(Z).applyQuaternion(fq);
    // 3. the torso: forward into a sprint, back into a brake; the head keeps looking where it is going
    const lean = GAIT_POSE.LEAN * sp - GAIT_POSE.BRAKE_BACK * br;
    this.stats.lean = lean + GAIT_POSE.LEAN_BODY * sp;
    // most of the bend low in the back (the spine is listed neck-down: the last is the lowest)
    const n = rig.spines.length;
    rig.spines.forEach((sb, i) => rotateWorld(sb, about(_X, lean * ((2 * (i + 1)) / (n * (n + 1))))));
    if (rig.neck) rotateWorld(rig.neck, about(_X, -(lean + GAIT_POSE.LEAN_BODY * sp) * GAIT_POSE.NECK_BACK));
    // 4. arms: elbows bent for the pump; out and forward for balance braking
    rig.arms.forEach((arm, i) => {
      const sign = i === 0 ? 1 : -1;
      if (br > 1e-3) {
        rotateWorld(arm, about(_Z, sign * GAIT_POSE.BRAKE_ARM_OUT * br));
        rotateWorld(arm, about(_X, -GAIT_POSE.BRAKE_ARM_FWD * br));
      }
      rotateWorld(rig.fores[i], about(_X, -(GAIT_POSE.ELBOW * sp + 0.35 * br)));
    });
    // 5. legs braking: the lead foot planted ahead, the trail one behind, both knees taking the weight
    if (br > 1e-3) rig.thighs.forEach((thigh, i) => {
      const lead = (i === 0 ? 1 : -1) === this.cur.lead;
      rotateWorld(thigh, about(_X, lead ? -GAIT_POSE.BRAKE_LEAD * br : GAIT_POSE.BRAKE_TRAIL * br));
      rotateWorld(rig.shins[i], about(_X, (lead ? GAIT_POSE.BRAKE_LEAD_KNEE : GAIT_POSE.BRAKE_TRAIL_KNEE) * br));
    });
    // 6. the feet stay where the clip had them: a crouched brake comes down onto them, never floats
    const footAfter = this.lowestFoot(rig);
    const shift = Number.isFinite(footBefore) && Number.isFinite(footAfter) ? footBefore - footAfter : 0;
    this.stats.footShift = shift;
    if (shift !== 0) { this.frame.position.y = this.restPos.y + shift; this.frame.updateMatrixWorld(true); }
    for (let i = 0; i < bones.length; i++) this.written[i].copy(bones[i].quaternion);
    this.wrote = true;
    Object.assign(this.stats, { sprint: this.cur.sprint, brake: this.cur.brake });
  }

  private lowestFoot(rig: Rig): number {
    let lo = Infinity;
    for (const f of rig.feet) { f.updateMatrixWorld(true); lo = Math.min(lo, f.getWorldPosition(_v).y); }
    return lo;
  }

  private release(): void {
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
}
