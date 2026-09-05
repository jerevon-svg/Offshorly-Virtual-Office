import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// A5 follow-up — the PANEL half of the proactive return briefing. Given a qualifying catch-up
// through the `returnBriefing` prop, the panel speaks one deterministic briefing turn (worded
// from the same grounded counts as the server digest, same order) and shows the catch-up card
// immediately. Rerenders with the same catch-up add nothing; the manual paths still work.

type CatchUp = import("../../services/toucan").ToucanCatchUp;
type Row = import("../../services/toucan").ToucanCatchUpRow;

const h = vi.hoisted(() => {
  const service = {
    greeting: vi.fn(() => "Squawk! Test greeting."),
    ask: vi.fn(),
    loadLatestConversation: vi.fn(async () => null),
    createConversation: vi.fn(),
    listConversations: vi.fn(async () => []),
    loadConversation: vi.fn(),
    confirmAction: vi.fn(),
    cancelAction: vi.fn(),
    getDelegation: vi.fn(async () => null),
    cancelDelegation: vi.fn(async () => null),
    listUrgentFlags: vi.fn(async () => []),
    markUrgentFlagsSeen: vi.fn(async () => 1),
    getCatchUp: vi.fn(async (): Promise<CatchUp | null> => null),
    listMemories: vi.fn(async () => []),
    deleteMemory: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
  };
  return {
    service,
    subscribeDelegationEnded: vi.fn(() => () => {}),
    subscribeDelegationUrgent: vi.fn(() => () => {}),
    applyToucanStatus: vi.fn(() => ({ ok: true })),
    canApplyToucanStatus: vi.fn(() => ({ ok: true })),
  };
});

vi.mock("../../services/toucan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/toucan")>();
  return {
    ...actual,
    toucanService: h.service,
    subscribeDelegationEnded: h.subscribeDelegationEnded,
    subscribeDelegationUrgent: h.subscribeDelegationUrgent,
    applyToucanStatus: h.applyToucanStatus,
    canApplyToucanStatus: h.canApplyToucanStatus,
  };
});

import { ToucanAssistantPanel, composeReturnBriefing } from "./ToucanAssistantPanel";

const ROW: Row = {
  conversationId: "conv-1",
  type: "dm",
  label: "Micah",
  newCount: 3,
  mentionCount: 1,
  urgent: true,
  urgentFlagId: "f-1",
  urgentRequesterLabel: "Micah",
  toucanCovered: true,
  lastRelevantAt: "2026-09-05T08:00:00.000Z",
};

const BRIEFING: CatchUp = {
  activity: {
    since: "2026-09-04T17:00:00.000Z",
    sinceReason: "last_active",
    until: "2026-09-05T09:00:00.000Z",
    chatCount: 3,
    mentionCount: 1,
    missedCallCount: 2,
    hubCount: 3,
    pressingHubCount: 1,
    importantCount: 4,
  },
  delegatedUrgentCount: 1,
  coveredCount: 1,
  conversations: [ROW],
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("composeReturnBriefing", () => {
  it("words the grounded counts in the digest's order with its subset arithmetic", () => {
    expect(composeReturnBriefing(BRIEFING)).toBe(
      [
        "Welcome back. Here's what happened while you were away:",
        "• 1 message was flagged as urgent while Toucan covered for you",
        "• 1 mention needs your attention",
        "• 2 missed calls",
        "• 1 priority Hub item",
        "• 2 other chat messages",
        "• Toucan replied for you in 1 conversation",
        "• 2 other Hub items",
      ].join("\n"),
    );
  });

  it("never names anybody or quotes anything, and copes with a rows-only result", () => {
    const text = composeReturnBriefing(BRIEFING);
    expect(text).not.toContain("Micah");
    expect(text).not.toContain("conv-1");
    const rowsOnly: CatchUp = {
      ...BRIEFING,
      activity: { ...BRIEFING.activity, chatCount: 0, mentionCount: 0, missedCallCount: 0, hubCount: 0, pressingHubCount: 0, importantCount: 0 },
      delegatedUrgentCount: 0,
      coveredCount: 0,
    };
    expect(composeReturnBriefing(rowsOnly)).toContain("Welcome back.");
    expect(composeReturnBriefing(rowsOnly).split("\n")).toHaveLength(2);
  });
});

describe("ToucanAssistantPanel — proactive return briefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.service.loadLatestConversation.mockResolvedValue(null);
    h.service.getDelegation.mockResolvedValue(null);
    h.service.listUrgentFlags.mockResolvedValue([]);
    h.service.getCatchUp.mockResolvedValue(null);
  });
  afterEach(cleanup);

  it("speaks the briefing once after restore and shows the card immediately; a rerender adds nothing", async () => {
    const onOpenConversation = vi.fn();
    const view = render(
      <ToucanAssistantPanel onRelease={vi.fn()} onOpenConversation={onOpenConversation} returnBriefing={BRIEFING} />,
    );
    await flush();
    expect(screen.getAllByText(/Welcome back\. Here's what happened while you were away/)).toHaveLength(1);
    // One combined message: the rows sit inside the briefing bubble; no standalone card exists.
    const rows = screen.getByTestId("toucan-catchup-rows");
    expect(rows.parentElement?.textContent).toContain("Welcome back.");
    expect(screen.queryByTestId("toucan-catchup-card")).toBeNull();
    expect(screen.getByTestId("toucan-catchup-row").textContent).toContain("Urgent · Micah");
    expect(screen.queryByRole("button", { name: /^Dismiss Micah/ })).toBeNull();

    view.rerender(
      <ToucanAssistantPanel onRelease={vi.fn()} onOpenConversation={onOpenConversation} returnBriefing={{ ...BRIEFING }} />,
    );
    await flush();
    expect(screen.getAllByText(/Welcome back\./)).toHaveLength(1);
    // Nothing was asked of the server and nothing was marked: only the mount-time reads ran.
    expect(h.service.ask).not.toHaveBeenCalled();
    expect(h.service.markUrgentFlagsSeen).not.toHaveBeenCalled();

    // Open still hands the id over and keeps the panel (the caller lays the chat out beside it).
    fireEvent.click(screen.getByRole("button", { name: "Open Micah" }));
    await flush();
    expect(onOpenConversation).toHaveBeenCalledWith("conv-1");
    expect(h.service.markUrgentFlagsSeen).toHaveBeenCalledWith(["f-1"]);
    expect(screen.getByLabelText("Message the toucan")).toBeTruthy();
  });

  it("without a briefing nothing is spoken; the manual catch-up question still works afterwards", async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} onOpenConversation={vi.fn()} />);
    await flush();
    expect(screen.queryByText(/Welcome back\./)).toBeNull();

    h.service.ask.mockResolvedValue({ text: "While you were away:\n• 1 mention", intent: "away_summary", supported: true, conversationId: "tc-1" });
    h.service.getCatchUp.mockResolvedValue(BRIEFING);
    const composer = screen.getByLabelText("Message the toucan");
    fireEvent.change(composer, { target: { value: "catch me up" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await flush();
    expect(h.service.ask).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/While you were away:/)).toBeTruthy();
    // The same structured rows render inside the manual reply — one rendering path.
    expect(screen.getByTestId("toucan-catchup-rows").parentElement?.textContent).toContain("While you were away:");
    expect(screen.queryByTestId("toucan-catchup-card")).toBeNull();
    expect(screen.queryByText(/Welcome back\./)).toBeNull();
  });
});
