import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// Socket.IO client for the "Ask to Join + Group Conversation" spatial-clustering feature.
// Opens its OWN connection to the same realtime backend RealChatService.ts talks to (same
// VITE_CHAT_SOCKET_URL base, same Atlas bearer token) — mirrors offlineLineupClient.ts's
// documented rationale exactly: RealChatService keeps its socket entirely private (no
// getter), and this feature's needs (two small fire-and-forget emits + one snapshot
// subscription) don't justify refactoring it to expose a shared connection.
// python-socketio's ASGI server supports any number of concurrent sockets per authenticated
// user without issue, so this costs one extra connection, not a second server or auth path.
//
// Mirrors offlineLineupClient.ts's useSyncExternalStore module-store pattern for consistency
// with the rest of the presence system.
//
// EDGE-TRIGGERED ONLY: emitSpatialSessionStart/emitSpatialSessionLeave must only ever be
// called once per real transition (chat opened, chat closed, walked away, disconnected) —
// NEVER from a per-frame or per-tick proximity poll. The server's spatial_session_start
// handler (backend/app/realtime/socket.py) broadcasts to everyone unconditionally on every
// call, with no no-op guard — a polling caller here would cause a broadcast storm.

export interface SpatialSessionEntry {
  sessionId: string;
  members: string[];
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the spatial-session presence feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

let socketInstance: Socket | null = null;
let sessions: SpatialSessionEntry[] = [];
// The session this client still considers itself in, or null after an explicit leave. Held so
// a reconnect can re-assert membership: the server's registry is per-socket-id (see
// backend/app/services/spatial_session.py), so a reconnect arrives as a brand-new sid with no
// memory of us, and without this re-assert the user silently drops out of their own spatial
// conversation. Mirrors globalChatActivityClient.ts's desiredActive/"connect" pattern. Cleared
// on explicit leave so a reconnect can never RESURRECT a session the user deliberately left.
let activeSessionId: string | null = null;
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

function getSnapshot(): SpatialSessionEntry[] {
  return sessions;
}

// DEV-ONLY: switches this module's connection to the backend's dev-email bypass (or back to
// normal token auth when passed null). Tears down any live socket so the next call reconnects
// with the new identity. Mirrors RealChatService.ts's setDevIdentity exactly.
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
  // A different identity must never inherit the previous one's active session on reconnect.
  activeSessionId = null;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

// Lazily opens the connection on first use, matching offlineLineupClient's/RealChatService's
// "don't open a socket that's doomed from the start" guard: no auth token and no dev-email
// bypass (identity not resolved) means no connection attempt.
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

  socket.on(
    "spatial_sessions",
    (payload: { sessions?: SpatialSessionEntry[] } | undefined) => {
      sessions = payload?.sessions ?? [];
      notify();
    },
  );

  // Every (re)connect is a fresh server-side sid with no memory of this client, so re-assert
  // the still-active session exactly once per connect. Idempotent server-side: start() for the
  // same (email, session) simply registers the new sid as a co-owner. No-op after an explicit
  // leave, since that nulls activeSessionId.
  socket.on("connect", () => {
    if (activeSessionId) socket.emit("spatial_session_start", { sessionId: activeSessionId });
  });

  socketInstance = socket;
  return socket;
}

/** Tells the server this user has opened a chat panel for the given conversation — sessionId
 * MUST be a Conversation.id (never a layer id, email, or synthetic value). Guarded against
 * empty/falsy input (defense in depth, mirrors the server's own no-op guard). Call exactly
 * once per real "chat opened" transition — never on a poll. No-op if not signed in. */
export function emitSpatialSessionStart(sessionId: string): void {
  if (!sessionId) return;
  activeSessionId = sessionId;
  ensureSocket()?.emit("spatial_session_start", { sessionId });
}

/** Tells the server this user has left their current spatial session (chat closed/unmount/
 * disconnect). Call exactly once per real "chat closed" transition — never on a poll. No-op
 * if not signed in. */
export function emitSpatialSessionLeave(): void {
  activeSessionId = null;
  ensureSocket()?.emit("spatial_session_leave");
}

export function getSpatialSessionsSnapshot(): SpatialSessionEntry[] {
  return sessions;
}

/** Subscribable hook giving components the current set of spatial sessions (sessionId +
 * lowercased-email members). Establishes the connection on first mount. */
export function useSpatialSessions(): SpatialSessionEntry[] {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: module state (socket instance + cached sessions) outlives a single test.
export function resetSpatialSessionClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  sessions = [];
  devEmail = null;
  activeSessionId = null;
  notify();
}
