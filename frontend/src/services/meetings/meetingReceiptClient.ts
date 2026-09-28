import { getAuthToken } from "../api/client";
import { devIdentity } from "./scheduledMeetingsClient";

// PHASE 7C — REST client for a Meeting Receipt (and, PHASE 8A, the Meeting Memory list it is found from): the Meeting Session's own reads
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

// PHASE 8A — one Meeting Memory row: an ended Meeting Session the server already let this caller read.
export interface MemoryPreviewLine {
  text: string | null;
  reviewState: ReviewState;
}

/** The latest succeeded run, active items only, with the Receipt's effective-content rule applied. */
export interface MemoryPreview {
  runVersion: number;
  generatedAt: string | null;
  stale: boolean;
  summary: MemoryPreviewLine | null;
  decisions: MemoryPreviewLine[];
  counts: { decisions: number; commitments: number; openLoops: number };
  reviewedCount: number;
  activeCount: number;
}

export type MemoryMatch =
  | { kind: "title" }
  | { kind: "room" }
  | { kind: "attendee"; email: string }
  | { kind: "intelligence"; itemType: ItemType; reviewState: ReviewState; text: string | null };

export interface MemorySession {
  sessionId: string;
  kind: "scheduled" | "instant";
  isPrivate: boolean;
  roomId: string | null;
  title: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  attendeeCount: number;
  viewer: { attended: boolean };
  intelligence: MemoryPreview | null;
  match: MemoryMatch | null;
}

export type MemoryFilter = "all" | "attended" | "absent";

export interface MemoryPage {
  sessions: MemorySession[];
  nextCursor: string | null;
}

export interface MemoryQuery {
  q?: string;
  filter?: MemoryFilter;
  /** Room CONTEXT only (a narrowing inside what the caller may already read) — the room grants nothing. */
  roomId?: string;
  cursor?: string | null;
  limit?: number;
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

export function fetchMemory(query: MemoryQuery = {}): Promise<MemoryPage> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.filter && query.filter !== "all") params.set("filter", query.filter);
  if (query.roomId) params.set("roomId", query.roomId);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return request(`/memory${qs ? `?${qs}` : ""}`);
}

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

// PHASE 8B — Meeting Twin: one grounded question about ONE Meeting Session. Same gate and 404 as every read
// here; `history` is the open view's last few turns, sent as referent context only (the server never stores
// it and never treats it as evidence). Evidence is always transcript lines of this session.
export interface TwinEvidence {
  segmentId: string;
  speakerEmail: string;
  speakerName: string | null;
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
}

/** A receipt interpretation the answer leaned on: a human's reading (edited/confirmed) or a VO suggestion. */
export interface TwinBasis {
  type: ItemType;
  reviewState: Exclude<ReviewState, "rejected">;
  text: string | null;
  stale: boolean;
}

export interface TwinAnswer {
  sessionId: string;
  status: "grounded" | "insufficient";
  answer: string;
  uncertainty: string | null;
  evidence: TwinEvidence[];
  basis: TwinBasis[];
  intelligence: "none" | "current" | "stale";
}

export interface TwinTurnContext {
  question: string;
  answer: string;
}

export const askTwin = (sessionId: string, question: string, history: TwinTurnContext[] = []): Promise<TwinAnswer> =>
  request(`/${id(sessionId)}/twin/query`, { method: "POST", body: JSON.stringify({ question, history }) });
