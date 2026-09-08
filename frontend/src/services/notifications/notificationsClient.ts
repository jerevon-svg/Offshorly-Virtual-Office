import { getAuthToken } from "../api/client";

// REST client for Global Notifications V1 (backend/app/routers/notifications.py). Same "chat
// backend" REST base (VITE_CHAT_SOCKET_URL) and the same dev-identity bypass as
// feedClient.ts/questsClient.ts — notifications live in the same FastAPI app as chat/feed/hub.
//
// WRITE-LIMITED BY DESIGN: a client can only mark things read. Notifications are never created
// from here — every one is written server-side from the authoritative action, so nothing in the
// browser can invent a notification or the reward wording inside one.

/** The destinations the client knows how to open. Anything else the server sends is listed and
 * marked read, but navigates nowhere — see NotificationCenter.tsx's `navigate`. */
export type NavKind = "profile_feed" | "conversation" | "quests" | "missions" | "achievements" | "hub";

export interface AppNotification {
  id: string;
  /** Discriminator, e.g. "kudos_received". Open-ended: unknown types still render. */
  type: string;
  title: string;
  body: string | null;
  /** Null, a known NavKind, or a kind this build does not recognise yet. */
  navKind: NavKind | string | null;
  navPayload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  notifications: AppNotification[];
  /** Counted server-side over everything, so it is never capped by the fetched window. */
  unreadCount: number;
}

export interface UnreadResult {
  unreadCount: number;
  updated: number;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for Global Notifications — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY: mirrors feedClient.ts's/questsClient.ts's devEmail/setDevIdentity exactly.
let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

// `devEmail` above is module-level state that useAuthGate seeds EXACTLY ONCE, at gate time (see
// seedDevBypassIdentity). In dev, a Vite hot update RE-EXECUTES this module and resets it to
// null — the gate has long since run and never re-seeds it, so the next notifications request goes out with
// neither the dev header nor a bearer token and the backend answers "Missing Authorization
// bearer token". The only correct recovery is a full page reload, which re-runs the gate.
//
// `import.meta.hot.invalidate()` ON ITS OWN DOES NOT DO THAT — and that is exactly why this bug
// survived a guard that read as if it did. Vite's dev server ignores an invalidate unless the
// module is SELF-ACCEPTING: `invalidateModule()` is gated on
// `mod.isSelfAccepting && mod.lastHMRTimestamp > 0`, and a module only becomes self-accepting by
// calling `import.meta.hot.accept()`. With no accept() anywhere in the file, the invalidate was
// a silent no-op: the module still re-executed, the identity was still lost, and no reload ever
// happened.
//
// So accept the update — which makes this module self-accepting and stops the update here — and
// then immediately throw it away as an explicit full reload. Deterministic, with no reliance on
// Vite's propagation heuristics. Dev only: `import.meta.hot` is undefined in a production build,
// where module state is never re-executed anyway.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

async function restFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${socketBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Notifications request failed (${res.status}) for ${path}`);
  }
  return res;
}

/** GET /notifications/me — newest first, plus the exact unread count. */
export async function fetchNotifications(): Promise<NotificationList> {
  const res = await restFetch("/notifications/me");
  return res.json();
}

/** Idempotent server-side; safe to call on every click, including clicks that navigate nowhere. */
export async function markNotificationRead(id: string): Promise<UnreadResult> {
  const res = await restFetch(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
  return res.json();
}

export async function markAllNotificationsRead(): Promise<UnreadResult> {
  const res = await restFetch("/notifications/read-all", { method: "POST" });
  return res.json();
}
