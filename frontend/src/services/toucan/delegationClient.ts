import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";

// A2.2 — the ONE realtime fact the Toucan panel needs about delegation: the server says the
// viewer's delegation ended (cancelled elsewhere, replaced, or found expired). Opens its OWN
// socket, mirroring presence/dndClient.ts's documented rationale (RealChatService keeps its
// socket private; one event does not justify refactoring it to share). The server emits
// `delegation_ended` only to the owner's per-user room, so nothing here ever sees anybody
// else's delegation.

export interface DelegationEndedEvent {
  delegationId?: string | null;
  reason?: string | null;
}

type Listener = (event: DelegationEndedEvent) => void;

let socketInstance: Socket | null = null;
let devEmail: string | null = null;
const listeners = new Set<Listener>();

function socketBase(): string | null {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  return raw ? String(raw).replace(/\/+$/, "") : null;
}

/** DEV-ONLY: mirrors dndClient.ts's setDevIdentity exactly. */
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

function ensureSocket(): Socket | null {
  if (socketInstance) return socketInstance;
  const base = socketBase();
  if (!base) return null;
  if (!devEmail && !getAuthToken()) return null;
  const auth: Record<string, string | null> = devEmail ? { "x-dev-email": devEmail } : { token: getAuthToken() };
  const socket = io(base, { auth, autoConnect: true });
  socket.on("delegation_ended", (payload: DelegationEndedEvent | undefined) => {
    const event = payload ?? {};
    for (const listener of listeners) listener(event);
  });
  socketInstance = socket;
  return socket;
}

/** Subscribe to `delegation_ended` for the signed-in viewer. Returns the unsubscribe. A missing
 *  socket URL or identity (tests, mock mode) simply means no events — never an error. */
export function subscribeDelegationEnded(listener: Listener): () => void {
  listeners.add(listener);
  try {
    ensureSocket();
  } catch {
    // No realtime channel available; the banner still clears on Stop and on reload.
  }
  return () => {
    listeners.delete(listener);
  };
}

export function resetDelegationClientForTests(): void {
  listeners.clear();
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
  devEmail = null;
}
