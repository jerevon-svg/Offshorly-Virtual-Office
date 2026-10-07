import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MeetingSessionInfo, OrgTwinAnswer, OrgTwinSource } from "../../services/meetings/meetingReceiptClient";

// PHASE 9B — "Ask your Memory": opened from the Memory tab, it shows the server's grounded or not-established
// answers with sources grouped by meeting (in meeting order), each memory labelled by type and review state,
// evidence one tap away, a source Receipt that returns to the Twin with the conversation intact, and Back to
// Memory with its search kept. Suggestions take the real query path; one question in flight at a time.

const api = vi.hoisted(() => ({
  askMemory: vi.fn(),
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

import { MeetingsPanel } from "./MeetingsPanel";
import { ReceiptError } from "../../services/meetings/meetingReceiptClient";

const NAMES: Record<string, string> = { "alex@x.com": "Alex", "bon@x.com": "Bon" };
const resolve = (e: string) => NAMES[e] ?? e;

const meeting = (sessionId: string, title: string, startedAt: string, attended = true): OrgTwinSource["meeting"] => ({
  sessionId, title, kind: "scheduled", isPrivate: false, roomId: "floor-2/foxtrot", startedAt,
  endedAt: startedAt.replace("09:", "10:"), viewer: { attended },
});
const line = (segmentId: string, text: string, startOffsetMs = 1000) => ({
  segmentId, speakerEmail: "alex@x.com", speakerName: null, startOffsetMs, endOffsetMs: startOffsetMs + 500, text,
});

const grounded = (p: Partial<OrgTwinAnswer> = {}): OrgTwinAnswer => ({
  status: "grounded",
  answer: "The meetings record these decisions, in order: …",
  uncertainty: "Part of this comes from a receipt made before its transcript changed.",
  reason: null,
  sources: [
    { meeting: meeting("s-a", "Product Sync", "2026-09-10T09:00:00+00:00"), memories: [{
      source: "transcript", type: "discussion", text: "We could launch Thursday.", details: {}, reviewState: null,
      confidence: null, uncertainty: null, stale: false, evidenceComplete: true, evidence: [line("g1", "We could launch Thursday.")],
    }] },
    { meeting: meeting("s-b", "Product Sync", "2026-09-17T09:00:00+00:00", false), memories: [{
      source: "intelligence", type: "decision", text: "Move the launch to Friday after QA", details: { rationale: null },
      reviewState: "edited", confidence: "high", uncertainty: null, stale: true, evidenceComplete: false,
      evidence: [line("g3", "Agreed, Friday.", 5000), line("g2", "We'll move launch to Friday after QA.", 2000)],
    }] },
    { meeting: meeting("s-c", "Launch Review", "2026-09-24T09:00:00+00:00"), memories: [{
      source: "intelligence", type: "decision", text: "Friday remains the target", details: { rationale: null },
      reviewState: "suggested", confidence: "medium", uncertainty: null, stale: false, evidenceComplete: true,
      evidence: [line("g4", "Friday remains the target.")],
    }] },
  ],
  ...p,
});

const SESSION: MeetingSessionInfo = {
  sessionId: "s-b", kind: "scheduled", isPrivate: false, roomId: "floor-2/foxtrot", title: "Product Sync", planned: null,
  startedAt: "2026-09-17T09:00:00+00:00", endedAt: "2026-09-17T10:00:00+00:00", endReason: "ended",
  startedBy: "alex@x.com", attendees: [], viewer: { mayCurate: false },
};

async function openAsk() {
  render(
    <StrictMode>
      <MeetingsPanel selfId="bon@x.com" people={[]} resolveDisplayName={resolve} onClose={() => {}} />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
  const search = await screen.findByRole("searchbox");
  fireEvent.change(search, { target: { value: "launch" } });
  await screen.findAllByTestId("memory-row");
  fireEvent.click(screen.getByTestId("memory-ask"));
  await screen.findByTestId("org-twin");
}
const type = (text: string) => fireEvent.change(screen.getByTestId("orgtwin-input"), { target: { value: text } });
const send = () => fireEvent.click(screen.getByTestId("orgtwin-send"));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchMemory.mockResolvedValue({
    sessions: [{
      sessionId: "s-b", kind: "scheduled", isPrivate: false, roomId: "floor-2/foxtrot", title: "Product Sync",
      startedAt: SESSION.startedAt, endedAt: SESSION.endedAt!, durationMs: 60 * 60_000, attendeeCount: 2,
      viewer: { attended: false }, intelligence: null, match: null,
    }],
    nextCursor: null,
  });
  api.fetchSession.mockResolvedValue(SESSION);
  api.fetchLatest.mockResolvedValue({ sessionId: "s-b", run: null, stale: false });
  api.fetchRuns.mockResolvedValue({ sessionId: "s-b", latestRunId: null, runs: [] });
  api.fetchContinuity.mockResolvedValue({ sessionId: "s-b", events: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("Ask your Memory", () => {
  it("is offered at the Memory level and opens a broader, clearly named view", async () => {
    await openAsk();
    expect(screen.getByRole("heading", { name: "Ask your Memory" })).toBeInTheDocument();
    expect(screen.getByTestId("orgtwin-intro")).toHaveTextContent("across the meetings you can access");
    expect(screen.getAllByTestId("orgtwin-suggestion").length).toBeGreaterThan(0);
  });

  it("a suggestion takes the same query path as typing", async () => {
    api.askMemory.mockResolvedValue(grounded());
    await openAsk();
    fireEvent.click(screen.getAllByTestId("orgtwin-suggestion")[0]);
    await screen.findByTestId("orgtwin-answer");
    expect(api.askMemory).toHaveBeenCalledWith("What have we decided recently?", []);
    expect(screen.queryByTestId("orgtwin-intro")).toBeNull();
  });

  it("shows asking, then a grounded multi-meeting answer with grouped, labelled, inspectable sources", async () => {
    let answer!: (a: OrgTwinAnswer) => void;
    api.askMemory.mockReturnValue(new Promise<OrgTwinAnswer>((r) => (answer = r)));
    await openAsk();
    type("What did we decide about the launch?");
    send();
    expect(screen.getByTestId("orgtwin-asking")).toBeInTheDocument();
    expect(screen.getByTestId("orgtwin-send")).toBeDisabled();
    answer(grounded());
    const card = await screen.findByTestId("orgtwin-answer");
    expect(card).toHaveAttribute("data-status", "grounded");
    expect(screen.getByTestId("orgtwin-uncertainty")).toHaveTextContent("before its transcript changed");
    const kinds = screen.getAllByTestId("orgtwin-basis").map((b) => b.getAttribute("data-kind"));
    expect(kinds).toEqual(["edited", "suggested", "discussion", "stale"]);

    fireEvent.click(screen.getByTestId("orgtwin-sources-toggle"));
    expect(screen.getByTestId("orgtwin-sources-toggle")).toHaveTextContent("Hide sources");
    const groups = screen.getAllByTestId("orgtwin-source");
    expect(groups.map((g) => g.getAttribute("data-session-id"))).toEqual(["s-a", "s-b", "s-c"]); // server's order
    expect(groups[0]).toHaveTextContent("Product Sync");
    expect(within(groups[0]).getByTestId("orgtwin-memory")).toHaveAttribute("data-type", "discussion");
    expect(groups[0]).toHaveTextContent("Discussed");
    expect(groups[0]).toHaveTextContent("“We could launch Thursday.”");
    expect(groups[1]).toHaveTextContent("Shared with you");
    expect(within(groups[1]).getByTestId("orgtwin-memory-review")).toHaveTextContent("Reviewed wording");
    expect(within(groups[1]).getByTestId("orgtwin-memory-stale")).toBeInTheDocument();
    expect(within(groups[2]).getByTestId("orgtwin-memory-review")).toHaveTextContent("VO suggestion");
    expect(card).not.toHaveTextContent("s-b"); // no internal ids on screen

    const lines = within(groups[1]).getByTestId("orgtwin-evidence-toggle");
    expect(lines).toHaveTextContent("2 lines · some changed since");
    fireEvent.click(lines);
    const quotes = within(groups[1]).getAllByTestId("receipt-quote").map((q) => q.getAttribute("data-segment-id"));
    expect(quotes).toEqual(["g3", "g2"]); // the Receipt's evidence list, fed in the server's order
  });

  it("an honest insufficient answer and a no-memories answer read as calm, not as errors", async () => {
    api.askMemory
      .mockResolvedValueOnce(grounded({ status: "insufficient", answer: "The meetings I can use show the change, but they don't establish why.", uncertainty: null }))
      .mockResolvedValueOnce({ status: "insufficient", answer: "I couldn't find that in the meetings you can access.",
        uncertainty: null, sources: [], reason: "no_memories" });
    await openAsk();
    type("Why did the launch move?");
    send();
    const first = await screen.findByTestId("orgtwin-answer");
    expect(first).toHaveAttribute("data-status", "insufficient");
    expect(within(first).getByTestId("orgtwin-not-established")).toHaveTextContent("Not established in your meetings");
    expect(within(first).getByTestId("orgtwin-sources-toggle")).toHaveTextContent("Sources · 3 meetings");
    type("What about zebras?");
    send();
    await waitFor(() => expect(screen.getAllByTestId("orgtwin-answer")).toHaveLength(2));
    const second = screen.getAllByTestId("orgtwin-answer")[1];
    expect(second).toHaveAttribute("data-reason", "no_memories");
    expect(within(second).getByTestId("orgtwin-not-established")).toHaveTextContent("Nothing found in your meetings");
    expect(within(second).queryByTestId("orgtwin-sources-toggle")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a source Receipt opens, returns to the Twin with its conversation, then to Memory with its search", async () => {
    api.askMemory.mockResolvedValue(grounded());
    await openAsk();
    type("What did we decide about the launch?");
    send();
    await screen.findByTestId("orgtwin-answer");
    fireEvent.click(screen.getByTestId("orgtwin-sources-toggle"));
    fireEvent.click(within(screen.getAllByTestId("orgtwin-source")[1]).getByTestId("orgtwin-open-receipt"));
    expect(await screen.findByTestId("receipt-facts")).toBeInTheDocument();
    expect(api.fetchSession).toHaveBeenCalledWith("s-b");

    // Ask this meeting still works from a Receipt reached this way, and steps back to that Receipt.
    api.askTwin.mockResolvedValue({ sessionId: "s-b", status: "grounded", answer: "Friday.", uncertainty: null,
      evidence: [], basis: [], intelligence: "none" });
    fireEvent.click(screen.getByTestId("receipt-ask"));
    expect(screen.getByTestId("twin-subtitle")).toHaveTextContent("Ask this meeting");
    fireEvent.click(screen.getByTestId("twin-back"));
    await screen.findByTestId("receipt-facts");

    fireEvent.click(screen.getByRole("button", { name: "Back to Ask your Memory" }));
    expect(await screen.findByTestId("org-twin")).toBeInTheDocument();
    expect(screen.getAllByTestId("orgtwin-answer")).toHaveLength(1); // the conversation survived the detour
    expect(screen.getByTestId("orgtwin-question")).toHaveTextContent("What did we decide about the launch?");

    fireEvent.keyDown(window, { key: "Escape" }); // Escape steps back to Memory, not out of the panel
    expect(await screen.findByRole("searchbox")).toHaveValue("launch");
    expect(screen.getAllByTestId("memory-row")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("memory-ask"));
    expect(screen.getAllByTestId("orgtwin-answer")).toHaveLength(1);
  });

  it("follow-ups send the last answered turns as referent context, and one question is in flight at a time", async () => {
    let answer!: (a: OrgTwinAnswer) => void;
    api.askMemory.mockReturnValueOnce(new Promise<OrgTwinAnswer>((r) => (answer = r)));
    await openAsk();
    type("What did we decide about the launch?");
    const input = screen.getByTestId("orgtwin-input");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    send();
    expect(api.askMemory).toHaveBeenCalledTimes(1);
    answer(grounded({ answer: "Two decisions." }));
    await screen.findByTestId("orgtwin-answer");
    api.askMemory.mockResolvedValueOnce(grounded({ answer: "That was Product Sync." }));
    type("Which meeting was that?");
    send();
    await waitFor(() => expect(screen.getAllByTestId("orgtwin-answer")).toHaveLength(2));
    expect(api.askMemory).toHaveBeenLastCalledWith("Which meeting was that?", [
      { question: "What did we decide about the launch?", answer: "Two decisions." },
    ]);
  });

  it("unavailable, rate-limited and failed answers", async () => {
    api.askMemory
      .mockRejectedValueOnce(new ReceiptError("rate_limited", 429))
      .mockRejectedValueOnce(new ReceiptError("answer_rejected", 502))
      .mockRejectedValueOnce(new ReceiptError("generator_unavailable", 503));
    await openAsk();
    type("What is still unresolved?");
    send();
    expect(await screen.findByTestId("orgtwin-error")).toHaveTextContent("a lot of questions");
    type("What is still unresolved?");
    send();
    await waitFor(() => expect(screen.getAllByTestId("orgtwin-error")).toHaveLength(2));
    expect(screen.getAllByTestId("orgtwin-error")[1]).toHaveTextContent("couldn't be backed by your meetings");
    type("What is still unresolved?");
    send();
    expect(await screen.findByTestId("orgtwin-blocked")).toHaveTextContent("isn't available here yet");
    expect(screen.queryByTestId("orgtwin-composer")).toBeNull();
  });
});
