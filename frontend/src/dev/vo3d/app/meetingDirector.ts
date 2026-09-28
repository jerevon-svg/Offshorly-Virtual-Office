// vo3d app — DIRECTED MEETING: while this employee is genuinely IN a Meeting Floor room's live meeting, the
// meeting walks their own body — to a free chair, and beside the TV while they present.
//
// WHAT THIS IS. A pure controller over a port, like app/goTogether.ts. It decides what THIS body does next
// from three facts the world already has, and owns no movement of its own:
//
//   the meeting   is this client connected to a Meeting Floor room's call (the existing call store, read
//                 through CaveLiveShare) — being upstairs, near the room or inside it early is NOT enough;
//                 connected AND in the room (or at its doorway spot, where Walk There ends) starts it
//   the share     is this client the one publishing the screen (the same store's screenShareEnabled)
//   the body      where it is, and which seat (if any) it is in or on its way to
//
// and it answers with the world's existing verbs: sit (the ordinary seat interaction, so facing, height and
// occupancy are exactly an E-press sit), leave the seat, walk (the ordinary routed walk), face.
//
// EACH BROWSER DIRECTS ONLY ITS OWN BODY. Nobody else is puppeted: the seat, the walk to the TV and the
// stand are published by the ordinary movement feed, and that is how everybody else sees them.
//
// CONTROL. While directed the world holds the controller stack's Guided base (the same owner a Go Together
// journey uses): PLAYER stays on screen with its camera and mouse-look, the movement keys do not fight the
// director, E does not stand the body up. Esc (pointer already free) or an OFFICE-view click is the person
// taking their body back: the director SUSPENDS for the rest of this meeting — until the share state changes
// (a deliberate meeting action of their own) or they leave and rejoin. It never re-takes the body in a loop.
//
// A LEAF: imports only V2's coordinate type.
import type { Vec2 } from "../core/coords";

/** A seat this room offers: a chair, or one cushion of a lounge piece. */
export interface DirectedSeat {
  /** the seat anchor (app/seats.ts id) — what occupancy and the feed's seated arrival name */
  anchor: string;
  /** where the body ends up, for choosing the nearest */
  pos: Vec2;
  /** chairs first; lounge pieces only when no chair is free */
  kind: "chair" | "lounge";
}

export interface DirectedBody {
  pos: Vec2;
  /** the Meeting Floor room the body stands in, or null */
  room: string | null;
  /** the Meeting Floor room whose doorway spot the body stands at (Walk There's arrival), or null */
  atDoor?: string | null;
  /** the seat anchor the body is committed to (gliding in, seated) or walking to, or null */
  seat: string | null;
  /** is the body committed to that seat (sitting / seated) rather than still walking to it? */
  seated: boolean;
  /** any seat interaction under way — walking to it, sitting, standing up, pushing the chair back */
  seatBusy: boolean;
  /** a routed walk is moving the body */
  moving: boolean;
  /** something else owns the journey right now — a Go Together party, the lift, the portal */
  travelling: boolean;
}

export interface MeetingDirectorPort {
  /** THE MEETING: the Meeting Floor room whose live call this client is connected to, and whether this
   *  client is the one sharing its screen. Null when not connected to a room meeting. */
  meeting(): { roomId: string; presenting: boolean } | null;
  body(): DirectedBody;
  /** every seat the room offers */
  seats(roomId: string): readonly DirectedSeat[];
  /** anchors OTHER employees occupy right now */
  occupied(): ReadonlySet<string>;
  /** start the ordinary sit for an anchor; false when refused */
  sit(anchor: string): boolean;
  /** leave the seat: a walk to it is dropped where the body stands (never a teleport), a seated body stands
   *  up through the ordinary sequence. Idempotent. */
  leaveSeat(): void;
  /** the presenter's spot beside the room's TV, facing the room; null when the room has none */
  stage(roomId: string): { point: Vec2; yaw: number } | null;
  walkTo(p: Vec2): boolean;
  /** stop a walk this director started */
  stopWalk(): void;
  /** turn on the spot (the world turns at its usual rate and publishes the final yaw) */
  face(yaw: number): void;
  /** hold / release locomotion (the controller stack's Guided base) */
  setDirected(on: boolean): void;
}

export type DirectedPhase = "off" | "seating" | "seated" | "standing" | "rising" | "to_stage" | "presenting";

/** How many seats one seating episode may try before it stands where it is. */
export const MAX_SEAT_ATTEMPTS = 4;
/** Arrived at the presenter's spot when this close. */
export const STAGE_REACHED = 8;

export interface MeetingDirectorState {
  phase: DirectedPhase;
  room: string;
  target: string;
  attempts: number;
  suspended: string;
  note: string;
}

export class MeetingDirector {
  private readonly port: MeetingDirectorPort;
  /** a stable per-person key, so two people arriving together do not both pick the same nearest chair */
  private readonly spread: number;
  private phase: DirectedPhase = "off";
  private room: string | null = null;
  private presenting = false;
  /** the seat this episode is trying, and the ones it has already lost */
  private target: string | null = null;
  private readonly excluded = new Set<string>();
  private attempts = 0;
  /** the last seat this body sat in during this meeting — preferred again after presenting */
  private lastSeat: string | null = null;
  /** the room whose meeting the person took their body back from (Esc / an OFFICE click) */
  private suspendedFor: string | null = null;
  /** occupancy signature when the director last gave up on seats, so a freed chair gets one more try */
  private gaveUpAt = "";
  /** the presenter's spot this share walked to — chosen once, so the side never flips mid-walk */
  private stagePick: { point: Vec2; yaw: number } | null = null;
  readonly state: MeetingDirectorState = { phase: "off", room: "", target: "", attempts: 0, suspended: "", note: "" };

  constructor(port: MeetingDirectorPort, identityKey = "") {
    this.port = port;
    let h = 0;
    for (let i = 0; i < identityKey.length; i++) h = (h * 31 + identityKey.charCodeAt(i)) >>> 0;
    this.spread = h;
  }

  get active(): boolean { return this.phase !== "off"; }

  /** THE PERSON TOOK THEIR BODY BACK. Everything this director started stops where it is, and it stays out
   *  of the way for the rest of this meeting (see the header). No-op when not directing. */
  userTookOver(): boolean {
    if (!this.active || !this.room) return false;
    this.suspendedFor = this.room;
    this.release("you took control");
    return true;
  }

  tick(): void {
    const m = this.port.meeting();
    // LEFT THE MEETING (or it ended, or the call dropped): hand the body back where it is. A later meeting
    // starts clean — the suspension belonged to this one.
    if (!m) {
      this.suspendedFor = null;
      if (this.active) this.release("meeting over");
      this.presenting = false;
      this.syncState();
      return;
    }
    const shareEdge = m.presenting !== this.presenting;
    this.presenting = m.presenting;
    // A DIFFERENT ROOM'S MEETING is a new meeting.
    if (this.active && m.roomId !== this.room) this.release("meeting changed");
    if (this.suspendedFor && this.suspendedFor !== m.roomId) this.suspendedFor = null;
    // Starting or stopping a share is the person's own meeting action: it lifts a suspension.
    if (shareEdge && this.suspendedFor === m.roomId) this.suspendedFor = null;
    const b = this.port.body();
    if (!this.active) {
      // START ONLY WHEN GENUINELY THERE: connected to this room's meeting, standing in this room, and not in
      // the middle of somebody else's journey (Go Together hands the body back on arrival first).
      if (this.suspendedFor === m.roomId || b.travelling || (b.room !== m.roomId && b.atDoor !== m.roomId)) { this.syncState(); return; }
      this.room = m.roomId;
      this.port.setDirected(true);
      this.resetEpisode();
      this.lastSeat = null;
      this.phase = m.presenting ? "rising" : "seating";
      this.state.note = "";
    } else if (shareEdge) {
      this.resetEpisode();
      if (m.presenting) this.phase = "rising";
      else { this.port.stopWalk(); this.phase = "seating"; }
    }
    if (this.presenting) this.tickPresenter(b);
    else this.tickSeating(b);
    this.syncState();
  }

  // ---- presenting ------------------------------------------------------------------------------------
  private tickPresenter(b: DirectedBody): void {
    const room = this.room!;
    if (this.phase === "rising") {
      // Out of the chair first, through its own sequence; the walk starts once the body is free.
      if (b.seat || b.seatBusy) { this.port.leaveSeat(); return; }
      const stage = this.port.stage(room);
      this.stagePick = stage;
      if (!stage) { this.phase = "presenting"; this.state.note = "no presenter spot"; return; }
      if (dist(b.pos, stage.point) <= STAGE_REACHED) { this.port.face(stage.yaw); this.phase = "presenting"; return; }
      if (this.port.walkTo(stage.point)) this.phase = "to_stage";
      else { this.port.face(stage.yaw); this.phase = "presenting"; this.state.note = "presenter spot unreachable"; }
      return;
    }
    if (this.phase === "to_stage") {
      if (b.moving) return;
      if (this.stagePick) this.port.face(this.stagePick.yaw);
      this.phase = "presenting";
    }
    // presenting: stand there for as long as the share lasts
  }

  // ---- seating ---------------------------------------------------------------------------------------
  private tickSeating(b: DirectedBody): void {
    const occupied = this.port.occupied();
    if (this.phase === "seating" || this.phase === "rising" || this.phase === "to_stage" || this.phase === "presenting") {
      // ALREADY SITTING (the person sat before the meeting started, or this episode's seat took): keep it.
      if (b.seated && b.seat) { this.seatTaken(b.seat); return; }
      if (b.moving) return; // the walk away from the TV is being stopped this tick; wait a frame
      if (this.target) {
        // ON THE WAY: somebody else got there first — drop it where we stand and choose again.
        if (b.seat === this.target && b.seatBusy) {
          if (occupied.has(this.target)) { this.port.leaveSeat(); this.lose(this.target); }
          return;
        }
        // the sit was refused, or the server rejected the claim and stood the body back up
        if (b.seatBusy) return;
        this.lose(this.target);
      } else if (b.seatBusy) {
        return; // a seat sequence of the body's own (standing up) is finishing
      }
      this.chooseAndSit(b, occupied);
      return;
    }
    if (this.phase === "seated") {
      if (b.seated && b.seat) { this.lastSeat = b.seat; return; }
      // STOOD UP UNDER US — the server's seat_rejected verdict, or a chair that went away. Once the stand
      // sequence finishes, that seat is off the list and the episode tries another.
      if (b.seatBusy) return;
      if (this.target) this.lose(this.target);
      this.chooseAndSit(b, occupied);
      return;
    }
    if (this.phase === "standing") {
      // NO SEAT WAS FREE: stand naturally. A chair freed later gets one more try, within the same bound.
      const sig = [...occupied].sort().join("|");
      if (sig !== this.gaveUpAt && this.attempts < MAX_SEAT_ATTEMPTS) this.chooseAndSit(b, occupied);
    }
  }

  private seatTaken(anchor: string): void {
    this.target = anchor;
    this.lastSeat = anchor;
    this.phase = "seated";
  }

  private lose(anchor: string): void {
    this.excluded.add(anchor);
    if (this.lastSeat === anchor) this.lastSeat = null;
    this.target = null;
  }

  private chooseAndSit(b: DirectedBody, occupied: ReadonlySet<string>): void {
    while (this.attempts < MAX_SEAT_ATTEMPTS) {
      const pick = this.choose(b.pos, occupied);
      if (!pick) break;
      this.attempts++;
      if (this.port.sit(pick)) { this.target = pick; this.phase = "seating"; return; }
      this.excluded.add(pick);
    }
    this.target = null;
    this.phase = "standing";
    this.gaveUpAt = [...occupied].sort().join("|");
    this.state.note = this.attempts >= MAX_SEAT_ATTEMPTS ? "no seat after retries — standing" : "no free seat — standing";
  }

  /** THE SEAT: the one this body sat in before (after presenting), else one of the few nearest free chairs —
   *  which of them fixed per person, so two people walking in together head for different chairs. Lounge
   *  seats only when no chair is free. */
  choose(from: Vec2, occupied: ReadonlySet<string>): string | null {
    const free = this.port.seats(this.room!).filter((s) => !occupied.has(s.anchor) && !this.excluded.has(s.anchor));
    if (this.lastSeat && free.some((s) => s.anchor === this.lastSeat)) return this.lastSeat;
    const chairs = free.filter((s) => s.kind === "chair");
    const pool = (chairs.length ? chairs : free).slice().sort((a, b) => dist(from, a.pos) - dist(from, b.pos));
    if (pool.length === 0) return null;
    return pool[this.spread % Math.min(3, pool.length)].anchor;
  }

  private resetEpisode(): void {
    this.target = null;
    this.excluded.clear();
    this.attempts = 0;
    this.gaveUpAt = "";
  }

  /** HAND THE BODY BACK where it is: a walk this director started stops, a walk to a chair stops short of it
   *  (a sit already gliding in finishes — the person stands with E like any other sit). */
  private release(note: string): void {
    const b = this.port.body();
    this.port.stopWalk();
    if (b.seatBusy && !b.seated) this.port.leaveSeat();
    this.port.setDirected(false);
    this.phase = "off";
    this.room = null;
    this.resetEpisode();
    this.state.note = note;
  }

  private syncState(): void {
    this.state.phase = this.phase;
    this.state.room = this.room ?? "";
    this.state.target = this.target ?? "";
    this.state.attempts = this.attempts;
    this.state.suspended = this.suspendedFor ?? "";
  }
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

/** THE 3/4 PRESENTING STANCE: how far the body turns from the audience toward the screen it is presenting. */
export const PRESENTER_TURN = (32 * Math.PI) / 180;

/** Facing the table, turned PRESENTER_TURN toward the screen (never past it): the audience sees the
 *  presenter's face, the presenter half-opens to the slide. From the room's own geometry, per room. */
export function presenterYaw(at: Vec2, table: Vec2, screen: Vec2): number {
  const toTable = Math.atan2(table.x - at.x, table.z - at.z);
  const toScreen = Math.atan2(screen.x - at.x, screen.z - at.z);
  const delta = Math.atan2(Math.sin(toScreen - toTable), Math.cos(toScreen - toTable));
  return toTable + Math.sign(delta) * Math.min(Math.abs(delta), PRESENTER_TURN);
}

/** THE PRESENTER'S SPOT, from the room's own TV: beside the screen (clear of its end by a step), a little
 *  in front of it, on whichever side is standable and nearer the body — in a 3/4 stance: toward the table,
 *  half-turned to the screen (presenterYaw).
 *  `screen.facing` is the way the screen looks, i.e. into the room. */
export function presenterSpot(
  screen: { x: number; z: number; facing: "north" | "south" | "east" | "west"; w: number },
  table: Vec2,
  from: Vec2,
  standable: (p: Vec2) => boolean,
): { point: Vec2; yaw: number } | null {
  const f = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } }[screen.facing];
  const side = { x: -f.z, z: f.x }; // along the screen
  // Rings from snug to roomier; on each, both sides of the screen — the nearer standable one wins.
  for (const out of [18, 24, 30]) for (const lat of [screen.w / 2 + 14, screen.w / 2 + 20, screen.w / 2 + 8]) {
    const both = [1, -1]
      .map((s) => ({ x: screen.x + f.x * out + side.x * lat * s, z: screen.z + f.z * out + side.z * lat * s }))
      .filter(standable)
      .sort((a, b) => dist(from, a) - dist(from, b));
    if (both.length) return { point: both[0], yaw: presenterYaw(both[0], table, screen) };
  }
  return null;
}
