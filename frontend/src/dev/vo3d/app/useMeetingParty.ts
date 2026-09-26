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
import { useEffect } from "react";
import type { PartyDestination } from "./goTogether";
import type { ScheduledMeeting } from "../../../services/meetings/scheduledMeetingsClient";
import { useScheduledMeetings } from "../../../services/meetings/scheduledMeetingsStore";
import { leaveParty, setPartyDestination, useTravelParty } from "../../../services/party/travelPartyStore";

export const MEETING_CONTEXT = "scheduled_meeting";

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

export function useMeetingPartyGuard(selfId: string): void {
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
}
