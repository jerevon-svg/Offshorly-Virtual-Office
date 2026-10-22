// PARKOUR V1 — THE LOCAL PLAYER: Space twice for the double jump and its flip (never a third), headroom, the
// landing absorb, the landing roll that really travels — planned from the landing, checked along its whole path,
// published with its travel — the crouched landing when the path is not clear, and stepping down off a top.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack } from "./avatar/Controller";
import { PlayerMode, type ParkourKind, type RollPlan } from "./player/PlayerMode";
import { WorldState } from "./world/WorldState";
import { ROLL_MS_RANGE } from "./avatar/parkourPose";
import type { Vec2 } from "./core/coords";

const DT = 1 / 60;
const key = (type: "keydown" | "keyup", code: string) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));

function player(opts: { canStand?: (p: Vec2, ctx?: { feet: number; airborne: boolean; from: Vec2 }) => boolean; headroom?: (p: Vec2) => number; groundAt?: (p: Vec2) => number } = {}) {
  const av = new Avatar({ height: 36, lit: true });
  const stack = new ControllerStack();
  const support = (p: Vec2) => opts.groundAt?.(p) ?? 0;
  const pm = new PlayerMode({
    avatar: av, stack, world: new WorldState(), canStand: opts.canStand ?? (() => true), cameraProbe: () => true,
    camera: new THREE.PerspectiveCamera(), canvas: document.createElement("canvas"), overlayRoot: new THREE.Scene(),
    radius: 8, avatarHeight: 36, speed: () => 70, activate: vi.fn(() => true), canStandUp: () => false, standUp: () => {},
    yieldAvatar: vi.fn(), guided: () => false, freeLook: () => false,
    support, dropMax: 5, groundAt: opts.groundAt, headroom: opts.headroom,
  });
  const events: { kind: ParkourKind; roll?: RollPlan }[] = [];
  pm.onJumped = (kind, roll) => events.push({ kind, roll });
  expect(pm.enter()).toBe(true);
  const step = (n = 1, each?: () => void) => { for (let i = 0; i < n; i++) { pm.update(DT); av.update(DT); each?.(); } };
  return { av, pm, events, step };
}

afterEach(() => { key("keyup", "KeyW"); key("keyup", "ShiftLeft"); });

describe("the double jump, locally", () => {
  it("Space, Space: one jump, one double jump with its flip — a third is refused until the feet are down", () => {
    const { av, pm, events, step } = player();
    pm.jump();
    step(16);
    pm.jump();
    expect(av.tumbling).toBe("flip");
    pm.jump();
    step(4);
    pm.jump();
    expect(events.map((e) => e.kind)).toEqual(["jump", "double"]);
    let landedAbsorb = false;
    step(120, () => { if (av.tumbling === "land") landedAbsorb = true; });
    expect(pm.airborne).toBe(false);
    expect(landedAbsorb).toBe(true); // standing still: a real fall gives at the knees rather than rolling
    expect(events.map((e) => e.kind)).toEqual(["jump", "double"]);
    pm.jump(); // and the allowance is back
    step(16);
    pm.jump();
    expect(events.map((e) => e.kind)).toEqual(["jump", "double", "jump", "double"]);
  });

  it("HEADROOM: under a low ceiling the double jump is refused and the head never goes through it", () => {
    const { av, pm, events, step } = player({ headroom: () => 8 });
    pm.jump();
    let peak = 0;
    step(14, () => { peak = Math.max(peak, av.root.position.y); });
    pm.jump();
    step(60, () => { peak = Math.max(peak, av.root.position.y); });
    expect(events.map((e) => e.kind)).toEqual(["jump"]);
    expect(peak).toBeLessThanOrEqual(8 + 1e-9);
  });
});

describe("the landing roll, locally", () => {
  it("after a real fall at speed with a clear path: a planned roll that TRAVELS its whole length, then on running", () => {
    const r = player();
    key("keydown", "KeyW");
    key("keydown", "ShiftLeft");
    r.step(40);
    r.pm.jump();
    r.step(16);
    r.pm.jump();
    let start: Vec2 | null = null;
    let rollFrames = 0;
    r.step(200, () => {
      const roll = r.events.find((e) => e.kind === "roll");
      if (roll && !start) start = { ...r.pm.body.pos };
      if (r.pm.rolling) rollFrames++;
    });
    const roll = r.events.find((e) => e.kind === "roll")?.roll;
    expect(roll).toBeDefined();
    expect(roll!.dist).toBeGreaterThanOrEqual(18);
    expect(roll!.dist).toBeLessThanOrEqual(42);
    expect(roll!.ms).toBeGreaterThanOrEqual(ROLL_MS_RANGE.min);
    expect(roll!.ms).toBeLessThanOrEqual(ROLL_MS_RANGE.max);
    // the roll owned the body for its duration and carried it along its plan
    expect(rollFrames * DT * 1000).toBeGreaterThan(roll!.ms - 40);
    expect(Math.hypot(roll!.to.x - roll!.from.x, roll!.to.z - roll!.from.z)).toBeCloseTo(roll!.dist, 3);
    const travelled = Math.hypot(r.pm.body.pos.x - roll!.from.x, r.pm.body.pos.z - roll!.from.z);
    expect(travelled).toBeGreaterThan(roll!.dist); // its whole length, and then still going with the keys held
  });

  it("with no clear path ahead: NO roll — a crouched landing instead, and nothing carries the body forward", () => {
    // a wall the moment the body comes down: everything more than 10 units on along its travel is refused
    let wall: ((p: Vec2) => boolean) | null = null;
    const r = player({ canStand: (p) => (wall ? wall(p) : true) });
    key("keydown", "KeyW");
    key("keydown", "ShiftLeft");
    r.step(40);
    const a = { ...r.pm.body.pos };
    r.step(1);
    const dir = { x: r.pm.body.pos.x - a.x, z: r.pm.body.pos.z - a.z };
    const len = Math.hypot(dir.x, dir.z);
    dir.x /= len; dir.z /= len;
    r.pm.jump();
    r.step(16);
    r.pm.jump();
    let sawLand = false;
    r.step(120, () => {
      if (!wall && r.pm.airborne && r.av.root.position.y < 6) {
        const at = { ...r.pm.body.pos };
        wall = (p) => (p.x - at.x) * dir.x + (p.z - at.z) * dir.z < 10;
      }
      if (r.av.tumbling === "land") sawLand = true;
    });
    expect(r.events.some((e) => e.kind === "roll")).toBe(false);
    expect(sawLand).toBe(true);
  });

  it("an ordinary hop never rolls, however fast", () => {
    const r = player();
    key("keydown", "KeyW");
    key("keydown", "ShiftLeft");
    r.step(40);
    r.pm.jump();
    r.step(90);
    expect(r.events.map((e) => e.kind)).toEqual(["jump"]);
    expect(r.pm.rolling).toBe(false);
  });
});

describe("THE ROLL FOLLOWS THE ACTUAL TRAVEL — never mirrored, never backward", () => {
  /** sprint with these keys, measure the real direction of travel, then get airborne by `how` and land rolling */
  function rollWhile(keys: string[], how: "flip" | "drop") {
    let ledge: ((p: Vec2) => number) | null = null;
    const r = player({ groundAt: (p) => (ledge ? ledge(p) : 0) });
    for (const k of [...keys, "ShiftLeft"]) key("keydown", k);
    r.step(50);
    const a = { ...r.pm.body.pos };
    r.step(6);
    const travel = { x: r.pm.body.pos.x - a.x, z: r.pm.body.pos.z - a.z };
    const n = Math.hypot(travel.x, travel.z);
    travel.x /= n; travel.z /= n;
    if (how === "flip") {
      r.pm.jump();
      r.step(16);
      r.pm.jump();
    } else {
      // a 24-high ledge whose edge is just ahead: the body runs off it and falls, no jump, no flip
      const at = { ...r.pm.body.pos };
      ledge = (p) => ((p.x - at.x) * travel.x + (p.z - at.z) * travel.z < 6 ? 24 : 0);
    }
    const facing: number[] = [];
    const rec: { start: Vec2 | null } = { start: null };
    r.step(240, () => {
      if (r.pm.rolling) {
        if (!rec.start) rec.start = { ...r.pm.body.pos };
        facing.push(r.av.yaw);
      }
    });
    for (const k of [...keys, "ShiftLeft"]) key("keyup", k);
    const roll = r.events.find((e) => e.kind === "roll")?.roll;
    return { r, roll, travel, facing, start: rec.start };
  }

  for (const [name, keys] of [["forward", ["KeyW"]], ["left", ["KeyA"]], ["right", ["KeyD"]], ["diagonally", ["KeyW", "KeyD"]], ["back toward the camera", ["KeyS"]]] as const) {
    it(`travelling ${name}: after a front flip, it rolls ON along that direction, facing it`, () => {
      const { roll, travel, facing } = rollWhile([...keys], "flip");
      expect(roll, "a roll was planned").toBeDefined();
      expect(roll!.dir.x * travel.x + roll!.dir.z * travel.z).toBeGreaterThan(0.97); // the plan points where it was going
      // …and so does the path it publishes for every peer
      const pub = { x: roll!.to.x - roll!.from.x, z: roll!.to.z - roll!.from.z };
      expect((pub.x * travel.x + pub.z * travel.z) / Math.hypot(pub.x, pub.z)).toBeGreaterThan(0.97);
      // the body keeps facing its travel the whole way (yaw = heading = atan2(dx, dz): facing (sin, cos))
      for (const y of facing) expect(Math.sin(y) * travel.x + Math.cos(y) * travel.z).toBeGreaterThan(Math.cos(0.3));
    });
  }

  it("after a higher fall WITHOUT a flip (running off a ledge): the same forward roll", () => {
    const { r, roll, travel, start } = rollWhile(["KeyW"], "drop");
    expect(r.events.map((e) => e.kind)).toEqual(["roll"]); // no jump, no double — a fall
    expect(roll!.dir.x * travel.x + roll!.dir.z * travel.z).toBeGreaterThan(0.97);
    const moved = { x: r.pm.body.pos.x - start!.x, z: r.pm.body.pos.z - start!.z };
    expect(moved.x * travel.x + moved.z * travel.z).toBeGreaterThan(roll!.dist * 0.9); // forward, not backward
  });

  it("the body is carried forward on every frame of the roll — never back, never in place", () => {
    const r = player();
    key("keydown", "KeyW");
    key("keydown", "ShiftLeft");
    r.step(50);
    const a = { ...r.pm.body.pos };
    r.step(6);
    const travel = { x: r.pm.body.pos.x - a.x, z: r.pm.body.pos.z - a.z };
    r.pm.jump();
    r.step(16);
    r.pm.jump();
    const last: { p: Vec2 | null } = { p: null };
    let frames = 0;
    r.step(240, () => {
      if (!r.pm.rolling) return;
      const p = { ...r.pm.body.pos }, q = last.p;
      if (q) expect((p.x - q.x) * travel.x + (p.z - q.z) * travel.z).toBeGreaterThanOrEqual(-1e-9);
      last.p = p;
      frames++;
    });
    expect(frames).toBeGreaterThan(30);
  });
});

describe("standing on a top, locally", () => {
  it("leaving Player View on a sofa steps down beside it, never into it", () => {
    const inSofa = (p: Vec2) => Math.hypot(p.x, p.z) < 12;
    const r = player({ groundAt: (p) => (inSofa(p) ? 15.6 : 0), canStand: (p, ctx) => !inSofa(p) || (ctx !== undefined && ctx.feet >= 14) });
    r.pm.body.pos = { x: 0, z: 0 };
    r.step(30);
    expect(r.av.root.position.y).toBeCloseTo(15.6, 1);
    r.pm.exit();
    expect(inSofa(r.pm.body.pos)).toBe(false);
    expect(r.av.root.position.y).toBe(0);
  });
});

