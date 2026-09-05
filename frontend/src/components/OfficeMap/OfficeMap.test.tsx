import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, within, act, waitFor } from "@testing-library/react";
import { OfficeMap } from "./OfficeMap";
import type { OfficePerson } from "../../services/office/floorMerge";
import sidebarStyles from "./RoomSidebar.module.css";
import talkingBubbleStyles from "./TalkingBubble.module.css";
import conversationPanelStyles from "../Chat/ConversationView.module.css";
import badgeStyles from "../Chat/MessageNotificationBadge.module.css";
import type { ConversationUpgradedListener, TypingListener } from "../../services/chat";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../auth/currentUserStore";
import { BON_SPRITE_SET, characterSprite } from "../../data/bonWalkFrames";
import type { PeerMovementState } from "../../services/presence/movementSync";
import { clearAll as clearCheckoutStorage, saveResult as saveCheckoutResult } from "../../data/checkoutStorage";
import { getCurrentUserId } from "../../auth/useAuthGate";
import { mockAttendanceService, resetMockAttendanceForTests } from "../../services/attendance";
import { FRAME_HEIGHT, FRAME_WIDTH, bonLayer, officeAssetLayers } from "../../data/office-layout";
import { isWalkable, worldToCell } from "../../data/officeGrid";
import { insideOfficeValidator } from "./spawnPlacement";
import { computeCenterTransform } from "./panMath";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";

// Spies on the two spatial-session emit functions so tests can assert
// exactly when spatial_session_start/leave fire, without opening a real
// socket.io connection (spatialSessionStore.ts's emit* functions talk to a
// live socket otherwise). useSpatialSessions is stubbed to an empty
// snapshot — no test in this file currently asserts on spatial-session
// rendering, only on when the emit functions are invoked.
const { emitSpatialSessionStartMock, emitSpatialSessionLeaveMock, spatialSessionsState } = vi.hoisted(() => ({
  emitSpatialSessionStartMock: vi.fn(),
  emitSpatialSessionLeaveMock: vi.fn(),
  // Mutable snapshot returned by the useSpatialSessions stub — empty for every pre-existing
  // test; the Global Chat routing tests below swap in live sessions, scoped via afterEach.
  spatialSessionsState: { sessions: [] as { sessionId: string; members: string[] }[] },
}));

vi.mock("../../services/presence/spatialSessionStore", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/spatialSessionStore")>(
    "../../services/presence/spatialSessionStore",
  );
  return {
    ...actual,
    emitSpatialSessionStart: emitSpatialSessionStartMock,
    emitSpatialSessionLeave: emitSpatialSessionLeaveMock,
    useSpatialSessions: () => spatialSessionsState.sessions,
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
  chatModeState,
  chatListState,
} = vi.hoisted(() => {
  let capturedTyping: TypingListener | null = null;
  let capturedUpgraded: ConversationUpgradedListener | null = null;
  return {
    // Mutable so the Global Chat routing tests below can flip OfficeMap into real mode (the 💬
    // badge/list only renders when chatMode === "real"); every pre-existing test keeps "mock".
    chatModeState: { mode: "mock" as "mock" | "real" },
    // What the stubbed listConversations resolves to — the 💬 list's rows.
    chatListState: { conversations: [] as import("../../services/chat").Conversation[] },
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
    // Getter (not a snapshot) so chatModeState.mode changes are seen by every module reading
    // `chatMode` at render/effect time — OfficeMap, ConversationView, useUnreadTotal.
    get chatMode() {
      return chatModeState.mode;
    },
    chatService: {
      ...actual.chatService,
      onTyping: onTypingMock,
      onConversationUpgraded: onConversationUpgradedMock,
      // Real-mode ConversationView opens (or creates) the DM before loading history; the id it
      // resolves is what onConversationOpen -> emitSpatialSessionStart receives.
      openConversationWith: vi.fn(async (peerId: string, selfId: string) => ({
        id: `conv-dm:${peerId}`,
        participantIds: [selfId, peerId],
        lastMessageAt: "2026-01-01T00:00:00.000Z",
        type: "dm" as const,
      })),
      // Spreading a class instance only copies own enumerable properties,
      // not prototype methods — these all live on MockChatService's
      // prototype, so they need explicit stubs here now that firing
      // onConversationUpgraded actually mounts a live GroupConversationView
      // panel (which calls getMessages/onMessage on mount) and Stage B2's
      // handler calls useUnreadTotal's refetch() (-> listConversations)
      // unconditionally (unlike the rest of that hook, refetch has no
      // chatMode !== "real" guard).
      listConversations: vi.fn(async () => chatListState.conversations),
      getMessages: vi.fn(async () => []),
      onMessage: vi.fn(() => () => {}),
    },
  };
});

// Real-mode-only HUD pieces (JoinRequestPrompt / DndRequestQueue) poll their pending-request
// lists over REST on mount; with no auth token in jsdom that fetch rejects ("Missing
// Authorization bearer token") as an unhandled rejection. Stub just the polling hooks to an empty
// list — every other export (createJoinRequest, cancelTalkRequest, onRequestResolved, ...) that
// OfficeMap itself imports stays real.
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

// getPeerMovementSnapshot() is mocked so the self-facing-restore tests below
// (see "self facing restore on mount") can seed self's own snapshot entry
// (movement-sync's positions_snapshot, which includes self's stable entry
// even though self is excluded from PeerWalker rendering) without needing a
// real socket connection — usePeerMovements/ensureSocket stay real (no auth
// token in jsdom means ensureSocket() returns null and no network call ever
// happens, matching every pre-existing test's assumption of an empty peer
// list).
const { peerMovementSnapshotState } = vi.hoisted(() => ({
  peerMovementSnapshotState: {
    entries: [] as import("../../services/presence/movementSync").PeerMovementState[],
    // When true, the spawn effect treats the seeded entries as the socket's first
    // positions_snapshot instead of waiting MOVEMENT_SNAPSHOT_WAIT_MS for one.
    snapshotReady: false,
  },
}));
vi.mock("../../services/presence/movementSync", async () => {
  const actual = await vi.importActual<typeof import("../../services/presence/movementSync")>(
    "../../services/presence/movementSync",
  );
  return {
    ...actual,
    getPeerMovementSnapshot: () => peerMovementSnapshotState.entries,
    useMovementSnapshotReady: () => {
      const actualReady = actual.useMovementSnapshotReady();
      return peerMovementSnapshotState.snapshotReady || actualReady;
    },
  };
});

// Camera write recorder for the "camera restore to self" tests below. The REAL TransformWrapper
// still renders (every other test in this file keeps its genuine pan/zoom behaviour); we only
// intercept the imperative ref so each `setTransform` call OfficeMap makes is recorded, then
// forwarded to the real lib. The controls object react-zoom-pan-pinch hands out is created once
// per instance, so wrapping it once per mount is enough.
const { cameraRecorder } = vi.hoisted(() => ({
  cameraRecorder: {
    calls: [] as { x: number; y: number; scale: number }[],
    controls: null as import("react-zoom-pan-pinch").ReactZoomPanPinchRef | null,
    wrapped: new WeakSet<object>(),
    // When true, the wrapper's onInit (OfficeMap's "camera ready" signal) is held back until the
    // test calls releaseInit() — simulates a camera that initialises AFTER the restored self
    // position is already known.
    holdInit: false,
    releaseInit: null as null | (() => void),
  },
}));
vi.mock("react-zoom-pan-pinch", async () => {
  const actual = await vi.importActual<typeof import("react-zoom-pan-pinch")>("react-zoom-pan-pinch");
  const React = await import("react");
  type Controls = import("react-zoom-pan-pinch").ReactZoomPanPinchRef;
  type Props = React.ComponentProps<typeof actual.TransformWrapper>;
  const TransformWrapper = React.forwardRef<Controls, Props>(function RecordingTransformWrapper(props, ref) {
    const merged = React.useCallback(
      (controls: Controls | null) => {
        if (controls && !cameraRecorder.wrapped.has(controls)) {
          cameraRecorder.wrapped.add(controls);
          const real = controls.setTransform;
          controls.setTransform = (x, y, scale, time, type) => {
            cameraRecorder.calls.push({ x, y, scale });
            return real(x, y, scale, time, type);
          };
        }
        cameraRecorder.controls = controls;
        if (typeof ref === "function") ref(controls);
        else if (ref) ref.current = controls;
      },
      [ref],
    );
    const onInit = props.onInit;
    const heldOnInit: typeof onInit = (ctx) => {
      if (cameraRecorder.holdInit) cameraRecorder.releaseInit = () => onInit?.(ctx);
      else onInit?.(ctx);
    };
    return React.createElement(actual.TransformWrapper, { ...props, ref: merged, onInit: heldOnInit });
  });
  return { ...actual, TransformWrapper };
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
    // 165 layers from the manifest: floor + rooms + decor + characters +
    // furniture (161 previous + 3 for the new ai-door / executive-door-left /
    // executive-door-right visual door assets from Bon's Figma redesign,
    // + 1 for the jan character layer added with the A2 roster).
    expect(images.length).toBe(165);
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
  describe("Global Chat routing: spatial vs remote (resolveConversationSlot)", () => {
    const peerPerson: OfficePerson = {
      ...designPerson,
      email: "peer@example.com",
      displayName: "Peer Person",
    };
    // Default/unauthenticated selfChatId falls back to playerLayerId ("bon") — same fallback the
    // peer-typing and Stage B2 tests above rely on.
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

    beforeEach(() => {
      chatModeState.mode = "real";
      mockRosterPeople = [peerPerson];
      emitSpatialSessionStartMock.mockClear();
      emitSpatialSessionLeaveMock.mockClear();
    });

    afterEach(() => {
      chatModeState.mode = "mock";
      mockRosterPeople = [];
      spatialSessionsState.sessions = [];
      chatListState.conversations = [];
    });

    function panelCount(container: HTMLElement): number {
      return container.querySelectorAll(`.${conversationPanelStyles.panel}`).length;
    }
    function spatialBadgeCount(container: HTMLElement): number {
      return container.querySelectorAll(`.${conversationPanelStyles.spatialBadge}`).length;
    }
    async function selectFromGlobalChat(view: ReturnType<typeof render>, rowLabel: string) {
      // Opens the 💬 dropdown and clicks the conversation row. The list is populated by
      // useUnreadTotal's async listConversations fetch, so wait for the row to appear.
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: /Conversations|unread message/ }));
      });
      // Scope to the dropdown's own rows — an already-open panel's header shows the same name.
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
      // Let ConversationView's openConversationWith/getMessages promises settle.
      await act(async () => {
        await Promise.resolve();
      });
    }

    // -----------------------------------------------------------------------
    // Regression: BOTH clients crashed into the app error boundary the moment
    // a SECOND participant made a spatial session active (members.length >= 2).
    // The spatial-focus effect fires exactly on that transition and read
    // `transformRef.current.instance.transformState`, which does not exist on
    // ZoomPanPinch — the live transform lives on the ref itself. The resulting
    // TypeError was thrown from inside a useEffect, so React propagated it
    // straight to the error boundary. The session-identity mapping was also
    // reading `s.id` on a SpatialSessionEntry whose key is `sessionId`.
    // -----------------------------------------------------------------------
    it("a second participant joining an active spatial session does not crash (both clients)", async () => {
      const onError = vi.fn();
      const view = render(<OfficeMap />);

      // 1. one member only -> not yet an active conversation, no focus
      await act(async () => {
        spatialSessionsState.sessions = [{ sessionId: "conv-1", members: ["peer@example.com"] }];
        view.rerender(<OfficeMap />);
      });
      expect(onError).not.toHaveBeenCalled();

      // 2. THE CRASHING TRANSITION: the second participant opens the chat, so
      //    the session becomes active on both clients simultaneously.
      await act(async () => {
        spatialSessionsState.sessions = [
          { sessionId: "conv-1", members: ["peer@example.com", "jerevon@offshorly.com"] },
        ];
        view.rerender(<OfficeMap />);
      });
      // the office is still mounted and rendering — no error boundary
      expect(view.container.querySelector(".officeRoot, [data-testid], div")).toBeTruthy();

      // 3. a participant-set change while the SAME session stays active must
      //    not loop or throw either
      await act(async () => {
        spatialSessionsState.sessions = [
          { sessionId: "conv-1", members: ["peer@example.com", "jerevon@offshorly.com", "third@example.com"] },
        ];
        view.rerender(<OfficeMap />);
      });

      // 4. leaving restores without throwing
      await act(async () => {
        spatialSessionsState.sessions = [];
        view.rerender(<OfficeMap />);
      });
      expect(view.container).toBeTruthy();
    });

    it("opens an active peer spatial DM in the SPATIAL slot (badge shown, spatial_session_start emitted once) — not remote", async () => {
      chatListState.conversations = [dmConv];
      spatialSessionsState.sessions = [{ sessionId: dmConv.id, members: ["peer@example.com"] }];
      const view = render(<OfficeMap />);

      await selectFromGlobalChat(view, "Peer Person");

      expect(panelCount(view.container)).toBe(1);
      expect(spatialBadgeCount(view.container)).toBe(1);
      expect(emitSpatialSessionStartMock).toHaveBeenCalledTimes(1);
      expect(emitSpatialSessionStartMock).toHaveBeenCalledWith(dmConv.id);
    });

    it("keeps a normal DM (no live session) REMOTE: no spatial badge, no spatial_session_start", async () => {
      chatListState.conversations = [dmConv];
      spatialSessionsState.sessions = [];
      const view = render(<OfficeMap />);

      await selectFromGlobalChat(view, "Peer Person");

      expect(panelCount(view.container)).toBe(1);
      expect(spatialBadgeCount(view.container)).toBe(0);
      expect(emitSpatialSessionStartMock).not.toHaveBeenCalled();
    });

    it("treats a stale self-only session as REMOTE", async () => {
      chatListState.conversations = [dmConv];
      spatialSessionsState.sessions = [{ sessionId: dmConv.id, members: ["bon"] }];
      const view = render(<OfficeMap />);

      await selectFromGlobalChat(view, "Peer Person");

      expect(panelCount(view.container)).toBe(1);
      expect(spatialBadgeCount(view.container)).toBe(0);
      expect(emitSpatialSessionStartMock).not.toHaveBeenCalled();
    });

    it("opens an active spatial GROUP in the spatial group slot, and an inactive group remotely", async () => {
      chatListState.conversations = [groupConv];
      spatialSessionsState.sessions = [
        { sessionId: groupConv.id, members: ["peer@example.com", "other@example.com"] },
      ];
      const active = render(<OfficeMap />);
      await selectFromGlobalChat(active, "Design Sync");
      expect(panelCount(active.container)).toBe(1);
      expect(spatialBadgeCount(active.container)).toBe(1);
      expect(emitSpatialSessionStartMock).toHaveBeenCalledTimes(1);
      expect(emitSpatialSessionStartMock).toHaveBeenCalledWith(groupConv.id);
      active.unmount();

      emitSpatialSessionStartMock.mockClear();
      spatialSessionsState.sessions = [];
      const inactive = render(<OfficeMap />);
      await selectFromGlobalChat(inactive, "Design Sync");
      expect(panelCount(inactive.container)).toBe(1);
      expect(spatialBadgeCount(inactive.container)).toBe(0);
      expect(emitSpatialSessionStartMock).not.toHaveBeenCalled();
    });

    it("closes an existing REMOTE window for the same DM when it is reopened as spatial — never both at once, start emitted once", async () => {
      chatListState.conversations = [dmConv];
      spatialSessionsState.sessions = [];
      const view = render(<OfficeMap />);

      // Step 1: no live session yet -> remote window.
      await selectFromGlobalChat(view, "Peer Person");
      expect(panelCount(view.container)).toBe(1);
      expect(spatialBadgeCount(view.container)).toBe(0);

      // Step 2: the peer walks up and opens this DM via Character -> Chat (server now broadcasts
      // a session for it); the user reopens it from Global Chat.
      spatialSessionsState.sessions = [{ sessionId: dmConv.id, members: ["peer@example.com"] }];
      view.rerender(<OfficeMap />);
      await selectFromGlobalChat(view, "Peer Person");

      // Exactly one panel remains (the remote one was closed), and it is the spatial one.
      expect(panelCount(view.container)).toBe(1);
      expect(spatialBadgeCount(view.container)).toBe(1);
      expect(emitSpatialSessionStartMock).toHaveBeenCalledTimes(1);
      expect(emitSpatialSessionStartMock).toHaveBeenCalledWith(dmConv.id);
    });
  });
  describe("self facing restore on mount (movement-sync snapshot beats the seat/roster default)", () => {
    const SELF_EMAIL = "jerevon@offshorly.com"; // maps to avatarId "bon" + room "design-team"

    const selfPerson: OfficePerson = {
      email: SELF_EMAIL,
      displayName: "Bon",
      status: "ONLINE",
      departmentName: "Design",
      jobTitle: null,
      currentActivity: null,
      lastMessage: null,
      avatarId: "bon",
      roomId: "design-team",
      atlasRoomId: null,
      inEphemeralRoom: false,
    };

    function selfSnapshotEntry(overrides: Partial<PeerMovementState["stable"]>): PeerMovementState[] {
      return [
        {
          email: SELF_EMAIL,
          revision: 1,
          stable: {
            pos: { x: 0, y: 0 },
            facing: "front",
            state: "standing",
            seatKey: null,
            roomId: null,
            ...overrides,
          },
          active: null,
        },
      ];
    }

    beforeEach(() => {
      mockRosterPeople = [selfPerson];
      setCurrentUserFromMeResponse({
        id: "self-id",
        email: SELF_EMAIL,
        full_name: "Bon",
        role: "",
        team: null,
      });
    });

    afterEach(() => {
      mockRosterPeople = [];
      peerMovementSnapshotState.entries = [];
      peerMovementSnapshotState.snapshotReady = false;
      resetMockAttendanceForTests(getCurrentUserId());
      resetCurrentUserForTests();
      window.history.pushState({}, "", "/");
    });

    // Manila calendar date, matching useCheckoutFlow's own manilaWorkDate()
    // key derivation — needed to seed checkoutStorage under the SAME key
    // the hook's lazy useState initializer reads on mount.
    function manilaWorkDate(): string {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    }

    it("standing: seeds self's initial direction from the synced facing, not the seat default", async () => {
      // Forces seatedAtDesk=false (bonLayer spawn, no seat resolution) so
      // the rendered direction can only ever come from useCharacterWalk's
      // own "front" default or this fix's face(selfSnapshot.stable.facing)
      // call — never a seat's fixed direction. Seeded via checkoutStorage
      // (not the dev-only `?checkedOut=1` query param, which applies via an
      // async effect that races the spawn effect's own once-only guard) so
      // useCheckoutFlow's lazy initializer already resolves CHECKED_OUT on
      // the very first render, matching a genuine "already checked out,
      // page reloaded" reload.
      const employeeId = getCurrentUserId();
      const workDate = manilaWorkDate();
      saveCheckoutResult(employeeId, workDate, { success: true, submissionId: "test-sub", entriesCreated: 0 });
      peerMovementSnapshotState.entries = selfSnapshotEntry({ facing: "left", state: "standing" });

      try {
        const { container } = render(<OfficeMap />);

        const expectedSrc = characterSprite(BON_SPRITE_SET, "idle", "left");
        await waitFor(() => {
          const imgs = Array.from(container.querySelectorAll("img"));
          expect(imgs.some((img) => img.getAttribute("src") === expectedSrc)).toBe(true);
        });
      } finally {
        clearCheckoutStorage(employeeId, workDate);
      }
    });

    it("sitting: seeds sitDirection from the synced facing, overriding whatever the resolved seat's own fixed direction is", async () => {
      // Two DIFFERENT synced facings, same seat/room/person: a fixed
      // seat-default implementation would render the SAME sitType src both
      // times (whatever the seat's own direction is) — rendering each
      // test's OWN distinct facing instead proves the snapshot facing wins.
      //
      // Attendance gates the interior spawn (spawnPlacement.ts): only a
      // CHECKED_IN employee is placed at a seat, so the mock attendance record
      // is checked in first, and the seeded entries stand in for the movement
      // socket's first positions_snapshot.
      await mockAttendanceService.checkIn(getCurrentUserId());
      peerMovementSnapshotState.snapshotReady = true;
      for (const facing of ["left", "back"] as const) {
        mockRosterPeople = [selfPerson];
        peerMovementSnapshotState.entries = selfSnapshotEntry({ facing, state: "sitting" });

        const { container, unmount } = render(<OfficeMap />);
        const expectedSrc = characterSprite(BON_SPRITE_SET, "sitType", facing);
        await waitFor(() => {
          const imgs = Array.from(container.querySelectorAll("img"));
          expect(imgs.some((img) => img.getAttribute("src") === expectedSrc)).toBe(true);
        });
        unmount();
      }
    });

    it("falls back to the seat default when there is no self snapshot entry yet", async () => {
      peerMovementSnapshotState.entries = [];
      expect(() => render(<OfficeMap />)).not.toThrow();
    });
  });

  // Regression coverage for the reload camera bug (2026-09-05): avatar position persistence
  // restored self correctly, but the camera stayed on the mount framing (bonLayer = the
  // entrance/reception) so the user had to pan around to find themselves. The fix frames the
  // camera on the restored position ONCE from the spawn-restore effect. Nothing here drives the
  // camera through the DOM — jsdom gives the wrapper a 0x0 rect — so the assertions are on the
  // recorded setTransform writes, computed with the same panMath helper OfficeMap uses.
  describe("camera restore to self on reload (one-shot, not a follow camera)", () => {
    const SELF_EMAIL = "jerevon@offshorly.com";
    const selfPerson: OfficePerson = {
      email: SELF_EMAIL,
      displayName: "Bon",
      status: "ONLINE",
      departmentName: "Design",
      jobTitle: null,
      currentActivity: null,
      lastMessage: null,
      avatarId: "bon",
      roomId: "design-team",
      atlasRoomId: null,
      inEphemeralRoom: false,
    };
    const AVATAR = { width: bonLayer.width, height: bonLayer.height };
    // Same cover-fit rule OfficeMap's computeCoverScale uses (module-private there).
    const initialScale = Math.max(window.innerWidth / FRAME_WIDTH, window.innerHeight / FRAME_HEIGHT);
    const FOCUS_SCALE = initialScale * 2.5;
    const pct = (v: number, frame: number) => `${(v / frame) * 100}%`;

    // The framing OfficeMap must write for an avatar whose top-left is `pos` (0x0 wrapper in jsdom).
    function framingFor(pos: { x: number; y: number }) {
      const { x, y } = computeCenterTransform({ x: pos.x, y: pos.y, ...AVATAR }, FOCUS_SCALE, 0, 0);
      return { x, y, scale: FOCUS_SCALE };
    }
    const sameFraming = (a: { x: number; y: number; scale: number }, b: { x: number; y: number; scale: number }) =>
      Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.scale - b.scale) < 1e-6;

    // A persisted standing spot that passes the SAME inside/walkable checks the spawn effect
    // applies (spawnPlacement.ts), found with the real validators so the test never hard-codes a
    // point the floor plan could later invalidate. Distinct from bonLayer (the entrance) so a
    // restored framing is distinguishable from the mount framing.
    function findRestorableStandingPos(): { x: number; y: number } {
      const inside = insideOfficeValidator(officeAssetLayers.find((l) => l.kind === "sidewalk") ?? null);
      for (let y = 40; y < FRAME_HEIGHT - AVATAR.height; y += 20) {
        for (let x = 40; x < FRAME_WIDTH - AVATAR.width; x += 20) {
          const center = { x: x + AVATAR.width / 2, y: y + AVATAR.height / 2 };
          const cell = worldToCell(center);
          if (inside(center) && isWalkable(cell.cx, cell.cy) && (x !== bonLayer.x || y !== bonLayer.y)) return { x, y };
        }
      }
      throw new Error("no restorable standing position found on the floor plan");
    }

    function selfStanding(pos: { x: number; y: number }, revision = 1): PeerMovementState[] {
      return [
        { email: SELF_EMAIL, revision, stable: { pos, facing: "left", state: "standing", seatKey: null, roomId: null }, active: null },
      ];
    }

    function selfSpriteLayer(container: HTMLElement): HTMLElement {
      const src = characterSprite(BON_SPRITE_SET, "idle", "left");
      const img = Array.from(container.querySelectorAll("img")).find((el) => el.getAttribute("src") === src);
      expect(img, "self idle-left sprite").toBeTruthy();
      return img!.parentElement as HTMLElement;
    }

    beforeEach(() => {
      cameraRecorder.calls = [];
      cameraRecorder.holdInit = false;
      cameraRecorder.releaseInit = null;
      mockRosterPeople = [selfPerson];
      setCurrentUserFromMeResponse({ id: "self-id", email: SELF_EMAIL, full_name: "Bon", role: "", team: null });
    });

    afterEach(() => {
      mockRosterPeople = [];
      peerMovementSnapshotState.entries = [];
      peerMovementSnapshotState.snapshotReady = false;
      resetMockAttendanceForTests(getCurrentUserId());
      resetCurrentUserForTests();
      cameraRecorder.calls = [];
    });

    it("a CHECKED_IN restored standing position centers the camera on it exactly once, at the default focus zoom, and leaves the avatar position untouched", async () => {
      const pos = findRestorableStandingPos();
      await mockAttendanceService.checkIn(getCurrentUserId());
      peerMovementSnapshotState.snapshotReady = true;
      peerMovementSnapshotState.entries = selfStanding(pos);

      const { container } = render(<OfficeMap />);

      const restored = framingFor(pos);
      await waitFor(() => {
        expect(cameraRecorder.calls.some((c) => sameFraming(c, restored))).toBe(true);
      });
      // Exactly one restore framing, and it is the LAST camera write — nothing re-frames after it.
      expect(cameraRecorder.calls.filter((c) => sameFraming(c, restored)).length).toBe(1);
      expect(sameFraming(cameraRecorder.calls[cameraRecorder.calls.length - 1], restored)).toBe(true);
      // Default office focus zoom, same multiplier as the mount framing — no zoom jump.
      expect(cameraRecorder.calls.every((c) => Math.abs(c.scale - FOCUS_SCALE) < 1e-6)).toBe(true);
      // The restored avatar position itself is exactly the persisted one — the fix only READS it.
      const layer = selfSpriteLayer(container);
      expect(layer.style.left).toBe(pct(pos.x, FRAME_WIDTH));
      expect(layer.style.top).toBe(pct(pos.y, FRAME_HEIGHT));
    });

    it("does not recenter again on later renders or when self's synced position changes afterwards", async () => {
      const pos = findRestorableStandingPos();
      await mockAttendanceService.checkIn(getCurrentUserId());
      peerMovementSnapshotState.snapshotReady = true;
      peerMovementSnapshotState.entries = selfStanding(pos);

      const { rerender } = render(<OfficeMap />);
      const restored = framingFor(pos);
      await waitFor(() => expect(cameraRecorder.calls.some((c) => sameFraming(c, restored))).toBe(true));
      const writesAfterRestore = cameraRecorder.calls.length;

      // Self "moves": a newer snapshot revision at a different spot (as walk_arrived would
      // produce), plus several re-renders and time passing. The spawn effect's once-guard
      // means the camera must never be written again.
      peerMovementSnapshotState.entries = selfStanding({ x: pos.x + 120, y: pos.y + 60 }, 2);
      for (let i = 0; i < 3; i += 1) {
        rerender(<OfficeMap />);
        await act(() => new Promise((r) => setTimeout(r, 20)));
      }
      expect(cameraRecorder.calls.length).toBe(writesAfterRestore);
    });

    it("hands the camera straight back to the user: TransformWrapper stays enabled for pan/zoom/wheel and only the two framing writes happen", async () => {
      const pos = findRestorableStandingPos();
      await mockAttendanceService.checkIn(getCurrentUserId());
      peerMovementSnapshotState.snapshotReady = true;
      peerMovementSnapshotState.entries = selfStanding(pos);

      render(<OfficeMap />);
      const restored = framingFor(pos);
      await waitFor(() => expect(cameraRecorder.calls.some((c) => sameFraming(c, restored))).toBe(true));

      // mount framing (entrance) + one restore framing — no follow-camera writes in between.
      expect(cameraRecorder.calls.length).toBe(2);
      expect(sameFraming(cameraRecorder.calls[0], framingFor({ x: bonLayer.x, y: bonLayer.y }))).toBe(true);
      const setup = (cameraRecorder.controls as ReactZoomPanPinchRef).instance.setup;
      expect(setup.disabled).toBe(false);
      expect(setup.panning.disabled).toBe(false);
      expect(setup.wheel.disabled).toBe(false);
      expect(setup.pinch.disabled).toBe(false);
    });

    it("lifecycle gap: restored self position known BEFORE the camera is ready still gets exactly one focus once the camera initialises", async () => {
      // Reproduces the normal-refresh mismatch class: the spawn-restore effect applies the
      // persisted position while the camera cannot be written yet. A focus tied to the spawn
      // effect's own once-guard is lost forever in that ordering; the decoupled one-time focus
      // effect must instead fire when the camera becomes ready — and only once.
      const pos = findRestorableStandingPos();
      await mockAttendanceService.checkIn(getCurrentUserId());
      peerMovementSnapshotState.snapshotReady = true;
      peerMovementSnapshotState.entries = selfStanding(pos);
      cameraRecorder.holdInit = true;

      const { container } = render(<OfficeMap />);
      const restored = framingFor(pos);
      // Avatar is restored (placement applied) ...
      await waitFor(() => {
        const layer = selfSpriteLayer(container);
        expect(layer.style.left).toBe(pct(pos.x, FRAME_WIDTH));
      });
      // ... but the camera-ready signal has not fired, so no restore framing may exist yet.
      expect(cameraRecorder.calls.some((c) => sameFraming(c, restored))).toBe(false);
      expect(cameraRecorder.releaseInit, "held onInit").toBeTruthy();

      await act(async () => {
        cameraRecorder.releaseInit!();
      });
      await waitFor(() => expect(cameraRecorder.calls.some((c) => sameFraming(c, restored))).toBe(true));
      expect(cameraRecorder.calls.filter((c) => sameFraming(c, restored)).length).toBe(1);
      // Avatar position untouched by the late focus.
      const layer = selfSpriteLayer(container);
      expect(layer.style.left).toBe(pct(pos.x, FRAME_WIDTH));
      expect(layer.style.top).toBe(pct(pos.y, FRAME_HEIGHT));
    });

    it("default startup (not checked in) keeps only the entrance framing — no restore centering", async () => {
      // Mock attendance defaults to CHECKED_OUT, so the spawn effect resolves the sidewalk
      // placement (bonLayer). Only the mount framing may be written.
      peerMovementSnapshotState.entries = [];
      render(<OfficeMap />);
      await act(() => new Promise((r) => setTimeout(r, 60)));
      expect(cameraRecorder.calls.length).toBe(1);
      expect(sameFraming(cameraRecorder.calls[0], framingFor({ x: bonLayer.x, y: bonLayer.y }))).toBe(true);
    });
  });
});
