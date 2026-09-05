import { getAuthToken } from "../api/client";

// REST client for Whiteboard W1/W2 (backend/app/routers/whiteboards.py). Same "chat backend"
// REST base (VITE_CHAT_SOCKET_URL) and the same dev-identity bypass as questsClient.ts. Access
// is the group conversation's: the server answers 403 for non-participants, and the client never
// sends an identity in the body — only the bearer token / dev header.

export interface WhiteboardSummary {
  id: string;
  conversationId: string;
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
