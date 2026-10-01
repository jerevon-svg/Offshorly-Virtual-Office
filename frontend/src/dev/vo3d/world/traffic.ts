// vo3d world — LIGHTWEIGHT DETERMINISTIC TRAFFIC round the Offshorly block. Pure data and maths: no THREE,
// no state, no networking. build/exterior draws it; this decides where every vehicle is at a given time.
//
// THE ARCHITECTURE: TWO LOOPS THAT CAN NEVER MEET.
//   A — the lanes ADJACENT to the block, every turn a RIGHT turn (traffic keeps right, as in the
//       Philippines): westbound on the main street's north lane, north up the west street, east along the
//       back street, south down the east street.
//   B — the FAR lanes, every turn a LEFT turn, running the other way round.
// Each loop is a rounded rectangle through its lane centres, and B's is A's offset outward by exactly one
// lane (108): the two rectangles are concentric, so at every corner A's tight right turn and B's wide left
// turn are arcs about the SAME centre and cannot cross. The loops never share a lane, so nothing has to
// yield to anything — there is no simulation to run.
//
// SPACING WITHOUT SIMULATION. Every vehicle on a loop follows the SAME speed-over-distance profile
// (cruise on the straights, braking into and accelerating out of each corner), offset in TIME. A shared
// profile means nobody can close on the vehicle ahead: the time gap between two vehicles is constant, so
// the distance gap only breathes (tighter in the corners, where everyone is slower). The time gaps are
// deliberately irregular so the loop never reads as a conga line.
//
// THE SAME TRAFFIC ON EVERY SCREEN. Position is a pure function of wall-clock time, so every client —
// and both floors — sees the same vehicle at the same corner with no message sent.
import { ROADS, roadRect, type VehicleKind } from "./campus";

export type TrafficVehicle = { kind: VehicleKind; colour: number; gap: number };
export type TrafficLoop = {
  id: "A" | "B";
  /** lane-centre lines of the rounded rectangle */
  xw: number; xe: number; zn: number; zs: number;
  /** corner radius (A's tight right turns; B's = A's + one lane) */
  r: number;
  /** +1 = westbound along the south side (A), −1 = the reverse (B) */
  dir: 1 | -1;
  /** straight-line and corner speeds, world units per second; acceleration in u/s² */
  cruise: number; corner: number; accel: number;
  vehicles: TrafficVehicle[];
};

const road = (id: string) => ROADS.find((r) => r.id === id)!;
/** half a lane: lane centres sit this far either side of a road's centre line */
export const LANE_OFFSET = road("road-main").width / 4;
const main = road("road-main"), north = road("road-north"), west = road("road-west"), east = road("road-east");
/** A's corner radius. The block-side kerb corner sits LANE_OFFSET inside a lane-centre corner, and a
 *  radius a little above that keeps the whole turn — body included — in the carriageway. */
const R_A = 70;

export const TRAFFIC_LOOPS: TrafficLoop[] = [
  {
    id: "A", dir: 1, r: R_A,
    xw: west.at + LANE_OFFSET, xe: east.at - LANE_OFFSET, zn: north.at + LANE_OFFSET, zs: main.at - LANE_OFFSET,
    cruise: 160, corner: 66, accel: 70,
    // mostly road cars; one jeepney, one tricycle, one exotic, one utility — gaps in irregular proportions
    vehicles: [
      { kind: "sport", colour: 0x2f3b52, gap: 1.0 },
      { kind: "jeepney", colour: 0x2a9d8f, gap: 1.7 },
      { kind: "sport", colour: 0xeeeeee, gap: 0.9 },
      { kind: "supercar", colour: 0xff7a1a, gap: 1.4 },
      { kind: "tricycle", colour: 0x1f6f43, gap: 2.1 },
      { kind: "sport", colour: 0x8c1c24, gap: 0.8 },
      { kind: "pickup", colour: 0x5b6168, gap: 1.3 },
    ],
  },
  {
    id: "B", dir: -1, r: R_A + 2 * LANE_OFFSET,
    xw: west.at - LANE_OFFSET, xe: east.at + LANE_OFFSET, zn: north.at - LANE_OFFSET, zs: main.at + LANE_OFFSET,
    cruise: 172, corner: 104, accel: 70,
    vehicles: [
      { kind: "sport", colour: 0xd4d6d9, gap: 1.2 },
      { kind: "supercarWing", colour: 0x1e63d6, gap: 0.8 },
      { kind: "etrike", colour: 0xf1f1f1, gap: 1.9 },
      { kind: "sport", colour: 0x232529, gap: 1.1 },
      { kind: "jeepney", colour: 0xe8a820, gap: 1.5 },
      { kind: "sport", colour: 0x6b8e23, gap: 0.9 },
      { kind: "sportbike", colour: 0x2255aa, gap: 1.6 },
    ],
  },
];

/** A LOOP, SAMPLED: points every ~STEP units, their headings, the speed profile and the time table. */
export type LoopPath = {
  loop: TrafficLoop;
  x: Float64Array; z: Float64Array; heading: Float64Array; speed: Float64Array;
  /** time at each sample, seconds from the loop's start; `period` closes it */
  t: Float64Array; period: number; length: number;
  /** each vehicle's time offset within the period */
  offsets: number[];
};
const STEP = 4;

export function buildLoopPath(loop: TrafficLoop): LoopPath {
  const { xw, xe, zn, zs, r } = loop;
  const px: number[] = [], pz: number[] = [];
  const line = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / STEP));
    for (let i = 0; i < n; i++) { px.push(x0 + ((x1 - x0) * i) / n); pz.push(z0 + ((z1 - z0) * i) / n); }
  };
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    const n = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / STEP));
    for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; px.push(cx + r * Math.cos(a)); pz.push(cz + r * Math.sin(a)); }
  };
  // A's traversal (x east, z south): west along the south side, then N, E, S — angles increase by PI/2
  line(xe - r, zs, xw + r, zs); arc(xw + r, zs - r, Math.PI / 2, Math.PI);
  line(xw, zs - r, xw, zn + r); arc(xw + r, zn + r, Math.PI, 1.5 * Math.PI);
  line(xw + r, zn, xe - r, zn); arc(xe - r, zn + r, 1.5 * Math.PI, 2 * Math.PI);
  line(xe, zn + r, xe, zs - r); arc(xe - r, zs - r, 0, Math.PI / 2);
  if (loop.dir === -1) { px.reverse(); pz.reverse(); }
  const n = px.length;
  const x = Float64Array.from(px), z = Float64Array.from(pz);
  // headings from the chord to the next sample (closed loop)
  const heading = new Float64Array(n);
  const ds = new Float64Array(n);
  let length = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    heading[i] = Math.atan2(z[j] - z[i], x[j] - x[i]);
    ds[i] = Math.hypot(x[j] - x[i], z[j] - z[i]);
    length += ds[i];
  }
  // SPEED PROFILE: the corner speed wherever the path is curving, cruise elsewhere, then an acceleration
  // limit forwards (pulling away) and backwards (braking in time), twice round so the wrap is settled
  const speed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const turn = Math.abs(wrapAngle(heading[(i + 1) % n] - heading[i]));
    speed[i] = turn > 1e-4 ? loop.corner : loop.cruise;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) { const p = (i - 1 + n) % n; speed[i] = Math.min(speed[i], Math.sqrt(speed[p] ** 2 + 2 * loop.accel * ds[p])); }
    for (let i = n - 1; i >= 0; i--) { const q = (i + 1) % n; speed[i] = Math.min(speed[i], Math.sqrt(speed[q] ** 2 + 2 * loop.accel * ds[i])); }
  }
  // TIME TABLE: trapezoidal time over each step
  const t = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) t[i + 1] = t[i] + ds[i] / (0.5 * (speed[i] + speed[(i + 1) % n]));
  const period = t[n];
  const total = loop.vehicles.reduce((a, v) => a + v.gap, 0);
  let acc = 0;
  const offsets = loop.vehicles.map((v) => { const o = (acc / total) * period; acc += v.gap; return o; });
  return { loop, x, z, heading, speed, t, period, length, offsets };
}

export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Where a vehicle on this loop is at time `timeSec` (any clock — the caller passes wall time). `yaw` is the
 *  model yaw for build/vehicles' local-−z-forward convention. */
export function poseAt(path: LoopPath, vehicle: number, timeSec: number, out: { x: number; z: number; yaw: number; heading: number; speed: number }): void {
  const P = path.period;
  let tau = (timeSec + path.offsets[vehicle]) % P;
  if (tau < 0) tau += P;
  // binary search the time table
  const t = path.t;
  let lo = 0, hi = t.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= tau) lo = mid; else hi = mid - 1; }
  const i = lo, j = (i + 1) % path.x.length;
  const f = (tau - t[i]) / Math.max(1e-9, t[i + 1] - t[i]);
  out.x = path.x[i] + (path.x[j] - path.x[i]) * f;
  out.z = path.z[i] + (path.z[j] - path.z[i]) * f;
  out.heading = path.heading[i] + wrapAngle(path.heading[j] - path.heading[i]) * f;
  out.speed = path.speed[i] + (path.speed[j] - path.speed[i]) * f;
  // heading h points along (cos h, sin h) in (x, z); the models face −z, so yaw = atan2(−dx, −dz)
  out.yaw = Math.atan2(-Math.cos(out.heading), -Math.sin(out.heading));
}

/** every carriageway, for tests and guards */
export const carriageways = () => ROADS.map((r) => roadRect(r));
