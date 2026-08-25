import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// REST + Socket.IO client for the "Ask to Join + Group Conversation" request flow
// (backend/app/routers/requests.py, backend/app/repositories/requests.py).
//
// Opens its OWN connection to the same realtime backend RealChatService.ts talks to (same
// VITE_CHAT_SOCKET_URL base, same Atlas bearer token) rather than reusing RealChatService's —
// RealChatService keeps its socket entirely private (no getter), and this module follows the
// same precedent already established by frontend/src/services/presence/offlineLineupClient.ts
// and spatialSessionStore.ts for exactly that reason. python-socketio's ASGI server supports
// any number of concurrent sockets per authenticated user, so this costs one extra
// connection, not a second server or auth path.
//
// Module-store + useSyncExternalStore pattern mirrors offlineLineupClient.ts/
// spatialSessionStore.ts for consistency with the rest of the presence/chat-adjacent system.

export interface RequestOut {
  id: string;
  kind: string;
  conversationId: string | null;
  requesterEmail: string;
  state: string;
  resolverEmail: string | null;
  resultConversationId: string | null;
  payload: Record<string, unknown> | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the requests feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

async function restFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${socketBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Requests backend request failed (${res.status}) for ${path}`);
  }
  return res;
}

let socketInstance: Socket | null = null;
let pending: RequestOut[] = [];
const listeners = new Set<() => void>();
const resolvedListeners = new Set<(req: RequestOut) => void>();
// DEV-ONLY: mirrors RealChatService.ts's devEmail/setDevIdentity exactly — when set, this
// module's socket/REST calls authenticate via the backend's `x-dev-email` bypass instead of
// the real Atlas bearer token. Only ever set by the dev-only auth-gate bypass (see
// useAuthGate.ts's seedDevBypassIdentity) — never touched by the normal app.
let devEmail: string | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): RequestOut[] {
  return pending;
}

function removeFromPending(id: string): void {
  const next = pending.filter((r) => r.id !== id);
  if (next.length === pending.length) return;
  pending = next;
  notify();
}

// DEV-ONLY: switches this module's connection to the backend's dev-email bypass (or back to
// normal token auth when passed null). Tears down any live socket so the next call reconnects
// with the new identity. Mirrors RealChatService.ts's setDevIdentity exactly.
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

function ensureSocket(): Socket | null {
  if (socketInstance) return socketInstance;

  if (!devEmail && !getAuthToken()) return null;

  const auth: Record<string, string | null> = devEmail
    ? { "x-dev-email": devEmail }
    : { token: getAuthToken() };
  const socket = io(socketBase(), {
    auth,
    autoConnect: true,
  });

  socket.on("request_created", (payload: RequestOut) => {
    if (!payload || pending.some((r) => r.id === payload.id)) return;
    pending = [...pending, payload];
    notify();
  });

  socket.on("request_resolved", (payload: RequestOut) => {
    if (!payload) return;
    removeFromPending(payload.id);
    resolvedListeners.forEach((cb) => cb(payload));
  });

  socket.on("request_cancelled", (payload: RequestOut) => {
    if (!payload) return;
    removeFromPending(payload.id);
  });

  socketInstance = socket;
  return socket;
}

// Fetches the initial pending-requests snapshot (GET /requests/pending) and ensures the
// socket connection is open for live push updates. Safe to call from multiple mounted
// consumers — each call just re-fetches/re-notifies, no duplicate connections (ensureSocket
// is idempotent).
async function refreshPending(): Promise<void> {
  ensureSocket();
  const res = await restFetch("/requests/pending");
  pending = await res.json();
  notify();
}

/** Subscribable hook giving components the current list of pending requests that target a
 * conversation this signed-in user participates in (see list_pending_for_participant).
 * Fetches the initial snapshot on first mount, then stays live via request_created/
 * request_resolved/request_cancelled pushes. */
export function usePendingRequests(): RequestOut[] {
  useEffect(() => {
    void refreshPending();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getPendingRequestsSnapshot(): RequestOut[] {
  return pending;
}

/** Subscribes to every request_resolved event this signed-in user's own socket receives —
 * per the backend's routing (sio.emit(..., room=user_room(requester_email))), this only ever
 * fires for requests THIS user created (i.e. their own outgoing asks), never for requests
 * they're approving/declining. Used to surface a "declined" notice to the requester. */
export function onRequestResolved(cb: (req: RequestOut) => void): () => void {
  ensureSocket();
  resolvedListeners.add(cb);
  return () => {
    resolvedListeners.delete(cb);
  };
}

/** POST /requests/{id}/resolve. Resolving removes the request from `pending` locally too
 * (belt-and-suspenders alongside the request_resolved/request_cancelled push, in case this
 * tab is the one that resolved it and the push races with the REST response). */
export async function resolveRequest(
  id: string,
  decision: "accept" | "decline",
): Promise<RequestOut> {
  const res = await restFetch(`/requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
  const out: RequestOut = await res.json();
  removeFromPending(id);
  return out;
}

/** POST /requests/{id}/cancel. */
export async function cancelRequest(id: string): Promise<RequestOut> {
  const res = await restFetch(`/requests/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
  const out: RequestOut = await res.json();
  removeFromPending(id);
  return out;
}

/** POST /requests {kind: "join_group", conversationId}. "join_group" is the exact `kind`
 * string the backend's accept path branches on (see resolve_request in
 * backend/app/routers/requests.py: `if new_state == "accepted" and req["kind"] ==
 * "join_group"`) — any other string would silently skip the atomic accept-and-add-participant
 * path. `conversationId` MUST be the spatial session's sessionId (= a Conversation.id). */
export async function createJoinRequest(conversationId: string): Promise<RequestOut> {
  const res = await restFetch("/requests", {
    method: "POST",
    body: JSON.stringify({ kind: "join_group", conversationId }),
  });
  return res.json();
}

// Test-only: module state (socket instance + cached pending list + listeners) outlives a
// single test.
export function resetRequestsClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  pending = [];
  resolvedListeners.clear();
  devEmail = null;
  notify();
}
