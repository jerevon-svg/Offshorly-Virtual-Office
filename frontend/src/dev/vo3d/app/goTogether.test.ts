import { describe, expect, it, vi } from "vitest";
import {
  CATCH_UP_RETRY_MS,
  GoTogetherController,
  RING_SPACING,
  RV_RETRY_MS,
  WHERE_MS,
  arrivalSlot,
  rendezvousSlot,
  type PartyLeg,
  type PartyNet,
  type PartyRendezvous,
  type PartyWire,
  type Vo3dGoTogetherHooks,
  type Vo3dGoTogetherPort,
} from "./goTogether";
import { partyLiftPlan } from "./liftRiders";
import type { Vec2 } from "../core/coords";
import type { Vo3dFloorId } from "./floors";

// Go Together — the controller against a fake world: forming moves nobody, the rendezvous, and the journey
// as server-announced stages every body plays itself (lift lobby → ride → room), with nobody chasing anybody.

const LEAD = "lead@x.com";
const BOB = "bob@x.com";
const CAT = "cat@x.com";
const HUB = { x: 700, z: 460 };
const APPROACH = { x: 500, z: 300 };
const INTO = { x: 0, z: -1 };
const lobby = (i: number): Vec2 => ({ x: 108, z: 937 + i * 26 });

const RV: PartyRendezvous = { stageId: "p1:rv", kind: "hub", participants: [LEAD, BOB, CAT], ready: [] };

function party(over: Partial<PartyWire> = {}): PartyWire {
  return {
    partyId: "p1",
    leaderEmail: LEAD,
    leaderFollowing: true,
    destination: { floor: "floor-2", roomId: "floor-2/foxtrot", label: "Product sync · Foxtrot" },
    members: [{ email: BOB, following: true, connected: true }, { email: CAT, following: true, connected: true }],
    pending: [],
    declined: [],
    stage: "gathering",
    rendezvous: RV,
    leg: null,
    ...over,
  };
}
const leg = (kind: PartyLeg["kind"], over: Partial<PartyLeg> = {}): Partial<PartyWire> => ({
  stage: kind,
  leg: {
    stageId: `p1:${kind}`, kind, floor: kind === "to_room" ? "floor-2" : "floor-1",
    ...(kind === "to_lift" || kind === "ride" ? { toFloor: "floor-2" } : {}),
    ...(kind === "ride" ? { riders: [LEAD, BOB, CAT] } : {}),
    expect: [LEAD, BOB, CAT], ready: [], ...over,
  },
});

function rig() {
  let t = 0;
  const self = { floor: "floor-1" as Vo3dFloorId, pos: { x: 0, z: 0 }, riding: false, holding: false, moving: false, player: true, room: null as string | null };
  let hooks: Vo3dGoTogetherHooks | null = null;
  const port: Vo3dGoTogetherPort = {
    self: () => ({ ...self, pos: { ...self.pos } }),
    hub: () => ({ floor: "floor-1", point: HUB }),
    liftLobby: (_f, i) => lobby(i),
    arrival: () => ({ floor: "floor-2", point: APPROACH, into: INTO }),
    walkNear: vi.fn(() => true),
    ride: vi.fn(() => true),
    setHooks: (h) => { hooks = h; },
    setGuided: vi.fn(),
    riders: () => [],
    peer: () => null,
  };
  const net: PartyNet = { where: vi.fn(), start: vi.fn(), ready: vi.fn(), followState: vi.fn() };
  const ctl = new GoTogetherController(port, net, () => t);
  return { ctl, port, net, self, hooks: () => hooks, advance: (ms: number) => { t += ms; } };
}
type Rig = ReturnType<typeof rig>;
const as = (r: Rig, email: string, p: PartyWire, isController = true) => r.ctl.update({ party: p, selfEmail: email, isController });

describe("the slots — nobody stacks", () => {
  it("the rendezvous ring keeps every slot at least a body apart", () => {
    for (let n = 2; n <= 9; n++) {
      const slots = Array.from({ length: n }, (_, i) => rendezvousSlot(HUB, i, n));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThanOrEqual(RING_SPACING - 1);
      }
    }
  });

  it("the arrival area is a loose group in FRONT of the room (never past its approach), a body apart", () => {
    const slots = Array.from({ length: 6 }, (_, i) => arrivalSlot(APPROACH, INTO, i));
    for (const s of slots) expect(s.z).toBeGreaterThan(APPROACH.z); // `into` is -z: in front is +z
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThanOrEqual(26);
    }
  });
});

describe("forming", () => {
  it("acceptance does NOT set out: nobody walks, nobody is guided, until Start Walking", () => {
    for (const who of [LEAD, BOB]) {
      const r = rig();
      as(r, who, party({ stage: "forming", rendezvous: null }));
      r.advance(5000);
      r.ctl.tick();
      expect(r.port.walkNear).not.toHaveBeenCalled();
      expect(r.port.setGuided).not.toHaveBeenCalled();
    }
  });

  it("the leader can Start Walking once somebody accepted — reporting its own place first", () => {
    const r = rig();
    as(r, LEAD, party({ stage: "forming", rendezvous: null, members: [{ email: BOB, following: true, connected: true }], pending: [CAT] }));
    expect(r.ctl.getStatus()).toMatchObject({ kind: "leader-forming", canStart: true });
    r.ctl.startWalking();
    expect(r.net.where).toHaveBeenCalledWith("floor-1", null, { x: 0, z: 0 });
    expect(r.net.start).toHaveBeenCalledTimes(1);
    const alone = rig();
    as(alone, LEAD, party({ stage: "forming", rendezvous: null, members: [], declined: [BOB] }));
    alone.ctl.startWalking();
    expect(alone.net.start).not.toHaveBeenCalled();
  });

  it("each driving tab reports its OWN place, throttled — an observer tab reports and walks nothing", () => {
    const r = rig();
    as(r, BOB, party({ stage: "forming", rendezvous: null }));
    r.self.room = "design-room";
    r.ctl.tick();
    expect(r.net.where).toHaveBeenLastCalledWith("floor-1", "design-room", { x: 0, z: 0 });
    r.self.pos = { x: 100, z: 0 };
    r.ctl.tick();
    expect(r.net.where).toHaveBeenCalledTimes(1);
    r.advance(WHERE_MS);
    r.ctl.tick();
    expect(r.net.where).toHaveBeenCalledTimes(2);
    const o = rig();
    for (const p of [party({ stage: "forming", rendezvous: null }), party(), party(leg("to_lift"))]) {
      as(o, BOB, p, false);
      o.ctl.tick();
    }
    expect(o.net.where).not.toHaveBeenCalled();
    expect(o.net.ready).not.toHaveBeenCalled();
    expect(o.port.walkNear).not.toHaveBeenCalled();
  });
});

describe("gathering", () => {
  it("walks, guided (PLAYER kept), to its own ring slot — and says ready only when ITS body is there", () => {
    const r = rig();
    const order: string[] = [];
    (r.port.setGuided as ReturnType<typeof vi.fn>).mockImplementation((on: boolean) => order.push(`guided:${on}`));
    (r.port.walkNear as ReturnType<typeof vi.fn>).mockImplementation(() => { order.push("walk"); return true; });
    as(r, BOB, party());
    r.ctl.tick();
    expect(order).toEqual(["guided:true", "walk"]);
    expect(r.port.walkNear).toHaveBeenCalledWith(rendezvousSlot(HUB, 1, 3));
    r.self.moving = true;
    r.advance(RV_RETRY_MS);
    r.ctl.tick();
    expect(r.net.ready).not.toHaveBeenCalled();
    r.self.moving = false;
    r.self.pos = rendezvousSlot(HUB, 1, 3);
    r.advance(400);
    r.ctl.tick();
    r.ctl.tick();
    expect(r.net.ready).toHaveBeenCalledTimes(1);
    expect(r.net.ready).toHaveBeenCalledWith("p1:rv", "floor-1");
  });

  it("already together: the ring is round the reported spot, not the hub", () => {
    const r = rig();
    as(r, CAT, party({ rendezvous: { ...RV, kind: "here", floor: "floor-1", point: { x: 10, z: 20 } } }));
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenCalledWith(rendezvousSlot({ x: 10, z: 20 }, 2, 3));
  });

  it("a stranded 'lift trip' state blocks nothing it should not: holding waits, the world clears it", () => {
    const r = rig();
    as(r, BOB, party());
    r.self.holding = true;
    r.ctl.tick();
    expect(r.port.walkNear).not.toHaveBeenCalled();
    r.self.holding = false;
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenCalledTimes(1);
  });

  it("a genuinely unreachable body never claims ready (the server's deadline moves the party on)", () => {
    const r = rig();
    as(r, BOB, party());
    (r.port.walkNear as ReturnType<typeof vi.fn>).mockReturnValue(false);
    r.self.pos = { x: -2000, z: -2000 };
    for (let i = 0; i < 10; i++) { r.advance(RV_RETRY_MS); r.ctl.tick(); }
    expect(r.net.ready).not.toHaveBeenCalled();
    expect(r.port.walkNear).toHaveBeenCalledTimes(10);
  });

  it("a member on another floor takes the lift to the rendezvous first", () => {
    const r = rig();
    r.self.floor = "floor-2";
    as(r, BOB, party());
    r.ctl.tick();
    expect(r.port.ride).toHaveBeenCalledWith("floor-1");
    expect(r.port.walkNear).not.toHaveBeenCalled();
  });
});

describe("the journey — one party, no chase", () => {
  it("READY moves nobody: no head start for the leader, the server opens the first leg for everyone", () => {
    const r = rig();
    as(r, LEAD, party({ stage: "ready" }));
    r.advance(10_000);
    r.ctl.tick();
    expect(r.port.walkNear).not.toHaveBeenCalled();
    expect(r.port.ride).not.toHaveBeenCalled();
    expect(r.ctl.getStatus()).toMatchObject({ kind: "party-ready", place: "hub" });
  });

  it("TO_LIFT: leader and members alike set out THE MOMENT the leg opens, each to their own lobby slot", () => {
    const rigs = [LEAD, BOB, CAT].map((who) => {
      const r = rig();
      as(r, who, party({ stage: "ready" }));
      r.advance(900); // mid retry interval of the gathering
      as(r, who, party(leg("to_lift")));
      r.ctl.tick();
      return r;
    });
    rigs.forEach((r, i) => {
      expect(r.port.walkNear).toHaveBeenCalledTimes(1);
      expect(r.port.walkNear).toHaveBeenCalledWith(lobby(i));
      expect(r.port.ride).not.toHaveBeenCalled(); // the lift is a barrier: nobody rides first
    });
  });

  it("TO_LIFT is ready from this body's own position only; a stale stage's report never repeats", () => {
    const r = rig();
    as(r, BOB, party(leg("to_lift")));
    r.ctl.tick();
    r.self.pos = lobby(1);
    r.advance(400);
    r.ctl.tick();
    expect(r.net.ready).toHaveBeenCalledWith("p1:to_lift", "floor-1");
    r.ctl.tick();
    expect(r.net.ready).toHaveBeenCalledTimes(1);
  });

  it("RIDE: every rider starts its own lift at once, in its own cabin slot, the others in theirs", () => {
    const plans = [LEAD, BOB, CAT].map((who, i) => {
      const r = rig();
      r.self.pos = lobby(i);
      as(r, who, party(leg("ride")));
      r.ctl.tick();
      expect(r.port.ride).toHaveBeenCalledTimes(1);
      const [to, plan] = (r.port.ride as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(to).toBe("floor-2");
      return { who, plan };
    });
    // every browser: the same three people, three distinct places, and each person in the SAME place
    for (const { who, plan } of plans) {
      expect(plan).toEqual(partyLiftPlan([LEAD, BOB, CAT], [LEAD, BOB, CAT], who));
      const all = [plan.self.rel, ...plan.riders.map((x: { slot: { rel: Vec2 } }) => x.slot.rel)].map((p: Vec2) => `${p.x},${p.z}`);
      expect(new Set(all).size).toBe(3);
    }
    expect(plans[0].plan.self).toBe(plans[1].plan.riders.find((x: { email: string }) => x.email === LEAD).slot);
  });

  it("RIDE: not while riding; ready once off the lift upstairs; never a second ride", () => {
    const r = rig();
    as(r, BOB, party(leg("ride")));
    r.ctl.tick();
    r.self.riding = true;
    r.advance(CATCH_UP_RETRY_MS * 3);
    r.ctl.tick();
    expect(r.net.ready).not.toHaveBeenCalled();
    r.self.riding = false;
    r.self.floor = "floor-2";
    r.ctl.tick();
    expect(r.net.ready).toHaveBeenCalledWith("p1:ride", "floor-2");
    expect(r.port.ride).toHaveBeenCalledTimes(1);
  });

  it("RIDE: somebody not on this ride's manifest (resumed after it was drawn up) catches up on a solo lift", () => {
    const r = rig();
    as(r, CAT, party(leg("ride", { riders: [LEAD, BOB], expect: [LEAD, BOB] })));
    r.ctl.tick();
    expect(r.port.ride).toHaveBeenCalledWith("floor-2", null);
  });

  it("TO_ROOM: on the Meeting Floor each walks to its own arrival slot and says ready there", () => {
    const r = rig();
    r.self.floor = "floor-2";
    as(r, CAT, party(leg("to_room")));
    r.ctl.tick();
    expect(r.port.walkNear).toHaveBeenCalledWith(arrivalSlot(APPROACH, INTO, 2));
    r.self.pos = arrivalSlot(APPROACH, INTO, 2);
    r.advance(400);
    r.ctl.tick();
    expect(r.net.ready).toHaveBeenCalledWith("p1:to_room", "floor-2");
  });

  it("stays guided across every stage, and lets go exactly when the party ends (arrived)", () => {
    const r = rig();
    for (const p of [party(), party({ stage: "ready" }), party(leg("to_lift")), party(leg("ride")), party(leg("to_room"))]) {
      as(r, BOB, p);
      r.ctl.tick();
    }
    expect((r.port.setGuided as ReturnType<typeof vi.fn>).mock.calls).toEqual([[true]]);
    r.ctl.update({ party: null, selfEmail: BOB, isController: true });
    expect((r.port.setGuided as ReturnType<typeof vi.fn>).mock.calls).toEqual([[true], [false]]);
    expect(r.hooks()).toBeNull();
    expect(r.ctl.getStatus()).toEqual({ kind: "none" });
  });

  it("the card shows the stage and who is at its checkpoint", () => {
    const r = rig();
    as(r, BOB, party({ ...leg("to_lift", { ready: [LEAD] }), members: [
      { email: BOB, following: true, connected: true }, { email: CAT, following: false, connected: true },
    ] }));
    expect(r.ctl.getStatus()).toEqual({ kind: "journey", leg: "to_lift", riding: false, people: [
      { email: LEAD, state: "ready", leader: true }, { email: BOB, state: "on-the-way", leader: false }, { email: CAT, state: "paused", leader: false },
    ] });
  });
});

describe("Esc / leaving", () => {
  it("Esc pauses THIS person (leader or member): told to the server, guided released, nothing walked", () => {
    for (const who of [LEAD, BOB]) {
      const r = rig();
      as(r, who, party(leg("to_lift")));
      r.ctl.tick();
      r.hooks()!.onUserMove();
      expect(r.net.followState).toHaveBeenCalledWith(false);
      expect(r.port.setGuided).toHaveBeenLastCalledWith(false);
      expect(r.ctl.getStatus()).toEqual({ kind: "paused", leader: who === LEAD });
      r.advance(RV_RETRY_MS * 4);
      r.ctl.tick();
      expect(r.port.walkNear).toHaveBeenCalledTimes(1);
    }
  });

  it("Resume rejoins the stage the party is on NOW, at once", () => {
    const r = rig();
    as(r, BOB, party(leg("to_lift")));
    r.hooks()!.onUserMove();
    as(r, BOB, party({ ...leg("to_room"), members: [{ email: BOB, following: false, connected: true }] }));
    r.ctl.resume();
    expect(r.net.followState).toHaveBeenLastCalledWith(true);
    r.ctl.tick();
    // still on the ground floor: the lift up first, then the room
    expect(r.port.ride).toHaveBeenCalledWith("floor-2");
    expect(r.port.setGuided).toHaveBeenLastCalledWith(true);
  });

  it("an update already in flight does not undo the Esc just pressed", () => {
    const r = rig();
    as(r, BOB, party(leg("to_lift")));
    r.hooks()!.onUserMove();
    as(r, BOB, party(leg("to_lift", { ready: [LEAD] }))); // still says following: sent before the pause
    expect(r.ctl.getStatus()).toMatchObject({ kind: "paused" });
    as(r, BOB, party({ ...leg("to_lift"), members: [{ email: BOB, following: false, connected: true }] }));
    as(r, BOB, party({ ...leg("to_lift"), members: [{ email: BOB, following: false, connected: true }] }));
    expect(r.ctl.getStatus()).toMatchObject({ kind: "paused" });
  });

  it("a click while forming takes nothing from anybody (no pause)", () => {
    const r = rig();
    as(r, BOB, party({ stage: "forming", rendezvous: null }));
    r.hooks()!.onUserMove();
    expect(r.net.followState).not.toHaveBeenCalled();
  });
});
