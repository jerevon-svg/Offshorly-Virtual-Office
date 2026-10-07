// vo3d avatar — THE MONKEYAGENT MOTION VOCABULARY: every way a MonkeyAgent moves, as a parametric body pose.
//
// ONE REPRESENTATION FOR EVERYTHING. A BodyPose is a handful of numbers (pelvis height, spine pitch, limb
// swings) plus up to four CONTACTS (a world point a hand or foot must be ON, and how it meets it). Every mode —
// knuckle-run, climb, ladder, pole, jump, hang, perch, sleep — produces one, and every transition is a BLEND of
// two of them. That is what keeps upright → knuckle → upright, run → climb, climb → mantle continuous instead of
// snapping between clips: there is only ever one pose, sliding between shapes.
//
// IT IS A FUNCTION OF TIME. poseAt(plan, sample, t) reads the plan, the sample and the clock and nothing else,
// so a body is fully reproducible from (plan, t) — the property the traversal layer is built on.
//
// CONTACT IS GEOMETRY, NOT GUESSWORK. Stance hands and feet are placed by ARC LENGTH along the route (the point
// the body was over at mid-stance), so a planted limb is world-fixed for its whole stance — no sliding, on a
// curve or a slope — and the rig's two-bone IK puts the hand or foot exactly there. Climb holds sit on the
// trunk's real surface, rungs on the ladder's real rungs, grips on the real pole and bar.
//
// THE CHIBI REACH ENVELOPE, measured from the contract landmarks, shapes every pose here. The arm reaches 8.4
// from a shoulder at 15.5; the head is a ~9.5-radius sphere centred ~26 up, ears out to ±14 between 18 and 27.
// So a MonkeyAgent can NEVER grip overhead (its hands cannot clear its own head), and anything held close in
// front of the face is inside the muzzle. Grips are therefore at CHEST height or BESIDE the head: climbing
// leans back with hands on the trunk at chest level, a hang is one-armed beside the cheek, a handoff is held
// below the chin with the two bodies offset. The treehouse must be built to these rules.
import * as THREE from "three";
import type { MonkeyRig, Limb } from "./monkeyRig";
import { qmul, qx, qy, qz } from "./monkeyRig";
import {
  GRAVITY, along, smooth, type Gait, type Ledge, type LinkGeom, type MotionProfile, type MotionSample, type Plan,
  type Segment, type TNode, type V3,
} from "../world/monkeyTraversal";

// ============================== THE POSE ===================================================================

export type LimbFK = { swing: number; out: number; bend: number; end: number };
export type Contact = { p: THREE.Vector3; pole: THREE.Vector3; w: number; fwd: THREE.Vector3 | null; down: THREE.Vector3 | null; ow: number };
export type BodyPose = {
  /** the model origin (the feet line under the pelvis) and its orientation in the world */
  pos: THREE.Vector3;
  q: THREE.Quaternion;
  /** model-frame pelvis offset (world units) and pelvis / total-spine / neck rotations (x pitch fwd, y yaw, z roll) */
  hips: THREE.Vector3;
  pelvis: THREE.Vector3;
  spine: THREE.Vector3;
  neck: THREE.Vector3;
  arm: [LimbFK, LimbFK];
  leg: [LimbFK, LimbFK];
  /** contacts, L then R; null = the limb stays where its FK put it */
  hand: [Contact | null, Contact | null];
  foot: [Contact | null, Contact | null];
  /** where the face looks (world direction), and how strongly */
  look: THREE.Vector3;
  lookW: number;
  /** weight of the whole procedural pose over the mixer's clip (0 = the clip, e.g. a chair sit) */
  w: number;
};

const fk = (swing = 0, out = 0, bend = 0, end = 0): LimbFK => ({ swing, out, bend, end });
export function newPose(): BodyPose {
  return {
    pos: new THREE.Vector3(), q: new THREE.Quaternion(), hips: new THREE.Vector3(), pelvis: new THREE.Vector3(),
    spine: new THREE.Vector3(), neck: new THREE.Vector3(), arm: [fk(), fk()], leg: [fk(), fk()],
    hand: [null, null], foot: [null, null], look: new THREE.Vector3(0, 0, 1), lookW: 0, w: 1,
  };
}
const contact = (p: THREE.Vector3, pole: THREE.Vector3, w = 1, fwd: THREE.Vector3 | null = null, down: THREE.Vector3 | null = null, ow = 1): Contact =>
  ({ p, pole, w, fwd, down, ow });

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpFK = (a: LimbFK, b: LimbFK, t: number): LimbFK => ({ swing: lerpN(a.swing, b.swing, t), out: lerpN(a.out, b.out, t), bend: lerpN(a.bend, b.bend, t), end: lerpN(a.end, b.end, t) });
function lerpContact(a: Contact | null, b: Contact | null, t: number): Contact | null {
  if (!a && !b) return null;
  if (a && b) {
    const fwd = a.fwd && b.fwd ? a.fwd.clone().lerp(b.fwd, t).normalize() : (t < 0.5 ? a.fwd : b.fwd);
    const down = a.down && b.down ? a.down.clone().lerp(b.down, t).normalize() : (t < 0.5 ? a.down : b.down);
    return { p: a.p.clone().lerp(b.p, t), pole: a.pole.clone().lerp(b.pole, t), w: lerpN(a.w, b.w, t), fwd, down, ow: lerpN(a.ow, b.ow, t) };
  }
  const c = (a ?? b)!;
  return { ...c, w: c.w * (a ? 1 - t : t), ow: c.ow * (a ? 1 - t : t) };
}
/** THE BLEND: every transition in the vocabulary is this. */
export function blendPose(a: BodyPose, b: BodyPose, t: number): BodyPose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    pos: a.pos.clone().lerp(b.pos, t), q: a.q.clone().slerp(b.q, t), hips: a.hips.clone().lerp(b.hips, t),
    pelvis: a.pelvis.clone().lerp(b.pelvis, t), spine: a.spine.clone().lerp(b.spine, t), neck: a.neck.clone().lerp(b.neck, t),
    arm: [lerpFK(a.arm[0], b.arm[0], t), lerpFK(a.arm[1], b.arm[1], t)], leg: [lerpFK(a.leg[0], b.leg[0], t), lerpFK(a.leg[1], b.leg[1], t)],
    hand: [lerpContact(a.hand[0], b.hand[0], t), lerpContact(a.hand[1], b.hand[1], t)],
    foot: [lerpContact(a.foot[0], b.foot[0], t), lerpContact(a.foot[1], b.foot[1], t)],
    look: a.look.clone().lerp(b.look, t).normalize(), lookW: lerpN(a.lookW, b.lookW, t), w: lerpN(a.w, b.w, t),
  };
}

// ============================== FRAMES ======================================================================

const UP = new THREE.Vector3(0, 1, 0);
const tv = (p: V3) => new THREE.Vector3(p.x, p.y, p.z);
/** an orientation whose model +z faces `fwd` and +y is as close to `up` as the facing allows */
export function frame(fwd: THREE.Vector3, up: THREE.Vector3 = UP): THREE.Quaternion {
  const y = up.clone().normalize();
  const z = fwd.clone().addScaledVector(y, -fwd.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const yawQ = (dir: THREE.Vector3) => frame(new THREE.Vector3(dir.x, 0, dir.z));
/** a model-frame point to world, under a pose's root */
const W = (pose: { pos: THREE.Vector3; q: THREE.Quaternion }, x: number, y: number, z: number) =>
  new THREE.Vector3(x, y, z).applyQuaternion(pose.q).add(pose.pos);
const Wd = (pose: { q: THREE.Quaternion }, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(pose.q).normalize();

// ============================== RIG CONSTANTS (world units, measured from the contract) =====================
/** ankle height above the sole; wrist height above the knuckles with the hand hanging fingers-down */
export const ANKLE_H = 2.0;
export const HAND_L = 2.3;
/** wrist height over the floor with the palm flat (hand thickness) */
export const PALM_H = 1.1;
/** how far a body's spine stands off a climbed surface at pelvis height (belly clear) */
const CLIMB_STANDOFF = 5.0;

// ============================== THE GAITS ===================================================================

/** One gait's shape. Limb order: handL, handR, footL, footR. Phases in cycles; stride = arc per cycle. */
type GaitShape = {
  /** stride = arc per cycle; duty = fraction of the cycle each limb (handL, handR, footL, footR) is planted.
   *  stride × duty is how far a planted limb sweeps under the body, so it is held inside that limb's reach. */
  stride: number; duty: readonly [number, number, number, number]; phase: readonly [number, number, number, number];
  /** model-frame mid-stance plant offsets (x, z) */
  plant: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
  /** swing lift heights for hands and feet */
  liftH: number; liftF: number;
  /** pelvis drop and fore-aft, pelvis pitch, spine pitch, vertical bob amplitude */
  hipsY: number; hipsZ: number; pelvisPitch: number; spinePitch: number; bob: number;
  /** hands on the ground? (knuckle) — else the arms swing in FK */
  handsDown: boolean;
  armSwing: number; armOut: number; armBend: number;
};
export const GAITS: Readonly<Record<Gait, GaitShape>> = {
  walk: {
    stride: 17, duty: [0, 0, 0.62, 0.62], phase: [0, 0, 0, 0.5], plant: [[0, 0], [0, 0], [2.2, 0.4], [-2.2, 0.4]],
    liftH: 0, liftF: 2.2, hipsY: -0.7, hipsZ: 0, pelvisPitch: 0.06, spinePitch: 0.18, bob: 0.45,
    handsDown: false, armSwing: 0.38, armOut: 0.36, armBend: 0.45,
  },
  scamper: {
    stride: 25, duty: [0, 0, 0.36, 0.36], phase: [0, 0, 0, 0.5], plant: [[0, 0], [0, 0], [2.4, 0.8], [-2.4, 0.8]],
    liftH: 0, liftF: 3.6, hipsY: -1.5, hipsZ: -0.4, pelvisPitch: 0.16, spinePitch: 0.5, bob: 1.0,
    handsDown: false, armSwing: 0.62, armOut: 0.42, armBend: 1.15,
  },
  knuckle: {
    // a primate lope: the hind pair lands, then the fore pair, with a short float between. Stride and duty
    // keep each planted limb inside its reach (a foot sweeps ~7.7, a hand ~9.6)
    stride: 24, duty: [0.4, 0.4, 0.32, 0.32], phase: [0.5, 0.6, 0, 0.1], plant: [[3.8, 7.6], [-3.8, 7.6], [2.4, -0.8], [-2.4, -0.8]],
    liftH: 3.8, liftF: 3.0, hipsY: -2.7, hipsZ: -1.2, pelvisPitch: 0.48, spinePitch: 1.0, bob: 0.8,
    handsDown: true, armSwing: 0.9, armOut: 0.3, armBend: 0.4,
  },
};

/** the arc length at which limb i's step k reaches mid-stance */
const midStance = (k: number, i: number, G: GaitShape) => (k + G.duty[i] / 2 - G.phase[i]) * G.stride;

/** where a run's route is at arc length s (extrapolated straight past either end) */
function routeAt(seg: Segment, s: number): { p: THREE.Vector3; t: THREE.Vector3 } {
  const R = seg.run!;
  const L = R.length;
  const a = along(R.pts, R.cum, Math.min(L, Math.max(0, s)));
  const p = tv(a.p), t = tv(a.t);
  if (s < 0) p.addScaledVector(t, s);
  else if (s > L) p.addScaledVector(t, s - L);
  return { p, t };
}
/** a direction laid into the plane of a surface with normal n (a foot's toe line on a slope) */
function onSurface(d: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 {
  const o = d.clone().addScaledVector(n, -d.dot(n));
  return o.lengthSq() > 1e-6 ? o.normalize() : d.clone();
}
/** the ground frame at a route point: heading on the horizontal, up tilted a little toward a branch's slope */
function groundFrame(t: THREE.Vector3, surface: "floor" | "branch"): THREE.Quaternion {
  if (surface === "floor") return yawQ(t);
  // on a sloped branch the body pitches with it (not fully — a monkey keeps its head up)
  const flatT = new THREE.Vector3(t.x, 0, t.z).normalize();
  const slopeUp = new THREE.Vector3().crossVectors(new THREE.Vector3().crossVectors(t, UP), t).normalize();
  if (slopeUp.y < 0) slopeUp.negate();
  return frame(flatT.lerp(t, 0.7).normalize(), UP.clone().lerp(slopeUp, 0.6).normalize());
}

/** THE GAIT POSE: a body running a route at gait arc S. Pure function of (segment, S, speed, time). */
function gaitPose(seg: Segment, gait: Gait, s: number, gaitS: number, speed: number, prof: MotionProfile): BodyPose {
  const R = seg.run!;
  const G = GAITS[gait];
  const here = routeAt(seg, s);
  const P = newPose();
  P.pos.copy(here.p);
  P.q.copy(groundFrame(here.t, R.surface));
  const cyc = gaitS / G.stride;
  const crouch = gait === "knuckle" ? 0.75 + 0.5 * prof.crouch : 1;
  const branch = R.surface === "branch" ? 1 : 0;
  // posture
  P.hips.set(0, G.hipsY * crouch + G.bob * (gait === "walk" ? -Math.cos(4 * Math.PI * cyc) * 0.5 : Math.sin(2 * Math.PI * (cyc + 0.15))), G.hipsZ);
  P.pelvis.set(G.pelvisPitch + prof.lean * 0.4, gait === "walk" ? 0.12 * Math.sin(2 * Math.PI * cyc) : 0, gait === "walk" ? 0.05 * Math.sin(2 * Math.PI * cyc) : 0);
  P.spine.set(G.spinePitch + prof.lean + (gait === "knuckle" ? 0.1 * Math.sin(2 * Math.PI * (cyc + 0.4)) : 0), gait === "walk" ? -0.16 * Math.sin(2 * Math.PI * cyc) : 0, 0);
  // the head stays level and looks a little ahead of the feet
  P.look.copy(new THREE.Vector3(here.t.x, Math.min(0.1, here.t.y) - 0.18, here.t.z).normalize());
  P.lookW = 1;
  // limbs
  const limbs = [0, 1, 2, 3] as const;
  for (const i of limbs) {
    const isHand = i < 2;
    if (isHand && !G.handsDown) continue;
    const c = cyc + G.phase[i];
    const k = Math.floor(c), f = c - k;
    const [px, pz] = G.plant[i];
    const narrow = branch ? 0.55 : 1;
    const radius = Math.max(3, seg.link.geom.kind === "ground" ? seg.link.geom.radius ?? 5 : 5);
    // SURFACE CONTACT: each plant carries the surface's own normal there — tilted with the route's grade (a ramp,
    // a sloped limb) and, on a branch, rolled round the cylinder to where the sole actually meets the bark
    const plantN = new THREE.Vector3();
    const plantAt = (kk: number, n?: THREE.Vector3) => {
      const r = routeAt(seg, midStance(kk, i, G) - R.s0);
      const fr = groundFrame(r.t, R.surface);
      const lat = px * narrow;
      const ground = new THREE.Vector3(lat, 0, pz).applyQuaternion(fr).add(r.p);
      // a branch is a cylinder under its top line: drop the contact off-centre onto its curved top
      if (branch) ground.y -= radius - Math.sqrt(Math.max(0, radius * radius - lat * lat));
      if (n) {
        const flat = new THREE.Vector3(r.t.x, 0, r.t.z).normalize();
        n.crossVectors(new THREE.Vector3().crossVectors(r.t, UP), r.t).normalize();
        if (!Number.isFinite(n.y) || n.lengthSq() < 0.5) n.copy(UP);
        if (n.y < 0) n.negate();
        if (branch) { const ang = Math.asin(Math.max(-0.85, Math.min(0.85, lat / radius))); n.applyAxisAngle(flat, -ang); }
      }
      return ground;
    };
    let p: THREE.Vector3;
    let lifted = 0;
    const duty = G.duty[i];
    if (f < duty) p = plantAt(k, plantN);
    else {
      const u = (f - duty) / (1 - duty);
      const n0 = new THREE.Vector3(), n1 = new THREE.Vector3();
      p = plantAt(k, n0).lerp(plantAt(k + 1, n1), smooth(u));
      plantN.copy(n0).lerp(n1, smooth(u)).normalize();
      lifted = Math.sin(Math.PI * u);
      p.addScaledVector(UP, (isHand ? G.liftH : G.liftF) * lifted * Math.min(1, speed / 25 + 0.3));
    }
    const side = i % 2 === 0 ? 1 : -1;
    if (isHand) {
      // PALM-DOWN (palmigrade — how monkeys run; the base has no finger bones for a true knuckle curl): the
      // palm's centre is the contact, the wrist sits just behind and above it, fingers forward and a touch in.
      // In the swing the wrist flexes so the fingers trail.
      const fwdH = onSurface(Wd(P, -side * 0.18, 0, 1), plantN);
      const wrist = p.clone().addScaledVector(plantN, PALM_H).addScaledVector(fwdH, -1.3);
      const pole = W(P, side * 7, 12, -7);
      const fingers = fwdH.clone().lerp(UP.clone().negate(), lifted * 0.8).normalize();
      const palm = plantN.clone().negate().lerp(Wd(P, 0, 0, -1), lifted * 0.8).normalize();
      P.hand[i as 0 | 1] = contact(wrist, pole, 1, fingers, palm, 1);
    } else {
      // the sole lies ON the surface: ankle up its normal, toes along it (a ramp's grade, a limb's slope and roll)
      const ankle = p.clone().addScaledVector(plantN, ANKLE_H);
      const pole = W(P, side * 3, 6, 9);
      const toe = onSurface(Wd(P, 0, 0, 1), plantN);
      const across = new THREE.Vector3().crossVectors(plantN, toe).normalize();
      // the swing foot toes off and reaches heel-first
      const pitch = lifted > 0 ? -0.5 * lifted : 0;
      P.foot[i - 2] = contact(ankle, pole, 1, toe.clone().applyAxisAngle(across, pitch), plantN.clone().negate().applyAxisAngle(across, pitch), 1);
    }
  }
  if (!G.handsDown) {
    // upright gaits: arms counter-swing the legs in FK, out from the belly, elbows soft
    const sw = Math.sin(2 * Math.PI * cyc) * G.armSwing * Math.min(1, speed / 20 + 0.2);
    P.arm[0] = fk(sw + 0.15, G.armOut, G.armBend, 0.2);
    P.arm[1] = fk(-sw + 0.15, G.armOut, G.armBend, 0.2);
  } else {
    P.arm[0] = fk(0.9, 0.3, 0.3, 0); P.arm[1] = fk(0.9, 0.3, 0.3, 0);
  }
  return P;
}

// ============================== STILL POSES (stand, sit, perch, sleep, work) ================================

/** The MonkeyAgent's own stand: knees soft, a slight hunch, arms hanging forward of the belly, breathing. */
export function standPose(pos: THREE.Vector3, q: THREE.Quaternion, t: number, prof: MotionProfile): BodyPose {
  const P = newPose();
  P.pos.copy(pos); P.q.copy(q);
  const br = Math.sin(t * 1.9 + prof.stridePhase * 6);
  const shift = Math.sin(t * 0.37 + prof.stridePhase * 3);
  P.hips.set(0.25 * shift, -0.6 + 0.08 * br, 0);
  P.pelvis.set(0.06 + prof.lean * 0.3, 0.04 * shift, -0.03 * shift);
  P.spine.set(0.16 + prof.lean + 0.025 * br, -0.03 * shift, 0.02 * shift);
  P.arm[0] = fk(0.22 + 0.02 * br, 0.34, 0.45, 0.25);
  P.arm[1] = fk(0.22 + 0.02 * br, 0.34, 0.45, 0.25);
  P.foot[0] = contact(W(P, 2.3, ANKLE_H, 0.4), W(P, 3, 6, 9), 1, Wd(P, 0.12, 0, 1), UP.clone().negate());
  P.foot[1] = contact(W(P, -2.3, ANKLE_H, 0.4), W(P, -3, 6, 9), 1, Wd(P, -0.12, 0, 1), UP.clone().negate());
  P.look.copy(Wd(P, 0, -0.08, 1)); P.lookW = 0.8;
  return P;
}

/** sitting on the floor: legs out, knees up, hands on the knees */
function sitPose(pos: THREE.Vector3, q: THREE.Quaternion, t: number, prof: MotionProfile): BodyPose {
  const P = newPose();
  P.pos.copy(pos); P.q.copy(q);
  const br = Math.sin(t * 1.6 + prof.stridePhase * 6);
  P.hips.set(0, -6.6, -1.2);
  P.pelvis.set(-0.35, 0, 0);
  P.spine.set(0.42 + 0.02 * br, 0, 0);
  P.foot[0] = contact(W(P, 3.2, ANKLE_H - 0.6, 6.4), W(P, 4, 10, 6), 1, Wd(P, 0.2, 0, 1), UP.clone().negate());
  P.foot[1] = contact(W(P, -3.2, ANKLE_H - 0.6, 6.4), W(P, -4, 10, 6), 1, Wd(P, -0.2, 0, 1), UP.clone().negate());
  P.hand[0] = contact(W(P, 4.4, 6.4, 5.4), W(P, 9, 10, -4), 1, Wd(P, 0, -0.3, 1), Wd(P, 0, -1, 0), 0.6);
  P.hand[1] = contact(W(P, -4.4, 6.4, 5.4), W(P, -9, 10, -4), 1, Wd(P, 0, -0.3, 1), Wd(P, 0, -1, 0), 0.6);
  P.look.copy(Wd(P, 0, -0.05, 1)); P.lookW = 0.8;
  return P;
}

/** PERCHED: a deep monkey squat on a post or a branch top, knuckles resting on the surface in front */
function perchPose(pos: THREE.Vector3, q: THREE.Quaternion, t: number, prof: MotionProfile, branch?: { r: number; rise?: number }): BodyPose {
  const P = newPose();
  P.pos.copy(pos); P.q.copy(q);
  const br = Math.sin(t * 1.7 + prof.stridePhase * 6);
  const scan = Math.sin(t * 0.45 + prof.stridePhase * 4);
  P.hips.set(0, -4.4 + 0.06 * br, -1.6);
  P.pelvis.set(0.25, 0, 0);
  P.spine.set(0.75 + 0.03 * br, 0, 0);
  if (branch) {
    // ON A LIMB: feet close together gripping the top of the cylinder, soles rolled round its curve, knuckles on
    // the bark ahead (which rises with the limb). Each contact sits exactly on the surface it presses.
    const onLimb = (lat: number, fwd: number, lift: number) => {
      const r = branch.r, l = Math.max(-0.85 * r, Math.min(0.85 * r, lat));
      const drop = r - Math.sqrt(r * r - l * l), ang = Math.asin(l / r);
      const n = UP.clone().applyAxisAngle(Wd(P, 0, 0, 1), -ang);
      const at = W(P, l, -drop + fwd * (branch.rise ?? 0), fwd).addScaledVector(n, lift);
      return { at, n };
    };
    const f0 = onLimb(1.7, 0.6, ANKLE_H), f1 = onLimb(-1.7, 0.6, ANKLE_H), h0 = onLimb(1.9, 5.4, HAND_L), h1 = onLimb(-1.9, 5.4, HAND_L);
    P.foot[0] = contact(f0.at, W(P, 5, 7, 8), 1, Wd(P, 0.15, 0, 1), f0.n.clone().negate());
    P.foot[1] = contact(f1.at, W(P, -5, 7, 8), 1, Wd(P, -0.15, 0, 1), f1.n.clone().negate());
    P.hand[0] = contact(h0.at, W(P, 7, 10, -5), 1, h0.n.clone().negate(), Wd(P, 0, 0, -1));
    P.hand[1] = contact(h1.at, W(P, -7, 10, -5), 1, h1.n.clone().negate(), Wd(P, 0, 0, -1));
  } else {
    P.foot[0] = contact(W(P, 2.6, ANKLE_H, 0.6), W(P, 5, 7, 8), 1, Wd(P, 0.25, 0, 1), UP.clone().negate());
    P.foot[1] = contact(W(P, -2.6, ANKLE_H, 0.6), W(P, -5, 7, 8), 1, Wd(P, -0.25, 0, 1), UP.clone().negate());
    P.hand[0] = contact(W(P, 2.9, HAND_L, 5.2), W(P, 7, 10, -5), 1, UP.clone().negate(), Wd(P, 0, 0, -1));
    P.hand[1] = contact(W(P, -2.9, HAND_L, 5.2), W(P, -7, 10, -5), 1, UP.clone().negate(), Wd(P, 0, 0, -1));
  }
  P.look.copy(Wd(P, 0.45 * scan, -0.1, 1)); P.lookW = 1;
  return P;
}

/** ASLEEP on its back, knees up, hands folded on the belly, the big head rolled to one side. The whole model
 *  frame is laid down; the pelvis is lifted so the back (not the spine line) meets the floor. */
function sleepPose(pos: THREE.Vector3, q: THREE.Quaternion, t: number, prof: MotionProfile): BodyPose {
  const P = newPose();
  // lie down: the model's up goes to the node's facing (head that way), its face to the sky, tilted a little
  // by the head's size so the back of the head and the seat both touch
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const lieQ = frame(UP.clone().applyAxisAngle(new THREE.Vector3().crossVectors(fwd, UP).normalize(), 0.1), fwd);
  P.q.copy(lieQ);
  P.pos.copy(pos).addScaledVector(UP, 4.4).addScaledVector(fwd, -9.6);
  const br = Math.sin(t * 1.1 + prof.stridePhase * 6);
  P.hips.set(0, 0, 0);
  P.pelvis.set(-0.15, 0, 0);
  P.spine.set(-0.08 + 0.03 * br, 0, 0);
  P.neck.set(-0.2, 0.55, 0.15);
  // knees up: feet flat on the floor near the seat
  const floorUp = UP.clone();
  P.foot[0] = contact(pos.clone().addScaledVector(fwd, -14.5).add(new THREE.Vector3().crossVectors(UP, fwd).multiplyScalar(-2.8)).addScaledVector(floorUp, ANKLE_H), W(P, 3, 6, 12), 1, fwd.clone(), floorUp.clone().negate());
  P.foot[1] = contact(pos.clone().addScaledVector(fwd, -14.5).add(new THREE.Vector3().crossVectors(UP, fwd).multiplyScalar(2.8)).addScaledVector(floorUp, ANKLE_H), W(P, -3, 6, 12), 1, fwd.clone(), floorUp.clone().negate());
  P.hand[0] = contact(W(P, 1.4, 10.5 + 0.2 * br, 4.6), W(P, 8, 12, 2), 1, Wd(P, -1, 0, 0), Wd(P, 0, 0, -1), 0.7);
  P.hand[1] = contact(W(P, -1.4, 10.0 + 0.2 * br, 4.6), W(P, -8, 12, 2), 1, Wd(P, 1, 0, 0), Wd(P, 0, 0, -1), 0.7);
  P.lookW = 0;
  return P;
}

/** STANDING WORK: both hands on the bench in front, head scanning the screens, a tap every so often */
function workStandPose(pos: THREE.Vector3, q: THREE.Quaternion, t: number, prof: MotionProfile, benchH: number): BodyPose {
  const P = standPose(pos, q, t, prof);
  const scan = Math.sin(t * 0.55 + prof.stridePhase * 5);
  const tap = Math.max(0, Math.sin(t * 2.6)) ** 6;
  P.spine.x += 0.12;
  P.hand[0] = contact(W(P, 3.4 + 1.2 * scan, benchH + 1.0 + 1.6 * tap, 6.6), W(P, 9, 12, -3), 1, Wd(P, 0, 0, 1), UP.clone().negate(), 0.8);
  P.hand[1] = contact(W(P, -3.6, benchH + 1.0, 6.2), W(P, -9, 12, -3), 1, Wd(P, 0, 0, 1), UP.clone().negate(), 0.8);
  P.look.copy(Wd(P, 0.35 * scan, 0.12, 1)); P.lookW = 1;
  return P;
}

/** LEANING ON A RAIL: forearms on the rail ahead (14 above the deck, at the deck's edge), weight forward, looking
 *  out and down over the Lab, shifting now and then */
function leanPose(pos: THREE.Vector3, q: THREE.Quaternion, t: number, prof: MotionProfile): BodyPose {
  const P = standPose(pos, q, t, prof);
  const look = Math.sin(t * 0.33 + prof.stridePhase * 7);
  P.spine.x += 0.32;
  P.hips.z -= 0.6;
  P.hand[0] = contact(W(P, 4.2, 14.6, 7.6), W(P, 10, 12, -2), 1, Wd(P, -0.3, 0, 1), UP.clone().negate(), 0.8);
  P.hand[1] = contact(W(P, -4.2, 14.6, 7.6), W(P, -10, 12, -2), 1, Wd(P, 0.3, 0, 1), UP.clone().negate(), 0.8);
  P.look.copy(Wd(P, 0.4 * look, -0.45, 1)); P.lookW = 1;
  return P;
}

/** SEATED WORK on a monkey stool: seat under the pelvis, feet on the footrest, hands typing on the surface in
 *  front, eyes on the screen. Procedural, not the employee chair clip: MonkeyAgent stations are built to the
 *  monkey's own proportions (seat ~12, footrest ~7, work surface ~18, screens ≥ 14 in front of the spine — the
 *  head is 9.5 in radius). */
function workSeatedPose(pos: THREE.Vector3, q: THREE.Quaternion, t: number, prof: MotionProfile, seatY: number, surfY: number): BodyPose {
  const P = newPose();
  P.pos.copy(pos); P.q.copy(q);
  const br = Math.sin(t * 1.8 + prof.stridePhase * 6);
  const scan = Math.sin(t * 0.42 + prof.stridePhase * 4);
  P.hips.set(0, seatY + 2.3 - 9.43 + 0.05 * br, 0.4);
  P.pelvis.set(-0.12, 0, 0);
  P.spine.set(0.3 + 0.02 * br, 0.04 * scan, 0);
  const footY = seatY - 5;
  P.foot[0] = contact(W(P, 2.5, footY + ANKLE_H, 4.4), W(P, 4, seatY + 3, 12), 1, Wd(P, 0.1, 0, 1), UP.clone().negate());
  P.foot[1] = contact(W(P, -2.5, footY + ANKLE_H, 4.4), W(P, -4, seatY + 3, 12), 1, Wd(P, -0.1, 0, 1), UP.clone().negate());
  // typing: each hand taps in its own rhythm, in bursts, drifting a little across the keys
  for (const [i, side] of [[0, 1], [1, -1]] as const) {
    const burst = Math.max(0, Math.sin(t * 1.3 + side + prof.stridePhase * 3));
    const tap = Math.max(0, Math.sin(t * (12.5 + side * 1.3) + side * 1.7)) ** 3 * burst;
    const drift = 0.8 * Math.sin(t * 0.7 + side * 2);
    P.hand[i] = contact(W(P, side * 2.8 + drift, surfY + PALM_H + 0.9 * tap, 7.0), W(P, side * 9, seatY + 6, -3), 1, Wd(P, -side * 0.15, -0.15, 1), UP.clone().negate(), 0.9);
  }
  P.look.copy(Wd(P, 0.3 * scan, 0.05, 1)); P.lookW = 1;
  return P;
}

// ============================== CLIMB / LADDER / POLE ======================================================

/** the climbed-face frame: model +y along the structure, +z toward it */
function climbFrame(axis: THREE.Vector3, out: THREE.Vector3): THREE.Quaternion {
  return frame(out.clone().negate(), axis);
}
/** the climbing posture shared by trunk, ladder and pole: belly close, chest leaning back so the head clears
 *  the surface, hands at chest height, feet tucked */
function climbPosture(P: BodyPose, lean: number): void {
  P.hips.set(0, -1.2, 0);
  P.pelvis.set(-0.12, 0, 0);
  P.spine.set(-lean, 0, 0);
  P.arm[0] = fk(1.0, 0.5, 0.9, 0); P.arm[1] = fk(1.0, 0.5, 0.9, 0);
  P.leg[0] = fk(0.9, 0.4, 1.2, 0); P.leg[1] = fk(0.9, 0.4, 1.2, 0);
}

/** A point on a cylinder's surface at height h along its axis, `ang` radians round from the climbed face. */
function onCylinder(bottom: THREE.Vector3, axis: THREE.Vector3, out: THREE.Vector3, r: number, h: number, ang: number): THREE.Vector3 {
  const side = new THREE.Vector3().crossVectors(axis, out).normalize();
  const radial = out.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang));
  return bottom.clone().addScaledVector(axis, h).addScaledVector(radial, r);
}

type ClimbGeom = { bottom: THREE.Vector3; axis: THREE.Vector3; out: THREE.Vector3; r: number; length: number; ladder: { rung: number; width: number } | null };
function climbGeom(g: LinkGeom): ClimbGeom {
  if (g.kind === "climb") { const b = tv(g.bottom), d = tv(g.top).sub(b); return { bottom: b, axis: d.clone().normalize(), out: tv(g.out).normalize(), r: g.radius, length: d.length(), ladder: null }; }
  if (g.kind === "ladder") { const b = tv(g.bottom), d = tv(g.top).sub(b); return { bottom: b, axis: d.clone().normalize(), out: tv(g.out).normalize(), r: 0.8, length: d.length(), ladder: { rung: g.rung, width: g.width } }; }
  throw new Error("not a climb");
}

/** CLIMBING at body height hb (the model origin's distance up the axis). Contralateral holds, world-fixed on
 *  the surface (or snapped to rungs), so hands and feet stay put while the body moves past them. */
function climbPose(C: ClimbGeom, hb: number, down: boolean): BodyPose {
  const P = newPose();
  const out = C.out.clone().addScaledVector(C.axis, -C.out.dot(C.axis)).normalize();
  P.q.copy(climbFrame(C.axis, out));
  const standoff = C.r + CLIMB_STANDOFF + (C.ladder ? 0.6 : 0);
  // the hb-driven cycle: hands and feet each advance one stride per cycle
  const stride = C.ladder ? C.ladder.rung * 2 : 9;
  const cyc = hb / stride;
  // a body surges as each diagonal pair pushes — a little faster mid-step
  const surge = 0.5 * Math.sin(2 * Math.PI * cyc * 2);
  P.pos.copy(C.bottom).addScaledVector(C.axis, hb + surge).addScaledVector(out, standoff);
  climbPosture(P, C.ladder ? 0.34 : 0.4);
  P.pelvis.z = 0.07 * Math.sin(2 * Math.PI * cyc);
  P.spine.y = -0.08 * Math.sin(2 * Math.PI * cyc);
  const duty = 0.55;
  // handL, handR, footL, footR: diagonal pairs (handL+footR, handR+footL)
  const phase = [0, 0.5, 0.5, 0] as const;
  const relH = [12.6, 12.6, 3.6, 3.6] as const;
  const lat = C.ladder ? [3.6, -3.6, 2.6, -2.6] : [4.6, -4.6, 3.2, -3.2];
  for (let i = 0; i < 4; i++) {
    const c = cyc + phase[i];
    const k = Math.floor(c), f = c - k;
    const holdH = (kk: number) => {
      const h = (kk + duty / 2 - phase[i]) * stride + relH[i];
      return C.ladder ? Math.round(h / C.ladder.rung) * C.ladder.rung : h;
    };
    const holdAt = (h: number) => (C.ladder
      ? C.bottom.clone().addScaledVector(C.axis, h).add(new THREE.Vector3().crossVectors(C.axis, out).normalize().multiplyScalar(-lat[i])).addScaledVector(out, 0.9)
      : onCylinder(C.bottom, C.axis, out, C.r, h, -lat[i] / C.r));
    let p: THREE.Vector3, lifted = 0;
    if (f < duty) p = holdAt(holdH(k));
    else {
      const u = (f - duty) / (1 - duty);
      lifted = Math.sin(Math.PI * u);
      p = holdAt(holdH(k)).lerp(holdAt(holdH(k + 1)), smooth(u)).addScaledVector(out, 2.2 * lifted);
    }
    const radialIn = p.clone().sub(C.bottom).addScaledVector(C.axis, -p.clone().sub(C.bottom).dot(C.axis)).normalize().negate();
    if (C.ladder) radialIn.copy(out).negate();
    if (i < 2) {
      // palm on the surface (ladder: over the rung), fingers up the trunk
      const wrist = p.clone().addScaledVector(radialIn, -1.1).addScaledVector(C.axis, -1.2);
      const pole = W(P, i === 0 ? 9 : -9, 9, -3);
      P.hand[i as 0 | 1] = contact(wrist, pole, 1, C.ladder ? radialIn.clone() : C.axis.clone(), C.ladder ? C.axis.clone().negate() : radialIn.clone(), 1 - 0.5 * lifted);
    } else {
      const ankle = p.clone().addScaledVector(radialIn, -ANKLE_H * 0.8).addScaledVector(C.axis, C.ladder ? ANKLE_H : 0.4);
      const pole = W(P, i === 2 ? 6 : -6, 9, 6);
      P.foot[i - 2] = contact(ankle, pole, 1, C.ladder ? radialIn.clone() : C.axis.clone(), C.ladder ? C.axis.clone().negate() : radialIn.clone(), 1 - 0.5 * lifted);
    }
  }
  // eyes on the structure: a little up it when climbing, down toward the feet when descending — never at the
  // sky (a big head tipped right back reads as falling off)
  P.look.copy(C.axis.clone().multiplyScalar(down ? -0.55 : 0.42).addScaledVector(out, -0.9).addScaledVector(new THREE.Vector3().crossVectors(C.axis, out).normalize(), 0.18).normalize());
  P.lookW = 1;
  return P;
}

/** the MANTLE onto a ledge in front of (or beside) the climber: hands onto the deck at chest height, push,
 *  knee up, stand. u: 0 = still climbing, 1 = standing on the deck at `standAt`. */
function mantlePose(from: BodyPose, ledge: Ledge, standAt: THREE.Vector3, u: number, t: number, prof: MotionProfile): BodyPose {
  const edge = tv(ledge.edge), inward = tv(ledge.inward).normalize();
  const faceQ = yawQ(inward);
  const side = new THREE.Vector3().crossVectors(UP, inward).normalize();
  // K1: hands on the deck, body still low and turning to face the deck
  const k1 = newPose();
  k1.q.copy(from.q.clone().slerp(faceQ, 0.85));
  k1.pos.copy(edge).addScaledVector(inward, -CLIMB_STANDOFF - 1.5).addScaledVector(UP, -12.5);
  climbPosture(k1, 0.3);
  k1.hand[0] = contact(edge.clone().addScaledVector(inward, 3.2).addScaledVector(side, 4.2).addScaledVector(UP, HAND_L * 0.4), W(k1, 9, 10, -3), 1, inward.clone(), UP.clone().negate());
  k1.hand[1] = contact(edge.clone().addScaledVector(inward, 3.2).addScaledVector(side, -4.2).addScaledVector(UP, HAND_L * 0.4), W(k1, -9, 10, -3), 1, inward.clone(), UP.clone().negate());
  k1.foot = [from.foot[0], from.foot[1]];
  k1.look.copy(inward.clone().addScaledVector(UP, -0.2).normalize()); k1.lookW = 1;
  // K2: the push — pelvis to deck height, chest over the hands, knees drawn up
  const k2 = newPose();
  k2.q.copy(faceQ);
  k2.pos.copy(edge).addScaledVector(inward, -1.5).addScaledVector(UP, -6);
  k2.hips.set(0, -1.5, -1);
  k2.pelvis.set(0.5, 0, 0); k2.spine.set(0.85, 0, 0);
  k2.hand = [k1.hand[0], k1.hand[1]];
  k2.foot[0] = contact(edge.clone().addScaledVector(inward, -1).addScaledVector(side, 2.5).addScaledVector(UP, -3), W(k2, 4, 8, 10), 1, inward.clone(), inward.clone().negate().addScaledVector(UP, -0.5).normalize(), 0.5);
  k2.foot[1] = contact(edge.clone().addScaledVector(inward, 1.5).addScaledVector(side, -2.5).addScaledVector(UP, ANKLE_H), W(k2, -4, 8, 10), 1, inward.clone(), UP.clone().negate(), 0.8);
  k2.look.copy(inward.clone().addScaledVector(UP, -0.1).normalize()); k2.lookW = 1;
  // K3: crouched on the deck edge, about to rise
  const k3 = perchPose(edge.clone().addScaledVector(inward, 4.5), faceQ, t, prof);
  const stand = standPose(standAt, faceQ, t, prof);
  if (u < 0.3) return blendPose(from, k1, smooth(u / 0.3));
  if (u < 0.58) return blendPose(k1, k2, smooth((u - 0.3) / 0.28));
  if (u < 0.8) return blendPose(k2, k3, smooth((u - 0.58) / 0.22));
  return blendPose(k3, stand, smooth((u - 0.8) / 0.2));
}

/** THE POLE HUG at body height y: pole in front, leaning back so the head clears it, hands one above the
 *  other, soles pressing it from either side. `around` turns the body round the pole (radians). */
function poleHug(top: THREE.Vector3, bottom: THREE.Vector3, r: number, facing: THREE.Vector3, y: number, slide: number): BodyPose {
  const P = newPose();
  const axis = top.clone().sub(bottom).normalize();
  const atY = bottom.clone().addScaledVector(axis, y - bottom.y);
  const fwd = facing.clone().setY(0).normalize();
  P.q.copy(yawQ(fwd));
  P.pos.copy(atY).addScaledVector(fwd, -(r + 6.2));
  climbPosture(P, 0.38);
  P.pelvis.set(-0.2, 0.18, 0);
  P.spine.set(-0.36, 0.12, 0);
  const side = new THREE.Vector3().crossVectors(UP, fwd).normalize();
  const grip = (h: number) => atY.clone().addScaledVector(UP, h).addScaledVector(fwd, -r - 0.9);
  P.hand[0] = contact(grip(13.4).addScaledVector(side, 0.9), W(P, 9, 12, -3), 1, UP.clone(), fwd.clone(), 0.8);
  P.hand[1] = contact(grip(10.6).addScaledVector(side, -0.9), W(P, -9, 10, -3), 1, UP.clone(), fwd.clone(), 0.8);
  // soles pressed on the near face of the pole, one above the other, knees out round it
  P.foot[0] = contact(atY.clone().addScaledVector(UP, 3.4).addScaledVector(side, 1.1).addScaledVector(fwd, -r - 1.5), W(P, 8, 6, 4), 1, UP.clone(), fwd.clone(), 0.85);
  P.foot[1] = contact(atY.clone().addScaledVector(UP, 5.4).addScaledVector(side, -1.1).addScaledVector(fwd, -r - 1.5), W(P, -8, 7, 4), 1, UP.clone(), fwd.clone(), 0.85);
  // cheek to the pole: the head turned aside (a big head facing the pole would be ON it), eyes down the slide
  P.look.copy(fwd.clone().applyAxisAngle(UP, 1.05).addScaledVector(UP, -0.55 * slide - 0.15).normalize()); P.lookW = 1;
  return P;
}

// ============================== THE SAMPLER → POSE ==========================================================

export type PoseCtx = { t: number; prof: MotionProfile; benchH?: number; entryHeading?: THREE.Vector3 | null };

/** the pose a node's arrival action holds */
export function actionPose(node: TNode, action: string, heading: THREE.Vector3, ctx: PoseCtx): BodyPose {
  const pos = tv(node.at);
  const q = yawQ(heading);
  switch (action) {
    case "sit": return sitPose(pos, q, ctx.t, ctx.prof);
    case "perch": return perchPose(pos, q, ctx.t, ctx.prof, node.branch);
    case "sleep": case "lie": return sleepPose(pos, q, ctx.t, ctx.prof);
    case "work-standing": return workStandPose(pos, q, ctx.t, ctx.prof, node.work?.surfaceY ?? 13);
    case "hang": return hangPose(node.at, heading, node.out, ctx.t, ctx.prof, 1);
    case "lean": return leanPose(pos, q, ctx.t, ctx.prof);
    case "work-seated": return workSeatedPose(pos, q, ctx.t, ctx.prof, node.work?.seatY ?? 12, node.work?.surfaceY ?? 18);
    default: return standPose(pos, q, ctx.t, ctx.prof);
  }
}

/** ONE-ARM HANG from a bar: the gripping arm straight up, the whole body ROLLED ~45° away from it so the big
 *  head clears the arm (a chibi head is wider than the arm is long — hung square, the arm would pass through
 *  it), the free arm loose, legs dangling, swinging gently as a pendulum about the grip. `gripAt` is the bar;
 *  the body hangs on the `out` side of it (away from the structure). */
function hangPose(gripAt: V3, heading: THREE.Vector3, outV: V3 | undefined, t: number, prof: MotionProfile, settle: number): BodyPose {
  const P = newPose();
  const grip = tv(gripAt);
  const fwd = heading.clone().setY(0).normalize();
  const left = new THREE.Vector3().crossVectors(UP, fwd).normalize();
  const out = outV ? tv(outV).setY(0).normalize() : left.clone();
  // body to the LEFT of the bar → the right hand grips (index 1), and vice versa
  const gi = out.dot(left) > 0 ? 1 : 0;
  const sgn = gi === 1 ? 1 : -1; // +1: gripping with the right hand (model −x side)
  const sw = Math.sin(t * 1.45 + prof.stridePhase * 5) * settle;
  // the roll: rotate about the facing axis so the gripping shoulder rises and the head swings away from it
  const roll = sgn * (0.78 + 0.05 * sw);
  const q = yawQ(fwd).premultiply(new THREE.Quaternion().setFromAxisAngle(fwd, roll));
  // pendulum about the grip: a small swing in the facing direction
  const swingQ = new THREE.Quaternion().setFromAxisAngle(left, 0.12 * sw);
  q.premultiply(swingQ);
  P.q.copy(q);
  // place the body so the gripping shoulder hangs straight under the grip, arm's length below
  const shoulderLocal = new THREE.Vector3(-sgn * 3.4, 15.6, -0.6);
  const shoulderAt = grip.clone().addScaledVector(UP, -9.4).applyAxisAngle(UP, 0);
  const shoulderOffset = shoulderLocal.clone().applyQuaternion(q);
  P.pos.copy(shoulderAt).sub(shoulderOffset);
  P.hips.set(0, 0.4, 0);
  P.pelvis.set(-0.08 + 0.08 * sw, 0, 0);
  P.spine.set(0.04, 0, -sgn * 0.1);
  P.neck.set(0.1, sgn * 0.35, -sgn * 0.25);
  P.hand[gi] = contact(grip.clone().addScaledVector(UP, -1.0), W(P, -sgn * 10, 20, -2), 1, fwd.clone(), out.clone().negate(), 1);
  P.arm[1 - gi] = fk(0.2 - 0.25 * sw, 0.5, 0.55, 0.3);
  P.leg[0] = fk(-0.1 + 0.3 * sw, 0.1, 0.4, 0.2);
  P.leg[1] = fk(0.05 - 0.25 * sw, 0.1, 0.6, 0.2);
  P.look.copy(fwd.clone().addScaledVector(UP, -0.2).addScaledVector(out, 0.35).normalize()); P.lookW = 0.8;
  return P;
}

/** how long settling INTO each arrival action takes (seconds, before tempo) */
const SETTLE: Readonly<Record<string, number>> = { sit: 0.9, perch: 0.55, sleep: 1.7, lie: 1.7, "work-standing": 0.6, "work-seated": 0.9, handoff: 0.3, stand: 0, hang: 0 };

/** THE POSE AT TIME t for a plan and its sample. Everything a MonkeyAgent's body shows comes from here. */
export function poseAt(plan: Plan, s: MotionSample, ctx: PoseCtx): BodyPose {
  const t = ctx.t, prof = ctx.prof;
  if (s.kind === "still") {
    const node = s.since >= 0 ? plan.end : plan.start;
    const heading = tv(s.heading);
    const action = s.since >= 0 ? plan.action : (plan.start.action ?? "stand");
    const P = actionPose(node, action, heading, ctx);
    const settle = (SETTLE[action] ?? 0) * prof.tempo;
    if (s.since >= 0 && settle > 0 && s.since < settle && plan.segs.at(-1)?.kind !== "hang-in") {
      return blendPose(standPose(tv(node.at), yawQ(heading), t, prof), P, smooth(s.since / settle));
    }
    return P;
  }
  const seg = s.seg!;
  const g = seg.link.geom;
  const from = seg.from, to = seg.to;
  const fromHeading = (ctx.entryHeading ?? tv(s.heading)).clone();
  /** what the body was doing as this segment began: the start node's action if the plan began here, else a
   *  stand (an intermediate node is passed through, not used) */
  const entryPose = (): BodyPose => (seg.prev.kind === "still" ? actionPose(from, from.action ?? "stand", fromHeading, ctx) : standPose(tv(from.at), yawQ(fromHeading), t, prof));
  switch (seg.kind) {
    case "run": {
      const R = seg.run!;
      const gp = gaitPose(seg, R.gait, s.s, s.gaitS, s.speed, prof);
      // in from a stand at the start, out to a stand at the end: the drop to (and rise from) all fours
      const bt = Math.min(R.gait === "knuckle" ? 0.5 : 0.32, seg.dur / 2.2);
      const wIn = smooth(s.local / bt), wOut = smooth((seg.dur - s.local) / bt);
      const here = routeAt(seg, s.s);
      if (wIn < 1) {
        const startStill = seg.prev.kind === "still" ? actionPose(from, from.action ?? "stand", fromHeading, ctx) : standPose(here.p, yawQ(here.t), t, prof);
        // the start pose rides along with the root so nothing is left behind as the body sets off
        return blendPose(startStill, gp, wIn);
      }
      if (wOut < 1) return blendPose(standPose(here.p, yawQ(here.t), t, prof), gp, wOut);
      return gp;
    }
    case "climb": case "ladder": {
      const C = climbGeom(g);
      const ph = seg.phases!;
      const up = seg.dir > 0;
      const ledge = g.kind === "ladder" ? g.topLedge : g.kind === "climb" ? g.topLedge : undefined;
      // body heights at the bottom of the climb and where it stops under the ledge (chest at deck height)
      const hb0 = 1.8;
      const hb1 = ledge ? (tv(ledge.edge).sub(C.bottom).dot(C.axis)) - 12.5 : C.length - 12;
      const groundNode = up ? from : to, topNode = up ? to : from;
      const lt = s.local;
      // the time-ordered phases as the body experiences them
      const a = ph.a, m = ph.m;
      if (up) {
        if (lt < a) {
          const u = lt / a;
          return blendPose(entryPose(), climbPose(C, hb0, false), smooth(u));
        }
        if (lt < a + m) return climbPose(C, hb0 + (hb1 - hb0) * ((lt - a) / m), false);
        const u = (lt - a - m) / ph.b;
        const last = climbPose(C, hb1, false);
        return ledge ? mantlePose(last, ledge, tv(topNode.at), u, t, prof) : blendPose(last, standPose(tv(topNode.at), yawQ(C.out.clone().negate()), t, prof), smooth(u));
      }
      // DOWN: the mantle played backwards (turn your back to the drop, lower onto the structure), then climb
      // down, then step off at the foot
      if (lt < a) {
        const u = 1 - lt / a;
        const last = climbPose(C, hb1, true);
        if (!ledge) return blendPose(last, entryPose(), smooth(u));
        const p = mantlePose(last, ledge, tv(topNode.at), u, t, prof);
        // the first instant must match how the body arrived (its heading), not the mantle's end facing
        if (u > 0.85) return blendPose(p, entryPose(), smooth((u - 0.85) / 0.15));
        return p;
      }
      if (lt < a + m) return climbPose(C, hb1 + (hb0 - hb1) * ((lt - a) / m), true);
      const u = (lt - a - m) / ph.b;
      return blendPose(climbPose(C, hb0, true), standPose(tv(groundNode.at), yawQ(C.out), t, prof), smooth(u));
    }
    case "pole": {
      if (g.kind !== "pole") break;
      const ph = seg.phases!;
      const top = tv(g.top), bottom = tv(g.bottom), ledge = g.ledge;
      const outward = tv(ledge.inward).negate().setY(0).normalize();
      // the hug faces the pole from the platform side, turned a little round it
      // the hug is on the pole's OUTSIDE, facing back at the platform — the body never overlaps the deck
      const hugFacing = tv(ledge.inward).setY(0).normalize();
      const yTop = tv(ledge.edge).y - 10.5, yBot = bottom.y + 0.5;
      const lt = s.local;
      if (lt < ph.a) {
        const u = lt / ph.a;
        const stand = entryPose();
        // REACH: the leading hand to the pole at chest height, weight forward
        const reach = standPose(tv(from.at), yawQ(outward), t, prof);
        reach.spine.x += 0.25;
        const pp = top.clone().setY(tv(from.at).y + 12.5);
        reach.hand[1] = contact(pp.clone().addScaledVector(outward, -g.radius - 0.8), W(reach, -9, 12, -2), 1, UP.clone(), outward.clone(), 0.8);
        reach.look.copy(outward.clone().addScaledVector(UP, -0.3).normalize());
        const hug = poleHug(top, bottom, g.radius, hugFacing, yTop, 0);
        if (u < 0.45) return blendPose(stand, reach, smooth(u / 0.45));
        return blendPose(reach, hug, smooth((u - 0.45) / 0.55));
      }
      if (lt < ph.a + ph.m) {
        // slide: friction-limited fall, braking over the last fifth
        const k = (lt - ph.a) / ph.m;
        const prog = k < 0.8 ? 0.8 * (k / 0.8) ** 2 * 0.85 / 0.8 : 0.85 + 0.15 * smooth((k - 0.8) / 0.2);
        return poleHug(top, bottom, g.radius, hugFacing, yTop + (yBot - yTop) * Math.min(1, prog), k);
      }
      const u = (lt - ph.a - ph.m) / ph.b;
      const hug = poleHug(top, bottom, g.radius, hugFacing, yBot, 1);
      const landQ = yawQ(hugFacing);
      const land = perchPose(tv(to.at), landQ, t, prof);
      const stand = standPose(tv(to.at), landQ, t, prof);
      if (u < 0.5) return blendPose(hug, land, smooth(u / 0.5));
      return blendPose(land, stand, smooth((u - 0.5) / 0.5));
    }
    case "jump": {
      if (g.kind !== "jump") break;
      const ph = seg.phases!;
      const A = tv(from.at), B = tv(to.at);
      const dir = B.clone().sub(A).setY(0).normalize();
      const q = yawQ(dir);
      const lt = s.local;
      const crouch = (at: THREE.Vector3, depth: number) => {
        const P = perchPose(at, q, t, prof);
        P.hips.y = -depth; P.spine.x = 0.7;
        P.arm[0] = fk(-0.6, 0.4, 0.5, 0); P.arm[1] = fk(-0.6, 0.4, 0.5, 0);
        P.hand = [null, null];
        P.look.copy(B.clone().sub(at).normalize()); P.lookW = 1;
        return P;
      };
      if (lt < ph.a) {
        const u = lt / ph.a;
        const start = entryPose();
        // turn to the target while sinking into the crouch, arms swinging back
        return blendPose(start, crouch(A, 4.6), smooth(u));
      }
      if (lt < ph.a + ph.m) {
        const k = (lt - ph.a) / ph.m;
        const hi = Math.max(A.y, B.y) + g.apex;
        const tUp = Math.sqrt((2 * (hi - A.y)) / GRAVITY), tDn = Math.sqrt((2 * (hi - B.y)) / GRAVITY);
        const tt = k * (tUp + tDn);
        const y = tt < tUp ? A.y + GRAVITY * tUp * tt - 0.5 * GRAVITY * tt * tt : hi - 0.5 * GRAVITY * (tt - tUp) ** 2;
        const pos = A.clone().lerp(B, k).setY(y);
        // FLIGHT: extend off the ground, tuck through the apex, reach the hands and feet out for the landing
        const air = newPose();
        air.pos.copy(pos); air.q.copy(q);
        air.hips.set(0, -1.2, 0);
        air.pelvis.set(0.25, 0, 0); air.spine.set(0.45 + 0.25 * Math.sin(Math.PI * k), 0, 0);
        const tuck = Math.sin(Math.PI * Math.min(1, k * 1.15));
        air.leg[0] = fk(0.3 + 0.9 * tuck, 0.2, 0.4 + 1.2 * tuck, -0.3); air.leg[1] = fk(0.4 + 0.9 * tuck, 0.2, 0.5 + 1.2 * tuck, -0.3);
        air.arm[0] = fk(0.4 + 0.9 * k, 0.45, 0.6, 0.2); air.arm[1] = fk(0.4 + 0.9 * k, 0.45, 0.6, 0.2);
        air.look.copy(B.clone().sub(pos).normalize().lerp(dir, 0.4).normalize()); air.lookW = 1;
        if (k < 0.12) return blendPose(crouch(A, 4.6), air, smooth(k / 0.12));
        return air;
      }
      const u = (lt - ph.a - ph.m) / ph.b;
      // LANDING: all fours, knees absorbing, then up
      const land = perchPose(B, q, t, prof);
      land.hips.y = -5.2 + 2.4 * smooth(u * 1.6);
      land.hand[0] = contact(W(land, 3.4, HAND_L, 6.2), W(land, 7, 10, -5), 1, UP.clone().negate(), Wd(land, 0, 0, -1));
      land.hand[1] = contact(W(land, -3.4, HAND_L, 6.2), W(land, -7, 10, -5), 1, UP.clone().negate(), Wd(land, 0, 0, -1));
      const stand = standPose(B, q, t, prof);
      if (u < 0.55) return land;
      return blendPose(land, stand, smooth((u - 0.55) / 0.45));
    }
    case "hang-in": case "hang-out": {
      if (g.kind !== "hang") break;
      const inn = seg.kind === "hang-in";
      const ledgeNode = inn ? from : to, hangNode = inn ? to : from;
      const u = inn ? s.local / seg.dur : 1 - s.local / seg.dur;
      const out = tv(g.out).normalize();
      const fwdHang = tv(g.along).normalize();
      const hang = hangPose(hangNode.at, fwdHang, hangNode.out ?? g.out, t, prof, Math.max(0, Math.min(1, u * 2 - 1)));
      // the step from the ledge: stand at the edge, reach the bar beside the head, swing off
      const reachQ = yawQ(fwdHang);
      const stand = inn ? entryPose() : standPose(tv(ledgeNode.at), reachQ, t, prof);
      const reach = standPose(tv(ledgeNode.at), reachQ, t, prof);
      const gi = out.dot(new THREE.Vector3().crossVectors(UP, fwdHang)) > 0 ? 1 : 0;
      reach.hand[gi] = contact(tv(g.grip).addScaledVector(UP, -1.2), W(reach, gi ? -10 : 10, 20, -3), 1, fwdHang.clone(), UP.clone(), 1);
      reach.spine.z = 0.12;
      reach.look.copy(out.clone().addScaledVector(UP, -0.4).normalize());
      // swing: the body leaves the deck sideways, out over the drop
      const swing = hangPose(hangNode.at, fwdHang, hangNode.out ?? g.out, t, prof, 0);
      swing.pos.addScaledVector(UP, 4).addScaledVector(out, -3);
      swing.leg[0] = fk(0.8, 0.3, 1.1, 0); swing.leg[1] = fk(0.6, 0.3, 1.3, 0);
      if (u < 0.3) return blendPose(stand, reach, smooth(u / 0.3));
      if (u < 0.65) return blendPose(reach, swing, smooth((u - 0.3) / 0.35));
      return blendPose(swing, hang, smooth((u - 0.65) / 0.35));
    }
    case "drop": {
      const ph = seg.phases!;
      const hangNode = from;
      const lt = s.local;
      const heading = fromHeading;
      const hang = hangPose(hangNode.at, heading, hangNode.out, t, prof, 1);
      const B = tv(to.at);
      if (lt < ph.m) {
        const k = lt / ph.m;
        const P = hang;
        // let go: the grip opens and the body falls straight down from where it hung
        P.hand = [lerpContact(P.hand[0], null, smooth(k * 3)), lerpContact(P.hand[1], null, smooth(k * 3))];
        P.pos.y = P.pos.y - 0.5 * GRAVITY * lt * lt;
        P.pos.lerp(B.clone().setY(P.pos.y), smooth(k));
        P.leg[0] = fk(0.4 * k, 0.25, 0.4 + 0.6 * k, 0); P.leg[1] = fk(0.4 * k, 0.25, 0.4 + 0.6 * k, 0);
        P.arm[0] = fk(0.6, 0.6, 0.5, 0); P.arm[1] = fk(0.6, 0.6, 0.5, 0);
        return P;
      }
      const u = (lt - ph.m) / ph.b;
      const q = yawQ(heading);
      const land = perchPose(B, q, t, prof);
      land.hips.y = -5.4 + 2.6 * smooth(u * 1.6);
      return u < 0.55 ? land : blendPose(land, standPose(B, q, t, prof), smooth((u - 0.55) / 0.45));
    }
  }
  return standPose(tv(s.pos), yawQ(tv(s.heading)), t, prof);
}

// ============================== APPLYING A POSE TO THE RIG ==================================================

const SPINE_SHARE: readonly ["Spine02" | "Spine01" | "Spine", number][] = [["Spine02", 0.3], ["Spine01", 0.35], ["Spine", 0.35]];
const e3 = (v: THREE.Vector3, k = 1) => qmul(qy(v.y * k), qx(v.x * k), qz(v.z * k));
const LIMB_OF: readonly [Limb, Limb, Limb, Limb] = ["armL", "armR", "legL", "legR"];

/** WRITE A BODYPOSE: root placement, FK body, IK contacts, end orientation, head aim — in that order. */
export function applyBodyPose(root: THREE.Object3D, rig: MonkeyRig, P: BodyPose): void {
  root.position.copy(P.pos);
  root.quaternion.copy(P.q);
  root.updateMatrixWorld(true);
  if (P.w <= 0.001) return;
  const rot: Record<string, THREE.Quaternion> = {};
  rot.Hips = e3(P.pelvis);
  for (const [j, k] of SPINE_SHARE) rot[j] = e3(P.spine, k);
  rot.neck = e3(P.neck, 0.4);
  rot.Head = e3(P.neck, 0.6);
  // arms: lower from the T-pose by (π/2 − out), then swing forward, then bend the elbow, then curl the wrist
  const [aL, aR] = P.arm;
  rot.LeftArm = qmul(qx(-aL.swing), qz(-(Math.PI / 2 - aL.out)));
  rot.RightArm = qmul(qx(-aR.swing), qz(Math.PI / 2 - aR.out));
  rot.LeftForeArm = qy(-aL.bend);
  rot.RightForeArm = qy(aR.bend);
  rot.LeftHand = qz(-aL.end);
  rot.RightHand = qz(aR.end);
  // legs: swing forward, splay out, knee folds back, ankle pitch
  const [lL, lR] = P.leg;
  rot.LeftUpLeg = qmul(qx(-lL.swing), qz(lL.out));
  rot.RightUpLeg = qmul(qx(-lR.swing), qz(-lR.out));
  rot.LeftLeg = qx(lL.bend);
  rot.RightLeg = qx(lR.bend);
  rot.LeftFoot = qx(lL.end);
  rot.RightFoot = qx(lR.end);
  rig.applyPose({ rot, hips: P.hips }, P.w);
  const contacts = [P.hand[0], P.hand[1], P.foot[0], P.foot[1]];
  const ends = ["LeftHand", "RightHand", "LeftFoot", "RightFoot"] as const;
  for (let i = 0; i < 4; i++) {
    const c = contacts[i];
    if (!c) continue;
    if (c.w > 0.001) rig.solveLimb(LIMB_OF[i], c.p, c.pole, c.w * P.w);
    if (c.fwd && c.down && c.ow > 0.001) rig.orientEnd(ends[i], c.fwd, c.down, Math.min(1, c.ow * P.w));
  }
  if (P.lookW > 0.001) rig.aimHead(P.look, P.lookW * P.w);
}
