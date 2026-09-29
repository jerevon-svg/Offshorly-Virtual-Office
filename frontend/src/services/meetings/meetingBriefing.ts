import { useEffect, useState } from "react";
import {
  fetchBriefing,
  fetchBriefingAvailability,
  ScheduledMeetingsError,
  type MeetingBriefing,
} from "./scheduledMeetingsClient";

// PHASE 9C — PRE-MEETING BRIEFING state. The server decides which past meetings relate and which the viewer may
// read (services/meeting_briefing.py); these only hold its answer. Local to the Meetings panel — no global store.

/** Which of these upcoming bookings have a briefing worth opening. Refetched when the schedule changes;
 *  a failure just hides the affordance (the Upcoming list stands on its own). */
export function useBriefingAvailability(ids: string[], revision: number): ReadonlySet<string> {
  const [available, setAvailable] = useState<ReadonlySet<string>>(new Set());
  const key = ids.join(",");
  useEffect(() => {
    if (!key) {
      setAvailable(new Set());
      return;
    }
    let live = true;
    fetchBriefingAvailability(key.split(","))
      .then((r) => live && setAvailable(new Set(r.available)))
      .catch(() => live && setAvailable(new Set()));
    return () => {
      live = false;
    };
  }, [key, revision]);
  return available;
}

export type BriefingState =
  | { status: "loading" }
  | { status: "ready"; briefing: MeetingBriefing }
  | { status: "missing" }
  | { status: "failed" };

export function useMeetingBriefing(meetingId: string): BriefingState {
  const [state, setState] = useState<BriefingState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    fetchBriefing(meetingId)
      .then((briefing) => live && setState({ status: "ready", briefing }))
      .catch((err) =>
        live && setState({ status: err instanceof ScheduledMeetingsError && err.status === 404 ? "missing" : "failed" }));
    return () => {
      live = false;
    };
  }, [meetingId]);
  return state;
}

/** A person's name as the briefing says it — "You" for the viewer's own structured commitments only. */
export const ownerLabel = (c: { isYours: boolean; ownerEmail: string | null }, resolve: (email: string) => string) =>
  c.isYours ? "You" : c.ownerEmail ? resolve(c.ownerEmail) : "No owner recorded";
