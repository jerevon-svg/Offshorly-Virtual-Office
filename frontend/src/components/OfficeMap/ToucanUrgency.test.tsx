import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// A3 — the live urgent counter on the delegation banner and the return card. Against a fully
// faked service:
//   * an active delegation with urgentCount renders the counter; zero renders none
//   * the owner-only delegation_urgent_flagged event bumps the counter for the shown delegation
//     only, and remembers the flag
//   * no active delegation + unseen flags → the return card lists them; a delegation_ended event
//     refetches the list
//   * Open hands the conversation id to the caller and marks the flag seen; Dismiss marks seen
//     only; both remove the row; a failed mark keeps it
//   * without an onOpenConversation caller, only Dismiss is offered

type Ended = { delegationId?: string | null; reason?: string | null };
type Urgent = {
  flagId?: string | null;
  delegationId?: string | null;
  conversationId?: string | null;
  requesterEmail?: string | null;
  flaggedAt?: string | null;
  urgentCount?: number | null;
};
type Delegation = import("../../services/toucan").ToucanDelegation;
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
    getDelegation: vi.fn(async (): Promise<Delegation | null> => null),
    cancelDelegation: vi.fn(async (): Promise<Delegation | null> => null),
    listUrgentFlags: vi.fn(async (): Promise<Flag[]> => []),
    markUrgentFlagsSeen: vi.fn(async (): Promise<number> => 1),
    listMemories: vi.fn(async () => []),
    deleteMemory: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
  };
  const endedListeners = new Set<(e: Ended) => void>();
  const urgentListeners = new Set<(e: Urgent) => void>();
  return {
    service,
    endedListeners,
    urgentListeners,
    subscribeDelegationEnded: vi.fn((cb: (e: Ended) => void) => {
      endedListeners.add(cb);
      return () => endedListeners.delete(cb);
    }),
    subscribeDelegationUrgent: vi.fn((cb: (e: Urgent) => void) => {
      urgentListeners.add(cb);
      return () => urgentListeners.delete(cb);
    }),
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

import { ToucanAssistantPanel, requesterLabelFromEmail } from "./ToucanAssistantPanel";

const ACTIVE: Delegation = {
  id: "d-1",
  status: "active",
  endCondition: "at_time",
  scope: "dm_and_groups",
  startsAt: "2026-09-04T12:00:00.000Z",
  expiresAt: "2026-09-04T14:00:00.000Z",
  hardCapAt: "2026-09-05T12:00:00.000Z",
  replyCount: 1,
  urgentCount: 0,
};

const FLAG_MICAH: Flag = {
  id: "f-1",
  delegationId: "d-1",
  conversationId: "conv-1",
  requesterEmail: "micah@example.com",
  requesterLabel: "Micah",
  flaggedAt: "2026-09-04T12:30:00.000Z",
  seenAt: null,
};

const FLAG_ALEX: Flag = { ...FLAG_MICAH, id: "f-2", conversationId: "conv-2", requesterEmail: "alex@example.com", requesterLabel: "Alex" };

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const setup = async (props: { onOpenConversation?: (id: string) => void } = {}) => {
  render(<ToucanAssistantPanel onRelease={vi.fn()} {...props} />);
  await flush();
};

const fireUrgent = (event: Urgent) =>
  act(() => {
    for (const cb of h.urgentListeners) cb(event);
  });

describe("ToucanAssistantPanel — A3 urgency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.endedListeners.clear();
    h.urgentListeners.clear();
    h.service.loadLatestConversation.mockResolvedValue(null);
    h.service.getDelegation.mockResolvedValue(null);
    h.service.listUrgentFlags.mockResolvedValue([]);
    h.service.markUrgentFlagsSeen.mockResolvedValue(1);
  });
  afterEach(cleanup);

  it("renders the counter only when the active delegation has unseen flags", async () => {
    h.service.getDelegation.mockResolvedValue({ ...ACTIVE, urgentCount: 2 });
    await setup();
    expect(screen.getByTestId("toucan-delegation-urgent-count").textContent).toBe("2 urgent");
    expect(screen.queryByTestId("toucan-urgent-card")).toBeNull(); // banner carries it while active
    cleanup();
    h.service.getDelegation.mockResolvedValue(ACTIVE);
    await setup();
    expect(screen.queryByTestId("toucan-delegation-urgent-count")).toBeNull();
  });

  it("the owner-only urgent event bumps the counter for the shown delegation only", async () => {
    h.service.getDelegation.mockResolvedValue(ACTIVE);
    await setup();
    expect(h.subscribeDelegationUrgent).toHaveBeenCalledTimes(1);
    fireUrgent({ flagId: "f-9", delegationId: "d-0", conversationId: "c", requesterEmail: "x@example.com", urgentCount: 5 });
    expect(screen.queryByTestId("toucan-delegation-urgent-count")).toBeNull();
    fireUrgent({ flagId: "f-1", delegationId: "d-1", conversationId: "conv-1", requesterEmail: "micah@example.com", urgentCount: 1 });
    expect(screen.getByTestId("toucan-delegation-urgent-count").textContent).toBe("1 urgent");
    // Without a server count the panel increments; a duplicate flag id is not double-listed.
    fireUrgent({ flagId: "f-1", delegationId: "d-1", conversationId: "conv-1", requesterEmail: "micah@example.com" });
    expect(screen.getByTestId("toucan-delegation-urgent-count").textContent).toBe("2 urgent");

    // The delegation ends → the banner goes, the remembered flag shows on the return card once.
    h.service.listUrgentFlags.mockResolvedValue([FLAG_MICAH]);
    act(() => {
      for (const cb of h.endedListeners) cb({ delegationId: "d-1", reason: "returned" });
    });
    await flush();
    expect(h.service.listUrgentFlags).toHaveBeenCalledTimes(2); // mount + refetch on end
    expect(screen.queryByTestId("toucan-delegation-banner")).toBeNull();
    expect(screen.getAllByTestId("toucan-urgent-row")).toHaveLength(1);
    expect(screen.getByTestId("toucan-urgent-card").textContent).toContain("Micah");
  });

  it("shows the return card with unseen flags when nothing is active, and Open hands over the id", async () => {
    h.service.listUrgentFlags.mockResolvedValue([FLAG_ALEX, FLAG_MICAH]);
    const onOpenConversation = vi.fn();
    await setup({ onOpenConversation });
    const card = screen.getByTestId("toucan-urgent-card");
    expect(card.textContent).toContain("Urgent while Toucan covered for you");
    const rows = screen.getAllByTestId("toucan-urgent-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Alex");
    expect(rows[1].textContent).toContain("Micah");
    // No message text anywhere on the card.
    expect(card.textContent).not.toMatch(/invoice|urgent:/i);

    fireEvent.click(screen.getByLabelText("Open the conversation flagged by Micah"));
    await flush();
    expect(onOpenConversation).toHaveBeenCalledWith("conv-1");
    expect(h.service.markUrgentFlagsSeen).toHaveBeenCalledWith(["f-1"]);
    expect(screen.getAllByTestId("toucan-urgent-row")).toHaveLength(1);
    expect(screen.getByTestId("toucan-urgent-card").textContent).not.toContain("Micah");

    fireEvent.click(screen.getByLabelText("Dismiss the flag from Alex"));
    await flush();
    expect(onOpenConversation).toHaveBeenCalledTimes(1);
    expect(h.service.markUrgentFlagsSeen).toHaveBeenLastCalledWith(["f-2"]);
    expect(screen.queryByTestId("toucan-urgent-card")).toBeNull();
  });

  it("offers Dismiss only when no caller can open conversations, and a failed mark keeps the row", async () => {
    h.service.listUrgentFlags.mockResolvedValue([FLAG_MICAH]);
    h.service.markUrgentFlagsSeen.mockRejectedValue(new Error("boom"));
    await setup();
    expect(screen.queryByText("Open")).toBeNull();
    fireEvent.click(screen.getByText("Dismiss"));
    await flush();
    expect(screen.getAllByTestId("toucan-urgent-row")).toHaveLength(1);
    expect(screen.getByText(/couldn.t reach|failed|try again/i)).toBeTruthy();
    expect((screen.getByText("Dismiss") as HTMLButtonElement).disabled).toBe(false);
  });

  it("derives a requester label the same way the server does", () => {
    expect(requesterLabelFromEmail("micah.reyes@example.com")).toBe("Micah Reyes");
    expect(requesterLabelFromEmail("bon@example.com")).toBe("Bon");
    expect(requesterLabelFromEmail("")).toBe("Someone");
  });
});
