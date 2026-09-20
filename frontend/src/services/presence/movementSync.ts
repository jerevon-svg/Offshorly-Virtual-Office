import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// Socket.IO client for the unified self-movement / peer-replay pipeline
// (replaces spatialWalkClient.ts). Opens its OWN connection to the same
// realtime backend RealChatService.ts/spatialSessionStore.ts talk to (same
// VITE_CHAT_SOCKET_URL base, same Atlas bearer token) — mirrors those
// modules' documented rationale exactly. Mirrors spatialSessionStore.ts's/
// offlineLineupClient.ts's useSyncExternalStore module-store pattern.
//
// Coordinate space: all `pos`/`path`/`origin`/`at` points here are layout
// top-left coords — the SAME coordinate space as `bonPos`, `layer.x`/
// `layer.y`, and `walkTo` targets already use throughout this codebase.
//
// Server holds live per-employee state, keyed by lowercased email, with a
// monotonically-increasing `revision` per employee. The client NEVER
// generates or relies on its own sequence number for ordering — only the
// server-issued revision decides which event wins a race. See the wire
// contract in the task doc for the exact event shapes.

export type Pt = { x: number; y: number };
export type Facing = "front" | "back" | "left" | "right";
export type MovementState = "standing" | "sitting";
/** How peers replay a movement. Absent from every V1 client and means "eased" — V1's own PeerWalker
 *  curve. The V2 3D office publishes "linear" for a free-movement LEG (a constant-speed sample of WASD
 *  running): easing a sample of continuous motion halts the body at both ends of every leg. */
export type WalkPacing = "eased" | "linear";

export interface ActiveMovement {
  movementId: string;
  origin: Pt;
  path: Pt[];
  /** PHASE 7D — the same in-flight walk in `roomId`'s local frame, when the publisher sent one. */
  localOrigin?: Pt;
  localPath?: Pt[];
  roomId: string | null;
  durationMs: number;
  startedAt: number; // server epoch ms
  pacing?: WalkPacing;
  serverTime?: number; // serverTime the snapshot that carried this active movement was stamped with (snapshot-sourced actives only)
}

export interface StableMovementState {
  pos: Pt;
  /** PHASE 7D — where they actually are, in the frame `roomId` names. EPHEMERAL: the server never
   *  persists it (employee_positions holds `pos` and nothing else), so it is absent after a restart
   *  or a reload until that employee moves again — and `pos` is the honest fallback meanwhile. */
  localPos?: Pt;
  facing: Facing;
  /** The V2 3D office's exact resting yaw in radians, beside V1's four-word `facing`. Present only when
   *  the arriving client published one (a V2 session) and it came through finite; a V1 arrival has none. */
  yaw?: number;
  state: MovementState;
  seatKey: string | null;
  roomId: string | null;
}

export interface PeerMovementState {
  email: string; // lowercased
  revision: number;
  stable: StableMovementState;
  active: ActiveMovement | null;
}

export interface WalkStartedPayload {
  movementId: string;
  origin: Pt;
  path: Pt[];
  roomId: string | null;
  durationMs: number;
  pacing?: WalkPacing;
  /** PHASE 7D — THE SAME MOVEMENT IN `roomId`'S OWN FRAME, for a place V1 has no coordinates for
   *  (the Championship Cave). `origin`/`path` above stay V1's and keep their meaning exactly: the
   *  last real in-frame point, which is what V1 persists and what V1's office draws. Optional and
   *  additive — a client that sends neither is the client that existed before this. */
  localOrigin?: Pt;
  localPath?: Pt[];
}

export interface WalkArrivedPayload {
  movementId: string;
  at: Pt;
  /** PHASE 7D — where they really stopped, in `roomId`'s frame. `at` stays V1's in-frame point. */
  localAt?: Pt;
  facing: Facing;
  state: MovementState;
  seatKey: string | null;
  roomId: string | null;
  /** radians, finite — see StableMovementState.yaw */
  yaw?: number;
}

interface PeerWalkStartedEvent {
  email: string;
  movementId: string;
  revision: number;
  origin: Pt;
  path: Pt[];
  roomId: string | null;
  durationMs: number;
  startedAt: number;
  pacing?: WalkPacing | null;
  localOrigin?: Pt | null;
  localPath?: Pt[] | null;
}

interface PeerWalkArrivedEvent {
  email: string;
  movementId: string;
  revision: number;
  at: Pt;
  facing: Facing;
  state: MovementState;
  seatKey: string | null;
  roomId: string | null;
  yaw?: number | null;
  localAt?: Pt | null;
}

interface PositionsSnapshotEntry {
  email: string;
  revision: number;
  pos: Pt;
  facing: Facing;
  state: MovementState;
  seatKey: string | null;
  roomId: string | null;
  updatedAt: number;
  yaw?: number | null;
  localAt?: Pt | null;
  active: {
    movementId: string;
    origin: Pt;
    path: Pt[];
    roomId: string | null;
    durationMs: number;
    startedAt: number;
    pacing?: WalkPacing | null;
    localOrigin?: Pt | null;
    localPath?: Pt[] | null;
  } | null;
}

/** The optional wire fields, admitted only in the shape they were specified: a yaw that is a finite
 *  number, a pacing that is one of the two words. Anything else is simply absent, exactly as a V1
 *  client's payload is — never a NaN in the store and never an unknown pacing a replay would trip on. */
const yawField = (v: unknown): { yaw: number } | Record<string, never> =>
  typeof v === "number" && Number.isFinite(v) ? { yaw: v } : {};
const pacingField = (v: unknown): { pacing: WalkPacing } | Record<string, never> =>
  v === "eased" || v === "linear" ? { pacing: v } : {};

interface PositionsSnapshotEvent {
  entries: PositionsSnapshotEntry[];
  serverTime: number;
}

/** `seat_rejected` — sent to the ARRIVING client only, when its `walk_arrived` claimed a seat another
 *  employee already holds. The server has accepted the arrival as STANDING at the same position (that
 *  is what it broadcast and persisted), so the local body should stand up. V1 clients receive and
 *  ignore it today; the 3D office stands its body up (dev/vo3d/app/Vo3dHost). */
export interface SeatRejectedEvent {
  movementId: string;
  seatKey: string;
  /** who holds it — lowercased email, for a readout; never required to act */
  heldBy: string;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the movement-sync presence feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

let socketInstance: Socket | null = null;
const seatRejectedListeners = new Set<(e: SeatRejectedEvent) => void>();
const peers = new Map<string, PeerMovementState>();
let peersSnapshot: PeerMovementState[] = [];
const listeners = new Set<() => void>();
// serverTime - Date.now() at the moment the last positions_snapshot arrived
// — used by PeerWalker to fast-forward an already-in-progress peer walk to
// its correct current position on (re)connect.
let serverClockOffsetMs = 0;
// True once this session's socket has delivered its first positions_snapshot — the only point at
// which self's own persisted (employee_positions) stable entry is known. OfficeMap's spawn waits
// on this before deciding a CHECKED_IN restore, instead of guessing from an empty store.
let snapshotReceived = false;
// DEV-ONLY: mirrors RealChatService.ts's/spatialSessionStore.ts's
// devEmail/setDevIdentity exactly.
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

function rebuild(): void {
  peersSnapshot = Array.from(peers.values());
}

function getSnapshot(): PeerMovementState[] {
  return peersSnapshot;
}

// DEV-ONLY: switches this module's connection to the backend's dev-email
// bypass (or back to normal token auth when passed null). Tears down any
// live socket so the next call reconnects with the new identity.
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

// Client-side cap on outgoing path length — the backend rejects paths over
// 64 points. Guarantees a long walk still gets broadcast, just downsampled,
// rather than silently dropped entirely.
const MAX_PATH = 64;
export function capPath(path: Pt[]): Pt[] {
  if (path.length <= MAX_PATH) return path;
  const step = (path.length - 1) / (MAX_PATH - 1);
  const out: Pt[] = [];
  for (let i = 0; i < MAX_PATH - 1; i++) out.push(path[Math.round(i * step)]);
  out.push(path[path.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Pure reducers — exported separately so they're unit-testable without a
// socket/store in the loop.
// ---------------------------------------------------------------------------

/** Applies a `positions_snapshot` event onto an existing peers map, returning
 * a NEW map (does not mutate `prev`). Replaces an entry only when the
 * snapshot's revision is newer than (or the entry is absent from) `prev`. */
export function applySnapshot(
  prev: Map<string, PeerMovementState>,
  event: PositionsSnapshotEvent,
): Map<string, PeerMovementState> {
  const next = new Map(prev);
  for (const entry of event.entries) {
    const email = entry.email.toLowerCase();
    const existing = next.get(email);
    if (existing && existing.revision >= entry.revision) continue;
    next.set(email, {
      email,
      revision: entry.revision,
      stable: {
        pos: entry.pos,
        facing: entry.facing,
        state: entry.state,
        seatKey: entry.seatKey,
        roomId: entry.roomId,
        ...(entry.localAt ? { localPos: entry.localAt } : {}),
        ...yawField(entry.yaw),
      },
      active: entry.active
        ? {
            movementId: entry.active.movementId,
            origin: entry.active.origin,
            path: entry.active.path,
            roomId: entry.active.roomId,
            durationMs: entry.active.durationMs,
            startedAt: entry.active.startedAt,
            ...(entry.active.localOrigin ? { localOrigin: entry.active.localOrigin } : {}),
            ...(entry.active.localPath ? { localPath: entry.active.localPath } : {}),
            ...pacingField(entry.active.pacing),
            serverTime: event.serverTime,
          }
        : null,
    });
  }
  return next;
}

/** Applies a `peer_walk_started` event. Ignored (returns `prev` unchanged) if
 * `event.revision <= current.revision` for that email (stale/reordered). */
export function applyStarted(
  prev: Map<string, PeerMovementState>,
  event: PeerWalkStartedEvent,
): Map<string, PeerMovementState> {
  const email = event.email.toLowerCase();
  const existing = prev.get(email);
  if (existing && event.revision <= existing.revision) return prev;

  const next = new Map(prev);
  next.set(email, {
    email,
    revision: event.revision,
    stable: {
      pos: existing?.stable.pos ?? event.origin,
      facing: existing?.stable.facing ?? "front",
      state: "standing",
      seatKey: existing?.stable.seatKey ?? null,
      roomId: event.roomId,
      // The walk's own local origin is the freshest local fact there is; keeping the previous one
      // would leave a body a leg behind until this walk resolves.
      ...(event.localOrigin ? { localPos: event.localOrigin } : existing?.stable.localPos ? { localPos: existing.stable.localPos } : {}),
      ...yawField(existing?.stable.yaw),
    },
    active: {
      movementId: event.movementId,
      origin: event.origin,
      path: event.path,
      roomId: event.roomId,
      durationMs: event.durationMs,
      startedAt: event.startedAt,
      ...(event.localOrigin ? { localOrigin: event.localOrigin } : {}),
      ...(event.localPath ? { localPath: event.localPath } : {}),
      ...pacingField(event.pacing),
    },
  });
  return next;
}

/** Applies a `peer_walk_arrived` event. Ignored if `event.revision <=
 * current.revision` for that email. Clears `active` and sets `stable`. */
export function applyArrived(
  prev: Map<string, PeerMovementState>,
  event: PeerWalkArrivedEvent,
): Map<string, PeerMovementState> {
  const email = event.email.toLowerCase();
  const existing = prev.get(email);
  if (existing && event.revision <= existing.revision) return prev;

  const next = new Map(prev);
  next.set(email, {
    email,
    revision: event.revision,
    stable: {
      pos: event.at,
      // PHASE 7D. Absent clears it: an arrival with no local coordinate is an arrival back inside
      // V1's frame, and holding the old one would strand the body in a Cave they have left.
      ...(event.localAt ? { localPos: event.localAt } : {}),
      facing: event.facing,
      state: event.state,
      seatKey: event.seatKey,
      roomId: event.roomId,
      ...yawField(event.yaw),
    },
    active: null,
  });
  return next;
}

// Lazily opens the connection on first use, matching the presence-module
// "don't open a socket that's doomed from the start" guard.
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

  socket.on("positions_snapshot", (payload?: PositionsSnapshotEvent) => {
    if (!payload || !Array.isArray(payload.entries)) return;
    serverClockOffsetMs = payload.serverTime - Date.now();
    snapshotReceived = true;
    const nextMap = applySnapshot(new Map(peers), payload);
    peers.clear();
    for (const [k, v] of nextMap) peers.set(k, v);
    rebuild();
    notify();
  });

  socket.on("peer_walk_started", (payload?: PeerWalkStartedEvent) => {
    if (!payload?.email || !payload.movementId) return;
    const nextMap = applyStarted(new Map(peers), payload);
    if (nextMap === peers) return; // stale, ignored
    peers.clear();
    for (const [k, v] of nextMap) peers.set(k, v);
    rebuild();
    notify();
  });

  socket.on("peer_walk_arrived", (payload?: PeerWalkArrivedEvent) => {
    if (!payload?.email || !payload.movementId) return;
    const nextMap = applyArrived(new Map(peers), payload);
    if (nextMap === peers) return; // stale, ignored
    peers.clear();
    for (const [k, v] of nextMap) peers.set(k, v);
    rebuild();
    notify();
  });

  socket.on("seat_rejected", (payload?: SeatRejectedEvent) => {
    if (!payload?.movementId || typeof payload.seatKey !== "string") return;
    for (const listener of seatRejectedListeners) listener(payload);
  });

  socketInstance = socket;
  return socket;
}

/** Subscribe to `seat_rejected` for THIS session's own arrivals. Establishes the connection on first
 *  use, like the hooks. Returns the unsubscribe. */
export function subscribeSeatRejected(listener: (e: SeatRejectedEvent) => void): () => void {
  ensureSocket();
  seatRejectedListeners.add(listener);
  return () => {
    seatRejectedListeners.delete(listener);
  };
}

/** Tells the server this user has started walking a path. No-op if the
 * connection can't be opened (not signed in). Caller must generate its own
 * movementId (crypto.randomUUID(), fallback to Math.random-based) — see
 * useSelfMovement.ts. Caps the outgoing path at 64 points. */
// Backend's walk_started validator (backend/app/realtime/socket.py's
// _valid_walk_started_payload) requires an int in [100, 20000] and silently
// drops the whole event otherwise — a dropped walk_started also strands the
// matching walk_arrived (no active movementId to accept it against), making
// the walk invisible to every peer. Defense in depth: round+clamp here too,
// even though useSelfMovement.ts's moveSelf already rounds before calling
// this — so any other/future caller can't reintroduce the float-drop bug.
const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 20000;
function sanitizeDurationMs(durationMs: number): number {
  const rounded = Math.round(durationMs);
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, rounded));
}

export function emitWalkStarted(payload: WalkStartedPayload): void {
  ensureSocket()?.emit("walk_started", {
    movementId: payload.movementId,
    origin: payload.origin,
    path: capPath(payload.path),
    roomId: payload.roomId,
    durationMs: sanitizeDurationMs(payload.durationMs),
    // PHASE 7D — capped by the SAME rule the V1 path is, because the server replays both through
    // one interpolation and validates both with one point check.
    ...(payload.localOrigin ? { localOrigin: payload.localOrigin } : {}),
    ...(payload.localPath?.length ? { localPath: capPath(payload.localPath) } : {}),
    ...pacingField(payload.pacing),
  });
}

/** Tells the server this user has arrived at their walk destination
 * (or the seat/standing state they finished at). */
export function emitWalkArrived(payload: WalkArrivedPayload): void {
  ensureSocket()?.emit("walk_arrived", {
    movementId: payload.movementId,
    at: payload.at,
    facing: payload.facing,
    state: payload.state,
    seatKey: payload.seatKey,
    roomId: payload.roomId,
    ...(payload.localAt ? { localAt: payload.localAt } : {}),
    ...yawField(payload.yaw),
  });
}

export function getPeerMovementSnapshot(): PeerMovementState[] {
  return peersSnapshot;
}

export function getServerClockOffsetMs(): number {
  return serverClockOffsetMs;
}

export function hasReceivedPositionsSnapshot(): boolean {
  return snapshotReceived;
}

function getSnapshotReceived(): boolean {
  return snapshotReceived;
}

/** Subscribable "first positions_snapshot has arrived" flag. Establishes the
 * connection on first mount, like usePeerMovements. */
export function useMovementSnapshotReady(): boolean {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshotReceived, getSnapshotReceived);
}

/** Subscribable hook giving components the current set of peer movement
 * states. Establishes the connection on first mount. */
export function usePeerMovements(): PeerMovementState[] {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: module state (socket instance + cached peer movements) outlives
// a single test.
export function __resetForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  peers.clear();
  peersSnapshot = [];
  serverClockOffsetMs = 0;
  snapshotReceived = false;
  devEmail = null;
  seatRejectedListeners.clear();
  notify();
}
