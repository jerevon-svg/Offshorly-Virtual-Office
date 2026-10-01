// PHASE 3 — exterior free roam on foot: ground following (Avatar, PlayerMode, the walk step), the scooter
// speed/boost HUD's life cycle, the campus place label, and app/world.ts's wiring of all of it.
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import src from "./app/world.ts?raw";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack, stepAlong } from "./avatar/Controller";
import { PlayerMode } from "./player/PlayerMode";
import { ScooterHud } from "./player/ScooterHud";
import { SCOOTER, ScooterMotion } from "./player/ScooterMotion";
import { WorldState } from "./world/WorldState";
import { resolveEmployeeLocation, CAMPUS_PLACE_ID } from "./app/employeeLocation";
import { DECK_TOP } from "./world/scooters";

/** a ground with a lawn east of x = 100 and a raised deck beyond x = 200 */
const ground = (p: { x: number; z: number }) => (p.x > 200 ? 0.4 : p.x > 100 ? -8 : 0);

function player() {
  const av = new Avatar({ height: 36, lit: true });
  av.ground = ground;
  const stack = new ControllerStack();
  const pm = new PlayerMode({
    avatar: av, stack, world: new WorldState(), canStand: () => true, cameraProbe: () => true,
    camera: new THREE.PerspectiveCamera(), canvas: document.createElement("canvas"), overlayRoot: new THREE.Scene(),
    radius: 8, avatarHeight: 36, speed: () => 70, activate: vi.fn(() => true), canStandUp: () => false, standUp: () => {},
    yieldAvatar: vi.fn(), guided: () => false, freeLook: () => false,
  });
  return { av, pm, stack };
}

describe("ground following", () => {
  it("Avatar stands on the ground unless told a height, and never while carried", () => {
    const av = new Avatar({ height: 36, lit: true });
    av.setPosition({ x: 150, z: 0 });
    expect(av.root.position.y).toBe(0); // no ground provider: the flat world it always was
    av.ground = ground;
    av.setPosition({ x: 150, z: 0 });
    expect(av.root.position.y).toBe(-8);
    av.setPosition({ x: 150, z: 0 }, 3);
    expect(av.root.position.y).toBe(3); // an explicit height is absolute
    const car = new THREE.Group();
    av.attachTo(car);
    expect(av.groundAt({ x: 150, z: 0 })).toBe(0); // a carrier's frame is not the campus
    av.detachTo(new THREE.Group());
    expect(av.groundAt({ x: 150, z: 0 })).toBe(-8);
  });

  it("the navigation walk step keeps the body on the ground it crosses", () => {
    const av = new Avatar({ height: 36, lit: true });
    av.ground = ground;
    av.setPosition({ x: 90, z: 0 });
    const path = [{ x: 150, z: 0 }];
    for (let k = 0; k < 20 && path.length; k++) stepAlong(av, path, 70, 8, 0.1);
    expect(av.root.position.x).toBe(150);
    expect(av.root.position.y).toBe(-8);
  });

  it("PlayerMode eases onto a step, snaps after a relocation, and the camera rides the same height", () => {
    const { av, pm } = player();
    expect(pm.enter()).toBe(true);
    pm.body.pos = { x: 90, z: 0 };
    for (let k = 0; k < 10; k++) { pm.update(1 / 60); av.update(1 / 60); }
    expect(av.root.position.y).toBe(0);
    // a 0.4 step up onto the deck (≤ GROUND_SNAP): eased, not snapped
    pm.body.pos = { x: 210, z: 0 };
    pm.update(1 / 60);
    const first = av.root.position.y;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.4);
    for (let k = 0; k < 60; k++) pm.update(1 / 60);
    expect(av.root.position.y).toBeCloseTo(0.4, 5);
    // 8.4 down onto the lawn is no step anybody takes: a relocation, taken at once
    pm.body.pos = { x: 150, z: 0 };
    pm.update(1 / 60);
    expect(av.root.position.y).toBe(-8);
    // the third-person camera's focus follows the ground the body stands on
    pm.body.pos = { x: 90, z: 0 };
    pm.update(1 / 60); // snap back up (8 > GROUND_SNAP)
    const camHigh = pm.camera.camera.position.y;
    pm.body.pos = { x: 150, z: 0 };
    for (let k = 0; k < 120; k++) pm.update(1 / 60);
    expect(pm.camera.camera.position.y).toBeLessThan(camHigh - 6);
    pm.dispose();
  });
});

describe("scooter speed / boost HUD", () => {
  const limits = { cruise: SCOOTER.maxSpeed, boost: SCOOTER.boostSpeed };
  const settle = (h: ScooterHud, speed: number, boosting = false) => { for (let k = 0; k < 120; k++) h.update(speed, boosting, 1 / 60); };

  it("reads a normalized SPD — a full road cruise is 100 — never a pretend km/h", () => {
    const h = new ScooterHud(document.body, limits);
    expect(h.state).toMatchObject({ spd: 0, mode: "cruise" });
    settle(h, SCOOTER.maxSpeed);
    expect(h.state.spd).toBe(100);
    expect(h.state.mode).toBe("cruise-hint"); // near the top without boost: the Shift hint shows
    settle(h, SCOOTER.boostSpeed, true);
    expect(h.state).toMatchObject({ spd: Math.round((100 * SCOOTER.boostSpeed) / SCOOTER.maxSpeed), mode: "boost" });
    settle(h, SCOOTER.maxSpeed * 0.85, false);
    expect(h.state.spd).toBe(85); // a path's share
    settle(h, 40);
    expect(h.state.mode).toBe("cruise"); // slow: no hint
    settle(h, -SCOOTER.reverseSpeed);
    expect(h.state).toMatchObject({ spd: Math.round((100 * SCOOTER.reverseSpeed) / SCOOTER.maxSpeed), mode: "rev" });
    expect(document.querySelector('[data-testid="scooter-hud"]')!.textContent).toContain("SPD");
    expect(document.querySelector('[data-testid="scooter-hud"]')!.textContent).not.toContain("km/h");
    h.dispose();
    expect(document.querySelector('[data-testid="scooter-hud"]')).toBeNull();
  });

  it("eases the dial rather than jumping, both ways", () => {
    const h = new ScooterHud(document.body, limits);
    h.update(SCOOTER.maxSpeed, false, 1 / 60);
    expect(h.state.spd).toBeGreaterThan(0);
    expect(h.state.spd).toBeLessThan(100);
    h.dispose();
  });

  it("exists exactly while mounted: created on the ride, gone on the dismount (and on a forced one)", () => {
    const { pm } = player();
    expect(pm.enter()).toBe(true);
    const hud = () => document.querySelectorAll('[data-testid="scooter-hud"]').length;
    const hooks = { canStand: () => true, place: vi.fn(), forceEnd: vi.fn((why: string) => { void why; pm.endRide(); }), deckTop: DECK_TOP };
    expect(hud()).toBe(0);
    for (let cycle = 0; cycle < 2; cycle++) {
      expect(pm.startRide(hooks, Math.PI / 2)).toBe(true);
      expect(hud()).toBe(1);
      pm.update(1 / 60);
      expect(pm.scooterHudState).not.toBeNull();
      pm.endRide();
      expect(hud()).toBe(0);
      expect(pm.scooterHudState).toBeNull();
    }
    // a forced end (Player View left mid-ride) goes through the world's dismount → endRide
    pm.startRide(hooks, Math.PI / 2);
    expect(hud()).toBe(1);
    pm.exit();
    expect(hooks.forceEnd).toHaveBeenCalled();
    expect(hud()).toBe(0);
    pm.dispose();
  });
});

describe("campus presence", () => {
  it("a peer on the campus reads Outside the Office — never In AI Lab", () => {
    const loc = resolveEmployeeLocation({ posSource: "live", place: CAMPUS_PLACE_ID, point: { x: -500, z: 700 } }, { viewerInsideCave: false, roomName: (r) => r });
    expect(loc).toMatchObject({ label: "Outside the Office", kind: "outside", locatable: true });
  });
});

describe("app/world.ts campus wiring", () => {
  it("the player stands on the campus through the shared WALK profile, owners judging their own space", () => {
    expect(src).toContain(": ground.canOccupy(p, WALK_PROFILE.footRadius, WALK_PROFILE, foreignOwner, undefined, motion);");
    expect(src).toContain('const inLabDomain = (p: Vec2): boolean => ground.groundAt(p).kind === "lab-interior";');
    expect(src).toMatch(/const inOfficeDomain = \(p: Vec2\): boolean => pointInRect\(p, FRAME\) && \(p\.z < FACADE_Z \+ FACADE_WALL_T \|\| pointInRect\(p, ENTRY_ZONE\)\);/);
  });
  it("PHASE 4: the scooter rides the ground model's RIDE profile (the corridor is retired); crowd and stress keep the pre-campus test", () => {
    expect(src).toContain("if (!ground.canOccupy(p, RIDE_PROFILE.footRadius, RIDE_PROFILE, rideForeign, rideIgnore, motion)) return false;");
    expect(src).not.toContain("inRideArea(");
    expect(src).toContain("crowd = new Crowd(R.scene, legacyStand)");
    expect(src).toContain("caveRect: CAVE_FLOOR_RECT, canStand: legacyStand });");
  });
  it("the avatar, the camera and every remote body stand on the same ground", () => {
    expect(src).toContain("avatar.ground = groundYAt;");
    expect(src).toContain("groundY: groundYAt,");
  });
  it("campus is published beyond the frame and received as a real world point; In AI Lab is the Lab's floor", () => {
    expect(src).toContain('const place = inLab || exitAuthorized ? AI_LAB_PLACE_ID : !pointInRect(bpv, FRAME) ? CAMPUS_PLACE_ID : null;');
    expect(src).toContain("c.place === CAMPUS_PLACE_ID ||");
    expect(src).toContain("const inLab = inLabDomain(bpv);");
  });
  it("outside, the camera is stopped by the building and tall solids, never by walkability", () => {
    expect(src).toContain(": inOfficeDomain(playerMode.body.pos) ? legacyCameraProbe(p)");
    expect(src).toContain(": campusCameraClear(p);");
  });
});

describe("PHASE 4 — the deck on the ground", () => {
  it("a slower surface eases the deck down to its share of the top speed — never a snap — and boost scales with it", () => {
    const m = new ScooterMotion(0);
    for (let k = 0; k < 240; k++) m.step({ throttle: 1, steer: 0, boost: false }, 1 / 60);
    expect(m.speed).toBeCloseTo(SCOOTER.maxSpeed, 0);
    m.step({ throttle: 1, steer: 0, boost: false, cap: 0.5 }, 1 / 60);
    expect(m.speed).toBeGreaterThan(SCOOTER.maxSpeed * 0.5 + 60); // one frame later it has barely slowed
    for (let k = 0; k < 120; k++) m.step({ throttle: 1, steer: 0, boost: false, cap: 0.5 }, 1 / 60);
    expect(m.speed).toBeCloseTo(SCOOTER.maxSpeed * 0.5, 0);
    for (let k = 0; k < 240; k++) m.step({ throttle: 1, steer: 0, boost: true, cap: 0.5 }, 1 / 60);
    expect(m.speed).toBeCloseTo(SCOOTER.boostSpeed * 0.5, 0);
  });

  it("the ride follows the ground under the deck: eased height and pitch for rider, scooter and camera; the HUD names the surface", () => {
    const { av, pm } = player();
    expect(pm.enter()).toBe(true);
    let g = { y: 0, pitch: 0, cap: 1, surface: "fast" as const as "fast" | "normal" | "slow" };
    const placed: { y?: number; pitch?: number }[] = [];
    const hooks = { canStand: () => true, place: vi.fn((_p, _h, _l, _s, y?: number, pitch?: number) => { placed.push({ y, pitch }); }), forceEnd: vi.fn(), deckTop: DECK_TOP, ground: () => g };
    expect(pm.startRide(hooks, Math.PI / 2)).toBe(true);
    pm.update(1 / 60);
    expect(av.root.position.y).toBeCloseTo(DECK_TOP, 5);
    // onto a ramp: 3 lower, nose down 0.1, on a path
    g = { y: -3, pitch: -0.1, cap: 0.85, surface: "normal" };
    pm.update(1 / 60);
    const oneFrame = av.root.position.y;
    expect(oneFrame).toBeLessThan(DECK_TOP);
    expect(oneFrame).toBeGreaterThan(DECK_TOP - 3); // eased, not snapped
    for (let k = 0; k < 90; k++) pm.update(1 / 60);
    expect(av.root.position.y).toBeCloseTo(-3 + DECK_TOP, 3);
    expect(placed.at(-1)!.y).toBeCloseTo(-3, 3);
    expect(placed.at(-1)!.pitch).toBeCloseTo(-0.1, 3);
    expect(pm.scooterHudState?.surface).toBe("normal");
    expect(pm.rideSurface).toBe("normal");
    g = { y: -8, pitch: 0, cap: 0.5, surface: "slow" };
    for (let k = 0; k < 90; k++) pm.update(1 / 60);
    expect(pm.scooterHudState?.surface).toBe("slow");
    pm.endRide({ x: 0, z: 0 });
    expect(pm.rideSurface).toBeNull();
    pm.dispose();
  });
});

describe("app/world.ts — Phase 4 scooter wiring", () => {
  it("the deck is placed on the ground (height and pitch from both wheels) and mounts pick a clear heading", () => {
    expect(src).toContain("ground: scooterGround,");
    expect(src).toContain("scenery.scooters!.placeRidden(o.x, o.z, -h, lean, y, pitch)");
    expect(src).toContain("return { y: hr + ((hf - hr) * G.rearZ) / span, pitch: Math.atan2(hf - hr, span), cap: SURFACE_SPEED[surface], surface };");
    expect(src).toContain("const found = [facing, Math.PI / 2, -Math.PI / 2, Math.PI, 0].find(");
  });
  it("a dismount lands on visible walkable ground, searching round the rider if both sides are blocked", () => {
    expect(src).toContain("const at = beside.find((q) => playerStand(q)) ?? standablePointNear(p, NAV_RADIUS, playerStand) ?? { ...p };");
  });
});
