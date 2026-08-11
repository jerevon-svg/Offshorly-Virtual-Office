import { beforeEach, describe, expect, it, vi } from "vitest";
import { AtlasZohoService, isAlreadySubmittedError } from "./AtlasZohoService";

// apiFetch is mocked at the module boundary: these tests are about the
// request we build and the response we interpret, not about auth plumbing.
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ apiFetch }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TASK_ROWS = [
  {
    project_id: "proj-1",
    project_name: "Moribian",
    task_id: "task-a",
    task_name: "Candidate Import",
  },
  {
    project_id: "proj-1",
    project_name: "Moribian",
    task_id: "task-b",
    task_name: "Exception Review",
  },
  {
    project_id: "proj-2",
    project_name: "Zunou AI",
    task_id: "task-c",
    task_name: "Product Design",
  },
];

describe("AtlasZohoService task loading", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.resetModules();
  });

  it("derives a deduped project list from the task feed", async () => {
    apiFetch.mockResolvedValue(jsonResponse(TASK_ROWS));
    const { AtlasZohoService: Svc } = await import("./AtlasZohoService");
    const projects = await new Svc().getProjects("me");
    expect(projects).toEqual([
      { id: "proj-1", name: "Moribian" },
      { id: "proj-2", name: "Zunou AI" },
    ]);
  });

  it("filters tasks to the chosen project", async () => {
    apiFetch.mockResolvedValue(jsonResponse(TASK_ROWS));
    const { AtlasZohoService: Svc } = await import("./AtlasZohoService");
    const svc = new Svc();
    const tasks = await svc.getTasks("me", "proj-1");
    expect(tasks.map((t) => t.id)).toEqual(["task-a", "task-b"]);
  });

  it("fetches the task feed once for concurrent callers", async () => {
    apiFetch.mockResolvedValue(jsonResponse(TASK_ROWS));
    const { AtlasZohoService: Svc } = await import("./AtlasZohoService");
    const svc = new Svc();
    await Promise.all([svc.getProjects("me"), svc.getTasks("me", "proj-1")]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure permanently", async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse({}, 500));
    const { AtlasZohoService: Svc } = await import("./AtlasZohoService");
    const svc = new Svc();
    await expect(svc.getProjects("me")).rejects.toThrow();

    apiFetch.mockResolvedValueOnce(jsonResponse(TASK_ROWS));
    await expect(svc.getProjects("me")).resolves.toHaveLength(2);
  });
});

describe("AtlasZohoService.submitTimeLogs", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.resetModules();
  });

  async function submit(response: Response, entries?: unknown[]) {
    apiFetch.mockResolvedValue(response);
    const { AtlasZohoService: Svc } = await import("./AtlasZohoService");
    return new Svc().submitTimeLogs({
      employeeId: "me",
      workDate: "2026-08-11",
      entries: (entries ?? [
        {
          projectId: "proj-1",
          taskId: "task-a",
          category: null,
          timeSpentMinutes: 90,
          workDescription: "Did the thing",
        },
      ]) as never,
    });
  }

  it("sends the backend's snake_case shape and defaults billable to true", async () => {
    await submit(
      jsonResponse({
        success: true,
        submission_id: "vo-1",
        submitted_at: "2026-08-11T10:00:00Z",
        entries_created: 1,
        failures: [],
      }),
    );
    const [path, init] = apiFetch.mock.calls[0];
    expect(path).toBe("/api/v1/office/my-timelogs");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.work_date).toBe("2026-08-11");
    expect(body.entries[0]).toMatchObject({
      task_id: "task-a",
      time_spent_minutes: 90,
      work_description: "Did the thing",
      // Not sent by the caller — must default to billable, matching Zoho.
      billable: true,
    });
  });

  it("passes an explicit billable:false through", async () => {
    await submit(
      jsonResponse({
        success: true,
        submission_id: "vo-1",
        submitted_at: "2026-08-11T10:00:00Z",
        entries_created: 1,
        failures: [],
      }),
      [
        {
          projectId: "proj-1",
          taskId: "task-a",
          category: null,
          timeSpentMinutes: 60,
          workDescription: "",
          billable: false,
        },
      ],
    );
    const body = JSON.parse(
      (apiFetch.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.entries[0].billable).toBe(false);
  });

  it("throws AlreadySubmittedError on 409, carrying the prior submission", async () => {
    // A duplicate is a normal outcome, not a failure — the UI shows the
    // earlier submission rather than an error panel.
    const result = submit(
      jsonResponse(
        {
          detail: {
            message: "Time has already been submitted for this date.",
            submission_id: "vo-earlier",
            entries_created: 3,
          },
        },
        409,
      ),
    );
    // Asserted via the guard, not instanceof: vi.resetModules() gives each
    // dynamic import its own class object, and the app has the same hazard
    // across bundle chunks — which is exactly why the guard exists.
    await result.catch((err: unknown) => {
      expect(isAlreadySubmittedError(err)).toBe(true);
      if (isAlreadySubmittedError(err)) {
        expect(err.submissionId).toBe("vo-earlier");
        expect(err.entriesCreated).toBe(3);
      }
    });
    await expect(result).rejects.toThrow(/already been submitted/i);
  });

  it("reports a partial failure as NOT successful", async () => {
    // The regression this guards: recomputing success from entries_created
    // would render a success card for a half-logged day.
    const result = await submit(
      jsonResponse({
        success: false,
        submission_id: "vo-2",
        submitted_at: "2026-08-11T10:00:00Z",
        entries_created: 1,
        failures: [{ task_id: "task-b", error: "That task is not assigned to you." }],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.entriesCreated).toBe(1);
    expect(result.failures).toEqual([
      { taskId: "task-b", error: "That task is not assigned to you." },
    ]);
    expect(result.error).toContain("could not be logged");
  });

  it("returns a failure result for an unexpected HTTP error", async () => {
    const result = await submit(jsonResponse({}, 500));
    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });
});

describe("AtlasZohoService instances", () => {
  it("implements the shared service interface", () => {
    const svc = new AtlasZohoService();
    expect(typeof svc.getProjects).toBe("function");
    expect(typeof svc.getTasks).toBe("function");
    expect(typeof svc.submitTimeLogs).toBe("function");
  });
});
