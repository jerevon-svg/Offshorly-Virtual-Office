// vo3d app — VO MEETINGS ARE PHYSICAL: Invite → Accept → Travel → ARRIVE → Join. A pure controller + port,
// like meetingDirector.ts, ticked by the world.
//
// ACCEPTING IS INTENT, NOT PARTICIPATION. Accepting a meeting (an instant invitation, or choosing how to get to
// a scheduled one) records `intent` — "I mean to attend this meeting" — and nothing else: no call, no Meeting
// Session attendance, no In Meeting, no Directed Meeting, no capture consent. Those all start from the one
// real edge, the call join, and this controller makes that join happen only when the body has ARRIVED: inside
// the destination room, or on its doorway spot (the same `arrived` that Walk There, Go Together's arrival and
// the Directed Meeting already use), and not mid-journey.
//
// ONLY A LIVE MEETING IS JOINED ON ARRIVAL. An instant meeting joins when it is running; a scheduled one only
// when the running meeting in that room IS this booking — arriving early, or at a room still held by an
// overrunning earlier meeting, joins nothing (the room panel's own Start / Join stays the explicit choice).
// An instant meeting that was seen running and no longer is drops the intent (never before it was first
// seen: presence can arrive a moment after the accept).
//
// LEAVING THE ROOM LEAVES THE MEETING. There is no remote participation: a body that has been out of its
// meeting's room (and off its doorway) for LEAVE_GRACE_MS is taken out of the call through the ordinary Leave
// — the same seam as the Leave button, so the server closes the attendance interval exactly as it always does.
// The grace absorbs doorway jitter and a seat's first frames.
//
// NOTHING HERE MOVES ANYBODY. Travel is always the employee's own choice (Go Together / Walk There /
// Teleport); a meeting that runs over simply keeps its people — a later meeting's intent waits until they go.

export interface MeetingIntent {
  /** the live call's id, `mf-<slug>` */
  meetingId: string;
  /** the Meeting Floor room it happens in, `floor-2/<slug>` */
  roomId: string;
  /** instant: join whenever it is live. scheduled: join only while THIS booking is the one running. */
  kind: "instant" | "scheduled";
  /** scheduled only: the booking's start, to tell it apart from an earlier meeting still in the room */
  bookingStartsAt?: string;
}

export interface ArrivalBody {
  /** the Meeting Floor room the body stands in, else null */
  room: string | null;
  /** the room whose doorway spot the body stands on, else null */
  atDoor: string | null;
  /** a journey or transition is under way (lift, portal, Go Together) */
  travelling: boolean;
}

export interface ArrivalPort {
  body(): ArrivalBody;
  /** the Meeting Floor room meeting this client is connected to (or connecting to), else null */
  connected(): { meetingId: string; roomId: string } | null;
  /** is the meeting the intent names running right now, as the intent requires? */
  live(intent: MeetingIntent): boolean;
  join(meetingId: string): void;
  leave(): void;
}

export const LEAVE_GRACE_MS = 2_500;
/** a refused/failed join is not retried in a tight loop */
export const JOIN_RETRY_MS = 5_000;

export type ArrivalPhase = "idle" | "intending" | "joining" | "joined";

export class MeetingArrival {
  intent: MeetingIntent | null = null;
  private outsideSince: number | null = null;
  private lastJoinAt = -Infinity;
  private joinedFromIntent: string | null = null;
  private seenLive = false;

  private readonly port: ArrivalPort;

  constructor(port: ArrivalPort) {
    this.port = port;
  }

  /** Record that the employee means to attend. Moves nobody and joins nothing by itself. */
  intend(intent: MeetingIntent): void {
    this.intent = { ...intent };
    this.lastJoinAt = -Infinity;
    this.seenLive = false;
  }

  /** Forget the intent (the invitation was withdrawn, the meeting ended, another one was chosen). */
  clear(meetingId?: string): void {
    if (!this.intent || (meetingId && this.intent.meetingId !== meetingId)) return;
    this.intent = null;
  }

  arrivedAt(roomId: string): boolean {
    const b = this.port.body();
    return !b.travelling && (b.room === roomId || b.atDoor === roomId);
  }

  phase(): ArrivalPhase {
    const c = this.port.connected();
    if (this.intent && c?.meetingId === this.intent.meetingId) return "joined";
    if (this.intent) return this.joinedFromIntent === this.intent.meetingId ? "joining" : "intending";
    return c ? "joined" : "idle";
  }

  tick(now: number): void {
    const c = this.port.connected();
    const b = this.port.body();

    // THE PHYSICAL RULE for whoever is in a room's meeting: out of the room (and off its doorway) for the
    // grace → Leave. Travelling out counts as out: a lift ride away from the meeting is leaving it.
    if (c) {
      const inside = b.room === c.roomId || b.atDoor === c.roomId;
      if (inside) this.outsideSince = null;
      else if (this.outsideSince === null) this.outsideSince = now;
      else if (now - this.outsideSince >= LEAVE_GRACE_MS) {
        this.outsideSince = null;
        this.port.leave();
        return;
      }
    } else {
      this.outsideSince = null;
    }

    const intent = this.intent;
    if (!intent) return;
    if (c?.meetingId === intent.meetingId) {
      // JOINED: the intent is fulfilled — from here it is an ordinary participation.
      this.intent = null;
      this.joinedFromIntent = null;
      return;
    }
    const live = this.port.live(intent);
    if (live) this.seenLive = true;
    else if (intent.kind === "instant" && this.seenLive) {
      // the instant meeting ended (or emptied) while they were on the way: nothing left to join
      this.intent = null;
      return;
    }
    if (!live || !this.arrivedAt(intent.roomId)) return;
    if (now - this.lastJoinAt < JOIN_RETRY_MS) return;
    this.lastJoinAt = now;
    this.joinedFromIntent = intent.meetingId;
    this.port.join(intent.meetingId);
  }
}

/** PHYSICAL IN MEETING — the people who are BOTH participating in a Meeting Floor room's meeting (the server's
 *  participant list) AND whose body is in that meeting's own room. Accepting, travelling, or standing in the
 *  room without participating are all insufficient. `roomOf` answers from this browser's drawn world. */
export function physicallyInMeeting(
  meetings: readonly { meetingId: string; participants: readonly string[] }[],
  roomIdOf: (meetingId: string) => string | null,
  roomOf: (email: string) => string | null,
): Set<string> {
  const out = new Set<string>();
  for (const m of meetings) {
    const roomId = roomIdOf(m.meetingId);
    if (!roomId) continue;
    for (const raw of m.participants) {
      const email = raw.trim().toLowerCase();
      if (roomOf(email) === roomId) out.add(email);
    }
  }
  return out;
}
