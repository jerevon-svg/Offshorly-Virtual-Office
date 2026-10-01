import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MeetingSessionInfo, TwinAnswer } from "../../services/meetings/meetingReceiptClient";

// PHASE 8B — the Meeting Twin view: opened from a Receipt for that one session, it shows the server's grounded
// or not-established answers with their transcript sources in order, meeting-level refusals as calm states,
// per-turn errors, one question in flight at a time — and Back returns to the Receipt, then to Memory intact.

const api = vi.hoisted(() => ({
  askTwin: vi.fn(),
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

import { MeetingTwin } from "./MeetingTwin";
import { MeetingsPanel } from "./MeetingsPanel";
import { ReceiptError } from "../../services/meetings/meetingReceiptClient";

const NAMES: Record<string, string> = { "alex@x.com": "Alex", "bon@x.com": "Bon" };
const resolve = (e: string) => NAMES[e] ?? e;

const SESSION: MeetingSessionInfo = {
  sessionId: "sess-1", kind: "scheduled", isPrivate: true, roomId: "floor-2/foxtrot", title: "Launch sync",
  planned: null, startedAt: "2026-09-28T09:02:00+00:00", endedAt: "2026-09-28T09:40:00+00:00", endReason: "ended",
  startedBy: "alex@x.com", attendees: [], viewer: { mayCurate: false },
};

const line = (segmentId: string, speakerEmail: string, text: string, startOffsetMs: number) => ({
  segmentId, speakerEmail, speakerName: null, startOffsetMs, endOffsetMs: startOffsetMs + 500, text,
});

const grounded = (p: Partial<TwinAnswer> = {}): TwinAnswer => ({
  sessionId: "sess-1", status: "grounded", answer: "The meeting decided: Launch on Friday.", uncertainty: null,
  evidence: [line("s4", "alex@x.com", "Okay, let's launch Friday.", 4000), line("s5", "bon@x.com", "Agreed, Friday it is.", 65000)],
  basis: [{ type: "decision", reviewState: "edited", text: "Target Friday pending QA.", stale: false }],
  intelligence: "current", ...p,
});

const openTwin = () =>
  render(
    <StrictMode>
      <MeetingTwin session={SESSION} resolveDisplayName={resolve} onBack={() => {}} onClose={() => {}} />
    </StrictMode>,
  );
const type = (text: string) => fireEvent.change(screen.getByTestId("twin-input"), { target: { value: text } });
const send = () => fireEvent.click(screen.getByTestId("twin-send"));

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));
afterEach(() => vi.restoreAllMocks());

describe("MeetingTwin", () => {
  it("keeps the meeting's identity in the header and offers suggestions that take the same path", async () => {
    api.askTwin.mockResolvedValue(grounded());
    openTwin();
    expect(screen.getByTestId("twin-title")).toHaveTextContent("Launch sync");
    expect(screen.getByTestId("twin-subtitle")).toHaveTextContent("Ask this meeting");
    expect(screen.getByTestId("twin-subtitle")).toHaveTextContent("Foxtrot");
    expect(screen.getByTestId("twin-subtitle")).toHaveTextContent("Private");
    fireEvent.click(screen.getAllByTestId("twin-suggestion")[0]);
    await screen.findByTestId("twin-answer");
    expect(api.askTwin).toHaveBeenCalledWith("sess-1", "What did we decide?", []);
    expect(screen.queryByTestId("twin-intro")).toBeNull();
  });

  it("shows asking, then a grounded answer whose sources open in transcript order", async () => {
    let resolveAsk!: (a: TwinAnswer) => void;
    api.askTwin.mockReturnValue(new Promise<TwinAnswer>((r) => (resolveAsk = r)));
    openTwin();
    type("What did we decide about the launch?");
    send();
    expect(screen.getByTestId("twin-asking")).toBeInTheDocument();
    expect(screen.getByTestId("twin-send")).toBeDisabled();
    resolveAsk(grounded());
    const answer = await screen.findByTestId("twin-answer");
    expect(answer).toHaveAttribute("data-status", "grounded");
    expect(screen.getByTestId("twin-answer-text")).toHaveTextContent("Launch on Friday.");
    expect(screen.getByTestId("twin-basis")).toHaveTextContent("Reviewed wording");
    expect(screen.getByTestId("twin-input")).toHaveValue("");

    expect(screen.queryByTestId("receipt-evidence")).toBeNull();
    fireEvent.click(screen.getByTestId("twin-sources-toggle"));
    const quotes = within(screen.getByTestId("receipt-evidence")).getAllByTestId("receipt-quote");
    expect(quotes.map((q) => q.textContent)).toEqual([
      "Alex0:04“Okay, let's launch Friday.”",
      "Bon1:05“Agreed, Friday it is.”",
    ]);
    expect(screen.getByTestId("twin-sources-toggle")).toHaveTextContent("Hide sources");
    expect(answer.textContent).not.toContain("s4"); // no internal ids on screen
  });

  it("marks an answer the meeting doesn't establish, and a transcript-only one", async () => {
    api.askTwin.mockResolvedValue(grounded({
      status: "insufficient", answer: "This meeting doesn't establish that. The launch date was not decided.",
      basis: [], intelligence: "none",
    }));
    openTwin();
    type("When is the final launch date?");
    send();
    const answer = await screen.findByTestId("twin-answer");
    expect(answer).toHaveAttribute("data-status", "insufficient");
    expect(screen.getByTestId("twin-not-established")).toHaveTextContent("Not established in this meeting");
    expect(answer).toHaveTextContent("From the transcript · no receipt yet");
    expect(screen.getByTestId("twin-sources-toggle")).toHaveTextContent("2 sources");
  });

  it.each([
    [404, "Not found", "twin-blocked-unavailable", "isn't shared with you"],
    [409, "no_transcript", "twin-blocked-no_transcript", "no transcript"],
    [503, "generator_unavailable", "twin-blocked-generator_unavailable", "isn't available here yet"],
  ])("a %s %s replaces the conversation with a calm state", async (status, code, testId, text) => {
    api.askTwin.mockRejectedValue(new ReceiptError(code, status));
    openTwin();
    type("What did we decide?");
    send();
    expect(await screen.findByTestId(testId)).toHaveTextContent(text);
    expect(screen.queryByTestId("twin-composer")).toBeNull();
  });

  it("fails only the turn on other errors and lets the next question through", async () => {
    api.askTwin.mockRejectedValueOnce(new ReceiptError("rate_limited", 429)).mockResolvedValueOnce(grounded());
    openTwin();
    type("What did we decide?");
    send();
    expect(await screen.findByTestId("twin-error")).toHaveTextContent("Give it a moment");
    expect(screen.getByTestId("twin-composer")).toBeInTheDocument();
    type("What did we decide?");
    send();
    await screen.findByTestId("twin-answer");
    expect(screen.getAllByTestId("twin-turn")).toHaveLength(2);
  });

  it("sends one question at a time and only answered turns as follow-up context", async () => {
    let resolveAsk!: (a: TwinAnswer) => void;
    api.askTwin.mockReturnValueOnce(new Promise<TwinAnswer>((r) => (resolveAsk = r)));
    openTwin();
    type("What did we decide?");
    const input = screen.getByTestId("twin-input");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    send();
    expect(api.askTwin).toHaveBeenCalledTimes(1);
    resolveAsk(grounded());
    await screen.findByTestId("twin-answer");

    api.askTwin.mockResolvedValueOnce(grounded({ answer: "Alex raised it." }));
    type("Who proposed that?");
    send();
    await waitFor(() => expect(screen.getAllByTestId("twin-answer")).toHaveLength(2));
    expect(api.askTwin).toHaveBeenLastCalledWith("sess-1", "Who proposed that?", [
      { question: "What did we decide?", answer: "The meeting decided: Launch on Friday." },
    ]);
  });
});

describe("Meeting Twin inside the Meetings panel", () => {
  it("opens from the Receipt, returns to it, then to Memory with its search intact", async () => {
    api.fetchMemory.mockResolvedValue({
      sessions: [{
        sessionId: "sess-1", kind: "scheduled", isPrivate: false, roomId: "floor-2/foxtrot", title: "Launch sync",
        startedAt: SESSION.startedAt, endedAt: SESSION.endedAt!, durationMs: 38 * 60_000, attendeeCount: 2,
        viewer: { attended: false }, intelligence: null, match: null,
      }],
      nextCursor: null,
    });
    api.fetchSession.mockResolvedValue({ ...SESSION, isPrivate: false });
    api.fetchLatest.mockResolvedValue({ sessionId: "sess-1", run: null, stale: false });
    api.fetchRuns.mockResolvedValue({ sessionId: "sess-1", latestRunId: null, runs: [] });
    api.askTwin.mockResolvedValue(grounded());
    render(
      <StrictMode>
        <MeetingsPanel selfId="bon@x.com" people={[]} resolveDisplayName={resolve} onClose={() => {}} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
    const search = await screen.findByRole("searchbox");
    fireEvent.change(search, { target: { value: "launch" } });
    fireEvent.click((await screen.findAllByTestId("memory-row"))[0]);

    fireEvent.click(await screen.findByTestId("receipt-ask"));
    expect(screen.getByTestId("twin-title")).toHaveTextContent("Launch sync");
    type("What did we decide?");
    send();
    await screen.findByTestId("twin-answer");
    expect(api.askTwin).toHaveBeenCalledWith("sess-1", "What did we decide?", []);

    fireEvent.keyDown(window, { key: "Escape" }); // Escape steps back to the Receipt, not out of the panel
    fireEvent.click(await screen.findByTestId("receipt-ask"));
    fireEvent.click(screen.getByTestId("twin-back"));
    expect(await screen.findByTestId("receipt-facts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to meetings" }));
    expect(await screen.findByRole("searchbox")).toHaveValue("launch");
    expect(screen.getAllByTestId("memory-row")).toHaveLength(1);
  });

  it("the Receipt offers Ask this meeting for its own session", async () => {
    api.fetchMemory.mockResolvedValue({ sessions: [], nextCursor: null });
    api.fetchSession.mockResolvedValue(SESSION);
    api.fetchLatest.mockResolvedValue({ sessionId: "sess-1", run: null, stale: false });
    api.fetchRuns.mockResolvedValue({ sessionId: "sess-1", latestRunId: null, runs: [] });
    const onClose = vi.fn();
    const { MeetingReceipt } = await import("./MeetingReceipt");
    const onAsk = vi.fn();
    render(<MeetingReceipt sessionId="sess-1" resolveDisplayName={resolve} onBack={() => {}} onClose={onClose} onAsk={onAsk} />);
    fireEvent.click(await screen.findByTestId("receipt-ask"));
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess-1" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
