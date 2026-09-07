import { getAuthToken } from "../api/client";

// REST client for Whiteboard W1/W2 + W4 (backend/app/routers/whiteboards.py). Same "chat backend"
// REST base (VITE_CHAT_SOCKET_URL) and the same dev-identity bypass as questsClient.ts. A board
// lives in exactly one scope: a conversation (access is the conversation's — the server answers
// 403 for non-participants) or an office room (open to every signed-in office user). The client
// never sends an identity in the body — only the bearer token / dev header.

/** Where a set of boards lives. `room` ids are the flat room ids OfficeMap already uses for room
 * presence / room requests (office-layout.ts `rooms[]`), or OFFICE_ROOM_ID for the whole office. */
export type WhiteboardScope =
  | { kind: "conversation"; id: string }
  | { kind: "room"; id: string };

/** Server-defined sentinel room id for the office-wide board set (W4). */
export const OFFICE_ROOM_ID = "office";

export interface WhiteboardSummary {
  id: string;
  // Exactly one of these is set — see WhiteboardScope.
  conversationId: string | null;
  roomId: string | null;
  title: string;
  version: number;
  createdByEmail: string;
  updatedByEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface Whiteboard extends WhiteboardSummary {
  // Opaque editor document (see whiteboardDocument.ts for the Excalidraw shape); null until the
  // first save. Boards saved by the previous tldraw editor still hold its snapshot shape.
  document: Record<string, unknown> | null;
}

/** PUT /whiteboards/{id} answered 409: someone saved a newer version since this board was
 * loaded. The caller must reload the board (fresh document + version) before saving again. */
export class WhiteboardConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhiteboardConflictError";
  }
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for Whiteboards — see .env.example.");
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY: mirrors questsClient.ts's devEmail/setDevIdentity exactly (seeded by useAuthGate).
let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

/** The seeded dev-bypass identity, shared with whiteboardSyncClient.ts so the realtime socket
 * authenticates exactly like the REST calls do — one copy of this state, not two. */
export function getDevIdentity(): string | null {
  return devEmail;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${socketBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error || body?.detail || `Whiteboard request failed (${res.status})`;
    if (res.status === 409) throw new WhiteboardConflictError(message);
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** GET /conversations/{id}/whiteboards — summaries (no document), newest first. */
export function listWhiteboards(conversationId: string): Promise<WhiteboardSummary[]> {
  return request(`/conversations/${encodeURIComponent(conversationId)}/whiteboards`);
}

/** POST /conversations/{id}/whiteboards — a new empty board; returns the full board (version 1). */
export function createWhiteboard(conversationId: string, title: string): Promise<Whiteboard> {
  return request(`/conversations/${encodeURIComponent(conversationId)}/whiteboards`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

/** GET /rooms/{roomId}/whiteboards — room / office boards (W4), summaries newest first. */
export function listRoomWhiteboards(roomId: string): Promise<WhiteboardSummary[]> {
  return request(`/rooms/${encodeURIComponent(roomId)}/whiteboards`);
}

/** POST /rooms/{roomId}/whiteboards — a new empty room / office board (version 1). */
export function createRoomWhiteboard(roomId: string, title: string): Promise<Whiteboard> {
  return request(`/rooms/${encodeURIComponent(roomId)}/whiteboards`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

/** Scope-dispatching list — the panel's one entry point for either scope. */
export function listWhiteboardsIn(scope: WhiteboardScope): Promise<WhiteboardSummary[]> {
  return scope.kind === "room" ? listRoomWhiteboards(scope.id) : listWhiteboards(scope.id);
}

/** Scope-dispatching create. */
export function createWhiteboardIn(scope: WhiteboardScope, title: string): Promise<Whiteboard> {
  return scope.kind === "room" ? createRoomWhiteboard(scope.id, title) : createWhiteboard(scope.id, title);
}

/** GET /whiteboards/{id} — full board including its document. */
export function getWhiteboard(boardId: string): Promise<Whiteboard> {
  return request(`/whiteboards/${encodeURIComponent(boardId)}`);
}

/** PUT /whiteboards/{id} — `version` is the version the caller LOADED; the server bumps it on
 * success and rejects a stale one with 409 (WhiteboardConflictError). */
export function saveWhiteboard(
  boardId: string,
  document: Record<string, unknown>,
  version: number,
): Promise<Whiteboard> {
  return request(`/whiteboards/${encodeURIComponent(boardId)}`, {
    method: "PUT",
    body: JSON.stringify({ document, version }),
  });
}
