import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor, cleanup } from "@testing-library/react";
import { OfficeMap } from "./OfficeMap";
import type { OfficePerson } from "../../services/office/floorMerge";
import type { ToucanSummonState } from "./ToucanFlyer";
import conversationPanelStyles from "../Chat/ConversationView.module.css";
import badgeStyles from "../Chat/MessageNotificationBadge.module.css";
import officeStyles from "./OfficeMap.module.css";
import { getCurrentUserId } from "../../auth/useAuthGate";
import { mockAttendanceService, resetMockAttendanceForTests } from "../../services/attendance";

// THE TOUCAN IS ANOTHER WINDOW IN THE FLOATING CHAT STACK. While the panel is open it holds the
// rightmost slot of OfficeMap's Messenger-style layout (computeFloatingChatRightOffsets), so a
// DM/group opened from Global Chat — or from the A3 urgent card — lands BESIDE it, never behind
// it, and the panel closes only on an explicit release. Proven here for:
//   * Toucan open + Global Chat → DM           → both visible, DM in the next slot to the left
//   * Toucan open + Global Chat → group        → both visible
//   * Toucan open + live-session (spatial) DM  → both visible, spatial routing intact
//   * A3 urgent-card Open                      → the flagged DM opens beside the still-open Toucan
//   * explicit "Dismiss the toucan"            → Toucan closes, the stack re-flows to the edge
//   * Toucan never called                      → the existing stacking is exactly as before
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

// The Toucan service stays the canned mock, except that the urgent-card test seeds unseen flags.
const { toucanFlagsState } = vi.hoisted(() => ({
  toucanFlagsState: { flags: [] as import("../../services/toucan").ToucanUrgentFlag[] },
}));
vi.mock("../../services/toucan", async () => {
  const actual = await vi.importActual<typeof import("../../services/toucan")>("../../services/toucan");
  const base = actual.mockToucanService;
  const toucanService = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "listUrgentFlags") return async () => toucanFlagsState.flags;
      if (prop === "markUrgentFlagsSeen") return async () => 1;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...actual, toucanService };
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
const groupConv = {
  id: "conv-group-1",
  participantIds: ["bon", "peer@example.com", "other@example.com"],
  lastMessageAt: "2026-01-01T00:00:00.000Z",
  type: "group" as const,
  title: "Design Sync",
};

// Layout constants mirrored from OfficeMap.tsx: edge margin 16, expanded width 320, gap 12.
const SLOT_0 = "16px";
const SLOT_1 = `${16 + 320 + 12}px`;
const SLOT_2 = `${16 + 2 * (320 + 12)}px`;

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

async function selectFromGlobalChat(view: ReturnType<typeof render>, rowLabel: string) {
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: /Conversations|unread message/ }));
  });
  const row = await waitFor(() => {
    const match = Array.from(view.container.querySelectorAll(`.${badgeStyles.row}`)).find((el) =>
      el.textContent?.includes(rowLabel),
    );
    if (!match) throw new Error(`no 💬 row for ${rowLabel}`);
    return match;
  });
  await act(async () => {
    fireEvent.click(row);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("OfficeMap — the Toucan panel shares the floating chat stack", () => {
  beforeEach(async () => {
    resetMockAttendanceForTests(getCurrentUserId());
    // The Toucan button is part of the checked-in chrome.
    await mockAttendanceService.checkIn(getCurrentUserId());
    spatialSessionsState.sessions = [];
    chatListState.conversations = [];
    toucanFlagsState.flags = [];
    stageState.onToucanSummonStateChange = null;
    emitStart.mockClear();
  });
  afterEach(() => {
    cleanup();
    resetMockAttendanceForTests(getCurrentUserId());
  });

  it("Toucan open + Global Chat → DM: both stay visible, the DM takes the slot beside the Toucan", async () => {
    chatListState.conversations = [dmConv];
    const view = render(<OfficeMap />);
    await summonToucan(view);
    expect(toucanSlotRight(view)).toBe(SLOT_0);
    expect(conversationPanels(view.container)).toHaveLength(0);

    await selectFromGlobalChat(view, "Peer Person");

    const panels = conversationPanels(view.container);
    expect(panels).toHaveLength(1);
    expect(toucanPanel(view)).toBeTruthy();
    expect(toucanSlotRight(view)).toBe(SLOT_0);
    expect(slotRight(panels[0])).toBe(SLOT_1);
  });

  it("Toucan open + Global Chat → group: both stay visible side by side", async () => {
    chatListState.conversations = [groupConv];
    const view = render(<OfficeMap />);
    await summonToucan(view);

    await selectFromGlobalChat(view, "Design Sync");

    const panels = conversationPanels(view.container);
    expect(panels).toHaveLength(1);
    expect(toucanPanel(view)).toBeTruthy();
    expect(toucanSlotRight(view)).toBe(SLOT_0);
    expect(slotRight(panels[0])).toBe(SLOT_1);
  });

  it("Toucan open + live-session DM: still routed spatially, laid out beside the Toucan", async () => {
    chatListState.conversations = [dmConv];
    spatialSessionsState.sessions = [{ sessionId: dmConv.id, members: ["peer@example.com"] }];
    const view = render(<OfficeMap />);
    await summonToucan(view);

    await selectFromGlobalChat(view, "Peer Person");

    const panels = conversationPanels(view.container);
    expect(panels).toHaveLength(1);
    expect(emitStart).toHaveBeenCalledWith(dmConv.id);
    expect(toucanPanel(view)).toBeTruthy();
    expect(slotRight(panels[0])).toBe(SLOT_1);
  });

  it("A3 urgent-card Open opens the flagged DM beside the Toucan and keeps the Toucan open", async () => {
    chatListState.conversations = [dmConv];
    toucanFlagsState.flags = [
      {
        id: "f-1",
        delegationId: "d-1",
        conversationId: dmConv.id,
        requesterEmail: "peer@example.com",
        requesterLabel: "Peer",
        flaggedAt: "2026-09-04T12:30:00.000Z",
        seenAt: null,
      },
    ];
    const view = render(<OfficeMap />);
    await summonToucan(view);
    const open = await waitFor(() => view.getByLabelText("Open the conversation flagged by Peer"));

    await act(async () => {
      fireEvent.click(open);
    });
    await waitFor(() => expect(conversationPanels(view.container)).toHaveLength(1));

    expect(toucanPanel(view)).toBeTruthy();
    expect(toucanSlotRight(view)).toBe(SLOT_0);
    expect(slotRight(conversationPanels(view.container)[0])).toBe(SLOT_1);
  });

  it("an explicit release still closes the Toucan, and the stack re-flows to the edge", async () => {
    chatListState.conversations = [dmConv];
    const view = render(<OfficeMap />);
    await summonToucan(view);
    await selectFromGlobalChat(view, "Peer Person");
    expect(slotRight(conversationPanels(view.container)[0])).toBe(SLOT_1);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Dismiss the toucan" }));
    });

    expect(toucanPanel(view)).toBeNull();
    const panels = conversationPanels(view.container);
    expect(panels).toHaveLength(1);
    expect(slotRight(panels[0])).toBe(SLOT_0);
    await act(async () => {
      stageState.onToucanSummonStateChange?.("roaming");
    });
    expect(view.getByRole("button", { name: "Call the toucan" })).toBeTruthy();
  });

  it("with the Toucan never called, the existing stacking is unchanged", async () => {
    chatListState.conversations = [dmConv, groupConv];
    const view = render(<OfficeMap />);
    await waitFor(() => view.getByRole("button", { name: "Call the toucan" }));

    await selectFromGlobalChat(view, "Peer Person");
    let panels = conversationPanels(view.container);
    expect(panels).toHaveLength(1);
    expect(slotRight(panels[0])).toBe(SLOT_0);

    await selectFromGlobalChat(view, "Design Sync");
    panels = conversationPanels(view.container);
    expect(panels).toHaveLength(2);
    // Newest window rightmost, the earlier DM shifted one slot left — exactly as before.
    const rights = panels.map((el) => slotRight(el)).sort();
    expect(rights).toEqual([SLOT_0, SLOT_1].sort());
    expect(toucanPanel(view)).toBeNull();
    expect(SLOT_2).toBe("680px");
  });
});
