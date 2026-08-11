import { avatarIdForEmail } from "../../data/avatarIdentity";
import {
  FALLBACK_ROOM_ID,
  roomIdForAtlasRoom,
  roomIdForPerson,
} from "../../data/roomIdentity";
import type { FloorPerson, LastMessage, Presence, PresenceStatusValue } from "./types";

// Combines Atlas's two roster feeds into the one list the canvas renders.
//
// WHY TWO SOURCES — this is the part that is easy to get wrong, and the
// failure is silent (half the company simply missing from the floor):
//
//   /floor    has a row for EVERY active employee, including people who
//             have never checked in. Point-in-time snapshot, not live.
//   /presence has a row only for someone who has had a presence EVENT at
//             least once, ever — but it is the live, SSE-updated source of
//             truth for status / room / activity.
//
// So /floor supplies the roster and the home-desk fallback; a matching
// /presence row (by email) overrides the live fields. Either one alone
// gives a wrong floor. Ported from Atlas's own office-floor-merge.ts, which
// solved this first.
//
// Pure functions on purpose — no fetching, no React — so the placement
// rules are testable without a backend.

export interface OfficePerson {
  email: string;
  displayName: string;
  status: PresenceStatusValue;
  departmentName: string | null;
  jobTitle: string | null;
  currentActivity: string | null;
  lastMessage: LastMessage | null;
  /** Sprite to draw, from the identity join. */
  avatarId: string;
  /** Hand-drawn room to draw them in. Never null — see resolveRoomId. */
  roomId: string;
  /** Atlas's room id, retained even when it has no canvas twin, so the
   *  sidebar can show "in #some-cliq-channel" for someone drawn at their
   *  desk. Null when they are not in any Atlas room. */
  atlasRoomId: string | null;
  /** True when they are in an Atlas room with no hand-drawn twin — i.e.
   *  a PROJECT/CLIQ_CHANNEL room. Drives the "elsewhere" indicator. */
  inEphemeralRoom: boolean;
}

// Which hand-drawn room a person is rendered in.
//
// Mirrors Atlas's resolveRenderRoomId: a live room only counts while
// ONLINE, so someone OFFLINE or ON_LEAVE is drawn greyed at their home
// desk rather than left in whatever room they were last seen in. The extra
// step here is that Atlas's live room may have no canvas twin, in which
// case we still fall back to the desk — being drawn at your desk with an
// "elsewhere" marker beats vanishing from the floor.
export function resolveRoomId(
  status: PresenceStatusValue,
  currentRoomId: string | null,
  departmentName: string | null,
  email: string | null = null,
): { roomId: string; inEphemeralRoom: boolean } {
  const deskRoomId = roomIdForPerson(email, departmentName);

  if (status === "ONLINE" && currentRoomId) {
    const liveRoomId = roomIdForAtlasRoom(currentRoomId);
    if (liveRoomId) return { roomId: liveRoomId, inEphemeralRoom: false };
    // Online, but in a room this canvas cannot draw.
    return { roomId: deskRoomId ?? FALLBACK_ROOM_ID, inEphemeralRoom: true };
  }

  return { roomId: deskRoomId ?? FALLBACK_ROOM_ID, inEphemeralRoom: false };
}

// Emails are not reliably case-consistent between Zoho, Cliq and Atlas, so
// the join key is lowercased on both sides. Matching on the raw string
// loses people whose two systems disagree on capitalization.
function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function mergeFloorWithPresence(
  floor: FloorPerson[],
  presence: Presence[],
): OfficePerson[] {
  const presenceByEmail = new Map<string, Presence>();
  for (const row of presence) {
    presenceByEmail.set(emailKey(row.user_email), row);
  }

  return floor.map((person) => {
    const live = presenceByEmail.get(emailKey(person.user_email));

    // /presence wins on the live fields; /floor wins on identity and the
    // home-desk fallback. Note department_name is taken from /floor even
    // when a presence row exists — both carry it, and /floor is the
    // roster-authoritative source.
    const status = live?.status ?? person.status;
    const currentRoomId = live?.current_room_id ?? person.current_room_id;
    const currentActivity = live?.current_activity ?? person.current_activity;

    const { roomId, inEphemeralRoom } = resolveRoomId(
      status,
      currentRoomId,
      person.department_name,
      person.user_email,
    );

    return {
      email: person.user_email,
      displayName: person.display_name,
      status,
      departmentName: person.department_name,
      jobTitle: person.job_title ?? live?.job_title ?? null,
      currentActivity,
      lastMessage: live?.last_message ?? person.last_message ?? null,
      avatarId: avatarIdForEmail(person.user_email),
      roomId,
      atlasRoomId: currentRoomId,
      inEphemeralRoom,
    };
  });
}

// Convenience for the canvas, which draws room by room.
export function groupByRoomId(people: OfficePerson[]): Map<string, OfficePerson[]> {
  const byRoom = new Map<string, OfficePerson[]>();
  for (const person of people) {
    const existing = byRoom.get(person.roomId);
    if (existing) existing.push(person);
    else byRoom.set(person.roomId, [person]);
  }
  return byRoom;
}
