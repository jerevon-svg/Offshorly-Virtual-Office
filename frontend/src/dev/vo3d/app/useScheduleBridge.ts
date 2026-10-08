// vo3d app — THE SCHEDULE BRIDGE: the scheduled-meetings store → the world's Meeting Floor.
//
// The store holds the server's answer for this identity (the floor's bookings, already redacted, and the
// meeting_presence facts); the world owns the signs, the doors and the in-room panel. This hook only
// regroups one into the other — per room id — and re-pushes on a 15-second clock so time-driven states
// (Upcoming → Starting Soon → Available) advance with nobody touching anything. It decides nothing:
// app/scheduledRooms.ts does, inside the world.
import { useEffect, useMemo } from "react";
import type { Vo3dWorld } from "./world";
import type { LiveRoom, ScheduledBooking } from "./scheduledRooms";
import { useNow, useScheduledMeetings } from "../../../services/meetings/scheduledMeetingsStore";
import { formatTime } from "../../../services/meetings/meetingTime";

const FMT = { time: formatTime };

/** Pushes the schedule into the world while it is ready. Returns how many of the viewer's meetings are
 *  still waiting for their reply (the dock tile's badge). */
export function useScheduleBridge(worldRef: { current: Vo3dWorld | null }, ready: boolean, selfId: string): number {
  const store = useScheduledMeetings();
  const now = useNow(15_000);

  const rooms = useMemo(() => {
    const out: Record<string, { bookings: ScheduledBooking[]; live?: LiveRoom }> = {};
    for (const b of store.floor) {
      (out[b.roomId] ??= { bookings: [] }).bookings.push({
        startsAt: b.startsAt, endsAt: b.endsAt, isPrivate: b.isPrivate, title: b.title, viewerIsInvitee: b.viewerIsInvitee,
      });
    }
    // Every Meeting Floor room's live facts, by its meeting id `mf-<slug>`. A room the broadcast does not
    // mention is not live — its session is empty — so it is not left "unknown".
    for (const r of worldRef.current?.meetingRooms?.list() ?? []) {
      const p = store.presence[`mf-${r.id.split("/")[1]}`];
      (out[r.id] ??= { bookings: [] }).live = p ? { live: p.live, booking: p.booking } : { live: false, booking: null };
    }
    return out;
    // `ready` re-runs this once the world (and so its room list) exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.floor, store.presence, ready]);

  useEffect(() => {
    if (!ready) return;
    worldRef.current?.meetingRooms?.setSchedule(rooms, FMT);
  }, [ready, rooms, now, worldRef]);

  return useMemo(
    () =>
      store.mine.filter(
        (m) => m.organizerEmail !== selfId && Date.parse(m.endsAt) > now
          && m.invitees.some((i) => i.email === selfId && i.response === "pending"),
      ).length,
    [store.mine, selfId, now],
  );
}
