// vo3d app — GO TOGETHER: a temporary travel party, walked, not teleported — as ONE party, not a chase.
//
// WHAT THIS IS. The client half of a party the server keeps (backend services/travel_party.py): given the
// party as the server says it is, decide what THIS body does next — and nothing else. It owns no movement
// and no ride of its own.
//
// THE JOURNEY IS A SEQUENCE OF STAGES THE SERVER ANNOUNCES, and every body plays each one itself:
//
//   forming    accepting moves nobody; each driving tab reports its own place (party_where)
//   gathering  everyone walks to their own ring slot at the rendezvous (the Central Hub, or where they stand)
//   ready      "Everyone's here" — a beat, then the server opens the first leg for everybody at once
//   to_lift    everyone walks to their own lobby slot in front of the lift        ← a barrier: nobody rides
//   ride       everyone rides their own local lift, the others standing in it       until all are there
//              as riders, each in their own cabin slot (app/liftRiders partyLiftPlan)
//   to_room    everyone walks to their own arrival slot at the booked room
//   → the server ends the party ("arrived"), exactly once, and hands the body back
//
// Each stage has a stageId; a body says party_ready for THAT stage once ITS OWN character is in its slot —
// never from how anybody looks on anybody else's screen. Nobody chases anybody's delayed rendered body: the
// party moves because every browser was told the same next stage at the same moment, and everybody sees
// everybody else walking on the ordinary movement feed. No coordinate is mirrored and no second movement
// protocol exists.
//
// MANUAL CONTROL ALWAYS WINS, deliberately: the journey GUIDES the body (the controller stack's Guided owner),
// so PLAYER stays on screen with its camera and the movement keys do not fight the route. Esc (after the
// pointer is free) pauses THIS person — they stop being waited for, and Resume catches them up on the stage
// the party is on now.
//
// A LEAF like app/floors.ts: it imports only V2's coordinate type, the floor ids and the pure lift slots.
import type { Vec2 } from "../core/coords";
import type { Vo3dFloorId } from "./floors";
import { partyLiftPlan, type PartyLiftPlan } from "./liftRiders";

// ---- the wire (backend travel_party.wire) -------------------------------------------------------------

/** WHERE A PARTY IS GOING — deliberately generic. A floor, optionally a room and/or a point, a label to
 *  show, and an opaque context (Scheduled Meetings puts {kind: "scheduled_meeting", id} there). */
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

export type PartyStage = "forming" | "gathering" | "ready" | "to_lift" | "ride" | "to_room";
export type PartyLegKind = "to_lift" | "ride" | "to_room";

/** WHERE THE PARTY MEETS before it sets out. "hub" is the Central Hub (the world resolves it: port.hub());
 *  "here" is where they already stood, anchored on the leader's own reported spot. */
export interface PartyRendezvous {
  stageId: string;
  kind: "hub" | "here";
  floor?: string;
  roomId?: string;
  point?: Vec2;
  /** everyone Start Walking took, in slot order (stable when someone leaves) — the order of every slot */
  participants: string[];
  /** who has said, about themselves, that their own body is in its slot */
  ready: string[];
}

/** ONE LEG OF THE JOURNEY, with its barrier. */
export interface PartyLeg {
  stageId: string;
  kind: PartyLegKind;
  /** the floor the leg happens on (a ride's: the floor it leaves) */
  floor: string;
  toFloor?: string;
  /** a ride's manifest: who rides together, in slot order */
  riders?: string[];
  /** who this leg waits for (the active party when it opened) */
  expect: string[];
  ready: string[];
}

export interface PartyWire {
  partyId: string;
  leaderEmail: string;
  leaderFollowing: boolean;
  destination: PartyDestination;
  members: PartyMember[];
  pending: string[];
  /** answered "I'll walk there": out of the party, still going to the meeting on their own */
  declined: string[];
  stage: PartyStage;
  rendezvous: PartyRendezvous | null;
  leg: PartyLeg | null;
  /** WHERE EACH PERSON ALREADY WAS on the way to the destination at Start Walking (the server decides it
   *  from their own reports): still to travel, already on the destination floor (meets the party at its lift),
   *  or already in the room. Absent before Start Walking — everybody travels. */
  roles?: Record<string, PartyRole>;
}

export type PartyRole = "travel" | "wait" | "arrived";

// ---- what the world offers (app/world.ts implements it) ----------------------------------------------

/** THE WORLD'S PRIMITIVES, and only primitives: every one is something the world already does for
 *  somebody else (click-to-walk, the lift, the meeting rooms). */
export interface Vo3dGoTogetherPort {
  self(): { floor: Vo3dFloorId; pos: Vec2; riding: boolean; holding: boolean; moving: boolean; player: boolean; room: string | null };
  /** THE CENTRAL HUB rendezvous: the open floor it gathers on */
  hub(): { floor: Vo3dFloorId; point: Vec2 };
  /** the lobby spot in front of `floor`'s lift for party slot `slot` (app/liftRiders lobbyPoint) */
  liftLobby(floor: Vo3dFloorId, slot: number): Vec2 | null;
  /** where somebody already on `floor` waits for a party coming up in its lift: beside the arrival lane,
   *  facing the doors, one spot per waiting person (app/liftRiders liftWaitPoint) */
  liftWait(floor: Vo3dFloorId, slot: number): Vec2 | null;
  /** the destination's ARRIVAL AREA: the point in front of it and the direction that leads in */
  arrival(dest: PartyDestination): { floor: Vo3dFloorId; point: Vec2; into: Vec2 } | null;
  /** walk to a standable point near `p` through the ordinary router (guided: PLAYER stays on screen) */
  walkNear(p: Vec2): boolean;
  /** the ordinary lift journey to `to` (walk to the doors if needed, then the local ride). With a plan this
   *  body boards its own slot and the other riders stand in theirs; without one it is a solo ride. */
  ride(to: Vo3dFloorId, plan?: PartyLiftPlan | null): boolean;
  /** installs "the user took control" signal; null removes it */
  setHooks(hooks: Vo3dGoTogetherHooks | null): void;
  /** GUIDED TRAVEL: true while this body's journey is under way — the world then drives it under the
   *  controller stack's Guided owner (PLAYER keeps its view and camera, the keys do not move it, Esc hands
   *  it back through onUserMove) and frames the shot a little wider. False hands it back. */
  setGuided(on: boolean): void;
  /** who is standing in this browser's car right now (the console / tests) */
  riders(): string[];
  /** where `email` is drawn on this browser (their rider copy while one stands in the car) — read-only, for
   *  the console and verification; the journey itself never steers by anybody else's drawn body */
  peer(email: string): Vec2 | null;
}

export interface Vo3dGoTogetherHooks {
  /** The person clicked somewhere, used a movement key over an automated walk, walked up to someone, or
   *  pressed Esc during a guided journey. */
  onUserMove(): void;
}

/** What the controller says to the server. One method per semantic event. */
export interface PartyNet {
  /** FORMING: this body's own place */
  where(floor: string, roomId: string | null, position: Vec2): void;
  /** the leader's Start Walking */
  start(): void;
  /** this body is in its own slot for stage `stageId`, on `floor` */
  ready(stageId: string, floor: string): void;
  /** paused (took their body back) or resumed */
  followState(following: boolean): void;
}

// ---- tuning (world units / ms) --------------------------------------------------------------------------

/** FORMING: a place report when the body moved this far, changed room/floor — at most this often. */
export const WHERE_UNITS = 16;
export const WHERE_MS = 700;
/** THE RENDEZVOUS RING: people stand this far apart around it (a little less than arm's reach between
 *  36-unit avatars), never closer to the centre than RING_MIN — gathered, facing in, not stacked. */
export const RING_SPACING = 32;
export const RING_MIN = 30;
/** THE ARRIVAL AREA: a loose group in front of the room — rows of three, this far apart, the first row this
 *  far back from the room's own approach point. */
export const ARRIVAL_SPACING = 30;
export const ARRIVAL_BACK = 10;
export const ARRIVAL_ROW = 28;
/** In the slot: close enough to say ready. After RV_FALLBACK_WALKS walks that stopped short (the ground
 *  snapped the slot), within RV_FALLBACK_RADIUS is as close as that ground allows. */
export const READY_RADIUS = 24;
export const RV_RETRY_MS = 1500;
export const RV_FALLBACK_WALKS = 2;
export const RV_FALLBACK_RADIUS = 80;
/** A lift journey (a party ride, or a catch-up to another floor) is re-attempted at most this often. */
export const CATCH_UP_RETRY_MS = 5000;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

/** SLOT `index` of `count` on the rendezvous ring round `anchor`: evenly spaced, so N people stand in a
 *  circle that can see itself instead of on one point. The world snaps each to standable ground. */
export function rendezvousSlot(anchor: Vec2, index: number, count: number): Vec2 {
  const n = Math.max(1, count);
  // neighbours are a CHORD apart, not an arc: r = spacing / (2·sin(π/n))
  const r = n < 2 ? RING_MIN : Math.max(RING_MIN, RING_SPACING / (2 * Math.sin(Math.PI / n)));
  const a = (index / n) * Math.PI * 2;
  return { x: anchor.x + Math.sin(a) * r, z: anchor.z - Math.cos(a) * r };
}

/** SLOT `index` of the ARRIVAL AREA: a loose group standing in front of the room, facing in — the first
 *  three across the approach (centre, then either side), the next three a row further back. Not a queue on
 *  one point, and never inside the room before the meeting asks for them. */
export function arrivalSlot(approach: Vec2, into: Vec2, index: number): Vec2 {
  const len = Math.hypot(into.x, into.z) || 1;
  const f = { x: into.x / len, z: into.z / len };
  const side = { x: -f.z, z: f.x };
  const row = Math.floor(index / 3);
  const col = [0, 1, -1][index % 3] * ARRIVAL_SPACING;
  const back = ARRIVAL_BACK + row * ARRIVAL_ROW;
  return { x: approach.x - f.x * back + side.x * col, z: approach.z - f.z * back + side.z * col };
}

/** ONE FACE ON THE PARTY CARD. Forming: joined / waiting / declined. On the way: ready (in their slot for
 *  this stage) / on-the-way / paused. The leader is one of them (and counts as joined). */
export interface PartyPerson {
  email: string;
  state: "joined" | "waiting" | "declined" | "ready" | "on-the-way" | "paused";
  leader: boolean;
}

export type GoTogetherStatus =
  | { kind: "none" }
  /** another of this person's tabs is driving their body; this one only shows the state */
  | { kind: "observer"; leader: boolean }
  /** FORMING: who has accepted, and (leader) whether Start Walking is possible */
  | { kind: "leader-forming"; people: PartyPerson[]; canStart: boolean }
  | { kind: "forming"; leader: string; people: PartyPerson[] }
  /** already inside the destination room: nothing to do, nobody moves this body */
  | { kind: "already-here"; people: PartyPerson[] }
  /** already on the destination floor: waiting at its lift for the others to come up */
  | { kind: "meeting-upstairs"; people: PartyPerson[] }
  /** GATHERING at the rendezvous */
  | { kind: "rendezvous"; place: "hub" | "here"; people: PartyPerson[] }
  /** READY — "Everyone's here", the beat before the first leg */
  | { kind: "party-ready"; place: "hub" | "here"; people: PartyPerson[] }
  /** ON THE WAY, one leg at a time — `riding` while this body is in the lift */
  | { kind: "journey"; leg: PartyLegKind; riding: boolean; people: PartyPerson[] }
  /** this person took their body back (Esc): the party goes on without waiting for them */
  | { kind: "paused"; leader: boolean };

export interface GoTogetherInput {
  party: PartyWire | null;
  selfEmail: string;
  /** does THIS tab drive this person's body (the server's controllerSid is this tab's socket) */
  isController: boolean;
}

/** ONE PARTY, FROM ONE BODY'S POINT OF VIEW. Driven by tick() on a short interval by the host; every
 *  decision reads the port's live answers, so it holds no copy of the world that could go stale. */
export class GoTogetherController implements Vo3dGoTogetherHooks {
  private input: GoTogetherInput = { party: null, selfEmail: "", isController: false };
  private hooked = false;
  /** what the port was last told (setGuided) */
  private guided = false;
  private following = true;
  /** a pause / resume this tab has said and the server has not echoed yet — an update already in flight
   *  must not undo the Esc the person just pressed */
  private intent: boolean | null = null;
  // the stage under way, and this body's progress through it
  private stageId: string | null = null;
  private readySent: string | null = null;
  private walkAt = -Infinity;
  private walks = 0;
  private rideAt = -Infinity;
  private lastWhere: { floor: string; room: string | null; pos: Vec2; at: number } | null = null;
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
    this.input = input;
    const party = input.party;
    if (!party || (prev && prev.partyId !== party.partyId)) this.reset();
    const drive = party !== null && input.isController;
    if (drive !== this.hooked) {
      this.port.setHooks(drive ? this : null);
      this.hooked = drive;
    }
    if (party) {
      // the server's view of a pause is authoritative (across a reload, and a deadline's pause)
      const mine = this.isLeader() ? party.leaderFollowing : party.members.find((m) => m.email === input.selfEmail)?.following;
      if (mine !== undefined && this.intent !== null && mine === this.intent) this.intent = null;
      if (mine !== undefined && this.intent === null) this.following = mine;
      const id = currentStageId(party);
      if (id !== this.stageId) {
        // A NEW STAGE: set out on it now — not a retry interval from now
        this.stageId = id;
        this.walkAt = -Infinity;
        this.walks = 0;
        this.rideAt = -Infinity;
      }
    }
    this.publish();
  }

  // ---- UI verbs -----------------------------------------------------------------------------------------

  /** Leader, FORMING: set out with whoever has accepted — the server picks the rendezvous. */
  startWalking(): void {
    const party = this.input.party;
    if (!party || !this.isLeader() || !this.input.isController || party.stage !== "forming" || party.members.length === 0) return;
    this.reportWhere(true); // the decision is made from reports: make sure the leader's own is current
    this.net.start();
  }

  /** Back into the journey after Esc — on the stage the party is on NOW (a lift first, if it is elsewhere). */
  resume(): void {
    if (!this.input.party || this.following) return;
    this.following = true;
    this.intent = true;
    this.walkAt = -Infinity;
    this.walks = 0;
    this.rideAt = -Infinity;
    this.net.followState(true);
    this.publish();
  }

  pause(): void {
    if (!this.input.party || !this.following) return;
    this.following = false;
    this.intent = false;
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
    if (this.guided) this.port.setGuided(false);
    this.guided = false;
    if (this.hooked) this.port.setHooks(null);
    this.hooked = false;
    this.listeners.clear();
  }

  // ---- hooks (the world calls these) --------------------------------------------------------------------

  onUserMove(): void {
    // FORMING moves nobody, so there is nothing to take control from.
    if (!this.input.party || this.input.party.stage === "forming") return;
    this.pause();
  }

  // ---- the loop -----------------------------------------------------------------------------------------

  tick(): void {
    const party = this.input.party;
    if (!party || !this.input.isController) return;
    if (party.stage === "forming") this.reportWhere(false);
    else if (this.following) this.tickStage(party);
    this.publish();
  }

  private tickStage(party: PartyWire): void {
    const rv = party.rendezvous;
    const order = rv?.participants ?? [];
    const index = order.indexOf(this.input.selfEmail);
    if (index < 0) return;
    const role = roleOf(party, this.input.selfEmail);
    // ALREADY IN THE ROOM: this body is where the party is going. Nothing to walk, nothing to report.
    if (role === "arrived") return;
    // ALREADY ON THE DESTINATION FLOOR: never sent back down. Until the riders are off the lift, wait beside
    // its arrival lane; the walk to the room then opens for everybody at once and this body joins it.
    if (role === "wait" && party.stage !== "to_room") {
      const floor = party.destination.floor as Vo3dFloorId;
      const waiting = order.filter((e) => roleOf(party, e) === "wait");
      const spot = this.port.liftWait(floor, Math.max(0, waiting.indexOf(this.input.selfEmail)));
      if (spot) this.walkStage(`${party.partyId}:wait`, floor, spot, false);
      return;
    }
    if (party.stage === "gathering" && rv) {
      const place = rv.kind === "hub" ? this.port.hub() : rv.floor && rv.point ? { floor: rv.floor as Vo3dFloorId, point: rv.point } : null;
      if (place) this.walkStage(rv.stageId, place.floor, rendezvousSlot(place.point, index, order.length));
      return;
    }
    const leg = party.leg;
    if (!leg || (party.stage !== "to_lift" && party.stage !== "ride" && party.stage !== "to_room")) return; // READY: the server opens the next leg
    if (leg.kind === "to_lift") {
      const lobby = this.port.liftLobby(leg.floor as Vo3dFloorId, index);
      if (lobby) this.walkStage(leg.stageId, leg.floor as Vo3dFloorId, lobby);
    } else if (leg.kind === "ride") {
      this.rideStage(leg, order);
    } else {
      const a = this.port.arrival(party.destination);
      if (a) this.walkStage(leg.stageId, a.floor, arrivalSlot(a.point, a.into, index));
    }
  }

  /** A WALKING STAGE: this body, guided, to its own slot `target` on `floor` — and ready once IT is there. */
  private walkStage(stageId: string, floor: Vo3dFloorId, target: Vec2, report = true): void {
    if (this.readySent === stageId) return;
    const now = this.now();
    const self = this.port.self();
    if (self.riding || self.holding) return;
    // On another floor (a member upstairs when the party gathers at the Hub, a resume after the party rode):
    // the ordinary lift there first.
    if (self.floor !== floor) {
      if (now - this.rideAt >= CATCH_UP_RETRY_MS) {
        this.rideAt = now;
        this.port.ride(floor);
      }
      return;
    }
    const d = dist(self.pos, target);
    const settled = !self.moving && now - this.walkAt >= 300;
    if (settled && (d <= READY_RADIUS || (this.walks >= RV_FALLBACK_WALKS && d <= RV_FALLBACK_RADIUS))) {
      this.readySent = stageId;
      if (report) this.net.ready(stageId, self.floor);
      return;
    }
    if (self.moving || now - this.walkAt < RV_RETRY_MS) return;
    this.walkAt = now;
    this.walks++;
    this.port.walkNear(target);
  }

  /** THE RIDE: this body's own lift, in its own cabin slot, the other riders in theirs — started the moment
   *  the server opens the leg, so every browser's doors open together. Ready once off it upstairs. */
  private rideStage(leg: PartyLeg, order: readonly string[]): void {
    if (this.readySent === leg.stageId || !leg.toFloor) return;
    const self = this.port.self();
    if (self.riding || self.holding) return;
    if (self.floor === leg.toFloor) {
      if (!self.moving) {
        this.readySent = leg.stageId;
        this.net.ready(leg.stageId, self.floor);
      }
      return;
    }
    const now = this.now();
    if (now - this.rideAt < CATCH_UP_RETRY_MS) return;
    this.rideAt = now;
    const riding = leg.riders ?? [];
    // Not on this ride's manifest (resumed after it was drawn up): a catch-up ride of their own.
    const plan = riding.includes(this.input.selfEmail) ? partyLiftPlan(order, riding, this.input.selfEmail) : null;
    this.port.ride(leg.toFloor as Vo3dFloorId, plan);
  }

  /** FORMING: this body's own place, sent when it changed — the server decides the rendezvous from it. */
  private reportWhere(force: boolean): void {
    const self = this.port.self();
    if (self.riding) return;
    const now = this.now();
    const last = this.lastWhere;
    const changed = !last || last.floor !== self.floor || last.room !== self.room || dist(last.pos, self.pos) > WHERE_UNITS;
    if (!force && (!changed || (last && now - last.at < WHERE_MS))) return;
    this.lastWhere = { floor: self.floor, room: self.room, pos: self.pos, at: now };
    this.net.where(self.floor, self.room, self.pos);
  }

  // ---- internals ----------------------------------------------------------------------------------------

  private isLeader(): boolean {
    return this.input.party?.leaderEmail === this.input.selfEmail;
  }

  private reset(): void {
    this.following = true;
    this.intent = null;
    this.stageId = null;
    this.readySent = null;
    this.walkAt = -Infinity;
    this.walks = 0;
    this.rideAt = -Infinity;
    this.lastWhere = null;
  }

  private formingPeople(party: PartyWire): PartyPerson[] {
    const person = (email: string, state: PartyPerson["state"]): PartyPerson => ({ email, state, leader: email === party.leaderEmail });
    return [
      person(party.leaderEmail, "joined"),
      ...party.members.map((m) => person(m.email, "joined")),
      ...party.pending.map((e) => person(e, "waiting")),
      ...party.declined.map((e) => person(e, "declined")),
    ];
  }

  /** Everyone still in the party, in slot order, as the current stage sees them. */
  private travellingPeople(party: PartyWire, ready: readonly string[]): PartyPerson[] {
    const members = new Map(party.members.map((m) => [m.email, m]));
    return (party.rendezvous?.participants ?? [])
      .filter((e) => e === party.leaderEmail || members.has(e))
      .map((email) => {
        const following = email === party.leaderEmail ? party.leaderFollowing : members.get(email)?.following ?? false;
        const state: PartyPerson["state"] = ready.includes(email) ? "ready" : !following ? "paused" : "on-the-way";
        return { email, state, leader: email === party.leaderEmail };
      });
  }

  private computeStatus(): GoTogetherStatus {
    const party = this.input.party;
    if (!party) return { kind: "none" };
    if (!this.input.isController) return { kind: "observer", leader: this.isLeader() };
    if (party.stage === "forming") {
      const people = this.formingPeople(party);
      return this.isLeader()
        ? { kind: "leader-forming", people, canStart: party.members.length > 0 }
        : { kind: "forming", leader: party.leaderEmail, people };
    }
    if (!this.following) return { kind: "paused", leader: this.isLeader() };
    const role = roleOf(party, this.input.selfEmail);
    const everyone = () => this.travellingPeople(party, party.leg?.ready ?? party.rendezvous?.ready ?? []);
    if (role === "arrived") return { kind: "already-here", people: everyone() };
    if (role === "wait" && party.stage !== "to_room") return { kind: "meeting-upstairs", people: everyone() };
    const place = party.rendezvous?.kind ?? "here";
    if (party.stage === "gathering") return { kind: "rendezvous", place, people: this.travellingPeople(party, party.rendezvous?.ready ?? []) };
    if (party.stage === "ready" || !party.leg) {
      return { kind: "party-ready", place, people: this.travellingPeople(party, party.rendezvous?.participants ?? []) };
    }
    return { kind: "journey", leg: party.leg.kind, riding: this.port.self().riding, people: this.travellingPeople(party, party.leg.ready) };
  }

  /** Is this body's journey under way? From Start Walking to arrival, while this person has not taken their
   *  body back. Only the tab that drives the body. */
  private wantsGuided(): boolean {
    const party = this.input.party;
    return party !== null && this.input.isController && party.stage !== "forming" && this.following
      && roleOf(party, this.input.selfEmail) !== "arrived";
  }

  private syncGuided(): void {
    const want = this.wantsGuided();
    if (want === this.guided) return;
    this.guided = want;
    this.port.setGuided(want);
  }

  private publish(): void {
    this.syncGuided();
    const next = this.computeStatus();
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    for (const cb of this.listeners) cb(next);
  }
}

/** This person's role in the journey (everybody travels until Start Walking has decided). */
export function roleOf(party: PartyWire, email: string): PartyRole {
  return party.roles?.[email] ?? "travel";
}

/** The stage a ready report is about: the rendezvous while gathering, the leg while travelling. */
export function currentStageId(party: PartyWire): string | null {
  if (party.stage === "gathering") return party.rendezvous?.stageId ?? null;
  if (party.stage === "to_lift" || party.stage === "ride" || party.stage === "to_room") return party.leg?.stageId ?? null;
  return null;
}
