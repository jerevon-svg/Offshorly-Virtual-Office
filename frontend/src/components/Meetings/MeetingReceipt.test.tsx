import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  IntelligenceItem,
  LatestIntelligence,
  MeetingSessionInfo,
  RunSummary,
} from "../../services/meetings/meetingReceiptClient";

// PHASE 7C — the Meeting Receipt renders the server's answer: actual attendance (never invitees), the latest
// successful run's items with their evidence in order, the effective (human-reviewed) content, curator-only
// review controls, and calm stale / empty / unavailable states.

const api = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  fetchLatest: vi.fn(),
  fetchRuns: vi.fn(),
  generateIntelligence: vi.fn(),
  reviewItem: vi.fn(),
  fetchRecentSessions: vi.fn(),
}));
vi.mock("../../services/meetings/meetingReceiptClient", async (orig) => ({
  ...(await orig<typeof import("../../services/meetings/meetingReceiptClient")>()),
  ...api,
}));

import { MeetingReceipt } from "./MeetingReceipt";
import { ReceiptError } from "../../services/meetings/meetingReceiptClient";
import { editPayload, effectiveContent, newerAttempt, offsetLabel } from "../../services/meetings/meetingReceipt";

const NAMES: Record<string, string> = { "alex@x.com": "Alex", "bon@x.com": "Bon", "jan@x.com": "Jan", "micah@x.com": "Micah" };
const resolve = (e: string) => NAMES[e] ?? e;

const ev = (segmentId: string, position: number, speakerEmail: string, text: string, startOffsetMs = position * 4000) => ({
  segmentId, captureId: "c1", position, speakerEmail, speakerName: null, startOffsetMs, endOffsetMs: startOffsetMs + 500,
  revision: 1, text,
});

function item(p: Partial<IntelligenceItem> & Pick<IntelligenceItem, "itemId" | "type" | "content">): IntelligenceItem {
  return {
    position: 0, origin: "generated", confidence: 0.9, confidenceLevel: "high", uncertainty: null,
    reviewState: "suggested", reviewedContent: null, reviewedBy: null, reviewedAt: null, evidence: [], ...p,
  };
}

const ITEMS: IntelligenceItem[] = [
  item({ itemId: "sum", type: "summary", content: { text: "Alex led launch planning." }, confidence: null, confidenceLevel: null }),
  item({ itemId: "dec", type: "decision", position: 1, content: { text: "Launch on Friday." },
    evidence: [ev("s5", 1, "bon@x.com", "Agreed, Friday it is."), ev("s4", 0, "alex@x.com", "Okay, let's launch Friday.")] }),
  item({ itemId: "com", type: "commitment", position: 2,
    content: { text: "Jan will check deployment this afternoon.", action: "Check deployment", ownerEmail: "jan@x.com", deadline: "this afternoon" },
    evidence: [ev("s9", 0, "alex@x.com", "Jan, can you check deployment?"), ev("s11", 1, "jan@x.com", "Yes, I'll check it this afternoon.")] }),
  item({ itemId: "loop", type: "open_loop", position: 3, content: { text: "Who will approve pricing is unresolved.", kind: "unanswered_question" },
    evidence: [ev("s13", 0, "alex@x.com", "Who will approve pricing?")] }),
  item({ itemId: "top", type: "topic", position: 4, content: { text: "Pricing" }, evidence: [ev("s6", 0, "alex@x.com", "What are we charging?")] }),
];

function session(p: Partial<MeetingSessionInfo> = {}): MeetingSessionInfo {
  return {
    sessionId: "sess-1", kind: "scheduled", isPrivate: false, roomId: "floor-2/foxtrot", title: "Launch sync",
    planned: { startsAt: "2026-09-28T09:00:00+00:00", endsAt: "2026-09-28T09:30:00+00:00", organizerEmail: "alex@x.com" },
    startedAt: "2026-09-28T09:02:00+00:00", endedAt: "2026-09-28T09:40:00+00:00", endReason: "ended", startedBy: "alex@x.com",
    attendees: [
      { email: "alex@x.com", joinedAt: "2026-09-28T09:02:00+00:00", leftAt: "2026-09-28T09:40:00+00:00", presentMs: 38 * 60_000,
        intervals: [{ joinedAt: "2026-09-28T09:02:00+00:00", leftAt: "2026-09-28T09:40:00+00:00" }] },
      { email: "bon@x.com", joinedAt: "2026-09-28T09:05:00+00:00", leftAt: "2026-09-28T09:40:00+00:00", presentMs: 35 * 60_000,
        intervals: [{ joinedAt: "2026-09-28T09:05:00+00:00", leftAt: "2026-09-28T09:40:00+00:00" }] },
    ],
    viewer: { mayCurate: false }, ...p,
  };
}

const run = (version: number, items: IntelligenceItem[]) => ({
  runId: `run-${version}`, sessionId: "sess-1", version, status: "succeeded" as const, generator: "fake-v2",
  requestedBy: "alex@x.com", startedAt: "2026-09-28T10:00:00+00:00", completedAt: "2026-09-28T10:00:01+00:00",
  failureReason: null, sourceSegmentIds: [], items,
});

function serve({ info = session(), latest, runs = [] as RunSummary[] }: { info?: MeetingSessionInfo; latest?: LatestIntelligence; runs?: RunSummary[] } = {}) {
  const l = latest ?? { sessionId: "sess-1", run: run(1, ITEMS), stale: false };
  api.fetchSession.mockResolvedValue(info);
  api.fetchLatest.mockResolvedValue(l);
  api.fetchRuns.mockResolvedValue({ sessionId: "sess-1", latestRunId: l.run?.runId ?? null, runs: runs.length ? runs : l.run ? [l.run] : [] });
}

// StrictMode like the app: its simulated unmount/remount must not strand the Receipt on "Loading…".
const open = async () => {
  render(
    <StrictMode>
      <MeetingReceipt sessionId="sess-1" resolveDisplayName={resolve} onBack={() => {}} onClose={() => {}} />
    </StrictMode>,
  );
  await screen.findByTestId("receipt-facts");
};
const card = (id: string) => document.querySelector(`[data-item-id="${id}"]`) as HTMLElement;

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));
afterEach(() => vi.restoreAllMocks());

describe("MeetingReceipt", () => {
  it("shows the meeting, its actual attendees, and every section with understandable labels", async () => {
    serve();
    await open();
    expect(screen.getByTestId("receipt-title")).toHaveTextContent("Launch sync");
    expect(screen.getByTestId("receipt-facts")).toHaveTextContent("Scheduled");
    expect(screen.getByTestId("receipt-actual")).toHaveTextContent("2 attended · Organized by Alex");
    const attendees = screen.getAllByTestId("receipt-attendee").map((a) => a.getAttribute("data-email"));
    expect(attendees).toEqual(["alex@x.com", "bon@x.com"]); // invitees are not attendees
    expect(screen.getByText("Alex led launch planning.")).toBeInTheDocument();
    expect(screen.getByTestId("receipt-decisions")).toHaveTextContent("Launch on Friday.");
    expect(within(card("com")).getByTestId("receipt-owner")).toHaveTextContent("Jan");
    expect(within(card("com")).getByTestId("receipt-deadline")).toHaveTextContent("this afternoon");
    expect(card("loop")).toHaveTextContent("Unanswered question");
    expect(card("loop")).not.toHaveTextContent("unanswered_question");
    expect(screen.getByTestId("receipt-topics")).toHaveTextContent("Pricing");
    expect(screen.queryByTestId("receipt-missing")).toBeNull(); // nothing empty to mention
  });

  it("reveals cited transcript lines in evidence order with speaker and time", async () => {
    serve();
    await open();
    expect(within(card("dec")).queryByTestId("receipt-evidence")).toBeNull();
    fireEvent.click(within(card("dec")).getByTestId("receipt-evidence-toggle"));
    const quotes = within(card("dec")).getAllByTestId("receipt-quote");
    expect(quotes.map((q) => q.getAttribute("data-segment-id"))).toEqual(["s4", "s5"]);
    expect(quotes[0]).toHaveTextContent("Alex");
    expect(quotes[0]).toHaveTextContent("0:00");
    expect(quotes[1]).toHaveTextContent("Bon");
    expect(quotes[1]).toHaveTextContent("“Agreed, Friday it is.”");
  });

  it("displays the human's edit as primary, keeps the original on request, and marks rejections inactive", async () => {
    const edited = { ...ITEMS[2], reviewState: "edited" as const, reviewedBy: "alex@x.com",
      reviewedContent: { text: "Jan checks deployment before 3pm.", ownerEmail: "jan@x.com", deadline: "before 3pm" } };
    const rejected = { ...ITEMS[1], reviewState: "rejected" as const, reviewedBy: "alex@x.com" };
    serve({ latest: { sessionId: "sess-1", run: run(1, [ITEMS[0], rejected, edited, ITEMS[3]]), stale: false } });
    await open();
    expect(within(card("com")).getByTestId("receipt-item-text")).toHaveTextContent("Jan checks deployment before 3pm.");
    expect(within(card("com")).getByTestId("receipt-state")).toHaveTextContent("Edited · Alex");
    fireEvent.click(within(card("com")).getByTestId("receipt-toggle-original"));
    expect(within(card("com")).getByTestId("receipt-original")).toHaveTextContent("Jan will check deployment this afternoon.");
    expect(card("dec").getAttribute("data-state")).toBe("rejected");
    expect(within(card("dec")).getByTestId("receipt-state")).toHaveTextContent("Rejected");
    expect(screen.getByTestId("receipt-missing")).toHaveTextContent("No decisions identified"); // no ACTIVE decision
  });

  it("gives review controls only to a curator, and rejecting takes a deliberate second step", async () => {
    serve();
    await open();
    expect(screen.queryByTestId("receipt-confirm")).toBeNull(); // read-only reader
    expect(screen.queryByTestId("receipt-edit")).toBeNull();

    document.body.innerHTML = "";
    serve({ info: session({ viewer: { mayCurate: true } }) });
    api.reviewItem.mockImplementation(async (_s, id, action) => ({ ...ITEMS.find((i) => i.itemId === id)!,
      reviewState: action === "confirm" ? "confirmed" : "rejected", reviewedBy: "alex@x.com" }));
    await open();
    expect(api.reviewItem).not.toHaveBeenCalled(); // opening confirms nothing
    fireEvent.click(within(card("dec")).getByTestId("receipt-confirm"));
    await waitFor(() => expect(card("dec").getAttribute("data-state")).toBe("confirmed"));
    expect(api.reviewItem).toHaveBeenCalledWith("sess-1", "dec", "confirm", undefined);

    fireEvent.click(within(card("loop")).getByTestId("receipt-reject"));
    expect(api.reviewItem).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card("loop")).getByTestId("receipt-reject-confirm"));
    await waitFor(() => expect(card("loop").getAttribute("data-state")).toBe("rejected"));
  });

  it("edits the structured fields and sends them through the review endpoint", async () => {
    serve({ info: session({ viewer: { mayCurate: true } }) });
    api.reviewItem.mockImplementation(async (_s, _id, _a, content) => ({ ...ITEMS[2], reviewState: "edited", reviewedContent: content,
      reviewedBy: "alex@x.com" }));
    await open();
    fireEvent.click(within(card("com")).getByTestId("receipt-edit"));
    const form = within(card("com")).getByTestId("receipt-edit-form");
    expect((within(form).getByTestId("receipt-edit-text") as HTMLTextAreaElement).value).toBe("Jan will check deployment this afternoon.");
    fireEvent.change(within(form).getByTestId("receipt-edit-ownerEmail"), { target: { value: "bon@x.com" } });
    fireEvent.change(within(form).getByTestId("receipt-edit-deadline"), { target: { value: "" } });
    fireEvent.click(within(form).getByTestId("receipt-edit-save"));
    await waitFor(() => expect(api.reviewItem).toHaveBeenCalled());
    expect(api.reviewItem).toHaveBeenCalledWith("sess-1", "com", "edit", {
      text: "Jan will check deployment this afternoon.", action: "Check deployment", ownerEmail: "bon@x.com",
    });
    await waitFor(() => expect(within(card("com")).getByTestId("receipt-owner")).toHaveTextContent("Bon"));
  });

  it("says calmly when the receipt is stale or a newer attempt failed, without regenerating", async () => {
    serve({
      latest: { sessionId: "sess-1", run: run(2, ITEMS), stale: true },
      runs: [{ ...run(3, []), status: "failed", failureReason: "invalid_output" }, run(2, ITEMS)],
    });
    await open();
    expect(screen.getByTestId("receipt-stale")).toHaveTextContent("earlier version of the transcript");
    expect(screen.getByTestId("receipt-attempt")).toHaveTextContent("showing version 2");
    expect(screen.queryByTestId("receipt-regenerate")).toBeNull(); // readers cannot regenerate
    expect(api.generateIntelligence).not.toHaveBeenCalled();
  });

  it("shows no invented content when nothing was generated, and hides empty sections", async () => {
    serve({ latest: { sessionId: "sess-1", run: null, stale: false } });
    await open();
    expect(screen.getByTestId("receipt-empty")).toHaveTextContent("hasn't generated a receipt");
    expect(screen.queryByTestId("receipt-generate")).toBeNull();
    expect(screen.queryByTestId("receipt-item")).toBeNull();

    document.body.innerHTML = "";
    serve({ latest: { sessionId: "sess-1", run: run(1, [ITEMS[0], ITEMS[3]]), stale: false } });
    await open();
    expect(screen.queryByTestId("receipt-decisions")).toBeNull();
    expect(screen.queryByTestId("receipt-commitments")).toBeNull();
    expect(screen.queryByTestId("receipt-secondary")).toBeNull();
    expect(screen.getByTestId("receipt-missing")).toHaveTextContent("No decisions or commitments identified");
  });

  it("lets a curator generate when nothing exists yet", async () => {
    serve({ info: session({ viewer: { mayCurate: true } }), latest: { sessionId: "sess-1", run: null, stale: false } });
    api.generateIntelligence.mockRejectedValue(new ReceiptError("no_transcript", 409));
    await open();
    fireEvent.click(screen.getByTestId("receipt-generate"));
    expect(await screen.findByRole("alert")).toHaveTextContent("no transcript");
  });

  it("shows nothing of the meeting to someone the server refuses", async () => {
    api.fetchSession.mockRejectedValue(new ReceiptError("Not found", 404));
    render(<MeetingReceipt sessionId="sess-1" resolveDisplayName={resolve} onBack={() => {}} onClose={() => {}} />);
    expect(await screen.findByTestId("receipt-unavailable")).toBeInTheDocument();
    expect(api.fetchLatest).not.toHaveBeenCalled(); // the gate read comes first
    expect(screen.queryByTestId("receipt-facts")).toBeNull();
  });
});

describe("meetingReceipt rules", () => {
  it("picks effective content, builds edit payloads, and finds newer attempts", () => {
    expect(effectiveContent(ITEMS[1])).toEqual({ text: "Launch on Friday." });
    expect(effectiveContent({ ...ITEMS[1], reviewState: "edited", reviewedContent: { text: "Launch Monday." } }).text).toBe("Launch Monday.");
    expect(effectiveContent({ ...ITEMS[1], reviewState: "confirmed" }).text).toBe("Launch on Friday.");
    expect(editPayload("decision", { text: "a", rationale: "r" }, { text: " b ", rationale: "" })).toEqual({ text: "b" });
    expect(editPayload("commitment", { text: "a", rationale: "why" }, { text: "b" })).toEqual({ text: "b", rationale: "why" });
    const ok = run(2, []);
    expect(newerAttempt([ok], 2)).toBeNull();
    expect(newerAttempt([{ ...run(3, []), status: "running" }, ok], 2)?.version).toBe(3);
    expect(offsetLabel(65_000)).toBe("1:05");
    expect(offsetLabel(3_725_000)).toBe("1:02:05");
  });
});
