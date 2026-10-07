import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  Continuity,
  ContinuityEvent,
  IntelligenceItem,
  MeetingSessionInfo,
} from "../../services/meetings/meetingReceiptClient";

// PHASE 8C — the continuity timeline in the Receipt: shown only with related meetings, this meeting marked,
// each stop's own active intelligence (suggested vs reviewed, stale, no receipt), "Raised again" as the only
// transition, other stops opening their own Receipt (at an item), and Back walking the trail to Memory.

const api = vi.hoisted(() => ({
  askTwin: vi.fn(),
  fetchContinuity: vi.fn(),
  fetchMemory: vi.fn(),
  fetchSession: vi.fn(),
  fetchLatest: vi.fn(),
  fetchRuns: vi.fn(),
}));
vi.mock("../../services/meetings/meetingReceiptClient", async (orig) => ({
  ...(await orig<typeof import("../../services/meetings/meetingReceiptClient")>()),
  ...api,
}));
vi.mock("../../services/meetings/scheduledMeetingsStore", () => ({
  useScheduledMeetings: () => ({ mine: [], loading: false, error: null, revision: 0 }),
  useNow: () => Date.now(),
  cancelScheduledMeeting: vi.fn(),
  editMeeting: vi.fn(),
  respondToScheduledMeeting: vi.fn(),
  scheduleMeeting: vi.fn(),
}));

import { MeetingReceipt } from "./MeetingReceipt";
import { MeetingsPanel } from "./MeetingsPanel";

const resolve = (e: string) => ({ "jan@x.com": "Jan" })[e] ?? e;

const info = (sessionId: string, day: string): MeetingSessionInfo => ({
  sessionId, kind: "scheduled", isPrivate: false, roomId: "floor-2/foxtrot", title: "Product Sync", planned: null,
  startedAt: `2026-09-${day}T09:00:00+00:00`, endedAt: `2026-09-${day}T10:00:00+00:00`, endReason: "ended",
  startedBy: "alex@x.com", attendees: [], viewer: { mayCurate: false },
});

const state = (p: Partial<NonNullable<ContinuityEvent["intelligence"]>> = {}): NonNullable<ContinuityEvent["intelligence"]> => ({
  runVersion: 1, stale: false,
  counts: { decisions: 0, decisionsReviewed: 0, commitments: 0, commitmentsReviewed: 0, openLoops: 0, openLoopsReviewed: 0 },
  decisions: [], commitments: [], openLoops: [], ...p,
});

const event = (sessionId: string, day: string, p: Partial<ContinuityEvent> = {}): ContinuityEvent => ({
  sessionId, isCurrent: false, relation: "same_series", title: "Product Sync", kind: "scheduled", isPrivate: false,
  roomId: "floor-2/foxtrot", startedAt: `2026-09-${day}T09:00:00+00:00`, endedAt: `2026-09-${day}T10:00:00+00:00`,
  viewer: { attended: true }, intelligence: null, change: null, ...p,
});

const TIMELINE = (current: string): Continuity => ({
  sessionId: current,
  events: [
    event("s-10", "10", {
      isCurrent: current === "s-10", relation: current === "s-10" ? null : "same_series",
      intelligence: state({
        decisions: [{ itemId: "d1", text: "Launch Thursday", reviewState: "suggested" }],
        openLoops: [{ itemId: "o1", text: "QA owner", reviewState: "confirmed", kind: "unowned_action" }],
        counts: { decisions: 1, decisionsReviewed: 0, commitments: 0, commitmentsReviewed: 0, openLoops: 1, openLoopsReviewed: 1 },
        stale: true,
      }),
    }),
    event("s-17", "17", {
      isCurrent: current === "s-17", relation: current === "s-17" ? null : "same_series",
      viewer: { attended: false },
      intelligence: state({
        decisions: [{ itemId: "d2", text: "Launch Friday, pending QA", reviewState: "edited" }],
        openLoops: [{ itemId: "o2", text: "QA owner", reviewState: "confirmed", kind: "unowned_action" }],
        counts: { decisions: 1, decisionsReviewed: 1, commitments: 0, commitmentsReviewed: 0, openLoops: 1, openLoopsReviewed: 1 },
      }),
      change: { sinceSessionId: "s-10", raisedAgain: [{ itemId: "o2", text: "QA owner", sinceSessionId: "s-10" }] },
    }),
    event("s-24", "24", { isCurrent: current === "s-24", relation: current === "s-24" ? null : "same_series" }),
  ],
});

const DEC: IntelligenceItem = {
  itemId: "d1", type: "decision", position: 0, origin: "generated", content: { text: "Launch Thursday" },
  confidence: 0.9, confidenceLevel: "high", uncertainty: null, reviewState: "suggested", reviewedContent: null,
  reviewedBy: null, reviewedAt: null,
  evidence: [{ segmentId: "g1", captureId: "c", position: 0, speakerEmail: "jan@x.com", speakerName: null,
    startOffsetMs: 0, endOffsetMs: 500, revision: 1, text: "Maybe Thursday?" }],
};

function serveAll() {
  api.fetchSession.mockImplementation(async (sid: string) => info(sid, sid.slice(2)));
  api.fetchLatest.mockImplementation(async (sid: string) => ({
    sessionId: sid, stale: false,
    run: sid === "s-10" ? { runId: "r", sessionId: sid, version: 1, status: "succeeded", generator: "fake", requestedBy: "a",
      startedAt: null, completedAt: null, failureReason: null, sourceSegmentIds: [], items: [DEC] } : null,
  }));
  api.fetchRuns.mockImplementation(async (sid: string) => ({ sessionId: sid, latestRunId: null, runs: [] }));
  api.fetchContinuity.mockImplementation(async (sid: string) => TIMELINE(sid));
}

const receipt = (sessionId: string, onOpenRelated = vi.fn()) =>
  render(
    <StrictMode>
      <MeetingReceipt sessionId={sessionId} resolveDisplayName={resolve} onBack={() => {}} onClose={() => {}}
        onOpenRelated={onOpenRelated} />
    </StrictMode>,
  );

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe("MeetingContinuity", () => {
  it("renders the related meetings in order with this meeting marked", async () => {
    serveAll();
    receipt("s-17");
    const stops = await screen.findAllByTestId("continuity-event");
    expect(stops.map((s) => s.dataset.sessionId)).toEqual(["s-10", "s-17", "s-24"]);
    expect(stops[1]).toHaveAttribute("data-current", "true");
    expect(within(stops[1]).getByText("This meeting")).toBeInTheDocument();
    expect(within(stops[1]).queryByTestId("continuity-open")).toBeNull();
    expect(within(stops[1]).getByText("Shared with you")).toBeInTheDocument();
    expect(within(stops[0]).getByText("You attended")).toBeInTheDocument();
  });

  it("marks suggested vs reviewed, stale, no receipt, and only ever 'raised again' as a transition", async () => {
    serveAll();
    receipt("s-17");
    const [first, mid, last] = await screen.findAllByTestId("continuity-event");
    const firstLines = within(first).getAllByTestId("continuity-line");
    expect(firstLines[0]).toHaveAttribute("data-tag", "decided");
    expect(firstLines[0]).toHaveAttribute("data-reviewed", "false");
    expect(within(first).getByTestId("continuity-review")).toHaveTextContent("Partly reviewed");
    expect(within(first).getByTestId("continuity-stale")).toBeInTheDocument();
    const midLines = within(mid).getAllByTestId("continuity-line");
    expect(midLines.map((l) => l.dataset.tag)).toEqual(["raised", "decided"]);
    expect(midLines[1]).toHaveTextContent("Launch Friday, pending QA");
    expect(within(mid).getByTestId("continuity-review")).toHaveTextContent("Reviewed");
    expect(within(last).getByTestId("continuity-no-receipt")).toBeInTheDocument();
    const text = screen.getByTestId("receipt-continuity").textContent!.toLowerCase();
    for (const word of ["resolved", "superseded", "completed", "changed to"]) expect(text).not.toContain(word);
  });

  it("opens another stop's Receipt, or its item", async () => {
    serveAll();
    const onOpen = vi.fn();
    receipt("s-17", onOpen);
    const [first] = await screen.findAllByTestId("continuity-event");
    fireEvent.click(within(first).getByTestId("continuity-open"));
    expect(onOpen).toHaveBeenLastCalledWith("s-10", undefined);
    fireEvent.click(within(first).getAllByTestId("continuity-line")[0]);
    expect(onOpen).toHaveBeenLastCalledWith("s-10", "d1");
  });

  it("shows nothing when there are no related meetings", async () => {
    serveAll();
    api.fetchContinuity.mockResolvedValue({ sessionId: "s-17", events: [event("s-17", "17", { isCurrent: true, relation: null })] });
    receipt("s-17");
    await screen.findByTestId("receipt-facts");
    await waitFor(() => expect(api.fetchContinuity).toHaveBeenCalled());
    expect(screen.queryByTestId("receipt-continuity")).toBeNull();
  });

  it("walks Memory → Receipt → related Receipt (at its item) → back → Memory with the search kept", async () => {
    serveAll();
    api.fetchMemory.mockResolvedValue({
      sessions: [{
        sessionId: "s-17", kind: "scheduled", isPrivate: false, roomId: "floor-2/foxtrot", title: "Product Sync",
        startedAt: "2026-09-17T09:00:00+00:00", endedAt: "2026-09-17T10:00:00+00:00", durationMs: 3_600_000,
        attendeeCount: 2, viewer: { attended: false }, intelligence: null, match: null,
      }],
      nextCursor: null,
    });
    render(
      <StrictMode>
        <MeetingsPanel selfId="bon@x.com" people={[]} resolveDisplayName={resolve} onClose={() => {}} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "product" } });
    fireEvent.click((await screen.findAllByTestId("memory-row"))[0]);

    const [first] = await screen.findAllByTestId("continuity-event");
    fireEvent.click(within(first).getAllByTestId("continuity-line")[0]); // → s-10 at its decision
    await waitFor(() => expect(api.fetchSession).toHaveBeenLastCalledWith("s-10"));
    const focused = await screen.findByTestId("receipt-item");
    await waitFor(() => expect(focused).toHaveAttribute("data-focused", "true"));
    expect(within(focused).getByTestId("receipt-evidence")).toBeInTheDocument(); // the claim's evidence, reachable

    // the Twin opened here is s-10's own, and returns to s-10
    fireEvent.click(screen.getByTestId("receipt-ask"));
    await screen.findByTestId("twin-title");
    fireEvent.click(screen.getByTestId("twin-back"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Back to the previous receipt" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Back to the previous receipt" }));
    await waitFor(() => expect(api.fetchSession).toHaveBeenLastCalledWith("s-17"));
    fireEvent.click(await screen.findByRole("button", { name: "Back to meetings" }));
    expect(await screen.findByRole("searchbox")).toHaveValue("product");
  });

  it("revisiting a Receipt already on the trail cuts back instead of looping", async () => {
    serveAll();
    api.fetchMemory.mockResolvedValue({
      sessions: [{
        sessionId: "s-17", kind: "scheduled", isPrivate: false, roomId: null, title: "Product Sync",
        startedAt: "2026-09-17T09:00:00+00:00", endedAt: "2026-09-17T10:00:00+00:00", durationMs: 1,
        attendeeCount: 1, viewer: { attended: true }, intelligence: null, match: null,
      }],
      nextCursor: null,
    });
    render(<MeetingsPanel selfId="bon@x.com" people={[]} resolveDisplayName={resolve} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
    fireEvent.click((await screen.findAllByTestId("memory-row"))[0]); // s-17
    fireEvent.click(within((await screen.findAllByTestId("continuity-event"))[0]).getByTestId("continuity-open")); // s-10
    await waitFor(() => expect(api.fetchSession).toHaveBeenLastCalledWith("s-10"));
    await waitFor(() => expect(screen.getAllByTestId("continuity-event")[0]).toHaveAttribute("data-current", "true"));
    fireEvent.click(within(screen.getAllByTestId("continuity-event")[1]).getByTestId("continuity-open")); // back to s-17
    await waitFor(() => expect(api.fetchSession).toHaveBeenLastCalledWith("s-17"));
    // s-17 was the trail's root, so Back now leads to the list, not to s-10
    fireEvent.click(await screen.findByRole("button", { name: "Back to meetings" }));
    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
  });
});
