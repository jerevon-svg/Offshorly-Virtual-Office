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
