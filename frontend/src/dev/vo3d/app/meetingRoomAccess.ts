// vo3d app — MEETING ROOM ACCESS: the room-level privacy a meeting puts on a Meeting Floor room.
//
// THIS IS ROOM ACCESS, NOT PRESENCE. A room in an active meeting shuts its door to people who are not in
// that meeting. It says nothing about anybody's status: an employee's personal DND, Away or "In Meeting"
// are owned by the presence store and by actual meeting participation, never by this file. Walking into
// an available room changes nobody's status.
//
// THE LIFECYCLE a future Scheduled Meetings system drives through `set()`:
//
//     available → starting → active (private) → ended → available
//
// Only `active` shuts anything, and it shuts exactly one thing: the doorway, to a body that is OUTSIDE the
// room and NOT authorised. Everyone inside can always leave (the doorway is never solid to a body standing
// in the room), and an authorised participant walks in as if the room were available — so nobody can be
// trapped and nobody is locked out of their own meeting. Nothing here is faked: with no scheduler wired,
// every room is and stays `available`.
import type { Vec2 } from "../core/coords";
import { MEETING_ROOMS, meetingRoom, setDoorwayShut } from "../rooms/floor2Meeting";
import { pointInRect } from "../core/coords";

export type MeetingRoomState = "available" | "starting" | "active" | "ended";

export interface MeetingRoomAccessEntry {
  state: MeetingRoomState;
  /** is THIS client's employee a participant of the room's current meeting? */
  selfAuthorized: boolean;
}

export class MeetingRoomAccess {
  private readonly rooms = new Map<string, MeetingRoomAccessEntry>();
  private readonly listeners = new Set<(roomId: string, entry: MeetingRoomAccessEntry) => void>();
  /** bumped whenever a doorway's solidity changes — the route grid's invalidation key */
  version = 0;

  constructor() {
    for (const r of MEETING_ROOMS) this.rooms.set(r.id, { state: "available", selfAuthorized: false });
  }

  get(roomId: string): MeetingRoomAccessEntry | null {
    return this.rooms.get(roomId) ?? null;
  }

  /** THE ONE WRITE. Scheduled Meetings calls this with the room's stable id; nothing else in the world
   *  does. Returns false for an id this floor does not have. */
  set(roomId: string, state: MeetingRoomState, opts: { selfAuthorized?: boolean } = {}): boolean {
    const cur = this.rooms.get(roomId);
    if (!cur) return false;
    const next: MeetingRoomAccessEntry = { state, selfAuthorized: opts.selfAuthorized ?? (state === "active" ? cur.selfAuthorized : false) };
    if (next.state === cur.state && next.selfAuthorized === cur.selfAuthorized) return true;
    this.rooms.set(roomId, next);
    for (const l of this.listeners) l(roomId, next);
    return true;
  }

  subscribe(listener: (roomId: string, entry: MeetingRoomAccessEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Is the room shut to this client's employee right now? Private meeting, not a participant. */
  refuses(roomId: string): boolean {
    const e = this.rooms.get(roomId);
    return !!e && e.state === "active" && !e.selfAuthorized;
  }

  /** Is `p` inside that room? */
  inside(roomId: string, p: Vec2): boolean {
    const r = meetingRoom(roomId);
    return !!r && pointInRect(p, r.interior);
  }

  /** APPLY FROM THE BODY'S REAL POSITION: a refused room's doorway is solid to a body OUTSIDE it and open
   *  to one inside it, which is what makes "occupants can always leave" true by construction. Returns
   *  true when any doorway changed, so the caller can re-sample its route grid. */
  apply(self: Vec2): boolean {
    let changed = false;
    for (const r of MEETING_ROOMS) {
      const shut = this.refuses(r.id) && !pointInRect(self, r.interior);
      if (setDoorwayShut(r.id, shut)) changed = true;
    }
    if (changed) this.version++;
    return changed;
  }

  /** May a body at `from` be ROUTED to `to`? Refused only into a shut room from outside it. */
  routeRefused(from: Vec2, to: Vec2): string | null {
    for (const r of MEETING_ROOMS) if (this.refuses(r.id) && pointInRect(to, r.interior) && !pointInRect(from, r.interior)) return r.id;
    return null;
  }
}
