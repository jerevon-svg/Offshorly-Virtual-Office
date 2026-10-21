// S4 RUNTIME BUG (found on the live :5174 rig, not by the earlier tests): the chain broke at the FIRST link for a
// walker. The world names the campus one frame AFTER the movement feed has seen the body cross V1's edge, so the
// feed set no anchor and published nothing out there — the server could not place the walker, refused every
// obstacle report as `body_unconfirmed`, and the car drove through them. Also pinned here: the cars are solid to
// the local body without ever trapping it, and a slow scooter ahead in the lane is in the car's way.
import { describe, expect, it } from "vitest";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import { readFileSync } from "node:fs";
import { SelfMovementFeed, type Vo3dSelfMovementSink } from "./app/selfMovement";
import { TRAFFIC_LOOPS, buildLoopPath } from "./world/traffic";
import { TrafficTimeline, VEHICLE_LENGTH, carStepBlocked, poseAtArc, type TrafficPose } from "./world/trafficHolds";
import { OBSTACLE, findBlocked } from "./world/trafficObstacles";

type V = { x: number; z: number };
function recorder() {
  const calls: string[] = [];
  const sink = {
    started: (o: V, p: readonly V[]) => calls.push(`started:${o.x},${o.z}>${p.map((q) => `${q.x},${q.z}`).join("|")}`),
    arrived: (p: V) => calls.push(`arrived:${p.x},${p.z}`),
    seated: () => calls.push("seated"),
    enteredPlace: (p: V, _y: number, place: string | null, local?: V) => calls.push(`entered:${place}@${p.x},${p.z}${local ? ` local ${local.x},${local.z}` : ""}`),
    movedInPlace: (_a: V, _f: V, to: readonly V[], _y: number, room: string) => calls.push(`moved:${room}>${to.map((q) => `${q.x},${q.z}`).join("|")}`),
  } as unknown as Vo3dSelfMovementSink;
  return { sink, calls };
}
const inFrame = (p: V) => p.x >= 0 && p.x <= 1440 && p.z >= 0 && p.z <= 1244;

describe("ROOT CAUSE — a place named a frame after the crossing still announces the walker out there", () => {
  it("crossing out with no place yet, then named: entered at the last in-frame point, standing where they are; then their steps", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.placed({ x: 700, z: 1200 });
    feed.frame(16, { x: 700, z: 1230 }, 0, false);
    calls.length = 0;
    feed.frame(16, { x: 700, z: 1300 }, 0, false); // OUT — and the world has not named the campus yet
    expect(calls.some((c) => c.startsWith("entered:"))).toBe(false);
    feed.entering("campus"); // the world names it on the next frame
    expect(calls.filter((c) => c.startsWith("entered:"))).toEqual(["entered:campus@700,1230 local 700,1300"]);
    // and every step out there is published from now on
    for (let i = 1; i <= 40; i++) feed.frame(16, { x: 700, z: 1300 + i * 2 }, 0, false);
    feed.frame(500, { x: 700, z: 1380 }, 0, false);
    expect(calls.some((c) => c.startsWith("moved:campus"))).toBe(true);
    // naming the same place again announces nothing more
    const n = calls.length;
    feed.entering("campus");
    expect(calls.length).toBe(n);
  });

  it("an exit named BEFORE the crossing (the AI Lab door) is announced once, as it always was", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.placed({ x: 700, z: 1200 });
    feed.entering("ai-lab");
    feed.frame(16, { x: 700, z: 1230 }, 0, false);
    feed.frame(16, { x: 700, z: 1300 }, 0, false);
    feed.entering("campus");
    expect(calls.filter((c) => c.startsWith("entered:")).length).toBe(1);
  });
});

const PATHS = TRAFFIC_LOOPS.map(buildLoopPath);
const T = 1_800_000_000;
const tl = new TrafficTimeline(PATHS);
const car = (): TrafficPose => { const o = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 }; tl.pose(0, 2, T, o); return o; };
/** a point `along` ahead of car A:2's centre and `side` to its left (heading convention: forward = (cos h, sin h)) */
const rel = (along: number, side: number) => { const o = car(); return { x: o.x + Math.cos(o.heading) * along - Math.sin(o.heading) * side, z: o.z + Math.sin(o.heading) * along + Math.cos(o.heading) * side }; };

describe("the cars are solid to this body — and never a trap", () => {
  it("inside a car's body is penetration; beside it, none", () => {
    expect(tl.penetration(rel(0, 0), 8, T)).toBeGreaterThan(20);
    expect(tl.penetration(rel(0, 60), 8, T)).toBe(0);
    expect(tl.penetration(rel(VEHICLE_LENGTH.sport / 2 + 20, 0), 8, T)).toBe(0);
  });

  it("walking INTO the car is refused; walking past, or OUT of one it came to rest against, never is", () => {
    const front = rel(VEHICLE_LENGTH.sport / 2 + 10, 0); // just ahead of the bumper
    expect(carStepBlocked(tl, front, rel(VEHICLE_LENGTH.sport / 2 + 2, 0), 8, T)).toBe(true); // into the grille
    expect(carStepBlocked(tl, rel(0, 50), rel(5, 50), 8, T)).toBe(false); // alongside it
    const stuck = rel(VEHICLE_LENGTH.sport / 2 - 6, 0); // a car stopped on top of them (an emergency stop)
    expect(carStepBlocked(tl, stuck, rel(VEHICLE_LENGTH.sport / 2 - 6, 8), 8, T)).toBe(false); // sideways out: fine
    expect(carStepBlocked(tl, stuck, rel(VEHICLE_LENGTH.sport / 2 + 4, 0), 8, T)).toBe(false); // forwards out: fine
    expect(carStepBlocked(tl, stuck, rel(VEHICLE_LENGTH.sport / 2 - 20, 0), 8, T)).toBe(true); // deeper: no
  });
});

describe("a scooter slower than the car, ahead of it in its lane, is in its way", () => {
  it("riding along at 130 in front of a car doing 160 is braked for; outrunning it is not", () => {
    const o = car();
    const half = VEHICLE_LENGTH.sport / 2;
    const p = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
    poseAtArc(PATHS[0], tl.arc(0, 2, T) + half + 220, p);
    const along = (v: number) => ({ x: p.x, z: p.z, vx: Math.cos(p.heading) * v, vz: Math.sin(p.heading) * v, kind: "ride" as const });
    expect(o.speed).toBeGreaterThan(150);
    expect(findBlocked(tl, T, along(130), () => OBSTACLE.ENTER)[0]?.vehicle).toBe(2);
    expect(findBlocked(tl, T, along(250), () => OBSTACLE.ENTER)[0]).toBeNull();
  });
});

describe("a car running late reports its real speed (the live readout said 240 on a restart)", () => {
  it("after earlier holds left it behind schedule, a restart ramps up and never reads above its catch-up pace", () => {
    const late = new TrafficTimeline(PATHS);
    const off = PATHS[0].offsets[0];
    // 37 s behind schedule (several earlier stops), then held again and released
    const p0 = T + off - 37;
    late.setState(new Map([["A:0", { d0: 37, t0: T, hold: { id: "h", stopP: p0 + 2, b: 1.1, releaseAt: T + 10, emergency: false } }]]));
    const o = { x: 0, z: 0, yaw: 0, heading: 0, speed: 0 };
    let prev = 0, peak = 0;
    for (let t = T + 9; t < T + 16; t += 1 / 30) {
      late.pose(0, 0, t, o);
      peak = Math.max(peak, o.speed);
      expect(Math.abs(o.speed - prev)).toBeLessThan(8);
      prev = o.speed;
    }
    expect(peak).toBeLessThanOrEqual(172 * 1.0 + 1); // the loop's top speed — never 1.5×
  });
});

describe("wiring", () => {
  const w = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
  it("Player View walking and riding both test the cars; the feed is told the place every frame", () => {
    expect(w).toContain("canStand: (p: Vec2, motion?: TraversalState) => playerStand(p, motion) && !(carBlocks?.(p, NAV_RADIUS) ?? false)");
    expect(w).toContain("canStand: (p: Vec2, motion?: TraversalState) => rideStand(p, motion) && !(carBlocks?.(p, RIDE_CAR_RADIUS) ?? false)");
    expect(w).toContain("return carStepBlocked(trafficTimeline, playerMode.body.pos, p, radius, env.lastTrafficTime);");
  });
  it("the cars become solid only AFTER `currentFloor` exists (assigning it earlier crashed the world's start-up)", () => {
    const declared = w.indexOf("  let currentFloor: Vo3dFloorId = GROUND_FLOOR_ID;");
    const assigned = w.indexOf("  carBlocks = (p, radius) => {");
    expect(declared).toBeGreaterThan(0);
    expect(assigned).toBeGreaterThan(declared);
  });
  it("only a streamed RIDE is ever checked for an accident — a pedestrian a car reaches is braked for, never thrown", () => {
    expect(w).toContain("if (!rideStreamed || !ridingDock || !ridePoseNow || !Number.isFinite(t) || currentFloor !== GROUND_FLOOR_ID) { crashPrev = null; return; }");
    // every way off a scooter — stepping off, the server taking it, the end of a crash — tells the movement feed
    // where they stand (app/selfMovement anchors it on the campus: the 2026-10-21 regression)
    expect(w).toContain("if (rideStreamed) { rideStreamed = false; ridePoseNow = null; if (!accident) selfFeed?.dismountedScooter(at, avatar.yaw); }");
    expect(w).toContain("selfFeed?.dismountedScooter({ ...playerMode.body.pos }, avatar.yaw);");
  });
});
