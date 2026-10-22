import * as THREE from "three";
import { about, findRig, rotateWorld, type Rig } from "./gaitPose";

// vo3d avatar — PARKOUR V1, ON THE SKELETON: the double jump's front flip, the landing roll and the landing
// absorb, as ARTICULATED motion — the body changes shape (push, tuck, untuck, absorb; crouch, chin in, shoulder
// roll, recover) while the whole of it turns.
//
// THE SAME ARCHITECTURE AS avatar/gaitPose, riderPose and crashPose: a post-animation layer that finds the
// standard chain BY NAME on whatever rig the body has (Hips → spine → neck, arms, forearms, thighs, shins,
// feet — HumanBase and the legacy characters share these names), and poses it as WORLD-space rotations about
// the body's own axes, carried into each bone's parent space. Nothing is baked, no clip is added and no model
// file is touched; every bone is restored to the clip's pose when the layer lets go, so the next clip takes
// over exactly where it always would.
//
// THE ROOT MOTION lives here too, on a wrapper group between the avatar root and its model (identity whenever
// nothing plays). The two moves are DIFFERENT MOVEMENTS, not one rotation reused:
//   FLIP  airborne, symmetric: push, tuck, one forward pitch about the tucked body's centre, untuck.
//   ROLL  grounded, asymmetric — a parkour safety roll: absorb into a deep crouch over planted feet; bank onto the
//         LEFT shoulder with the back rounded, the head tucked and turned away from the contact side, the lead
//         arm reaching and the trail arm tucked; roll diagonally from that shoulder across the back toward the
//         opposite hip, held in contact with the floor the whole way; recover into a crouch over planted feet and
//         rise. Its forward travel is the BODY's, not this wrapper's (player/PlayerMode moves it through the
//         world and publishes it as a walk), so the wrapper only ever turns and lowers it.
// The camera follows the avatar's position and heading, never this wrapper.
//
// JOINT LIMITS. Every target is inside a comfortable human range: hips flex at most ~115°, knees ~125°, the
// spine curls ~45° spread over all its joints, the chin tucks ~20°, shoulders lift ~80°, elbows bend ~100°.
//
// Shared by the local avatar (avatar/Avatar) and every replicated body (world/Coworkers): a flip and the
// people watching it play the same curves. Future traversal (vault, climb, zipline) adds poses and timelines
// to this vocabulary rather than a new layer.

export type ParkourMove = "flip" | "roll" | "land";

/** How long each lasts, ms. The flip fits inside a double jump's remaining air time (~0.8 s); the roll reads
 *  as a quick, controlled tumble; the absorb is a beat. */
export const PARKOUR_MS: Readonly<Record<ParkourMove, number>> = { flip: 720, roll: 820, land: 280 };
/** a roll's duration is set by its impact and speed (player/PlayerMode), within these bounds */
export const ROLL_MS_RANGE = { min: 680, max: 1000 } as const;

/** a landing from at least this far (a double jump's arc, a drop off a table) gives at the knees — never an
 *  ordinary hop's (11.7). Decided by each body from its own arc, so every viewer plays the same. */
export const LAND_ABSORB_FALL = 14;

/** One posture, as joint angles (radians, magnitudes; directions are applied per joint below). */
type Posture = {
  /** hip flexion: thighs up toward the chest */ hip: number;
  /** knee flexion */ knee: number;
  /** total spinal curl, spread over the spine */ spine: number;
  /** chin toward the chest */ chin: number;
  /** shoulders: arms raised forward */ armFwd: number;
  /** shoulders: arms drawn in across the body (negative = out, for balance) */ armIn: number;
  /** elbow bend */ elbow: number;
};
const P = (hip: number, knee: number, spine: number, chin: number, armFwd: number, armIn: number, elbow: number): Posture => ({ hip, knee, spine, chin, armFwd, armIn, elbow });
const ZERO = P(0, 0, 0, 0, 0, 0, 0);
/** THE POSTURES — every one inside the joint limits above */
const POSE = {
  /** the push-off: legs driving straight, arms swung up */
  push: P(-0.12, 0.08, -0.08, -0.05, 1.25, 0.05, 0.35),
  /** the tuck: knees to the chest, back rounded, chin in, arms wrapped round the shins */
  tuck: P(1.95, 2.15, 0.78, 0.36, 1.05, 0.32, 1.7),
  /** a low crouch: weight down, chin in, arms reaching forward */
  crouch: P(1.2, 1.8, 0.5, 0.3, 0.75, 0.08, 0.6),
  /** the absorb: knees and hips give, arms out a little for balance */
  absorb: P(1.0, 1.6, 0.32, 0.1, 0.45, -0.12, 0.45),
} as const;

const smooth = (a: number, b: number, t: number): number => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const rise = smooth;
const fall = (a: number, b: number, t: number): number => 1 - smooth(a, b, t);

/** a move's shape at phase t (0..1): posture weights, the turn (0..1 of a revolution), and whether the feet are
 *  planted (the body lowers over them rather than lifting them) */
type Frame = { push: number; tuck: number; crouch: number; absorb: number; turn: number; planted: boolean };
function frameAt(move: ParkourMove, t: number): Frame {
  if (move === "flip") {
    // 1 push off · 2 tuck · 3 rotate tucked · 4 untuck · 5 reach for the floor
    return {
      push: fall(0, 0.14, t),
      tuck: rise(0.04, 0.24, t) * fall(0.66, 0.9, t),
      crouch: 0,
      absorb: rise(0.82, 1, t) * 0.35,
      turn: smooth(0.12, 0.84, t),
      planted: false,
    };
  }
  // land: give at the knees and hips, then stand
  return { push: 0, tuck: 0, crouch: 0, absorb: rise(0, 0.3, t) * fall(0.35, 1, t), turn: 0, planted: true };
}

/** where the flip turns, as a fraction of the standing height: the tucked body's middle */
const FLIP_PIVOT = 0.46;

// ---- THE SHOULDER ROLL --------------------------------------------------------------------------------------
/** where the roll's turns are centred: low — the shoulder and back are near the floor */
const ROLL_PIVOT = 0.24;
/** the roll goes diagonally: its revolution axis is the side-to-side axis turned this far toward the front of the
 *  LEAD (left) shoulder, so contact runs from that shoulder across the back to the opposite hip */
const ROLL_DIAGONAL = Math.PI / 4;
/** how far the body pitches forward and banks onto the lead shoulder at the roll's entry, radians */
const ROLL_ENTRY_PITCH = 0.95, ROLL_ENTRY_BANK = 0.6;

/** the roll's shape at phase t: A absorb (0–0.2) · B entry (0.16–0.34) · C diagonal roll (0.3–0.76) · D recovery */
type RollFrame = {
  /** postures: the deep absorbing crouch, and the compact roll (knees in, back round) */
  crouch: number; ball: number;
  /** the asymmetric half: side bend toward the lead shoulder, head away from it, lead arm reaching */
  side: number;
  /** root: forward pitch and bank onto the lead shoulder (entry), and the diagonal revolution 0..1 */
  pitch: number; bank: number; rev: number;
  /** feet planted (A and D) — else the body is held in contact with the floor (B and C) */
  planted: boolean;
};
function rollFrame(t: number): RollFrame {
  const entry = rise(0.16, 0.34, t) * fall(0.62, 0.78, t);
  return {
    crouch: rise(0, 0.14, t) * fall(0.2, 0.34, t) + rise(0.68, 0.8, t) * fall(0.86, 1, t),
    ball: rise(0.18, 0.34, t) * fall(0.64, 0.8, t),
    side: rise(0.08, 0.3, t) * fall(0.6, 0.8, t),
    pitch: ROLL_ENTRY_PITCH * entry + 0.25 * rise(0, 0.16, t) * fall(0.16, 0.3, t),
    bank: ROLL_ENTRY_BANK * entry,
    rev: smooth(0.3, 0.76, t),
    planted: t < 0.18 || t > 0.78,
  };
}
/** the roll's two postures — inside the same joint limits */
/** how far above the floor the roll's lowest joint is held while in contact (the body's own thickness there) */
const ROLL_CONTACT = 0.6;
const ROLL_POSE = {
  crouch: P(1.5, 2.2, 0.6, 0.3, 0.55, 0.05, 0.5),
  ball: P(1.95, 2.25, 0.9, 0.42, 0.7, 0.2, 1.1),
} as const;
/** the asymmetric half at full weight: spine side bend toward the lead shoulder; the head tilted and turned away
 *  from it; the lead arm reaching forward-down and a little out, the trail arm drawn in and bent */
const ROLL_SIDE = { spineSide: 0.28, headTilt: 0.38, headTurn: 0.3, leadFwd: 0.55, leadOut: 0.25, leadElbow: -0.45, trailIn: 0.35, trailElbow: 0.6 } as const;

const _wq = new THREE.Quaternion();
const _X = new THREE.Vector3(), _Z = new THREE.Vector3(), _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0), FWD = new THREE.Vector3(0, 0, 1);
const _Y = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
/** the roll's revolution axis in the body's own frame (see ROLL_DIAGONAL) */
const ROLL_AXIS = new THREE.Vector3(Math.cos(ROLL_DIAGONAL), 0, Math.sin(ROLL_DIAGONAL)).normalize();

export class ParkourPose {
  /** the wrapper: the avatar root → this → the model */
  readonly node = new THREE.Group();
  private readonly height: number;
  private rig: Rig | null = null;
  private move: ParkourMove | null = null;
  private elapsed = 0;
  private duration = 0;
  /** the clip's own pose of each posed bone this frame, and what this layer last wrote (see gaitPose: THREE's
   *  mixer leaves a held clip's bones alone, so without this the pose would compound frame on frame) */
  private readonly saved: THREE.Quaternion[] = [];
  private readonly written: THREE.Quaternion[] = [];
  private wrote = false;

  constructor(height: number) {
    this.height = height;
    this.node.name = "tumble";
  }

  /** the body's skeleton (null while it has none, or for a body without the standard chain — the root motion
   *  still plays, the posture does not) */
  setScene(scene: THREE.Object3D | null): void {
    this.release();
    this.rig = scene ? findRig(scene) : null;
  }

  /** whether this body can be articulated at all (it has the standard chain) */
  get articulated(): boolean { return this.rig !== null; }
  get active(): ParkourMove | null { return this.move; }

  /** Start a move from its beginning (replacing whatever was playing). */
  start(move: ParkourMove, durationMs?: number): void {
    this.move = move;
    this.elapsed = 0;
    this.duration = move === "roll" && durationMs !== undefined && Number.isFinite(durationMs)
      ? Math.min(ROLL_MS_RANGE.max, Math.max(ROLL_MS_RANGE.min, durationMs))
      : PARKOUR_MS[move];
  }

  /** A flip still turning when the feet land: finish it over a short tail rather than snapping upright. */
  hurry(ms = 120): void {
    if (this.move !== "flip") return;
    const left = this.duration - this.elapsed;
    if (left > ms) {
      // keep the phase continuous: compress what is left into `ms`
      const t = this.elapsed / this.duration;
      this.duration = this.elapsed + ms;
      this.elapsed = t * this.duration;
    }
  }

  /** Stop now and give the body back exactly as its clip has it (a seat, a ride or a handoff took the body). */
  cancel(): void {
    this.move = null;
    this.release();
    this.node.position.set(0, 0, 0);
    this.node.quaternion.identity();
    this.node.updateMatrixWorld(true);
  }

  update(dt: number): void {
    if (!this.move) { if (this.wrote) this.release(); return; }
    this.elapsed += dt * 1000;
    const t = Math.min(1, this.elapsed / Math.max(1, this.duration));
    const move = this.move;
    if (t >= 1) { this.cancel(); return; }
    if (move === "roll") { this.updateRoll(t); return; }
    const f = frameAt(move, t);

    // 1. the clip's pose back (or saved), exactly as gaitPose does
    const rig = this.rig;
    if (rig) this.restoreClip(rig);

    // 2. the root motion: a turn about the move's axis through its pivot, the pivot held still
    this.node.position.set(0, 0, 0);
    this.node.quaternion.identity();
    if (f.turn > 0 && f.turn < 1) {
      this.node.quaternion.setFromAxisAngle(RIGHT, f.turn * Math.PI * 2);
      const pivot = _v.set(0, this.height * FLIP_PIVOT, 0);
      this.node.position.copy(pivot).sub(pivot.clone().applyQuaternion(this.node.quaternion));
    }
    this.node.updateMatrixWorld(true);

    // 3. the posture, blended from the named postures, on the body's own axes
    if (rig) {
      const footBefore = f.planted ? this.lowestFoot(rig) : NaN;
      const w = (k: keyof Posture): number =>
        POSE.push[k] * f.push + POSE.tuck[k] * f.tuck + POSE.crouch[k] * f.crouch + POSE.absorb[k] * f.absorb + ZERO[k];
      this.node.getWorldQuaternion(_wq);
      _X.copy(RIGHT).applyQuaternion(_wq);
      _Z.copy(FWD).applyQuaternion(_wq);
      const spine = w("spine"), n = rig.spines.length;
      // most of the curl low in the back (spines are listed neck-down; the last is the lowest)
      rig.spines.forEach((b, i) => rotateWorld(b, about(_X, spine * ((2 * (i + 1)) / (n * (n + 1))))));
      if (rig.neck) rotateWorld(rig.neck, about(_X, w("chin")));
      rig.arms.forEach((arm, i) => {
        const side = i === 0 ? 1 : -1;
        rotateWorld(arm, about(_X, -w("armFwd")));
        const inward = w("armIn");
        if (inward !== 0) rotateWorld(arm, about(_Z, -side * inward));
        rotateWorld(rig.fores[i], about(_X, -w("elbow")));
      });
      rig.thighs.forEach((thigh, i) => {
        rotateWorld(thigh, about(_X, -w("hip")));
        rotateWorld(rig.shins[i], about(_X, w("knee")));
      });
      // 4. the feet stay planted while upright: the hips come down over them
      if (f.planted) {
        const footAfter = this.lowestFoot(rig);
        if (Number.isFinite(footBefore) && Number.isFinite(footAfter)) this.node.position.y += footBefore - footAfter;
      }
      this.node.updateMatrixWorld(true);
      for (let i = 0; i < rig.bones.length; i++) this.written[i].copy(rig.bones[i].quaternion);
      this.wrote = true;
    }
  }

  /** THE SHOULDER ROLL, one frame (see rollFrame). */
  private updateRoll(t: number): void {
    const f = rollFrame(t);
    const rig = this.rig;
    if (rig) this.restoreClip(rig);
    // root: pitch forward and bank onto the lead (left, +x) shoulder, then the diagonal revolution, all about a
    // low pivot. At rev = 1 with pitch and bank back to 0 the wrapper is the identity again.
    _qa.setFromAxisAngle(RIGHT, f.pitch).premultiply(_qb.setFromAxisAngle(FWD, -f.bank));
    this.node.quaternion.setFromAxisAngle(ROLL_AXIS, f.rev * Math.PI * 2).multiply(_qa);
    const pivot = _v.set(0, this.height * ROLL_PIVOT, 0);
    this.node.position.copy(pivot).sub(pivot.clone().applyQuaternion(this.node.quaternion));
    this.node.updateMatrixWorld(true);
    if (!rig) return;
    const footBefore = f.planted ? this.lowestFoot(rig) : NaN;
    const w = (k: keyof Posture): number => ROLL_POSE.crouch[k] * f.crouch + ROLL_POSE.ball[k] * f.ball;
    this.node.getWorldQuaternion(_wq);
    _X.copy(RIGHT).applyQuaternion(_wq);
    _Z.copy(FWD).applyQuaternion(_wq);
    _Y.copy(UP).applyQuaternion(_wq);
    const s = f.side;
    const spine = w("spine"), n = rig.spines.length;
    rig.spines.forEach((b, i) => {
      const share = (2 * (i + 1)) / (n * (n + 1));
      rotateWorld(b, about(_X, spine * share));
      rotateWorld(b, about(_Z, -ROLL_SIDE.spineSide * s * share)); // the back curls round the lead shoulder
    });
    if (rig.neck) {
      rotateWorld(rig.neck, about(_X, w("chin")));
      rotateWorld(rig.neck, about(_Z, ROLL_SIDE.headTilt * s)); //  the head away from the contact side…
      rotateWorld(rig.neck, about(_Y, -ROLL_SIDE.headTurn * s)); // …and turned away from it
    }
    rig.arms.forEach((arm, i) => {
      const lead = i === 0, side = lead ? 1 : -1;
      rotateWorld(arm, about(_X, -(w("armFwd") + (lead ? ROLL_SIDE.leadFwd * s : 0))));
      const inward = w("armIn") + (lead ? -ROLL_SIDE.leadOut * s : ROLL_SIDE.trailIn * s);
      if (inward !== 0) rotateWorld(arm, about(_Z, -side * inward));
      rotateWorld(rig.fores[i], about(_X, -Math.max(0, w("elbow") + (lead ? ROLL_SIDE.leadElbow * s : ROLL_SIDE.trailElbow * s))));
    });
    rig.thighs.forEach((thigh, i) => {
      rotateWorld(thigh, about(_X, -w("hip")));
      rotateWorld(rig.shins[i], about(_X, w("knee")));
    });
    this.node.updateMatrixWorld(true);
    if (f.planted) {
      // A and D: the weight goes down over feet that stay where they landed
      const footAfter = this.lowestFoot(rig);
      if (Number.isFinite(footBefore) && Number.isFinite(footAfter)) this.node.position.y += footBefore - footAfter;
    } else {
      // B and C: IN CONTACT WITH THE FLOOR — the lowest part of the body rests on it, never in it, never above it
      const floor = this.node.parent ? this.node.parent.getWorldPosition(_v).y : 0;
      const low = this.lowestPoint(rig);
      if (Number.isFinite(low)) this.node.position.y += floor + ROLL_CONTACT - low;
    }
    this.node.updateMatrixWorld(true);
    for (let i = 0; i < rig.bones.length; i++) this.written[i].copy(rig.bones[i].quaternion);
    this.wrote = true;
  }

  /** the clip's pose back on every posed bone (see gaitPose: a held clip's bones are not rewritten by the mixer) */
  private restoreClip(rig: Rig): void {
    const bones = rig.bones;
    while (this.saved.length < bones.length) { this.saved.push(new THREE.Quaternion()); this.written.push(new THREE.Quaternion()); }
    for (let i = 0; i < bones.length; i++) {
      if (this.wrote && bones[i].quaternion.equals(this.written[i])) bones[i].quaternion.copy(this.saved[i]);
      else this.saved[i].copy(bones[i].quaternion);
    }
  }

  private lowestFoot(rig: Rig): number {
    let lo = Infinity;
    for (const f of rig.feet) { f.updateMatrixWorld(true); lo = Math.min(lo, f.getWorldPosition(_v).y); }
    return lo;
  }

  /** the lowest of the joints that can touch the floor in a roll (head, hands' bones, hips, knees, feet), with the
   *  head's own radius below its joint */
  private lowestPoint(rig: Rig): number {
    let lo = Infinity;
    const take = (b: THREE.Object3D | null | undefined, pad = 0) => { if (!b) return; b.updateMatrixWorld(true); lo = Math.min(lo, b.getWorldPosition(_v).y - pad); };
    take(rig.neck, this.height * 0.14);
    for (const b of [...rig.fores, ...rig.shins, ...rig.feet, ...rig.thighs]) take(b, this.height * 0.03);
    take(rig.spines[rig.spines.length - 1], this.height * 0.06);
    return lo;
  }

  private release(): void {
    if (!this.wrote || !this.rig) { this.wrote = false; return; }
    const { bones } = this.rig;
    for (let i = 0; i < bones.length; i++) if (bones[i].quaternion.equals(this.written[i])) bones[i].quaternion.copy(this.saved[i]);
    this.wrote = false;
  }
}
