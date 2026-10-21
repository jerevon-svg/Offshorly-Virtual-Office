// vo3d world — S6: AN ACCIDENT, AS EVERYBODY SEES IT. Pure and deterministic: one confirmed accident (the server's
// S5 event — where, when, both bodies' velocities and the contact normal), an optional REACH (how far the throw
// may go before it would meet something solid) and a moment give the rider's whole crash and the scooter's.
// Every browser computes the same frame from the same numbers and the shared clock; somebody arriving half-way
// through simply starts at the right moment. The backend mirrors the PLAN (app/services/scooter_accidents.py
// accident_plan: the throw directions, where the scooter comes to rest, how long it all lasts), so S7's "lift it"
// happens where everybody sees it lying and the server's cleanup never cuts a crash short.
//
// THE IMPACT (physics-inspired, not a physics engine). The car is far heavier than scooter and rider: in its
// frame the scooter's velocity along the contact normal bounces back with RESTITUTION and keeps most of its
// sliding (tangential) part. The SCOOTER, which is what the car hits, leaves with that velocity; the RIDER,
// standing on it, leaves with a blend of their own momentum and the scooter's (RIDER_CARRY). So:
//   rear    (the car comes from behind) — shoved forward along their own heading, a dive onto the front
//   frontal (they ride into the car)    — their momentum is stopped and turned along the car's side; they go
//                                          over backwards, onto their back
//   side    (T-boned)                   — knocked sideways off the deck, a twisting fall
// How hard (SEVERITY, 0..1, from the closing and the total relative speed) sets everything else on smooth
// curves: launch speed and height, the airborne time, a bounce and a roll for heavy hits, the skid's length,
// how long they lie. Horizontal momentum dominates; the vertical launch is a low hop at most.
//
// THE RIDER: air → (bounce + roll, heavy only) → skid with friction → a moment lying → getting up (push-up and
// kneel from the front; sit-up and crouch from the back). Not a plank: the body turns about its HIPS, and the
// spine, neck, arms and legs are posed on a keyframed, Catmull-Rom-smoothed track with secondary motion (flailing
// in the air, a damped follow-through at each touchdown) — avatar/crashPose plays it on the real skeleton and
// keeps the body ON the ground (its lowest vertices) and the feet planted while it gets up.
//
// THE SCOOTER, separately: thrown on its own line (never the rider's), it loses balance — tipping about its
// centre of mass, nose dipping in a frontal hit, a barrel roll in a heavy one — hops and bounces when hit hard,
// spins as it goes, and slides on its side to rest under constant friction.

import * as THREE from "three";

/** the rider's crash; world units and seconds */
export const CRASH = {
  /** stylised gravity (a little stronger than the world's real scale, for snap) */
  G: 420,
  /** standing hips height above the feet (the HumanBase body's, measured), and the deck under the rider's feet */
  HIP: 8.5,
  DECK: 3,
  /** the hips' height lying flat (avatar/crashPose puts the body exactly on the ground; this is the plan's guess) */
  LIE_HIP: 4,
  /** hips → feet, lying: where the rider gets up; the hips' height kneeling or sitting, half way up */
  LEG: 7,
  KNEEL: 5.5,
  /** severity: the impact speed (0.6·closing + 0.4·|relative velocity|) that is a light (0) and a heavy (1) crash */
  LIGHT: 110,
  HEAVY: 380,
  RESTITUTION: 0.3,
  TANGENT_KEEP: 0.8,
  RIDER_CARRY: 0.7,
  /** the rider's launch speed: never below this share of the impact speed, clamped */
  MIN_SHARE: 0.5,
  MIN_SPEED: 60,
  MAX_SPEED: 260,
  /** the vertical launch, light → heavy */
  HOP: [10, 95] as const,
  /** horizontal speed kept through the first touchdown (without / with a bounce) and through the bounce */
  LAND_KEEP: 0.62,
  LAND_KEEP_BOUNCE: 0.78,
  BOUNCE_KEEP: 0.8,
  /** the bounce: from this severity, this share of the touchdown's vertical speed */
  BOUNCE_FROM: 0.4,
  BOUNCE: 0.28,
  /** the roll over the shoulders during a heavy bounce */
  ROLL_FROM: 0.55,
  SKID_DECEL: 300,
  /** the whole throw never goes farther than this */
  MAX_TRAVEL: 240,
  /** at least this much of the throw is away from the car (along the contact normal) */
  MIN_AWAY: 0.3,
  LIE: [0.7, 1.15] as const,
  RISE: 1.4,
  /** the last part of getting up blends the crash pose back into the body's own */
  BLEND_OUT: 0.25,
} as const;

/** the scooter's crash */
export const SCOOTER_CRASH = {
  /** its centre of mass above the ground standing, and lying on its side */
  COM: 7,
  LIE_COM: 3,
  MIN_SHARE: 0.45,
  MIN_SPEED: 40,
  MAX_SPEED: 280,
  HOP: [0, 80] as const,
  LAND_KEEP: 0.75,
  BOUNCE_KEEP: 0.8,
  BOUNCE_FROM: 0.3,
  BOUNCE: 0.35,
  ROLL_FROM: 0.6,
  SLIDE_DECEL: 420,
  MAX_TRAVEL: 260,
  MIN_AWAY: 0.15,
  /** it is on its side by this long at the earliest (a tip-over takes a moment even when it is barely thrown) */
  TIP: 0.32,
  /** never thrown along the rider's line: at least this far apart, radians */
  SEPARATION: 0.35,
  SPIN: [0.5, 3] as const,
} as const;

/** how far each throw may go, and turned by how much, before it would meet something solid (chooseReach): the
 *  rider's browser works it out, the server records it, everybody plays it */
export interface Reach { k: number; turn: number }
export interface AccidentReach { rider: Reach; scooter: Reach }
export const FULL_REACH: AccidentReach = { rider: { k: 1, turn: 0 }, scooter: { k: 1, turn: 0 } };
/** the turns a blocked throw may try, in order (radians; the server accepts only these) */
export const REACH_TURNS = [0, 0.3, -0.3, 0.6, -0.6] as const;
/** a turned throw still leaves the car at least this much */
export const REACH_MIN_AWAY = 0.12;

/** the S5 accident, as far as the motion needs it (server wire fields) */
export interface AccidentMotionInput {
  at: number; x: number; z: number;
  /** the scooter's ride heading (moving along (sin h, −cos h)) and speed */
  heading: number; speed: number;
  closing: number;
  /** the car's heading (moving along (cos h, sin h)) and speed */
  carHeading: number; carSpeed: number;
  /** the contact normal, car → scooter */
  nx: number; nz: number;
}
export type ImpactKind = "rear" | "frontal" | "side";

export interface RiderPlan {
  /** the throw: direction (unit), launch speed (after reach), vertical launch */
  dx: number; dz: number; speed: number; vy: number;
  /** phase lengths: air, bounce, skid, lie, rise; and the moments they end */
  T1: number; T2: number; T3: number; T4: number; T5: number;
  tLand: number; tBounce: number; tSkid: number; tLie: number; end: number;
  vy2: number; h1: number; hSkid: number; decel: number; dist1: number; dist2: number; travel: number;
  /** body yaw at the impact, and after the twist; whether a heavy bounce rolls them over */
  psi0: number; psi1: number; roll: 0 | 1; thetaLie: number;
  /** the lying body's turn while it skids (world yaw) */
  spin: number;
  faceUp: boolean;
  /** the hips where they come to rest, where they stand up (their feet), and the way they face up */
  lieX: number; lieZ: number; standX: number; standZ: number; standYaw: number;
  /** which side of the rider the car is on: +1 their left (+x), −1 their right */
  side: 1 | -1;
}
export interface ScooterPlan {
  dx: number; dz: number; speed: number; vy: number;
  T1: number; T2: number; T3: number; vy2: number; h1: number; hSlide: number; decel: number;
  dist1: number; dist2: number; travel: number; end: number; tipEnd: number;
  /** its yaw at the impact (−heading) and how far it spins; the side it falls to; a barrel roll; a nose dip */
  yaw0: number; spin: number; leanSign: 1 | -1; rolls: 0 | 1; pitchKick: number;
  restX: number; restZ: number;
}
export interface AccidentPlan {
  severity: number; kind: ImpactKind;
  nx: number; nz: number;
  rider: RiderPlan; scooter: ScooterPlan;
  /** everything is over (the rider up, the scooter at rest) */
  end: number;
  /** where the scooter rests (the server's restX/restZ) */
  restX: number; restZ: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const smooth = (u: number) => { const k = clamp01(u); return k * k * (3 - 2 * k); };
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const sgn = (v: number, fallback: 1 | -1): 1 | -1 => (v > 1e-9 ? 1 : v < -1e-9 ? -1 : fallback);
const rot = (x: number, z: number, a: number): [number, number] => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
const unit = (x: number, z: number, fx: number, fz: number): [number, number] => { const l = Math.hypot(x, z); return l > 1e-6 ? [x / l, z / l] : [fx, fz]; };

/** keep a throw direction at least `min` away from the car (along `n`), sliding it along the car's side the way
 *  it already leans (or `pref`) — a glancing blow, never back into the car */
function awayFrom(dx: number, dz: number, nx: number, nz: number, min: number, pref: 1 | -1): [number, number] {
  if (dx * nx + dz * nz >= min) return [dx, dz];
  const tx = -nz, tz = nx;
  const s = sgn(dx * tx + dz * tz, pref), t = Math.sqrt(1 - min * min);
  return [nx * min + tx * s * t, nz * min + tz * s * t];
}

/** a ballistic phase: from `drop` above where it lands, launched up at `vy` — how long until it touches */
const airTime = (vy: number, drop: number, G: number) => (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, drop))) / G;

/** THE PLAN — the backend computes the same numbers (scooter_accidents.accident_plan) */
export function accidentPlan(a: AccidentMotionInput, reach: AccidentReach = FULL_REACH): AccidentPlan {
  const C = CRASH, S = SCOOTER_CRASH, G = C.G;
  const fx = Math.sin(a.heading), fz = -Math.cos(a.heading);
  const [nx, nz] = unit(a.nx, a.nz, fx, fz);
  const vsx = fx * a.speed, vsz = fz * a.speed;
  const vcx = Math.cos(a.carHeading) * a.carSpeed, vcz = Math.sin(a.carHeading) * a.carSpeed;
  const rx = vsx - vcx, rz = vsz - vcz;
  const rn = rx * nx + rz * nz, tx = rx - rn * nx, tz = rz - rn * nz;
  const closing = Math.max(0, a.closing);
  const impact = 0.6 * closing + 0.4 * Math.hypot(rx, rz);
  const s = clamp01((impact - C.LIGHT) / (C.HEAVY - C.LIGHT));
  // the car's side, along which a glancing throw goes the way the car was going
  const pref = sgn(vcx * -nz + vcz * nx, 1);
  const cosF = fx * nx + fz * nz;
  const kind: ImpactKind = cosF > 0.5 ? "rear" : cosF < -0.5 ? "frontal" : "side";

  // velocities after the hit: the scooter's (restitution in the car's frame), the rider's (a blend)
  const ax = vcx + C.TANGENT_KEEP * tx + nx * C.RESTITUTION * closing, az = vcz + C.TANGENT_KEEP * tz + nz * C.RESTITUTION * closing;
  const qx = (1 - C.RIDER_CARRY) * vsx + C.RIDER_CARRY * ax, qz = (1 - C.RIDER_CARRY) * vsz + C.RIDER_CARRY * az;

  // ---- the rider's line
  let [rdx, rdz] = awayFrom(...unit(qx, qz, nx, nz), nx, nz, C.MIN_AWAY, pref);
  // ---- the scooter's line: its own, and never the rider's
  let [sdx, sdz] = awayFrom(...unit(ax, az, nx, nz), nx, nz, S.MIN_AWAY, pref);
  const apart = Math.acos(clamp(rdx * sdx + rdz * sdz, -1, 1));
  if (apart < S.SEPARATION) {
    const turn = (S.SEPARATION - apart) * sgn(rdx * sdz - rdz * sdx, pref);
    [sdx, sdz] = rot(sdx, sdz, turn);
    [sdx, sdz] = awayFrom(sdx, sdz, nx, nz, S.MIN_AWAY, pref);
  }
  // ---- what the world allows (chooseReach): a turn, then a shorter throw
  [rdx, rdz] = rot(rdx, rdz, reach.rider.turn);
  [sdx, sdz] = rot(sdx, sdz, reach.scooter.turn);

  // ---- the rider's crash, phase by phase
  const sp = clamp(Math.max(Math.hypot(qx, qz), C.MIN_SHARE * impact), C.MIN_SPEED, C.MAX_SPEED);
  const vy = lerp(C.HOP[0], C.HOP[1], s);
  const T1 = airTime(vy, C.DECK + C.HIP - C.LIE_HIP, G);
  const vImp = G * T1 - vy;
  let vy2 = s > C.BOUNCE_FROM ? C.BOUNCE * vImp * smooth((s - C.BOUNCE_FROM) / (1 - C.BOUNCE_FROM)) : 0;
  if (vy2 < 10) vy2 = 0;
  const T2 = (2 * vy2) / G;
  const h1Raw = sp * (vy2 > 0 ? C.LAND_KEEP_BOUNCE : C.LAND_KEEP);
  const hSRaw = vy2 > 0 ? h1Raw * C.BOUNCE_KEEP : h1Raw;
  const travelRaw = sp * T1 + h1Raw * T2 + (hSRaw * hSRaw) / (2 * C.SKID_DECEL);
  const k = Math.min(1, C.MAX_TRAVEL / travelRaw) * clamp01(reach.rider.k);
  const T3 = hSRaw / C.SKID_DECEL;
  const T4 = lerp(C.LIE[0], C.LIE[1], s), T5 = C.RISE;
  const tLand = T1, tBounce = T1 + T2, tSkid = tBounce + T3, tLie = tSkid + T4, end = tLie + T5;
  const travel = travelRaw * k;
  // the body: facing their ride; twisting in the air to land on the front or the back, whichever is nearer
  const psi0 = Math.atan2(fx, fz);
  const psiD = Math.atan2(rdx, rdz);
  const delta = wrap(psi0 - psiD);
  const front = Math.abs(delta) <= Math.PI / 2;
  const psi1 = psi0 - (front ? delta : delta - Math.sign(delta || 1) * Math.PI);
  const roll: 0 | 1 = s > C.ROLL_FROM && vy2 > 0 ? 1 : 0;
  const thetaLie = Math.PI / 2 + roll * Math.PI;
  const along = Math.abs(rdx * -nz + rdz * nx);
  const spin = pref * lerp(0.15, 1, s) * (0.4 + 0.6 * along);
  const lieX = a.x + rdx * travel, lieZ = a.z + rdz * travel;
  const lie = bodyQuat(rdx, rdz, thetaLie, psi1, spin, _q1);
  const face = _v1.set(0, 0, 1).applyQuaternion(lie);
  const feet = _v2.set(0, -1, 0).applyQuaternion(lie);
  const [ux, uz] = unit(feet.x, feet.z, -rdx, -rdz);
  const up = bodyQuat(rdx, rdz, thetaLie > Math.PI ? 2 * Math.PI : 0, psi1, spin, _q2);
  const standFwd = _v2.set(0, 0, 1).applyQuaternion(up);
  const left = { x: Math.cos(psi0), z: -Math.sin(psi0) };
  const rider: RiderPlan = {
    dx: rdx, dz: rdz, speed: sp * k, vy,
    T1, T2, T3, T4, T5, tLand, tBounce, tSkid, tLie, end,
    vy2, h1: h1Raw * k, hSkid: hSRaw * k, decel: C.SKID_DECEL * k, dist1: sp * k * T1, dist2: h1Raw * k * T2, travel,
    psi0, psi1, roll, thetaLie, spin, faceUp: face.y > 0,
    lieX, lieZ, standX: lieX + ux * C.LEG, standZ: lieZ + uz * C.LEG, standYaw: Math.atan2(standFwd.x, standFwd.z),
    side: sgn(-nx * left.x - nz * left.z, 1),
  };

  // ---- the scooter's
  const spS = clamp(Math.max(Math.hypot(ax, az), S.MIN_SHARE * impact), S.MIN_SPEED, S.MAX_SPEED);
  const vyS = lerp(S.HOP[0], S.HOP[1], s);
  const T1s = airTime(vyS, S.COM - S.LIE_COM, G);
  const vImpS = G * T1s - vyS;
  let vy2s = s > S.BOUNCE_FROM ? S.BOUNCE * vImpS * smooth((s - S.BOUNCE_FROM) / (1 - S.BOUNCE_FROM)) : 0;
  if (vy2s < 8) vy2s = 0;
  const T2s = (2 * vy2s) / G;
  const h1s = spS * S.LAND_KEEP, hSs = vy2s > 0 ? h1s * S.BOUNCE_KEEP : h1s;
  const travelSRaw = spS * T1s + h1s * T2s + (hSs * hSs) / (2 * S.SLIDE_DECEL);
  const kS = Math.min(1, S.MAX_TRAVEL / travelSRaw) * clamp01(reach.scooter.k);
  const T3s = hSs / S.SLIDE_DECEL;
  const travelS = travelSRaw * kS;
  const scooter: ScooterPlan = {
    dx: sdx, dz: sdz, speed: spS * kS, vy: vyS,
    T1: T1s, T2: T2s, T3: T3s, vy2: vy2s, h1: h1s * kS, hSlide: hSs * kS, decel: S.SLIDE_DECEL * kS,
    dist1: spS * kS * T1s, dist2: h1s * kS * T2s, travel: travelS, end: T1s + T2s + T3s, tipEnd: Math.max(T1s + T2s, S.TIP),
    yaw0: -a.heading, spin: pref * lerp(S.SPIN[0], S.SPIN[1], s) * (kind === "side" ? 1 : 0.6),
    // its local +x in the world is (cos h, sin h): it falls toward the side it is thrown to
    leanSign: sgn(sdx * Math.cos(a.heading) + sdz * Math.sin(a.heading), pref),
    rolls: s > S.ROLL_FROM && vy2s > 0 ? 1 : 0,
    pitchKick: kind === "frontal" ? lerp(0.2, 0.9, s) : 0.12 * s,
    restX: a.x + sdx * travelS, restZ: a.z + sdz * travelS,
  };
  return { severity: s, kind, nx, nz, rider, scooter, end: Math.max(end, scooter.end), restX: scooter.restX, restZ: scooter.restZ };
}

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** THE BODY'S ORIENTATION: yawed ψ, tumbled θ about the horizontal axis across the throw (θ > 0 = its top toward
 *  the throw), the whole lying body turned φ about the vertical as it skids */
function bodyQuat(dx: number, dz: number, theta: number, psi: number, phi: number, out: THREE.Quaternion): THREE.Quaternion {
  _axis.set(dz, 0, -dx);
  return out.setFromAxisAngle(UP, phi).multiply(_qa.setFromAxisAngle(_axis, theta)).multiply(_qb.setFromAxisAngle(UP, psi));
}

// ---- the rider's limbs ---------------------------------------------------------------------------------------
/** sixteen channels, radians, laid on the body's own axes by avatar/crashPose (+ = the natural direction):
 *  spine curl (forward) and side bend (toward their left), neck the same, then per arm (left, right) forward
 *  raise, raise out to the side, elbow bend; per leg forward raise, out to the side, knee bend */
export const LIMB = {
  SPINE: 0, SPINE_SIDE: 1, NECK: 2, NECK_SIDE: 3,
  ARM_L: 4, ARM_R: 7, LEG_L: 10, LEG_R: 13,
  COUNT: 16,
} as const;
type Pose = { spine: number; spineSide: number; neck: number; neckSide: number; near: [number, number, number]; far: [number, number, number]; nearLeg: [number, number, number]; farLeg: [number, number, number] };
const P = (spine: number, neck: number, near: [number, number, number], far: [number, number, number], nearLeg: [number, number, number], farLeg: [number, number, number], spineSide = 0, neckSide = 0): Pose =>
  ({ spine, spineSide, neck, neckSide, near, far, nearLeg, farLeg });
const ZERO = P(0, 0, [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]);

function impactPose(kind: ImpactKind): Pose {
  switch (kind) {
    case "rear": return P(-0.35, -0.6, [-0.7, 0.5, 0.3], [-0.6, 0.45, 0.35], [-0.25, 0.1, 0.3], [-0.2, 0.1, 0.35]);
    case "frontal": return P(0.5, 0.25, [1.3, 0.25, 0.35], [1.2, 0.3, 0.4], [0.5, 0.1, 0.7], [0.45, 0.1, 0.65]);
    default: return P(0.1, 0, [0.3, 1.5, 0.6], [0.2, 0.7, 0.4], [0.15, 0.45, 0.4], [0.1, 0.15, 0.35], 0.45, -0.4);
  }
}
const scale = (p: Pose, k: number): Pose => ({ spine: p.spine * k, spineSide: p.spineSide * k, neck: p.neck * k, neckSide: p.neckSide * k,
  near: p.near.map((v) => v * k) as Pose["near"], far: p.far.map((v) => v * k) as Pose["far"], nearLeg: p.nearLeg.map((v) => v * k) as Pose["near"], farLeg: p.farLeg.map((v) => v * k) as Pose["far"] });

/** the keyframes of this crash's body (times in seconds after the impact) — strictly increasing */
function limbKeys(plan: AccidentPlan): { t: number; v: number[] }[] {
  const r = plan.rider, s = plan.severity, up = r.faceUp;
  const keys: [number, Pose][] = [
    [0, ZERO],
    [0.1, scale(impactPose(plan.kind), 0.6 + 0.4 * s)],
    [Math.max(0.18, r.T1 * 0.5), up ? P(-0.2, 0.35, [-0.2, 1.15, 0.6], [-0.15, 1.05, 0.55], [0.45, 0.2, 0.7], [-0.05, 0.2, 0.25]) : P(0.2, 0.35, [0.5, 1.15, 0.6], [0.45, 1.05, 0.55], [0.45, 0.2, 0.7], [-0.05, 0.2, 0.25])],
    [r.T1 - 0.04, up ? P(0.35, 0.5, [-0.4, 1.2, 0.35], [-0.4, 1.2, 0.35], [0.6, 0.15, 0.8], [0.55, 0.15, 0.8]) : P(0.15, -0.35, [1.7, 0.45, 0.45], [1.7, 0.45, 0.45], [0.15, 0.15, 0.35], [0.15, 0.15, 0.35])],
    [r.T1 + (r.T2 > 0 ? 0.05 : 0.12), up ? P(0.2, 0.35, [-0.2, 1.3, 0.3], [-0.2, 1.3, 0.3], [0.35, 0.2, 0.6], [0.35, 0.2, 0.6]) : P(-0.1, -0.3, [1.9, 0.6, 1.0], [1.9, 0.6, 1.0], [0.05, 0.15, 0.5], [0.05, 0.15, 0.5])],
  ];
  if (r.T2 > 0) {
    keys.push([Math.max(r.T1 + 0.13, r.tBounce - 0.02), r.roll ? P(0.7, 0.6, [1.2, 0.4, 1.4], [1.2, 0.4, 1.4], [1.3, 0.1, 1.6], [1.3, 0.1, 1.6]) : P(0.1, 0.2, [1.4, 0.8, 0.6], [1.3, 0.8, 0.6], [0.3, 0.2, 0.5], [0.2, 0.2, 0.4])]);
    keys.push([r.tBounce + 0.14, up ? P(0.2, 0.35, [-0.2, 1.3, 0.3], [-0.2, 1.3, 0.3], [0.35, 0.2, 0.6], [0.35, 0.2, 0.6]) : P(-0.1, -0.3, [1.9, 0.6, 1.0], [1.9, 0.6, 1.0], [0.05, 0.15, 0.5], [0.05, 0.15, 0.5])]);
  }
  const lieT = r.tSkid + 0.35;
  // lying, the body's "forward" is the ground (face-down) or the sky (face-up): limbs that lie flat move OUT TO
  // THE SIDE, in the ground's plane — a face-down knee is drawn up sideways, never pushed into the road
  keys.push([r.tSkid, up ? P(0, 0.3, [0.3, 1.4, 0.4], [0.3, 1.4, 0.4], [0, 0.25, 0.3], [0, 0.25, 0.3]) : P(-0.15, -0.35, [0.3, 1.9, 0.5], [0.3, 1.8, 0.5], [-0.05, 0.2, 0.3], [-0.05, 0.2, 0.3])]);
  const lie = up ? P(0.05, 0.15, [0.1, 1.25, 0.45], [0.1, 1.25, 0.45], [0, 0.2, 0.2], [0.5, 0.2, 0.9]) : P(0, -0.25, [0.3, 2.3, 1.3], [0.1, 0.35, 0.3], [0, 0.1, 0.15], [0.15, 0.55, 1.1]);
  keys.push([lieT, lie], [Math.max(lieT + 0.05, r.tLie), lie]);
  keys.push([r.tLie + 0.45 * r.T5, up ? P(0.45, 0.3, [-0.6, 0.35, 0.2], [-0.6, 0.35, 0.2], [1.6, 0.05, 1.9], [1.2, 0.1, 1.0]) : P(0.3, -0.2, [0.75, 0.25, 0.15], [0.75, 0.25, 0.15], [1.5, 0.05, 1.6], [0.6, 0.05, 1.5])]);
  keys.push([r.end - 0.2, P(0.02, 0, [0.1, 0.05, 0.1], [0.1, 0.05, 0.1], [0, 0, 0], [0, 0, 0])], [r.end, ZERO]);
  // keys crowded together (a short crash squeezes its phases) would snap between poses: a key too close to the
  // one before it is left out, so the track always has room to move
  const out: { t: number; v: number[] }[] = [];
  keys.forEach(([t, p], i) => {
    const last = i === keys.length - 1;
    if (out.length && t < out[out.length - 1].t + 0.08) {
      if (!last) return;
      out[out.length - 1] = { t: Math.max(t, out[out.length - 1].t + 0.08), v: flatten(p, r.side) };
      return;
    }
    out.push({ t, v: flatten(p, r.side) });
  });
  return out;
}

/** near/far → their left/right (the car on their left: the left arm is the near one) */
function flatten(p: Pose, side: 1 | -1): number[] {
  const [L, R] = side === 1 ? [p.near, p.far] : [p.far, p.near];
  const [LL, RL] = side === 1 ? [p.nearLeg, p.farLeg] : [p.farLeg, p.nearLeg];
  // a bend AWAY from the car is toward the far side: their right when the car is on the left
  return [p.spine, -side * p.spineSide, p.neck, side * p.neckSide, ...L, ...R, ...LL, ...RL];
}

/** Catmull-Rom through the keys (finite-difference tangents), so the body moves THROUGH a pose, never stops on it */
function sampleKeys(keys: readonly { t: number; v: number[] }[], t: number, out: number[]): void {
  if (t <= keys[0].t) { for (let c = 0; c < LIMB.COUNT; c++) out[c] = keys[0].v[c]; return; }
  const last = keys[keys.length - 1];
  if (t >= last.t) { for (let c = 0; c < LIMB.COUNT; c++) out[c] = last.v[c]; return; }
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const h = k2.t - k1.t, u = (t - k1.t) / h, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  for (let c = 0; c < LIMB.COUNT; c++) {
    // the first and last keys rest (zero velocity): the crash starts from the ride and ends standing
    const m1 = i === 0 ? 0 : ((k2.v[c] - k0.v[c]) / (k2.t - k0.t)) * h;
    const m2 = i + 1 === keys.length - 1 ? 0 : ((k3.v[c] - k1.v[c]) / (k3.t - k1.t)) * h;
    out[c] = h00 * k1.v[c] + h10 * m1 + h01 * k2.v[c] + h11 * m2;
  }
}

const keyCache = new WeakMap<AccidentPlan, { t: number; v: number[] }[]>();
const spring = (tau: number, amp: number, hz: number, damp: number) => (tau <= 0 ? 0 : amp * Math.exp(-damp * tau) * Math.sin(2 * Math.PI * hz * tau));
const window01 = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a)));

/** THE LIMBS at `t`: the keyed track plus secondary motion — flailing in the air, a damped follow-through at each
 *  touchdown, a little "shake it off" of the head before getting up */
export function riderLimbsAt(plan: AccidentPlan, t: number, out: number[] = new Array(LIMB.COUNT).fill(0)): number[] {
  let keys = keyCache.get(plan);
  if (!keys) { keys = limbKeys(plan); keyCache.set(plan, keys); }
  sampleKeys(keys, t, out);
  const r = plan.rider, amp = 0.4 + 0.6 * plan.severity;
  // flailing, only in the air, fading in after the hit and out before touching down
  const fl = amp * smooth((t - 0.1) / 0.15) * (1 - smooth((t - (r.T1 - 0.14)) / 0.12)) * (t < r.T1 ? 1 : 0);
  if (fl > 0) {
    out[LIMB.ARM_L + 1] += 0.35 * fl * Math.sin(2 * Math.PI * 2.3 * t);
    out[LIMB.ARM_R + 1] += 0.35 * fl * Math.sin(2 * Math.PI * 2.3 * t + 1.9);
    out[LIMB.ARM_L] += 0.3 * fl * Math.sin(2 * Math.PI * 1.9 * t + 1.3);
    out[LIMB.ARM_R] += 0.3 * fl * Math.sin(2 * Math.PI * 1.9 * t + 2.6);
    out[LIMB.LEG_L] += 0.25 * fl * Math.sin(2 * Math.PI * 2.1 * t + Math.PI);
    out[LIMB.LEG_R] += 0.25 * fl * Math.sin(2 * Math.PI * 2.1 * t);
  }
  // follow-through: elbows, knees and the head carry on a moment after each touchdown
  const ft = spring(t - r.tLand, 0.3 * amp, 3.2, 7) + (r.T2 > 0 ? spring(t - r.tBounce, 0.18 * amp, 3.4, 8) : 0);
  out[LIMB.ARM_L + 2] += ft; out[LIMB.ARM_R + 2] += ft * 0.85; out[LIMB.LEG_L + 2] += ft * 0.7; out[LIMB.LEG_R + 2] += ft * 0.6;
  out[LIMB.NECK] += spring(t - r.tLand, -0.25 * amp, 2.8, 8);
  out[LIMB.NECK_SIDE] += 0.18 * window01(t, r.tLie - 0.6, r.tLie) * Math.sin(2 * Math.PI * 1.6 * (t - r.tLie));
  return out;
}

// ---- the rider's whole frame ---------------------------------------------------------------------------------
export type RiderPhase = "air" | "bounce" | "skid" | "lie" | "rise" | "done";
export interface RiderCrashFrame {
  phase: RiderPhase;
  /** the hips: world x/z, y ABOVE THE GROUND there (avatar/crashPose settles the body onto the ground) */
  x: number; z: number; y: number;
  /** the body's orientation (world) */
  q: THREE.Quaternion;
  /** 0 airborne … 1 on the ground (the body is kept on it), and 0 … 1 feet planted (getting up) */
  contact: number; anchor: number;
  /** how much of the body the crash owns (blends back to the body's own pose as they stand up) */
  weight: number;
  limbs: number[];
  /** the yaw the body faces once it is up */
  standYaw: number;
}

/** how far along the throw the hips are at `t` (all phases) */
function riderAlong(r: RiderPlan, t: number): number {
  if (t < r.tLand) return r.speed * t;
  if (t < r.tBounce) return r.dist1 + r.h1 * (t - r.tLand);
  const u = Math.min(t, r.tSkid) - r.tBounce;
  return r.dist1 + r.dist2 + r.hSkid * u - 0.5 * r.decel * u * u;
}

/** THE RIDER at `t` seconds after the impact */
export function riderFrameAt(a: AccidentMotionInput, plan: AccidentPlan, t: number, out?: RiderCrashFrame): RiderCrashFrame {
  const r = plan.rider, C = CRASH;
  const f = out ?? { phase: "air", x: 0, z: 0, y: 0, q: new THREE.Quaternion(), contact: 0, anchor: 0, weight: 1, limbs: new Array(LIMB.COUNT).fill(0), standYaw: r.standYaw };
  const tt = Math.max(0, t);
  f.standYaw = r.standYaw;
  riderLimbsAt(plan, Math.min(tt, r.end), f.limbs);
  let theta: number, psi = r.psi1, phi = 0, y: number, along = riderAlong(r, tt);
  f.anchor = 0; f.weight = 1;
  if (tt < r.tLand) {
    const u = tt / r.T1;
    f.phase = "air";
    // the rotation builds through the flight (the hit starts it; nothing stops it until the ground does)
    theta = (Math.PI / 2) * (0.15 * u + 0.85 * u * u);
    psi = r.psi0 + (r.psi1 - r.psi0) * smooth(u);
    y = C.DECK + C.HIP + r.vy * tt - 0.5 * C.G * tt * tt;
    f.contact = 0;
  } else if (tt < r.tBounce) {
    const u = tt - r.tLand;
    f.phase = "bounce";
    theta = Math.PI / 2 + r.roll * Math.PI * smooth(u / (r.T2 + 0.6 * r.T3));
    y = C.LIE_HIP + r.vy2 * u - 0.5 * C.G * u * u;
    f.contact = 1 - smooth(u / 0.05);
  } else if (tt < r.tSkid) {
    const u = (tt - r.tBounce) / Math.max(1e-6, r.T3);
    f.phase = "skid";
    theta = Math.PI / 2 + r.roll * Math.PI * smooth((tt - r.tLand) / (r.T2 + 0.6 * r.T3));
    phi = r.spin * (1 - (1 - u) * (1 - u));
    y = C.LIE_HIP;
    f.contact = r.T2 > 0 ? smooth((tt - r.tBounce) / 0.06) : smooth((tt - r.tLand) / 0.06);
  } else if (tt < r.tLie) {
    f.phase = "lie";
    theta = r.thetaLie; phi = r.spin; y = C.LIE_HIP; f.contact = 1;
  } else if (tt < r.end) {
    const u = (tt - r.tLie) / r.T5;
    f.phase = "rise";
    phi = r.spin; f.contact = 1;
    const thetaUp = r.thetaLie > Math.PI ? 2 * Math.PI : 0;
    // two stages: onto the knees (or sitting up), then up onto the feet with a touch of overshoot
    const k = u < 0.45 ? 0.62 * smooth(u / 0.45) : 0.62 + 0.38 * easeOutBack((u - 0.45) / 0.55);
    theta = r.thetaLie + (thetaUp - r.thetaLie) * k;
    const m = u < 0.45 ? 0.5 * smooth(u / 0.45) : 0.5 + 0.5 * smooth((u - 0.45) / 0.55);
    y = u < 0.45 ? lerp(C.LIE_HIP, C.KNEEL, smooth(u / 0.45)) : lerp(C.KNEEL, C.HIP, smooth((u - 0.45) / 0.55));
    along = r.travel;
    f.x = lerp(r.lieX, r.standX, m); f.z = lerp(r.lieZ, r.standZ, m);
    // feet planted while getting up; handed back as the crash lets go of the body
    f.anchor = 1 - smooth((tt - (r.end - C.BLEND_OUT - 0.1)) / (C.BLEND_OUT + 0.1));
    f.weight = 1 - smooth((tt - (r.end - C.BLEND_OUT)) / C.BLEND_OUT);
  } else {
    f.phase = "done";
    theta = r.thetaLie > Math.PI ? 2 * Math.PI : 0; phi = r.spin; y = C.HIP; f.contact = 1; f.weight = 0;
    f.x = r.standX; f.z = r.standZ;
  }
  if (f.phase !== "rise" && f.phase !== "done") { f.x = a.x + r.dx * along; f.z = a.z + r.dz * along; }
  // the hit's rebound: the body slaps down and gives a little back
  if (f.phase === "skid" || f.phase === "lie") theta += r.T2 > 0 ? 0 : -0.08 * window01(tt, r.tLand, r.tLand + 0.18);
  f.y = y;
  bodyQuat(r.dx, r.dz, theta, psi, phi, f.q);
  return f;
}

function easeOutBack(u: number): number {
  const k = clamp01(u), s = 0.8;
  return 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
}

// ---- the scooter's frame ---------------------------------------------------------------------------------------
export interface ScooterCrashFrame {
  /** its ORIGIN (the ground pivot world/scooters places), y above the ground; its centre of mass */
  x: number; z: number; y: number; comX: number; comZ: number;
  yaw: number; pitch: number; lean: number;
  resting: boolean;
}
const SIDE = new THREE.Vector3(1, 0, 0), FWD = new THREE.Vector3(0, 0, -1);
const _sq = new THREE.Quaternion(), _sa = new THREE.Quaternion(), _sv = new THREE.Vector3();

/** THE SCOOTER at `t` seconds after the impact (model yaw −heading, as placeRidden's; pitch, then lean) */
export function scooterPoseAt(a: AccidentMotionInput, plan: AccidentPlan, t: number): ScooterCrashFrame {
  const s = plan.scooter, S = SCOOTER_CRASH, G = CRASH.G;
  const tt = Math.max(0, t);
  let along: number, com: number;
  if (tt < s.T1) { along = s.speed * tt; com = S.COM + s.vy * tt - 0.5 * G * tt * tt; }
  else if (tt < s.T1 + s.T2) { const u = tt - s.T1; along = s.dist1 + s.h1 * u; com = S.LIE_COM + s.vy2 * u - 0.5 * G * u * u; }
  else { const u = Math.min(tt, s.end) - s.T1 - s.T2; along = s.dist1 + s.dist2 + s.hSlide * u - 0.5 * s.decel * u * u; com = S.LIE_COM; }
  if (tt >= s.end) along = s.travel;
  // losing balance: it tips (and in a heavy hit rolls right over) by tipEnd, then settles on its side with a wobble
  const tip = smooth(tt / s.tipEnd);
  let lean = s.leanSign * (Math.PI / 2 + 2 * Math.PI * s.rolls) * tip;
  lean += s.leanSign * 0.12 * spring(tt - s.tipEnd, 1, 2.5, 6);
  // its centre of mass is never under where its tipped body would rest on the ground
  com = Math.max(com, S.LIE_COM + (S.COM - S.LIE_COM) * Math.abs(Math.cos(lean)));
  const pitch = -s.pitchKick * window01(tt, 0, 0.5);
  const yaw = s.yaw0 + s.spin * (1 - Math.pow(1 - clamp01(tt / s.end), 2));
  const cx = a.x + s.dx * along, cz = a.z + s.dz * along;
  // the origin, so that it all turns about the centre of mass
  _sq.setFromAxisAngle(UP, yaw).multiply(_sa.setFromAxisAngle(SIDE, pitch)).multiply(_qb.setFromAxisAngle(FWD, lean));
  const off = _sv.set(0, S.COM, 0).applyQuaternion(_sq);
  return { x: cx - off.x, z: cz - off.z, y: com - off.y, comX: cx, comZ: cz, yaw, pitch, lean, resting: tt >= s.end && tt >= s.tipEnd + 0.6 };
}

// ---- where the throws may go -----------------------------------------------------------------------------------
/** is a body of radius r clear at (x, z)? (the static world and the car, from app/world) */
export type ClearTest = (x: number, z: number, r: number) => boolean;
const STEP = 4;
/** how much of a straight throw from (x, z) along (dx, dz) is clear for a body of radius r, starting `from` out */
function clearRun(x: number, z: number, dx: number, dz: number, length: number, r: number, clear: ClearTest, from = 8): number {
  for (let s = from; s <= length; s += STEP) if (!clear(x + dx * s, z + dz * s, r)) return Math.max(0, s - STEP - 6);
  return length;
}

/** WHAT THE WORLD ALLOWS: for each body, the first turn (REACH_TURNS) whose whole throw is clear — or failing that
 *  the one that gets farthest — and how much of it. The rider also needs room to lie and to stand up. */
export function chooseReach(a: AccidentMotionInput, clear: ClearTest): AccidentReach {
  const base = accidentPlan(a);
  const pick = (body: "rider" | "scooter"): Reach => {
    let best: Reach = { k: 0, turn: 0 }, bestDist = -1;
    for (const turn of REACH_TURNS) {
      const plan = accidentPlan(a, body === "rider" ? { rider: { k: 1, turn }, scooter: FULL_REACH.scooter } : { rider: FULL_REACH.rider, scooter: { k: 1, turn } });
      const p = plan[body];
      if (turn !== 0 && p.dx * base.nx + p.dz * base.nz < REACH_MIN_AWAY) continue;
      const len = p.travel;
      if (len < 1e-6) return { k: 1, turn };
      const r = body === "rider" ? 6 : 5;
      // the rider lies along the throw and gets up at their feet: the far end must have room for both
      let k = clearRun(a.x, a.z, p.dx, p.dz, len + (body === "rider" ? 10 : 6), r, clear) / (len + (body === "rider" ? 10 : 6));
      if (body === "rider") {
        for (; k > 0; k = Math.max(0, k - 0.1)) {
          const q = accidentPlan(a, { ...FULL_REACH, rider: { k, turn } }).rider;
          if (clear(q.standX, q.standZ, 8) && clear(q.lieX, q.lieZ, 6)) break;
          if (k <= 0.1) { k = 0; break; }
        }
      }
      k = clamp01(k);
      if (k >= 0.9) return { k, turn };
      if (k * len > bestDist + 1e-6) { bestDist = k * len; best = { k, turn }; }
    }
    return best;
  };
  return { rider: pick("rider"), scooter: pick("scooter") };
}

/** a confirmed accident as the world plays it: the motion input plus who and which scooter (and, once the
 *  rider's browser has reported it, the reach the server recorded) */
export interface Vo3dAccident extends AccidentMotionInput {
  id: string; rider: string; scooterId: string; loop?: string; vehicle?: number; reach?: AccidentReach | null;
  /** S7 — when the server started the lift (null: still lying there) and where the rider stood for it */
  liftAt?: number | null; liftFrom?: { x: number; z: number } | null;
}
