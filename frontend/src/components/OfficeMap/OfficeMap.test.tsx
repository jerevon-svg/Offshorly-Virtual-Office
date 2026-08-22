import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, within, act } from "@testing-library/react";
import { OfficeMap } from "./OfficeMap";
import type { OfficePerson } from "../../services/office/floorMerge";
import sidebarStyles from "./RoomSidebar.module.css";
import talkingBubbleStyles from "./TalkingBubble.module.css";
import conversationPanelStyles from "../Chat/ConversationView.module.css";
import type { ConversationUpgradedListener, TypingListener } from "../../services/chat";

// Spies on the two spatial-session emit functions so tests can assert
// exactly when spatial_session_start/leave fire, without opening a real
// socket.io connection (spatialSessionStore.ts's emit* functions talk to a
// live socket otherwise). useSpatialSessions is stubbed to an empty
// snapshot — no test in this file currently asserts on spatial-session
// rendering, only on when the emit functions are invoked.
const { emitSpatialSessionStartMock, emitSpatialSessionLeaveMock } = vi.hoisted(() => ({
  emitSpatialSessionStartMock: vi.fn(),
  emitSpatialSessionLeaveMock: vi.fn(),
}));

vi.mock("../../services/presence/spatialSessionStore", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/spatialSessionStore")>(
    "../../services/presence/spatialSessionStore",
  );
  return {
    ...actual,
    emitSpatialSessionStart: emitSpatialSessionStartMock,
    emitSpatialSessionLeave: emitSpatialSessionLeaveMock,
    useSpatialSessions: () => [],
  };
});

// Captures the callbacks OfficeMap.tsx registers via chatService.onTyping /
// chatService.onConversationUpgraded so tests can simulate a peer_typing /
// conversation_upgraded event arriving over the (mocked) socket, without
// depending on RealChatService's actual socket.io wiring. Declared via
// vi.hoisted since vi.mock's factory below is hoisted above these otherwise-
// top-level declarations.
const {
  onTypingMock,
  getCapturedOnTyping,
  onConversationUpgradedMock,
  getCapturedOnConversationUpgraded,
} = vi.hoisted(() => {
  let capturedTyping: TypingListener | null = null;
  let capturedUpgraded: ConversationUpgradedListener | null = null;
  return {
    onTypingMock: vi.fn((cb: TypingListener) => {
      capturedTyping = cb;
      return () => {
        capturedTyping = null;
      };
    }),
    getCapturedOnTyping: () => capturedTyping,
    onConversationUpgradedMock: vi.fn((cb: ConversationUpgradedListener) => {
      capturedUpgraded = cb;
      return () => {
        capturedUpgraded = null;
      };
    }),
    getCapturedOnConversationUpgraded: () => capturedUpgraded,
  };
});

vi.mock("../../services/chat", async () => {
  const actual = await vi.importActual<typeof import("../../services/chat")>(
    "../../services/chat",
  );
  return {
    ...actual,
    chatService: {
      ...actual.chatService,
      onTyping: onTypingMock,
      onConversationUpgraded: onConversationUpgradedMock,
      // Spreading a class instance only copies own enumerable properties,
      // not prototype methods — these all live on MockChatService's
      // prototype, so they need explicit stubs here now that firing
      // onConversationUpgraded actually mounts a live GroupConversationView
      // panel (which calls getMessages/onMessage on mount) and Stage B2's
      // handler calls useUnreadTotal's refetch() (-> listConversations)
      // unconditionally (unlike the rest of that hook, refetch has no
      // chatMode !== "real" guard).
      listConversations: vi.fn(async () => []),
      getMessages: vi.fn(async () => []),
      onMessage: vi.fn(() => () => {}),
    },
  };
});

// The roster's real occupants are keyed by the flat rooms/teamRooms
// namespace (e.g. "design-team"), while the room the sidebar was opened
// against is identified by the manifest namespace (e.g. "design-room").
// These two schemes coincide for 6 rooms but differ for the 4 "-team"
// rooms, which is exactly the class of bug this regression test guards
// against — see OfficeMap.tsx's flatRoomIdAt/roomSidebarFlatId bridge.
const designPerson: OfficePerson = {
  email: "designer@example.com",
  displayName: "Dana Designer",
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

// Mutable so the pre-existing tests below (which assert against the
// fictional-cast manifest render) see an EMPTY roster, exactly as before
// this mock was introduced — only the new regression test below opts a
// live person in, scoped to itself via beforeEach/afterEach.
let mockRosterPeople: OfficePerson[] = [];

vi.mock("../../services/office/useOfficeRoster", () => ({
  useOfficeRoster: () => ({
    people: mockRosterPeople,
    loading: false,
    error: null,
    live: true,
    roomNames: new Map(),
    floorCount: mockRosterPeople.length,
    presenceCount: mockRosterPeople.length,
  }),
}));

describe("OfficeMap", () => {
  it("renders without throwing", () => {
    expect(() => render(<OfficeMap />)).not.toThrow();
  });

  it("renders the layered office stage with multiple images", () => {
    const { container } = render(<OfficeMap />);
    const images = container.querySelectorAll("img");
    // 164 layers from the manifest: floor + rooms + decor + characters +
    // furniture (161 previous + 3 for the new ai-door / executive-door-left /
    // executive-door-right visual door assets from Bon's Figma redesign).
    expect(images.length).toBe(164);
  });

  it("mounts the TransformWrapper wrapper div", () => {
    const { container } = render(<OfficeMap />);
    const wrapper = container.querySelector(".react-transform-wrapper");
    expect(wrapper).not.toBeNull();
  });

  it("lists a live-roster person seated in a flat '-team' room under the sidebar for its manifest '-room' counterpart", () => {
    mockRosterPeople = [designPerson];
    try {
      const { container, queryByText } = render(<OfficeMap />);
      const designRoomLayer = container.querySelector('[data-room-id="design-room"]');
      expect(designRoomLayer).not.toBeNull();

      fireEvent.pointerDown(designRoomLayer!, { clientX: 0, clientY: 0 });
      fireEvent.pointerUp(designRoomLayer!, { clientX: 0, clientY: 0 });

      // "Dana Designer" now legitimately renders twice on screen: once here
      // in the sidebar's occupants list, and once in the floating
      // StatusLabel pill above her avatar. Scope the assertion to the
      // sidebar's `.item` row so this test only verifies the roster
      // listing it was written for, not the unrelated floating label.
      const occupantItem = container.querySelector(`.${sidebarStyles.item}`);
      expect(occupantItem).not.toBeNull();
      expect(within(occupantItem as HTMLElement).getByText("Dana Designer")).not.toBeNull();
      expect(queryByText("No employees in this room")).toBeNull();
    } finally {
      mockRosterPeople = [];
    }
  });

  describe("peer typing indicator", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function dotBubbleCount(container: HTMLElement): number {
      return container.querySelectorAll(`.${talkingBubbleStyles.bubble}`).length;
    }

    it("adds a peer's typing-dots bubble when onTyping fires isTyping: true, and removes it on isTyping: false", () => {
      const { container } = render(<OfficeMap />);
      expect(getCapturedOnTyping()).not.toBeNull();
      expect(dotBubbleCount(container)).toBe(0);

      act(() => {
        getCapturedOnTyping()!({ conversationId: "conv-1", senderId: "arisha", isTyping: true });
      });
      expect(dotBubbleCount(container)).toBe(1);

      act(() => {
        getCapturedOnTyping()!({ conversationId: "conv-1", senderId: "arisha", isTyping: false });
      });
      expect(dotBubbleCount(container)).toBe(0);
    });

    it("removes the peer's typing-dots bubble after the ~6s expiry when no further update arrives", () => {
      const { container } = render(<OfficeMap />);

      act(() => {
        getCapturedOnTyping()!({ conversationId: "conv-1", senderId: "arisha", isTyping: true });
      });
      expect(dotBubbleCount(container)).toBe(1);

      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(dotBubbleCount(container)).toBe(0);
    });

    it("ignores a self-authored typing update (senderId matching selfChatId) — never affects peer state", () => {
      const { container } = render(<OfficeMap />);

      act(() => {
        // Default/unauthenticated selfChatId falls back to playerLayerId
        // ("bon") — see OfficeMap.tsx's selfChatId derivation.
        getCapturedOnTyping()!({ conversationId: "conv-1", senderId: "bon", isTyping: true });
      });
      expect(dotBubbleCount(container)).toBe(0);
    });
  });

  describe("Stage B2: conversation_upgraded live reaction", () => {
    function panelCount(container: HTMLElement): number {
      return container.querySelectorAll(`.${conversationPanelStyles.panel}`).length;
    }

    it("opens the group panel (exactly one panel, never zero/two) when this user is among the upgraded conversation's participants", () => {
      const { container } = render(<OfficeMap />);
      expect(getCapturedOnConversationUpgraded()).not.toBeNull();
      expect(panelCount(container)).toBe(0);

      act(() => {
        // Default/unauthenticated selfChatId falls back to playerLayerId
        // ("bon") — same fallback the peer-typing tests above rely on.
        getCapturedOnConversationUpgraded()!({
          conversationId: "conv-group-1",
          oldConversationId: "conv-bon__peer",
          participantIds: ["bon", "peer@example.com"],
          title: null,
        });
      });

      // Exactly one panel renders (the new group panel) — never zero (the
      // mutual-exclusion vanish bug) and never two.
      expect(panelCount(container)).toBe(1);
      // GroupConversationView's headerTitle falls back to the other
      // participants' resolved display names when title is null — "bon" is
      // excluded as self, leaving only peer@example.com's formatted fallback
      // name (formatCharacterName has no roster/manifest entry for this
      // synthetic email, so it title-cases the local part).
      expect(container.querySelector(`.${conversationPanelStyles.title}`)?.textContent).toContain(
        "Peer@example.com",
      );
    });

    it("ignores an upgrade event whose participantIds do not include this user (defense in depth)", () => {
      const { container } = render(<OfficeMap />);

      act(() => {
        getCapturedOnConversationUpgraded()!({
          conversationId: "conv-group-1",
          oldConversationId: "conv-someone-else__another",
          participantIds: ["someone-else@example.com", "another@example.com"],
          title: null,
        });
      });

      expect(panelCount(container)).toBe(0);
    });

    it("clears pendingJoinerConvIdRef on close mid-walk, so reopening the same group later still emits spatial_session_start", async () => {
      const { container, getByLabelText } = render(<OfficeMap />);

      // Step 1: this user is the joiner — pendingJoinerConvIdRef gets set
      // for "conv-group-1" and the arrival-gated walk starts (never
      // completes in this test, mirroring "closed mid-walk").
      act(() => {
        getCapturedOnConversationUpgraded()!({
          conversationId: "conv-group-1",
          oldConversationId: "conv-bon__peer",
          participantIds: ["bon", "peer@example.com"],
          title: null,
        });
      });
      expect(panelCount(container)).toBe(1);
      // Guarded by pendingJoinerConvIdRef — must NOT have fired yet.
      expect(emitSpatialSessionStartMock).not.toHaveBeenCalledWith("conv-group-1");

      // Step 2: close the panel WHILE the walk is still pending. Before the
      // fix this left pendingJoinerConvIdRef stuck on "conv-group-1"
      // forever, since neither this onClose handler nor onJoinerArrived's
      // early-bail cleared it.
      act(() => {
        fireEvent.click(getByLabelText("Close chat"));
      });
      expect(panelCount(container)).toBe(0);

      // Step 3: "reopen" the SAME conversation — simulated here via a second
      // conversation_upgraded event classified as "incumbent" (openConversationIdRef
      // is now null after the close above, matched via oldConversationId: null),
      // which re-mounts GroupConversationView for the same conversationId and
      // fires its onConversationOpen callback again, exactly like a real
      // badge-driven reopen would. This isolates the exact bug: whether
      // pendingJoinerConvIdRef is still stale from step 1's joiner walk.
      act(() => {
        getCapturedOnConversationUpgraded()!({
          conversationId: "conv-group-1",
          oldConversationId: null as unknown as string,
          participantIds: ["bon", "peer@example.com"],
          title: null,
        });
      });
      expect(panelCount(container)).toBe(1);

      // Bug fixed: pendingJoinerConvIdRef was cleared on close, so this
      // reopen's onConversationOpen guard no longer wrongly skips the emit —
      // the joiner correctly re-enters the spatial cluster.
      expect(emitSpatialSessionStartMock).toHaveBeenCalledWith("conv-group-1");
    });
  });
});
