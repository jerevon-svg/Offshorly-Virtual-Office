import { getAuthToken } from "../api/client";

// REST client for the Company Hub V1 feature (backend/app/routers/hub.py,
// backend/app/repositories/hub.py). Same "chat backend" REST base
// (VITE_CHAT_SOCKET_URL) as requestsClient.ts — the Hub lives in the same FastAPI app as
// chat/requests, not on Atlas. No socket — the Hub is fetched on check-in and on manual
// reopen, not kept live.

export type HubItemType = "announcement" | "birthday" | "recognition" | "survey" | "whatsnew";
export type HubItemPriority = "normal" | "important" | "required";
export type HubItemMyStatus = "unseen" | "seen" | "dismissed" | "acknowledged";

export interface HubItem {
  id: string;
  type: HubItemType;
  title: string;
  description: string;
  imageUrl: string | null;
  startAt: string;
  endAt: string | null;
  priority: HubItemPriority;
  ctaLabel: string | null;
  ctaAction: string | null;
  audienceEmail: string | null;
  createdAt: string;
  updatedAt: string;
  myStatus: HubItemMyStatus;
  myActed: boolean;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the Company Hub feature — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY: mirrors requestsClient.ts's devEmail/setDevIdentity exactly — see that module's
// comment for the full rationale.
let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
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
    throw new Error(body?.error || body?.detail || `Hub backend request failed (${res.status}) for ${path}`);
  }
  return res;
}

/** GET /hub/items — every item currently active for this employee, merged with their own
 * seen/dismissed/acknowledged state. Required-priority items sort first. */
export async function fetchHubItems(): Promise<HubItem[]> {
  const res = await restFetch("/hub/items");
  return res.json();
}

export async function dismissHubItem(id: string): Promise<HubItem> {
  const res = await restFetch(`/hub/items/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
  return res.json();
}

export async function acknowledgeHubItem(id: string): Promise<HubItem> {
  const res = await restFetch(`/hub/items/${encodeURIComponent(id)}/acknowledge`, { method: "POST" });
  return res.json();
}

/** POST /hub/items/{id}/action — the item's CTA (Read More / Wish Happy Birthday /
 * Congratulate / Answer Survey / See What's New). Persists the interaction without forcing
 * dismissed/acknowledged. */
export async function actOnHubItem(id: string): Promise<HubItem> {
  const res = await restFetch(`/hub/items/${encodeURIComponent(id)}/action`, { method: "POST" });
  return res.json();
}

/** POST /hub/dev/reset-my-state — dev-only demo control. Wipes the caller's own seen/
 * dismissed/acknowledged/acted state on [DEV]-tagged Hub items only, so a required item can be
 * re-demoed without waiting for a new item. The backend independently 404s this outside
 * development (see routers/hub.py) — callers should still gate the UI entry point on
 * import.meta.env.DEV so it's not even offered in a production build. */
export async function resetDevHubState(): Promise<{ resetCount: number }> {
  const res = await restFetch("/hub/dev/reset-my-state", { method: "POST" });
  return res.json();
}

// Test-only: module state (devEmail) outlives a single test.
export function resetHubClientForTests(): void {
  devEmail = null;
}
