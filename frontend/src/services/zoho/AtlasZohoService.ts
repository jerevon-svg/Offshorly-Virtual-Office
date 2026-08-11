import { apiFetch } from "../api/client";
import type {
  SubmitTimeLogsRequest,
  SubmitTimeLogsResult,
  ZohoProject,
  ZohoTask,
  ZohoTimeLoggingService,
} from "./types";

// Real time-logging, through Atlas's backend.
//
// The browser never talks to Zoho directly and never holds Zoho
// credentials — Atlas owns the OAuth connection and writes the entries with
// an admin token, attributing them to the real person. That is why this
// replaces McpZohoService rather than implementing it: an SPA cannot hold
// those credentials, so "via MCP from the client" was never viable.
//
// Backend contract: docs/OFFICE_TIMELOG_IMPLEMENTATION.md in the Atlas repo.
//   GET  /api/v1/office/my-tasks
//   POST /api/v1/office/my-timelogs

interface MyTaskRow {
  project_id: string;
  project_name: string;
  task_id: string;
  task_name: string;
}

// One flat task list backs both getProjects and getTasks — Atlas returns
// each task with its project inline, and a person's open task list is small
// enough that a second endpoint would only add a round trip. Cached for the
// lifetime of the page so opening the picker twice doesn't refetch.
let taskCache: Promise<MyTaskRow[]> | null = null;

async function fetchMyTasks(): Promise<MyTaskRow[]> {
  const response = await apiFetch("/api/v1/office/my-tasks");
  if (!response.ok) {
    throw new Error(`Could not load your tasks (HTTP ${response.status}).`);
  }
  return (await response.json()) as MyTaskRow[];
}

function myTasks(): Promise<MyTaskRow[]> {
  // Cache the PROMISE, not the result, so two concurrent callers share one
  // request. Cleared on failure so an error isn't cached forever.
  if (!taskCache) {
    taskCache = fetchMyTasks().catch((err: unknown) => {
      taskCache = null;
      throw err;
    });
  }
  return taskCache;
}

/** Thrown when Atlas reports time was already submitted for this date.
 *  Distinguishable so the UI can show the prior submission rather than an
 *  error panel — a duplicate is a normal outcome, not a failure. */
export class AlreadySubmittedError extends Error {
  readonly submissionId: string;
  readonly entriesCreated: number;

  constructor(submissionId: string, entriesCreated: number) {
    super("Time has already been submitted for this date.");
    this.name = "AlreadySubmittedError";
    this.submissionId = submissionId;
    this.entriesCreated = entriesCreated;
  }
}

// Use this rather than `instanceof` at call sites. `instanceof` compares
// class IDENTITY, so it silently returns false if this module is ever
// evaluated twice — separate bundle chunks, or a test runner resetting the
// module registry. The failure mode is bad: a duplicate submission would
// fall through to the generic error branch and be shown as "submission
// failed", telling someone their day did not log when in fact it already
// had.
export function isAlreadySubmittedError(
  err: unknown,
): err is AlreadySubmittedError {
  return err instanceof Error && err.name === "AlreadySubmittedError";
}

export class AtlasZohoService implements ZohoTimeLoggingService {
  async getProjects(_employeeId: string): Promise<ZohoProject[]> {
    const rows = await myTasks();
    const byId = new Map<string, ZohoProject>();
    for (const row of rows) {
      if (!byId.has(row.project_id)) {
        byId.set(row.project_id, { id: row.project_id, name: row.project_name });
      }
    }
    return [...byId.values()];
  }

  async getTasks(_employeeId: string, projectId: string): Promise<ZohoTask[]> {
    const rows = await myTasks();
    return rows
      .filter((row) => row.project_id === projectId)
      .map((row) => ({
        id: row.task_id,
        projectId: row.project_id,
        name: row.task_name,
      }));
  }

  async submitTimeLogs(
    request: SubmitTimeLogsRequest,
  ): Promise<SubmitTimeLogsResult> {
    const response = await apiFetch("/api/v1/office/my-timelogs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        work_date: request.workDate,
        entries: request.entries.map((entry) => ({
          task_id: entry.taskId,
          time_spent_minutes: entry.timeSpentMinutes,
          work_description: entry.workDescription,
          // Defaults to billable when the caller doesn't say (decision 3).
          billable: entry.billable ?? true,
        })),
      }),
    });

    if (response.status === 409) {
      const body = (await response.json()) as {
        detail?: { submission_id?: string; entries_created?: number };
      };
      throw new AlreadySubmittedError(
        body.detail?.submission_id ?? "",
        body.detail?.entries_created ?? 0,
      );
    }

    if (!response.ok) {
      return {
        success: false,
        error: `Submission failed (HTTP ${response.status}).`,
      };
    }

    const body = (await response.json()) as {
      success: boolean;
      submission_id: string;
      submitted_at: string;
      entries_created: number;
      failures: { task_id: string; error: string }[];
    };

    // `success` mirrors the backend exactly: it is false whenever ANY entry
    // failed, even though others landed. Do not recompute it from
    // entries_created — a partial day must never render as a success.
    return {
      success: body.success,
      submissionId: body.submission_id,
      submittedAt: body.submitted_at,
      entriesCreated: body.entries_created,
      failures: body.failures.map((f) => ({ taskId: f.task_id, error: f.error })),
      error: body.success
        ? undefined
        : `${body.failures.length} of ${request.entries.length} entries could not be logged.`,
    };
  }
}

export const atlasZohoService = new AtlasZohoService();
