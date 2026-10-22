// S7 — GETTING IT BACK UP (world/liftMotion + avatar/crashPose + app/scooterGate): the lift starts from exactly how
// the crash left the scooter, rolls it up about the line it lies on, is the same for everybody, plays on the real
// skeleton with the feet planted, and E (lift, then ride) is asked of the server once.
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import fs, { readFileSync } from "node:fs";
import { CRASH, LIMB, accidentPlan, scooterPoseAt, type AccidentMotionInput } from "./world/accidentMotion";
import { LIFT, liftPlan, liftScooterAt, riderLiftAt, type RiderLiftFrame } from "./world/liftMotion";
import { CrashPose } from "./avatar/crashPose";
import { ScooterGate } from "./app/scooterGate";
import type { EmployeeAvatar } from "./human/humanBaseContract";
import { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "./human/humanCatalogue";
import { HumanAvatar, setGlbFetcher } from "./human/HumanAvatar";
import { loadHumanGlb, publicPath } from "./human/humanGlb.testutil";

const HEAVY: AccidentMotionInput = { at: 1000, x: 100, z: 50, heading: 0.3, speed: 240, closing: 330, carHeading: 1.2, carSpeed: 150, nx: 0.6, nz: 0.8 };
const SIDE: AccidentMotionInput = { at: 0, x: 0, z: 0, heading: 0, speed: 120, closing: 200, carHeading: 0, carSpeed: 200, nx: 1, nz: 0 };
const plan = accidentPlan(HEAVY);
const rest = scooterPoseAt(HEAVY, plan, 60);
const FROM = { x: rest.comX + 30, z: rest.comZ - 10 };
const lp = liftPlan(HEAVY, plan, FROM);

describe("the lift starts from how the crash left it", () => {
  it("the scooter is exactly where (and as) it lies — no snap at the E", () => {
    const s0 = liftScooterAt(lp, 0);
    expect([s0.x, s0.z, s0.yaw]).toEqual([rest.x, rest.z, rest.yaw]);
    expect(s0.y).toBeCloseTo(rest.y, 9);
    // the same roll (a heavy crash's barrel roll is whole turns: the same pose)
    expect(Math.cos(s0.lean)).toBeCloseTo(Math.cos(rest.lean), 9);
    expect(Math.sin(s0.lean)).toBeCloseTo(Math.sin(rest.lean), 9);
  });
  it("the rider stands on its TOP side beside the bar, facing it; it rides off the way it stands", () => {
    const top = { x: Math.sin(rest.lean) * Math.cos(rest.yaw), z: -Math.sin(rest.lean) * Math.sin(rest.yaw) };
    expect((lp.spotX - rest.x) * top.x + (lp.spotZ - rest.z) * top.z).toBeCloseTo(LIFT.STAND_OFF, 6);
    const facing = { x: Math.sin(lp.riderYaw), z: Math.cos(lp.riderYaw) };
    expect(facing.x * top.x + facing.z * top.z).toBeCloseTo(-1, 6);
    expect(lp.heading).toBe(-rest.yaw);
  });
  it("is the same for everybody (a late joiner's plan and frame are an early viewer's)", () => {
    const late = liftPlan(HEAVY, accidentPlan({ ...HEAVY }), { ...FROM });
    expect(late).toEqual(lp);
    const a = riderLiftAt(lp, 0.9), b = riderLiftAt(late, 0.9);
    expect([b.x, b.z, b.y, ...b.limbs]).toEqual([a.x, a.z, a.y, ...a.limbs]);
    expect(liftScooterAt(late, 0.9)).toEqual(liftScooterAt(lp, 0.9));
  });
});

describe("the scooter rolls back up and stands", () => {
  it("smoothly, monotonically, onto its wheels by UPRIGHT; then stays", () => {
    let prev = Math.abs(liftScooterAt(lp, 0).lean);
    for (let t = 0; t <= LIFT.TOTAL; t += 1 / 60) {
      const s = liftScooterAt(lp, t), l = Math.abs(s.lean);
      expect(l).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - l).toBeLessThan(0.12);
      expect(s.y).toBeGreaterThanOrEqual(-1e-9);
      prev = l;
    }
    const up = liftScooterAt(lp, LIFT.UPRIGHT);
    expect([up.lean, up.y, up.upright]).toEqual([0, 0, true]);
    expect(liftScooterAt(lp, 30)).toEqual(up);
    // the backend times LIFTING → UPRIGHT with the same numbers
    expect(LIFT.STEP + LIFT.CROUCH + LIFT.PULL).toBeCloseTo(LIFT.UPRIGHT, 9);
    expect(LIFT.UPRIGHT + LIFT.SETTLE).toBeCloseTo(LIFT.TOTAL, 9);
    const py = readFileSync("../backend/app/services/scooter_accidents.py", "utf8");
    expect(py).toContain(`LIFT_UPRIGHT_S = ${LIFT.UPRIGHT}`);
    expect(py).toContain(`LIFT_DONE_S = ${LIFT.TOTAL}`);
  });
});

describe("the rider: step in, crouch, pull, stand", () => {
  const frames: RiderLiftFrame[] = Array.from({ length: Math.ceil(LIFT.TOTAL * 60) + 2 }, (_, i) => riderLiftAt(lp, i / 60));
  it("steps from where E was pressed to the spot, then stays on it (feet planted from there)", () => {
    expect([frames[0].x, frames[0].z]).toEqual([FROM.x, FROM.z]);
    const there = frames.filter((_, i) => i / 60 >= LIFT.STEP);
    for (const f of there) { expect(f.x).toBeCloseTo(lp.spotX, 9); expect(f.z).toBeCloseTo(lp.spotZ, 9); }
    const planted = frames.filter((_, i) => i / 60 >= LIFT.STEP + 0.06 && i / 60 <= LIFT.UPRIGHT);
    expect(Math.min(...planted.map((f) => f.anchor))).toBeGreaterThan(0.99);
  });
  it("bends knees, hips and back to reach down, rises with the scooter, and gives the body back at the end", () => {
    const mid = riderLiftAt(lp, LIFT.STEP + LIFT.CROUCH);
    expect(mid.y).toBeCloseTo(LIFT.CROUCH_HIP, 6);
    expect(mid.limbs[LIMB.LEG_L + 2]).toBeGreaterThan(1.4);
    expect(mid.limbs[LIMB.SPINE]).toBeGreaterThan(0.6);
    expect(mid.limbs[LIMB.ARM_L]).toBeGreaterThan(0.8);
    const end = riderLiftAt(lp, LIFT.TOTAL);
    expect(end.y).toBeCloseTo(CRASH.HIP, 6);
    expect(end.weight).toBe(0);
    expect(end.done).toBe(true);
    for (let i = 1; i < frames.length; i++) {
      for (let c = 0; c < LIMB.COUNT; c++) expect(Math.abs(frames[i].limbs[c] - frames[i - 1].limbs[c])).toBeLessThan(0.2);
      expect(frames[i].q.angleTo(frames[i - 1].q)).toBeLessThan(0.15);
    }
  });
});

describe("E, asked of the server once (app/scooterGate)", () => {
  const gate = (claims: { id: string; at: unknown }[], lifts: string[], recover: { x: number; z: number } | null) => {
    const g = new ScooterGate({ ridingId: () => null, canMount: () => false, mountNow: () => true, dismountTaken: () => {}, render: () => {}, recoverAt: () => recover });
    g.setAuthority({ claim: (id, at) => { claims.push({ id, at }); return new Promise(() => {}); }, release: () => {}, liftAccident: (id) => { lifts.push(id); return new Promise(() => {}); } });
    g.registry.set("scooter-r1", { id: "scooter-r1", state: "fallen", mine: true });
    return g;
  };
  it("pressing E again while a lift is being asked for asks nothing more", () => {
    const lifts: string[] = [];
    const g = gate([], lifts, null);
    expect(g.lift("acc", { x: 1, z: 2 })).not.toBeNull();
    expect(g.lift("acc", { x: 1, z: 2 })).toBeNull();
    expect(lifts).toEqual(["acc"]);
  });
  it("a fallen scooter is ridden only from beside it, once it stands, with where I stand — never from its rack", () => {
    const claims: { id: string; at: unknown }[] = [];
    expect(gate(claims, [], null).request("scooter-r1")).toBe(false);
    expect(claims).toEqual([]);
    const g = gate(claims, [], { x: 5, z: 6 });
    g.request("scooter-r1");
    g.request("scooter-r1");
    expect(claims).toEqual([{ id: "scooter-r1", at: { x: 5, z: 6 } }]);
  });
});

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("the lift on a real HumanBase body", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));
  it("crouches on its joints with its feet ON the ground and planted, then stands", async () => {
    const h = await HumanAvatar.create(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    const root = new THREE.Group(), model = new THREE.Group();
    root.add(model); model.add(h.root);
    const crash = new CrashPose(model);
    crash.setScene(h.scene);
    h.addLayer({ id: "crash", order: 40, update: (dt) => crash.update(dt) });
    h.play("idle-masculine", 0);
    h.actionFor("idle-masculine")!.timeScale = 0;
    const p = liftPlan(SIDE, accidentPlan(SIDE), { x: 0, z: 0 });
    const bone = (n: string) => h.bones.get(n)!.getWorldPosition(new THREE.Vector3());
    let f: RiderLiftFrame | undefined;
    const drift: number[] = [], hips: number[] = [];
    for (let t = 0; t <= LIFT.TOTAL; t += 1 / 30) {
      f = riderLiftAt(p, t, f);
      root.position.set(f.x, 0, f.z);
      root.rotation.set(0, p.riderYaw, 0);
      root.updateMatrixWorld(true);
      crash.set({ hip: { x: f.x, y: f.y, z: f.z }, q: f.q, ground: 0, contact: f.contact, anchor: f.anchor, weight: f.weight, limbs: f.limbs, footLevel: f.footLevel });
      h.update(1 / 30);
      if (f.weight > 0.5) expect(Math.abs(crash.stats.lowest), `at ${t.toFixed(2)}`).toBeLessThan(0.05);
      if (f.anchor > 0.99) drift.push(crash.stats.feetDrift);
      hips.push(bone("Hips").y);
    }
    expect(Math.max(...drift)).toBeLessThan(0.5);
    // it really crouched (the hips came down) and stood again
    expect(Math.max(...hips) - Math.min(...hips)).toBeGreaterThan(1.5);
    crash.set(null);
    h.update(1 / 30);
    expect(bone("Head").y).toBeGreaterThan(14);
  }, 120_000);
});

describe("wiring", () => {
  const w = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
  it("the prompts, the E, the lift for both kinds of body, the ride from where it stands", () => {
    expect(w).toContain('label: "Lift scooter"');
    expect(w).toContain('label: "Ride scooter"');
    expect(w).toContain('if (kind === "ride") return id.startsWith("lift:") ? liftMine() : mountScooter(id);');
    expect(w).toContain("updateLocalLift(env.lastTrafficTime);");
    expect(w).toContain("const recovered = recoveredMount(id);");
    expect(w).toContain("recoverAt: (id) => recoverAt(id),");
    // only once they are up from the crash
    expect(w).toContain('if (why === "done") myAccident = f.accident.id;');
    expect(w).toContain("playerMode.active && !ridingDock && !localFall && !localLift");
  });
});
