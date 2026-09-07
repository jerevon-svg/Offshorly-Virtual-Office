import { getAuthToken } from "../api/client";
import type { GeoFix, TeamMapService, TeamMapSnapshot, WorkingTodayShare } from "./types";

// Talks to the VO backend's /team-map routes — NEVER to Atlas directly. The backend is the
// privacy boundary (it reads Atlas's map as the caller and coarsens it, and snaps a Working
// Today fix before persisting); the browser only ever sees projected results. Same base-URL +
// identity pattern as attendance/RealAttendanceService.

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required for the Global Team Map — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

let devEmail: string | null = null;

export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${socketBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new Error(`Team map request failed (${res.status})`);
  }
  return res;
}

export class RealTeamMapService implements TeamMapService {
  async getPeople(): Promise<TeamMapSnapshot> {
    const res = await request("/team-map/people");
    return (await res.json()) as TeamMapSnapshot;
  }

  async shareWorkingToday(fix: GeoFix): Promise<WorkingTodayShare> {
    const res = await request("/team-map/working-today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: fix.latitude, longitude: fix.longitude }),
    });
    return (await res.json()) as WorkingTodayShare;
  }

  async stopWorkingToday(): Promise<void> {
    await request("/team-map/working-today/stop", { method: "POST" });
  }

  async forgetWorkingToday(): Promise<void> {
    await request("/team-map/working-today", { method: "DELETE" });
  }
}

export const realTeamMapService = new RealTeamMapService();

export function resetRealTeamMapServiceForTests(): void {
  devEmail = null;
}
