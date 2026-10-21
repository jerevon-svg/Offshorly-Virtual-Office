// vo3d world — S4: TRAFFIC THAT STOPS. The 14 cars still run on world/traffic's deterministic loops and on the
// server's clock (S0); this adds the one thing that may change a car's schedule — a server-issued HOLD — and
// the rule that keeps everybody behind a stopped car queued instead of driving through it.
//
// EVERY BROWSER COMPUTES THE SAME CARS from the same few numbers (the server's `traffic_holds` state), and the
// backend computes the same ones from the same formulas (backend app/services/traffic_model.py mirrors this
// file line for line; the parity tests pin them together). Nothing here is simulated frame by frame.
//
// A CAR'S PROGRESS is its PATH TIME p — where it is on its loop, measured in the loop's own seconds (world/traffic
// poseAt: p = t + offset). Untouched, p = t + offset − D, with D a delay left over from earlier holds that the car
// is quietly making up (it runs RHO faster until D is gone). A HOLD stops it at path time `stopP`:
//
//   braking    p = stopP − soft(stopP − p_free, b): the car's rate falls from 1 to 0 LINEARLY over 2b seconds,
//              a constant deceleration onto the stop (b ≤ TB; less when the obstacle is closer than that)
//   stopped    p = stopP until the server sets `releaseAt` (the path is clear, plus a safety margin)
//   resuming   the rate climbs back to 1 linearly over 2·TA (from wherever braking had got to, if released early)
//   done       the time it lost is a plain delay again (`fold`), made up at RHO
//
// QUEUEING is not a hold: a car behind a stopped one keeps its own schedule, and its POSITION (by distance along
// the loop) is smoothly limited to where its leader was HEADWAY ago, minus a gap — so it eases in behind, waits,
// and pulls away a beat after its leader, in order. No car can pass, or reverse into, the one ahead of it.
import type { LoopPath } from "./traffic";

export const HOLD = {
  /** the longest braking half-time, s: a full stop from cruise takes 2·TB, covering TB of path time */
  TB: 1.1,
  /** the shortest braking a hold may be given (closer than this is an emergency stop) */
  MIN_B: 0.15,
  /** the restart's half-time, s */
  TA: 1.4,
  /** how fast a car makes up lost time once it is moving again (share of its own speed) */
  RHO: 0.08,
  /** the follow zone, world units: within this of the gap behind its leader a car eases in */
  FOLLOW_ZONE: 70,
  /** bumper-to-bumper space a queued car keeps, world units */
  GAP: 16,
  /** a queued car keeps behind where its leader was this long ago: the restart's stagger, car by car */
  HEADWAY: 0.8,
} as const;

/** a vehicle's lengths, world units (build/vehicles, measured) — for the queue's bumper gaps */
export const VEHICLE_LENGTH: Record<string, number> = {
  sport: 118, supercar: 117, supercarWing: 117, jeepney: 194, tricycle: 59, etrike: 77, pickup: 133, sportbike: 57,
};

/** …and their widths (build/vehicles, measured) — the car body a walker or a rider cannot pass through */
export const VEHICLE_WIDTH: Record<string, number> = {
  sport: 56, supercar: 59, supercarWing: 59, jeepney: 62, tricycle: 50, etrike: 55, pickup: 64, sportbike: 16,
};

export interface HoldWire {
  id: string;
  /** the path time the car stops at (unwrapped: may exceed the loop's period) */
  stopP: number;
  /** its braking half-time, s */
  b: number;
  /** server seconds the release was given, or null while it must stay stopped */
  releaseAt: number | null;
  /** the obstacle was too close to brake for properly (S5 tells a stop from a collision by this) */
  emergency: boolean;
  /** S5 — the confirmed accident this car is held for (released only when it ends) */
  accident?: string | null;
}

/** ONE CAR'S SCHEDULE: a delay d0 as of server second t0, and at most one hold */
export interface VehicleTimeline { d0: number; t0: number; hold: HoldWire | null }

/** the remaining path time to the stop, as braking has it, when the free car would have `x` left (0…) */
export function soft(x: number, b: number): number {
  if (x >= b) return x;
  if (x <= -b) return 0;
  return ((x + b) * (x + b)) / (4 * b);
}
/** …and the car's rate (0…1) there */
export function softRate(x: number, b: number): number {
  if (x >= b) return 1;
  if (x <= -b) return 0;
  return (x + b) / (2 * b);
}

/** the delay D(t) of a car making up time (no hold) */
export function catchUpDelay(v: VehicleTimeline, t: number): number {
  return Math.max(0, v.d0 - HOLD.RHO * Math.max(0, t - v.t0));
}

/** when a released hold has finished its restart, server seconds — null while it is not released */
export function holdDoneAt(off: number, v: VehicleTimeline): number | null {
  const h = v.hold;
  if (!h || h.releaseAt === null) return null;
  const r0 = softRate(h.stopP - (h.releaseAt + off - v.d0), h.b);
  return h.releaseAt + 2 * HOLD.TA * (1 - r0);
}

/** THE CAR'S PATH TIME at server second t */
export function vehiclePathTime(off: number, v: VehicleTimeline | undefined, t: number): number {
  if (!v) return t + off;
  const h = v.hold;
  if (!h) return t + off - catchUpDelay(v, t);
  const free = (at: number) => at + off - v.d0;
  if (h.releaseAt === null || t < h.releaseAt) return h.stopP - soft(h.stopP - free(t), h.b);
  const xr = h.stopP - free(h.releaseAt);
  const pr = h.stopP - soft(xr, h.b);
  const r0 = softRate(xr, h.b);
  const u = t - h.releaseAt, u1 = 2 * HOLD.TA * (1 - r0);
  if (u < u1) return pr + r0 * u + (u * u) / (4 * HOLD.TA);
  return pr + r0 * u1 + (u1 * u1) / (4 * HOLD.TA) + (u - u1);
}

/** a finished hold becomes a plain delay again — EXACTLY: the path time is the same either side of the fold */
export function fold(off: number, v: VehicleTimeline, t: number): VehicleTimeline {
  const done = holdDoneAt(off, v);
  if (done === null || t < done) return v;
  const p = vehiclePathTime(off, v, done);
  return { d0: done + off - p, t0: done, hold: null };
}

// ---- positions by distance along the loop -----------------------------------------------------------------
const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** the distance along the loop at path time p, in [0, length) */
export function arcAtPathTime(path: LoopPath, p: number): number {
  const tau = mod(p, path.period);
  const t = path.t;
  let lo = 0, hi = t.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= tau) lo = mid; else hi = mid - 1; }
  const f = (tau - t[lo]) / Math.max(1e-9, t[lo + 1] - t[lo]);
  return path.s[lo] + (path.s[lo + 1] - path.s[lo]) * f;
}

/** the path time (in [0, period)) at distance s along the loop */
export function pathTimeAtArc(path: LoopPath, s: number): number {
  const a = mod(s, path.length);
  const S = path.s;
  let lo = 0, hi = S.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (S[mid] <= a) lo = mid; else hi = mid - 1; }
  const f = (a - S[lo]) / Math.max(1e-9, S[lo + 1] - S[lo]);
  return path.t[lo] + (path.t[lo + 1] - path.t[lo]) * f;
}

export type TrafficPose = { x: number; z: number; yaw: number; heading: number; speed: number };

/** a car drawn at distance s along its loop (world/traffic poseAt's conventions) */
export function poseAtArc(path: LoopPath, s: number, out: TrafficPose): void {
  const a = mod(s, path.length);
  const S = path.s;
  let lo = 0, hi = S.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (S[mid] <= a) lo = mid; else hi = mid - 1; }
  const n = path.x.length, i = lo, j = (i + 1) % n;
  const f = (a - S[i]) / Math.max(1e-9, S[i + 1] - S[i]);
  out.x = path.x[i] + (path.x[j] - path.x[i]) * f;
  out.z = path.z[i] + (path.z[j] - path.z[i]) * f;
  const dh = Math.atan2(Math.sin(path.heading[j] - path.heading[i]), Math.cos(path.heading[j] - path.heading[i]));
  out.heading = path.heading[i] + dh * f;
  out.speed = path.speed[i] + (path.speed[j] - path.speed[i]) * f;
  out.yaw = Math.atan2(-Math.cos(out.heading), -Math.sin(out.heading));
}

export const vehicleKey = (loop: string, vehicle: number): string => `${loop}:${vehicle}`;

/** THE WHOLE FLEET at one moment: each car's schedule (holds and delays), then the queue behind any slow one */
export class TrafficTimeline {
  private readonly paths: readonly LoopPath[];
  private state = new Map<string, VehicleTimeline>();
  private cacheT = Number.NaN;
  private readonly scratch: TrafficPose = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
  private readonly arcs: Float64Array[];
  private readonly rates: Float64Array[];
  private readonly lengths: number[][];
  /** each loop's cars in queue order: leader[i] is the car directly ahead of car i */
  private readonly leader: number[][];

  constructor(paths: readonly LoopPath[]) {
    this.paths = paths;
    this.arcs = paths.map((p) => new Float64Array(p.offsets.length));
    this.rates = paths.map((p) => new Float64Array(p.offsets.length));
    this.lengths = paths.map((p) => p.loop.vehicles.map((v) => VEHICLE_LENGTH[v.kind] ?? 120));
    // AHEAD = a larger offset (further along at the same moment); the order never changes (no overtaking)
    this.leader = paths.map((p) => {
      const order = p.offsets.map((o, i) => ({ o, i })).sort((a, b) => a.o - b.o).map((e) => e.i);
      const lead: number[] = [];
      order.forEach((i, k) => { lead[i] = order[(k + 1) % order.length]; });
      return lead;
    });
  }

  /** the server's word (key = vehicleKey) */
  setState(next: ReadonlyMap<string, VehicleTimeline>): void {
    this.state = new Map(next);
    this.cacheT = Number.NaN;
  }
  get schedule(): ReadonlyMap<string, VehicleTimeline> { return this.state; }

  /** the free path time of a car (its own schedule, before queueing) */
  pathTime(li: number, vi: number, t: number): number {
    const path = this.paths[li];
    return vehiclePathTime(path.offsets[vi], this.state.get(vehicleKey(path.loop.id, vi)), t);
  }

  /** the car whose chain the queue is worked out from: a HELD car if there is one (its place is its own hold's,
   *  whoever is ahead), else the one with the most room ahead — either way, one nothing is queued behind */
  private chainStart(li: number, free: Float64Array): number {
    const path = this.paths[li], L = path.length, lead = this.leader[li];
    let start = 0, most = -Infinity;
    for (let vi = 0; vi < free.length; vi++) {
      const held = this.state.get(vehicleKey(path.loop.id, vi))?.hold != null;
      const room = mod(free[lead[vi]] - free[vi], L) + (held ? 2 * L : 0);
      if (room > most) { most = room; start = vi; }
    }
    return start;
  }

  /** each car's drawn arc at `t`, written into `out`. Following a car means staying behind where it was
   *  HEADWAY seconds ago (minus the bumper gap): a leader never goes backwards, so a follower never does, and a
   *  queue pulls away one car after another. */
  private solve(li: number, t: number, out: Float64Array): void {
    const path = this.paths[li], L = path.length, n = path.offsets.length;
    const lead = this.leader[li];
    const follower: number[] = [];
    for (let vi = 0; vi < n; vi++) follower[lead[vi]] = vi;
    const chain: number[] = [this.chainStart(li, this.freeAt(li, t))];
    for (let k = 1; k < n; k++) chain.push(follower[chain[k - 1]]);
    // eff[j][k]: chain car j at time t − k·HEADWAY (car j needs its leader one step earlier, so depth shrinks)
    let prev = new Float64Array(n);
    for (let k = 0; k < n; k++) prev[k] = this.freeArc(li, chain[0], t - k * HOLD.HEADWAY);
    out[chain[0]] = prev[0];
    for (let j = 1; j < n; j++) {
      const f = chain[j], ahead = chain[j - 1];
      const gap = (this.lengths[li][ahead] + this.lengths[li][f]) / 2 + HOLD.GAP;
      const cur = new Float64Array(n - j);
      for (let k = 0; k < n - j; k++) {
        const own = this.freeArc(li, f, t - k * HOLD.HEADWAY);
        // signed distance to the limit, in (−L/2, L/2]: a car "beyond" its stopped leader is behind it
        const x = mod(prev[k + 1] - gap - own + L / 2, L) - L / 2;
        cur[k] = mod(own + x - soft(x, HOLD.FOLLOW_ZONE), L);
      }
      out[f] = cur[0];
      prev = cur;
    }
  }

  private freeArc(li: number, vi: number, t: number): number {
    return arcAtPathTime(this.paths[li], this.pathTime(li, vi, t));
  }
  private freeAt(li: number, t: number): Float64Array {
    const n = this.paths[li].offsets.length, a = new Float64Array(n);
    for (let vi = 0; vi < n; vi++) a[vi] = this.freeArc(li, vi, t);
    return a;
  }

  private compute(t: number): void {
    if (t === this.cacheT) return;
    this.cacheT = t;
    const eps = 1 / 30;
    for (let li = 0; li < this.paths.length; li++) {
      const path = this.paths[li], L = path.length, n = path.offsets.length;
      const eff = this.arcs[li], effAhead = new Float64Array(n);
      this.solve(li, t, eff);
      this.solve(li, t + eps, effAhead);
      for (let vi = 0; vi < n; vi++) {
        // signed: two equal positions a rounding apart are "not moving", never "a whole lap"
        const moved = Math.max(0, mod(effAhead[vi] - eff[vi] + L / 2, L) - L / 2);
        // against the loop's own speed WHERE THE CAR IS — not where its schedule would have put it (a car
        // running late may be on a straight while its schedule is in a corner)
        poseAtArc(path, eff[vi], this.scratch);
        const nominal = this.scratch.speed * eps;
        this.rates[li][vi] = nominal > 1e-6 ? Math.min(1.5, moved / nominal) : 1;
      }
    }
  }

  /** where car `vi` of loop `li` is drawn at server second t — its schedule AND the queue */
  pose(li: number, vi: number, t: number, out: TrafficPose): void {
    this.compute(t);
    poseAtArc(this.paths[li], this.arcs[li][vi], out);
    out.speed *= this.rates[li][vi];
  }
  /** the distance along its loop car `vi` is drawn at (S4 obstacle detection reads it) */
  arc(li: number, vi: number, t: number): number { this.compute(t); return this.arcs[li][vi]; }
  /** its actual rate against its schedule, 0 = stopped (for the effects and the tests) */
  rate(li: number, vi: number, t: number): number { this.compute(t); return this.rates[li][vi]; }
  get loops(): readonly LoopPath[] { return this.paths; }

  /** HOW FAR a body of `radius` at `p` is INSIDE any car at server second t (0 = clear of every car): each car
   *  its measured body, a box along its heading. Only cars within reach are looked at. */
  penetration(p: { x: number; z: number }, radius: number, t: number): number {
    this.compute(t);
    let worst = 0;
    const o: TrafficPose = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
    for (let li = 0; li < this.paths.length; li++) {
      const kinds = this.paths[li].loop.vehicles;
      for (let vi = 0; vi < kinds.length; vi++) {
        poseAtArc(this.paths[li], this.arcs[li][vi], o);
        const hl = this.lengths[li][vi] / 2, hw = (VEHICLE_WIDTH[kinds[vi].kind] ?? 60) / 2;
        const dx = p.x - o.x, dz = p.z - o.z;
        if (dx * dx + dz * dz > (hl + radius + 4) ** 2) continue;
        const c = Math.cos(o.heading), s = Math.sin(o.heading);
        const along = Math.abs(dx * c + dz * s) - hl, side = Math.abs(-dx * s + dz * c) - hw;
        // signed distance from the box: outside, to its nearest edge or corner; inside, minus the way out
        const sd = along > 0 || side > 0 ? Math.hypot(Math.max(along, 0), Math.max(side, 0)) : Math.max(along, side);
        worst = Math.max(worst, radius - sd);
      }
    }
    return worst;
  }
  carLength(li: number, vi: number): number { return this.lengths[li][vi]; }
}

/** A STEP FOR A BODY AMONG CARS: refused only if it goes DEEPER into a car than where it stands now (with a
 *  hair of tolerance) — so a car is solid to walk or ride into, and a body a car came to rest against can
 *  always step away from it, never trapped inside it */
export function carStepBlocked(tl: TrafficTimeline, from: { x: number; z: number }, to: { x: number; z: number }, radius: number, t: number): boolean {
  const into = tl.penetration(to, radius, t);
  return into > 0 && into > tl.penetration(from, radius, t) + 0.25;
}
