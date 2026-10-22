import { useEffect, useRef, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import type { OfficeStatus } from "./status";

// Socket.IO client for the DND-room-lock feature's realtime DND broadcast. DND was previously
// 100% client-side/localStorage-only (see selfStatusStore.ts) with no realtime channel — this
// module is the minimal addition making a peer's DND state visible to other clients, which the
// room-lock derivation (roomLock.ts) needs. Opens its OWN connection, mirroring
// spatialSessionStore.ts's documented rationale exactly (RealChatService keeps its socket
// entirely private; this feature's needs don't justify refactoring it to share one).
//
// EDGE-TRIGGERED ONLY: emitDndOn/emitDndOff must only ever be called once per real transition
// (see the useDndBroadcast hook below, wired off useSelfStatus().currentStatus in OfficeMap.tsx)
// — never from a per-frame/per-tick poll. The server's dnd_set handler broadcasts to everyone
// unconditionally on change, with no coalescing.

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for the DND-room-lock feature — see .env.example.");
  }
  return raw.replace(/\/+$/, "");
}

let socketInstance: Socket | null = null;
let dndEmails: Set<string> = new Set();
// What THIS client last asked the server to hold for the signed-in user. The server's registry is
// in-memory and cleared by that user's disconnect (backend/app/realtime/socket.py), so every
// (re)connect arrives as a stranger with no DND — this is what lets the "connect" handler below
// re-assert it. Mirrors spatialSessionStore.ts's activeSessionId/"connect" pattern exactly; dnd_set
// is idempotent server-side (DndRegistry.set_dnd returns False and broadcasts nothing on a no-op).
let desiredDnd = false;
// PEER STATUS (2026-10-21) — the same connection also carries each person's own EFFECTIVE status (their
// resolveCurrentStatus) to peers: `status_set` out, the server's `peer_status` snapshot in (backend
// peer_status_registry.py). Like DND it is socket-scoped — cleared by the sender's disconnect — so a
// (re)connect re-asserts `desiredStatus`. Self stays the source; peers only ever see its latest answer.
let peerStatuses: Map<string, OfficeStatus> = new Map();
let desiredStatus: OfficeStatus | null = null;
const peerListeners = new Set<() => void>();
const listeners = new Set<() => void>();
// DEV-ONLY: mirrors spatialSessionStore.ts's devEmail/setDevIdentity exactly.
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

function getSnapshot(): Set<string> {
  return dndEmails;
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

  socket.on("dnd_status", (payload: { emails?: string[] } | undefined) => {
    dndEmails = new Set(payload?.emails ?? []);
    notify();
  });

  // Every (re)connect is a fresh server-side sid whose disconnect predecessor already cleared this
  // user's DND. Re-assert it exactly once per connect while DND is still wanted; no-op otherwise, and
  // a no-op server-side too when the very first connect follows the emit that set desiredDnd.
  socket.on("peer_status", (payload: { statuses?: Record<string, OfficeStatus> } | undefined) => {
    peerStatuses = new Map(Object.entries(payload?.statuses ?? {}));
    for (const l of peerListeners) l();
  });

  socket.on("connect", () => {
    if (desiredDnd) socket.emit("dnd_set", { isDnd: true });
    if (desiredStatus) socket.emit("status_set", { status: desiredStatus });
  });

  socketInstance = socket;
  return socket;
}

/** Tells the server this user just turned DND on/off. Call exactly once per real transition —
 * never on a poll. No-op if not signed in. */
export function emitDndSet(isDnd: boolean): void {
  desiredDnd = isDnd;
  ensureSocket()?.emit("dnd_set", { isDnd });
}

/** THE ONE PUBLISHER of the signed-in user's own DND, shared by V1's office (OfficeMap.tsx) and the V2
 * world (Vo3dOverlay.tsx) so the two cannot drift. Edge-triggered: only a real DND⇄not-DND crossing
 * emits, never a re-render, never an unrelated status move, and never unmount (DND is a durable session
 * — selfStatusStore — not an open window).
 *
 * THE ONE DELIBERATE EXCEPTION TO "a fresh mount is not a transition": a mount that already finds DND
 * active publishes TRUE once. That is the reload case — the store restored the session from
 * localStorage, but the server forgot it the moment the old socket disconnected, so every other client
 * would otherwise read this person as not-DND until they toggled it by hand. The server's own
 * idempotency makes this harmless when it was in fact still registered. */
export function useSelfDndPublication(isDnd: boolean): void {
  // null = nothing published yet by this mount; otherwise the last value handed to emitDndSet.
  const publishedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (publishedRef.current === isDnd) return;
    const firstMount = publishedRef.current === null;
    publishedRef.current = isDnd;
    if (firstMount && !isDnd) return;
    emitDndSet(isDnd);
  }, [isDnd]);
}

/** Tells the server this user's effective status changed. Once per real change (and the reconnect re-assert
 *  above) — never on a poll. No-op if not signed in. */
export function emitStatusSet(status: OfficeStatus): void {
  desiredStatus = status;
  ensureSocket()?.emit("status_set", { status });
}

/** THE ONE PUBLISHER of the signed-in user's own effective status, shared by V1 (OfficeMap.tsx) and V2
 *  (Vo3dOverlay.tsx). Unlike DND, a fresh mount ALWAYS publishes: the server holds nothing for a new socket,
 *  and "Available" is as much a fact peers need as "Busy". Re-renders with the same status emit nothing. */
export function useSelfStatusPublication(status: OfficeStatus): void {
  const publishedRef = useRef<OfficeStatus | null>(null);
  useEffect(() => {
    if (publishedRef.current === status) return;
    publishedRef.current = status;
    emitStatusSet(status);
  }, [status]);
}

/** Live effective statuses of connected peers, keyed by lowercased email (absent = not connected here). */
export function usePeerStatuses(): Map<string, OfficeStatus> {
  useEffect(() => {
    ensureSocket();
  }, []);
  const sub = (l: () => void) => { peerListeners.add(l); return () => { peerListeners.delete(l); }; };
  return useSyncExternalStore(sub, () => peerStatuses, () => peerStatuses);
}

export function getDndEmailsSnapshot(): Set<string> {
  return dndEmails;
}

/** Subscribable hook giving components the live set of currently-DND emails. Establishes the
 * connection on first mount. */
export function useDndEmails(): Set<string> {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: module state outlives a single test.
export function resetDndClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  dndEmails = new Set();
  devEmail = null;
  desiredDnd = false;
  peerStatuses = new Map();
  desiredStatus = null;
  for (const l of peerListeners) l();
  notify();
}
