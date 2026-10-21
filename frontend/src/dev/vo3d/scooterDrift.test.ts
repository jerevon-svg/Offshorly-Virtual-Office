// S3 — MARIO KART-INSPIRED DRIFTING: tap = hop, hold through the landing while steering = drift, release =
// a mini-boost when charged. The state machine (player/ScooterDrift), its motion (player/ScooterMotion), the
// real ride driven by real keys (player/PlayerMode + PlayerInput), the HUD meter, the effects and the stream.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DRIFT, ScooterDrift, type DriftInput } from "./player/ScooterDrift";
import { SCOOTER, ScooterMotion } from "./player/ScooterMotion";
import { ScooterHud } from "./player/ScooterHud";
import { PlayerInput } from "./player/PlayerInput";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack } from "./avatar/Controller";
import { PlayerMode, type RideHooks } from "./player/PlayerMode";
import { WorldState } from "./world/WorldState";
import { DECK_TOP } from "./world/scooters";
import { DriftFx } from "./build/driftFx";
import { RiderPoseInterpolator, RiderPoseOut, drawnHeading, EXTRAPOLATE_MS, RENDER_DELAY_MS } from "./app/riderStream";

const F = 1000 / 60;
const base: DriftInput = { held: false, steer: 0, airborne: false, speed: 250, cap: 1, allowed: true, hardHit: false };
/** a hop with Space held from take-off, landing after `airMs` */
function hopAndLand(d: ScooterDrift, over: Partial<DriftInput> = {}, airMs = 460): ReturnType<ScooterDrift["update"]> {
  for (let t = 0; t < airMs; t += F) d.update({ ...base, held: true, airborne: true, ...over }, F);
  return d.update({ ...base, held: true, airborne: false, ...over }, F);
}
function driftFor(d: ScooterDrift, ms: number, over: Partial<DriftInput> = {}): void {
  for (let t = 0; t < ms; t += F) d.update({ ...base, held: true, steer: 1, ...over }, F);
}

describe("ScooterDrift — tap is a hop, hold is a drift", () => {
  it("a TAP (Space let go before the landing) is just a hop", () => {
    const d = new ScooterDrift();
    for (let t = 0; t < 120; t += F) d.update({ ...base, held: true, airborne: true, steer: 1 }, F);
    for (let t = 0; t < 340; t += F) d.update({ ...base, held: false, airborne: true, steer: 1 }, F);
    expect(d.update({ ...base, held: false, steer: 1 }, F)).toBeNull();
    expect(d.active).toBe(false);
  });

  it("HELD through the landing while steering: a drift toward the steered side", () => {
    const right = new ScooterDrift();
    expect(hopAndLand(right, { steer: 0.8 })).toBe("start");
    expect(right.dir).toBe(1);
    const left = new ScooterDrift();
    hopAndLand(left, { steer: -0.6 });
    expect(left.dir).toBe(-1);
  });

  it("held but not steering is a hop; a steer within the grace still starts one, after it does not", () => {
    const d = new ScooterDrift();
    expect(hopAndLand(d)).toBeNull();
    expect(d.update({ ...base, held: true, steer: 1 }, 150)).toBe("start");
    const late = new ScooterDrift();
    hopAndLand(late);
    late.update({ ...base, held: true }, DRIFT.graceMs + 30);
    expect(late.update({ ...base, held: true, steer: 1 }, F)).toBeNull();
  });

  it("never starts too slow, on a slow surface, or without leave to (menu, not the body's owner)", () => {
    for (const over of [{ speed: DRIFT.minSpeed - 1 }, { cap: 0.5 }, { allowed: false }]) {
      const d = new ScooterDrift();
      expect(hopAndLand(d, { steer: 1, ...over }), JSON.stringify(over)).toBeNull();
    }
  });

  it("charge builds with sustained turning — faster steering INTO it — and tiers at 0.45 and 1", () => {
    const hold = new ScooterDrift(); hopAndLand(hold, { steer: 1 });
    const into = new ScooterDrift(); hopAndLand(into, { steer: 1 });
    driftFor(hold, 500, { steer: 0.0001 }); // barely steering: the base rate
    driftFor(into, 500, { steer: 1 });
    expect(into.charge).toBeGreaterThan(hold.charge * 1.5);
    const t = new ScooterDrift(); hopAndLand(t, { steer: 1 });
    let ms = 0;
    while (t.tier === 0) { t.update({ ...base, held: true, steer: 1 }, F); ms += F; }
    expect(ms).toBeGreaterThan(450); // never instant
    expect(ms).toBeLessThan(1000);
    while (t.tier < 2) { t.update({ ...base, held: true, steer: 1 }, F); ms += F; }
    expect(ms).toBeLessThan(2200);
  });

  it("release: no boost uncharged, tier 1 and tier 2 boosts when charged — SET, never stacked", () => {
    const none = new ScooterDrift(); hopAndLand(none, { steer: 1 }); driftFor(none, 200);
    expect(none.update({ ...base, steer: 1 }, F)).toBe("end");
    expect(none.boosting).toBe(false);
    const t1 = new ScooterDrift(); hopAndLand(t1, { steer: 1 });
    while (t1.tier < 1) driftFor(t1, F);
    expect(t1.update({ ...base }, F)).toBe("boost");
    expect([t1.boostSpeed, t1.boostMs]).toEqual([DRIFT.boost[0].speed, DRIFT.boost[0].ms]);
    const t2 = new ScooterDrift(); hopAndLand(t2, { steer: 1 });
    while (t2.tier < 2) driftFor(t2, F);
    t2.update({ ...base }, F);
    expect(t2.boostSpeed).toBe(DRIFT.boost[1].speed);
    // a second drift released while the first boost runs replaces it — the time is never added up
    hopAndLand(t2, { steer: 1 });
    while (t2.tier < 1) driftFor(t2, F);
    t2.update({ ...base }, F);
    expect(t2.boostMs).toBeLessThanOrEqual(DRIFT.boost[0].ms);
  });

  it("CANCELS (no boost) when it stops being a drift: slow, lawn, airborne, a hard hit, a menu", () => {
    for (const over of [{ speed: DRIFT.endSpeed - 1 }, { cap: 0.5 }, { airborne: true }, { hardHit: true }, { allowed: false }]) {
      const d = new ScooterDrift(); hopAndLand(d, { steer: 1 });
      while (d.tier < 2) driftFor(d, F);
      expect(d.update({ ...base, held: true, steer: 1, ...over }, F), JSON.stringify(over)).toBe("cancel");
      expect(d.boosting).toBe(false);
    }
  });

  it("slides in and recovers SMOOTHLY: the slip eases, never snaps", () => {
    const d = new ScooterDrift(); hopAndLand(d, { steer: 1 });
    let prev = d.slip, maxStep = 0;
    for (let i = 0; i < 90; i++) { d.update({ ...base, held: i < 45, steer: 1 }, F); maxStep = Math.max(maxStep, Math.abs(d.slip - prev)); prev = d.slip; }
    expect(maxStep).toBeLessThan(0.05);
    expect(Math.abs(d.slip)).toBeLessThan(0.05); // back to straight after the release
  });
});

describe("ScooterMotion under a drift and a mini-boost", () => {
  const driftIn = (dir: -1 | 1, turnRate = 1.6) => ({ dir, turnRate, lean: DRIFT.lean, drag: DRIFT.drag });

  it("turns the drift's way whatever the bars say, and leans harder than a turn", () => {
    const m = new ScooterMotion(0); m.speed = 250;
    const turn = new ScooterMotion(0); turn.speed = 250;
    for (let i = 0; i < 30; i++) {
      m.step({ throttle: 1, steer: -1, boost: false, drift: driftIn(1) }, 1 / 60); // counter-steering
      turn.step({ throttle: 1, steer: 1, boost: false }, 1 / 60);
    }
    expect(m.heading).toBeGreaterThan(0.4); // still round to the right
    expect(m.lean).toBeGreaterThan(turn.lean);
  });

  it("a mini-boost drives past cruise toward its speed, then the deck eases back — never above it", () => {
    const m = new ScooterMotion(0); m.speed = SCOOTER.maxSpeed;
    let top = 0;
    for (let i = 0; i < 40; i++) { m.step({ throttle: 1, steer: 0, boost: false, surge: DRIFT.boost[1].speed }, 1 / 60); top = Math.max(top, m.speed); }
    expect(top).toBeGreaterThan(SCOOTER.maxSpeed + 40);
    expect(top).toBeLessThanOrEqual(DRIFT.boost[1].speed);
    for (let i = 0; i < 120; i++) m.step({ throttle: 1, steer: 0, boost: false }, 1 / 60);
    expect(m.speed).toBeLessThanOrEqual(SCOOTER.maxSpeed + 1e-6);
    // with Shift as well: the higher of the two is the top, never their sum
    const both = new ScooterMotion(0); both.speed = 300;
    for (let i = 0; i < 120; i++) both.step({ throttle: 1, steer: 0, boost: true, surge: DRIFT.boost[0].speed }, 1 / 60);
    expect(both.speed).toBeLessThanOrEqual(Math.max(SCOOTER.boostSpeed, DRIFT.boost[0].speed) + 1e-6);
  });
});

describe("PlayerInput — Space held is not Space pressed again", () => {
  it("one hop per press however long it is held; jumpHeld reports the hold; a menu lets go", () => {
    const canvas = document.createElement("canvas");
    let jumps = 0;
    const input = new PlayerInput(canvas, { onInteract: () => {}, onToggleView: () => {}, onJump: () => { jumps++; }, onLockChange: () => {} });
    input.enable();
    const key = (type: "keydown" | "keyup", code: string, repeat = false) => window.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true, cancelable: true }));
    key("keydown", "Space");
    for (let i = 0; i < 20; i++) key("keydown", "Space", true);
    expect(jumps).toBe(1);
    expect(input.jumpHeld).toBe(true);
    input.menuOpen = true;
    expect(input.jumpHeld).toBe(false);
    input.menuOpen = false;
    key("keyup", "Space");
    expect(input.jumpHeld).toBe(false);
    input.disable();
  });
});

describe("the real ride, driven by real keys", () => {
  afterEach(() => { for (const el of document.querySelectorAll('[data-testid="scooter-hud"]')) el.remove(); });
  function rig(canStand: (p: { x: number; z: number }) => boolean = () => true) {
    const av = new Avatar({ height: 36, lit: true });
    const stack = new ControllerStack();
    const pm = new PlayerMode({
      avatar: av, stack, world: new WorldState(), canStand: () => true, cameraProbe: () => true,
      camera: new THREE.PerspectiveCamera(), canvas: document.createElement("canvas"), overlayRoot: new THREE.Scene(),
      radius: 8, avatarHeight: 36, speed: () => 70, activate: vi.fn(() => true), canStandUp: () => false, standUp: () => {},
      yieldAvatar: vi.fn(), guided: () => false, freeLook: () => false,
    });
    expect(pm.enter()).toBe(true);
    const placed: { h: number; fx?: { drift: number; charge: number; slip: number; boost: boolean } }[] = [];
    const hooks: RideHooks = { canStand, deckTop: DECK_TOP, forceEnd: () => pm.endRide(), place: (_p, h, _l, _s, _y, _pt, fx) => { placed.push({ h, fx: fx ? { ...fx } : undefined }); } };
    expect(pm.startRide(hooks, 0)).toBe(true);
    const key = (type: "keydown" | "keyup", code: string) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
    const run = (ms: number) => { for (let t = 0; t < ms; t += F) pm.update(F / 1000); };
    return { pm, key, run, placed, last: () => placed[placed.length - 1], done: () => { pm.endRide(); pm.dispose(); } };
  }

  it("throttle up, hop holding Space while steering right, land: a drift, its fx on every placed frame, then a boost on release", () => {
    const r = rig();
    r.key("keydown", "KeyW");
    r.run(1500); // up to cruise
    r.key("keydown", "ArrowRight");
    r.key("keydown", "Space"); // the hop…
    r.run(700); // …held through the landing
    expect(r.last().fx?.drift).toBe(1);
    expect(Math.abs(r.last().fx!.slip)).toBeGreaterThan(0.1);
    r.run(2000); // charge to full
    expect(r.last().fx!.charge).toBeGreaterThanOrEqual(DRIFT.tier2);
    expect(r.pm.scooterHudState).not.toBeNull();
    r.key("keyup", "Space");
    r.run(100);
    expect(r.last().fx?.drift).toBe(0);
    expect(r.last().fx?.boost).toBe(true);
    expect(r.pm.rideState!.speed).toBeGreaterThan(SCOOTER.maxSpeed);
    r.key("keyup", "ArrowRight"); r.key("keyup", "KeyW");
    r.done();
  });

  it("a drift respects the same walls the ride does: it stops at one, and the hit cancels it without a boost", () => {
    // the ride heads north (−z) and curves right: a wall at x = 40 stands in its way
    const r = rig((p) => p.x < 40);
    r.key("keydown", "KeyW"); r.run(1500);
    r.key("keydown", "ArrowRight"); r.key("keydown", "Space"); r.run(700);
    r.run(3000);
    expect(r.pm.body.pos.x).toBeLessThan(40);
    r.key("keyup", "Space"); r.run(50);
    expect(r.last().fx?.boost ?? false).toBe(false);
    r.key("keyup", "ArrowRight"); r.key("keyup", "KeyW");
    r.done();
  });
});

describe("the HUD's drift meter", () => {
  it("shows only while drifting, fills with the charge, amber at tier 1, green at full", () => {
    const h = new ScooterHud(document.body, { cruise: 300, boost: 380 });
    const meter = document.querySelector('[data-testid="scooter-drift"]') as HTMLDivElement;
    h.setDrift(false, 0, 0);
    expect(meter.style.opacity).toBe("0");
    h.setDrift(true, 0.5, 1);
    expect(meter.style.opacity).toBe("1");
    expect(meter.dataset.tier).toBe("1");
    expect((meter.querySelector('[data-testid="scooter-drift-fill"]') as HTMLDivElement).style.width).toBe("50%");
    h.setDrift(true, 1, 2);
    expect(meter.dataset.tier).toBe("2");
    h.dispose();
  });
});

describe("skids and sparks (build/driftFx)", () => {
  const fx = (charge: number, drift: -1 | 0 | 1 = 1, boost = false) => ({ drift, charge, slip: drift * 0.35, boost });

  it("lays skid strips only while slipping, and sparks grow with the charge", () => {
    const d = new DriftFx();
    for (let i = 0; i < 30; i++) { d.feed("a", { x: i * 4, z: 0 }, 0, Math.PI / 2, 250, undefined, 1 / 60); d.update(1 / 60); }
    expect(d.stats.skids + d.stats.sparks).toBe(0);
    const sparksAt = (charge: number) => {
      const e = new DriftFx();
      let n = 0;
      for (let i = 0; i < 60; i++) { e.feed("a", { x: i * 4, z: 0 }, 0, Math.PI / 2, 250, fx(charge), 1 / 60); e.update(1 / 60); n = Math.max(n, e.stats.sparks); }
      return { n, skids: e.stats.skids };
    };
    const low = sparksAt(0.1), mid = sparksAt(0.6), full = sparksAt(1);
    expect(low.skids).toBeGreaterThan(10);
    expect(mid.n).toBeGreaterThan(low.n);
    expect(full.n).toBeGreaterThan(mid.n);
  });

  it("a rider no longer fed throws nothing more; the skids fade away on their own; clear() empties it", () => {
    const d = new DriftFx();
    for (let i = 0; i < 40; i++) { d.feed("a", { x: i * 4, z: 0 }, 0, Math.PI / 2, 250, fx(1), 1 / 60); d.update(1 / 60); }
    expect(d.stats.skids).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 5; i++) d.update(1 / 60);
    expect(d.stats.skids).toBe(0);
    expect(d.stats.sparks).toBe(0);
    d.feed("a", { x: 0, z: 0 }, 0, 0, 250, fx(1), 1 / 60);
    d.clear();
    expect(d.stats.skids + d.stats.sparks).toBe(0);
    d.dispose();
  });
});

describe("drifting, as everybody else sees it (the S2 stream's fx)", () => {
  const relayed = (seq: number, t: number, fxv?: { drift: -1 | 0 | 1; charge: number; slip: number; boost: boolean }) =>
    ({ scooterId: "scooter-r1", rider: "a@x", seq, t, x: seq * 10, z: 0, y: 0, heading: 1, speed: 250, lean: 0.2, pitch: 0, ...(fxv ? { fx: fxv } : {}) });

  it("the drift goes out with the pose and comes back blended: slip and charge ease, direction and boost are the newer sample's", () => {
    const out = new RiderPoseOut(100, 1).next(0, "scooter-r1", { x: 0, z: 0, y: 0, heading: 1, speed: 250, lean: 0.2, pitch: 0, fx: { drift: 1, charge: 0.5, slip: 0.3, boost: false } }, true)!;
    expect(out.fx).toEqual({ drift: 1, charge: 0.5, slip: 0.3, boost: false });
    const ip = new RiderPoseInterpolator();
    ip.push(relayed(1, 0), 0); // not drifting
    ip.push(relayed(2, 100, { drift: 1, charge: 0.4, slip: 0.3, boost: false }), 100);
    const mid = ip.sample("scooter-r1", 50 + RENDER_DELAY_MS)!;
    expect(mid.fx!.slip).toBeCloseTo(0.15, 6); // halfway into the slip: no yaw snap
    expect(mid.fx!.drift).toBe(1);
    expect(drawnHeading(mid)).toBeCloseTo(1 + 0.15, 6);
  });

  it("a stream gone quiet stops drifting (no ghost sparks), though the rider is still held", () => {
    const ip = new RiderPoseInterpolator();
    ip.push(relayed(1, 0, { drift: 1, charge: 1, slip: 0.4, boost: true }), 0);
    expect(ip.sample("scooter-r1", RENDER_DELAY_MS + 50)!.fx?.drift).toBe(1);
    const quiet = ip.sample("scooter-r1", RENDER_DELAY_MS + EXTRAPOLATE_MS + 500)!;
    expect(quiet.fx).toBeUndefined();
    expect(quiet.x).toBeGreaterThan(0);
  });
});
