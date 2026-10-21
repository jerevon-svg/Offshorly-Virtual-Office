// S4 — TRAFFIC THAT STOPS: the hold timeline (world/trafficHolds), the queue behind a stopped car, obstacle
// detection (world/trafficObstacles), and the same numbers the server uses (backend traffic_model.py).
import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import { readFileSync } from "node:fs";
import { TRAFFIC_LOOPS, buildLoopPath, poseAt } from "./world/traffic";
import { HOLD, TrafficTimeline, VEHICLE_LENGTH, arcAtPathTime, fold, holdDoneAt, pathTimeAtArc, poseAtArc, vehicleKey, vehiclePathTime, type TrafficPose, type VehicleTimeline } from "./world/trafficHolds";
import { OBSTACLE, ObstacleReporter, findBlocked } from "./world/trafficObstacles";

const PATHS = TRAFFIC_LOOPS.map(buildLoopPath);
const T0 = 1_800_000_000;
const pose = (): TrafficPose => ({ x: 0, z: 0, yaw: 0, heading: 0, speed: 0 });
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** a hold the way the server makes one for a cruising car: stop `ahead` seconds of path time out, released at `release` */
function holdFor(li: number, vi: number, now: number, ahead: number, release: number | null): VehicleTimeline {
  const p = now + PATHS[li].offsets[vi];
  return { d0: 0, t0: now, hold: { id: "h", stopP: p + ahead, b: Math.min(HOLD.TB, ahead), releaseAt: release, emergency: false } };
}

describe("the hold timeline is the server's, number for number", () => {
  const H: VehicleTimeline = { d0: 0, t0: 0, hold: { id: "h", stopP: 50, b: 1.1, releaseAt: 60, emergency: false } };
  it("brakes onto its stop, waits, restarts — the backend test's own values", () => {
    const p = (t: number) => vehiclePathTime(0, H, t);
    expect([p(40), p(48.9)]).toEqual([40, 48.9]);
    expect(p(50)).toBeCloseTo(49.725, 12);
    expect([p(51.1), p(55), p(60)]).toEqual([50, 50, 50]);
    expect(p(61)).toBeCloseTo(50.17857142857143, 12);
    expect(p(62.8)).toBeCloseTo(51.4, 12);
    expect(p(70)).toBeCloseTo(58.6, 12);
    expect(holdDoneAt(0, H)).toBeCloseTo(62.8, 12);
    const f = fold(0, H, 100);
    expect(f.hold).toBeNull();
    expect(f.d0).toBeCloseTo(11.4, 9);
  });

  it("uses the server's constants and loops (backend app/services/traffic_model.py)", () => {
    const py = readFileSync("../backend/app/services/traffic_model.py", "utf8");
    const num = (name: string) => Number(py.match(new RegExp(`^${name} = ([0-9.]+)`, "m"))![1]);
    expect([num("TB"), num("MIN_B"), num("TA"), num("RHO")]).toEqual([HOLD.TB, HOLD.MIN_B, HOLD.TA, HOLD.RHO]);
    for (const [k, v] of Object.entries(VEHICLE_LENGTH)) expect(py).toContain(`"${k}": ${v}`);
    for (const l of TRAFFIC_LOOPS) {
      expect(py).toContain(`"id": "${l.id}", "dir": ${l.dir}, "r": ${l.r}, "xw": ${l.xw}, "xe": ${l.xe}, "zn": ${l.zn}, "zs": ${l.zs}, "cruise": ${l.cruise}, "corner": ${l.corner}, "accel": ${l.accel}`);
      expect(py).toContain(`"gaps": (${l.vehicles.map((v) => v.gap.toFixed(1)).join(", ")})`);
    }
  });
});

describe("TrafficTimeline", () => {
  it("WITHOUT HOLDS every car is exactly where it always was", () => {
    const tl = new TrafficTimeline(PATHS);
    const a = pose(), b = pose();
    for (const t of [T0, T0 + 17.3, T0 + 123.45]) PATHS.forEach((p, li) => p.offsets.forEach((_, vi) => {
      tl.pose(li, vi, t, a);
      poseAt(p, vi, t, b);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-6);
      expect(a.heading).toBeCloseTo(b.heading, 6);
    }));
  });

  it("arc and path time are inverse; a pose by arc is the pose by time", () => {
    const p = PATHS[1];
    for (const t of [0, 12.5, 80]) {
      expect(pathTimeAtArc(p, arcAtPathTime(p, t))).toBeCloseTo(t, 6);
      const a = pose(), b = pose();
      poseAtArc(p, arcAtPathTime(p, t), a);
      poseAt(p, 0, t - p.offsets[0], b);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-6);
    }
  });

  it("a held car BRAKES smoothly onto its stop and RESTARTS smoothly — no frozen frame, no jump", () => {
    const tl = new TrafficTimeline(PATHS);
    tl.setState(new Map([[vehicleKey("A", 2), holdFor(0, 2, T0, 3, T0 + 12)]]));
    const speeds: number[] = [];
    const o = pose();
    for (let t = T0; t < T0 + 20; t += 1 / 30) { tl.pose(0, 2, t, o); speeds.push(o.speed); }
    for (let i = 1; i < speeds.length; i++) expect(Math.abs(speeds[i] - speeds[i - 1])).toBeLessThan(6); // ≤ ~180 u/s²
    expect(Math.min(...speeds)).toBeLessThan(1); // it really stops
    expect(speeds[speeds.length - 1]).toBeGreaterThan(100); // and really goes again
  });

  it("the cars behind QUEUE: never overlapping, never overtaking, and they pull away after their leader in order", () => {
    const tl = new TrafficTimeline(PATHS);
    // stop A:2 (the white sport) for half a minute — long enough for the loop's next cars to bunch up behind
    tl.setState(new Map([[vehicleKey("A", 2), holdFor(0, 2, T0, 3, T0 + 40)]]));
    const L = PATHS[0].length;
    const order = PATHS[0].offsets.map((o, i) => ({ o, i })).sort((a, b) => a.o - b.o).map((e) => e.i);
    let queued = 0;
    const startedAt = new Map<number, number>();
    for (let t = T0; t < T0 + 70; t += 1 / 20) {
      for (let k = 0; k < order.length; k++) {
        const f = order[k], lead = order[(k + 1) % order.length];
        const gap = mod(tl.arc(0, lead, t) - tl.arc(0, f, t), L);
        const min = (VEHICLE_LENGTH[TRAFFIC_LOOPS[0].vehicles[f].kind] + VEHICLE_LENGTH[TRAFFIC_LOOPS[0].vehicles[lead].kind]) / 2;
        expect(gap, `t+${(t - T0).toFixed(1)} car ${f} behind ${lead}`).toBeGreaterThan(min); // bumpers never meet
        if (gap < min + HOLD.GAP + 20) queued++;
      }
      for (const vi of [2, order[order.indexOf(2) - 1]]) if (!startedAt.has(vi) && t > T0 + 40 && tl.rate(0, vi, t) > 0.2) startedAt.set(vi, t);
    }
    expect(queued).toBeGreaterThan(0); // somebody really did queue
    const follower = order[order.indexOf(2) - 1];
    expect(startedAt.get(follower)!).toBeGreaterThan(startedAt.get(2)!); // the leader goes first
  });

  it("several holds at once, on both loops, still never overlap", () => {
    const tl = new TrafficTimeline(PATHS);
    tl.setState(new Map([
      [vehicleKey("A", 0), holdFor(0, 0, T0, 2, T0 + 25)],
      [vehicleKey("A", 4), holdFor(0, 4, T0, 1, T0 + 10)],
      [vehicleKey("B", 3), holdFor(1, 3, T0, 2.5, null)],
    ]));
    for (let t = T0; t < T0 + 60; t += 0.25) PATHS.forEach((p, li) => {
      const xs = p.offsets.map((_, vi) => { const o = pose(); tl.pose(li, vi, t, o); return o; });
      for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) expect(Math.hypot(xs[i].x - xs[j].x, xs[i].z - xs[j].z)).toBeGreaterThan(50);
    });
    const o = pose(); tl.pose(1, 3, T0 + 60, o);
    expect(o.speed).toBeLessThan(1e-6); // B:3 is never released
  });

  it("two browsers given the same holds draw the same cars", () => {
    const state = new Map([[vehicleKey("B", 5), holdFor(1, 5, T0, 2, T0 + 8)]]);
    const a = new TrafficTimeline(PATHS), b = new TrafficTimeline(TRAFFIC_LOOPS.map(buildLoopPath));
    a.setState(state); b.setState(new Map(state));
    const pa = pose(), pb = pose();
    for (const t of [T0 + 1, T0 + 5, T0 + 9.3]) for (let vi = 0; vi < 7; vi++) {
      a.pose(1, vi, t, pa); b.pose(1, vi, t, pb);
      expect([pa.x, pa.z]).toEqual([pb.x, pb.z]);
    }
  });
});

describe("obstacle detection — in the car's way, or not", () => {
  const tl = new TrafficTimeline(PATHS);
  /** a point in car A:2's lane, `along` ahead of its front bumper, `lateral` off the centre line */
  const lane = (along: number, lateral = 0, t = T0) => {
    const half = VEHICLE_LENGTH.sport / 2;
    const o = pose();
    poseAtArc(PATHS[0], tl.arc(0, 2, t) + half + along, o);
    return { x: o.x - Math.sin(o.heading) * lateral, z: o.z + Math.cos(o.heading) * lateral, h: o.heading };
  };
  const body = (p: { x: number; z: number }, vx = 0, vz = 0) => ({ x: p.x, z: p.z, vx, vz, kind: "walk" as const });
  const enter = () => OBSTACLE.ENTER;

  it("a body ahead in the lane holds up THAT car, the nearest one approaching", () => {
    const hit = findBlocked(tl, T0, body(lane(200)), enter);
    expect(hit[0]?.vehicle).toBe(2);
    expect(hit[0]!.along).toBeGreaterThan(150);
    expect(hit[1]).toBeNull();
  });

  it("not behind it, not on the sidewalk, not when keeping pace with the traffic", () => {
    expect(findBlocked(tl, T0, body(lane(-150)), enter)[0]?.vehicle).not.toBe(2);
    expect(findBlocked(tl, T0, body(lane(200, 120)), enter)[0]).toBeNull();
    const p = lane(200);
    expect(findBlocked(tl, T0, body(p, Math.cos(p.h) * 200, Math.sin(p.h) * 200), enter)[0]).toBeNull(); // outrunning it at 200
    expect(findBlocked(tl, T0, body(p, Math.cos(p.h) * 40, Math.sin(p.h) * 40), enter)[0]?.vehicle).toBe(2); // a slow scooter is in the way
  });

  it("a crossing is braked for BEFORE the body is in the lane (its step carried ahead)", () => {
    const side = lane(220, 60);
    const towards = { vx: -(side.x - lane(220).x) / 0.5, vz: -(side.z - lane(220).z) / 0.5 }; // reaches the centre in 0.5 s
    expect(findBlocked(tl, T0, body(side), enter)[0]).toBeNull();
    expect(findBlocked(tl, T0, body(side, towards.vx, towards.vz), enter)[0]?.vehicle).toBe(2);
  });

  it("the reporter: one report, keep-alives, a clear only after CLEAR_MS clear — and at once when the body leaves the ground", () => {
    const r = new ObstacleReporter();
    const inLane = body(lane(200)), out = body(lane(200, 200));
    expect(r.update(0, tl, T0, inLane)).toEqual([expect.objectContaining({ loop: "A", vehicle: 2 })]);
    expect(r.update(100, tl, T0, inLane)).toEqual([]);
    expect(r.update(OBSTACLE.KEEPALIVE_MS + 10, tl, T0, inLane)).toEqual([expect.objectContaining({ vehicle: 2 })]);
    // a step half out (inside EXIT, outside ENTER) still counts: hysteresis
    expect(r.update(800, tl, T0, body(lane(200, (OBSTACLE.ENTER + OBSTACLE.EXIT) / 2)))).toEqual([]);
    expect(r.holding[0]).toBe(2);
    expect(r.update(900, tl, T0, out)).toEqual([]);
    expect(r.update(900 + OBSTACLE.CLEAR_MS + 10, tl, T0, out)).toEqual([expect.objectContaining({ vehicle: 2, clear: true })]);
    expect(r.holding[0]).toBeNull();
    r.update(3000, tl, T0, inLane);
    expect(r.update(3100, tl, T0, null)).toEqual([expect.objectContaining({ vehicle: 2, clear: true })]);
  });
});

describe("wiring", () => {
  const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it("the cars are drawn from the shared timeline; this employee is checked ten times a second, on the campus only", () => {
    const w = strip("src/dev/vo3d/app/world.ts");
    expect(w).toContain("scenery.setTrafficPoser((li, vi, t, out) => trafficTimeline.pose(li, vi, t, out));");
    expect(w).toContain("updateTrafficObstacles(dt);");
    expect(w).toContain('const outside = currentFloor === GROUND_FLOOR_ID && !liftActive() && caveTransition?.state.where !== "cave" && !inOfficeDomain(pos) && !inLabDomain(pos);');
    expect(strip("src/dev/vo3d/env/Environment.ts")).toContain("this.lastTrafficTime = this.trafficClock ? this.trafficClock() : shared;");
  });
});
