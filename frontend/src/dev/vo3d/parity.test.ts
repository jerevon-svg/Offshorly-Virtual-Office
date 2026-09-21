// vo3d — V1/V2 PARITY: multiplayer doors, the run cycle, and the player jump.
//
// Three problems that all live between "what one browser does" and "what the other browser sees", tested
// at the seams the fixes actually landed on rather than through the whole world:
//
//   A  the automatic doors now react to EVERY body the world draws, not just the local one
//      (interact/Door's `others`, fed from world/Coworkers.doorBodies)
//   B  the locomotion clip and its playback rate are one shared rule for the local body and for every
//      peer, including the fallback for a package that ships no run clip (avatar/gait)
//   C  the jump arc, its grounded/no-double-jump rule and the Space edge that drives it
//      (player/PlayerJump, player/PlayerInput)
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SlidingDoor, type DoorBody } from "./interact/Door";
import { ReplayWalk } from "./world/coworkerWalk";
import { CLIP_RUN, CLIP_WALK } from "./adapters/v1Avatar";
import { locomotionClip, locomotionRate, CLIP_GROUND_SPEED } from "./avatar/gait";
import { PlayerJump } from "./player/PlayerJump";
import { PlayerInput } from "./player/PlayerInput";
import { PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "./player/PlayerMode";
import type { DoorCapability } from "./world/WorldState";
import type { Vec2 } from "./core/coords";

const DT = 1 / 60;

// ---- A. doors ------------------------------------------------------------------------------------
// A plain east-west corridor door: the leaf slides north out of a 40-wide crossing, with a trigger box
// reaching 60 units either side of it. Deliberately not a room's real door — the rule under test is
// SlidingDoor's, and a synthetic spec makes the geometry legible.
const SPEC: DoorCapability = {
  slide: { x: 0, z: -1 },
  slideDistance: 40,
  crossing: { x: -20, z: -20, w: 40, d: 40 },
  trigger: { x: -80, z: -80, w: 160, d: 160 },
  clearance: { bodyRadius: 8, band: { x: -20, z: -20, w: 40, d: 40 }, solids: [] },
  timings: { openMs: 400, closeMs: 400, holdMs: 600 },
};

/** A stand-in for the door's own scene node: SlidingDoor writes position.x/z and reads nothing else. */
const door = () => new SlidingDoor(new THREE.Object3D(), SPEC, { x: 0, z: 0 });
/** Somebody standing still, far away and not going anywhere — the local employee in most of these. */
const AWAY: Vec2 = { x: 1000, z: 1000 };
/** Run the door for `ms` with one local body and whichever peers. */
const run = (d: SlidingDoor, ms: number, local: Vec2, path: readonly Vec2[], peers: readonly DoorBody[]) => {
  for (let t = 0; t < ms; t += DT * 1000) d.update(DT, local, path, peers);
};

describe("vo3d parity A — multiplayer doors", () => {
  it("opens for a REMOTE body whose route passes through it, with the local employee elsewhere", () => {
    const d = door();
    const peer: DoorBody = { pos: { x: 0, z: 70 }, path: [{ x: 0, z: -70 }] };
    expect(d.state).toBe("closed");
    run(d, 500, AWAY, [], [peer]);
    expect(d.t).toBe(1);
    expect(d.state).toBe("open");
  });

  it("ignores a remote body that is merely walking PAST — the same refusal the local body gets", () => {
    const d = door();
    // inside the trigger box, but travelling east-west well clear of the crossing band
    const passerBy: DoorBody = { pos: { x: -70, z: 60 }, path: [{ x: 70, z: 60 }] };
    run(d, 2000, AWAY, [], [passerBy]);
    expect(d.state).toBe("closed");
    expect(d.t).toBe(0);
  });

  it("does not close early while a SECOND employee is still in the doorway", () => {
    const d = door();
    const first: DoorBody = { pos: { x: 0, z: 0 }, path: [] };
    const second: DoorBody = { pos: { x: 0, z: 60 }, path: [{ x: 0, z: -60 }] };
    run(d, 500, AWAY, [], [first, second]);
    expect(d.state).toBe("open");
    // the first walks clear; the second is now standing in the crossing. Well past holdMs.
    const secondInside: DoorBody = { pos: { x: 0, z: 0 }, path: [] };
    run(d, 2000, AWAY, [], [secondInside]);
    expect(d.state).toBe("open");
    expect(d.t).toBe(1);
    // and only once EVERYBODY is clear does it close
    run(d, 2000, AWAY, [], []);
    expect(d.state).toBe("closed");
    expect(d.cycles).toBe(1);
  });

  it("works for two bodies crossing in OPPOSITE directions", () => {
    const d = door();
    const northbound: DoorBody = { pos: { x: 0, z: 60 }, path: [{ x: 0, z: -60 }] };
    const southbound: DoorBody = { pos: { x: 0, z: -60 }, path: [{ x: 0, z: 60 }] };
    run(d, 500, AWAY, [], [northbound, southbound]);
    expect(d.state).toBe("open");
    // both now in the band at once — still open, still one door, no per-person state
    run(d, 1000, AWAY, [], [{ pos: { x: -6, z: 0 }, path: [] }, { pos: { x: 6, z: 0 }, path: [] }]);
    expect(d.state).toBe("open");
  });

  it("RECOVERS when the body that opened it vanishes — a disconnect, a teleport, a room change", () => {
    const d = door();
    run(d, 500, AWAY, [], [{ pos: { x: 0, z: 0 }, path: [] }]);
    expect(d.state).toBe("open");
    // the peer is simply not in the list any more. No cleanup call, no per-door bookkeeping.
    run(d, 2000, AWAY, [], []);
    expect(d.state).toBe("closed");
    expect(d.t).toBe(0);
    expect(d.driftError()).toBeLessThan(1e-9);
  });

  it("is byte-for-byte the old door when nobody else is around", () => {
    const withList = door();
    const without = door();
    const local = { x: 0, z: 60 };
    const path = [{ x: 0, z: -60 }];
    for (let i = 0; i < 200; i++) {
      withList.update(DT, local, path, []);
      without.update(DT, local, path);
      expect(withList.t).toBe(without.t);
      expect(withList.state).toBe(without.state);
    }
  });

  it("ReplayWalk.remaining() shortens as the walk proceeds and empties at the end", () => {
    const w = new ReplayWalk("m", [{ x: 0, z: 0 }, { x: 0, z: 30 }, { x: 0, z: 60 }], 1000, 0, "linear");
    expect(w.remaining()).toHaveLength(2);
    w.advance(600);
    expect(w.remaining()).toEqual([{ x: 0, z: 60 }]);
    w.advance(600);
    expect(w.remaining()).toEqual([]);
  });
});

// ---- B. run cycle --------------------------------------------------------------------------------
describe("vo3d parity B — run cycle", () => {
  it("runs when the movement is a run AND the package has the clip", () => {
    expect(locomotionClip(true, true)).toBe(CLIP_RUN);
  });

  it("falls back to the walk clip for a package with no run clip, rather than freezing", () => {
    expect(locomotionClip(true, false)).toBe(CLIP_WALK);
  });

  it("walks at walking speed, whatever the rig can do", () => {
    expect(locomotionClip(false, true)).toBe(CLIP_WALK);
    expect(locomotionClip(false, false)).toBe(CLIP_WALK);
  });

  it("keeps a walking body's feet on the ground at the tuned walk speed", () => {
    expect(locomotionRate(CLIP_WALK, PLAYER_WALK_SPEED)).toBeCloseTo(PLAYER_WALK_SPEED / 30, 5);
  });

  it("keeps a RUNNING body's feet on the ground at sprint speed", () => {
    expect(locomotionRate(CLIP_RUN, PLAYER_SPRINT_SPEED)).toBeCloseTo(PLAYER_SPRINT_SPEED / 48, 5);
  });

  it("THE FALLBACK NO LONGER SKATES: a sprint on a walk-only rig reaches the rate the ground demands", () => {
    // the defect: one ceiling of 2.5 clamped this to 40 u/s of stride under 100 u/s of travel
    const needed = PLAYER_SPRINT_SPEED / CLIP_GROUND_SPEED[CLIP_WALK];
    expect(needed).toBeGreaterThan(2.5);
    expect(locomotionRate(CLIP_WALK, PLAYER_SPRINT_SPEED)).toBeCloseTo(needed, 2);
  });

  it("still guards a spike: a pathological frame cannot drive a clip arbitrarily fast", () => {
    expect(locomotionRate(CLIP_WALK, 100_000)).toBeLessThanOrEqual(3.4);
    expect(locomotionRate(CLIP_RUN, 100_000)).toBeLessThanOrEqual(2.5);
  });

  it("never stalls a moving body's clip completely", () => {
    expect(locomotionRate(CLIP_WALK, 0)).toBeGreaterThan(0);
  });

  it("a peer's replayed sprint leg reads as a run-speed movement", () => {
    // one 400 ms free-movement leg at the sprint speed, as app/selfMovement publishes it
    const leg = new ReplayWalk("m", [{ x: 0, z: 0 }, { x: 0, z: PLAYER_SPRINT_SPEED * 0.4 }], 400, 0, "linear");
    expect(leg.meanSpeed).toBeCloseTo(PLAYER_SPRINT_SPEED, 5);
    const walkLeg = new ReplayWalk("m", [{ x: 0, z: 0 }, { x: 0, z: PLAYER_WALK_SPEED * 0.4 }], 400, 0, "linear");
    expect(walkLeg.meanSpeed).toBeCloseTo(PLAYER_WALK_SPEED, 5);
    // and the threshold world/Coworkers picks the clip by sits between them
    const threshold = (PLAYER_WALK_SPEED + PLAYER_SPRINT_SPEED) / 2;
    expect(walkLeg.meanSpeed).toBeLessThan(threshold);
    expect(leg.meanSpeed).toBeGreaterThan(threshold);
  });
});

// ---- C. jump -------------------------------------------------------------------------------------
describe("vo3d parity C — player jump", () => {
  it("starts on the floor and stays there until asked", () => {
    const j = new PlayerJump();
    expect(j.airborne).toBe(false);
    expect(j.height).toBe(0);
    for (let i = 0; i < 60; i++) expect(j.update(DT)).toBe(false);
    expect(j.height).toBe(0);
  });

  it("takes off, reaches a small natural apex and lands, all inside about two thirds of a second", () => {
    const j = new PlayerJump();
    expect(j.start()).toBe(true);
    let apex = 0;
    let ms = 0;
    let landed = false;
    while (ms < 5000 && !landed) {
      landed = j.update(DT);
      apex = Math.max(apex, j.height);
      ms += DT * 1000;
    }
    expect(landed).toBe(true);
    expect(apex).toBeGreaterThan(8);
    expect(apex).toBeLessThan(16); // well under the 36-unit body, far under a 46-unit wall
    expect(ms).toBeGreaterThan(400);
    expect(ms).toBeLessThan(800);
  });

  it("reports the landing on exactly ONE frame, and never floats afterwards", () => {
    const j = new PlayerJump();
    j.start();
    let landings = 0;
    for (let i = 0; i < 600; i++) if (j.update(DT)) landings++;
    expect(landings).toBe(1);
    expect(j.height).toBe(0);
    expect(j.airborne).toBe(false);
  });

  it("refuses a second jump in mid-air — no double jump, and holding Space is one jump", () => {
    const j = new PlayerJump();
    expect(j.start()).toBe(true);
    j.update(DT);
    expect(j.start()).toBe(false);
    expect(j.start()).toBe(false);
  });

  it("jumps only when grounded, and can jump again once it is", () => {
    const j = new PlayerJump();
    j.start();
    while (!j.update(DT)) { /* fall */ }
    expect(j.airborne).toBe(false);
    expect(j.start()).toBe(true);
  });

  it("reset() puts the body down with no landing frame — the handoff path", () => {
    const j = new PlayerJump();
    j.start();
    for (let i = 0; i < 5; i++) j.update(DT);
    expect(j.height).toBeGreaterThan(0);
    j.reset();
    expect(j.height).toBe(0);
    expect(j.airborne).toBe(false);
    expect(j.update(DT)).toBe(false);
  });
});

describe("vo3d parity C — the Space key", () => {
  function rig() {
    const canvas = document.createElement("canvas");
    let jumps = 0;
    const input = new PlayerInput(canvas, {
      onInteract: () => {},
      onToggleView: () => {},
      onJump: () => { jumps += 1; },
      onLockChange: () => {},
    });
    input.enable();
    const key = (type: "keydown" | "keyup", code: string, init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
      window.dispatchEvent(e);
      return e;
    };
    return { input, key, jumps: () => jumps, done: () => input.disable() };
  }

  it("fires once per press", () => {
    const r = rig();
    r.key("keydown", "Space");
    expect(r.jumps()).toBe(1);
    r.key("keyup", "Space");
    r.key("keydown", "Space");
    expect(r.jumps()).toBe(2);
    r.done();
  });

  it("does NOT auto-repeat while Space is held down", () => {
    const r = rig();
    r.key("keydown", "Space");
    for (let i = 0; i < 20; i++) r.key("keydown", "Space", { repeat: true });
    for (let i = 0; i < 20; i++) r.key("keydown", "Space"); // environments that do not set `repeat`
    expect(r.jumps()).toBe(1);
    r.key("keyup", "Space");
    r.key("keydown", "Space");
    expect(r.jumps()).toBe(2);
    r.done();
  });

  it("prevents the browser's default, so Space cannot scroll the page", () => {
    const r = rig();
    const e = r.key("keydown", "Space");
    expect(e.defaultPrevented).toBe(true);
    r.done();
  });

  it("leaves Space alone while the user is typing", () => {
    const r = rig();
    const field = document.createElement("input");
    document.body.appendChild(field);
    const e = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
    field.dispatchEvent(e);
    expect(r.jumps()).toBe(0);
    expect(e.defaultPrevented).toBe(false);
    field.remove();
    r.done();
  });

  it("leaves Space alone while a modal owns the screen", () => {
    const r = rig();
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    const button = document.createElement("button");
    modal.appendChild(button);
    document.body.appendChild(modal);
    const e = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
    button.dispatchEvent(e);
    expect(r.jumps()).toBe(0);
    expect(e.defaultPrevented).toBe(false);
    modal.remove();
    r.done();
  });

  it("is not bound at all outside PLAYER mode — the listeners are removed on disable", () => {
    const r = rig();
    r.done();
    r.key("keydown", "Space");
    expect(r.jumps()).toBe(0);
  });

  it("a tab-out re-arms the key rather than leaving it stuck down", () => {
    const r = rig();
    r.key("keydown", "Space");
    expect(r.jumps()).toBe(1);
    window.dispatchEvent(new Event("blur"));
    r.key("keydown", "Space");
    expect(r.jumps()).toBe(2);
    r.done();
  });

  it("does not disturb the movement keys or sprint", () => {
    const r = rig();
    r.key("keydown", "KeyW");
    r.key("keydown", "ShiftLeft");
    r.key("keydown", "Space");
    expect(r.input.axis).toEqual({ x: 0, z: -1 });
    expect(r.input.sprinting).toBe(true);
    r.done();
  });
});
