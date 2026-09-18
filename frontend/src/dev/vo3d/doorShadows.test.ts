// vo3d — WHAT AN INTERACTION COSTS THE SHADOW MAP (Phase 4C stages 4 and 4b).
//
// Stage 4 is the door; stage 4b is the seat, the approach and the body's own heading. One rule runs
// through all of them: the static shadow map is redrawn when a STATIC caster's transform changed, and
// the cheap dynamic composite runs when the BODY's pose changed — never because a state machine happens
// not to be idle.
//
// A door leaf is a STATIC caster: every frame it is reported stale, app/world calls
// Renderer.invalidateShadows() and the next frame redraws every static caster in the building (~2,800 on
// the ground floor), and an unbroken streak of those trips the renderer's thrash fallback, which stands
// the cached static depth down entirely. The rule used to be `state !== "closed"`, which is also true for
// the whole HOLD — a door standing wide open, perfectly still, while Bon walks through it. Measured on an
// M1 walking through the Design Room door: 119 of 202 static redraws were held-open frames, i.e. redraws
// that reproduced the previous shadow map exactly.
//
// The rule is now SlidingDoor.moved: the leaf's transform changed on this update. These tests hold both
// halves of that — that the waste is gone, AND that the shadow map is never allowed to lag the leaf,
// which is the bug the old over-invalidation was hiding behind.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, DESIGN_DOOR, DOOR_ID, designRoomEntities } from "./rooms/design-room";
import { SlidingDoor } from "./interact/Door";
import { SeatInteraction } from "./interact/Seat";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack } from "./avatar/Controller";
import { CHAIR_4_ID } from "./rooms/design-room";
import { casterPoseMoved, snapShadowCentre, type CasterPose } from "./render/Renderer";
import type { NavResult } from "./nav/planner";
import type { Vec2 } from "./core/coords";

const DT = 1 / 60;
const SPEED = 30; // units/s — the approved office walk speed

function doorRig() {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  const closed = world.get(DOOR_ID).transform.pos;
  const view = new THREE.Object3D();
  view.position.set(closed.x, 0, closed.z);
  return { door: new SlidingDoor(view, DESIGN_DOOR, closed), view, closed };
}

/** Walk a body straight through the doorway along x and step the door with it, one frame at a time.
 *  Returns, per frame, what the door was doing and what each staleness rule would have asked for. */
function walkThrough(door: SlidingDoor, frames = 900) {
  const c = DESIGN_DOOR.crossing;
  const cz = c.z + c.d / 2;
  const bon: Vec2 = { x: c.x + c.w / 2 - 150, z: cz };
  const goal: Vec2 = { x: c.x + c.w / 2 + 150, z: cz };
  /** the leaf pose the shadow map was last drawn from — what a viewer actually sees */
  let shadowZ = door.leafPosition.z;
  let staleFrames = 0;      // frames the leaf pose on screen disagreed with the shadow it casts
  const rows: { state: string; moved: boolean; open: boolean; leafZ: number; redrew: boolean; actuallyMoved: boolean }[] = [];
  let prevZ = door.leafPosition.z;
  for (let f = 0; f < frames; f++) {
    if (bon.x < goal.x) bon.x = Math.min(goal.x, bon.x + SPEED * DT);
    door.update(DT, bon, [goal]);
    const redrew = door.moved; // THE RULE UNDER TEST, exactly as app/world's worldShadowsAreStale uses it
    if (redrew) shadowZ = door.leafPosition.z;
    if (shadowZ !== door.leafPosition.z) staleFrames++;
    const actuallyMoved = door.leafPosition.z !== prevZ;
    prevZ = door.leafPosition.z;
    rows.push({ state: door.state, moved: door.moved, open: door.state !== "closed", leafZ: door.leafPosition.z, redrew, actuallyMoved });
    if (f > 60 && door.state === "closed" && bon.x >= goal.x) break;
  }
  return { rows, staleFrames };
}

describe("a door's shadow invalidation follows the leaf, not the state machine", () => {
  it("reports no motion while closed and idle", () => {
    const { door } = doorRig();
    const far = { x: DESIGN_DOOR.trigger.x - 500, z: DESIGN_DOOR.trigger.z };
    for (let f = 0; f < 120; f++) {
      door.update(DT, far, []);
      expect(door.moved, `frame ${f}`).toBe(false);
    }
    expect(door.state).toBe("closed");
  });

  it("reports motion on exactly the frames the leaf transform changed", () => {
    const { door } = doorRig();
    const { rows } = walkThrough(door);
    // THE WHOLE CONTRACT IN ONE LINE. `moved` is not a paraphrase of the state machine — it is the
    // question the shadow map actually asks: did the thing that casts the shadow change position?
    expect(rows.every((r) => r.moved === r.actuallyMoved)).toBe(true);
    expect(rows.filter((r) => r.state === "opening" && r.moved).length).toBeGreaterThan(10);
    expect(rows.filter((r) => r.state === "closing" && r.moved).length).toBeGreaterThan(10);
  });

  it("reports motion on the frame the leaf lands closed, which a state test would drop", () => {
    const { door } = doorRig();
    const { rows } = walkThrough(door);
    // `closing` flips to `closed` inside the same update that writes t = 0, so a rule keyed on "the
    // state says it is moving" would miss exactly the frame the leaf arrives at its rest transform.
    const landing = rows.findIndex((r, i) => r.state === "closed" && i > 0 && rows[i - 1].state === "closing");
    expect(landing).toBeGreaterThan(0);
    expect(rows[landing].moved).toBe(true);
    expect(rows.slice(landing + 1).some((r) => r.moved)).toBe(false);
  });

  it("asks for nothing while it is held still, which is where the waste was", () => {
    const { door } = doorRig();
    const { rows } = walkThrough(door);
    // "held" = the leaf is not closed and is not moving: the whole hold, plus the crossing itself while
    // Bon keeps the door open under him. Every one of these frames used to cost a full static redraw.
    const held = rows.filter((r) => r.open && !r.actuallyMoved);
    expect(held.length).toBeGreaterThan(30);
    expect(held.some((r) => r.moved)).toBe(false);
    const before = rows.filter((r) => r.open).length;   // the old rule: state !== "closed"
    const after = rows.filter((r) => r.redrew).length;  // the rule now in force
    expect(after).toBe(rows.filter((r) => r.actuallyMoved).length);
    // the old rule paid for every held frame and still missed the landing one, which is the +1 here
    expect(before - after).toBe(held.length - 1);
    expect(after).toBeLessThan(before / 2); // over half the door's redraws were reproducing the last map
  });

  it("never lets the shadow map lag the leaf: every frame the leaf is drawn where its shadow was cast", () => {
    const { door } = doorRig();
    expect(walkThrough(door).staleFrames).toBe(0);
  });

  it("a reset from open is a move — the leaf snaps back and the map has to follow", () => {
    const { door } = doorRig();
    const c = DESIGN_DOOR.crossing;
    const bon = { x: c.x + c.w / 2, z: c.z + c.d / 2 };
    for (let f = 0; f < 120 && door.state !== "open"; f++) door.update(DT, bon, []);
    expect(door.state).toBe("open");
    door.reset();
    expect(door.moved).toBe(true);
    expect(door.state).toBe("closed");
    door.update(DT, { x: c.x - 900, z: c.z }, []);
    expect(door.moved).toBe(false);
  });

  it("re-opening out of a close (a reversal) reports motion as soon as the leaf turns around", () => {
    const { door } = doorRig();
    const c = DESIGN_DOOR.crossing;
    const inside = { x: c.x + c.w / 2, z: c.z + c.d / 2 };
    const away = { x: c.x - 900, z: c.z + c.d / 2 };
    for (let f = 0; f < 200 && door.state !== "open"; f++) door.update(DT, inside, []);
    for (let f = 0; f < 200 && door.state !== "closing"; f++) door.update(DT, away, []);
    expect(door.state).toBe("closing");
    for (let f = 0; f < 20; f++) door.update(DT, away, []); // let it travel, so there is something to reverse
    expect(door.t).toBeLessThan(1);
    const z0 = door.leafPosition.z;
    door.update(DT, inside, []); // the turnaround frame itself only flips the state; the leaf holds
    expect(door.state).toBe("opening");
    expect(door.leafPosition.z).toBe(z0);
    expect(door.moved).toBe(false);
    for (let f = 0; f < 10; f++) {
      const prev = door.leafPosition.z;
      door.update(DT, inside, []);
      expect(door.leafPosition.z).not.toBe(prev);
      expect(door.moved, `re-opening frame ${f}`).toBe(true);
    }
  });
});

describe("camera movement still redraws the static shadow map on its own", () => {
  // The door rule changed; the CAMERA rule did not. A shadow frustum that re-centres invalidates every
  // static caster whatever the doors are doing, and a held-open door must not suppress that.
  const QUANTUM = 8; // the orbit default OFFICE runs on

  it("re-snaps the shadow centre as the view pans, independently of any door", () => {
    let centre: Vec2 = { x: Number.NaN, z: Number.NaN };
    const focus: Vec2 = { x: 0, z: 0 };
    let snaps = 0;
    for (let f = 0; f < 240; f++) {
      const next = snapShadowCentre(centre, focus, QUANTUM);
      if (next !== centre) snaps++;
      centre = next;
      focus.x += 1.5; // a pan, ~90 units/s at 60 fps
    }
    expect(snaps).toBeGreaterThan(20);
  });

  it("a still camera asks for nothing, so an open door is the only thing that could — and it does not", () => {
    const { door } = doorRig();
    const c = DESIGN_DOOR.crossing;
    const inside = { x: c.x + c.w / 2, z: c.z + c.d / 2 };
    for (let f = 0; f < 200 && door.state !== "open"; f++) door.update(DT, inside, []);
    expect(door.state).toBe("open");
    const focus: Vec2 = { x: 100, z: 100 };
    let centre = snapShadowCentre({ x: Number.NaN, z: Number.NaN }, focus, QUANTUM);
    let invalidations = 0;
    for (let f = 0; f < 120; f++) {
      door.update(DT, inside, []);
      const next = snapShadowCentre(centre, focus, QUANTUM);
      if (next !== centre || door.moved) invalidations++;
      centre = next;
    }
    expect(invalidations).toBe(0);
  });
});

// =================================================================================================
// STAGE 4b — the chair, and the body's heading.
// =================================================================================================

/** A seat rig with navigation stubbed out: the planner is exercised in door.test.ts, and what matters
 *  here is which frames of the sequence write to the CHAIR. */
function seatRig() {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  const spec = world.get(CHAIR_4_ID).capabilities.seat!;
  const scene = new THREE.Object3D();
  const chair = new THREE.Object3D();
  const rest = world.get(CHAIR_4_ID).transform.pos;
  chair.position.set(rest.x, 0, rest.z);
  scene.add(chair);
  const avatar = new Avatar({ height: 36, lit: true });
  scene.add(avatar.root);
  avatar.setPosition(spec.approach);
  const stack = new ControllerStack();
  const walk = (to: Vec2): NavResult => ({ ok: true, destination: to, path: [to], cell: { cx: 0, cy: 0 } });
  const seat = new SeatInteraction(avatar, stack, chair, spec, walk);
  return { seat, chair, avatar, spec };
}

/** Run the sit → seated → stand → idle sequence, recording per frame what the chair did and what the
 *  controller reported. Returns one row per frame. */
function sitCycle(seat: SeatInteraction, chair: THREE.Object3D) {
  const rows: { state: string; moved: boolean; chairMoved: boolean }[] = [];
  const prev = new THREE.Vector3().copy(chair.position);
  const prevQ = new THREE.Quaternion().copy(chair.quaternion);
  expect(seat.sit()?.ok).toBe(true);
  const step = () => {
    prev.copy(chair.position); prevQ.copy(chair.quaternion);
    seat.update(DT);
    rows.push({ state: seat.state, moved: seat.moved, chairMoved: !chair.position.equals(prev) || !chair.quaternion.equals(prevQ) });
  };
  for (let f = 0; f < 3000 && seat.state !== "seated"; f++) step();
  for (let f = 0; f < 120; f++) step(); // two seconds of just sitting there
  seat.stand();
  for (let f = 0; f < 3000 && seat.state !== "idle"; f++) step();
  for (let f = 0; f < 60; f++) step();
  return rows;
}

describe("a seat reports the CHAIR's motion, not its own busyness", () => {
  it("is quiet while idle", () => {
    const { seat } = seatRig();
    for (let f = 0; f < 60; f++) { seat.update(DT); expect(seat.moved).toBe(false); }
  });

  it("reports motion on exactly the frames the chair transform changed", () => {
    const { seat, chair } = seatRig();
    const rows = sitCycle(seat, chair);
    expect(seat.state).toBe("idle");
    expect(rows.every((r) => r.moved === r.chairMoved)).toBe(true);
    expect(rows.filter((r) => r.moved).length).toBeGreaterThan(20); // pull out, slide in, slide out, return
  });

  it("asks for nothing at all while SEATED, which is where the permanent redraw was", () => {
    const { seat, chair } = seatRig();
    const rows = sitCycle(seat, chair);
    // Each phase's LAST frame is where the chair is copied onto its exact target and the next state is
    // entered, so a handful of frames labelled "seated"/"standing" are genuinely the chair landing; they
    // must still redraw. Everything else in those stretches is the chair standing still.
    const seated = rows.filter((r) => r.state === "seated" && !r.chairMoved);
    expect(seated.length).toBeGreaterThan(60);
    expect(seated.some((r) => r.moved)).toBe(false);
    // and the walk-over / glide / walk-away frames, which move only the body, are quiet too
    const bodyOnly = rows.filter((r) => !r.chairMoved && ["approaching", "enteringGap", "sitting", "standing", "leavingGap"].includes(r.state));
    expect(bodyOnly.length).toBeGreaterThan(10);
    expect(bodyOnly.some((r) => r.moved)).toBe(false);
    // the old rule charged a full static redraw for EVERY non-idle frame; this is what that cost
    const oldRule = rows.filter((r) => r.state !== "idle").length;
    expect(rows.filter((r) => r.moved).length).toBeLessThan(oldRule / 2);
  });

  it("returns the chair to its rest transform, and says so on the frame it lands", () => {
    const { seat, chair } = seatRig();
    const rows = sitCycle(seat, chair);
    expect(seat.chairRestError()).toBeLessThan(1e-9);
    const landing = rows.findIndex((r, i) => r.state === "idle" && i > 0 && rows[i - 1].state === "returningChair");
    expect(landing).toBeGreaterThan(0);
    expect(rows[landing].moved).toBe(true);
    expect(rows.slice(landing + 1).some((r) => r.moved)).toBe(false);
  });

  it("a reset snaps the chair back and reports it", () => {
    const { seat, chair } = seatRig();
    expect(seat.sit()?.ok).toBe(true);
    for (let f = 0; f < 3000 && seat.state !== "seated"; f++) seat.update(DT);
    expect(seat.state).toBe("seated");
    seat.reset();
    expect(seat.moved).toBe(true);
    expect(seat.chairRestError()).toBeLessThan(1e-9);
    const rest = chair.position.clone();
    seat.update(DT);
    expect(chair.position.equals(rest)).toBe(true); // idle writes nothing more
    expect(seat.moved).toBe(false);
  });
});

describe("a body's shadow follows its heading, not only its feet", () => {
  const at = (x: number, z: number, yaw: number, clip = "idle"): CasterPose => ({ x, z, yaw, clip });

  it("a turn on the spot is motion — the case an approach and a sit-down both end with", () => {
    expect(casterPoseMoved(at(10, 10, 0), at(10, 10, 0.07))).toBe(true);   // one frame of a 4.2 rad/s turn
    expect(casterPoseMoved(at(10, 10, 0), at(10, 10, Math.PI))).toBe(true);
  });

  it("holds still for a body that is holding still", () => {
    expect(casterPoseMoved(at(10, 10, 1), at(10, 10, 1))).toBe(false);
    expect(casterPoseMoved(at(10, 10, 1), at(10.005, 9.997, 1.001))).toBe(false); // under both epsilons
  });

  it("measures the turn the short way round, so wrapping past π is not a spin", () => {
    expect(casterPoseMoved(at(0, 0, Math.PI - 0.001), at(0, 0, -Math.PI + 0.0005))).toBe(false);
    expect(casterPoseMoved(at(0, 0, Math.PI - 0.001), at(0, 0, -Math.PI + 0.02))).toBe(true);
  });

  it("still catches what it always caught: walking, and a clip change", () => {
    expect(casterPoseMoved(at(0, 0, 0), at(0.5, 0, 0))).toBe(true);
    expect(casterPoseMoved(at(0, 0, 0), at(0, 0, 0, "walking"))).toBe(true);
  });

  it("re-composites on the first frame, when nothing has been drawn yet", () => {
    expect(casterPoseMoved(at(Number.NaN, 0, Number.NaN), at(0, 0, 0))).toBe(true);
  });
});
