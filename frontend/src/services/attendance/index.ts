import { mockAttendanceService } from "./MockAttendanceService";
import { realAttendanceService } from "./RealAttendanceService";
import type { AttendanceService } from "./types";

export * from "./types";
export { MockAttendanceService, mockAttendanceService, resetMockAttendanceForTests } from "./MockAttendanceService";
export { RealAttendanceService, realAttendanceService, setDevIdentity } from "./RealAttendanceService";

export type AttendanceMode = "mock" | "real";

// Explicit opt-in like VITE_TOUCAN_MODE — never inferred from VITE_CHAT_SOCKET_URL,
// so existing environments keep the localStorage mock until they choose "real".
function resolveMode(): AttendanceMode {
  return import.meta.env.VITE_ATTENDANCE_MODE === "real" ? "real" : "mock";
}

export const attendanceMode: AttendanceMode = resolveMode();

export const attendanceService: AttendanceService =
  attendanceMode === "real" ? realAttendanceService : mockAttendanceService;
