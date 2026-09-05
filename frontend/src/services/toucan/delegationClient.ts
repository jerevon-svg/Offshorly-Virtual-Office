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

/** A3 — somebody declared a message urgent while Toucan covered for the viewer. Owner-only,
 *  like delegation_ended; carries what the panel needs to bump its counter and, later, to list
 *  the conversation on the return card. Never any message text. */
export interface DelegationUrgentEvent {
  flagId?: string | null;
  delegationId?: string | null;
  conversationId?: string | null;
  requesterEmail?: string | null;
  flaggedAt?: string | null;
  urgentCount?: number | null;
}

type Listener = (event: DelegationEndedEvent) => void;
type UrgentListener = (event: DelegationUrgentEvent) => void;
type ConnectedListener = () => void;

let socketInstance: Socket | null = null;
let devEmail: string | null = null;
const listeners = new Set<Listener>();
const urgentListeners = new Set<UrgentListener>();
const connectedListeners = new Set<ConnectedListener>();

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
  socket.on("delegation_urgent_flagged", (payload: DelegationUrgentEvent | undefined) => {
    const event = payload ?? {};
    for (const listener of urgentListeners) listener(event);
  });
  // A5 follow-up — the ONE lifecycle fact the proactive return briefing needs: this viewer's
  // socket has (re)connected, so the server has already run its arrival bookkeeping for it
  // (python-socketio awaits the connect handler before acknowledging the namespace), and a
  // GET /toucan/catchup issued now sees the frozen absence boundary. Fires on every connect,
  // including reconnects; the caller deduplicates on the server's `since`.
  socket.on("connect", () => {
    for (const listener of connectedListeners) listener();
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

/** A3 — subscribe to `delegation_urgent_flagged` for the signed-in viewer. Same socket, same
 *  owner-only guarantee, same "no channel means no events" behaviour as subscribeDelegationEnded. */
export function subscribeDelegationUrgent(listener: UrgentListener): () => void {
  urgentListeners.add(listener);
  try {
    ensureSocket();
  } catch {
    // No realtime channel; the counter still refreshes on reload.
  }
  return () => {
    urgentListeners.delete(listener);
  };
}

/** A5 follow-up — subscribe to this viewer's Toucan channel connecting. If the socket is already
 *  connected when subscribing, the listener fires once immediately (on a microtask) so a late
 *  subscriber is not left waiting for a reconnect that may never come. Same "no channel means no
 *  events" behaviour as the other subscriptions. */
export function subscribeToucanChannelConnected(listener: ConnectedListener): () => void {
  connectedListeners.add(listener);
  let socket: Socket | null = null;
  try {
    socket = ensureSocket();
  } catch {
    // No realtime channel; the manual "catch me up" path still works.
  }
  if (socket?.connected) {
    void Promise.resolve().then(() => {
      if (connectedListeners.has(listener)) listener();
    });
  }
  return () => {
    connectedListeners.delete(listener);
  };
}

export function resetDelegationClientForTests(): void {
  listeners.clear();
  urgentListeners.clear();
  connectedListeners.clear();
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
  devEmail = null;
}
