import { describe, expect, it, vi } from "vitest";
import {
  CATCH_UP_RETRY_MS,
  FINISH_DELAY_MS,
  FOLLOW_BACK,
  GATHER_MIN_MS,
  GATHER_TIMEOUT_MS,
  GoTogetherController,
  REGROUP_SETTLE_MS,
  REGROUP_TIMEOUT_MS,
  RETARGET_MS,
  followSlot,
  type PartyNet,
  type PartyWire,
  type Vo3dGoTogetherHooks,
  type Vo3dGoTogetherPort,
} from "./goTogether";
import type { Vec2 } from "../core/coords";
import type { Vo3dFloorId } from "./floors";

// Go Together V1 — the controller against a fake world: formation, rate-limited following, the bounded
// gather + ONE departure, catch-up after a missed departure, regroup upstairs, manual control and arrival.

const LEAD = "lead@x.com";
const BOB = "bob@x.com";
const CAT = "cat@x.com";

function party(over: Partial<PartyWire> = {}): PartyWire {
  return {
    partyId: "p1",
    leaderEmail: LEAD,
    destination: { floor: "floor-2", roomId: "floor-2/alpha", label: "Alpha" },
    leaderFloor: "floor-1",
    phase: "travelling",
    gatherFloor: null,
    members: [{ email: BOB, following: true, connected: true }],
    pending: [],
    ...over,
  };
}

function rig() {
  let t = 0;
  const peers = new Map<string, Vec2>();
  const self = { floor: "floor-1" as Vo3dFloorId, pos: { x: 0, z: 0 }, riding: false, holding: false, moving: false, player: false };
  let hooks: Vo3dGoTogetherHooks | null = null;
  let atDest = false;
  const port: Vo3dGoTogetherPort = {
    self: () => ({ ...self, pos: { ...self.pos } }),
    peer: (e) => peers.get(e) ?? null,
    walkNear: vi.fn(() => true),
    ride: vi.fn(() => true),
    goTo: vi.fn(() => "walking" as const),
    atDestination: () => atDest,
    setHooks: (h) => { hooks = h; },
    releaseLift: vi.fn(() => true),
    setGuided: vi.fn(),
    setRideRiders: vi.fn(),
    riders: () => [],
  };
  const net: PartyNet = { gather: vi.fn(), depart: vi.fn(), arrived: vi.fn(), followState: vi.fn() };
  const ctl = new GoTogetherController(port, net, () => t);
  return {
    ctl, port, net, self, peers,
    hooks: () => hooks,
    advance: (ms: number) => { t += ms; },
    setAtDest: (v: boolean) => { atDest = v; },
  };
}

describe("followSlot — the formation", () => {
  it("puts the first follower straight behind and staggers the rest", () => {
    const heading = { x: 0, z: 1 };
    expect(followSlot({ x: 0, z: 100 }, heading, 0)).toEqual({ x: 0, z: 100 - FOLLOW_BACK });
    const a = followSlot({ x: 0, z: 100 }, heading, 1);
    const b = followSlot({ x: 0, z: 100 }, heading, 2);
    expect(a.z).toBeLessThan(100 - FOLLOW_BACK);
    expect(b.z).toBeLessThan(a.z);
    expect(Math.sign(a.x)).toBe(-Math.sign(b.x)); // opposite sides: nobody stacks
  });

  it("aims a little closer while the leader walks, but never past the leader", () => {
    const heading = { x: 0, z: 1 };
    for (let i = 0; i < 4; i++) {
      const moving = followSlot({ x: 0, z: 100 }, heading, i, true);
      const still = followSlot({ x: 0, z: 100 }, heading, i, false);
      expect(moving.z).toBeGreaterThanOrEqual(still.z);
      expect(moving.z).toBeLessThan(100);
    }
  });
});

describe("GoTogetherController — follower", () => {
  it("installs hooks only in the driving tab", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: BOB, isController: false });
    expect(r.hooks()).toBeNull();
    expect(r.ctl.getStatus()).toEqual({ kind: "observer", leader: false });
    r.ctl.update({ party: party(), selfEmail: BOB, isController: true });
    expect(r.hooks()).toBe(r.ctl);
  });

  it("walks toward its slot through ordinary walks, rate-limited, and rests once there", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: BOB, isController: true });
    r.peers.set(LEAD, { x: 0, z: 300 });
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenCalledTimes(1);
    r.self.moving = true;
    r.advance(100);
    r.peers.set(LEAD, { x: 0, z: 400 }); // leader moved far, but too soon to re-target
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenCalledTimes(1);
    r.advance(RETARGET_MS);
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenCalledTimes(2);
    // standing in the slot: no twitch walks
    r.self.moving = false;
    r.self.pos = { x: 0, z: 400 - FOLLOW_BACK };
    r.advance(RETARGET_MS * 3);
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenCalledTimes(2);
    expect(r.ctl.getStatus()).toEqual({ kind: "following", leader: LEAD });
  });

  it("rides its own lift on the party's departure — only when listed, following and on that floor", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: BOB, isController: true });
    r.ctl.onDeparting({ partyId: "p1", departureId: "p1:1", fromFloor: "floor-1", toFloor: "floor-2", members: [CAT] });
    expect(r.port.ride).not.toHaveBeenCalled();
    r.ctl.onDeparting({ partyId: "p1", departureId: "p1:1", fromFloor: "floor-1", toFloor: "floor-2", members: [BOB, CAT] });
    expect(r.port.ride).toHaveBeenCalledWith("floor-2");
    // this car carries everyone who departed together except this body
    expect(r.port.setRideRiders).toHaveBeenLastCalledWith([LEAD, CAT]);
  });

  it("never cancels its own pending lift trip with a follow step", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: BOB, isController: true });
    r.peers.set(LEAD, { x: 0, z: 300 });
    r.self.holding = true;
    r.ctl.tick();
    expect(r.port.walkNear).not.toHaveBeenCalled();
  });

  it("a paused follower is not taken on the departure", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: BOB, isController: true });
    r.ctl.onUserMove();
    expect(r.net.followState).toHaveBeenCalledWith(false);
    expect(r.ctl.getStatus()).toEqual({ kind: "paused", leader: LEAD });
    r.ctl.onDeparting({ partyId: "p1", departureId: "p1:1", fromFloor: "floor-1", toFloor: "floor-2", members: [BOB] });
    expect(r.port.ride).not.toHaveBeenCalled();
    r.ctl.resume();
    expect(r.net.followState).toHaveBeenLastCalledWith(true);
  });

  it("catches up on its own lift when the leader is on another floor, retrying without spamming", () => {
    const r = rig();
    r.ctl.update({ party: party({ leaderFloor: "floor-2" }), selfEmail: BOB, isController: true });
    r.ctl.tick();
    expect(r.port.ride).toHaveBeenCalledTimes(1);
    expect(r.port.setRideRiders).not.toHaveBeenCalled(); // a catch-up ride is a solo ride
    expect(r.ctl.getStatus()).toEqual({ kind: "catching-up", leader: LEAD });
    r.advance(1000);
    r.ctl.tick();
    expect(r.port.ride).toHaveBeenCalledTimes(1);
    r.advance(CATCH_UP_RETRY_MS);
    r.ctl.tick();
    expect(r.port.ride).toHaveBeenCalledTimes(2);
  });

  it("a follower already in PLAYER is guided, never paused (the live-test failure)", () => {
    const r = rig();
    r.self.player = true;
    r.ctl.update({ party: party(), selfEmail: BOB, isController: true });
    expect(r.port.setGuided).toHaveBeenLastCalledWith(true);
    r.peers.set(LEAD, { x: 0, z: 300 });
    for (let i = 0; i < 5; i++) {
      r.ctl.tick();
      r.advance(RETARGET_MS);
      r.peers.set(LEAD, { x: 0, z: 300 + 40 * (i + 1) });
    }
    expect(r.net.followState).not.toHaveBeenCalled();
    expect(r.ctl.getStatus()).toMatchObject({ kind: "following" });
    expect(r.port.walkNear).toHaveBeenCalled();
  });

  it("Esc (onUserMove) hands the body back; Resume guides it again; the party ending releases it", () => {
    const r = rig();
    r.self.player = true;
    r.ctl.update({ party: party(), selfEmail: BOB, isController: true });
    r.ctl.onUserMove();
    expect(r.net.followState).toHaveBeenCalledWith(false);
    expect(r.port.setGuided).toHaveBeenLastCalledWith(false);
    r.ctl.resume();
    expect(r.port.setGuided).toHaveBeenLastCalledWith(true);
    r.ctl.tick(); // still in PLAYER: the resume sticks
    expect(r.ctl.getStatus()).toMatchObject({ kind: "following" });
    r.ctl.update({ party: null, selfEmail: BOB, isController: true, endedReason: "left" });
    expect(r.port.setGuided).toHaveBeenLastCalledWith(false);
  });

  it("only the driving tab is ever guided", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: BOB, isController: false });
    r.ctl.tick();
    expect(r.port.setGuided).not.toHaveBeenCalled();
  });

  it("stays guided through its last step after the party arrives, then lets go", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: BOB, isController: true });
    r.ctl.update({ party: null, selfEmail: BOB, isController: true, endedReason: "arrived" });
    expect(r.port.setGuided).toHaveBeenLastCalledWith(true);
    r.peers.set(LEAD, { x: 0, z: 100 });
    r.advance(FINISH_DELAY_MS);
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenCalledTimes(1);
    expect(r.port.setGuided).toHaveBeenLastCalledWith(false);
  });
});

describe("GoTogetherController — leader", () => {
  it("sets out on its own once everyone has answered", () => {
    const r = rig();
    r.ctl.update({ party: party({ pending: [CAT] }), selfEmail: LEAD, isController: true });
    r.ctl.tick();
    expect(r.port.goTo).not.toHaveBeenCalled();
    expect(r.ctl.getStatus()).toMatchObject({ kind: "leader-waiting", joined: 1, pending: 1 });
    r.ctl.update({ party: party(), selfEmail: LEAD, isController: true });
    r.ctl.tick();
    expect(r.port.goTo).toHaveBeenCalledTimes(1);
  });

  it("is guided from the moment it sets out — before the first step — until it takes control", () => {
    const r = rig();
    const order: string[] = [];
    (r.port.setGuided as ReturnType<typeof vi.fn>).mockImplementation((on: boolean) => order.push(`guided:${on}`));
    (r.port.goTo as ReturnType<typeof vi.fn>).mockImplementation(() => { order.push("goTo"); return "walking"; });
    r.ctl.update({ party: party({ pending: [CAT] }), selfEmail: LEAD, isController: true });
    expect(order).toEqual([]); // waiting for answers: the leader's body is their own
    r.ctl.go();
    expect(order).toEqual(["guided:true", "goTo"]);
    r.ctl.onUserMove();
    expect(order.at(-1)).toBe("guided:false");
    r.ctl.go(); // Continue
    expect(order.slice(-2)).toEqual(["guided:true", "goTo"]);
  });

  it("with nobody following, rides at once but still announces the departure (for catch-up)", () => {
    const r = rig();
    r.ctl.update({ party: party({ members: [{ email: BOB, following: false, connected: true }] }), selfEmail: LEAD, isController: true });
    expect(r.ctl.holdDeparture("floor-1", "floor-2")).toBe(false);
    expect(r.net.depart).toHaveBeenCalledWith("floor-1", "floor-2", []);
  });

  it("gathers briefly and departs together once everyone nearby is ready", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: LEAD, isController: true });
    r.peers.set(BOB, { x: 200, z: 0 }); // nearby, not yet at the doors
    expect(r.ctl.holdDeparture("floor-1", "floor-2")).toBe(true);
    expect(r.net.gather).toHaveBeenCalledWith("floor-1");
    r.advance(GATHER_MIN_MS);
    r.ctl.tick();
    expect(r.net.depart).not.toHaveBeenCalled();
    expect(r.ctl.getStatus()).toEqual({ kind: "gathering", ready: 1, total: 2 });
    r.peers.set(BOB, { x: 30, z: 0 });
    r.ctl.tick();
    expect(r.net.depart).toHaveBeenCalledWith("floor-1", "floor-2", [BOB]);
    expect(r.port.setRideRiders).toHaveBeenLastCalledWith([BOB]);
    expect(r.port.releaseLift).toHaveBeenCalledTimes(1);
  });

  it("never waits past the timeout — far or missing members are left to catch up", () => {
    const r = rig();
    r.ctl.update({ party: party({ members: [
      { email: BOB, following: true, connected: true },
      { email: CAT, following: true, connected: true },
    ] }), selfEmail: LEAD, isController: true });
    r.peers.set(BOB, { x: 20, z: 0 });
    r.peers.set(CAT, { x: 250, z: 0 }); // coming, but slow
    r.ctl.holdDeparture("floor-1", "floor-2");
    r.advance(GATHER_TIMEOUT_MS - 1);
    r.ctl.tick();
    expect(r.net.depart).not.toHaveBeenCalled();
    r.advance(1);
    r.ctl.tick();
    expect(r.net.depart).toHaveBeenCalledWith("floor-1", "floor-2", [BOB]);
    // the slow member is not in this ride's car
    expect(r.port.setRideRiders).toHaveBeenLastCalledWith([BOB]);
  });

  it("taking control mid-gather cancels it and says so", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: LEAD, isController: true });
    r.ctl.go();
    r.peers.set(BOB, { x: 200, z: 0 });
    r.ctl.holdDeparture("floor-1", "floor-2");
    r.ctl.onUserMove();
    expect(r.net.gather).toHaveBeenLastCalledWith(null);
    r.advance(GATHER_TIMEOUT_MS);
    r.ctl.tick();
    expect(r.net.depart).not.toHaveBeenCalled();
    expect(r.ctl.getStatus()).toMatchObject({ kind: "leader-paused" });
  });

  it("regroups upstairs, bounded, then continues", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: LEAD, isController: true });
    r.peers.set(BOB, { x: 20, z: 0 });
    r.ctl.holdDeparture("floor-1", "floor-2");
    r.advance(GATHER_MIN_MS);
    r.ctl.tick(); // departs with BOB
    r.self.floor = "floor-2";
    r.peers.delete(BOB); // still in their own car
    const resume = vi.fn();
    expect(r.ctl.holdArrival("floor-2", resume)).toBe(true);
    r.advance(1000);
    r.ctl.tick();
    expect(resume).not.toHaveBeenCalled();
    r.advance(REGROUP_TIMEOUT_MS);
    r.ctl.tick();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("a member counts as regrouped only once settled on the floor, not the instant their car arrives", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: LEAD, isController: true });
    r.peers.set(BOB, { x: 20, z: 0 });
    r.ctl.holdDeparture("floor-1", "floor-2");
    r.advance(GATHER_MIN_MS);
    r.ctl.tick();
    r.self.floor = "floor-2";
    const resume = vi.fn();
    r.ctl.holdArrival("floor-2", resume);
    r.ctl.tick(); // BOB's arrival is already published, from inside their lift bay
    r.advance(1000);
    r.ctl.tick();
    expect(resume).not.toHaveBeenCalled();
    r.advance(REGROUP_SETTLE_MS);
    r.ctl.tick();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("dissolves only on reaching the actual destination, and only after having set out from elsewhere", () => {
    const r = rig();
    r.setAtDest(true);
    r.ctl.update({ party: party(), selfEmail: LEAD, isController: true });
    r.self.floor = "floor-2";
    r.ctl.tick();
    expect(r.net.arrived).not.toHaveBeenCalled(); // created at the door: nothing to arrive at
    r.setAtDest(false);
    r.ctl.tick();
    r.setAtDest(true);
    r.ctl.tick();
    r.ctl.tick();
    expect(r.net.arrived).toHaveBeenCalledTimes(1);
  });

  it("re-routes when the destination moves under a travelling leader", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: LEAD, isController: true });
    r.ctl.go();
    r.ctl.update({ party: party({ destination: { floor: "floor-2", roomId: "floor-2/bravo", label: "Bravo" } }), selfEmail: LEAD, isController: true });
    expect(r.port.goTo).toHaveBeenLastCalledWith({ floor: "floor-2", roomId: "floor-2/bravo", label: "Bravo" });
  });

  it("a follower finishes the walk to its slot when the party arrives, instead of freezing", () => {
    const r = rig();
    r.ctl.update({ party: party({ leaderFloor: "floor-2" }), selfEmail: BOB, isController: true });
    r.self.floor = "floor-2";
    r.peers.set(LEAD, { x: 0, z: 500 });
    r.ctl.update({ party: null, selfEmail: BOB, isController: false, endedReason: "arrived" });
    r.peers.set(LEAD, { x: 0, z: 540 }); // the leader's last walk still replaying here
    r.ctl.tick();
    expect(r.port.walkNear).not.toHaveBeenCalled();
    r.advance(FINISH_DELAY_MS);
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenLastCalledWith(followSlot({ x: 0, z: 540 }, { x: 0, z: 1 }, 0));
  });

  it("a follower still catching up when the party arrives carries on to the destination by Walk There", () => {
    const r = rig();
    r.ctl.update({ party: party({ leaderFloor: "floor-2" }), selfEmail: BOB, isController: true });
    r.self.riding = true; // mid catch-up ride
    r.ctl.update({ party: null, selfEmail: BOB, isController: false, endedReason: "arrived" });
    r.advance(FINISH_DELAY_MS);
    r.ctl.tick();
    expect(r.port.goTo).not.toHaveBeenCalled();
    r.self.riding = false;
    r.self.floor = "floor-2";
    r.ctl.tick();
    expect(r.port.goTo).not.toHaveBeenCalled(); // a moment for the leader's body to appear
    r.advance(FINISH_DELAY_MS * 2);
    r.ctl.tick();
    expect(r.port.goTo).toHaveBeenCalledWith(party().destination);
  });

  it("removes its hooks when the party ends", () => {
    const r = rig();
    r.ctl.update({ party: party(), selfEmail: LEAD, isController: true });
    r.ctl.update({ party: null, selfEmail: LEAD, isController: false });
    expect(r.hooks()).toBeNull();
    expect(r.port.setRideRiders).toHaveBeenLastCalledWith(null);
    expect(r.ctl.getStatus()).toEqual({ kind: "none" });
  });
});
