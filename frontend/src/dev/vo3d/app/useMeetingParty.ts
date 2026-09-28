// vo3d app — SCHEDULED MEETINGS × GO TOGETHER: the one place the two meet, so neither depends on the other.
//
// Go Together knows nothing about meetings: its destination is generic (app/goTogether.ts) and a meeting is
// just what fills it — the room, its floor, a label, and `context: {kind: "scheduled_meeting", id}`. This
// hook owns that translation in both directions:
//
//   • destinationFor(meeting)  the party destination for a meeting's room
//   • attendeesOf(meeting)     who may be invited: the organizer and every invitee who has not declined
//   • the LEADER'S GUARD       while leading a party to a meeting, the live meeting decides: cancelled,
//                              declined or gone → End the party; moved to another room → re-point it
//                              (the controller re-routes the walk). Followers need nothing — they follow.
//   • INSTANT MEETINGS         the same journey for an unscheduled meeting in a room (`instantTarget`):
//                              destination = that room, candidates = the people the live occurrence expects
//                              who are not in it yet (server `invited`), context {kind: "instant_meeting"}.
//
// CANDIDATES NEVER INCLUDE SOMEBODY ALREADY IN THE MEETING: the host is not walked out of the room to
// rendezvous, and a late arrival never pulls people out of a meeting to collect them.
import { useEffect, useRef } from "react";
import type { PartyDestination } from "./goTogether";
import type { ScheduledMeeting } from "../../../services/meetings/scheduledMeetingsClient";
import { useCallState, type MeetingEntry } from "../../../services/call/callStore";
import { useScheduledMeetings } from "../../../services/meetings/scheduledMeetingsStore";
import { leaveParty, setPartyDestination, useTravelParty } from "../../../services/party/travelPartyStore";

export const MEETING_CONTEXT = "scheduled_meeting";
export const INSTANT_MEETING_CONTEXT = "instant_meeting";

/** What the Go Together picker is opened for: where the journey goes, and who may be invited on it. */
export interface GoTogetherTarget {
  destination: PartyDestination;
  candidates: ReadonlySet<string>;
}

const norm = (e: string): string => e.trim().toLowerCase();

const roomName = (roomId: string): string => {
  const slug = roomId.split("/")[1] ?? roomId;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
};

export function destinationFor(m: ScheduledMeeting): PartyDestination {
  return {
    // every bookable room is on the Meeting Floor (rooms/floor2Meeting)
    floor: "floor-2",
    roomId: m.roomId,
    label: `${m.title} · ${roomName(m.roomId)}`.slice(0, 80),
    context: { kind: MEETING_CONTEXT, id: m.id },
  };
}

export function attendeesOf(m: ScheduledMeeting, selfId: string): Set<string> {
  const out = new Set<string>([m.organizerEmail.trim().toLowerCase()]);
  for (const i of m.invitees) if (i.response !== "declined") out.add(i.email.trim().toLowerCase());
  out.delete(selfId);
  return out;
}

/** A scheduled meeting's journey: its attendees, minus anybody already in its live meeting. */
export function scheduledTarget(m: ScheduledMeeting, selfId: string, live: MeetingEntry | undefined): GoTogetherTarget {
  const candidates = attendeesOf(m, selfId);
  for (const p of live?.participants ?? []) candidates.delete(norm(p));
  return { destination: destinationFor(m), candidates };
}

/** An instant meeting's journey: the room it is in, and the people it expects who have not arrived. */
export function instantTarget(meetingId: string, roomId: string, roomLabel: string, live: MeetingEntry, selfId: string): GoTogetherTarget {
  const present = new Set(live.participants.map(norm));
  const candidates = new Set((live.invited ?? []).map(norm).filter((e) => !present.has(e) && e !== norm(selfId)));
  return {
    destination: { floor: "floor-2", roomId, label: `Meeting · ${roomLabel}`.slice(0, 80), context: { kind: INSTANT_MEETING_CONTEXT, id: meetingId } },
    candidates,
  };
}

export function useMeetingPartyGuard(selfId: string): void {
  const call = useCallState();
  const schedule = useScheduledMeetings();
  const tp = useTravelParty();
  useEffect(() => {
    const party = tp.party;
    const ctx = party?.destination.context;
    if (!party || party.leaderEmail !== selfId || ctx?.kind !== MEETING_CONTEXT) return;
    if (schedule.loading || schedule.error) return; // never end a party on a failed fetch
    const m = schedule.mine.find((x) => x.id === ctx.id);
    const me = m?.invitees.find((i) => i.email === selfId);
    const declined = m && m.organizerEmail.trim().toLowerCase() !== selfId && (!me || me.response === "declined");
    if (!m || m.status !== "scheduled" || declined) {
      leaveParty();
      return;
    }
    if (m.roomId !== party.destination.roomId) setPartyDestination(destinationFor(m));
  }, [schedule.mine, schedule.loading, schedule.error, tp.party, selfId]);
  // …and an INSTANT meeting the leader is taking people to: once it is no longer running, there is nothing
  // to go to. Only after it has been SEEN running for this party (never on an empty first snapshot).
  const seenInstant = useRef<string | null>(null);
  useEffect(() => {
    const party = tp.party;
    const ctx = party?.destination.context;
    if (!party || party.leaderEmail !== selfId || ctx?.kind !== INSTANT_MEETING_CONTEXT) { seenInstant.current = null; return; }
    const running = call.meetings.some((m) => m.meetingId === ctx.id && m.live !== false);
    if (running) seenInstant.current = `${party.partyId}:${ctx.id}`;
    else if (seenInstant.current === `${party.partyId}:${ctx.id}`) leaveParty();
  }, [call.meetings, tp.party, selfId]);
}
