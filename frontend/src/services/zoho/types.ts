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

/** Why a submission failed, so the panel can word it accurately instead of
 *  showing one raw HTTP string for everything:
 *  - "entry-rejection": Atlas reported one or more entries could not be
 *    logged (per TimeLogFailure). Atlas does not tell us the upstream cause
 *    per entry — it may be a Zoho rejection, but could also be an upstream
 *    timeout or auth issue Atlas is relaying — so this must not be worded as
 *    a confirmed Zoho rejection.
 *  - "transport": no confirmed response — network error, timeout, or 5xx.
 *    Outcome UNKNOWN: the entries may or may not have reached Zoho, so a
 *    retry risks a duplicate. Never implies "Atlas is down" — a 5xx can mean
 *    missing upstream creds.
 *  - "auth": 401/403 from Atlas.
 *  - "validation": 422, or our own pre-flight guard (e.g. task-less entry).
 *  - "unknown": anything else — treat as outcome UNKNOWN, same as
 *    "transport", for retry-safety purposes. */
export type FailureKind = "entry-rejection" | "transport" | "auth" | "validation" | "unknown";

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
  /** Set by AtlasZohoService on any failure; absent on success. */
  kind?: FailureKind;
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
