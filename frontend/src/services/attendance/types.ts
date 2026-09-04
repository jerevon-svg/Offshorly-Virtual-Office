// Attendance = the employee's WORK SESSION (checked in / checked out). It is
// server-authoritative (backend employee_attendance, routers/attendance.py) and
// deliberately independent of both connection state (sockets, tabs, refresh)
// and avatar location (employee_positions). Only a confirmed check-in or the
// existing explicit Log Time → Check Out flow changes it.
export type AttendanceStatus = "CHECKED_IN" | "CHECKED_OUT";

export interface AttendanceRecord {
  email: string;
  status: AttendanceStatus;
  // ISO-8601 (UTC "Z"). Null when never checked in / no session recorded.
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

export interface AttendanceService {
  /** Current attendance for this employee. Contract: no record yet reads as
   * CHECKED_OUT with null timestamps — never an error. */
  getMine(employeeId: string): Promise<AttendanceRecord>;
  /** Starts (or confirms the already-active) work session. Must resolve
   * CHECKED_IN before the caller starts any office-entry movement. */
  checkIn(employeeId: string): Promise<AttendanceRecord>;
  /** Ends the active work session. Only called from the existing checkout
   * flow once Log Time has completed. Idempotent. */
  checkOut(employeeId: string): Promise<AttendanceRecord>;
}
