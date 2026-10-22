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
//
// PARKOUR V2 adds two KEYFRAMED moves, each limb on its own curve (the lead and trail sides differ):
//   VAULT   takeoff with the hands reaching for the top · the lead hand planted, weight over it, hips and knees
//           drawn up and the body banked so the legs pass beside it · the legs reach down · a controlled landing.
//   MANTLE  reach up and grip · pull (elbows bend, legs hang) · press down over the edge, the torso forward and the
//           lead knee brought up onto the top · stand up over the feet.
// Their HEIGHT and travel are the body's (player/traversal moves it); the wrapper only banks and pitches it.

// PARKOUR V3 adds the LONG moves, driven by elapsed time rather than a fixed timeline: the LADDER (hand over hand —
// one hand reaches for the next rung as the opposite knee lifts, then the other pair, the torso upright and close to
// the rungs) and the ZIPLINE (both hands overhead on the handle, the arms carrying the hang, the knees drawn a little,
// the legs swinging with the ride, a lean back as it pulls away and forward as it brakes, then the release). And the
// HARD landing: a fall too big for a roll, taken in a deep crouch with the lead hand to the floor, then up.

export type ParkourMove = "flip" | "roll" | "land" | "vault" | "mantle" | "ladder" | "zipline" | "hard";

/** How long each lasts, ms. The flip fits inside a double jump's remaining air time (~0.8 s); the roll reads
 *  as a quick, controlled tumble; the absorb is a beat. */
export const PARKOUR_MS: Readonly<Record<ParkourMove, number>> = { flip: 720, roll: 820, land: 280, vault: 650, mantle: 850, ladder: 2000, zipline: 4000, hard: 900 };
/** PARKOUR V3 — a fall from at least this high is a HARD landing (never a roll); below it, the V1 absorb or roll */
export const HARD_FALL = 64;
/** PARKOUR V3 — a route's duration is the route's own (world/traversalRoutes), within these bounds */
export const ROUTE_MS_RANGE = { min: 400, max: 20000 } as const;
/** a roll's duration is set by its impact and speed (player/PlayerMode), within these bounds */
export const ROLL_MS_RANGE = { min: 680, max: 1000 } as const;
/** a vault's or a mantle's duration is its plan's (player/traversal), within these bounds */
export const TRAVERSE_MS_RANGE = { min: 450, max: 1200 } as const;

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

// ---- PARKOUR V2: THE VAULT AND THE MANTLE, keyframed limb by limb ---------------------------------------------
/** one key: every joint angle (radians; directions as for Posture), L = the LEAD side (bone index 0), T = the trail,
 *  plus the root's bank onto the lead side and its forward pitch. Every value inside the joint limits above, except
 *  the mantle's overhead reach, which lifts the shoulders to ~115° — still a comfortable human reach. */
type Limbs = {
  hipL: number; hipT: number; kneeL: number; kneeT: number;
  spine: number; side: number; chin: number;
  armL: number; armT: number; inL: number; inT: number; elbowL: number; elbowT: number;
  bank: number; pitch: number;
};
const L0: Limbs = { hipL: 0, hipT: 0, kneeL: 0, kneeT: 0, spine: 0, side: 0, chin: 0, armL: 0, armT: 0, inL: 0, inT: 0, elbowL: 0, elbowT: 0, bank: 0, pitch: 0 };
const K = (t: number, v: Partial<Limbs>): { t: number; v: Limbs } => ({ t, v: { ...L0, ...v } });
const TRAVERSE_KEYS: Readonly<Record<"vault" | "mantle" | "hard", readonly { t: number; v: Limbs }[]>> = {
  hard: [
    K(0, {}),
    // impact: down into a deep crouch over the feet, the lead hand to the floor, the trail arm back for balance
    K(0.22, { hipL: 1.85, hipT: 1.85, kneeL: 2.2, kneeT: 2.2, spine: 0.62, chin: 0.22, armL: 1.35, armT: -0.35, inT: -0.3, elbowL: 0.25, elbowT: 0.5, pitch: 0.12 }),
    K(0.58, { hipL: 1.75, hipT: 1.75, kneeL: 2.1, kneeT: 2.1, spine: 0.55, chin: 0.15, armL: 1.25, armT: -0.25, inT: -0.25, elbowL: 0.3, elbowT: 0.45, pitch: 0.1 }),
    // up over the feet
    K(1, {}),
  ],
  vault: [
    K(0, {}),
    // takeoff: a dip at the knees, the torso over them, both hands reaching forward-down for the top
    K(0.16, { hipL: 0.55, hipT: 0.55, kneeL: 0.8, kneeT: 0.8, spine: 0.3, chin: 0.1, armL: 0.95, armT: 0.85, elbowL: 0.25, elbowT: 0.3, pitch: 0.18 }),
    // the lead hand planted, the arm straight under the weight; hips and knees drawn up, the body banked so the
    // legs pass beside the hand; the trail arm out for balance
    K(0.4, { hipL: 1.55, hipT: 1.35, kneeL: 1.5, kneeT: 1.7, spine: 0.38, side: 0.22, chin: 0.15, armL: 0.6, armT: 0.75, inL: 0.05, inT: -0.5, elbowL: 0.1, elbowT: 0.6, bank: 0.42, pitch: 0.22 }),
    // over: the legs reach down for the floor, the hand comes off
    K(0.66, { hipL: 0.55, hipT: 0.4, kneeL: 0.35, kneeT: 0.3, spine: 0.15, side: 0.08, armL: 0.55, armT: 0.5, inT: -0.3, elbowL: 0.35, elbowT: 0.4, bank: 0.12, pitch: 0.08 }),
    // the landing gives at the knees and hips, arms forward for balance
    K(0.84, { hipL: 0.95, hipT: 0.95, kneeL: 1.45, kneeT: 1.45, spine: 0.28, chin: 0.08, armL: 0.45, armT: 0.45, inL: -0.12, inT: -0.12, elbowL: 0.45, elbowT: 0.45 }),
    K(1, {}),
  ],
  mantle: [
    K(0, {}),
    // reach up and grip the edge
    K(0.16, { hipL: 0.25, hipT: 0.25, kneeL: 0.45, kneeT: 0.45, spine: -0.05, chin: -0.15, armL: 2.0, armT: 2.0, elbowL: 0.25, elbowT: 0.25 }),
    // pull: the elbows bend and the hands come down toward the chest, the legs hang bent
    K(0.42, { hipL: 0.45, hipT: 0.3, kneeL: 0.75, kneeT: 0.6, spine: 0.22, chin: 0.1, armL: 1.15, armT: 1.15, elbowL: 1.7, elbowT: 1.7, pitch: 0.12 }),
    // press over the edge: arms straight down at the sides, torso well forward, the lead knee up onto the top
    K(0.62, { hipL: 1.7, hipT: 0.35, kneeL: 2.0, kneeT: 0.7, spine: 0.6, chin: 0.18, armL: -0.25, armT: -0.25, elbowL: 0.2, elbowT: 0.2, pitch: 0.32 }),
    // the trail foot follows; up over the lead foot
    K(0.82, { hipL: 0.85, hipT: 0.8, kneeL: 1.1, kneeT: 1.2, spine: 0.3, chin: 0.08, armL: 0.35, armT: 0.35, elbowL: 0.4, elbowT: 0.4, pitch: 0.1 }),
    K(1, {}),
  ],
};
/** the feet are planted (the body lowers over them) during these spans */
const TRAVERSE_PLANTED: Readonly<Record<"vault" | "mantle" | "hard", (t: number) => boolean>> = {
  hard: () => true,
  vault: (t) => t < 0.14 || t > 0.8,
  mantle: (t) => t > 0.84,
};
/** where the traversal's bank and pitch turn: about the hips — or, for a body hanging from a zipline, its hands */
const TRAVERSE_PIVOT = 0.5;
/** PARKOUR V3 — THE LADDER at `ms` into the climb (of `total`): hand over hand, the opposite knee with each hand */
const CLIMB_CYCLE_MS = 560;
function ladderLimbs(ms: number, total: number): Limbs {
  const w = Math.min(1, ms / 220, Math.max(0, (total - ms) / 260)); // eased in on the first rung, out on the last
  const c = Math.sin((2 * Math.PI * ms) / CLIMB_CYCLE_MS);
  const k = (v: number) => v * w;
  return {
    ...L0,
    armL: k(2.3 + 0.45 * c), armT: k(2.3 - 0.45 * c), elbowL: k(0.75 - 0.45 * c), elbowT: k(0.75 + 0.45 * c), inL: k(0.12), inT: k(0.12),
    hipT: k(0.85 + 0.5 * c), kneeT: k(1.1 + 0.6 * c), hipL: k(0.85 - 0.5 * c), kneeL: k(1.1 - 0.6 * c),
    spine: k(0.12), chin: k(-0.12), pitch: k(0.06),
  };
}
// ---- the two-bone ARM solve (the zipline grip) -----------------------------------------------------------------
/** how a rig holds a zipline handle (see ParkourPose.gripProfile) */
export type GripProfile = { halfSpan: number; handY: number };
const DEFAULT_GRIP: GripProfile = { halfSpan: 10.5, handY: 20 };
/** the arms' rise from level when holding the grips: low enough that a chibi's hands are clear of its head's sides */
const GRIP_ELEVATION = (30 * Math.PI) / 180;
/** the elbows are kept this far off straight (a fraction of the arm), so the sway about the hands stays in reach */
const GRIP_SLACK = 0.9;
const _im = new THREE.Matrix4();
const _t = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Vector3(), _w = new THREE.Vector3();
const _n = new THREE.Vector3(), _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _qq = new THREE.Quaternion();
const wpos = (o: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 => { o.updateMatrixWorld(true); return o.getWorldPosition(out); };
/** the wrist: the forearm's hand bone, or the forearm carried on by its own length when a rig has none */
function handOf(rig: Rig, i: number, out = new THREE.Vector3()): THREE.Vector3 {
  const fore = rig.fores[i];
  const hand = fore.children.find((c) => /hand/i.test(c.name));
  if (hand) return wpos(hand, out);
  const e = wpos(fore, out), s = wpos(rig.arms[i], _a1);
  return e.add(_a2.copy(e).sub(s));
}
/** THE PALM — where a hand closes on a grip: past the wrist along the forearm (the wrist bone is where the hand starts;
 *  the fist that is seen holding something is beyond it) */
const PALM = 0.55;
const _pe = new THREE.Vector3(), _pd = new THREE.Vector3();
function palmOf(rig: Rig, i: number, out = new THREE.Vector3()): THREE.Vector3 {
  const w = handOf(rig, i, out), e = wpos(rig.fores[i], _pe);
  return w.addScaledVector(_pd.copy(w).sub(e), PALM);
}
function armLen(rig: Rig, i: number): number {
  const s = wpos(rig.arms[i], _a1), e = wpos(rig.fores[i], _a2);
  return s.distanceTo(e) + (1 + PALM) * e.distanceTo(handOf(rig, i, _w));
}
/** put arm `i`'s wrist at `target` (blended by `w` from where the posture had it): open or close the elbow to the
 *  right distance, then swing the upper arm to point the chain at the target */
function solveArm(rig: Rig, i: number, target: THREE.Vector3, w: number): void {
  const arm = rig.arms[i], fore = rig.fores[i];
  // the chain ends at the PALM (the forearm carried on by the hand), so it is the palm that lands on the target
  const S = wpos(arm, _s), E = wpos(fore, _e), W = palmOf(rig, i, _w);
  const T = new THREE.Vector3().copy(W).lerp(target, w);
  const a = S.distanceTo(E), b = E.distanceTo(W);
  const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, S.distanceTo(T)));
  // the elbow: from its current opening to the one that spans `d`
  const cur = _a1.copy(S).sub(E).angleTo(_a2.copy(W).sub(E));
  const want = Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - d * d) / (2 * a * b))));
  _n.copy(_a1).cross(_a2);
  if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0); else _n.normalize();
  rotateWorld(fore, about(_n, cur - want));
  if (Math.abs(wpos(arm, _s).distanceTo(palmOf(rig, i, _w)) - d) > 0.05) rotateWorld(fore, about(_n, 2 * (want - cur)));
  // the shoulder: the whole chain onto the target
  const Sx = wpos(arm, _s), Wx = palmOf(rig, i, _w);
  _qq.setFromUnitVectors(_a1.copy(Wx).sub(Sx).normalize(), _a2.copy(T).sub(Sx).normalize());
  rotateWorld(arm, _qq);
}

/** PARKOUR V3 — THE ZIPLINE at `ms` into the ride (of `total`) */
function ziplineLimbs(ms: number, total: number): Limbs {
  const u = ms / Math.max(1, total);
  const grip = Math.min(1, ms / 260), release = smooth(0.9, 1, u);
  const hang = grip * (1 - release);
  const sway = Math.sin((2 * Math.PI * ms) / 900) * (1 - release);
  const lean = -0.1 * fall(0, 0.25, u) + 0.12 * rise(0.72, 0.88, u) * (1 - release);
  return {
    ...L0,
    armL: 2.7 * hang + 0.5 * release, armT: 2.7 * hang + 0.5 * release, elbowL: 0.35 * hang + 0.4 * release, elbowT: 0.35 * hang + 0.4 * release,
    inL: 0.16 * hang, inT: 0.16 * hang,
    hipL: 0.55 * hang + 0.22 * sway + 0.9 * release, hipT: 0.55 * hang + 0.22 * sway + 0.9 * release,
    kneeL: 0.8 * hang + 1.3 * release, kneeT: 0.8 * hang + 1.3 * release,
    spine: -0.08 * hang + 0.25 * release, chin: -0.1 * hang, pitch: lean,
  };
}

function limbsAt(move: "vault" | "mantle" | "hard", t: number): Limbs {
  const keys = TRAVERSE_KEYS[move];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const k = smooth(a.t, b.t, t);
  const out = { ...L0 };
  for (const n of Object.keys(L0) as (keyof Limbs)[]) out[n] = a.v[n] + (b.v[n] - a.v[n]) * k;
  return out;
}

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

  // ---- PARKOUR V3: THE ZIPLINE GRIP — the hands ON the handle's grips, wherever the trolley is -----------------------
  /** the trolley's point on the cable (world), the handle's axis, how far the cable runs above the rider's feet line, and
   *  how much of the body the handle carries (0 reaching … 1 hanging … 0 let go); null lets go */
  private grip: THREE.Vector3 | null = null;
  private readonly gripAxis = new THREE.Vector3(1, 0, 0);
  private gripHang = 55;
  private gripWeight = 1;
  setGrip(cable: THREE.Vector3 | null, axis?: THREE.Vector3, hang = 55, weight = 1): void {
    if (!cable) { this.grip = null; return; }
    (this.grip ??= new THREE.Vector3()).copy(cable);
    if (axis) this.gripAxis.copy(axis).normalize();
    this.gripHang = hang;
    this.gripWeight = Math.min(1, Math.max(0, weight));
  }
  /** WHERE THIS RIG'S HANDS HOLD A ZIPLINE HANDLE, from its own skeleton: out to either side of the head and a little up
   *  (arms raised GRIP_ELEVATION from level, the elbows just off straight) — `halfSpan` from the body's middle and `handY`
   *  above its feet. A chibi's hands cannot clear its head upward (the arms are far shorter than the head is tall), so
   *  they hold grips hanging beside it; the trolley's handle is built to these numbers (world/ziplineRig). */
  gripProfile(): GripProfile {
    const rig = this.rig;
    if (!rig) return DEFAULT_GRIP;
    // measured ONCE per skeleton, from its standing shoulders (the trolley's grips are built to it, so it must not
    // wobble with the posture), in the body's own frame
    if (!this.profile) {
      this.node.updateMatrixWorld(true);
      const inv = _im.copy(this.node.matrixWorld).invert();
      const sL = wpos(rig.arms[0]).applyMatrix4(inv), sR = wpos(rig.arms[1]).applyMatrix4(inv);
      const len = GRIP_SLACK * (armLen(rig, 0) + armLen(rig, 1)) / 2;
      const half = Math.abs(sL.x - sR.x) / 2, sy = (sL.y + sR.y) / 2;
      this.profile = { halfSpan: half + len * Math.cos(GRIP_ELEVATION), handY: sy + len * Math.sin(GRIP_ELEVATION) };
    }
    return this.profile;
  }
  private profile: GripProfile | null = null;
  /** the hands' world positions (left, right), for the tests and the dev surface — null without a rig */
  hands(): [THREE.Vector3, THREE.Vector3] | null {
    const rig = this.rig;
    if (!rig) return null;
    return [0, 1].map((i) => palmOf(rig, i)) as [THREE.Vector3, THREE.Vector3];
  }

  /** the body's skeleton (null while it has none, or for a body without the standard chain — the root motion
   *  still plays, the posture does not) */
  setScene(scene: THREE.Object3D | null): void {
    this.release();
    this.profile = null;
    this.rig = scene ? findRig(scene) : null;
  }

  /** whether this body can be articulated at all (it has the standard chain) */
  get articulated(): boolean { return this.rig !== null; }
  get active(): ParkourMove | null { return this.move; }

  /** Start a move from its beginning (replacing whatever was playing) — or `atMs` into it (PARKOUR V2: a relay that
   *  arrived late, so the pose stays in step with the line and height already that far along). */
  start(move: ParkourMove, durationMs?: number, atMs = 0): void {
    this.move = move;
    const range = move === "roll" ? ROLL_MS_RANGE : move === "vault" || move === "mantle" ? TRAVERSE_MS_RANGE : move === "ladder" || move === "zipline" ? ROUTE_MS_RANGE : null;
    this.duration = range && durationMs !== undefined && Number.isFinite(durationMs)
      ? Math.min(range.max, Math.max(range.min, durationMs))
      : PARKOUR_MS[move];
    this.elapsed = Math.min(Math.max(0, atMs), this.duration - 1);
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
    if (move === "vault" || move === "mantle" || move === "hard") { this.updateTraverse(move, limbsAt(move, t), TRAVERSE_PLANTED[move](t), TRAVERSE_PIVOT); return; }
    if (move === "ladder") { this.updateTraverse(move, ladderLimbs(this.elapsed, this.duration), false, TRAVERSE_PIVOT); return; }
    if (move === "zipline") {
      // the body swings about its HANDS (the grips' height), not about a point over its head
      this.updateTraverse(move, ziplineLimbs(this.elapsed, this.duration), false, this.gripProfile().handY / this.height);
      this.holdGrip();
      return;
    }
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

  /** PARKOUR V2/V3 — A KEYFRAMED OR CYCLIC MOVE, one frame: the root banks and pitches about `pivot` (a fraction of the
   *  height — the hips, or the hands for a hanging body), the limbs take `f`, and the feet stay put if `planted`. */
  private updateTraverse(_move: ParkourMove, f: Limbs, planted: boolean, pivotAt: number): void {
    const rig = this.rig;
    if (rig) this.restoreClip(rig);
    // root: bank onto the lead side and pitch forward, about the hips
    this.node.quaternion.setFromAxisAngle(RIGHT, f.pitch).premultiply(_qb.setFromAxisAngle(FWD, -f.bank));
    const pivot = _v.set(0, this.height * pivotAt, 0);
    this.node.position.copy(pivot).sub(pivot.clone().applyQuaternion(this.node.quaternion));
    this.node.updateMatrixWorld(true);
    if (!rig) return;
    const footBefore = planted ? this.lowestFoot(rig) : NaN;
    this.node.getWorldQuaternion(_wq);
    _X.copy(RIGHT).applyQuaternion(_wq);
    _Z.copy(FWD).applyQuaternion(_wq);
    const n = rig.spines.length;
    rig.spines.forEach((b, i) => {
      const share = (2 * (i + 1)) / (n * (n + 1));
      rotateWorld(b, about(_X, f.spine * share));
      if (f.side) rotateWorld(b, about(_Z, -f.side * share));
    });
    if (rig.neck) rotateWorld(rig.neck, about(_X, f.chin));
    rig.arms.forEach((arm, i) => {
      const lead = i === 0, side = lead ? 1 : -1;
      rotateWorld(arm, about(_X, -(lead ? f.armL : f.armT)));
      const inward = lead ? f.inL : f.inT;
      if (inward !== 0) rotateWorld(arm, about(_Z, -side * inward));
      rotateWorld(rig.fores[i], about(_X, -(lead ? f.elbowL : f.elbowT)));
    });
    rig.thighs.forEach((thigh, i) => {
      const lead = i === 0;
      rotateWorld(thigh, about(_X, -(lead ? f.hipL : f.hipT)));
      rotateWorld(rig.shins[i], about(_X, lead ? f.kneeL : f.kneeT));
    });
    this.node.updateMatrixWorld(true);
    if (planted) {
      const footAfter = this.lowestFoot(rig);
      if (Number.isFinite(footBefore) && Number.isFinite(footAfter)) this.node.position.y += footBefore - footAfter;
      this.node.updateMatrixWorld(true);
    }
    for (let i = 0; i < rig.bones.length; i++) this.written[i].copy(rig.bones[i].quaternion);
    this.wrote = true;
  }

  /** HOLDING THE HANDLE: each hand onto its grip — the grip hanging from the trolley's handle at the height and span this
   *  rig holds it (gripProfile), on the side of its own shoulder — solved as a two-bone arm (shoulder → elbow → wrist).
   *  Both the grips and the hands are put from the same trolley point every frame, so they cannot drift apart; under
   *  the trolley the grips are exactly where this body's own hands reach, so it hangs at its natural height and the
   *  posture's sway and leg swing stay its own. Reaching for it (stepping up) and letting go blend by the weight. */
  private holdGrip(): void {
    const rig = this.rig, g = this.grip;
    if (!rig || !g) return;
    const w = Math.min(1, this.gripWeight * 3);
    if (w <= 0) return;
    const prof = this.gripProfile();
    for (const i of [0, 1]) {
      const side = i === 0 ? 1 : -1;
      const target = _t.copy(g).addScaledVector(UP, -(this.gripHang - prof.handY)).addScaledVector(this.gripAxis, side * prof.halfSpan);
      solveArm(rig, i, target, w);
    }
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
