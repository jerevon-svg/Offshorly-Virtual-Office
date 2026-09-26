// vo3d app — GO TOGETHER V1: a temporary travel party, walked, not teleported.
//
// WHAT THIS IS. The client half of a party the server keeps (backend services/travel_party.py): given the
// party as the server says it is, decide what THIS body does next — and nothing else. It owns no movement
// and no ride of its own:
//
//   • EVERY STEP IS AN ORDINARY WALK. A follower walks, through the world's own router, to a slot a little
//     behind the leader and re-targets at most every RETARGET_MS. Each of those is a normal published walk,
//     so everyone else — party or not — sees people walking, on the movement pipeline that already exists.
//     No coordinate is mirrored and no second movement protocol exists.
//   • EVERY RIDE IS THE RIDER'S OWN LIFT. The elevator is each browser's local scene (interact/
//     FloorTransition). The party is made to FEEL like it travels together by timing those local rides:
//       walk together → the leader holds at the doors (GATHER, bounded) → ONE `party_depart` → each ready
//       member starts their own normal ride at about the same moment → upstairs the leader holds briefly
//       (REGROUP, bounded) → the walk continues.
//     Nothing about a ride crosses the network; the one semantic event is the departure.
//   • NOBODY IS EVER WAITED ON FOR LONG. Both holds are bounded, only active followers who are actually
//     near count, and a member who misses the departure simply notices the leader's floor changed and
//     takes their own lift — catch-up, not failure.
//   • MANUAL CONTROL ALWAYS WINS. A click, a movement key or switching to PLAYER pauses following
//     (Resume / Leave); the leader taking control pauses the journey (Continue / End).
//
// A LEAF like app/floors.ts: it imports only V2's own coordinate type and the floor ids, so the world, the
// React host and a test can all read it without dragging either side's dependencies to the other.
import type { Vec2 } from "../core/coords";
import type { Vo3dFloorId } from "./floors";

// ---- the wire (backend travel_party.wire) -------------------------------------------------------------

/** WHERE A PARTY IS GOING — deliberately generic. A floor, optionally a room and/or a point, a label to
 *  show, and an opaque context (Scheduled Meetings puts {kind: "scheduled_meeting", id} there). The
 *  server checks its shape and never interprets it; the leader's world resolves it into a walk. */
export interface PartyDestination {
  floor: string;
  label: string;
  roomId?: string;
  point?: Vec2;
  context?: { kind: string; id: string };
}

export interface PartyMember {
  email: string;
  following: boolean;
  connected: boolean;
}

export interface PartyWire {
  partyId: string;
  leaderEmail: string;
  destination: PartyDestination;
  leaderFloor: string;
  phase: "travelling" | "gathering";
  gatherFloor: string | null;
  members: PartyMember[];
  pending: string[];
}

export interface PartyDeparture {
  partyId: string;
  departureId: string;
  fromFloor: string;
  toFloor: string;
  members: string[];
}

// ---- what the world offers (app/world.ts implements it) ----------------------------------------------

export type GoTogetherGoResult = "here" | "walking" | "elevator" | "busy" | "unreachable" | "unknown";

/** THE WORLD'S PRIMITIVES, and only primitives: every one is something the world already does for
 *  somebody else (click-to-walk, the lift, Walk There). */
export interface Vo3dGoTogetherPort {
  self(): { floor: Vo3dFloorId; pos: Vec2; riding: boolean; holding: boolean; moving: boolean; player: boolean };
  /** where this person's body is drawn ON THE VIEWER'S FLOOR, or null (other floor, not loaded) */
  peer(email: string): Vec2 | null;
  /** walk to a standable point near `p` through the ordinary router (hands PLAYER back to OFFICE first,
   *  exactly as Walk There does — PLAYER has no automated walking) */
  walkNear(p: Vec2): boolean;
  /** the existing lift journey to `to`: walk to the doors if needed, then the ordinary local ride */
  ride(to: Vo3dFloorId): boolean;
  /** set out for the destination with the movement that already exists (Walk There for a room) */
  goTo(dest: PartyDestination): GoTogetherGoResult;
  atDestination(dest: PartyDestination): boolean;
  /** Installs the party's two holds on the lift, plus the "the user took control" signal. Passing null
   *  removes them; a ride that was being held is released rather than dropped, so nobody is stranded. */
  setHooks(hooks: Vo3dGoTogetherHooks | null): void;
  /** start the ride that holdDeparture held; false when it was cancelled meanwhile */
  releaseLift(): boolean;
  /** THE RIDE MANIFEST: the other party members departing with this body on its NEXT lift ride. The world
   *  stands them, in their own characters, in its local car (app/liftRiders.ts). Null clears a manifest
   *  that has not been used yet; a ride already under way keeps its riders to the end. */
  setRideRiders(emails: readonly string[] | null): void;
  /** who is standing in this browser's car right now (the console / tests) */
  riders(): string[];
}

export interface Vo3dGoTogetherHooks {
  /** Asked right before THIS body's lift ride would start. Return true to hold it (the leader gathering);
   *  the ride then starts on releaseLift(). A click or a movement key cancels a held ride. */
  holdDeparture(from: Vo3dFloorId, to: Vo3dFloorId): boolean;
  /** Asked when a ride ends with a Walk There continuation. Return true to hold the continuation and call
   *  `resume` when ready (the leader regrouping). */
  holdArrival(on: Vo3dFloorId, resume: () => void): boolean;
  /** The person clicked somewhere, used a movement key over an automated walk, or walked up to someone. */
  onUserMove(): void;
}

/** What the controller says to the server. One method per semantic event. */
export interface PartyNet {
  gather(floor: string | null): void;
  depart(fromFloor: string, toFloor: string, members: string[]): void;
  arrived(): void;
  followState(following: boolean): void;
}

// ---- tuning (world units / ms) --------------------------------------------------------------------------

/** The first follower's distance behind the leader, then each next one a step further back. */
export const FOLLOW_BACK = 26;
export const FOLLOW_STEP = 14;
/** Every follower after the first stands this far to one side, alternating, so nobody queues in line. */
export const FOLLOW_SIDE = 16;
/** Close enough to the slot that walking there would be a twitch. */
export const SLOT_EPSILON = 14;
/** A new walk at most this often, and only when the slot moved at least RETARGET_UNITS (or the body
 *  stopped short of it) — the movement feed's load stays a walk a second per follower at most. */
export const RETARGET_MS = 600;
export const RETARGET_UNITS = 18;
/** WHILE THE LEADER WALKS the slot is pulled this much closer (never nearer than SLOT_EPSILON), because a
 *  follower only reaches a slot one re-target after it was set: aiming a little closer is what keeps the
 *  trailing gap near FOLLOW_BACK instead of growing by a re-target's worth of walking. It can never put a
 *  target past the leader, so a leader who stops is never walked into. */
export const LEAD_UNITS = 20;
/** GATHER: members within this of the leader are "ready"; members within NEARBY are worth waiting for. */
export const GATHER_RADIUS = 60;
export const NEARBY_RADIUS = 360;
export const GATHER_MIN_MS = 1200;
export const GATHER_TIMEOUT_MS = 4000;
/** REGROUP upstairs: the same idea, bounded again. */
export const REGROUP_RADIUS = 120;
export const REGROUP_MIN_MS = 600;
export const REGROUP_TIMEOUT_MS = 5000;
/** A member counts as regrouped only once they have been on this floor this long: their arrival is
 *  published while they are still standing in their own lift bay, before its doors have opened. */
export const REGROUP_SETTLE_MS = 1500;
/** After the party arrives, how long a follower waits for the leader's last walk to finish replaying before
 *  taking its final step to its slot beside them. */
export const FINISH_DELAY_MS = 1200;
/** A missed departure: how long between catch-up ride attempts. */
export const CATCH_UP_RETRY_MS = 5000;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

function unit(v: Vec2): Vec2 | null {
  const len = Math.hypot(v.x, v.z);
  return len > 1e-6 ? { x: v.x / len, z: v.z / len } : null;
}

/** THE FORMATION. Slot `index` (0 = first to join) behind a leader travelling along `heading`: straight
 *  behind for the first, then a staggered pair further back each side. Snapped to standable ground by the
 *  world (walkNear), so a slot that lands in a wall still yields a sensible spot. */
export function followSlot(leader: Vec2, heading: Vec2, index: number, leaderMoving = false): Vec2 {
  const h = unit(heading) ?? { x: 0, z: 1 };
  const full = FOLLOW_BACK + FOLLOW_STEP * index;
  const back = leaderMoving ? Math.max(SLOT_EPSILON, full - LEAD_UNITS) : full;
  const side = index === 0 ? 0 : (index % 2 === 1 ? 1 : -1) * FOLLOW_SIDE;
  return { x: leader.x - h.x * back - h.z * side, z: leader.z - h.z * back + h.x * side };
}

export type GoTogetherStatus =
  | { kind: "none" }
  /** another of this person's tabs is driving their body; this one only shows the state */
  | { kind: "observer"; leader: boolean }
  | { kind: "leader-waiting"; joined: number; pending: number }
  | { kind: "leader-travelling"; joined: number }
  | { kind: "leader-paused"; joined: number }
  | { kind: "gathering"; ready: number; total: number }
  | { kind: "regrouping"; ready: number; total: number }
  | { kind: "following"; leader: string }
  | { kind: "catching-up"; leader: string }
  | { kind: "riding"; leader: string | null }
  | { kind: "paused"; leader: string };

export interface GoTogetherInput {
  party: PartyWire | null;
  selfEmail: string;
  /** does THIS tab drive this person's body (the server's controllerSid is this tab's socket) */
  isController: boolean;
  /** why the last party ended (the server's reason), when it has just ended */
  endedReason?: string | null;
}

/** ONE PARTY, FROM ONE BODY'S POINT OF VIEW. Driven by tick() on a short interval by the host; every
 *  decision reads the port's live answers, so it holds no copy of the world that could go stale. */
export class GoTogetherController implements Vo3dGoTogetherHooks {
  private input: GoTogetherInput = { party: null, selfEmail: "", isController: false };
  private hooked = false;
  // leader
  private started = false;
  private leaderPaused = false;
  private seenAway = false;
  private arrivedSent = false;
  private gathering: { from: Vo3dFloorId; to: Vo3dFloorId; since: number } | null = null;
  private regroup: { since: number; members: string[]; resume: () => void; seen: Map<string, number> } | null = null;
  private lastDeparted: string[] = [];
  // follower
  private following = true;
  private prevPlayer = false;
  private lastWalkAt = -Infinity;
  private lastTarget: Vec2 | null = null;
  private lastRideAt = -Infinity;
  private lastRideEnd = -Infinity;
  private wasRiding = false;
  private heading: Vec2 | null = null;
  private lastLeaderPos: Vec2 | null = null;
  private leaderMovedAt = -Infinity;
  private finish: { leader: string; index: number; heading: Vec2; dest: PartyDestination; due: number } | null = null;
  private status: GoTogetherStatus = { kind: "none" };
  private readonly listeners = new Set<(s: GoTogetherStatus) => void>();

  private readonly port: Vo3dGoTogetherPort;
  private readonly net: PartyNet;
  private readonly now: () => number;

  constructor(port: Vo3dGoTogetherPort, net: PartyNet, now: () => number = () => performance.now()) {
    this.port = port;
    this.net = net;
    this.now = now;
  }

  // ---- inputs -------------------------------------------------------------------------------------------

  update(input: GoTogetherInput): void {
    const prev = this.input.party;
    const prevController = this.input.isController;
    const prevSelf = this.input.selfEmail;
    this.input = input;
    const party = input.party;
    // ARRIVED TOGETHER: the party dissolves the moment the LEADER reaches the room, which is usually a
    // moment before the followers do. A following body finishes its walk — one last step to its slot
    // beside where the leader stopped — instead of freezing wherever the dissolve found it.
    // Taken a beat later (FINISH_DELAY_MS), once the leader's last walk has finished replaying here.
    if (prev && !party && input.endedReason === "arrived" && prevController && prev.leaderEmail !== prevSelf && this.following) {
      const index = Math.max(0, prev.members.findIndex((m) => m.email === prevSelf));
      this.finish = { leader: prev.leaderEmail, index, heading: this.heading ?? { x: 0, z: 1 }, dest: prev.destination, due: this.now() + FINISH_DELAY_MS };
    }
    if (!party || (prev && prev.partyId !== party.partyId)) {
      // A manifest nobody rode with yet is dropped with its party (a ride under way keeps its riders).
      if (prev) this.port.setRideRiders(null);
      this.resetJourney();
    }
    const drive = party !== null && input.isController;
    if (drive !== this.hooked) {
      this.port.setHooks(drive ? this : null);
      this.hooked = drive;
    }
    // THE DESTINATION MOVED UNDER A TRAVELLING LEADER (e.g. the meeting changed rooms): re-route to it.
    if (party && prev && prev.partyId === party.partyId && this.isLeader() && this.started && !this.leaderPaused
      && JSON.stringify(prev.destination) !== JSON.stringify(party.destination) && input.isController) {
      this.port.goTo(party.destination);
    }
    if (party && this.isFollower()) {
      // the server's view of our pause is authoritative across a reload
      const me = party.members.find((m) => m.email === input.selfEmail);
      if (me) this.following = me.following;
    }
    this.publish();
  }

  onDeparting(dep: PartyDeparture): void {
    const party = this.input.party;
    if (!party || dep.partyId !== party.partyId || !this.input.isController || !this.isFollower()) return;
    if (!this.following || !dep.members.includes(this.input.selfEmail)) return;
    const self = this.port.self();
    if (self.riding || self.floor !== dep.fromFloor || dep.toFloor === self.floor) return;
    this.lastRideAt = this.now();
    // THE RIDE MANIFEST: everyone who departed together except this body — the leader and the other ready
    // members — stands in this browser's car for this ride (app/liftRiders.ts).
    this.port.setRideRiders([party.leaderEmail, ...dep.members].filter((e) => e !== this.input.selfEmail));
    if (!this.port.ride(dep.toFloor as Vo3dFloorId)) this.port.setRideRiders(null);
  }

  // ---- UI verbs -----------------------------------------------------------------------------------------

  /** Leader: set out now (without waiting for everyone to answer), or carry on after taking control. */
  go(): void {
    const party = this.input.party;
    if (!party || !this.isLeader() || !this.input.isController) return;
    this.started = true;
    this.leaderPaused = false;
    if (this.port.goTo(party.destination) === "here" && this.seenAway) this.arrive();
    this.publish();
  }

  resume(): void {
    if (!this.isFollower() || this.following) return;
    this.following = true;
    this.prevPlayer = false;
    this.lastTarget = null;
    this.lastWalkAt = -Infinity;
    this.net.followState(true);
    this.publish();
  }

  pause(): void {
    if (!this.isFollower() || !this.following) return;
    this.following = false;
    this.net.followState(false);
    this.publish();
  }

  getStatus(): GoTogetherStatus {
    return this.status;
  }

  subscribe(cb: (s: GoTogetherStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => {
      this.listeners.delete(cb);
    };
  }

  dispose(): void {
    if (this.hooked) this.port.setHooks(null);
    this.hooked = false;
    this.listeners.clear();
  }

  // ---- hooks (the world calls these) --------------------------------------------------------------------

  holdDeparture(from: Vo3dFloorId, to: Vo3dFloorId): boolean {
    const party = this.input.party;
    if (!party || !this.isLeader()) return false;
    if (this.activeMembers().length === 0) {
      // Nobody to gather — ride at once, but still say so: the leader's floor moving is what lets every
      // member (paused, far away, reconnecting) catch up on their own lift.
      this.net.depart(from, to, []);
      this.lastDeparted = [];
      return false;
    }
    this.gathering = { from, to, since: this.now() };
    this.net.gather(from);
    this.publish();
    return true;
  }

  holdArrival(_on: Vo3dFloorId, resume: () => void): boolean {
    if (!this.input.party || !this.isLeader() || this.lastDeparted.length === 0) return false;
    this.regroup = { since: this.now(), members: [...this.lastDeparted], resume, seen: new Map() };
    this.publish();
    return true;
  }

  onUserMove(): void {
    if (!this.input.party) return;
    if (this.isLeader()) {
      // The world has already dropped any held ride and the Walk There behind it.
      if (this.gathering) this.net.gather(null);
      this.gathering = null;
      this.regroup = null;
      if (this.started) this.leaderPaused = true;
      this.publish();
      return;
    }
    this.pause();
  }

  // ---- the loop -----------------------------------------------------------------------------------------

  tick(): void {
    // A follower still on its way when the party arrived: beside the leader if they are in sight, else
    // the rest of the way to the destination on Walk There (a lift ride in progress is waited out first).
    if (this.finish && this.now() >= this.finish.due && !this.port.self().riding) {
      const { leader, index, heading, dest, due } = this.finish;
      const leaderAt = this.port.peer(leader);
      // Just off the lift, the leader's body may not be drawn yet on this floor: give it a moment
      // (bounded) so the last step lands BESIDE them rather than on the same approach point.
      if (!leaderAt && this.port.self().floor === dest.floor && this.now() - due < FINISH_DELAY_MS * 2) return;
      this.finish = null;
      if (leaderAt) this.port.walkNear(followSlot(leaderAt, heading, index));
      else this.port.goTo(dest);
      return;
    }
    const party = this.input.party;
    if (!party || !this.input.isController) return;
    if (this.isLeader()) this.tickLeader(party);
    else this.tickFollower(party);
    this.publish();
  }

  private tickLeader(party: PartyWire): void {
    const now = this.now();
    const self = this.port.self();
    // Everyone has answered and at least one is coming: set out, as if the leader pressed Go.
    if (!this.started && party.pending.length === 0 && party.members.length > 0) this.go();

    if (this.gathering) {
      const { from, to, since } = this.gathering;
      const active = this.activeMembers();
      let ready = 0;
      let coming = 0;
      const readyEmails: string[] = [];
      for (const m of active) {
        const at = this.port.peer(m.email);
        if (!at || self.floor !== from) continue;
        const d = dist(at, self.pos);
        if (d <= NEARBY_RADIUS) coming++;
        if (d <= GATHER_RADIUS) {
          ready++;
          readyEmails.push(m.email);
        }
      }
      const elapsed = now - since;
      if ((elapsed >= GATHER_MIN_MS && ready >= coming) || elapsed >= GATHER_TIMEOUT_MS) {
        this.gathering = null;
        this.lastDeparted = readyEmails;
        this.net.depart(from, to, readyEmails);
        // The leader's own car carries the members who were ready with them.
        this.port.setRideRiders(readyEmails);
        if (!this.port.releaseLift()) this.port.setRideRiders(null);
      }
      return;
    }

    if (this.regroup) {
      const { since, members, resume, seen } = this.regroup;
      const ready = members.filter((e) => {
        const at = this.port.peer(e);
        if (at === null) return false;
        if (!seen.has(e)) seen.set(e, now);
        return now - (seen.get(e) ?? now) >= REGROUP_SETTLE_MS && dist(at, self.pos) <= REGROUP_RADIUS;
      }).length;
      const elapsed = now - since;
      if ((elapsed >= REGROUP_MIN_MS && ready >= members.length) || elapsed >= REGROUP_TIMEOUT_MS) {
        this.regroup = null;
        resume();
      }
      return;
    }

    // ARRIVAL: the actual destination, reached by any means — but only after having been somewhere else
    // during this party, so creating a party while standing at the door cannot dissolve it on the spot.
    if (self.riding) return;
    const here = self.floor === party.destination.floor && this.port.atDestination(party.destination);
    if (!here) this.seenAway = true;
    else if (this.seenAway) this.arrive();
  }

  private tickFollower(party: PartyWire): void {
    const now = this.now();
    const self = this.port.self();
    if (self.riding) {
      this.wasRiding = true;
      this.prevPlayer = self.player;
      return;
    }
    if (this.wasRiding) {
      this.wasRiding = false;
      this.lastRideEnd = now;
      this.lastLeaderPos = null;
      this.lastTarget = null;
    }
    // PLAYER IS MANUAL CONTROL. Following needs OFFICE (walkNear hands PLAYER back, like Walk There), so a
    // switch INTO PLAYER while following is the person taking the body — except the ride's own cinematic,
    // which plays in PLAYER framing and hands the view back itself.
    if (this.following && self.player && !this.prevPlayer && now - this.lastRideEnd > 1500) this.pause();
    this.prevPlayer = self.player;
    if (!this.following) return;
    // A LIFT TRIP IS UNDER WAY (walking to the doors for the departure or a catch-up): a follow step now
    // would be a new walk, and a new walk cancels the trip. The leader's floor moving is what comes next.
    if (self.holding) return;

    // CATCH-UP: the leader is on another floor (a missed departure, a reload, a late accept). Take the
    // ordinary lift there — retried, never spammed.
    if (party.leaderFloor !== self.floor) {
      if (!self.holding && now - this.lastRideAt >= CATCH_UP_RETRY_MS) {
        this.lastRideAt = now;
        this.port.ride(party.leaderFloor as Vo3dFloorId);
      }
      return;
    }

    const leaderAt = this.port.peer(party.leaderEmail);
    if (!leaderAt) return; // not drawn yet (still loading, or still in their car)
    if (!this.lastLeaderPos) {
      this.lastLeaderPos = leaderAt;
      this.heading = unit({ x: leaderAt.x - self.pos.x, z: leaderAt.z - self.pos.z }) ?? this.heading;
    } else if (dist(leaderAt, this.lastLeaderPos) > 6) {
      this.heading = unit({ x: leaderAt.x - this.lastLeaderPos.x, z: leaderAt.z - this.lastLeaderPos.z }) ?? this.heading;
      this.lastLeaderPos = leaderAt;
      this.leaderMovedAt = now;
    }
    const index = Math.max(0, party.members.findIndex((m) => m.email === this.input.selfEmail));
    const target = followSlot(leaderAt, this.heading ?? { x: 0, z: 1 }, index, now - this.leaderMovedAt < 500);
    if (dist(self.pos, target) <= SLOT_EPSILON) return;
    if (now - this.lastWalkAt < RETARGET_MS) return;
    if (self.moving && this.lastTarget && dist(target, this.lastTarget) <= RETARGET_UNITS) return;
    this.lastWalkAt = now;
    this.lastTarget = target;
    this.port.walkNear(target);
  }

  // ---- internals ----------------------------------------------------------------------------------------

  private arrive(): void {
    if (this.arrivedSent) return;
    this.arrivedSent = true;
    this.net.arrived();
  }

  private isLeader(): boolean {
    return this.input.party?.leaderEmail === this.input.selfEmail;
  }

  private isFollower(): boolean {
    const party = this.input.party;
    return party !== null && party.leaderEmail !== this.input.selfEmail;
  }

  private activeMembers(): PartyMember[] {
    return (this.input.party?.members ?? []).filter((m) => m.following && m.connected);
  }

  private resetJourney(): void {
    if (this.input.party) this.finish = null;
    this.started = false;
    this.leaderPaused = false;
    this.seenAway = false;
    this.arrivedSent = false;
    this.gathering = null;
    this.regroup = null;
    this.lastDeparted = [];
    this.following = true;
    this.prevPlayer = false;
    this.lastWalkAt = -Infinity;
    this.lastTarget = null;
    this.lastRideAt = -Infinity;
    this.heading = null;
    this.lastLeaderPos = null;
    this.leaderMovedAt = -Infinity;
  }

  private computeStatus(): GoTogetherStatus {
    const party = this.input.party;
    if (!party) return { kind: "none" };
    if (!this.input.isController) return { kind: "observer", leader: this.isLeader() };
    const joined = party.members.length;
    const self = this.port.self();
    if (this.isLeader()) {
      if (this.gathering) {
        const total = this.activeMembers().length + 1;
        const ready = 1 + this.activeMembers().filter((m) => {
          const at = this.port.peer(m.email);
          return at !== null && dist(at, self.pos) <= GATHER_RADIUS;
        }).length;
        return { kind: "gathering", ready, total };
      }
      if (this.regroup) {
        const ready = 1 + this.regroup.members.filter((e) => {
          const at = this.port.peer(e);
          return at !== null && dist(at, self.pos) <= REGROUP_RADIUS;
        }).length;
        return { kind: "regrouping", ready, total: this.regroup.members.length + 1 };
      }
      if (self.riding) return { kind: "riding", leader: null };
      if (!this.started) return { kind: "leader-waiting", joined, pending: party.pending.length };
      return this.leaderPaused ? { kind: "leader-paused", joined } : { kind: "leader-travelling", joined };
    }
    const leader = party.leaderEmail;
    if (!this.following) return { kind: "paused", leader };
    if (self.riding) return { kind: "riding", leader };
    if (party.phase === "gathering" && party.gatherFloor === self.floor) {
      const total = this.activeMembers().length + 1;
      return { kind: "gathering", ready: 0, total };
    }
    if (party.leaderFloor !== self.floor) return { kind: "catching-up", leader };
    return { kind: "following", leader };
  }

  private publish(): void {
    const next = this.computeStatus();
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    for (const cb of this.listeners) cb(next);
  }
}
