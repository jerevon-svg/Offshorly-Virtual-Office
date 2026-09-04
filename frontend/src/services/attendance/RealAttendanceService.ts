import { getAuthToken } from "../api/client";
import type { AttendanceRecord, AttendanceService } from "./types";

// REST client for backend/app/routers/attendance.py. Same "chat backend" base
// (VITE_CHAT_SOCKET_URL) and identity handling as hubClient.ts — attendance
// lives in the same FastAPI app as chat/hub, not on Atlas. The server derives
// the employee from the bearer token / dev header, so `employeeId` is unused
// here (it exists for the mock's storage key).

function socketBase(): string {
  const raw = import.meta.env.VITE_CHAT_SOCKET_URL;
  if (!raw) {
    throw new Error(
      "VITE_CHAT_SOCKET_URL is not set. Required when VITE_ATTENDANCE_MODE=real — see .env.example.",
    );
  }
  return raw.replace(/\/+$/, "");
}

// DEV-ONLY: mirrors hubClient.ts's devEmail/setDevIdentity exactly.
let devEmail: string | null = null;
export function setDevIdentity(email: string | null): void {
  devEmail = email ? email.trim().toLowerCase() : null;
}

async function restFetch(path: string, init: RequestInit = {}): Promise<AttendanceRecord> {
  const headers = new Headers(init.headers);
  if (devEmail) {
    headers.set("x-dev-email", devEmail);
  } else {
    const token = getAuthToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${socketBase()}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body?.error || body?.detail || `Attendance backend request failed (${res.status}) for ${path}`,
    );
  }
  return (await res.json()) as AttendanceRecord;
}

export class RealAttendanceService implements AttendanceService {
  getMine(_employeeId: string): Promise<AttendanceRecord> {
    return restFetch("/attendance/me");
  }

  checkIn(_employeeId: string): Promise<AttendanceRecord> {
    return restFetch("/attendance/check-in", { method: "POST" });
  }

  checkOut(_employeeId: string): Promise<AttendanceRecord> {
    return restFetch("/attendance/check-out", { method: "POST" });
  }
}

export const realAttendanceService = new RealAttendanceService();

// Test-only.
export function resetRealAttendanceServiceForTests(): void {
  devEmail = null;
}
