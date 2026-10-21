// vo3d world — S5: DID A SCOOTER JUST HIT A CAR? Pure. Asked only by the RIDER's own browser, about its own
// scooter, against the same cars everybody draws (world/trafficHolds — holds, queues and all). The server judges
// what it reports against its own copy of the car (backend app/services/scooter_accidents.py — same numbers).
//
// CONTACT is the scooter's footprint (a circle of RADIUS round the rider's feet) touching a car's measured body.
// The S4 rule already makes a car solid to the scooter, so contact is where a ride stops against a car — or where
// a car drives into a scooter. What matters is how hard: the CLOSING SPEED, the rate the two were coming
// together along the line between them, judged with the scooter's speed from BEFORE the bump (the bump itself
// takes the speed off).
//
//   gentle     closing under GENTLE, or a car that had STOPPED (it braked in time — S4's whole point) bumped at
//              less than HARD_INTO_STOPPED. Nothing happens: the car is simply solid.
//   accident   closing at MIN_CLOSING or more against a moving car (cutting in front of traffic, drifting into a
//              lane), or a stopped car hit truly hard. Reported, once, for the server to confirm.
//
// FRAME GAPS: the check is SWEPT — from last frame's scooter and cars to this frame's, in sub-steps no longer than
// STEP units of relative travel — so neither a fast scooter nor a fast car (or a long frame) can pass through.
import { VEHICLE_WIDTH, type TrafficPose, type TrafficTimeline } from "./trafficHolds";

export const ACCIDENT = {
  /** the scooter's footprint for contact (the S4 ride's car radius, 12, plus a hair) */
  RADIUS: 15,
  /** closing speeds, world units per second (a person is 36 tall; the scooter cruises at 300) */
  GENTLE: 45,
  MIN_CLOSING: 110,
  /** a car slower than this has stopped — it braked for you */
  STOPPED: 8,
  /** …and only this hard a hit into a stopped car is still an accident */
  HARD_INTO_STOPPED: 200,
  /** sweep sub-step, world units of relative travel; at most MAX_STEPS */
  STEP: 4,
  MAX_STEPS: 12,
  /** cars further than this from the scooter are not even looked at */
  NEAR: 220,
} as const;

export type ContactKind = "none" | "gentle" | "accident";
export interface Contact {
  kind: ContactKind;
  li: number;
  vehicle: number;
  /** where the scooter was at the moment of contact, and when (server seconds) */
  x: number;
  z: number;
  t: number;
  closing: number;
  carSpeed: number;
  carHeading: number;
}

/** a scooter at one moment: where, and its velocity (the ride convention: heading h moves along (sin h, −cos h)) */
export interface ScooterAt { x: number; z: number; heading: number; speed: number }

/** ONE CAR, ONE SCOOTER, ONE MOMENT: touching? how hard? (car: centre, heading along (cos h, sin h), speed) */
export function assessContact(s: ScooterAt, car: TrafficPose, length: number, width: number, radius: number = ACCIDENT.RADIUS): { touching: boolean; closing: number; kind: ContactKind } {
  const c = Math.cos(car.heading), sn = Math.sin(car.heading);
  const dx = s.x - car.x, dz = s.z - car.z;
  const a = dx * c + dz * sn, l = -dx * sn + dz * c;
  const hl = length / 2, hw = width / 2;
  const oa = Math.abs(a) - hl, ol = Math.abs(l) - hw;
  const outside = oa > 0 || ol > 0;
  const sd = outside ? Math.hypot(Math.max(oa, 0), Math.max(ol, 0)) : Math.max(oa, ol);
  if (sd > radius) return { touching: false, closing: 0, kind: "none" };
  // the contact normal, car → scooter, in the car's frame then the world's
  let na: number, nl: number;
  if (outside) { na = oa > 0 ? Math.sign(a) * oa : 0; nl = ol > 0 ? Math.sign(l) * ol : 0; const n = Math.hypot(na, nl) || 1; na /= n; nl /= n; }
  else if (oa > ol) { na = Math.sign(a) || 1; nl = 0; } else { na = 0; nl = Math.sign(l) || 1; }
  const nx = na * c - nl * sn, nz = na * sn + nl * c;
  const vsx = Math.sin(s.heading) * s.speed, vsz = -Math.cos(s.heading) * s.speed;
  const vcx = c * car.speed, vcz = sn * car.speed;
  const closing = (vcx - vsx) * nx + (vcz - vsz) * nz;
  let kind: ContactKind = "gentle";
  if (closing >= ACCIDENT.MIN_CLOSING && (car.speed >= ACCIDENT.STOPPED || closing >= ACCIDENT.HARD_INTO_STOPPED)) kind = "accident";
  return { touching: true, closing, kind };
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** THE SWEPT CHECK, last frame → this frame: the first contact found, the hardest car at that moment. `prev` keeps
 *  the scooter's speed from before any bump this frame. Null when nothing was touched. */
export function sweepContact(tl: TrafficTimeline, prev: ScooterAt & { t: number }, cur: ScooterAt & { t: number }): Contact | null {
  const loops = tl.loops;
  // only cars near the scooter's path this frame
  const near: { li: number; vi: number }[] = [];
  const o: TrafficPose = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
  loops.forEach((path, li) => path.offsets.forEach((_, vi) => {
    tl.pose(li, vi, cur.t, o);
    if (Math.hypot(o.x - cur.x, o.z - cur.z) <= ACCIDENT.NEAR) near.push({ li, vi });
  }));
  if (near.length === 0) return null;
  const dt = Math.max(0, cur.t - prev.t);
  const travel = Math.hypot(cur.x - prev.x, cur.z - prev.z) + 220 * dt;
  const n = Math.max(1, Math.min(ACCIDENT.MAX_STEPS, Math.ceil(travel / ACCIDENT.STEP)));
  const speed = Math.max(prev.speed, cur.speed); // the speed it HAD, before a bump took it off
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    const s: ScooterAt = { x: lerp(prev.x, cur.x, u), z: lerp(prev.z, cur.z, u), heading: cur.heading, speed };
    const t = lerp(prev.t, cur.t, u);
    let best: Contact | null = null;
    for (const { li, vi } of near) {
      tl.pose(li, vi, t, o);
      const kind = loops[li].loop.vehicles[vi].kind;
      const hit = assessContact(s, o, tl.carLength(li, vi), VEHICLE_WIDTH[kind] ?? 60);
      if (!hit.touching) continue;
      if (!best || hit.closing > best.closing) best = { kind: hit.kind, li, vehicle: vi, x: s.x, z: s.z, t, closing: hit.closing, carSpeed: o.speed, carHeading: o.heading };
    }
    if (best) return best;
  }
  return null;
}
