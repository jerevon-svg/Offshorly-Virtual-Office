import { useEffect, useState, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import {
  cancelMeeting,
  createMeeting,
  devIdentity,
  fetchFloorBookings,
  fetchMine,
  respondToMeeting,
  setDevIdentity as setClientDevIdentity,
  updateMeeting,
  type MeetingDraft,
  type RoomBooking,
  type ScheduledMeeting,
} from "./scheduledMeetingsClient";
import { startOfLocalDay } from "./meetingTime";

// THE ONE client-side copy of Scheduled Meetings, in the same module-store idiom as
// notificationsStore.ts. Three things, all the server's:
//
//   mine      the viewer's own meetings (GET /scheduled-meetings/mine) — Upcoming Meetings reads it.
//   floor     every standing booking on the Meeting Floor from local midnight for 48 hours
//             (GET /rooms/today) — the door signs and room access read it. Private meetings the
//             viewer is not invited to arrive already redacted by the server.
//   presence  the server's meeting_presence broadcast, keyed by meeting id: whether a room's meeting
//             is live and WHICH booking (by public window) the live session belongs to.
//
// REALTIME: `scheduled_meetings_changed` carries nothing and means "re-ask" — so each client only ever
// holds what the server lets THIS identity see. Refetched too on connect, focus and `online`.
//
// OWN CONNECTION, like notificationsStore: it joins no rooms and emits nothing. It also hears
// meeting_presence (broadcast to every socket), which is what lets a door sign show "In Meeting"
// before the viewer has walked into any room — the call store only connects on demand.

export interface BookingWindow {
  startsAt: string;
  endsAt: string;
  isPrivate: boolean;
}

export interface RoomPresence {
  live: boolean;
  /** The booking the live session belongs to, or null for an unbooked (ad-hoc) session. */
  booking: BookingWindow | null;
}

export interface ScheduledMeetingsSnapshot {
  mine: ScheduledMeeting[];
  floor: RoomBooking[];
  presence: Readonly<Record<string, RoomPresence>>;
  loading: boolean;
  error: string | null;
  /** Bumped on every server change the viewer should notice (lets open forms re-check availability). */
  revision: number;
}

const EMPTY: ScheduledMeetingsSnapshot = { mine: [], floor: [], presence: {}, loading: true, error: null, revision: 0 };

let snapshot: ScheduledMeetingsSnapshot = EMPTY;
let socketInstance: Socket | null = null;
let inflight: Promise<void> | null = null;
let again = false;
const listeners = new Set<() => void>();

function set(next: Partial<ScheduledMeetingsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getScheduledMeetingsSnapshot(): ScheduledMeetingsSnapshot {
  return snapshot;
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

/** Seeds the REST client and this store's socket identity together. */
export function setDevIdentity(email: string | null): void {
  setClientDevIdentity(email);
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

function floorWindow(): { from: string; to: string } {
  const from = startOfLocalDay(new Date());
  return { from: from.toISOString(), to: new Date(from.getTime() + 48 * 3_600_000).toISOString() };
}

/** Re-asks the server. Coalesced; a request that arrives mid-flight schedules exactly one more. */
export function refreshScheduledMeetings(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  const { from, to } = floorWindow();
  inflight = Promise.all([fetchMine(), fetchFloorBookings(from, to)])
    .then(([mine, floor]) => set({ mine, floor, loading: false, error: null, revision: snapshot.revision + 1 }))
    .catch((err: unknown) => set({ loading: false, error: err instanceof Error ? err.message : "Couldn't load meetings" }))
    .finally(() => {
      inflight = null;
      if (again) {
        again = false;
        void refreshScheduledMeetings();
      }
    });
  return inflight;
}

function onPresence(payload: { meetings?: { meetingId: string; participants: string[]; booking?: BookingWindow | null }[] } | undefined): void {
  const next: Record<string, RoomPresence> = {};
  for (const m of payload?.meetings ?? []) {
    next[m.meetingId] = { live: m.participants.length > 0, booking: m.booking ?? null };
  }
  set({ presence: next });
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for Scheduled Meetings — see .env.example.");
  return raw.replace(/\/+$/, "");
}

function ensureSocket(): void {
  if (socketInstance) return;
  const dev = devIdentity();
  if (!dev && !getAuthToken()) return;
  const socket = io(socketBase(), { auth: dev ? { "x-dev-email": dev } : { token: getAuthToken() }, autoConnect: true });
  socket.on("scheduled_meetings_changed", () => void refreshScheduledMeetings());
  socket.on("meeting_presence", onPresence);
  socket.on("connect", () => void refreshScheduledMeetings());
  socketInstance = socket;
}

// ---- actions — every one re-asks afterwards (the socket nudge would too; the two coalesce) ----------

/** Applies the server's own answer to the list at once (so Upcoming updates the moment Save returns),
 *  then re-asks for everything else it may have moved — the floor, other rooms' availability. */
async function after(p: Promise<ScheduledMeeting>): Promise<ScheduledMeeting> {
  const out = await p;
  const rest = snapshot.mine.filter((m) => m.id !== out.id);
  const mine = out.status === "scheduled" ? [...rest, out].sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt)) : rest;
  set({ mine });
  void refreshScheduledMeetings();
  return out;
}

export const scheduleMeeting = (draft: MeetingDraft) => after(createMeeting(draft));
export const editMeeting = (id: string, draft: Partial<MeetingDraft>) => after(updateMeeting(id, draft));
export const cancelScheduledMeeting = (id: string) => after(cancelMeeting(id));
export const respondToScheduledMeeting = (id: string, response: "accepted" | "declined") =>
  after(respondToMeeting(id, response));

/** Subscribable hook. Connects and fetches on first mount; re-fetches on focus and `online`. */
export function useScheduledMeetings(): ScheduledMeetingsSnapshot {
  useEffect(() => {
    ensureSocket();
    void refreshScheduledMeetings();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshScheduledMeetings();
    };
    const onOnline = () => void refreshScheduledMeetings();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return useSyncExternalStore(subscribe, getScheduledMeetingsSnapshot, getScheduledMeetingsSnapshot);
}

/** A clock for time-driven UI (Upcoming → Starting Soon → …): re-renders every `ms`. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

// Test-only: module state outlives a single test.
export function resetScheduledMeetingsStoreForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  inflight = null;
  again = false;
  snapshot = EMPTY;
  setClientDevIdentity(null);
}

export function __setSnapshotForTests(next: Partial<ScheduledMeetingsSnapshot>): void {
  set(next);
}
