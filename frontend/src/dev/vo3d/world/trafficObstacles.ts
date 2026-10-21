// vo3d world — S4: IS THIS EMPLOYEE IN A CAR'S WAY? Pure. Each browser asks it about its OWN body only (walking or
// riding), so one person is one report however many are watching; the server turns reports into holds
// (backend app/services/traffic_holds.py) and checks each against its own copy of the same car.
//
// IN THE WAY means: inside the lane the car is about to drive — within ENTER of the lane's centre line, somewhere
// between the car's front bumper and as far ahead as it needs to stop from its own nominal speed. Behind a car,
// on the sidewalk, or out of its lane is never in its way. A body about to step in (its velocity carried PREDICT_S
// ahead) counts already, so a crossing is braked for early; a scooter keeping pace along the lane does not.
//
// HYSTERESIS, so nobody makes a car stutter: a body must be ENTER close to come in and only stops counting past
// EXIT; it reports the ONE nearest car approaching per loop (the queue does the rest), keeps that report alive
// while it stands there, and only says "clear" after CLEAR_MS of being clear.
import type { TrafficTimeline } from "./trafficHolds";

export const OBSTACLE = {
  /** lane half-width a body must be within to count (a car is ~60 wide; a lane is half a road) */
  ENTER: 40,
  EXIT: 52,
  /** how far ahead of its front bumper a car looks: never less than LOOK_MIN, more the faster it runs */
  LOOK_MIN: 260,
  LOOK_BASE: 60,
  LOOK_PER_SPEED: 2.6,
  /** …and a little BEHIND the bumper (somebody standing right at the grille is still in the way) */
  BEHIND: 20,
  PREDICT_S: 0.6,
  /** a body moving WITH the traffic at least as fast as the car is outrunning it; anything slower is in its
   *  way (a scooter at 130 ahead of a car at 160 is about to be caught — it must brake for it) */
  OUTRUN: 1.0,
  CLEAR_MS: 400,
  KEEPALIVE_MS: 600,
  /** cars this far (centre to body, straight line) beyond their look-ahead are not even looked at */
  NEAR: 120,
} as const;

export interface ObstacleBody { x: number; z: number; vx: number; vz: number; kind: "walk" | "ride" }
export interface ObstacleReport { loop: string; vehicle: number; x: number; z: number; kind: "walk" | "ride"; clear?: true }
export interface BlockedCar { li: number; vehicle: number; along: number }

/** the nearest car per loop whose path ahead this body is in, or null for that loop */
export function findBlocked(tl: TrafficTimeline, t: number, body: ObstacleBody, radius: (li: number, vi: number) => number): (BlockedCar | null)[] {
  const out: (BlockedCar | null)[] = [];
  const pred = { x: body.x + body.vx * OBSTACLE.PREDICT_S, z: body.z + body.vz * OBSTACLE.PREDICT_S };
  tl.loops.forEach((path, li) => {
    let best: BlockedCar | null = null;
    const L = path.length, S = path.s;
    for (let vi = 0; vi < path.offsets.length; vi++) {
      const s = tl.arc(li, vi, t);
      const half = tl.carLength(li, vi) / 2;
      // the car's nominal speed where it is: how far it must look
      let lo = 0, hi = S.length - 2;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (S[mid] <= s) lo = mid; else hi = mid - 1; }
      const look = Math.max(OBSTACLE.LOOK_MIN, OBSTACLE.LOOK_BASE + OBSTACLE.LOOK_PER_SPEED * path.speed[lo]);
      if (Math.hypot(path.x[lo] - body.x, path.z[lo] - body.z) > look + half + OBSTACLE.NEAR) continue;
      const r = radius(li, vi);
      const n = path.x.length;
      // walk the lane from just behind the bumper to the end of the look-ahead
      for (let along = -OBSTACLE.BEHIND; along <= look; along += 8) {
        const a = (s + half + along) % L;
        let k = Math.floor((a / L) * (n - 1));
        while (k > 0 && S[k] > a) k--;
        while (k < n - 1 && S[k + 1] <= a) k++;
        const px = path.x[k], pz = path.z[k];
        const here = Math.hypot(px - body.x, pz - body.z) <= r;
        const soon = Math.hypot(px - pred.x, pz - pred.z) <= r;
        if (!here && !soon) continue;
        // keeping pace with the traffic is not being in its way
        const dx = Math.cos(path.heading[k]), dz = Math.sin(path.heading[k]);
        if (body.vx * dx + body.vz * dz > OBSTACLE.OUTRUN * path.speed[k]) break;
        if (!best || along < best.along) best = { li, vehicle: vi, along };
        break;
      }
    }
    out.push(best);
  });
  return out;
}

/** WHAT TO TELL THE SERVER, frame by frame, about this one body */
export class ObstacleReporter {
  private readonly state: { vehicle: number | null; sentAt: number; clearSince: number | null }[] = [];

  /** `body` null: not on the campus ground (another floor, the lift, the Cave) — everything is clear at once */
  update(nowMs: number, tl: TrafficTimeline, t: number, body: ObstacleBody | null): ObstacleReport[] {
    const out: ObstacleReport[] = [];
    const loops = tl.loops;
    while (this.state.length < loops.length) this.state.push({ vehicle: null, sentAt: 0, clearSince: null });
    const blocked = body ? findBlocked(tl, t, body, (li, vi) => (this.state[li].vehicle === vi ? OBSTACLE.EXIT : OBSTACLE.ENTER)) : loops.map(() => null);
    loops.forEach((path, li) => {
      const st = this.state[li];
      const hit = blocked[li];
      const at = body ? { x: body.x, z: body.z, kind: body.kind } : { x: 0, z: 0, kind: "walk" as const };
      if (hit) {
        st.clearSince = null;
        if (st.vehicle !== hit.vehicle) {
          if (st.vehicle !== null) out.push({ loop: path.loop.id, vehicle: st.vehicle, ...at, clear: true });
          st.vehicle = hit.vehicle;
          st.sentAt = nowMs;
          out.push({ loop: path.loop.id, vehicle: hit.vehicle, ...at });
        } else if (nowMs - st.sentAt >= OBSTACLE.KEEPALIVE_MS) {
          st.sentAt = nowMs;
          out.push({ loop: path.loop.id, vehicle: hit.vehicle, ...at });
        }
        return;
      }
      if (st.vehicle === null) return;
      if (!body) { out.push({ loop: path.loop.id, vehicle: st.vehicle, ...at, clear: true }); st.vehicle = null; st.clearSince = null; return; }
      if (st.clearSince === null) st.clearSince = nowMs;
      if (nowMs - st.clearSince >= OBSTACLE.CLEAR_MS) {
        out.push({ loop: path.loop.id, vehicle: st.vehicle, ...at, clear: true });
        st.vehicle = null;
        st.clearSince = null;
      }
    });
    return out;
  }

  /** which car (per loop) this body is holding up, for the readout and tests */
  get holding(): (number | null)[] { return this.state.map((s) => s.vehicle); }
}
