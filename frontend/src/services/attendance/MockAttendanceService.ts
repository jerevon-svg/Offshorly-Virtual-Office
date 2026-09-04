import type { AttendanceRecord, AttendanceService } from "./types";

// Mock attendance for backend-less development. Persisted in localStorage
// (per employee, NOT per day) so the refresh / close-and-reopen scenarios can
// be exercised without the FastAPI backend. Same contract as the real service:
// no record reads as CHECKED_OUT with null timestamps.

function storageKey(employeeId: string): string {
  return `attendance:${employeeId}`;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read(employeeId: string): AttendanceRecord {
  const empty: AttendanceRecord = {
    email: employeeId,
    status: "CHECKED_OUT",
    checkedInAt: null,
    checkedOutAt: null,
  };
  if (!hasStorage()) return empty;
  try {
    const raw = window.localStorage.getItem(storageKey(employeeId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<AttendanceRecord>;
    return {
      email: employeeId,
      status: parsed.status === "CHECKED_IN" ? "CHECKED_IN" : "CHECKED_OUT",
      checkedInAt: parsed.checkedInAt ?? null,
      checkedOutAt: parsed.checkedOutAt ?? null,
    };
  } catch {
    return empty;
  }
}

function write(record: AttendanceRecord): AttendanceRecord {
  if (hasStorage()) {
    try {
      window.localStorage.setItem(storageKey(record.email), JSON.stringify(record));
    } catch {
      // Quota/private-mode failures degrade to in-memory-only for this call.
    }
  }
  return record;
}

export class MockAttendanceService implements AttendanceService {
  async getMine(employeeId: string): Promise<AttendanceRecord> {
    return read(employeeId);
  }

  async checkIn(employeeId: string): Promise<AttendanceRecord> {
    const current = read(employeeId);
    if (current.status === "CHECKED_IN") return current;
    return write({
      email: employeeId,
      status: "CHECKED_IN",
      checkedInAt: new Date().toISOString(),
      checkedOutAt: null,
    });
  }

  async checkOut(employeeId: string): Promise<AttendanceRecord> {
    const current = read(employeeId);
    if (current.status === "CHECKED_OUT") return current;
    return write({ ...current, status: "CHECKED_OUT", checkedOutAt: new Date().toISOString() });
  }
}

export const mockAttendanceService = new MockAttendanceService();

// Test-only: wipe one employee's mock record.
export function resetMockAttendanceForTests(employeeId: string): void {
  if (hasStorage()) window.localStorage.removeItem(storageKey(employeeId));
}
