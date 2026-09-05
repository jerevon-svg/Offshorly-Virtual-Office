import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import { getDevIdentity } from "./whiteboardClient";
import type { SyncElement } from "./whiteboardSync";

// Socket.IO client for Whiteboard W3 realtime (backend/app/realtime/socket.py whiteboard_*
// handlers). One socket per open board, owned by the editor for the board's lifetime — same
// own-connection rationale and dev-identity bypass as roomPresenceClient.ts. This module is
// transport only: it knows nothing about Excalidraw or merge rules (see whiteboardSync.ts and
// WhiteboardEditor.tsx for those).
//
// Reconnect: Socket.IO reconnects on its own; every `connect` (first or later) re-emits the join
// and the server answers with a full authoritative snapshot. Emits while disconnected are dropped
// on purpose — the editor keeps unacknowledged changes and reconciles them against that snapshot
// before resending, instead of letting Socket.IO's buffer replay stale state ahead of the join.

export type SyncStatus = "connecting" | "live" | "reconnecting" | "offline";

export interface CollaboratorInfo {
  sid: string;
  email: string;
  username: string;
  color: { background: string; stroke: string };
}

export interface WhiteboardSnapshot {
  boardId: string;
  elements: SyncElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  version: number;
  seq: number;
  collaborators: CollaboratorInfo[];
}

export interface PointerPayload {
  pointer: { x: number; y: number; tool: "pointer" | "laser" } | null;
  button: "up" | "down";
  selectedElementIds: Record<string, boolean>;
}

export interface RemotePointer extends CollaboratorInfo, PointerPayload {
  boardId: string;
}

export interface SyncHandlers {
  onStatus: (status: SyncStatus) => void;
  onSnapshot: (snapshot: WhiteboardSnapshot) => void;
  onRemoteElements: (elements: SyncElement[]) => void;
  onAck: (clientSeq: number) => void;
  onPresence: (collaborators: CollaboratorInfo[]) => void;
  onPointer: (pointer: RemotePointer) => void;
}

export interface SyncHandle {
  /** This socket's id once connected — collaborators with this sid are "me". */
  selfId: () => string | null;
  /** Dropped (returns false) while disconnected; the editor keeps the elements pending. */
  sendElements: (elements: readonly SyncElement[], clientSeq: number) => boolean;
  sendPointer: (payload: PointerPayload) => void;
  leave: () => void;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for Whiteboards — see .env.example.");
  }
  return raw.replace(/\/+$/, "");
}

/** Join `boardId`'s realtime room. Returns null (and reports nothing) when there is no identity
 * to connect with — the caller then falls back to REST saves.
 *
 * IDENTITY IS BORROWED, NOT COPIED: the dev-bypass email comes from whiteboardClient.ts, the
 * REST client that already loaded this board. A second module-level copy seeded separately by
 * useAuthGate was only populated on a full app boot, so a tab that was already open when this
 * module first loaded (dev HMR) could fetch boards over REST yet silently never join realtime. */
export function joinWhiteboard(boardId: string, handlers: SyncHandlers): SyncHandle | null {
  const devEmail = getDevIdentity();
  if (!devEmail && !getAuthToken()) return null;

  const auth: Record<string, string | null> = devEmail ? { "x-dev-email": devEmail } : { token: getAuthToken() };
  let socket: Socket | null = io(socketBase(), { auth, autoConnect: true });
  let everJoined = false;

  handlers.onStatus("connecting");

  socket.on("connect", () => {
    socket?.emit("whiteboard_join", { boardId });
  });
  socket.on("connect_error", () => {
    // Never reached the server (or auth refused): REST is the only way to save.
    if (!everJoined) handlers.onStatus("offline");
  });
  socket.on("disconnect", () => {
    if (everJoined) handlers.onStatus("reconnecting");
  });
  socket.on("whiteboard_snapshot", (snapshot: WhiteboardSnapshot) => {
    if (snapshot?.boardId !== boardId) return;
    everJoined = true;
    handlers.onSnapshot(snapshot);
    handlers.onStatus("live");
  });
  socket.on("whiteboard_error", (err: { boardId?: string; code?: string } | undefined) => {
    if (err?.boardId && err.boardId !== boardId) return;
    // forbidden / not_found on join: realtime is unavailable for this board; REST fallback.
    // (not_joined can race a join in flight and is not a reason to give up.)
    if (!everJoined && (err?.code === "forbidden" || err?.code === "not_found")) handlers.onStatus("offline");
  });
  socket.on("whiteboard_elements", (msg: { boardId?: string; elements?: SyncElement[] } | undefined) => {
    if (msg?.boardId !== boardId || !Array.isArray(msg.elements)) return;
    handlers.onRemoteElements(msg.elements);
  });
  socket.on("whiteboard_ack", (msg: { boardId?: string; clientSeq?: number } | undefined) => {
    if (msg?.boardId !== boardId || typeof msg.clientSeq !== "number") return;
    handlers.onAck(msg.clientSeq);
  });
  socket.on("whiteboard_presence", (msg: { boardId?: string; collaborators?: CollaboratorInfo[] } | undefined) => {
    if (msg?.boardId !== boardId || !Array.isArray(msg.collaborators)) return;
    handlers.onPresence(msg.collaborators);
  });
  socket.on("whiteboard_pointer", (msg: RemotePointer | undefined) => {
    if (msg?.boardId !== boardId) return;
    handlers.onPointer(msg);
  });

  return {
    selfId: () => socket?.id ?? null,
    sendElements: (elements, clientSeq) => {
      if (!socket?.connected) return false;
      socket.emit("whiteboard_elements", { boardId, elements, clientSeq });
      return true;
    },
    sendPointer: (payload) => {
      if (!socket?.connected) return;
      socket.emit("whiteboard_pointer", { boardId, ...payload });
    },
    leave: () => {
      if (!socket) return;
      if (socket.connected) socket.emit("whiteboard_leave", { boardId });
      socket.disconnect();
      socket = null;
    },
  };
}
