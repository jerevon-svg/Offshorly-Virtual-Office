import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor, cleanup } from "@testing-library/react";
import { OfficeMap } from "./OfficeMap";
import type { OfficePerson } from "../../services/office/floorMerge";
import type { ToucanSummonState } from "./ToucanFlyer";
import conversationPanelStyles from "../Chat/ConversationView.module.css";
import officeStyles from "./OfficeMap.module.css";
import { getCurrentUserId } from "../../auth/useAuthGate";
import { mockAttendanceService, resetMockAttendanceForTests } from "../../services/attendance";
import { resetBriefedSinceForTests, writeBriefedSince } from "./toucanReturnBriefing";

// A5 follow-up — PROACTIVE RETURN BRIEFING, end to end in OfficeMap. When the viewer's Toucan
// channel connects and GET /toucan/catchup describes a genuine observed absence with something to
// say, the bird is summoned exactly as the button summons it, the panel opens in its usual slot,
// speaks the briefing, and the catch-up card is there. Proven here:
//   * last_active + rows        → auto-summon → attending → panel with briefing + card, once
//   * reconnect noise / rerender → no second briefing; dismiss → reconnect → no re-summon
//   * manual "Call the toucan" afterwards works and repeats no briefing
//   * a boundary already remembered in localStorage (a refresh) → no auto-summon
//   * last_active + empty, tracking_started, no_history → no auto-summon
//   * catch-up row Open → the DM lands beside the still-open Toucan (A3 layout unchanged)
//
// The bird reaches "attending" inside the 3D stage's frame loop, which jsdom cannot run, so the
// stage is stubbed and its onToucanSummonStateChange callback is driven directly.

const { emitStart, emitLeave, spatialSessionsState } = vi.hoisted(() => ({
  emitStart: vi.fn(),
  emitLeave: vi.fn(),
  spatialSessionsState: { sessions: [] as { sessionId: string; members: string[] }[] },
}));
vi.mock("../../services/presence/spatialSessionStore", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/spatialSessionStore")>(
    "../../services/presence/spatialSessionStore",
  );
  return {
    ...actual,
    emitSpatialSessionStart: emitStart,
    emitSpatialSessionLeave: emitLeave,
    useSpatialSessions: () => spatialSessionsState.sessions,
  };
});

const { chatListState } = vi.hoisted(() => ({
  chatListState: { conversations: [] as import("../../services/chat").Conversation[] },
}));
vi.mock("../../services/chat", async () => {
  const actual = await vi.importActual<typeof import("../../services/chat")>("../../services/chat");
  return {
    ...actual,
    chatMode: "real",
    chatService: {
      ...actual.chatService,
      onTyping: vi.fn(() => () => {}),
      onConversationUpgraded: vi.fn(() => () => {}),
      openConversationWith: vi.fn(async (peerId: string, selfId: string) => ({
        id: `conv-dm:${peerId}`,
        participantIds: [selfId, peerId],
        lastMessageAt: "2026-01-01T00:00:00.000Z",
        type: "dm" as const,
      })),
      listConversations: vi.fn(async () => chatListState.conversations),
      getMessages: vi.fn(async () => []),
      onMessage: vi.fn(() => () => {}),
    },
  };
});
vi.mock("../../services/chat/requestsClient", async () => {
  const actual = await vi.importActual<typeof import("../../services/chat/requestsClient")>(
    "../../services/chat/requestsClient",
  );
  return { ...actual, usePendingRequests: () => [] };
});
vi.mock("../../services/chat/roomRequestsClient", async () => {
  const actual = await vi.importActual<typeof import("../../services/chat/roomRequestsClient")>(
    "../../services/chat/roomRequestsClient",
  );
  return { ...actual, usePendingRoomRequests: () => [] };
});
vi.mock("../../services/chat/talkRequestsClient", async () => {
  const actual = await vi.importActual<typeof import("../../services/chat/talkRequestsClient")>(
    "../../services/chat/talkRequestsClient",
  );
  return { ...actual, usePendingTalkRequests: () => [] };
});

// The Toucan service stays the canned mock, except that getCatchUp returns what the test seeds
// and the channel-connected subscription is driven by hand.
const { toucanState, toucanFlagsState } = vi.hoisted(() => ({
  toucanState: {
    catchUp: null as import("../../services/toucan").ToucanCatchUp | null,
    connected: new Set<() => void>(),
    getCatchUpCalls: 0,
  },
  toucanFlagsState: { flags: [] as import("../../services/toucan").ToucanUrgentFlag[] },
}));
vi.mock("../../services/toucan", async () => {
  const actual = await vi.importActual<typeof import("../../services/toucan")>("../../services/toucan");
  const base = actual.mockToucanService;
  const toucanService = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "listUrgentFlags") return async () => toucanFlagsState.flags;
      if (prop === "markUrgentFlagsSeen") return async () => 1;
      if (prop === "getCatchUp") {
        return async () => {
          toucanState.getCatchUpCalls += 1;
          return toucanState.catchUp;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const subscribeToucanChannelConnected = (listener: () => void) => {
    toucanState.connected.add(listener);
    return () => toucanState.connected.delete(listener);
  };
  return { ...actual, toucanService, subscribeToucanChannelConnected };
});
// Stage stub: renders nothing, hands the summon-state callback to the test.
const { stageState } = vi.hoisted(() => ({
  stageState: { onToucanSummonStateChange: null as ((s: ToucanSummonState) => void) | null },
}));
vi.mock("./OfficeStage", () => ({
  OfficeStage: (props: { onToucanSummonStateChange?: (s: ToucanSummonState) => void }) => {
    stageState.onToucanSummonStateChange = props.onToucanSummonStateChange ?? null;
    return <div data-testid="stage-stub" />;
  },
}));

const peerPerson: OfficePerson = {
  email: "peer@example.com",
  displayName: "Peer Person",
  status: "ONLINE",
  departmentName: "Design",
  jobTitle: "Designer",
  currentActivity: null,
  lastMessage: null,
  avatarId: "bon",
  roomId: "design-team",
  atlasRoomId: null,
  inEphemeralRoom: false,
};
vi.mock("../../services/office/useOfficeRoster", () => ({
  useOfficeRoster: () => ({
    people: [peerPerson],
    loading: false,
    error: null,
    live: true,
    roomNames: new Map(),
    floorCount: 1,
    presenceCount: 1,
  }),
}));

const dmConv = {
  id: "conv-dm:peer@example.com",
  participantIds: ["bon", "peer@example.com"],
  lastMessageAt: "2026-01-01T00:00:00.000Z",
  type: "dm" as const,
};

// Layout constants mirrored from OfficeMap.tsx: edge margin 16, expanded width 320, gap 12.
const SLOT_0 = "16px";
const SLOT_1 = `${16 + 320 + 12}px`;

function conversationPanels(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`.${conversationPanelStyles.panel}`)).filter(
    (el) => el.getAttribute("aria-label") !== "Toucan Assistant",
  );
}
function toucanPanel(view: ReturnType<typeof render>): HTMLElement | null {
  return view.queryByLabelText("Message the toucan");
}
function slotRight(el: Element | null): string | undefined {
  return (el?.closest(`.${officeStyles.floatingChatSlot}`) as HTMLElement | null)?.style.right;
}
function toucanSlotRight(view: ReturnType<typeof render>): string | undefined {
  return slotRight(view.queryByRole("dialog", { name: "Toucan Assistant" }));
}

async function summonToucan(view: ReturnType<typeof render>) {
  const call = await waitFor(() => view.getByRole("button", { name: "Call the toucan" }));
  await act(async () => {
    fireEvent.click(call);
  });
  await act(async () => {
    stageState.onToucanSummonStateChange?.("attending");
  });
  await waitFor(() => expect(toucanPanel(view)).toBeTruthy());
}



const CATCH_UP = (
  rows: import("../../services/toucan").ToucanCatchUpRow[],
  over: Partial<import("../../services/toucan").ToucanCatchUp["activity"]> = {},
): import("../../services/toucan").ToucanCatchUp => ({
  activity: {
    since: "2026-09-04T17:00:00.000Z",
    sinceReason: "last_active",
    until: "2026-09-05T09:00:00.000Z",
    chatCount: rows.reduce((n, r) => n + r.newCount, 0),
    mentionCount: rows.reduce((n, r) => n + r.mentionCount, 0),
    missedCallCount: 0,
    hubCount: 0,
    pressingHubCount: 0,
    importantCount: rows.reduce((n, r) => n + r.mentionCount, 0),
    ...over,
  },
  delegatedUrgentCount: rows.filter((r) => r.urgent).length,
  coveredCount: rows.filter((r) => r.toucanCovered).length,
  conversations: rows,
});
const PEER_ROW = {
  conversationId: dmConv.id,
  type: "dm" as const,
  label: "Peer Person",
  newCount: 2,
  mentionCount: 1,
  urgent: false,
  toucanCovered: false,
  lastRelevantAt: "2026-09-05T08:00:00.000Z",
};

async function fireConnected() {
  await act(async () => {
    for (const cb of toucanState.connected) cb();
    await Promise.resolve();
    await Promise.resolve();
  });
}
function briefings(view: ReturnType<typeof render>): number {
  return view.queryAllByText(/Welcome back\. Here's what happened while you were away/).length;
}

describe("OfficeMap — proactive return briefing", () => {
  beforeEach(async () => {
    resetMockAttendanceForTests(getCurrentUserId());
    await mockAttendanceService.checkIn(getCurrentUserId());
    resetBriefedSinceForTests();
    spatialSessionsState.sessions = [];
    chatListState.conversations = [dmConv];
    toucanFlagsState.flags = [];
    toucanState.catchUp = null;
    toucanState.connected.clear();
    toucanState.getCatchUpCalls = 0;
    stageState.onToucanSummonStateChange = null;
    emitStart.mockClear();
  });
  afterEach(() => {
    cleanup();
    resetMockAttendanceForTests(getCurrentUserId());
    resetBriefedSinceForTests();
  });

  it("a genuine return with rows summons the bird once, opens the panel with the briefing and the card", async () => {
    toucanState.catchUp = CATCH_UP([PEER_ROW]);
    const view = render(<OfficeMap />);
    await waitFor(() => view.getByRole("button", { name: "Call the toucan" }));
    expect(toucanState.connected.size).toBe(1);
    await fireConnected();
    // Summoned exactly as the button would: the bird is on its way, nobody clicked anything.
    await waitFor(() => view.getByRole("button", { name: "Toucan is on its way" }));
    await act(async () => {
      stageState.onToucanSummonStateChange?.("attending");
    });
    await waitFor(() => expect(toucanPanel(view)).toBeTruthy());
    await waitFor(() => expect(briefings(view)).toBe(1));
    expect(view.getByText(/1 mention needs your attention/)).toBeTruthy();
    // Rows live inside the briefing bubble; there is no second "While you were away" card.
    const rows = view.getByTestId("toucan-catchup-rows");
    expect(rows.textContent).toContain("Peer Person");
    expect(rows.parentElement?.textContent).toContain("Welcome back.");
    expect(view.queryByTestId("toucan-catchup-card")).toBeNull();
    expect(toucanSlotRight(view)).toBe(SLOT_0);

    // Reconnect noise and rerenders: same boundary, nothing more happens.
    await fireConnected();
    await fireConnected();
    expect(briefings(view)).toBe(1);
    expect(view.getAllByRole("dialog", { name: "Toucan Assistant" })).toHaveLength(1);

    // Row Open → the DM lands beside the still-open Toucan; no read state is touched here.
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Open Peer Person" }));
    });
    await waitFor(() => expect(conversationPanels(view.container)).toHaveLength(1));
    expect(toucanPanel(view)).toBeTruthy();
    expect(toucanSlotRight(view)).toBe(SLOT_0);
    expect(slotRight(conversationPanels(view.container)[0])).toBe(SLOT_1);
  });

  it("dismissing the bird is respected: a reconnect does not re-summon, and a manual call still works without a second briefing", async () => {
    toucanState.catchUp = CATCH_UP([PEER_ROW]);
    const view = render(<OfficeMap />);
    await waitFor(() => view.getByRole("button", { name: "Call the toucan" }));
    await fireConnected();
    await waitFor(() => view.getByRole("button", { name: "Toucan is on its way" }));
    await act(async () => {
      stageState.onToucanSummonStateChange?.("attending");
    });
    await waitFor(() => expect(briefings(view)).toBe(1));

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Dismiss the toucan" }));
    });
    await act(async () => {
      stageState.onToucanSummonStateChange?.("roaming");
    });
    expect(toucanPanel(view)).toBeNull();
    await fireConnected();
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.getByRole("button", { name: "Call the toucan" })).toBeTruthy();
    expect(toucanPanel(view)).toBeNull();

    // The manual path is untouched: the viewer calls the bird, it comes, the panel opens, and
    // the briefing is not repeated — the manual "catch me up" question remains available.
    await summonToucan(view);
    expect(briefings(view)).toBe(0);
    expect(view.getByLabelText("Message the toucan")).toBeTruthy();
  });

  it("a boundary already briefed (a refresh inside the same return) does not summon", async () => {
    toucanState.catchUp = CATCH_UP([PEER_ROW]);
    writeBriefedSince(getCurrentUserId(), toucanState.catchUp.activity.since);
    const view = render(<OfficeMap />);
    await waitFor(() => view.getByRole("button", { name: "Call the toucan" }));
    await fireConnected();
    await act(async () => {
      await Promise.resolve();
    });
    expect(toucanState.getCatchUpCalls).toBe(1);
    expect(view.getByRole("button", { name: "Call the toucan" })).toBeTruthy();
    expect(toucanPanel(view)).toBeNull();
  });

  it.each([
    ["last_active but empty", CATCH_UP([])],
    ["tracking_started", CATCH_UP([PEER_ROW], { sinceReason: "tracking_started" })],
    ["no_history", CATCH_UP([PEER_ROW], { sinceReason: "no_history" })],
  ])("%s never summons the bird", async (_label, catchUp) => {
    toucanState.catchUp = catchUp;
    const view = render(<OfficeMap />);
    await waitFor(() => view.getByRole("button", { name: "Call the toucan" }));
    await fireConnected();
    await act(async () => {
      await Promise.resolve();
    });
    expect(toucanState.getCatchUpCalls).toBe(1);
    expect(view.getByRole("button", { name: "Call the toucan" })).toBeTruthy();
    expect(toucanPanel(view)).toBeNull();
  });
});
