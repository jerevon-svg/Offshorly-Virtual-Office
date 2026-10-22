// THE SPRINT (player/Momentum, avatar/gaitPose, avatar/gait, app/selfMovement, world/coworkerWalk): a faster walk and
// a true sprint that build up, skid to a stop, lean into their turns, never go through anything, look like a
// sprint and a skid on the real skeleton, and are seen the same way by everybody else.
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import fs, { readFileSync } from "node:fs";
import { MOMENTUM, Momentum, skidFrom } from "./player/Momentum";
import { PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "./player/PlayerMode";
import { PlayerBody } from "./player/PlayerBody";
import { GaitPose } from "./avatar/gaitPose";
import { HB_RUN_FROM, HUMANBASE_CLIP_GROUND_SPEED, locomotion, sprintStride } from "./avatar/gait";
import { CLIP_RUN, CLIP_WALK } from "./adapters/v1Avatar";
import { SelfMovementFeed, type Vo3dSelfMovementSink } from "./app/selfMovement";
import { ReplayWalk } from "./world/coworkerWalk";
import type { EmployeeAvatar } from "./human/humanBaseContract";
import { BON_AVATAR, CATALOGUE_BY_ID, HUMAN_BASE_URL } from "./human/humanCatalogue";
import { HumanAvatar, setGlbFetcher } from "./human/HumanAvatar";
import { loadHumanGlb, publicPath } from "./human/humanGlb.testutil";

const F = { x: 1, z: 0 };
/** run the momentum for `s` seconds at 60 fps */
function run(m: Momentum, want: { x: number; z: number } | null, top: number, sprint: boolean, s: number) {
  const out: { speed: number; brake: number; bank: number; x: number }[] = [];
  let x = 0;
  for (let i = 0; i < Math.round(s * 60); i++) { const st = m.step(want, top, sprint, 1 / 60); x += st.dx; out.push({ speed: st.speed, brake: st.brake, bank: st.bank, x }); }
  return out;
}

describe("the speeds: a 1.3x walk, a 2x sprint", () => {
  it("is 54.6 and 200 (were 42 and 100) — the speeds the body really travels", () => {
    expect(PLAYER_WALK_SPEED).toBeCloseTo(42 * 1.3, 9);
    expect(PLAYER_SPRINT_SPEED).toBe(100 * 2);
    const walk = new Momentum(); run(walk, F, PLAYER_WALK_SPEED, false, 1);
    expect(walk.speed).toBeCloseTo(PLAYER_WALK_SPEED, 6);
    const sprint = new Momentum(); run(sprint, F, PLAYER_SPRINT_SPEED, true, 2);
    expect(sprint.speed).toBeCloseTo(PLAYER_SPRINT_SPEED, 6);
  });
  it("a walk answers at once; a sprint builds up over ~0.6 s", () => {
    const walk = run(new Momentum(), F, PLAYER_WALK_SPEED, false, 0.5);
    expect(walk.findIndex((f) => f.speed >= PLAYER_WALK_SPEED - 1e-6) / 60).toBeLessThan(0.15);
    const sprint = run(new Momentum(), F, PLAYER_SPRINT_SPEED, true, 2);
    const t = sprint.findIndex((f) => f.speed >= PLAYER_SPRINT_SPEED - 1e-6) / 60;
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(0.8);
  });
});

describe("stopping: a step from a walk, a skid from a sprint", () => {
  it("from a walk: stopped within a few units, in under a tenth of a second, no skid pose", () => {
    const stop = skidFrom(PLAYER_WALK_SPEED);
    expect(stop.distance).toBeLessThan(3);
    expect(stop.seconds).toBeLessThan(0.1);
    const m = new Momentum(); run(m, F, PLAYER_WALK_SPEED, false, 1);
    expect(Math.max(...run(m, null, 0, false, 0.3).map((f) => f.brake))).toBe(0);
  });
  it("from a full sprint: a visible skid (~40 u, ~0.4 s) that slows all the way, never backwards, with the braking pose", () => {
    const stop = skidFrom(PLAYER_SPRINT_SPEED);
    expect(stop.distance).toBeGreaterThan(30);
    expect(stop.distance).toBeLessThan(55);
    expect(stop.seconds).toBeGreaterThan(0.3);
    expect(stop.seconds).toBeLessThan(0.55);
    const m = new Momentum(); run(m, F, PLAYER_SPRINT_SPEED, true, 2);
    const skid = run(m, null, 0, false, 1);
    for (let i = 1; i < skid.length; i++) { expect(skid[i].speed).toBeLessThanOrEqual(skid[i - 1].speed + 1e-9); expect(skid[i].x).toBeGreaterThanOrEqual(skid[i - 1].x - 1e-9); }
    expect(Math.max(...skid.map((f) => f.brake))).toBeGreaterThan(0.8);
    expect(skid[skid.length - 1].speed).toBe(0);
    expect(skid[skid.length - 1].brake).toBeLessThan(0.05);
    // longer from faster
    expect(skidFrom(150).distance).toBeLessThan(stop.distance);
  });
});

describe("turning at speed: momentum, not a snap", () => {
  it("a hard reversal plants (skid pose), slows through, and pushes off the other way — no instant 180°", () => {
    const m = new Momentum(); run(m, F, PLAYER_SPRINT_SPEED, true, 2);
    const rev = run(m, { x: -1, z: 0 }, PLAYER_SPRINT_SPEED, true, 1.5);
    expect(rev[0].speed).toBeGreaterThan(150);               // still going the old way the frame after
    expect(Math.max(...rev.slice(0, 20).map((f) => f.brake))).toBeGreaterThan(0.6);
    expect(Math.min(...rev.map((f) => f.speed))).toBeLessThan(10);
    expect(m.vx).toBeLessThan(-PLAYER_SPRINT_SPEED * 0.9);   // and away the new way
  });
  it("a 90° turn at a sprint curves (a turning circle, not a corner) and leans INTO it", () => {
    const m = new Momentum(); run(m, F, PLAYER_SPRINT_SPEED, true, 2);
    // turning to the body's left: travelling +x, the left is (uz, −ux) = (0, −1)
    let leftBank = 0, frames = 0;
    for (let i = 0; i < 60 && m.vz > -0.9 * PLAYER_SPRINT_SPEED; i++) { const s = m.step({ x: 0, z: -1 }, PLAYER_SPRINT_SPEED, true, 1 / 60); leftBank = Math.max(leftBank, s.bank); frames++; }
    expect(frames).toBeGreaterThan(8);                       // not one frame
    expect(frames).toBeLessThan(40);                         // and still responsive
    expect(leftBank).toBeGreaterThan(0.05);
  });
});

describe("momentum never goes through anything (PlayerBody.move, sub-stepped)", () => {
  it("a sprint skidding into a wall stops at it — never in it — and the momentum into it is gone", () => {
    const wallX = 60, radius = 8;
    const body = new PlayerBody({ x: 0, z: 0 }, radius, (p) => p.x + radius <= wallX);
    const m = new Momentum(); m.vx = PLAYER_SPRINT_SPEED;
    for (let i = 0; i < 60; i++) {
      const s = m.step(null, 0, false, 1 / 60);
      const from = { ...body.pos };
      const res = body.move(s.dx, s.dz);
      if (res.blocked) m.blocked(res.pos.x - from.x, res.pos.z - from.z, 1 / 60);
      expect(body.pos.x + radius).toBeLessThanOrEqual(wallX + 1e-6);
    }
    expect(m.speed).toBe(0);
  });
  it("a stalled 250 ms frame at a full sprint is still sub-stepped (no tunnelling through a thin wall)", () => {
    const radius = 8;
    const body = new PlayerBody({ x: 0, z: 0 }, radius, (p) => !(p.x > 30 && p.x < 34));
    body.move(PLAYER_SPRINT_SPEED * 0.25, 0);
    expect(body.pos.x).toBeLessThanOrEqual(30);
  });
});

describe("the gait table: feet that keep up", () => {
  it("a 1.3x walk stays a WALK on a HumanBase body; a sprint is the run, its stride opened up", () => {
    expect(PLAYER_WALK_SPEED).toBeLessThan(HB_RUN_FROM);
    expect(locomotion("humanbase", PLAYER_WALK_SPEED, false, true, CLIP_WALK).clip).toBe(CLIP_WALK);
    const s = locomotion("humanbase", PLAYER_SPRINT_SPEED, true, true, CLIP_RUN, sprintStride(1));
    expect(s.clip).toBe(CLIP_RUN);
    // what the feet actually cover: cadence x the clip's stride x the opened-up stride — within 10% of the sprint
    expect(s.rate * HUMANBASE_CLIP_GROUND_SPEED[CLIP_RUN] * sprintStride(1)).toBeGreaterThan(PLAYER_SPRINT_SPEED * 0.9);
  });
});

describe("everybody else sees the sprint's stop (app/selfMovement → world/coworkerWalk)", () => {
  const recorder = () => {
    const calls: { kind: string; ms?: number; pacing?: string }[] = [];
    const sink: Vo3dSelfMovementSink = {
      state: { started: 0, arrived: 0, refused: 0, wire: [] },
      started: (_o, _p, ms, pacing) => calls.push({ kind: "started", ms, pacing }),
      arrived: () => calls.push({ kind: "arrived" }),
      enteredPlace: () => calls.push({ kind: "placed" }),
      movedInPlace: (_a, _f, _t, _y, _r, ms, pacing) => calls.push({ kind: "inPlace", ms, pacing }),
    };
    return { sink, calls };
  };
  it("in the office: the leg the body skids in goes out as a braking leg", () => {
    const { sink, calls } = recorder();
    const feed = new SelfMovementFeed(sink, () => true);
    let x = 100;
    feed.frame(16, { x, z: 100 }, 0, false);
    for (let i = 0; i < 30; i++) { x += 3; feed.frame(16, { x, z: 100 }, 0, false); }          // sprinting
    feed.setBraking(1);
    for (let i = 0; i < 20; i++) { x += 1; feed.frame(16, { x, z: 100 }, 0, false); }          // skidding
    feed.setBraking(0);
    for (let i = 0; i < 20; i++) feed.frame(16, { x, z: 100 }, 0, false);                       // stopped
    expect(calls.filter((c) => c.kind === "started").map((c) => c.pacing)).toContain("decel");
  });
  it("out on the campus: legs carry their real time (never shorter than 120 ms) and a skid is a braking leg", () => {
    const { sink, calls } = recorder();
    const inFrame = (p: { x: number; z: number }) => p.x < 1000;
    const feed = new SelfMovementFeed(sink, inFrame);
    feed.frame(16, { x: 990, z: 0 }, 0, false);
    feed.entering("campus");
    let x = 1010;
    feed.frame(16, { x, z: 0 }, 0, false);
    for (let i = 0; i < 40; i++) { x += 200 / 60; feed.frame(1000 / 60, { x, z: 0 }, 0, false); }  // a 200 u/s sprint
    feed.setBraking(1);
    for (let i = 0; i < 20; i++) { x += 1.5; feed.frame(1000 / 60, { x, z: 0 }, 0, false); }
    feed.setBraking(0);
    for (let i = 0; i < 20; i++) feed.frame(1000 / 60, { x, z: 0 }, 0, false);
    const legs = calls.filter((c) => c.kind === "inPlace");
    expect(legs.length).toBeGreaterThan(3);
    for (const l of legs) expect(l.ms).toBeGreaterThanOrEqual(100);
    // a sprint leg replays at the sprint's speed: ~200 u/s, not the old fixed 100 ms per 12 u
    expect(legs[0].ms).toBeGreaterThanOrEqual(120);
    expect(legs.map((l) => l.pacing)).toContain("decel");
    expect(legs[legs.length - 1].pacing).toBe("decel");
  });
  it("a braking leg replays SLOWING DOWN: ahead of a constant-speed one early, both arriving together", () => {
    const path = [{ x: 0, z: 0 }, { x: 40, z: 0 }];
    const lin = new ReplayWalk("a", path, 400, 0, "linear"), dec = new ReplayWalk("b", path, 400, 0, "decel");
    lin.advance(100); dec.advance(100);
    expect(dec.position.x).toBeGreaterThan(lin.position.x);
    lin.advance(300); dec.advance(300);
    expect(dec.position.x).toBeCloseTo(40, 6);
    expect(lin.position.x).toBeCloseTo(40, 6);
  });
  it("the server accepts the braking leg's pacing", () => {
    expect(readFileSync("../backend/app/realtime/socket.py", "utf8")).toContain('_PACINGS = {"eased", "linear", "decel"}');
  });
});

describe.skipIf(!fs.existsSync(publicPath(HUMAN_BASE_URL)))("on a real HumanBase body (avatar/gaitPose)", () => {
  beforeAll(() => setGlbFetcher(loadHumanGlb));
  it("sprints leaning forward with the head up, brakes with knees bent and a foot ahead, feet on the ground, and lets go cleanly", async () => {
    const h = await HumanAvatar.create(structuredClone(BON_AVATAR) as EmployeeAvatar, CATALOGUE_BY_ID);
    const root = new THREE.Group(), model = new THREE.Group();
    root.add(model); model.add(h.root);
    const gait = new GaitPose(model);
    gait.setScene(h.scene);
    h.addLayer({ id: "gait", order: 25, update: (dt) => gait.update(dt) });
    const bone = (n: string) => h.bones.get(n)!.getWorldPosition(new THREE.Vector3());
    const pose = () => { root.updateMatrixWorld(true); return { head: bone("Head"), hips: bone("Hips"), neck: bone("neck"), footL: bone("LeftFoot"), footR: bone("RightFoot"), knee: bone("LeftLeg"), thigh: bone("LeftUpLeg") }; };
    // standing on the idle: the baseline
    h.play("idle-masculine", 0); h.actionFor("idle-masculine")!.timeScale = 0;
    h.update(1 / 60);
    const idle = pose();
    // A SPRINT on the run clip: the torso leans forward (the head ahead of the hips), the head is kept up
    h.play("running", 0);
    for (let i = 0; i < 40; i++) { gait.set({ sprint: 1, bank: 0, brake: 0, lead: 1 }); h.update(1 / 60); }
    const sp = pose();
    gait.set(null); for (let i = 0; i < 20; i++) h.update(1 / 60);
    const raw = pose();
    const lean = (p: ReturnType<typeof pose>) => Math.atan2(p.neck.z - p.hips.z, p.neck.y - p.hips.y);
    expect(lean(sp) - lean(raw)).toBeGreaterThan(0.2);       // ~15–20° more forward than the clip alone
    expect(lean(sp) - lean(raw)).toBeLessThan(0.4);
    // A BRAKE over the idle: leaning back, knees bent, the feet still on the ground (the body comes down onto them)
    h.play("idle-masculine", 0); h.actionFor("idle-masculine")!.timeScale = 0;
    for (let i = 0; i < 30; i++) { gait.set({ sprint: 0, bank: 0, brake: 1, lead: 1 }); h.update(1 / 60); }
    const br = pose();
    expect(lean(br)).toBeLessThan(lean(idle) - 0.15);
    expect(Math.min(br.footL.y, br.footR.y)).toBeCloseTo(Math.min(idle.footL.y, idle.footR.y), 1);
    expect(br.hips.y).toBeLessThan(idle.hips.y - 0.3);
    // the lead foot ahead of the trail one (the body faces +z)
    expect(br.footL.z - br.footR.z).toBeGreaterThan(1);
    // let go: exactly the clip again, and the model frame back where it was
    gait.set(null); for (let i = 0; i < 20; i++) h.update(1 / 60);
    const back = pose();
    expect(back.head.distanceTo(idle.head)).toBeLessThan(1e-3);
    expect(model.position.length() + Math.abs(model.quaternion.angleTo(new THREE.Quaternion()))).toBeLessThan(1e-6);
  }, 120_000);
});

describe("wiring", () => {
  const pm = readFileSync("src/dev/vo3d/player/PlayerMode.ts", "utf8"), w = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
  it("WASD goes through the momentum and then the same PlayerBody.move; an interaction or a ride ends the momentum", () => {
    expect(pm).toContain("const res = this.body.move(m.dx, m.dz, this.walkHeights());");
    expect(pm).toContain("if (res.blocked) this.momentum.blocked(res.pos.x - from.x, res.pos.z - from.z, dt);");
    expect(pm.match(/this\.momentum\.reset\(\);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(w).toContain("selfFeed?.setBraking(playerMode.active ? playerMode.state.braking : 0);");
    expect(MOMENTUM.SKID_FROM).toBeGreaterThan(PLAYER_WALK_SPEED);
  });
});
