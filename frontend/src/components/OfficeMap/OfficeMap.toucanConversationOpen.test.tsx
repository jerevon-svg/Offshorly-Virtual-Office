import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor, cleanup } from "@testing-library/react";
import { OfficeMap } from "./OfficeMap";
import type { OfficePerson } from "../../services/office/floorMerge";
import type { ToucanSummonState } from "./ToucanFlyer";
import conversationPanelStyles from "../Chat/ConversationView.module.css";
import badgeStyles from "../Chat/MessageNotificationBadge.module.css";
import { getCurrentUserId } from "../../auth/useAuthGate";
import { mockAttendanceService, resetMockAttendanceForTests } from "../../services/attendance";

// A3 follow-up — OPENING A CONVERSATION GETS THE TOUCAN OUT OF THE WAY. Every user action that
// brings a normal DM/group window to the foreground funnels through OfficeMap's shared openers
// (onSelectConversation → openOrFocusRemoteDm/Group or the spatial slot), and those now release
// the Toucan panel through its existing release path. Proven here for:
//   * Global Chat → DM (remote slot)          → Toucan closes, DM panel visible
//   * Global Chat → group                      → Toucan closes, group panel visible
//   * A3 urgent-card Open                      → Toucan closes, the flagged DM opens
//   * Toucan never called → Global Chat → DM   → unchanged: one panel, no Toucan
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

function panelCount(container: HTMLElement): number {
  return container.querySelectorAll(`.${conversationPanelStyles.panel}`).length;
}
function toucanPanel(view: ReturnType<typeof render>): HTMLElement | null {
  return view.queryByLabelText("Message the toucan");
}

// Released, not merely hidden: the bird resumes roaming (the stage reports it, as the real
// flyer would once the summon is withdrawn) and the chrome offers to call it again.
async function expectToucanReleased(view: ReturnType<typeof render>) {
  expect(toucanPanel(view)).toBeNull();
  await act(async () => {
    stageState.onToucanSummonStateChange?.("roaming");
  });
  expect(view.getByRole("button", { name: "Call the toucan" })).toBeTruthy();
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

describe("OfficeMap — opening a conversation releases the Toucan panel", () => {
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

  it("Global Chat → DM closes the Toucan and shows the DM", async () => {
    chatListState.conversations = [dmConv];
    const view = render(<OfficeMap />);
    await summonToucan(view);

    await selectFromGlobalChat(view, "Peer Person");

    // Exactly one conversation panel (the DM) and no Toucan composer in front of it.
    expect(panelCount(view.container)).toBe(1);
    await expectToucanReleased(view);
  });

  it("Global Chat → group closes the Toucan and shows the group", async () => {
    chatListState.conversations = [groupConv];
    const view = render(<OfficeMap />);
    await summonToucan(view);

    await selectFromGlobalChat(view, "Design Sync");

    expect(panelCount(view.container)).toBe(1);
    expect(toucanPanel(view)).toBeNull();
  });

  it("Global Chat → spatial DM (live session) also closes the Toucan and still routes spatially", async () => {
    chatListState.conversations = [dmConv];
    spatialSessionsState.sessions = [{ sessionId: dmConv.id, members: ["peer@example.com"] }];
    const view = render(<OfficeMap />);
    await summonToucan(view);

    await selectFromGlobalChat(view, "Peer Person");

    expect(panelCount(view.container)).toBe(1);
    expect(toucanPanel(view)).toBeNull();
    expect(emitStart).toHaveBeenCalledWith(dmConv.id);
  });

  it("A3 urgent-card Open closes the Toucan and opens the flagged DM", async () => {
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
    await waitFor(() => expect(panelCount(view.container)).toBe(1));
    await expectToucanReleased(view);
  });

  it("with the Toucan never called, opening a DM is unchanged", async () => {
    chatListState.conversations = [dmConv];
    const view = render(<OfficeMap />);
    await waitFor(() => view.getByRole("button", { name: "Call the toucan" }));

    await selectFromGlobalChat(view, "Peer Person");

    expect(panelCount(view.container)).toBe(1);
    expect(toucanPanel(view)).toBeNull();
    expect(view.getByRole("button", { name: "Call the toucan" })).toBeTruthy();
  });
});
