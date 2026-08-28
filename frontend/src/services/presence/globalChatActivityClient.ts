import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// Socket.IO client for the "has an active Global Chat window" presence fact. Drives exactly
// one thing: peers see a SEATED employee play `sitting-answering` (instead of the default
// `sit-on-chair-arms`) while that employee has at least one visible, non-minimized remote
// DM/group window open through Global Chat — see characterAnimationState.ts. Carries only the
// boolean per email: no conversation ids, participants, or contents ever leave the client.
//
// Mirrors dndClient.ts (own connection, module store, useSyncExternalStore, dev-email bypass)
// — see that module and spatialSessionStore.ts for the documented rationale. The server
// (backend/app/realtime/socket.py `global_chat_active`) refcounts per socket, so two tabs of
// one user compose correctly, and re-sends the full snapshot on connect so late joiners /
// reconnects are authoritative.
//
// RECONNECT-SAFE (2026-08-28): this module retains the latest locally DESIRED boolean and
// re-emits it on every successful (re)connect — including `false` — so a backend restart
// (which wipes the in-memory registry) or a dropped socket never leaves a still-open window
// unreported until the next window transition. While connected and stable, a value is only
// sent when it differs from what this socket last sent, so unrelated re-renders / repeated
// calls with the same value never emit.
//
// Deliberately NOT routed through spatialSessionStore — remote chats must never look spatial
// (no auto-walk, no "In Conversation", no Ask to Join).

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the Global Chat activity presence feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

let socketInstance: Socket | null = null;
let activeEmails: Set<string> = new Set();
const listeners = new Set<() => void>();

// Latest value the caller asked us to report for THIS tab's socket.
let desiredActive = false;
// What this socket connection last successfully sent; null = nothing sent yet on the current
// connection (fresh connect / after a disconnect), which forces a re-send on connect.
let lastSentActive: boolean | null = null;

// DEV-ONLY: mirrors dndClient.ts's devEmail/setDevIdentity exactly.
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
  return activeEmails;
}

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    lastSentActive = null;
  }
}

function sendDesiredIfNeeded(socket: Socket): void {
  if (!socket.connected) return; // the connect handler will send it
  if (lastSentActive === desiredActive) return;
  socket.emit("global_chat_active", { isActive: desiredActive });
  lastSentActive = desiredActive;
}

function ensureSocket(): Socket | null {
  if (socketInstance) return socketInstance;
  if (!devEmail && !getAuthToken()) return null;
  const auth: Record<string, string | null> = devEmail ? { "x-dev-email": devEmail } : { token: getAuthToken() };
  const socket = io(socketBase(), { auth, autoConnect: true });
  socket.on("global_chat_activity", (payload: { emails?: string[] } | undefined) => {
    activeEmails = new Set((payload?.emails ?? []).map((e) => e.trim().toLowerCase()));
    notify();
  });
  // Every (re)connect is a fresh server-side socket with no memory of us: always report the
  // current desired value, true OR false, exactly once.
  socket.on("connect", () => {
    lastSentActive = null;
    sendDesiredIfNeeded(socket);
  });
  socket.on("disconnect", () => {
    lastSentActive = null;
  });
  socketInstance = socket;
  return socket;
}

/** Records this tab's "has a visible, non-minimized Global Chat window" fact and reports it to
 * the server when it differs from what this socket last sent (and again on every reconnect).
 * Safe to call with an unchanged value. No-op if not signed in. */
export function emitGlobalChatActive(isActive: boolean): void {
  desiredActive = isActive;
  const socket = ensureSocket();
  if (!socket) return;
  sendDesiredIfNeeded(socket);
}

export function getGlobalChatActiveEmailsSnapshot(): Set<string> {
  return activeEmails;
}

/** Subscribable hook giving components the live set of lowercased emails currently in an
 * active Global Chat window. Establishes the connection on first mount. */
export function useGlobalChatActiveEmails(): Set<string> {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: module state outlives a single test.
export function resetGlobalChatActivityClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  activeEmails = new Set();
  desiredActive = false;
  lastSentActive = null;
  devEmail = null;
  notify();
}
