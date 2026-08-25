import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// Socket.IO client for the offline-lineup feature. Opens its OWN connection to the same
// realtime backend RealChatService.ts talks to (same VITE_CHAT_SOCKET_URL base, same Atlas
// bearer token) rather than refactoring RealChatService.ts to expose a shared connection —
// RealChatService keeps its socket entirely private (no getter), and this feature's needs
// (two small fire-and-forget emits + one snapshot subscription) don't justify that refactor.
// python-socketio's ASGI server supports any number of concurrent sockets per authenticated
// user without issue (each just gets its own sid/session), so this costs one extra
// connection, not a second server or auth path.
//
// Mirrors selfStatusStore.ts's useSyncExternalStore module-store pattern for consistency with
// the rest of the presence system.

export interface OfflineLineupEntry {
  email: string;
  slot: number;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the offline-lineup presence feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

let socketInstance: Socket | null = null;
let entries: OfflineLineupEntry[] = [];
const listeners = new Set<() => void>();
// DEV-ONLY: mirrors RealChatService.ts's devEmail/setDevIdentity exactly — when set, this
// module's socket authenticates via the backend's `x-dev-email` bypass instead of the real
// Atlas bearer token. Only ever set by the dev-only auth-gate bypass (see useAuthGate.ts's
// seedDevBypassIdentity) — never touched by the normal app.
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

function getSnapshot(): OfflineLineupEntry[] {
  return entries;
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

// Lazily opens the connection on first use (mount of useOfflineLineup, or the first
// emitGoOffline/emitComeOnline call — whichever happens first) rather than at module load,
// matching RealChatService's "don't open a socket that's doomed from the start" guard: no
// auth token and no dev-email bypass (identity not resolved) means no connection attempt.
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

  socket.on("offline_lineup", (payload: { entries?: OfflineLineupEntry[] } | undefined) => {
    entries = payload?.entries ?? [];
    notify();
  });

  socketInstance = socket;
  return socket;
}

/** Tells the server this user has explicitly checked out — assigns/re-broadcasts this
 * user's sidewalk slot. No-op if not signed in (mirrors ensureSocket's guard). */
export function emitGoOffline(): void {
  ensureSocket()?.emit("go_offline");
}

/** Tells the server this user has checked back in — frees this user's sidewalk slot and
 * re-broadcasts. No-op if not signed in. */
export function emitComeOnline(): void {
  ensureSocket()?.emit("come_online");
}

export function getOfflineLineupSnapshot(): OfflineLineupEntry[] {
  return entries;
}

/** Subscribable hook giving components the current offline lineup (email + assigned slot
 * for each currently-checked-out person). Establishes the connection on first mount. */
export function useOfflineLineup(): OfflineLineupEntry[] {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: module state (socket instance + cached entries) outlives a single test.
export function resetOfflineLineupClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  entries = [];
  devEmail = null;
  notify();
}
