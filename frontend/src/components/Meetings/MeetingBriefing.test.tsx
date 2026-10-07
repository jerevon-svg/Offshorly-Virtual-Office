import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MeetingSessionInfo } from "../../services/meetings/meetingReceiptClient";
import type { MeetingBriefing, ScheduledMeeting } from "../../services/meetings/scheduledMeetingsClient";

// PHASE 9C — the pre-meeting Brief: offered on an Upcoming card only when the server says there is useful
// authorized history; decisions by date with "Change recorded" only when a decision's own words say so;
// commitments with the viewer's own first and no status; open items as recorded, never as current; review /
// stale marks; a source Receipt that returns to the Brief, and the Brief's Back to Upcoming. Memory's Ask your
// Memory and a Receipt's Ask this meeting are untouched.

const api = vi.hoisted(() => ({
  fetchContinuity: vi.fn(),
  fetchMemory: vi.fn(),
  fetchSession: vi.fn(),
  fetchLatest: vi.fn(),
  fetchRuns: vi.fn(),
  askTwin: vi.fn(),
  askMemory: vi.fn(),
}));
const sched = vi.hoisted(() => ({ fetchBriefing: vi.fn(), fetchBriefingAvailability: vi.fn() }));
const store = vi.hoisted(() => ({ mine: [] as unknown[] }));
vi.mock("../../services/meetings/meetingReceiptClient", async (orig) => ({
  ...(await orig<typeof import("../../services/meetings/meetingReceiptClient")>()),
  ...api,
}));
vi.mock("../../services/meetings/scheduledMeetingsClient", async (orig) => ({
  ...(await orig<typeof import("../../services/meetings/scheduledMeetingsClient")>()),
  ...sched,
}));
vi.mock("../../services/meetings/scheduledMeetingsStore", () => ({
  useScheduledMeetings: () => ({ mine: store.mine, loading: false, error: null, revision: 0 }),
  useNow: () => Date.now(),
  cancelScheduledMeeting: vi.fn(),
  editMeeting: vi.fn(),
  respondToScheduledMeeting: vi.fn(),
  scheduleMeeting: vi.fn(),
}));

import { MeetingsPanel } from "./MeetingsPanel";
import { ScheduledMeetingsError } from "../../services/meetings/scheduledMeetingsClient";

const NAMES: Record<string, string> = { "jan@x.com": "Jan", "bon@x.com": "Bon" };
const resolve = (e: string) => NAMES[e] ?? e;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const upcoming = (id: string, title: string): ScheduledMeeting => ({
  id, title, roomId: "floor-2/alpha", organizerEmail: "jan@x.com", startsAt: inHours(2), endsAt: inHours(2.5),
  isPrivate: false, status: "scheduled", invitees: [{ email: "bon@x.com", response: "accepted" }],
  createdAt: inHours(-24), updatedAt: inHours(-24),
});
const line = (text: string) => ({ speakerEmail: "jan@x.com", speakerName: null, startOffsetMs: 1000, text });
const entry = (itemId: string, sessionId: string, at: string, text: string, reviewState = "confirmed", stale = false) => ({
  itemId, sessionId, at, text, reviewState: reviewState as "confirmed", stale, evidence: [line(text)],
});
const A = "2026-09-10T09:00:00+00:00";
const B = "2026-09-17T09:00:00+00:00";

const BRIEF: MeetingBriefing = {
  meeting: { id: "m-1", title: "Product Sync", roomId: "floor-2/alpha", startsAt: inHours(2), endsAt: inHours(2.5), isPrivate: false },
  available: true,
  sources: [
    { sessionId: "s-a", title: "Product Sync", relation: "same_series", isPrivate: false, startedAt: A, endedAt: A,
      viewer: { attended: true }, notes: "structured", stale: false, review: "reviewed", omittedStale: 0 },
    { sessionId: "s-b", title: "Product Sync", relation: "same_series", isPrivate: true, startedAt: B, endedAt: B,
      viewer: { attended: false }, notes: "structured", stale: true, review: "partly", omittedStale: 1 },
  ],
  decisions: [
    { ...entry("d-1", "s-a", A, "Launch Thursday"), rationale: null, recordedChange: false },
    { ...entry("d-2", "s-b", B, "Move launch from Thursday to Friday", "edited"), rationale: "QA needs another day", recordedChange: true },
  ],
  commitments: [
    { ...entry("c-1", "s-b", B, "Prepare the QA checklist", "suggested"), action: null, ownerEmail: "bon@x.com", deadline: null, isYours: true },
    { ...entry("c-2", "s-a", A, "Check deployment"), action: null, ownerEmail: "jan@x.com", deadline: "by Friday", isYours: false },
  ],
  openLoops: [
    { ...entry("o-2", "s-b", B, "Pricing", "confirmed", true), kind: "unresolved_issue",
      recorded: [{ sessionId: "s-a", itemId: "o-1", at: A }, { sessionId: "s-b", itemId: "o-2", at: B }] },
  ],
  keyContext: [entry("k-1", "s-a", A, "Thursday was proposed")],
};

const SESSION: MeetingSessionInfo = {
  sessionId: "s-b", kind: "scheduled", isPrivate: true, roomId: "floor-2/alpha", title: "Product Sync", planned: null,
  startedAt: B, endedAt: "2026-09-17T10:00:00+00:00", endReason: "ended", startedBy: "jan@x.com", attendees: [],
  viewer: { mayCurate: false },
};

function renderPanel() {
  render(
    <StrictMode>
      <MeetingsPanel selfId="bon@x.com" people={[]} resolveDisplayName={resolve} onClose={() => {}} />
    </StrictMode>,
  );
}
async function openBrief() {
  renderPanel();
  fireEvent.click(await screen.findByTestId("meeting-brief"));
  await screen.findByTestId("brief-intro");
}

beforeEach(() => {
  [...Object.values(api), ...Object.values(sched)].forEach((f) => f.mockReset());
  store.mine = [upcoming("m-1", "Product Sync"), upcoming("m-2", "Budget review")];
  sched.fetchBriefingAvailability.mockResolvedValue({ available: ["m-1"] });
  sched.fetchBriefing.mockResolvedValue(BRIEF);
  api.fetchSession.mockResolvedValue(SESSION);
  api.fetchLatest.mockResolvedValue({ sessionId: "s-b", run: null, stale: false });
  api.fetchRuns.mockResolvedValue({ sessionId: "s-b", latestRunId: null, runs: [] });
  api.fetchContinuity.mockResolvedValue({ sessionId: "s-b", events: [] });
  api.fetchMemory.mockResolvedValue({ sessions: [], nextCursor: null });
});
afterEach(() => vi.restoreAllMocks());

describe("Pre-meeting Brief", () => {
  it("is offered only on upcoming meetings the server says have useful history", async () => {
    renderPanel();
    await screen.findByTestId("meeting-brief");
    expect(sched.fetchBriefingAvailability).toHaveBeenCalledWith(["m-1", "m-2"]);
    const [sync, budget] = screen.getAllByTestId("meeting-item");
    expect(within(sync).getByTestId("meeting-brief")).toHaveAccessibleName("Brief for Product Sync");
    expect(within(budget).queryByTestId("meeting-brief")).toBeNull();
  });

  it("is hidden entirely when nothing is useful, or when availability fails", async () => {
    sched.fetchBriefingAvailability.mockResolvedValueOnce({ available: [] }).mockResolvedValueOnce({ available: [] })
      .mockRejectedValue(new ScheduledMeetingsError("down", 500));
    renderPanel();
    await waitFor(() => expect(sched.fetchBriefingAvailability).toHaveBeenCalled());
    expect(screen.queryByTestId("meeting-brief")).toBeNull();
  });

  it("renders identity, chronological decisions, recorded change, commitments (yours first) and open items as recorded", async () => {
    await openBrief();
    expect(sched.fetchBriefing).toHaveBeenCalledWith("m-1");
    expect(screen.getByTestId("brief-title")).toHaveTextContent("Product Sync");
    expect(screen.getByTestId("brief-intro")).toHaveTextContent("From your Product Sync history · 2 earlier meetings you can open");
    expect(screen.getByTestId("brief-intro")).toHaveTextContent("1 recorded change");

    const decisions = within(screen.getByTestId("brief-decisions")).getAllByTestId("brief-line");
    expect(decisions.map((d) => d.textContent)).toEqual([
      expect.stringContaining("Launch Thursday"), expect.stringContaining("Move launch from Thursday to Friday"),
    ]);
    expect(within(decisions[0]).queryByTestId("brief-change")).toBeNull(); // a difference is not a change
    expect(within(decisions[1]).getByTestId("brief-change")).toHaveTextContent("Change recorded");
    expect(decisions[1]).toHaveTextContent("Reason recorded: QA needs another day");
    expect(decisions[1]).toHaveTextContent("Edited by a person");

    const commitments = screen.getByTestId("brief-commitments");
    expect(commitments).toHaveTextContent("Yours");
    const [mine, jan] = within(commitments).getAllByTestId("brief-line");
    expect(mine).toHaveAttribute("data-mine", "true");
    expect(mine).toHaveTextContent("Prepare the QA checklist");
    expect(mine).toHaveTextContent("You committed");
    expect(within(mine).getByTestId("brief-suggested")).toHaveTextContent("VO suggestion");
    expect(jan).not.toHaveAttribute("data-mine");
    expect(jan).toHaveTextContent("Jan committed · by Friday");
    expect(commitments).not.toHaveTextContent(/pending|overdue|completed|still needs/i);

    const open = screen.getByTestId("brief-open");
    expect(open).toHaveTextContent("not whether it is open now");
    expect(open).toHaveTextContent(/Recorded open · \w+ 10, \w+ 17/);
    expect(within(open).getByTestId("brief-stale")).toHaveTextContent("Earlier transcript");
    expect(open).not.toHaveTextContent(/resolved|still open/i);

    expect(screen.getByTestId("brief-context")).toHaveTextContent("Thursday was proposed");
    expect(screen.getByTestId("brief-decisions")).not.toHaveTextContent("proposed");

    const sources = screen.getAllByTestId("brief-source");
    expect(sources).toHaveLength(2);
    expect(sources[1]).toHaveTextContent("Shared with you");
    expect(sources[1]).toHaveTextContent("Private");
    expect(within(sources[1]).getByTestId("brief-source-omitted")).toHaveTextContent("1 left out (earlier transcript)");
    expect(screen.getByTestId("meeting-brief")).not.toHaveTextContent(/s-a|s-b|d-1|c-1/); // no internal ids
    expect(screen.getByTestId("meeting-brief")).not.toHaveTextContent(/last meeting|previous meeting|supersed/i);
  });

  it("an honest empty brief when there is nothing useful", async () => {
    sched.fetchBriefingAvailability.mockResolvedValue({ available: ["m-1"] });
    sched.fetchBriefing.mockResolvedValue({ ...BRIEF, available: false, decisions: [], commitments: [], openLoops: [], keyContext: [],
      sources: [{ ...BRIEF.sources[0], notes: "transcript_only", review: null }] });
    renderPanel();
    fireEvent.click(await screen.findByTestId("meeting-brief"));
    expect(await screen.findByTestId("brief-empty")).toHaveTextContent("Nothing to brief yet");
    expect(screen.getByTestId("brief-source-notes")).toHaveTextContent("Transcript only · no notes");
  });

  it("a line opens its source Receipt at the item; Back returns to the Brief, then to Upcoming", async () => {
    await openBrief();
    const asked = sched.fetchBriefingAvailability.mock.calls.length;
    fireEvent.click(within(screen.getByTestId("brief-commitments")).getAllByTestId("brief-line")[0]);
    expect(await screen.findByTestId("receipt-facts")).toBeInTheDocument();
    expect(api.fetchSession).toHaveBeenCalledWith("s-b");

    // Ask this meeting still works from a Receipt reached this way, and steps back to that Receipt.
    fireEvent.click(screen.getByTestId("receipt-ask"));
    expect(screen.getByTestId("twin-subtitle")).toHaveTextContent("Ask this meeting");
    fireEvent.click(screen.getByTestId("twin-back"));
    await screen.findByTestId("receipt-facts");

    fireEvent.click(screen.getByRole("button", { name: "Back to the brief" }));
    expect(await screen.findByTestId("brief-intro")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("brief-back"));
    expect(await screen.findAllByTestId("meeting-item")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("meeting-brief")).toBeInTheDocument(); // kept by the panel, no blink on return
    expect(sched.fetchBriefingAvailability).toHaveBeenCalledTimes(asked); // not re-asked by the round-trip
  });

  it("a source row opens its Receipt too, and Escape steps back through Brief to Upcoming", async () => {
    await openBrief();
    fireEvent.click(screen.getAllByTestId("brief-source")[0]);
    expect(await screen.findByTestId("receipt-facts")).toBeInTheDocument();
    expect(api.fetchSession).toHaveBeenLastCalledWith("s-a");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findByTestId("brief-intro")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(await screen.findAllByTestId("meeting-item")).toHaveLength(2);
  });

  it("a booking that is no longer the viewer's reads as missing, not as an error", async () => {
    sched.fetchBriefing.mockRejectedValue(new ScheduledMeetingsError("Meeting not found", 404));
    renderPanel();
    fireEvent.click(await screen.findByTestId("meeting-brief"));
    expect(await screen.findByTestId("brief-missing")).toBeInTheDocument();
  });

  it("Memory → Ask your Memory is unchanged", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
    fireEvent.click(await screen.findByTestId("memory-ask"));
    expect(await screen.findByTestId("org-twin")).toBeInTheDocument();
    expect(sched.fetchBriefing).not.toHaveBeenCalled();
  });
});
