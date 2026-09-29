import { getAuthToken } from "../api/client";

// REST client for Scheduled Meetings V1 (backend/app/routers/scheduled_meetings.py). Same VO-backend
// base (VITE_CHAT_SOCKET_URL) and the same dev-identity bypass as notificationsClient.ts.
//
// ALL TIMES ON THE WIRE ARE UTC ISO strings ("…Z"). Local-time conversion happens only at the edges —
// services/meetings/meetingTime.ts builds them from the employee's own browser clock and formats them
// back; nothing here assumes a timezone.

export type InviteeResponse = "pending" | "accepted" | "declined";

export interface ScheduledMeeting {
  id: string;
  title: string;
  /** `floor-2/<slug>` — the Meeting Floor room id. */
  roomId: string;
  organizerEmail: string;
  startsAt: string;
  endsAt: string;
  isPrivate: boolean;
  status: "scheduled" | "cancelled" | "ended";
  invitees: { email: string; response: InviteeResponse }[];
  createdAt: string;
  updatedAt: string;
}

/** A booking as the whole floor may see it. For a private meeting the viewer is not invited to, the
 *  server has already nulled `id`, `title` and `organizerEmail`. */
export interface RoomBooking {
  id: string | null;
  roomId: string;
  startsAt: string;
  endsAt: string;
  isPrivate: boolean;
  title: string | null;
  organizerEmail: string | null;
  viewerIsInvitee: boolean;
}

export interface RoomAvailability {
  roomId: string;
  name: string;
  capacity: number;
  available: boolean;
}

export interface MeetingDraft {
  title: string;
  roomId: string;
  startsAt: string;
  endsAt: string;
  isPrivate: boolean;
  inviteeEmails: string[];
}

/** A failed request, with the server's status so callers can tell a 409 room clash from the rest. */
export class ScheduledMeetingsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ScheduledMeetingsError";
  }
}

function base(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for Scheduled Meetings — see .env.example.");
  return raw.replace(/\/+$/, "");
}

let devEmail: string | null = null;

/** DEV-ONLY identity bypass, seeded by useAuthGate exactly like every other VO-backend client. */
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

export function devIdentity(): string | null {
  return devEmail;
}

// Same one-shot-identity hazard notificationsClient.ts documents: a hot update would reset devEmail.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (devEmail) headers.set("x-dev-email", devEmail);
  else {
    const token = getAuthToken();
    if (!token) throw new ScheduledMeetingsError("Not signed in", 401);
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${base()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ScheduledMeetingsError(body?.error || `Scheduled meetings request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const fetchMine = (): Promise<ScheduledMeeting[]> => request("/scheduled-meetings/mine");

export const fetchFloorBookings = (from: string, to: string): Promise<RoomBooking[]> =>
  request(`/scheduled-meetings/rooms/today?${q({ from, to })}`);

export const fetchAvailability = (startsAt: string, endsAt: string): Promise<RoomAvailability[]> =>
  request(`/scheduled-meetings/rooms/availability?${q({ startsAt, endsAt })}`);

export const createMeeting = (draft: MeetingDraft): Promise<ScheduledMeeting> =>
  request("/scheduled-meetings", { method: "POST", body: JSON.stringify(draft) });

export const updateMeeting = (id: string, draft: Partial<MeetingDraft>): Promise<ScheduledMeeting> =>
  request(`/scheduled-meetings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(draft) });

export const cancelMeeting = (id: string): Promise<ScheduledMeeting> =>
  request(`/scheduled-meetings/${encodeURIComponent(id)}`, { method: "DELETE" });

export const respondToMeeting = (id: string, response: "accepted" | "declined"): Promise<ScheduledMeeting> =>
  request(`/scheduled-meetings/${encodeURIComponent(id)}/response`, { method: "PATCH", body: JSON.stringify({ response }) });

// PHASE 9C — the pre-meeting briefing for one UPCOMING booking (services/meeting_briefing.py). The server picks
// the related past Meeting Sessions and authorizes each on its own; a booking the viewer is not on is a 404.
// Everything here is as recorded: no status, cause, supersession or resolution is ever part of it.
export interface BriefingEvidence {
  speakerEmail: string;
  speakerName: string | null;
  startOffsetMs: number;
  text: string;
}

export interface BriefingEntry {
  itemId: string;
  /** The past Meeting Session that recorded it. */
  sessionId: string;
  at: string;
  text: string;
  reviewState: "suggested" | "confirmed" | "edited";
  /** From a receipt made before its transcript changed (every cited line is still current). */
  stale: boolean;
  evidence: BriefingEvidence[];
}

export interface BriefingDecision extends BriefingEntry {
  rationale: string | null;
  /** The decision's OWN recorded words state a change ("moving launch from Thursday to Friday"). */
  recordedChange: boolean;
}

export interface BriefingCommitment extends BriefingEntry {
  action: string | null;
  ownerEmail: string | null;
  deadline: string | null;
  /** The structured owner is the viewer. */
  isYours: boolean;
}

export interface BriefingOpenLoop extends BriefingEntry {
  kind: string | null;
  /** Every accessible meeting that recorded the same open item, oldest first; the entry is the latest. */
  recorded: { sessionId: string; itemId: string; at: string }[];
}

export interface BriefingSource {
  sessionId: string;
  title: string | null;
  relation: "same_booking" | "same_series";
  isPrivate: boolean;
  startedAt: string;
  endedAt: string;
  viewer: { attended: boolean };
  notes: "structured" | "nothing_useful" | "transcript_only" | "none";
  stale: boolean;
  review: "reviewed" | "partly" | "suggested" | null;
  /** Items left out because the lines they cited are no longer in the transcript. */
  omittedStale: number;
}

export interface MeetingBriefing {
  meeting: { id: string; title: string; roomId: string; startsAt: string; endsAt: string; isPrivate: boolean };
  available: boolean;
  sources: BriefingSource[];
  decisions: BriefingDecision[];
  commitments: BriefingCommitment[];
  openLoops: BriefingOpenLoop[];
  keyContext: BriefingEntry[];
}

export const fetchBriefing = (id: string): Promise<MeetingBriefing> =>
  request(`/scheduled-meetings/${encodeURIComponent(id)}/briefing`);

export const fetchBriefingAvailability = (ids: string[]): Promise<{ available: string[] }> =>
  request("/scheduled-meetings/briefings/availability", { method: "POST", body: JSON.stringify({ ids }) });
