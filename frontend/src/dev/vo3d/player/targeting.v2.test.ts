// INTERACTION V2 — Player View targeting: facing, anchors, stability, cycling, sight and friendly labels.
import { describe, expect, it } from "vitest";
import { cycleTarget, FACING_MAX, friendlyLabel, nearbyFixture, personCandidateId, pickTarget, REACH, type Candidate } from "./PlayerTargeting";
import { describeInteractable, objectSelectionFor } from "../app/interactables";
import { FAST_FORWARD_MAX_RATE, gaitRate, walkRate } from "../avatar/gait";
import type { Entity } from "../world/WorldState";

const NORTH = { x: 0, z: -1 };
const O = { x: 0, z: 0 };
const chair = (id: string, x: number, z: number, anchor?: { x: number; z: number }): Candidate =>
  ({ id, kind: "seat", pos: { x, z }, label: "Sit on chair", roomId: "hub", ...(anchor ? { anchors: [anchor] } : {}) });
const person = (email: string, x: number, z: number): Candidate => ({ id: personCandidateId(email), kind: "person", pos: { x, z }, label: email, roomId: "" });
const lift = (pos: { x: number; z: number }, stand: { x: number; z: number }): Candidate =>
  ({ id: "elevator-1/call", kind: "approach", pos, label: "Call the elevator", roomId: "elevator-1", anchors: [stand] });

describe("facing", () => {
  it("never targets a chair behind the body, even close (the café case)", () => {
    expect(pickTarget([chair("c", 0, 15)], O, NORTH)).toBeNull();
    expect(pickTarget([chair("c", 10, 12)], O, NORTH)).toBeNull();
  });
  it("still targets what the body stands on top of", () => {
    expect(pickTarget([chair("c", 0, 6)], O, NORTH)?.id).toBe("c");
  });
  it("prefers the chair ahead over a nearer one off to the side", () => {
    expect(pickTarget([chair("side", 22, -8), chair("ahead", 0, -35)], O, NORTH)?.id).toBe("ahead");
  });
  it("caps the cone at FACING_MAX up close", () => {
    const a = FACING_MAX + 0.1;
    expect(pickTarget([chair("c", Math.sin(a) * 14, -Math.cos(a) * 14)], O, NORTH)).toBeNull();
  });
});

describe("anchors", () => {
  it("measures reach to the stand cell, so a chair whose centre is past reach is offered from its own stand spot", () => {
    const c = chair("c", 0, -(REACH + 10), { x: 0, z: -(REACH - 5) });
    expect(pickTarget([c], O, NORTH)?.id).toBe("c");
  });
});

describe("stability", () => {
  it("keeps the held target through a near-tie and gives it up when another is clearly better", () => {
    const a = chair("a", -4, -40), b = chair("b", 4, -40);
    const first = pickTarget([a, b], O, NORTH)!.id;
    const other = first === "a" ? "b" : "a";
    // sway slightly toward the other one: still held
    const sway = { x: (other === "b" ? 1 : -1) * 0.08, z: -1 };
    const n = Math.hypot(sway.x, sway.z);
    expect(pickTarget([a, b], O, { x: sway.x / n, z: sway.z / n }, { current: first })?.id).toBe(first);
    // turn clearly onto the other one: it wins
    const turn = { x: (other === "b" ? 1 : -1) * 0.6, z: -1 };
    const m = Math.hypot(turn.x, turn.z);
    expect(pickTarget([a, b], O, { x: turn.x / m, z: turn.z / m }, { current: first })?.id).toBe(other);
  });
  it("cycles through every eligible target and wraps", () => {
    const list = [chair("a", 0, -30), chair("b", 10, -30), chair("c", -10, -30)];
    const first = pickTarget(list, O, NORTH)!.id;
    const seen = new Set([first]);
    let cur = first;
    for (let i = 0; i < 3; i++) { cur = cycleTarget(list, O, NORTH, cur)!.id; seen.add(cur); }
    expect(seen.size).toBe(3);
    expect(cycleTarget([chair("solo", 0, -30)], O, NORTH, "solo")).toBeNull();
  });
});

describe("the elevator among a crowd", () => {
  const stand = { x: 0, z: -8 };
  const plate = { x: 0, z: -24 };
  it("standing in the lift's stand zone, the lift wins over the people round it", () => {
    const t = pickTarget([lift(plate, stand), person("a@x", 3, -16), person("b@x", -4, -18)], { x: 0, z: -6 }, NORTH);
    expect(t?.id).toBe("elevator-1/call");
  });
  it("…whichever way the body faces there", () => {
    expect(pickTarget([lift(plate, stand)], { x: 0, z: -6 }, { x: 0, z: 1 })?.id).toBe("elevator-1/call");
  });
  it("is named and marked from further off, before it is in reach", () => {
    const far = { x: 0, z: 90 };
    const hint = nearbyFixture([lift(plate, stand)], far, NORTH, REACH * 2);
    expect(hint?.label).toBe("Call the elevator");
    expect(nearbyFixture([lift(plate, stand)], far, { x: 0, z: 1 }, REACH * 2)).toBeNull(); // not when facing away
  });
});

describe("line of sight", () => {
  it("drops a candidate the sight test refuses (a person through a wall)", () => {
    const wall = (_f: unknown, to: { x: number }) => to.x < 0;
    expect(pickTarget([person("a@x", 5, -30)], O, NORTH, { sight: wall })).toBeNull();
    expect(pickTarget([person("b@x", -5, -30)], O, NORTH, { sight: wall })?.kind).toBe("person");
  });
});

describe("friendly labels", () => {
  it("never shows an asset id", () => {
    expect(friendlyLabel("seat")).toBe("Sit on chair");
    expect(friendlyLabel("seat", { workstation: true })).toBe("Sit at desk");
    expect(friendlyLabel("lounge")).toBe("Sit down");
    expect(friendlyLabel("approach", { action: "call-elevator", label: "Call the elevator" })).toBe("Call the elevator");
    expect(friendlyLabel("approach", { action: "Grab a coffee", label: "Pantry" })).toBe("Grab a coffee");
  });
});

describe("the shared interaction contract (Office View card)", () => {
  const seatEntity = (workstation: boolean): Entity => ({
    id: "central-hub/cafe-chair-1-south", kind: "solid", roomId: "central-hub", transform: { pos: { x: 10, z: 10 }, yaw: 0 },
    capabilities: { seat: { approach: { x: 10, z: 30 }, workstation } as never }, props: {}, source: { baked: true },
  } as unknown as Entity);
  it("names a chair as a chair and offers Sit, then a walk", () => {
    const sel = objectSelectionFor(seatEntity(false))!;
    expect(sel.title).toBe("Chair");
    expect(sel.actions.map((a) => a.label)).toEqual(["Sit on chair", "Walk over"]);
    expect(describeInteractable(seatEntity(false))?.anchor).toEqual({ x: 10, z: 30 });
  });
  it("an occupied chair says so and offers only the walk", () => {
    const sel = objectSelectionFor(seatEntity(true), { occupied: true })!;
    expect(sel.title).toBe("Desk");
    expect(sel.subtitle).toBe("Occupied");
    expect(sel.actions.map((a) => a.key)).toEqual(["walk"]);
  });
  it("the lift's call plate is the Elevator, and its verb is the authored one", () => {
    const e = { id: "elevator-1/call", kind: "solid", roomId: "elevator-1", transform: { pos: { x: 0, z: 0 }, yaw: 0 },
      capabilities: { approach: { point: { x: 18, z: 0 }, yaw: 0, label: "Call the elevator", action: "call-elevator" } }, props: {}, source: { baked: true } } as unknown as Entity;
    const sel = objectSelectionFor(e, { elevatorCall: true })!;
    expect(sel.title).toBe("Elevator");
    expect(sel.actions[0].label).toBe("Call the elevator");
  });
});

describe("Office View fast-forward walk", () => {
  it("is the ordinary gait rate at walking pace and a capped fast cadence above it", () => {
    expect(walkRate("humanbase", 54.6)).toBeCloseTo(gaitRate("humanbase", "walking", 54.6), 6);
    expect(walkRate("humanbase", 150)).toBe(FAST_FORWARD_MAX_RATE);
    expect(walkRate("legacy-glb", 150)).toBe(gaitRate("legacy-glb", "walking", 150));
  });
});
