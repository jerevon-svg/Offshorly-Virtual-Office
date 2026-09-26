// vo3d app — SCHEDULED MEETINGS ON THE MEETING FLOOR: one room's bookings + its live state + the clock
// → what its door sign says, whether its door is shut to this viewer, and what the in-room panel says.
//
// PURE and world-free, so every rule here is a unit test (scheduledRooms.test.ts). app/world.ts runs it
// per room whenever the schedule, the live set or the clock moves, and hands the result to the parts that
// already exist: the door sign (build/floor2Meeting), the room access (app/meetingRoomAccess) and the
// meeting panel's state (Vo3dCaveMeeting). No second sign system, no second access system.
//
// THE GOVERNING BOOKING MIRRORS THE SERVER EXACTLY (backend/app/services/scheduled_meetings.py):
//   * while the room's meeting is LIVE, the booking the live session was bound to when it started —
//     the server says which, by public window, on meeting_presence (null = ad-hoc). A live session wins
//     until it empties: an overrun keeps its own rules and the next booking never takes the room over;
//   * otherwise the booking whose access window [start − 5 min, end) contains now.
// A private governing booking shuts the door to non-invitees — the server's token gate is the real lock,
// this is its picture. Occupants can always leave (meetingRoomAccess guarantees it by construction).
//
// PRIVACY: a private booking the viewer is not invited to arrives from the server with title null. This
// file never has more than that to show, so a sign or panel cannot leak what it was never given.
import type { RoomSignState } from "../build/floor2Meeting";

export const ACCESS_LEAD_MS = 5 * 60_000;
export const UPCOMING_MS = 15 * 60_000;

/** The shape the scheduled-meetings store hands over (services/meetings RoomBooking, trimmed). */
export interface ScheduledBooking {
  startsAt: string;
  endsAt: string;
  isPrivate: boolean;
  /** null when the server hid it (a private meeting this viewer is not in) */
  title: string | null;
  viewerIsInvitee: boolean;
}

export interface LiveRoom {
  live: boolean;
  /** the live session's booking by public window; null = unbooked; undefined = not known */
  booking?: { startsAt: string; endsAt: string; isPrivate: boolean } | null;
}

export interface SignDetail {
  state: RoomSignState;
  /** replaces the "Meeting · 6 seats" line */
  line2?: string;
  /** replaces the status word ("Available", "In Meeting", …) */
  text?: string;
  /** the small line under the status */
  sub?: string;
}

export interface ScheduledContext {
  title: string;
  startsAt: string;
  endsAt: string;
  isPrivate: boolean;
  /** upcoming: >5 min out · window: its access window, not yet live · live: it is running ·
   *  occupied: its time has come but an earlier or ad-hoc meeting still has the room */
  phase: "upcoming" | "window" | "live" | "occupied";
}

export interface RoomScheduleView {
  sign: SignDetail;
  access: { state: "available" | "active"; selfAuthorized: boolean };
  /** set only for a meeting THIS viewer is invited to */
  context: ScheduledContext | null;
}

export interface Formatters {
  time(iso: string): string;
}

const label = (b: ScheduledBooking): string => b.title ?? "Private meeting";
const ms = (iso: string): number => Date.parse(iso);
const sameWindow = (a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }): boolean =>
  ms(a.startsAt) === ms(b.startsAt) && ms(a.endsAt) === ms(b.endsAt);

export function deriveRoomSchedule(
  bookingsIn: readonly ScheduledBooking[],
  live: LiveRoom,
  now: number,
  fmt: Formatters,
): RoomScheduleView {
  const bookings = bookingsIn.filter((b) => ms(b.endsAt) > now).sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  const inWindow = (b: ScheduledBooking) => ms(b.startsAt) - ACCESS_LEAD_MS <= now && now < ms(b.endsAt);
  const approaching = (b: ScheduledBooking) => ms(b.startsAt) - UPCOMING_MS <= now && now < ms(b.endsAt);
  const windowBooking = bookings.find(inWindow) ?? null;

  // THE LIVE SESSION'S BOOKING. Matched by window against what this viewer can see; a booking the
  // viewer's list does not hold (outside its fetch window) still carries its privacy — as a stranger.
  let session: ScheduledBooking | null = null;
  if (live.live) {
    if (live.booking === undefined) session = windowBooking; // no word from the server yet: assume the schedule
    else if (live.booking) {
      const b = live.booking;
      session = bookings.find((x) => sameWindow(x, b)) ?? { ...b, title: null, viewerIsInvitee: false };
    }
  }
  const governing = live.live ? session : windowBooking;
  const access = governing?.isPrivate
    ? { state: "active" as const, selfAuthorized: governing.viewerIsInvitee }
    : { state: "available" as const, selfAuthorized: false };

  // ---- the sign ----------------------------------------------------------------------------------
  let sign: SignDetail;
  if (live.live) {
    const pending = bookings.find((b) => b !== session && approaching(b) && !(session && sameWindow(b, session)));
    sign = {
      state: governing?.isPrivate ? "private" : "in-meeting",
      line2: pending
        ? `Next: ${label(pending)} · ${fmt.time(pending.startsAt)}`
        : session
          ? `${label(session)} · ${fmt.time(session.startsAt)}`
          : undefined,
    };
  } else if (windowBooking) {
    sign = {
      state: "starting",
      text: now < ms(windowBooking.startsAt) ? "Starting Soon" : "Ready to start",
      line2: `${label(windowBooking)} · ${fmt.time(windowBooking.startsAt)}`,
      sub: windowBooking.isPrivate ? "Private · DND" : undefined,
    };
  } else {
    const upcoming = bookings.find(approaching);
    sign = upcoming
      ? { state: "upcoming", line2: `${label(upcoming)} · ${fmt.time(upcoming.startsAt)}` }
      : { state: "available" };
  }

  // ---- the panel's context (the viewer's own meetings only) ------------------------------------
  let context: ScheduledContext | null = null;
  const asContext = (b: ScheduledBooking, phase: ScheduledContext["phase"]): ScheduledContext => ({
    title: label(b), startsAt: b.startsAt, endsAt: b.endsAt, isPrivate: b.isPrivate, phase,
  });
  if (live.live && session?.viewerIsInvitee) context = asContext(session, "live");
  else {
    const mine = bookings.find((b) => b.viewerIsInvitee && approaching(b));
    if (mine) context = asContext(mine, live.live ? "occupied" : inWindow(mine) ? "window" : "upcoming");
  }

  return { sign, access, context };
}
