import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// A2.2 — the active-delegation banner and its Stop button. Against a fully faked service:
//   * an active delegation loads into a banner with the right scope label and end time
//   * an A2.1 dm-only row reads "DMs only"; nothing active → no banner
//   * a confirmed start_delegation shows the banner without a reload
//   * Stop calls the owner-scoped cancel exactly once, is disabled while pending, and the
//     banner disappears on success; a failure reports and keeps the banner
//   * the server's delegation_ended clears the banner

type Ended = { delegationId?: string | null; reason?: string | null };

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
    listMemories: vi.fn(async () => []),
    deleteMemory: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
  };
  const endedListeners = new Set<(e: Ended) => void>();
  return {
    service,
    endedListeners,
    subscribeDelegationEnded: vi.fn((cb: (e: Ended) => void) => {
      endedListeners.add(cb);
      return () => endedListeners.delete(cb);
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
    applyToucanStatus: h.applyToucanStatus,
    canApplyToucanStatus: h.canApplyToucanStatus,
  };
});

import { ToucanAssistantPanel } from "./ToucanAssistantPanel";

const ACTIVE = {
  id: "d-1",
  status: "active" as const,
  endCondition: "at_time",
  scope: "dm_and_groups",
  startsAt: "2026-09-04T12:00:00.000Z",
  expiresAt: "2026-09-04T14:00:00.000Z",
  hardCapAt: "2026-09-05T12:00:00.000Z",
  replyCount: 0,
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const setup = async () => {
  render(<ToucanAssistantPanel onRelease={vi.fn()} />);
  await flush();
};

describe("ToucanAssistantPanel — A2.2 active delegation banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.endedListeners.clear();
    h.service.loadLatestConversation.mockResolvedValue(null);
    h.service.getDelegation.mockResolvedValue(null);
  });
  afterEach(cleanup);

  it("shows no banner when nothing is active", async () => {
    await setup();
    expect(h.service.getDelegation).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("toucan-delegation-banner")).toBeNull();
  });

  it("loads the active delegation into a banner with scope and end time", async () => {
    h.service.getDelegation.mockResolvedValue(ACTIVE);
    await setup();
    const banner = screen.getByTestId("toucan-delegation-banner");
    expect(banner.textContent).toContain("Toucan is handling your messages");
    expect(banner.textContent).toContain("DMs + group @mentions");
    expect(banner.textContent).toMatch(/until \d/);
    expect(screen.getByText("Stop")).toBeTruthy();
  });

  it("renders an A2.1 dm-only row as DMs only", async () => {
    h.service.getDelegation.mockResolvedValue({ ...ACTIVE, scope: "dm" });
    await setup();
    const banner = screen.getByTestId("toucan-delegation-banner");
    expect(banner.textContent).toContain("DMs only");
    expect(banner.textContent).not.toContain("group");
  });

  it("Confirm on a start_delegation proposal makes the banner appear without a reload", async () => {
    h.service.ask.mockResolvedValue({
      text: "confirm below",
      intent: "action_proposal",
      supported: true,
      conversationId: "c-1",
      action: {
        id: "act-1",
        action: "start_delegation",
        durationMinutes: 120,
        scope: "dm_and_groups",
        summary: "Let Toucan handle your messages for 2 hours (direct messages + group @mentions)",
        expiresAt: "2026-09-04T12:02:00.000Z",
      },
    });
    h.service.confirmAction.mockResolvedValue({
      id: "act-1",
      outcome: "executed",
      action: "start_delegation",
      durationMinutes: 120,
      scope: "dm_and_groups",
      delegation: ACTIVE,
      summary: "Let Toucan handle your messages for 2 hours (direct messages + group @mentions)",
      text: "Done — I'm handling your messages.",
    });
    await setup();
    expect(screen.queryByTestId("toucan-delegation-banner")).toBeNull();
    fireEvent.change(screen.getByLabelText("Message the toucan"), { target: { value: "Handle my messages for 2 hours." } });
    fireEvent.keyDown(screen.getByLabelText("Message the toucan"), { key: "Enter" });
    await flush();
    fireEvent.click(screen.getByText("Confirm"));
    await flush();
    expect(h.service.getDelegation).toHaveBeenCalledTimes(1); // no refetch needed
    expect(screen.getByTestId("toucan-delegation-banner").textContent).toContain("DMs + group @mentions");
  });

  it("Stop cancels once, is disabled while pending, and removes the banner on success", async () => {
    h.service.getDelegation.mockResolvedValue(ACTIVE);
    let resolveStop: (value: typeof ACTIVE | null) => void = () => {};
    h.service.cancelDelegation.mockImplementation(
      () => new Promise<typeof ACTIVE | null>((resolve) => (resolveStop = resolve)),
    );
    await setup();
    const stop = screen.getByText("Stop") as HTMLButtonElement;
    fireEvent.click(stop);
    fireEvent.click(stop);
    await flush();
    expect(h.service.cancelDelegation).toHaveBeenCalledTimes(1);
    expect((screen.getByText("Stopping…") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("toucan-delegation-banner")).toBeTruthy();

    await act(async () => {
      resolveStop({ ...ACTIVE, status: "ended", endedReason: "cancelled" });
      await Promise.resolve();
    });
    await flush();
    expect(screen.queryByTestId("toucan-delegation-banner")).toBeNull();
  });

  it("a failed Stop reports the failure and keeps the banner", async () => {
    h.service.getDelegation.mockResolvedValue(ACTIVE);
    h.service.cancelDelegation.mockRejectedValue(new Error("boom"));
    await setup();
    fireEvent.click(screen.getByText("Stop"));
    await flush();
    expect(screen.getByTestId("toucan-delegation-banner")).toBeTruthy();
    expect(screen.getByText(/couldn.t reach|failed|try again/i)).toBeTruthy();
    expect((screen.getByText("Stop") as HTMLButtonElement).disabled).toBe(false);
  });

  it("delegation_ended from the server clears the banner", async () => {
    h.service.getDelegation.mockResolvedValue(ACTIVE);
    await setup();
    expect(h.subscribeDelegationEnded).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("toucan-delegation-banner")).toBeTruthy();
    // An event about some OTHER (older) delegation is ignored…
    act(() => {
      for (const cb of h.endedListeners) cb({ delegationId: "d-0", reason: "replaced" });
    });
    expect(screen.getByTestId("toucan-delegation-banner")).toBeTruthy();
    // …the one about this delegation clears it.
    act(() => {
      for (const cb of h.endedListeners) cb({ delegationId: "d-1", reason: "cancelled" });
    });
    expect(screen.queryByTestId("toucan-delegation-banner")).toBeNull();
    expect(h.service.cancelDelegation).not.toHaveBeenCalled();
  });
});
