import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MemoryPreview, MemorySession } from "../../services/meetings/meetingReceiptClient";

// PHASE 8A — Meeting Memory renders the server's page: attended vs shared-but-absent from real attendance,
// the effective preview with who stands behind it, honest no-receipt / stale states, server paging, search
// and filters — and a row opens the EXISTING Receipt by Meeting Session id.

const api = vi.hoisted(() => ({ fetchMemory: vi.fn() }));
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
vi.mock("./MeetingReceipt", () => ({
  MeetingReceipt: ({ sessionId, onBack }: { sessionId: string; onBack: () => void }) => (
    <div data-testid="receipt-stub" data-session-id={sessionId}>
      <button type="button" onClick={onBack}>back</button>
    </div>
  ),
}));

import { MeetingsPanel } from "./MeetingsPanel";
import { previewCounts, previewReview } from "../../services/meetings/meetingMemory";

const preview = (p: Partial<MemoryPreview> = {}): MemoryPreview => ({
  runVersion: 1, generatedAt: "2026-09-28T10:00:00+00:00", stale: false,
  summary: { text: "Alex led launch planning.", reviewState: "suggested" },
  decisions: [{ text: "Launch on Friday.", reviewState: "confirmed" }],
  counts: { decisions: 1, commitments: 2, openLoops: 0 }, reviewedCount: 1, activeCount: 4, ...p,
});

const row = (sessionId: string, p: Partial<MemorySession> = {}): MemorySession => ({
  sessionId, kind: "scheduled", isPrivate: false, roomId: "floor-2/foxtrot", title: `Meeting ${sessionId}`,
  startedAt: "2026-09-28T09:00:00+00:00", endedAt: "2026-09-28T09:40:00+00:00", durationMs: 40 * 60_000,
  attendeeCount: 3, viewer: { attended: true }, intelligence: null, match: null, ...p,
});

const page = (sessions: MemorySession[], nextCursor: string | null = null) => ({ sessions, nextCursor });

const openMemory = async () => {
  render(
    <StrictMode>
      <MeetingsPanel selfId="bon@x.com" people={[]} resolveDisplayName={(e) => (e === "alex@x.com" ? "Alex" : e)} onClose={() => {}} />
    </StrictMode>,
  );
  expect(api.fetchMemory).not.toHaveBeenCalled(); // nothing is asked for until Memory is opened
  fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
};
const rows = () => screen.queryAllByTestId("memory-row");
const lastQuery = () => api.fetchMemory.mock.calls.at(-1)![0];

beforeEach(() => api.fetchMemory.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("MeetingMemory", () => {
  it("lists memories with attended vs shared, effective preview, stale and no-receipt states", async () => {
    api.fetchMemory.mockResolvedValue(page([
      row("a", { intelligence: preview() }),
      row("b", { viewer: { attended: false }, intelligence: preview({ stale: true, decisions: [], reviewedCount: 0 }) }),
      row("c", { kind: "instant", title: null, roomId: null }),
    ]));
    await openMemory();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const [a, b, c] = rows();
    expect(within(a).getByTestId("memory-relation")).toHaveTextContent("You attended");
    expect(within(a).getByTestId("memory-preview")).toHaveTextContent("Decided Launch on Friday."); // a decision leads
    expect(within(a).getByTestId("memory-review")).toHaveTextContent("Partly reviewed");
    expect(within(a).getByTestId("memory-counts")).toHaveTextContent("1 decision · 2 commitments");
    expect(within(a).queryByTestId("memory-stale")).toBeNull();
    expect(within(b).getByTestId("memory-relation")).toHaveTextContent("Shared with you · you didn't attend");
    expect(within(b).getByTestId("memory-preview")).toHaveTextContent("Alex led launch planning."); // no decision → summary
    expect(within(b).getByTestId("memory-review")).toHaveTextContent("VO suggestion");
    expect(within(b).getByTestId("memory-stale")).toHaveTextContent("From an earlier transcript");
    expect(c).toHaveTextContent("Instant meeting");
    expect(within(c).getByTestId("memory-no-receipt")).toHaveTextContent("No receipt yet");
    expect(lastQuery()).toMatchObject({ q: "", filter: "all" });
  });

  it("loads older pages from the server cursor and appends them", async () => {
    api.fetchMemory.mockResolvedValueOnce(page([row("a"), row("b")], "cur-1")).mockResolvedValueOnce(page([row("c")]));
    await openMemory();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("memory-more"));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(lastQuery()).toMatchObject({ cursor: "cur-1" });
    expect(screen.queryByTestId("memory-more")).toBeNull(); // last page
  });

  it("searches on the server and says why a row matched", async () => {
    api.fetchMemory.mockResolvedValueOnce(page([row("a"), row("b")]));
    await openMemory();
    await waitFor(() => expect(rows()).toHaveLength(2));
    api.fetchMemory.mockResolvedValue(page([
      row("b", { match: { kind: "intelligence", itemType: "decision", reviewState: "suggested", text: "Raise the starter tier" } }),
      row("d", { match: { kind: "attendee", email: "alex@x.com" } }),
    ]));
    fireEvent.change(screen.getByTestId("memory-search"), { target: { value: "  starter " } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: "starter" }));
    await waitFor(() => expect(screen.getAllByTestId("memory-match")).toHaveLength(2));
    const [m1, m2] = screen.getAllByTestId("memory-match");
    expect(m1).toHaveTextContent("In a decision (VO suggestion): “Raise the starter tier”");
    expect(m2).toHaveTextContent("Attended by Alex");

    api.fetchMemory.mockResolvedValue(page([]));
    fireEvent.change(screen.getByTestId("memory-search"), { target: { value: "nothing" } });
    expect(await screen.findByText("No matching meetings")).toBeInTheDocument();
  });

  it("filters attended / didn't attend on the server with honest empty states", async () => {
    api.fetchMemory.mockResolvedValue(page([]));
    await openMemory();
    expect(await screen.findByText("No past meetings yet")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("memory-filter-attended"));
    await waitFor(() => expect(lastQuery()).toMatchObject({ filter: "attended" }));
    expect(await screen.findByText("No attended meetings")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("memory-filter-absent"));
    await waitFor(() => expect(lastQuery()).toMatchObject({ filter: "absent" }));
    expect(await screen.findByText("Nothing shared with you")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("memory-filter-all"));
    await waitFor(() => expect(lastQuery()).toMatchObject({ filter: "all" }));
  });

  it("shows a failed request and retries", async () => {
    api.fetchMemory.mockRejectedValueOnce(new Error("Request failed (500)")).mockResolvedValue(page([row("a")]));
    await openMemory();
    expect(await screen.findByTestId("memory-error")).toHaveTextContent("Request failed (500)");
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("opens the existing Receipt by Meeting Session id and refreshes on the way back", async () => {
    api.fetchMemory.mockResolvedValue(page([row("sess-9", { intelligence: preview() })]));
    await openMemory();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const calls = api.fetchMemory.mock.calls.length;
    fireEvent.click(rows()[0]);
    expect(screen.getByTestId("receipt-stub")).toHaveAttribute("data-session-id", "sess-9");
    fireEvent.click(screen.getByText("back"));
    await waitFor(() => expect(api.fetchMemory.mock.calls.length).toBe(calls + 1));
    expect(screen.getByRole("tab", { name: "Memory" })).toHaveAttribute("aria-selected", "true");
    expect(rows()).toHaveLength(1);

    fireEvent.click(rows()[0]); // Escape is the other way back
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(api.fetchMemory.mock.calls.length).toBe(calls + 2));
    expect(rows()).toHaveLength(1);
  });
});

describe("memory preview helpers", () => {
  it("says who stands behind a preview and counts only what is there", () => {
    expect(previewReview(preview({ reviewedCount: 4, activeCount: 4 }))).toBe("reviewed");
    expect(previewReview(preview({ reviewedCount: 1 }))).toBe("partly");
    expect(previewReview(preview({ reviewedCount: 0 }))).toBe("suggested");
    expect(previewReview(preview({ reviewedCount: 0, activeCount: 0 }))).toBe("suggested");
    expect(previewCounts(preview({ counts: { decisions: 2, commitments: 0, openLoops: 3 } }))).toBe("2 decisions · 3 open");
    expect(previewCounts(preview({ counts: { decisions: 0, commitments: 0, openLoops: 0 } }))).toBe("");
  });
});
