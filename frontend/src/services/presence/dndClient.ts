import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

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

  socketInstance = socket;
  return socket;
}

/** Tells the server this user just turned DND on/off. Call exactly once per real transition —
 * never on a poll. No-op if not signed in. */
export function emitDndSet(isDnd: boolean): void {
  ensureSocket()?.emit("dnd_set", { isDnd });
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
  notify();
}
