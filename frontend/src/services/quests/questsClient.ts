import { getAuthToken } from "../api/client";

// REST client for the Onboarding Questline (backend/app/routers/quests.py). Same "chat backend"
// REST base (VITE_CHAT_SOCKET_URL) and the same dev-identity bypass as hubClient.ts. Read-only:
// progress is never written from the client — every quest event is recorded server-side from
// the authoritative action (see backend/app/services/quests/engine.py's hook list).

export type QuestMode = "once" | "unique_count";

export interface Quest {
  id: string;
  title: string;
  eventType: string;
  mode: QuestMode;
  target: number;
  order: number;
  count: number;
  completed: boolean;
  completedAt: string | null;
}

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the Onboarding Questline — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY: mirrors hubClient.ts's devEmail/setDevIdentity exactly.
let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

/** GET /quests/me — every registered quest with the caller's own progress, already in display
 * order (the server sorts by `order`, then id). */
export async function fetchMyQuests(): Promise<Quest[]> {
  const headers = new Headers();
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${socketBase()}/quests/me`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Quests request failed (${res.status})`);
  }
  const data = (await res.json()) as { quests: Quest[] };
  return data.quests;
}
