import { useEffect, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../api/client";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setDevIdentity as setClientDevIdentity,
  type AppNotification,
} from "./notificationsClient";

// THE ONE client-side copy of the viewer's notifications, in the same module-store idiom as
// services/quests/progressionStore.ts. Every surface reads it through useNotifications(); nobody
// keeps a private useState of the bell.
//
// THE SERVER IS AUTHORITATIVE. Two ways state arrives, never three:
//   1. GET /notifications/me — on first subscribe, on tab focus, on `online`, and on every
//      socket (re)connect. This is what makes the bell survive a refresh and a reconnect: the
//      client never persists anything locally, it re-asks.
//   2. The `notification_new` socket event — the same object shape a fetch returns, so a live
//      notification takes no second code path.
// Read actions are optimistic in the list (the row greys out at once) but the COUNT always
// comes back from the server's response, so the badge can never drift from the database.
//
// OWN CONNECTION, on purpose: mirrors services/presence/dndClient.ts's documented rationale
// exactly — RealChatService keeps its socket entirely private, and this feature's needs don't
// justify refactoring that. It joins no rooms and emits nothing; the server pushes to the
// per-user room every connection already joins (backend/app/realtime/socket.py's connect
// handler), so there is no new socket plumbing on either side.

const NOTIFICATION_NEW = "notification_new";

// Same one-shot-identity hazard notificationsClient.ts documents, for THIS module's own copy:
// `devEmail` below is what ensureSocket() authenticates the realtime connection with, and
// useAuthGate seeds it exactly once at gate time. A hot update here re-executes the module,
// resets it to null and drops the socket identity with no way to get it back — so this module
// takes the identical accept()-then-reload guard. `accept()` is what makes the module
// self-accepting; without it Vite's server ignores an invalidate() entirely (see the long note
// in notificationsClient.ts). Dev only.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

export interface NotificationsSnapshot {
  notifications: AppNotification[];
  unreadCount: number;
  /** True until the first fetch settles — lets the panel distinguish "empty" from "not asked". */
  loading: boolean;
  error: string | null;
}

const EMPTY: NotificationsSnapshot = { notifications: [], unreadCount: 0, loading: true, error: null };

let snapshot: NotificationsSnapshot = EMPTY;
let socketInstance: Socket | null = null;
let inflight: Promise<void> | null = null;
let devEmail: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function set(next: Partial<NotificationsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNotificationsSnapshot(): NotificationsSnapshot {
  return snapshot;
}

/** Seeds BOTH this store and its REST client, so callers wire one dev identity, not two. */
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
  setClientDevIdentity(email);
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

/** Re-asks the server. Coalesced: concurrent callers (mount + focus + reconnect firing at once)
 * share one request rather than racing three responses into the store. */
export function refreshNotifications(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetchNotifications()
    .then((data) => {
      set({
        notifications: data.notifications,
        unreadCount: data.unreadCount,
        loading: false,
        error: null,
      });
    })
    .catch((err: unknown) => {
      set({ loading: false, error: err instanceof Error ? err.message : "Couldn't load notifications" });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function onIncoming(payload: { notification?: AppNotification; unreadCount?: number } | undefined): void {
  const incoming = payload?.notification;
  if (!incoming?.id) return;
  // De-duplicated by id: a second tab, a reconnect racing a fetch, or a re-delivered event must
  // not add the same notification twice.
  const rest = snapshot.notifications.filter((n) => n.id !== incoming.id);
  set({
    notifications: [incoming, ...rest],
    unreadCount: typeof payload?.unreadCount === "number" ? payload.unreadCount : snapshot.unreadCount + 1,
    loading: false,
  });
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error("VITE_CHAT_SOCKET_URL is not set. Required for Global Notifications — see .env.example.");
  }
  return raw.replace(/\/+$/, "");
}

function ensureSocket(): Socket | null {
  if (socketInstance) return socketInstance;
  if (!devEmail && !getAuthToken()) return null;

  const auth: Record<string, string | null> = devEmail ? { "x-dev-email": devEmail } : { token: getAuthToken() };
  const socket = io(socketBase(), { auth, autoConnect: true });
  socket.on(NOTIFICATION_NEW, onIncoming);
  // A reconnect may have missed pushes while the socket was down, so the authoritative list is
  // re-fetched rather than assumed intact. Fires on the first connect too, which is harmless:
  // refreshNotifications coalesces it with the mount fetch.
  socket.on("connect", () => {
    void refreshNotifications();
  });
  socketInstance = socket;
  return socket;
}

/** Marks one notification read. Optimistic in the list; the badge value is the server's. */
export async function markRead(id: string): Promise<void> {
  const already = snapshot.notifications.find((n) => n.id === id)?.readAt;
  if (!already) {
    const at = new Date().toISOString();
    set({ notifications: snapshot.notifications.map((n) => (n.id === id ? { ...n, readAt: at } : n)) });
  }
  try {
    const { unreadCount } = await markNotificationRead(id);
    set({ unreadCount });
  } catch {
    // The row stays greyed out but the count is now unknown — re-ask instead of guessing.
    void refreshNotifications();
  }
}

export async function markAllRead(): Promise<void> {
  const at = new Date().toISOString();
  set({ notifications: snapshot.notifications.map((n) => (n.readAt ? n : { ...n, readAt: at })), unreadCount: 0 });
  try {
    const { unreadCount } = await markAllNotificationsRead();
    set({ unreadCount });
  } catch {
    void refreshNotifications();
  }
}

/** Subscribable hook. Establishes the connection and does the first fetch on first mount, then
 * re-fetches whenever the tab regains focus or the browser comes back online. */
export function useNotifications(): NotificationsSnapshot {
  useEffect(() => {
    ensureSocket();
    void refreshNotifications();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshNotifications();
    };
    const onOnline = () => void refreshNotifications();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return useSyncExternalStore(subscribe, getNotificationsSnapshot, getNotificationsSnapshot);
}

// Test-only: module state outlives a single test.
export function resetNotificationsStoreForTests(): void {
  socketInstance?.disconnect?.();
  socketInstance = null;
  inflight = null;
  devEmail = null;
  snapshot = EMPTY;
  setClientDevIdentity(null);
  emit();
}

// Test-only seam: hands a fake socket the same `notification_new` payload the server sends.
export function __deliverForTests(payload: { notification?: AppNotification; unreadCount?: number }): void {
  onIncoming(payload);
}
