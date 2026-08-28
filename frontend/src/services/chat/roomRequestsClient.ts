import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// REST + Socket.IO client for the "Request Entry / Knock" room-lock request flow
// (backend/app/routers/room_requests.py, backend/app/repositories/room_requests.py). Mirrors
// requestsClient.ts's (Ask-to-Join) conventions exactly, but is deliberately a SEPARATE module
// hitting a separate table/lifecycle — see backend/app/models/room_request.py's docstring for
// why the two stay logically separate (Ask to Join = join a conversation; Request Entry =
// physically enter a protected room).

export interface RoomRequestOut {
  id: string;
  roomId: string;
  requesterEmail: string;
  state: string;
  resolverEmail: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for the room-requests feature — see .env.example.");
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
    throw new Error(body?.error || body?.detail || `Room-requests backend request failed (${res.status}) for ${path}`);
  }
  return res;
}

let socketInstance: Socket | null = null;
let pending: RoomRequestOut[] = [];
const listeners = new Set<() => void>();
const resolvedListeners = new Set<(req: RoomRequestOut) => void>();
const cancelledListeners = new Set<(req: RoomRequestOut) => void>();
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

function getSnapshot(): RoomRequestOut[] {
  return pending;
}

function removeFromPending(id: string): void {
  const next = pending.filter((r) => r.id !== id);
  if (next.length === pending.length) return;
  pending = next;
  notify();
}

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

  const auth: Record<string, string | null> = devEmail ? { "x-dev-email": devEmail } : { token: getAuthToken() };
  const socket = io(socketBase(), { auth, autoConnect: true });

  socket.on("room_request_created", (payload: RoomRequestOut) => {
    if (!payload || pending.some((r) => r.id === payload.id)) return;
    pending = [...pending, payload];
    notify();
  });

  socket.on("room_request_resolved", (payload: RoomRequestOut) => {
    if (!payload) return;
    removeFromPending(payload.id);
    resolvedListeners.forEach((cb) => cb(payload));
  });

  socket.on("room_request_cancelled", (payload: RoomRequestOut) => {
    if (!payload) return;
    removeFromPending(payload.id);
    cancelledListeners.forEach((cb) => cb(payload));
  });

  socketInstance = socket;
  return socket;
}

async function refreshPending(): Promise<void> {
  ensureSocket();
  const res = await restFetch("/room-requests/pending");
  pending = await res.json();
  notify();
}

/** Subscribable hook giving components the current list of pending Knock requests targeting the
 * room this signed-in user currently occupies (see list_pending_room_requests). Fetches the
 * initial snapshot on first mount, then stays live via room_request_created/resolved/cancelled
 * pushes. */
export function usePendingRoomRequests(): RoomRequestOut[] {
  useEffect(() => {
    void refreshPending();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getPendingRoomRequestsSnapshot(): RoomRequestOut[] {
  return pending;
}

/** Subscribes to every room_request_resolved event this signed-in user's own socket receives —
 * fires both for requests THIS user made (their own outgoing Knocks) and for ones they resolved
 * as an occupant, per the backend's fan-out to requester + all current occupants. */
export function onRoomRequestResolved(cb: (req: RoomRequestOut) => void): () => void {
  ensureSocket();
  resolvedListeners.add(cb);
  return () => {
    resolvedListeners.delete(cb);
  };
}

/** Subscribes to every room_request_cancelled event — fires when the requester cancels, or when
 * the server auto-cancels a stale request because the room unlocked while it was pending. */
export function onRoomRequestCancelled(cb: (req: RoomRequestOut) => void): () => void {
  ensureSocket();
  cancelledListeners.add(cb);
  return () => {
    cancelledListeners.delete(cb);
  };
}

/** POST /room-requests {roomId}. `roomId` MUST be the flat rects/teamRooms-namespace room id
 * (office-layout.ts `rooms`, e.g. "design-team") — the same scheme doorStandForRoom/
 * flatRoomIdAt use, since that's what the server's RoomPresenceRegistry keys occupancy on. */
export async function createRoomEntryRequest(roomId: string): Promise<RoomRequestOut> {
  const res = await restFetch("/room-requests", {
    method: "POST",
    body: JSON.stringify({ roomId }),
  });
  return res.json();
}

/** POST /room-requests/{id}/resolve. Resolving removes the request from `pending` locally too
 * (belt-and-suspenders alongside the room_request_resolved push). */
export async function resolveRoomEntryRequest(id: string, decision: "accept" | "decline"): Promise<RoomRequestOut> {
  const res = await restFetch(`/room-requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
  const out: RoomRequestOut = await res.json();
  removeFromPending(id);
  return out;
}

/** POST /room-requests/{id}/cancel. */
export async function cancelRoomEntryRequest(id: string): Promise<RoomRequestOut> {
  const res = await restFetch(`/room-requests/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
  const out: RoomRequestOut = await res.json();
  removeFromPending(id);
  return out;
}

// Test-only: module state outlives a single test.
export function resetRoomRequestsClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  pending = [];
  resolvedListeners.clear();
  cancelledListeners.clear();
  devEmail = null;
  notify();
}
