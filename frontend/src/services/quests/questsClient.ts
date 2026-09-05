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

// ---- Daily/Weekly Missions (backend/app/routers/missions.py) --------------------------------
// Same base, same identity rules, same read-only contract as /quests/me: the server draws and
// pins the missions, derives periods in UTC from its own clock, and recounts progress from the
// ledger. The client only renders. `endsAt` is when the period resets.

export type MissionCadence = "daily" | "weekly";
export type MissionMode = "once" | "unique_count" | "unique_days";

export interface Mission {
  id: string;
  title: string;
  eventType: string;
  mode: MissionMode;
  target: number;
  cadence: MissionCadence;
  count: number;
  completed: boolean;
  completedAt: string | null;
}

export interface MissionPeriod {
  cadence: MissionCadence;
  periodKey: string;
  startsAt: string;
  endsAt: string;
  missions: Mission[];
}

export interface MyMissions {
  serverTime: string;
  daily: MissionPeriod;
  weekly: MissionPeriod;
}

function authHeaders(): Headers {
  const headers = new Headers();
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

/** GET /missions/me — the caller's active daily + weekly missions for the current server periods. */
export async function fetchMyMissions(): Promise<MyMissions> {
  const res = await fetch(`${socketBase()}/missions/me`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || body?.detail || `Missions request failed (${res.status})`);
  }
  return (await res.json()) as MyMissions;
}
