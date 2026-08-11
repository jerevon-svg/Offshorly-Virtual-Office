import type {
  SubmitTimeLogsRequest,
  SubmitTimeLogsResult,
  ZohoProject,
  ZohoTask,
  ZohoTimeLoggingService,
} from "./types";

// Fake network latency to make the mock feel realistic in the debug/dev flow.
function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 300));
}

const PROJECTS: ZohoProject[] = [
  { id: "proj-moribian", name: "Moribian" },
  { id: "proj-offshorly-internal", name: "Offshorly Internal" },
  { id: "proj-zunou-ai", name: "Zunou AI" },
];

const TASKS: ZohoTask[] = [
  { id: "task-candidate-import-flow", projectId: "proj-moribian", name: "Candidate Import Flow" },
  { id: "task-import-exception-review", projectId: "proj-moribian", name: "Import Exception Review" },
  { id: "task-virtual-office", projectId: "proj-offshorly-internal", name: "Virtual Office" },
  { id: "task-internal-meeting", projectId: "proj-offshorly-internal", name: "Internal Meeting" },
  { id: "task-product-design", projectId: "proj-zunou-ai", name: "Product Design" },
  { id: "task-ai-agent-design", projectId: "proj-zunou-ai", name: "AI Agent Design" },
];

// Options a caller (e.g. the dev debug panel) can pass to force a specific
// failure mode on submitTimeLogs without reaching into module internals.
export interface MockSubmitOptions {
  forceFail?: boolean;
  forceTimeout?: boolean;
}

// Idempotency ownership: MockZohoService does NOT dedup by itself — it has
// no notion of "already submitted today". Dedup/idempotency for
// employeeId+workDate is owned by checkoutStorage.ts (isAlreadyCheckedOut +
// loadResult), which the checkout hook consults before calling submit again.
// This service always returns a deterministic submissionId for a given
// employeeId+workDate pair so repeated calls (if they ever happen) are
// at least stable/inspectable, but the actual "don't submit twice" guard
// lives in the storage layer.
export class MockZohoService implements ZohoTimeLoggingService {
  async getProjects(_employeeId: string): Promise<ZohoProject[]> {
    await delay();
    return PROJECTS;
  }

  async getTasks(_employeeId: string, projectId: string): Promise<ZohoTask[]> {
    await delay();
    return TASKS.filter((t) => t.projectId === projectId);
  }

  async submitTimeLogs(
    request: SubmitTimeLogsRequest,
    opts?: MockSubmitOptions,
  ): Promise<SubmitTimeLogsResult> {
    await delay();

    if (opts?.forceTimeout) {
      // Simulate a hang that never resolves — the caller's own timeout/UI
      // logic (Pass B) is expected to handle this.
      await new Promise(() => {});
    }

    if (opts?.forceFail) {
      return { success: false, error: "Simulated Zoho submission failure (debug panel)" };
    }

    return {
      success: true,
      submissionId: `mock-zoho-log-${request.employeeId}-${request.workDate}`,
      submittedAt: new Date().toISOString(),
      entriesCreated: request.entries.length,
    };
  }
}

export const mockZohoService = new MockZohoService();
