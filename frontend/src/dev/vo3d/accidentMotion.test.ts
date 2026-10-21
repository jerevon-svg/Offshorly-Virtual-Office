// S6 — THE ACCIDENT, PLAYED (world/accidentMotion + avatar/crashPose): an impact-driven crash — how hard and from
// which side sets the throw; rider and scooter go their own ways; the world shortens or turns a throw that would
// meet something solid; the same frame for everybody from the server's numbers; and the real skeleton plays it ON
// the ground.
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import fs, { readFileSync } from "node:fs";
import { CRASH, LIMB, SCOOTER_CRASH, accidentPlan, chooseReach, riderFrameAt, scooterPoseAt, type AccidentMotionInput, type RiderCrashFrame } from "./world/accidentMotion";
import { CrashPose, type CrashBodyFrame } from "./avatar/crashPose";
import { Avatar } from "./avatar/Avatar";
import { PlayerCamera } from "./player/PlayerCamera";
import type { EmployeeAvatar } from "./human/humanBaseContract";
import { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "./human/humanCatalogue";
import { HumanAvatar, setGlbFetcher } from "./human/HumanAvatar";
import { loadHumanGlb, publicPath } from "./human/humanGlb.testutil";

/** T-boned hard at speed (the server parity case) */
const HEAVY: AccidentMotionInput = { at: 1000, x: 100, z: 50, heading: 0.3, speed: 240, closing: 330, carHeading: 1.2, carSpeed: 150, nx: 0.6, nz: 0.8 };
/** a car nudging a slow scooter from behind */
const LIGHT: AccidentMotionInput = { at: 0, x: 0, z: 0, heading: Math.PI / 2, speed: 10, closing: 115, carHeading: 0, carSpeed: 125, nx: 1, nz: 0 };
/** T-boned: a car crossing at speed into the side of a scooter */
const SIDE: AccidentMotionInput = { at: 0, x: 0, z: 0, heading: 0, speed: 120, closing: 200, carHeading: 0, carSpeed: 200, nx: 1, nz: 0 };
/** riding into a nearly stopped car */
const MEDIUM: AccidentMotionInput = { at: 0, x: 0, z: 0, heading: Math.PI / 2, speed: 200, closing: 220, carHeading: Math.PI, carSpeed: 20, nx: -1, nz: 0 };

describe("the plan is the server's (backend scooter_accidents.accident_plan), to the digit", () => {
  // the backend's own numbers for the same three crashes (tests/test_scooter_accidents.py pins them too)
  const PY = {
    heavy: { severity: 0.8732717601679716, dx: 0.927554621259907, dz: 0.3736876029244085, restX: 257.42321773356196, restZ: 113.42171504638353, end: 3.5343957352279793 },
    light: { severity: 0.018518518518518517, dx: 0.9393727128473789, dz: 0.34289780745545134, restX: 37.21679303888432, restZ: 13.585189945399366, end: 2.563814852882868 },
    medium: { severity: 0.4074074074074074, dx: -0.9393727128473789, dz: -0.34289780745545145, restX: -28.106742992905833, restZ: -10.259762089286003, end: 2.8337356477230298 },
    side: { severity: 0.38257492710194374, dx: 0.986282308336916, dz: -0.16506728404382504, restX: 113.31596234136984, restZ: -18.964912971056453, end: 3.0201777826189913 },
  };
  it.each([["heavy", HEAVY], ["light", LIGHT], ["medium", MEDIUM], ["side", SIDE]] as const)("%s", (name, a) => {
    const p = accidentPlan(a), py = PY[name];
    expect(p.severity).toBeCloseTo(py.severity, 12);
    expect(p.scooter.dx).toBeCloseTo(py.dx, 12);
    expect(p.scooter.dz).toBeCloseTo(py.dz, 12);
    expect(p.restX).toBeCloseTo(py.restX, 9);
    expect(p.restZ).toBeCloseTo(py.restZ, 9);
    expect(p.end).toBeCloseTo(py.end, 9);
  });
  it("…with a reach, too", () => {
    const p = accidentPlan(HEAVY, { rider: { k: 0.5, turn: 0.3 }, scooter: { k: 0.4, turn: -0.3 } });
    expect(p.restX).toBeCloseTo(167.65381698950432, 9);
    expect(p.restZ).toBeCloseTo(55.62693469952855, 9);
  });
});

describe("how hard and from where", () => {
  const light = accidentPlan(LIGHT), medium = accidentPlan(MEDIUM), heavy = accidentPlan(HEAVY), side = accidentPlan(SIDE);
  it("light stumbles, medium is thrown and slides, heavy flies, bounces, rolls and skids far", () => {
    expect(light.severity).toBeLessThan(0.15);
    expect(heavy.severity).toBeGreaterThan(0.8);
    expect(light.rider.travel).toBeLessThan(45);
    expect(medium.rider.travel).toBeGreaterThan(light.rider.travel);
    expect(heavy.rider.travel).toBeGreaterThan(130); // S6 v1 threw everybody 24–56
    expect(heavy.rider.travel).toBeLessThanOrEqual(CRASH.MAX_TRAVEL);
    expect(light.rider.T2).toBe(0);
    expect(heavy.rider.T2).toBeGreaterThan(0.1);
    expect(heavy.rider.roll).toBe(1);
    expect(heavy.rider.T1).toBeGreaterThan(light.rider.T1);
    expect(heavy.rider.end).toBeGreaterThan(light.rider.end);
    // horizontal momentum, not a launch: the arc stays low
    const peak = Math.max(...Array.from({ length: 120 }, (_, i) => riderFrameAt(HEAVY, heavy, i / 120).y));
    expect(peak - (CRASH.DECK + CRASH.HIP)).toBeLessThan(12);
  });
  it("a rear hit dives forward onto the front; riding into a car goes over backwards; a side hit twists", () => {
    expect(light.kind).toBe("rear");
    expect(light.rider.faceUp).toBe(false);
    expect(Math.abs(light.rider.psi1 - light.rider.psi0)).toBeLessThan(0.5);
    expect(medium.kind).toBe("frontal");
    expect(medium.rider.faceUp).toBe(true);
    expect(side.kind).toBe("side");
    expect(Math.abs(side.rider.psi1 - side.rider.psi0)).toBeGreaterThan(0.3);
    // riding toward −z, the car comes from −x: their LEFT — the near (left) arm is flung up at the hit
    expect(side.rider.side).toBe(1);
    const hit = riderFrameAt(SIDE, side, 0.1).limbs;
    expect(hit[LIMB.ARM_L + 1]).toBeGreaterThan(hit[LIMB.ARM_R + 1]);
  });
  it("both are thrown away from the car, on lines of their own", () => {
    for (const [a, p] of [[LIGHT, light], [MEDIUM, medium], [HEAVY, heavy], [SIDE, side]] as const) {
      expect(p.rider.dx * p.nx + p.rider.dz * p.nz).toBeGreaterThanOrEqual(CRASH.MIN_AWAY - 1e-9);
      expect(p.scooter.dx * p.nx + p.scooter.dz * p.nz).toBeGreaterThanOrEqual(SCOOTER_CRASH.MIN_AWAY - 1e-9);
      expect(Math.acos(p.rider.dx * p.scooter.dx + p.rider.dz * p.scooter.dz)).toBeGreaterThan(0.2);
      const rest = scooterPoseAt(a, p, 30);
      expect(Math.hypot(rest.comX - p.rider.lieX, rest.comZ - p.rider.lieZ)).toBeGreaterThan(10);
    }
  });
});

describe("the rider: from the contact, smoothly, on the ground", () => {
  const plan = accidentPlan(HEAVY);
  const frames: RiderCrashFrame[] = Array.from({ length: Math.ceil((plan.rider.end + 0.3) * 60) }, (_, i) => riderFrameAt(HEAVY, plan, i / 60));
  it("starts exactly where the hit was, upright, facing the ride", () => {
    const f = frames[0];
    expect([f.x, f.z, f.y]).toEqual([HEAVY.x, HEAVY.z, CRASH.DECK + CRASH.HIP]);
    expect(f.q.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), plan.rider.psi0))).toBeLessThan(1e-6);
    expect(f.limbs.every((v) => v === 0)).toBe(true);
  });
  it("goes air → bounce → skid → lie → rise → done, and is standing, facing the way it got up, at the end", () => {
    const order = frames.map((f) => f.phase).filter((p, i, all) => p !== all[i - 1]);
    expect(order).toEqual(["air", "bounce", "skid", "lie", "rise", "done"]);
    const end = riderFrameAt(HEAVY, plan, plan.rider.end);
    expect(end.weight).toBe(0);
    expect([end.x, end.z]).toEqual([plan.rider.standX, plan.rider.standZ]);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(end.q).y).toBeCloseTo(1, 9);
  });
  it.each([["heavy", HEAVY], ["light", LIGHT], ["medium", MEDIUM], ["side", SIDE]] as const)("never jumps (%s): position, turn and every joint move a little each frame; the hips never go under the lying height", (_n, acc) => {
    const p = accidentPlan(acc);
    const frames = Array.from({ length: Math.ceil((p.rider.end + 0.3) * 60) }, (_, i) => riderFrameAt(acc, p, i / 60));
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(CRASH.MAX_SPEED / 60 + 0.5);
      expect(b.q.angleTo(a.q)).toBeLessThan(0.3);
      for (let c = 0; c < LIMB.COUNT; c++) expect(Math.abs(b.limbs[c] - a.limbs[c])).toBeLessThan(0.4);
      expect(b.y).toBeGreaterThanOrEqual(CRASH.LIE_HIP - 1e-6);
    }
  });
  it("arms and legs move on their own: flailing in the air, bracing for the ground, a knee drawn up lying", () => {
    const air = frames.filter((f) => f.phase === "air");
    const spread = (c: number) => Math.max(...air.map((f) => f.limbs[c])) - Math.min(...air.map((f) => f.limbs[c]));
    expect(spread(LIMB.ARM_L + 1)).toBeGreaterThan(0.5);
    expect(spread(LIMB.LEG_R)).toBeGreaterThan(0.2);
    const lies = frames.filter((f) => f.phase === "lie"), lie = lies[Math.floor(lies.length * 0.7)];
    expect(Math.max(lie.limbs[LIMB.LEG_L + 2], lie.limbs[LIMB.LEG_R + 2])).toBeGreaterThan(0.6);
  });
});

describe("the scooter: loses balance, tumbles, slides to rest on its side where the server says", () => {
  const plan = accidentPlan(HEAVY);
  it("starts as the ridden scooter (origin, yaw −heading, upright) and ends on its side at the server's rest", () => {
    const s0 = scooterPoseAt(HEAVY, plan, 0);
    expect(s0.x).toBeCloseTo(HEAVY.x, 9); expect(s0.z).toBeCloseTo(HEAVY.z, 9); expect(s0.y).toBeCloseTo(0, 9);
    expect([s0.yaw, s0.lean]).toEqual([-HEAVY.heading, 0]);
    const rest = scooterPoseAt(HEAVY, plan, 30);
    expect(rest.resting).toBe(true);
    expect([rest.comX, rest.comZ]).toEqual([plan.restX, plan.restZ]);
    expect(Math.abs(Math.cos(rest.lean))).toBeLessThan(1e-9);
    expect(scooterPoseAt(HEAVY, plan, 60)).toEqual(rest);
  });
  it("a heavy hit hops it, rolls it over and spins it; it never goes under the road; friction only slows it", () => {
    expect(plan.scooter.rolls).toBe(1);
    expect(Math.abs(plan.scooter.spin)).toBeGreaterThan(1.5);
    const s = plan.scooter;
    let prevStep = Infinity, prev: ReturnType<typeof scooterPoseAt> | null = null;
    for (let i = 0; i < (s.end + 1) * 60; i++) {
      const t = i / 60;
      const p = scooterPoseAt(HEAVY, plan, t);
      // its centre of mass stays above where a tipped body would rest on the ground
      expect(p.y + new THREE.Vector3(0, SCOOTER_CRASH.COM, 0).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), p.pitch)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), p.lean))).y).toBeGreaterThanOrEqual(SCOOTER_CRASH.LIE_COM - 1e-9);
      if (t > s.T1 + s.T2) {
        if (prev) {
          const step = Math.hypot(p.comX - prev.comX, p.comZ - prev.comZ);
          expect(step).toBeLessThanOrEqual(prevStep + 1e-9);
          prevStep = step;
        }
        prev = p;
      }
    }
    expect(plan.scooter.travel).toBeGreaterThan(130); // S6 v1's slide was a few dozen units
  });
});

describe("the world decides how far a throw may go", () => {
  it("nothing in the way: the whole throw", () => {
    expect(chooseReach(HEAVY, () => true)).toEqual({ rider: { k: 1, turn: 0 }, scooter: { k: 1, turn: 0 } });
  });
  it("a wall across the throw: shortened (or turned) so every point of it — and where they lie and stand — is clear", () => {
    const wall = (x: number, _z: number, r: number) => x + r < 180;
    const reach = chooseReach(HEAVY, wall);
    const p = accidentPlan(HEAVY, reach);
    expect(p.rider.travel).toBeLessThan(accidentPlan(HEAVY).rider.travel);
    for (let s = 8; s <= p.rider.travel; s += 2) expect(wall(HEAVY.x + p.rider.dx * s, HEAVY.z + p.rider.dz * s, 6)).toBe(true);
    expect(wall(p.rider.standX, p.rider.standZ, 8)).toBe(true);
    for (let s = 8; s <= p.scooter.travel; s += 2) expect(wall(HEAVY.x + p.scooter.dx * s, HEAVY.z + p.scooter.dz * s, 5)).toBe(true);
    // never turned back toward the car, and the same answer every time (every browser, the server's record)
    for (const b of [p.rider, p.scooter]) expect(b.dx * p.nx + b.dz * p.nz).toBeGreaterThan(0.1);
    expect(chooseReach(HEAVY, wall)).toEqual(reach);
  });
  it("blocked straight ahead but open to one side: it turns rather than stopping dead", () => {
    const base = accidentPlan(HEAVY);
    // a post right on the rider's line, 40 out
    const px = HEAVY.x + base.rider.dx * 40, pz = HEAVY.z + base.rider.dz * 40;
    const post = (x: number, z: number, r: number) => Math.hypot(x - px, z - pz) > 10 + r;
    const reach = chooseReach(HEAVY, post);
    expect(reach.rider.turn).not.toBe(0);
    expect(reach.rider.k).toBeGreaterThan(0.85);
  });
});

describe("the same crash, the same frame, for everybody", () => {
  it("a late joiner's plan and frame at 2 s are exactly an early viewer's", () => {
    const early = accidentPlan(HEAVY), late = accidentPlan({ ...HEAVY });
    const a = riderFrameAt(HEAVY, early, 2), b = riderFrameAt(HEAVY, late, 2);
    expect([b.x, b.z, b.y, b.phase, ...b.limbs]).toEqual([a.x, a.z, a.y, a.phase, ...a.limbs]);
    expect(b.q.equals(a.q)).toBe(true);
    expect(scooterPoseAt(HEAVY, late, 2)).toEqual(scooterPoseAt(HEAVY, early, 2));
  });
  it("the whole crash is over well inside the temporary cleanup (and the server never cleans up before it ends)", () => {
    for (const a of [LIGHT, MEDIUM, HEAVY]) expect(accidentPlan(a).end).toBeLessThan(8 - 1.5);
  });
});

describe("the bodies that play it", () => {
  it("an Avatar in a crash holds its clip (nothing walks or idles over the fall) and gives it back after", () => {
    const av = new Avatar({ height: 36, lit: true });
    const f = riderFrameAt(HEAVY, accidentPlan(HEAVY), 0.3);
    const frame: CrashBodyFrame = { hip: { x: f.x, y: f.y, z: f.z }, q: f.q, ground: 0, contact: f.contact, anchor: f.anchor, weight: f.weight, limbs: f.limbs };
    av.setCrash(frame);
    expect(av.inCrash).toBe(true);
    // no rig loaded: the whole body is tipped about its hips instead
    expect(av.root.quaternion.angleTo(f.q)).toBeLessThan(1e-6);
    av.setCrash(null);
    expect(av.inCrash).toBe(false);
    av.setYaw(1);
    expect(av.root.rotation.x).toBe(0);
  });
  it("the camera's impact nudge is small and dies away", () => {
    const cam = new PlayerCamera(new THREE.PerspectiveCamera(), 36, () => true);
    for (let i = 0; i < 600; i++) cam.update({ x: 0, z: 0 }, 1 / 60);
    const rest = cam.camera.position.clone();
    cam.kick(1.4);
    cam.update({ x: 0, z: 0 }, 1 / 60);
    expect(cam.camera.position.distanceTo(rest)).toBeLessThan(2.5);
    for (let i = 0; i < 30; i++) cam.update({ x: 0, z: 0 }, 1 / 60);
    expect(cam.camera.position.distanceTo(rest)).toBeLessThan(1e-6);
  });
});

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("on a real HumanBase body (avatar/crashPose)", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));
  it.each([["heavy", HEAVY], ["light", LIGHT], ["medium (onto the back)", MEDIUM], ["side", SIDE]] as const)("%s: tumbles on its joints, rests ON the ground (never in it, never over it), keeps its feet planted getting up, stands at the end", async (_n, ACC) => {
    const h = await HumanAvatar.create(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    const root = new THREE.Group(), model = new THREE.Group();
    root.add(model); model.add(h.root);
    const crash = new CrashPose(model);
    crash.setScene(h.scene);
    h.addLayer({ id: "crash", order: 40, update: (dt) => crash.update(dt) });
    h.play("idle-masculine", 0);
    h.actionFor("idle-masculine")!.timeScale = 0;
    expect(crash.rigged).toBe(true);
    const plan = accidentPlan(ACC);
    const bone = (n: string) => h.bones.get(n)!.getWorldPosition(new THREE.Vector3());
    const knee: number[] = [], drift: number[] = [];
    let f: RiderCrashFrame | undefined;
    for (let t = 0; t <= plan.rider.end; t += 1 / 30) {
      f = riderFrameAt(ACC, plan, t, f);
      root.position.set(f.x, 0, f.z);
      root.rotation.set(0, plan.rider.psi0, 0);
      root.updateMatrixWorld(true);
      crash.set({ hip: { x: f.x, y: f.y, z: f.z }, q: f.q, ground: 0, contact: f.contact, anchor: f.anchor, weight: f.weight, limbs: f.limbs });
      h.update(1 / 30);
      const low = crash.stats.lowest;
      expect(Number.isFinite(low)).toBe(true);
      if (f.contact >= 1 && f.weight > 0.5) expect(Math.abs(low), `${f.phase} at ${t.toFixed(2)}: lowest point ${low.toFixed(2)}`).toBeLessThan(0.05);
      else expect(low).toBeGreaterThan(-0.05);
      if (f.phase === "lie") {
        expect(bone("Hips").y).toBeLessThan(9); // a chibi lies a little propped on its big head
        expect(bone("Head").y).toBeLessThan(11);
      }
      if (f.phase === "air") knee.push(bone("LeftUpLeg").distanceTo(bone("LeftFoot")));
      if (f.phase === "rise" && f.anchor > 0.99) drift.push(crash.stats.feetDrift);
    }
    // the legs bend in the air (not a plank), the feet hold while getting up
    expect(Math.max(...knee) - Math.min(...knee)).toBeGreaterThan(0.3);
    expect(Math.max(...drift)).toBeLessThan(0.5);
    // done: the body its own again, upright
    crash.set(null);
    h.update(1 / 30);
    expect(bone("Head").y).toBeGreaterThan(14);
  }, 120_000);
});

describe("wiring", () => {
  const w = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
  it("a ride the server took in an accident plays the crash; the feed waits until they are up; both kinds of rider are played", () => {
    expect(w).toContain('const accident = reason === "taken" ? scooterAccidents.find((a) => a.scooterId === dock.id) : undefined;');
    expect(w).toContain("if (rideStreamed) { rideStreamed = false; ridePoseNow = null; if (!accident) selfFeed?.dismountedScooter(at, avatar.yaw); }");
    expect(w).toContain("updateRemoteFalls(env.lastTrafficTime);");
    expect(w).toContain("updateLocalFall(env.lastTrafficTime);");
    expect(w).toContain('stack.acquire("Interaction");');
    // the rider's world says how far the throws may go, and everybody's plan uses the server's record when it has one
    expect(w).toContain("if (!a.reach) scooterGate.reportAccidentReach(a.id, reach);");
    expect(w).toContain("accidentPlan(a, a.reach ?? chooseReach(a, throwClear(a)))");
    expect(w).toContain("avatar.setCrash(body);");
  });
});
