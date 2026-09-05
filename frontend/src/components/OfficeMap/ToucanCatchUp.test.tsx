import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// A5 — Return / Catch-Up card. Against a fully faked service:
//   * a last_active window with rows renders the card, one row per conversation, badges in the
//     server's order (urgent, mentions, new, Toucan replied)
//   * Open hands the conversation id to the caller and keeps the panel; a row with an unseen A3
//     flag also marks THAT flag seen through the A3 call; a plain row marks nothing
//   * urgent rows are Open-only; normal rows offer Dismiss, which hides the row for this panel's
//     session only — no service call — and survives a refetch during the same open panel
//   * the card never touches any read state — the service has no such call and none is invented
//   * no card for no_history / tracking_started / an empty row list; the A3 card is not duplicated
//   * a digest answer refetches the catch-up

type CatchUp = import("../../services/toucan").ToucanCatchUp;
type Row = import("../../services/toucan").ToucanCatchUpRow;
type Flag = import("../../services/toucan").ToucanUrgentFlag;

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
    listUrgentFlags: vi.fn(async (): Promise<Flag[]> => []),
    markUrgentFlagsSeen: vi.fn(async (): Promise<number> => 1),
    getCatchUp: vi.fn(async (): Promise<CatchUp | null> => null),
    listMemories: vi.fn(async () => []),
    deleteMemory: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
  };
  const endedListeners = new Set<(e: { delegationId?: string | null }) => void>();
  return {
    service,
    endedListeners,
    subscribeDelegationEnded: vi.fn((cb: (e: { delegationId?: string | null }) => void) => {
      endedListeners.add(cb);
      return () => endedListeners.delete(cb);
    }),
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

import { ToucanAssistantPanel, catchUpBadges, catchUpRowsToShow } from "./ToucanAssistantPanel";

const ACTIVITY: CatchUp["activity"] = {
  since: "2026-09-04T17:00:00.000Z",
  sinceReason: "last_active",
  until: "2026-09-05T09:00:00.000Z",
  chatCount: 4,
  mentionCount: 1,
  missedCallCount: 0,
  hubCount: 0,
  pressingHubCount: 0,
  importantCount: 1,
};

const URGENT_ROW: Row = {
  conversationId: "conv-urgent",
  type: "dm",
  label: "Micah",
  newCount: 2,
  mentionCount: 1,
  urgent: true,
  urgentFlagId: "f-1",
  urgentRequesterLabel: "Micah",
  toucanCovered: true,
  lastRelevantAt: "2026-09-05T08:00:00.000Z",
};
const GROUP_ROW: Row = {
  conversationId: "conv-group",
  type: "group",
  label: "Launch Room",
  newCount: 1,
  mentionCount: 0,
  urgent: false,
  urgentFlagId: null,
  urgentRequesterLabel: null,
  toucanCovered: false,
  lastRelevantAt: "2026-09-05T07:00:00.000Z",
};
const COVERED_ROW: Row = { ...GROUP_ROW, conversationId: "conv-covered", label: "Alex", type: "dm", newCount: 1, toucanCovered: true };

const FLAG_MICAH: Flag = {
  id: "f-1",
  delegationId: "d-1",
  conversationId: "conv-urgent",
  requesterEmail: "micah@example.com",
  requesterLabel: "Micah",
  flaggedAt: "2026-09-05T08:00:00.000Z",
  seenAt: null,
};
const FLAG_ELSEWHERE: Flag = { ...FLAG_MICAH, id: "f-2", conversationId: "conv-not-in-catchup", requesterLabel: "Alex" };

const catchUp = (rows: Row[], overrides: Partial<CatchUp["activity"]> = {}): CatchUp => ({
  activity: { ...ACTIVITY, ...overrides },
  delegatedUrgentCount: rows.filter((r) => r.urgent).length,
  coveredCount: rows.filter((r) => r.toucanCovered).length,
  conversations: rows,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const setup = async (props: { onOpenConversation?: (id: string) => void; onRelease?: () => void } = {}) => {
  render(<ToucanAssistantPanel onRelease={props.onRelease ?? vi.fn()} onOpenConversation={props.onOpenConversation} />);
  await flush();
};

describe("catchUpBadges / catchUpRowsToShow", () => {
  it("orders badges urgent, mentions, new, Toucan replied and words singulars", () => {
    expect(catchUpBadges(URGENT_ROW)).toEqual(["Urgent · Micah", "1 mention", "2 new", "Toucan replied"]);
    expect(catchUpBadges(GROUP_ROW)).toEqual(["1 new"]);
    expect(catchUpBadges({ ...GROUP_ROW, newCount: 0, mentionCount: 3, urgent: true, urgentRequesterLabel: null })).toEqual([
      "Urgent",
      "3 mentions",
    ]);
  });

  it("only a last_active window earns rows", () => {
    expect(catchUpRowsToShow(null)).toEqual([]);
    expect(catchUpRowsToShow(catchUp([GROUP_ROW], { sinceReason: "tracking_started" }))).toEqual([]);
    expect(catchUpRowsToShow(catchUp([GROUP_ROW], { sinceReason: "no_history" }))).toEqual([]);
    expect(catchUpRowsToShow(catchUp([GROUP_ROW]))).toEqual([GROUP_ROW]);
  });
});

describe("ToucanAssistantPanel — A5 catch-up card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.endedListeners.clear();
    h.service.loadLatestConversation.mockResolvedValue(null);
    h.service.getDelegation.mockResolvedValue(null);
    h.service.listUrgentFlags.mockResolvedValue([]);
    h.service.markUrgentFlagsSeen.mockResolvedValue(1);
    h.service.getCatchUp.mockResolvedValue(null);
  });
  afterEach(cleanup);

  it("renders one row per conversation with its badges, in the server's order", async () => {
    h.service.getCatchUp.mockResolvedValue(catchUp([URGENT_ROW, GROUP_ROW, COVERED_ROW]));
    await setup({ onOpenConversation: vi.fn() });
    expect(h.service.getCatchUp).toHaveBeenCalledTimes(1);
    const card = screen.getByTestId("toucan-catchup-card");
    expect(card.textContent).toContain("While you were away");
    const rows = screen.getAllByTestId("toucan-catchup-row");
    expect(rows.map((r) => r.querySelector("span")?.textContent?.slice(0, 5))).toEqual(["Micah", "Launc", "Alex1"]);
    expect(rows[0].textContent).toContain("Urgent · Micah");
    expect(rows[0].textContent).toContain("1 mention");
    expect(rows[0].textContent).toContain("2 new");
    expect(rows[0].textContent).toContain("Toucan replied");
    expect(rows[1].textContent).not.toContain("Urgent");
    expect(rows[2].textContent).toContain("Toucan replied");
    // Urgent rows are Open-only; the two normal rows offer Dismiss.
    expect(screen.queryByRole("button", { name: /^Dismiss Micah/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Dismiss .* from this briefing$/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(3);
  });

  it("Open hands over the right id, keeps the panel, marks only an urgent row's flag seen, and never touches read state", async () => {
    h.service.getCatchUp.mockResolvedValue(catchUp([URGENT_ROW, GROUP_ROW]));
    const onOpenConversation = vi.fn();
    const onRelease = vi.fn();
    await setup({ onOpenConversation, onRelease });

    fireEvent.click(screen.getByRole("button", { name: "Open Launch Room" }));
    await flush();
    expect(onOpenConversation).toHaveBeenCalledWith("conv-group");
    expect(h.service.markUrgentFlagsSeen).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("toucan-catchup-row")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open Micah" }));
    await flush();
    expect(onOpenConversation).toHaveBeenLastCalledWith("conv-urgent");
    expect(h.service.markUrgentFlagsSeen).toHaveBeenCalledWith(["f-1"]);
    expect(onRelease).not.toHaveBeenCalled();
    expect(screen.queryByTestId("toucan-catchup-card")).toBeNull();
    // The service surface has no read-cursor call, and the panel invented none: every call made
    // is one of the known Toucan calls.
    const called = Object.entries(h.service)
      .filter(([, fn]) => (fn as { mock?: { calls: unknown[] } }).mock?.calls.length)
      .map(([name]) => name)
      .sort();
    expect(called).toEqual(["getCatchUp", "getDelegation", "greeting", "listUrgentFlags", "loadLatestConversation", "markUrgentFlagsSeen"]);
  });

  it("Dismiss on a normal row hides it for this session only, calls nothing, and survives a refetch; urgent rows cannot be dismissed", async () => {
    h.service.getCatchUp.mockResolvedValue(catchUp([URGENT_ROW, GROUP_ROW, COVERED_ROW]));
    h.service.listUrgentFlags.mockResolvedValue([FLAG_MICAH]);
    const onOpenConversation = vi.fn();
    await setup({ onOpenConversation });
    // The same conversation is not listed twice: the A3 card yields to the catch-up row.
    expect(screen.queryByTestId("toucan-urgent-card")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Dismiss Micah/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Launch Room from this briefing" }));
    await flush();
    expect(screen.getAllByTestId("toucan-catchup-row")).toHaveLength(2);
    expect(screen.getByTestId("toucan-catchup-card").textContent).not.toContain("Launch Room");
    expect(h.service.markUrgentFlagsSeen).not.toHaveBeenCalled();
    expect(onOpenConversation).not.toHaveBeenCalled();
    // Still urgent, still Open-only, still one badge.
    expect(screen.getByRole("button", { name: "Open Micah" })).toBeTruthy();
    expect(screen.getAllByTestId("toucan-catchup-row")[0].textContent).toContain("Urgent · Micah");

    // A refetch during the same open panel (a digest answer) returns the dismissed row again;
    // it stays hidden while everything else refreshes.
    h.service.ask.mockResolvedValue({ text: "While you were away:\n• 1 mention", intent: "away_summary", supported: true, conversationId: "tc-1" });
    const composer = screen.getByLabelText("Message the toucan");
    fireEvent.change(composer, { target: { value: "catch me up" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await flush();
    expect(h.service.getCatchUp).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("toucan-catchup-row")).toHaveLength(2);
    expect(screen.getByTestId("toucan-catchup-card").textContent).not.toContain("Launch Room");
    expect(screen.getByTestId("toucan-catchup-card").textContent).toContain("Alex");

    // Only the known Toucan calls ran: no read-state or seen call was invented by Dismiss.
    const called = Object.entries(h.service)
      .filter(([, fn]) => (fn as { mock?: { calls: unknown[] } }).mock?.calls.length)
      .map(([name]) => name)
      .sort();
    expect(called).toEqual(["ask", "getCatchUp", "getDelegation", "greeting", "listUrgentFlags", "loadLatestConversation"]);
  });

  it("Open on an urgent row keeps the A3 seen semantics and clears it from the A3 card too", async () => {
    h.service.getCatchUp.mockResolvedValue(catchUp([URGENT_ROW]));
    h.service.listUrgentFlags.mockResolvedValue([FLAG_MICAH]);
    const onOpenConversation = vi.fn();
    const onRelease = vi.fn();
    await setup({ onOpenConversation, onRelease });
    fireEvent.click(screen.getByRole("button", { name: "Open Micah" }));
    await flush();
    expect(onOpenConversation).toHaveBeenCalledWith("conv-urgent");
    expect(h.service.markUrgentFlagsSeen).toHaveBeenCalledWith(["f-1"]);
    expect(onRelease).not.toHaveBeenCalled();
    expect(screen.queryByTestId("toucan-catchup-card")).toBeNull();
    expect(screen.queryByTestId("toucan-urgent-card")).toBeNull();
  });

  it("A3 flags the catch-up could not place still show on the urgent card", async () => {
    h.service.getCatchUp.mockResolvedValue(catchUp([URGENT_ROW]));
    h.service.listUrgentFlags.mockResolvedValue([FLAG_MICAH, FLAG_ELSEWHERE]);
    await setup({ onOpenConversation: vi.fn() });
    expect(screen.getAllByTestId("toucan-catchup-row")).toHaveLength(1);
    expect(screen.getAllByTestId("toucan-urgent-row")).toHaveLength(1);
    expect(screen.getByTestId("toucan-urgent-card").textContent).toContain("Alex");
  });

  it("shows no card for no_history, tracking_started, an empty list, or a service without the call", async () => {
    for (const value of [
      catchUp([GROUP_ROW], { sinceReason: "no_history" }),
      catchUp([GROUP_ROW], { sinceReason: "tracking_started" }),
      catchUp([]),
      null,
    ]) {
      h.service.getCatchUp.mockResolvedValue(value);
      await setup({ onOpenConversation: vi.fn() });
      expect(screen.queryByTestId("toucan-catchup-card")).toBeNull();
      cleanup();
    }
    h.service.getCatchUp.mockRejectedValue(new Error("older backend"));
    await setup({ onOpenConversation: vi.fn() });
    expect(screen.queryByTestId("toucan-catchup-card")).toBeNull();
    expect(screen.getByText("Squawk! Test greeting.")).toBeTruthy();
  });

  it("a digest answer and a delegation ending both refetch the catch-up", async () => {
    await setup({ onOpenConversation: vi.fn() });
    expect(h.service.getCatchUp).toHaveBeenCalledTimes(1);

    h.service.ask.mockResolvedValue({
      text: "While you were away:\n• 1 chat message",
      intent: "away_summary",
      supported: true,
      conversationId: "tc-1",
    });
    h.service.getCatchUp.mockResolvedValue(catchUp([GROUP_ROW]));
    const composer = screen.getByLabelText("Message the toucan");
    fireEvent.change(composer, { target: { value: "catch me up" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await flush();
    expect(h.service.getCatchUp).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("toucan-catchup-card")).toBeTruthy();

    act(() => {
      for (const cb of h.endedListeners) cb({ delegationId: "d-1" });
    });
    await flush();
    expect(h.service.getCatchUp).toHaveBeenCalledTimes(3);
  });
});
