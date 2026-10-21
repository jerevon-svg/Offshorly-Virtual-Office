// vo3d world — S7: LIFTING THE SCOOTER BACK UP. Pure and deterministic, like world/accidentMotion: the accident's
// plan (where and how the scooter came to rest — the same in every browser), where the rider pressed E (the
// server's `liftFrom`) and the time since the server's `liftAt` give one frame of the lift for everybody.
//
//   STEP    the rider steps to the scooter's TOP side (where its bar lies), beside the bar, and turns to face it
//   CROUCH  knees and hips bend, the back rounds, the head looks down, the hands reach down to the bar
//   PULL    they straighten, leaning back a little, and the scooter rolls back up onto its wheels about the
//           line it lies on; the hands rise with the bar
//   SETTLE  arms down, the body its own again — and the scooter stands there, ready to ride (UPRIGHT)
//
// The rider is played on the skeleton by avatar/crashPose (the same channels as the crash), feet planted from
// the end of the step: the hips move over the feet, never the feet over the ground. The backend times its
// LIFTING → UPRIGHT step by the same numbers (app/services/scooter_accidents.py LIFT_UPRIGHT_S / LIFT_DONE_S).
import * as THREE from "three";
import { CRASH, LIMB, scooterPoseAt, type AccidentMotionInput, type AccidentPlan } from "./accidentMotion";
import { SCOOTER_GEOMETRY } from "./scooters";

export const LIFT = {
  STEP: 0.35,
  CROUCH: 0.45,
  PULL: 0.75,
  SETTLE: 0.3,
  /** the scooter is fully upright here (STEP + CROUCH + PULL) */
  UPRIGHT: 1.55,
  TOTAL: 1.85,
  /** E is offered this close to the scooter (the server allows a little more) */
  RANGE: 55,
  /** the rider stands this far out from the scooter's ground line on its top side */
  STAND_OFF: 13,
  /** the crouch: how low the hips go */
  CROUCH_HIP: 5.2,
} as const;

export interface LiftPlan {
  /** the scooter lying, as the crash left it (origin, yaw, lean) */
  restX: number; restZ: number; restY: number; yaw: number; lean: number;
  /** where the rider stands to lift it, the way they face, and the ride heading once it is up */
  spotX: number; spotZ: number; riderYaw: number; heading: number;
  /** where the rider was when they pressed E */
  fromX: number; fromZ: number;
}

/** THE PLAN — from the crash's own resting pose, so every browser lifts the same scooter from the same spot */
export function liftPlan(a: AccidentMotionInput, plan: AccidentPlan, from: { x: number; z: number }): LiftPlan {
  const rest = scooterPoseAt(a, plan, plan.scooter.end + plan.scooter.tipEnd + 10);
  // its top (the bar) lies this way: local +y, rolled by the lean, turned by the yaw
  const sl = Math.sin(rest.lean);
  const tx = sl * Math.cos(rest.yaw), tz = -sl * Math.sin(rest.yaw);
  const tl = Math.hypot(tx, tz) || 1;
  // its nose (local −z): beside the bar, which is a little forward of the deck's middle
  const fx = -Math.sin(rest.yaw), fz = -Math.cos(rest.yaw), bar = -SCOOTER_GEOMETRY.bar.z;
  const spotX = rest.x + (tx / tl) * LIFT.STAND_OFF + fx * bar, spotZ = rest.z + (tz / tl) * LIFT.STAND_OFF + fz * bar;
  return {
    restX: rest.x, restZ: rest.z, restY: rest.y, yaw: rest.yaw, lean: rest.lean,
    spotX, spotZ, riderYaw: Math.atan2(-tx, -tz), heading: -rest.yaw,
    fromX: from.x, fromZ: from.z,
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (u: number) => { const k = clamp01(u); return k * k * (3 - 2 * k); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export interface ScooterLiftPose { x: number; z: number; y: number; yaw: number; lean: number; pitch: number; upright: boolean }

/** THE SCOOTER at `t` after E: lying, then rolled up about the line it lies on, then standing */
export function liftScooterAt(p: LiftPlan, t: number): ScooterLiftPose {
  const start = LIFT.STEP + LIFT.CROUCH;
  const u = smooth((t - start) / LIFT.PULL);
  // the shortest way back to upright from its resting roll (a heavy crash's barrel roll is whole turns)
  const from = Math.atan2(Math.sin(p.lean), Math.cos(p.lean));
  const lean = from * (1 - u);
  // its side rests on the road lying; its wheels once up
  return { x: p.restX, z: p.restZ, y: p.restY * Math.abs(Math.sin(lean)), yaw: p.yaw, lean, pitch: 0, upright: t >= LIFT.UPRIGHT };
}

export interface RiderLiftFrame {
  x: number; z: number; y: number;
  q: THREE.Quaternion;
  contact: number; anchor: number; weight: number;
  limbs: number[];
  /** the soles stay flat (the squat bends the ankles) */
  footLevel: number;
  done: boolean;
}
const UP = new THREE.Vector3(0, 1, 0), _qa = new THREE.Quaternion(), _ax = new THREE.Vector3();

/** THE RIDER at `t` after E (hips world x/z, y above the ground) */
export function riderLiftAt(p: LiftPlan, t: number, out?: RiderLiftFrame): RiderLiftFrame {
  const f = out ?? { x: 0, z: 0, y: 0, q: new THREE.Quaternion(), contact: 1, anchor: 0, weight: 1, limbs: new Array(LIMB.COUNT).fill(0), footLevel: 1, done: false };
  const tc = LIFT.STEP, tp = tc + LIFT.CROUCH, ts = tp + LIFT.PULL;
  // the step in, turning to face the scooter on the way
  const step = smooth(t / LIFT.STEP);
  f.x = lerp(p.fromX, p.spotX, step); f.z = lerp(p.fromZ, p.spotZ, step);
  const startYaw = Math.atan2(p.spotX - p.fromX, p.spotZ - p.fromZ);
  const moved = Math.hypot(p.spotX - p.fromX, p.spotZ - p.fromZ) > 2;
  const yaw0 = moved ? startYaw : p.riderYaw;
  const dy = Math.atan2(Math.sin(p.riderYaw - yaw0), Math.cos(p.riderYaw - yaw0));
  const yaw = yaw0 + dy * step;
  // down into the crouch, then up with the scooter
  const down = smooth((t - tc) / LIFT.CROUCH), up = smooth((t - tp) / LIFT.PULL), rest = smooth((t - ts) / LIFT.SETTLE);
  const crouch = down * (1 - up);
  f.y = lerp(CRASH.HIP, LIFT.CROUCH_HIP, crouch);
  // a little forward over the scooter crouching, a little back pulling it up
  const pitch = 0.28 * crouch - 0.12 * Math.sin(Math.PI * up) * (1 - rest);
  _ax.set(Math.cos(yaw), 0, -Math.sin(yaw));
  f.q.setFromAxisAngle(_ax, pitch).multiply(_qa.setFromAxisAngle(UP, yaw));
  const L = f.limbs;
  L.fill(0);
  // the hands: down to the bar, then up with it (at chest height, in front, as it stands), then down
  const reach = down * (1 - rest);
  const armFlex = lerp(0.95, 1.3, up) * reach, elbow = lerp(0.3, 0.7, up) * reach;
  for (const o of [LIMB.ARM_L, LIMB.ARM_R]) { L[o] = armFlex; L[o + 1] = 0.15 * reach; L[o + 2] = elbow; }
  L[LIMB.SPINE] = 0.75 * crouch + 0.1 * up * (1 - rest);
  L[LIMB.NECK] = -0.35 * crouch;
  for (const o of [LIMB.LEG_L, LIMB.LEG_R]) { L[o] = 1.05 * crouch; L[o + 2] = 1.6 * crouch; }
  // a walker's arms swing a touch on the step in
  const sw = Math.sin(Math.PI * step) * (moved ? 0.25 : 0);
  L[LIMB.ARM_L] += sw; L[LIMB.ARM_R] -= sw;
  f.contact = 1;
  // feet planted once they are there, handed back as the lift lets go of the body
  f.anchor = smooth((t - tc) / 0.05) * (1 - rest);
  f.weight = 1 - rest;
  f.footLevel = 1;
  f.done = t >= LIFT.TOTAL;
  return f;
}
