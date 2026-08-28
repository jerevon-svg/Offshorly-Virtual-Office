import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// Socket.IO client for the DND-room-lock feature's realtime room-occupancy broadcast. `roomId`
// throughout is the flat rects/teamRooms-namespace id (office-layout.ts's `rooms`, e.g.
// "design-team") — the same scheme OfficeMap.tsx's flatRoomIdAt()/doorStandForRoom() use, so a
// self-reported roomId always joins cleanly against the door/lock logic. Mirrors
// spatialSessionStore.ts's module-store + useSyncExternalStore pattern and its own-connection
// rationale exactly.
//
// EDGE-TRIGGERED ONLY: emitRoomPresenceEnter/Leave must only ever be called once per real
// "crossed into a different flat room" transition (see the useRoomPresenceBroadcast hook wired
// off OfficeMap's already-computed flatRoomIdAt(bonPos) value) — never from a per-frame poll.

export interface RoomPresenceEntry {
  roomId: string;
  members: string[];
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for the DND-room-lock feature — see .env.example.");
  }
  return raw.replace(/\/+$/, "");
}

let socketInstance: Socket | null = null;
let rooms: RoomPresenceEntry[] = [];
const listeners = new Set<() => void>();
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

function getSnapshot(): RoomPresenceEntry[] {
  return rooms;
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

  socket.on("room_presence", (payload: { rooms?: RoomPresenceEntry[] } | undefined) => {
    rooms = payload?.rooms ?? [];
    notify();
  });

  socketInstance = socket;
  return socket;
}

/** Tells the server this user just entered roomId (a flat rects/teamRooms-namespace id). Call
 * exactly once per real "entered a new room" transition. No-op if not signed in. */
export function emitRoomPresenceEnter(roomId: string): void {
  if (!roomId) return;
  ensureSocket()?.emit("room_presence_enter", { roomId });
}

/** Tells the server this user just left their current room for open floor/corridor. Call exactly
 * once per real "left the room" transition (not when crossing directly into another room — use
 * emitRoomPresenceEnter for that). */
export function emitRoomPresenceLeave(): void {
  ensureSocket()?.emit("room_presence_leave");
}

export function getRoomPresenceSnapshot(): RoomPresenceEntry[] {
  return rooms;
}

/** Subscribable hook giving components the live room-occupancy snapshot. Establishes the
 * connection on first mount. */
export function useRoomPresence(): RoomPresenceEntry[] {
  useEffect(() => {
    ensureSocket();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Test-only: module state outlives a single test.
export function resetRoomPresenceClientForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  rooms = [];
  devEmail = null;
  notify();
}
