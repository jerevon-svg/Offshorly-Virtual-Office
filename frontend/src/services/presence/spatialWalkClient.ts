import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// Socket.IO client for the frontend half of the Stage 3 "peer-walk animation"
// spatial-clustering feature. Opens its OWN connection to the same realtime
// backend RealChatService.ts / spatialSessionStore.ts talk to (same
// VITE_CHAT_SOCKET_URL base, same Atlas bearer token) — mirrors
// spatialSessionStore.ts's/offlineLineupClient.ts's documented rationale
// exactly: RealChatService keeps its socket entirely private (no getter), and
// this feature's needs (two small fire-and-forget emits + one snapshot
// subscription) don't justify refactoring it to expose a shared connection.
// python-socketio's ASGI server supports any number of concurrent sockets per
// authenticated user without issue, so this costs one extra connection, not a
// second server or auth path.
//
// Mirrors spatialSessionStore.ts's useSyncExternalStore module-store pattern
// for consistency with the rest of the presence system.
//
// Coordinate space: all `from`/`path`/`at` points here are layout top-left
// coords — the SAME coordinate space as `bonPos`, `layer.x`/`layer.y`, and
// `walkTo` targets already use throughout this codebase. Every client renders
// the identical office layout, so a peer's received coordinates can be used
// directly with zero transform.

type Pt = { x: number; y: number };

export interface PeerWalkState {
  email: string; // lowercased
  from: Pt;
  path: Pt[];
  startNonce: number; // increments on each peer_walk_started for this email
  arrivedAt: Pt | null;
  arrivedNonce: number; // increments on each peer_walk_arrived for this email
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the spatial-walk presence feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

let socketInstance: Socket | null = null;
const peerWalks = new Map<string, PeerWalkState>();
let peerWalksSnapshot: PeerWalkState[] = [];
const listeners = new Set<() => void>();
// DEV-ONLY: mirrors RealChatService.ts's/spatialSessionStore.ts's
// devEmail/setDevIdentity exactly — when set, this module's socket
// authenticates via the backend's `x-dev-email` bypass instead of the real
// Atlas bearer token. Only ever set by the dev-only auth-gate bypass (see
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

// Rebuilds the cached snapshot array only when the map mutates, so
// useSyncExternalStore doesn't loop on every render.
function rebuild(): void {
  peerWalksSnapshot = Array.from(peerWalks.values());
}

function getSnapshot(): PeerWalkState[] {
  return peerWalksSnapshot;
}

// DEV-ONLY: switches this module's connection to the backend's dev-email
// bypass (or back to normal token auth when passed null). Tears down any live
// socket so the next call reconnects with the new identity. Mirrors
// RealChatService.ts's/spatialSessionStore.ts's setDevIdentity exactly.
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

// Client-side cap on outgoing path length — the backend rejects paths over 64
// points. This guarantees a long walk still gets broadcast, just
// downsampled, rather than silently dropped entirely.
const MAX_PATH = 64;
export function capPath(path: Pt[]): Pt[] {
  if (path.length <= MAX_PATH) return path;
  const step = (path.length - 1) / (MAX_PATH - 1);
  const out: Pt[] = [];
  for (let i = 0; i < MAX_PATH - 1; i++) out.push(path[Math.round(i * step)]);
  out.push(path[path.length - 1]);
  return out;
}

// Lazily opens the connection on first use, matching
// spatialSessionStore's/offlineLineupClient's/RealChatService's "don't open a
// socket that's doomed from the start" guard: no auth token and no dev-email
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
    "peer_walk_started",
    (p?: { email?: string; from?: Pt; path?: Pt[] }) => {
      if (!p?.email || !p.from || !Array.isArray(p.path) || p.path.length === 0) return;
      const email = p.email.toLowerCase();
      const prev = peerWalks.get(email);
      peerWalks.set(email, {
        email,
        from: p.from,
        path: p.path,
        startNonce: (prev?.startNonce ?? 0) + 1,
        arrivedAt: null,
        arrivedNonce: prev?.arrivedNonce ?? 0,
      });
      rebuild();
      notify();
    },
  );

  socket.on("peer_walk_arrived", (p?: { email?: string; at?: Pt }) => {
    if (!p?.email || !p.at) return;
    const email = p.email.toLowerCase();
    const prev = peerWalks.get(email);
    peerWalks.set(email, {
      email,
      from: prev?.from ?? p.at,
      path: prev?.path ?? [p.at],
      startNonce: prev?.startNonce ?? 0,
      arrivedAt: p.at,
      arrivedNonce: (prev?.arrivedNonce ?? 0) + 1,
    });
    rebuild();
    notify();
  });

  socketInstance = socket;
  return socket;
}

/** Tells the server this user has started walking a path — from and path are
 * layout top-left coords. No-op (no emit, no connection opened) if path is
 * empty. Caps the outgoing path at 64 points (see capPath). */
export function emitWalkStart(from: Pt, path: Pt[]): void {
  if (!path.length) return;
  ensureSocket()?.emit("walk_started", { from, path: capPath(path) });
}

/** Tells the server this user has arrived at their walk destination. */
export function emitWalkArrived(at: Pt): void {
  ensureSocket()?.emit("walk_arrived", { at });
}

/** Wraps a local walkTo call with the matching walk_started/walk_arrived
 * broadcasts, so peers can see this walk animate on their screens too. */
export function emitAndWalkTo(
  walkTo: (input: Pt | Pt[], onArrive?: () => void) => void,
  from: Pt,
  path: Pt[],
  onArrive?: () => void,
): void {
  emitWalkStart(from, path);
  walkTo(path, () => {
    emitWalkArrived(path.at(-1) ?? from);
    onArrive?.();
  });
}

export function getPeerWalksSnapshot(): PeerWalkState[] {
  return peerWalksSnapshot;
}

/** Subscribable hook giving components the current set of in-flight/arrived
 * peer walks. Establishes the connection on first mount. */
export function usePeerWalks(): PeerWalkState[] {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: module state (socket instance + cached peer walks) outlives a
// single test.
export function resetSpatialWalkClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  peerWalks.clear();
  peerWalksSnapshot = [];
  devEmail = null;
  notify();
}
