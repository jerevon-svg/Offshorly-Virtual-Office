// S0 — THE TRAFFIC ON THE SERVER'S CLOCK (world/trafficClock): two browsers with different local clocks put
// every one of the 14 cars in the same place, and a new offset never makes a car jump or reverse on screen.
import { describe, expect, it } from "vitest";
import { FAR_S, SLEW, TrafficClock } from "./world/trafficClock";
import { TRAFFIC_LOOPS, buildLoopPath, poseAt } from "./world/traffic";

const PATHS = TRAFFIC_LOOPS.map(buildLoopPath);
const poses = (t: number) => PATHS.flatMap((p) => p.loop.vehicles.map((_, i) => {
  const o = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
  poseAt(p, i, t, o);
  return o;
}));

describe("TrafficClock — the same cars for everybody", () => {
  it("two clients whose local clocks disagree by 37.2 s draw all 14 vehicles in the same place", () => {
    const server = 1_800_000_000_000;
    const aLocal = server - 37_200, bLocal = server + 4_150; // A is slow, B is fast
    const a = new TrafficClock(), b = new TrafficClock();
    // before any measurement they disagree, as every browser did before S0
    expect(poses(a.now(aLocal, false))).not.toEqual(poses(b.now(bLocal, false)));
    a.setOffset(server - aLocal);
    b.setOffset(server - bLocal);
    const ta = a.now(aLocal + 16, false), tb = b.now(bLocal + 16, false);
    expect(ta).toBeCloseTo(tb, 6);
    expect(poses(ta)).toHaveLength(14);
    for (const [pa, pb] of poses(ta).map((p, i) => [p, poses(tb)[i]] as const)) {
      expect(pa.x).toBeCloseTo(pb.x, 4);
      expect(pa.z).toBeCloseTo(pb.z, 4);
      expect(pa.yaw).toBeCloseTo(pb.yaw, 6);
    }
  });

  it("takes a new offset AT ONCE while the cars are not drawn", () => {
    const c = new TrafficClock();
    c.now(1000, true);
    c.setOffset(5000);
    expect(c.now(1016, false)).toBeCloseTo((1016 + 5000) / 1000, 9);
  });

  it("SLEWS toward it while drawn: bounded, monotonic, and it converges", () => {
    const c = new TrafficClock();
    let local = 10_000;
    c.now(local, true); // first frame: offset 0 is in force
    c.setOffset(2000); // the server is 2 s ahead
    let prev = c.now(local, true);
    for (let i = 0; i < 2000; i++) {
      local += 16;
      const t = c.now(local, true);
      const rate = (t - prev) / 0.016; // shared seconds per real second
      expect(rate).toBeGreaterThanOrEqual(1 - SLEW - 1e-9);
      expect(rate).toBeLessThanOrEqual(1 + SLEW + 1e-9);
      expect(t).toBeGreaterThan(prev); // never backwards
      prev = t;
    }
    expect(c.offsetMs).toBeCloseTo(2000, 6);
    // and a car's speed changes by no more than the slew while it catches up: no jump on screen
    const behind = new TrafficClock();
    behind.now(0, true);
    behind.setOffset(-1500);
    let p = behind.now(0, true);
    for (let i = 1; i <= 600; i++) { const t = behind.now(i * 16, true); expect(t).toBeGreaterThan(p); p = t; }
  });

  it("an offset too far out to slew is taken at once even on screen", () => {
    const c = new TrafficClock();
    c.now(0, true);
    c.setOffset((FAR_S + 1) * 1000);
    expect(c.now(16, true)).toBeCloseTo((16 + (FAR_S + 1) * 1000) / 1000, 9);
  });

  it("ignores a non-finite measurement", () => {
    const c = new TrafficClock();
    c.setOffset(1234);
    c.setOffset(Number.NaN);
    expect(c.targetMs).toBe(1234);
  });
});
