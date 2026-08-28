import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// REST + Socket.IO client for the "Request Permission to Talk" person-level DND request flow
// (backend/app/routers/talk_requests.py, backend/app/repositories/talk_requests.py). Mirrors
// roomRequestsClient.ts's conventions exactly, but hits a separate table/lifecycle — see
// backend/app/models/talk_request.py's docstring for why the two stay logically separate.

export interface TalkRequestOut {
  id: string;
  targetEmail: string;
  requesterEmail: string;
  kind: "chat" | "approach";
  state: string;
  resolverEmail: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Thrown by createTalkRequest when the target recently declined this exact requester (see
 * DND_POLICY.declineCooldownMs / backend's 429 response) — carries the server-authoritative
 * moment the cooldown lifts so the UI can derive a local countdown without polling. */
export class TalkRequestCooldownError extends Error {
  cooldownUntil: string;
  constructor(cooldownUntil: string) {
    super("Recently declined — try again later");
    this.name = "TalkRequestCooldownError";
    this.cooldownUntil = cooldownUntil;
  }
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for the talk-requests feature — see .env.example.");
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
    if (res.status === 429 && typeof body?.cooldownUntil === "string") {
      throw new TalkRequestCooldownError(body.cooldownUntil);
    }
    throw new Error(body?.error || body?.detail || `Talk-requests backend request failed (${res.status}) for ${path}`);
  }
  return res;
}

let socketInstance: Socket | null = null;
let pending: TalkRequestOut[] = [];
const listeners = new Set<() => void>();
const resolvedListeners = new Set<(req: TalkRequestOut) => void>();
const cancelledListeners = new Set<(req: TalkRequestOut) => void>();
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

function getSnapshot(): TalkRequestOut[] {
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

  socket.on("talk_request_created", (payload: TalkRequestOut) => {
    if (!payload || pending.some((r) => r.id === payload.id)) return;
    pending = [...pending, payload];
    notify();
  });

  socket.on("talk_request_resolved", (payload: TalkRequestOut) => {
    if (!payload) return;
    removeFromPending(payload.id);
    resolvedListeners.forEach((cb) => cb(payload));
  });

  socket.on("talk_request_cancelled", (payload: TalkRequestOut) => {
    if (!payload) return;
    removeFromPending(payload.id);
    cancelledListeners.forEach((cb) => cb(payload));
  });

  socketInstance = socket;
  return socket;
}

async function refreshPending(): Promise<void> {
  ensureSocket();
  const res = await restFetch("/talk-requests/pending");
  pending = await res.json();
  notify();
}

/** Subscribable hook giving components the current list of pending "request permission to talk"
 * requests targeting this signed-in user. Fetches the initial snapshot on first mount, then
 * stays live via talk_request_created/resolved/cancelled pushes. */
export function usePendingTalkRequests(): TalkRequestOut[] {
  useEffect(() => {
    void refreshPending();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getPendingTalkRequestsSnapshot(): TalkRequestOut[] {
  return pending;
}

export function onTalkRequestResolved(cb: (req: TalkRequestOut) => void): () => void {
  ensureSocket();
  resolvedListeners.add(cb);
  return () => {
    resolvedListeners.delete(cb);
  };
}

export function onTalkRequestCancelled(cb: (req: TalkRequestOut) => void): () => void {
  ensureSocket();
  cancelledListeners.add(cb);
  return () => {
    cancelledListeners.delete(cb);
  };
}

/** POST /talk-requests {targetEmail, kind}. Throws TalkRequestCooldownError if the target
 * recently declined this exact requester (see DND_POLICY.declineCooldownMs). */
export async function createTalkRequest(targetEmail: string, kind: "chat" | "approach"): Promise<TalkRequestOut> {
  const res = await restFetch("/talk-requests", {
    method: "POST",
    body: JSON.stringify({ targetEmail, kind }),
  });
  return res.json();
}

export async function resolveTalkRequest(id: string, decision: "accept" | "decline"): Promise<TalkRequestOut> {
  const res = await restFetch(`/talk-requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
  const out: TalkRequestOut = await res.json();
  removeFromPending(id);
  return out;
}

export async function cancelTalkRequest(id: string): Promise<TalkRequestOut> {
  const res = await restFetch(`/talk-requests/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
  const out: TalkRequestOut = await res.json();
  removeFromPending(id);
  return out;
}

// Test-only: module state outlives a single test.
export function resetTalkRequestsClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  pending = [];
  resolvedListeners.clear();
  cancelledListeners.clear();
  devEmail = null;
  notify();
}
