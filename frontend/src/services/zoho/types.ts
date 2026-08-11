// Shared Zoho time-logging types. Kept framework-agnostic (no React) so
// both Mock/Mcp service implementations and the checkout hook can share them.

export interface ZohoProject {
  id: string;
  name: string;
}

export interface ZohoTask {
  id: string;
  projectId: string;
  name: string;
}

export interface TimeLogEntry {
  projectId: string | null;
  taskId: string | null;
  category: string | null;
  timeSpentMinutes: number;
  workDescription: string;
  // Optional so existing callers (and MockZohoService) are unaffected;
  // AtlasZohoService sends `true` when unset, matching the backend default.
  billable?: boolean;
}

/** One entry Zoho rejected while others succeeded. Zoho has no
 *  transaction, so a partial submission keeps what worked and reports the
 *  rest — the UI must not show a success card when this is non-empty. */
export interface TimeLogFailure {
  taskId: string;
  error: string;
}

export interface SubmitTimeLogsRequest {
  employeeId: string;
  workDate: string;
  entries: TimeLogEntry[];
}

export interface SubmitTimeLogsResult {
  success: boolean;
  submissionId?: string;
  submittedAt?: string;
  entriesCreated?: number;
  error?: string;
  /** Populated by AtlasZohoService on a partial failure. */
  failures?: TimeLogFailure[];
}

export interface ZohoTimeLoggingService {
  getProjects(employeeId: string): Promise<ZohoProject[]>;
  getTasks(employeeId: string, projectId: string): Promise<ZohoTask[]>;
  submitTimeLogs(request: SubmitTimeLogsRequest): Promise<SubmitTimeLogsResult>;
}

// Approved non-project categories a worker can log time against instead of
// a project+task pairing (e.g. "Meetings").
export const APPROVED_CATEGORIES = [
  "Internal work",
  "Meetings",
  "Training",
  "Administrative work",
  "Non-billable work",
] as const;
