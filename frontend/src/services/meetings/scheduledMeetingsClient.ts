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
  status: "scheduled" | "cancelled";
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
