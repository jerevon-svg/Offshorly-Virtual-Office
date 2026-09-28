import { getAuthToken } from "../api/client";
import { devIdentity } from "./scheduledMeetingsClient";

// PHASE 7C — REST client for a Meeting Receipt: the Meeting Session's own reads
// (backend/app/routers/meeting_sessions.py). Everything is keyed by the Meeting Session id, never the room.
// The server gates every call with meeting_access: an unauthorized caller gets the same 404 as a missing
// session, and review/generate need the narrower curate authority (403 otherwise). Same VO-backend base and
// the same dev-identity seam as the scheduled-meetings client (useAuthGate seeds it there).

export type ReviewState = "suggested" | "confirmed" | "edited" | "rejected";
export type ItemType = "summary" | "topic" | "decision" | "commitment" | "open_loop" | "key_point";
export type ConfidenceLevel = "high" | "medium" | null;

export interface Evidence {
  segmentId: string;
  captureId: string;
  position: number;
  speakerEmail: string;
  speakerName: string | null;
  startOffsetMs: number;
  endOffsetMs: number;
  revision: number;
  text: string;
}

/** Item content as the Phase 7B contract defines it; every value is a string, owner/deadline may be null. */
export type ItemContent = Record<string, string | null>;

export interface IntelligenceItem {
  itemId: string;
  type: ItemType;
  position: number;
  origin: string;
  content: ItemContent;
  confidence: number | null;
  confidenceLevel: ConfidenceLevel;
  uncertainty: string | null;
  reviewState: ReviewState;
  reviewedContent: ItemContent | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  evidence: Evidence[];
}

export interface RunSummary {
  runId: string;
  sessionId: string;
  version: number;
  status: "running" | "succeeded" | "failed";
  generator: string;
  requestedBy: string;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
}

export interface RunDetail extends RunSummary {
  sourceSegmentIds: string[];
  items: IntelligenceItem[];
}

export interface LatestIntelligence {
  sessionId: string;
  run: RunDetail | null;
  stale: boolean;
}

export interface RunList {
  sessionId: string;
  latestRunId: string | null;
  runs: RunSummary[];
}

export interface Attendee {
  email: string;
  joinedAt: string;
  leftAt: string | null;
  presentMs: number;
  intervals: { joinedAt: string; leftAt: string | null }[];
}

export interface MeetingSessionInfo {
  sessionId: string;
  kind: "scheduled" | "instant";
  isPrivate: boolean;
  roomId: string | null;
  title: string | null;
  planned: { startsAt: string; endsAt: string; organizerEmail: string } | null;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  startedBy: string;
  attendees: Attendee[];
  viewer: { mayCurate: boolean };
}

export interface RecentSession {
  sessionId: string;
  kind: "scheduled" | "instant";
  isPrivate: boolean;
  roomId: string | null;
  title: string | null;
  startedAt: string;
  endedAt: string;
  attendeeCount: number;
  hasIntelligence: boolean;
}

export type ReviewAction = "confirm" | "edit" | "reject";

export class ReceiptError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ReceiptError";
  }
}

function base(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for Meeting Receipts — see .env.example.");
  return raw.replace(/\/+$/, "");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const dev = devIdentity();
  if (dev) headers.set("x-dev-email", dev);
  else {
    const token = getAuthToken();
    if (!token) throw new ReceiptError("Not signed in", 401);
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${base()}/meeting-sessions${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ReceiptError(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

const id = (s: string) => encodeURIComponent(s);

export const fetchRecentSessions = (): Promise<{ sessions: RecentSession[] }> => request("/recent");

export const fetchSession = (sessionId: string): Promise<MeetingSessionInfo> => request(`/${id(sessionId)}`);

export const fetchLatest = (sessionId: string): Promise<LatestIntelligence> =>
  request(`/${id(sessionId)}/intelligence/latest`);

export const fetchRuns = (sessionId: string): Promise<RunList> => request(`/${id(sessionId)}/intelligence/runs`);

export const generateIntelligence = (sessionId: string): Promise<RunDetail> =>
  request(`/${id(sessionId)}/intelligence/runs`, { method: "POST" });

export const reviewItem = (
  sessionId: string,
  itemId: string,
  action: ReviewAction,
  content?: ItemContent,
): Promise<IntelligenceItem> =>
  request(`/${id(sessionId)}/intelligence/items/${id(itemId)}/review`, {
    method: "POST",
    body: JSON.stringify(content ? { action, content } : { action }),
  });
