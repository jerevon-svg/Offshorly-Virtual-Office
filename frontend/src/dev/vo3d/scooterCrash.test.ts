// S5 — DID THE SCOOTER JUST HIT A CAR? (world/scooterCrash): a genuine crash is an accident; braking, bumps and
// keeping pace are not; the check is swept so no frame gap lets anything through.
import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import { readFileSync } from "node:fs";
import { ACCIDENT, assessContact, sweepContact } from "./world/scooterCrash";
import { TRAFFIC_LOOPS, buildLoopPath } from "./world/traffic";
import { HOLD, TrafficTimeline, VEHICLE_LENGTH, vehicleKey, type TrafficPose } from "./world/trafficHolds";

const L = VEHICLE_LENGTH.sport, W = 56;
/** a car at the origin heading +x (traffic convention: along (cos h, sin h)) at `speed` */
const car = (speed: number): TrafficPose => ({ x: 0, z: 0, yaw: 0, heading: 0, speed });
/** a scooter heading so that it moves along world (dx, dz) (ride convention: along (sin h, −cos h)) */
const moving = (x: number, z: number, dx: number, dz: number, speed: number) => ({ x, z, heading: Math.atan2(dx, -dz), speed });

describe("assessContact — how hard, not just whether", () => {
  it("riding head-on into a moving car's front at speed is an accident; the closing speed adds up", () => {
    const hit = assessContact(moving(L / 2 + 10, 0, -1, 0, 200), car(160), L, W);
    expect(hit.touching).toBe(true);
    expect(hit.closing).toBeCloseTo(360, 6);
    expect(hit.kind).toBe("accident");
  });

  it("drifting sideways into a moving car's flank is an accident", () => {
    // coming in from the side (−z) at 150 while the car drives by at 160
    expect(assessContact(moving(0, -(W / 2 + 10), 0, 1, 150), car(160), L, W).kind).toBe("accident");
  });

  it("a car that BRAKED to a stop is bumped, not crashed into — unless it is a real smash", () => {
    expect(assessContact(moving(L / 2 + 10, 0, -1, 0, 140), car(0), L, W).kind).toBe("gentle");
    expect(assessContact(moving(L / 2 + 10, 0, -1, 0, ACCIDENT.HARD_INTO_STOPPED + 20), car(0), L, W).kind).toBe("accident");
  });

  it("gentle: rolling into one slowly, or keeping pace alongside; nothing at all when not touching", () => {
    expect(assessContact(moving(L / 2 + 10, 0, -1, 0, 30), car(0), L, W).kind).toBe("gentle");
    expect(assessContact(moving(0, W / 2 + 10, 1, 0, 160), car(160), L, W).kind).toBe("gentle");
    expect(assessContact(moving(L / 2 + 10, 0, 1, 0, 200), car(160), L, W).kind).toBe("gentle"); // pulling away ahead
    expect(assessContact(moving(L / 2 + 60, 0, -1, 0, 300), car(160), L, W).kind).toBe("none");
  });
});

describe("sweepContact — no frame gap lets anything through", () => {
  const PATHS = TRAFFIC_LOOPS.map(buildLoopPath);
  const T = 1_800_000_000;
  const tl = new TrafficTimeline(PATHS);
  const at = (t: number) => { const o: TrafficPose = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 }; tl.pose(0, 2, t, o); return o; };

  it("a car driving THROUGH a scooter's spot inside one long frame (1 s) is caught by the sweep", () => {
    const mid = at(T + 0.5); // the car will be exactly here halfway through the frame
    const sc = { x: mid.x, z: mid.z, heading: 0, speed: 0 };
    // at either end of the frame the car is ~80 units from the spot — past its own half-length: a single
    // sample at either end MISSES it entirely
    expect(assessContact(sc, at(T), L, W).touching).toBe(false);
    expect(assessContact(sc, at(T + 1), L, W).touching).toBe(false);
    const far = { x: mid.x + Math.cos(mid.heading) * (L / 2 + 80), z: mid.z + Math.sin(mid.heading) * (L / 2 + 80) };
    const away = Math.atan2(Math.cos(mid.heading), -Math.sin(mid.heading));
    expect(sweepContact(tl, { ...far, heading: away, speed: 0, t: T - 1 }, { ...far, heading: away, speed: 0, t: T - 0.6 })).toBeNull(); // nowhere near: nothing
    const hit = sweepContact(tl, { ...sc, t: T }, { ...sc, t: T + 1 });
    expect(hit).not.toBeNull();
    expect(hit!.vehicle).toBe(2);
    expect(hit!.t).toBeGreaterThan(T);
    expect(hit!.t).toBeLessThan(T + 1);
  });

  it("a fast scooter crossing a moving car's path in one frame is an accident, found at the first touch", () => {
    const c = at(T);
    const side = { x: -Math.sin(c.heading), z: Math.cos(c.heading) }; // the car's left
    const from = { x: c.x + side.x * 70, z: c.z + side.z * 70 }, to = { x: c.x - side.x * 70, z: c.z - side.z * 70 };
    const heading = Math.atan2(to.x - from.x, -(to.z - from.z));
    const hit = sweepContact(tl, { ...from, heading, speed: 350, t: T }, { ...to, heading, speed: 350, t: T + 0.4 });
    expect(hit?.kind).toBe("accident");
    // first touch: still on the near side of the car
    expect((hit!.x - c.x) * side.x + (hit!.z - c.z) * side.z).toBeGreaterThan(0);
  });

  it("a car held for the rider (S4) and stopped is only bumped at cruise", () => {
    const held = new TrafficTimeline(PATHS);
    const off = PATHS[0].offsets[2];
    held.setState(new Map([[vehicleKey("A", 2), { d0: 0, t0: T - 30, hold: { id: "h", stopP: T - 20 + off, b: HOLD.TB, releaseAt: null, emergency: false } }]]));
    const o: TrafficPose = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
    held.pose(0, 2, T, o);
    expect(o.speed).toBeLessThan(1e-6);
    const front = { x: o.x + Math.cos(o.heading) * (L / 2 + 12), z: o.z + Math.sin(o.heading) * (L / 2 + 12) };
    const into = Math.atan2(-Math.cos(o.heading), Math.sin(o.heading));
    expect(sweepContact(held, { ...front, heading: into, speed: 150, t: T - 0.016 }, { ...front, heading: into, speed: 20, t: T })?.kind).toBe("gentle");
  });
});

describe("wiring", () => {
  const w = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
  it("the rider's own browser checks, once per frame; a confirmed accident halts the ride; fallen scooters are drawn", () => {
    expect(w).toContain("updateCrash();");
    expect(w).toContain("renderFallen();");
    expect(w).toContain("playerMode.haltRide();");
    expect(w).toContain("if (!rideStreamed || !ridingDock || !ridePoseNow || !Number.isFinite(t) || currentFloor !== GROUND_FLOOR_ID) { crashPrev = null; return; }");
  });
});
