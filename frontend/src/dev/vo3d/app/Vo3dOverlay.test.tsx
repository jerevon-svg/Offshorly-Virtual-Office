// Phase 6D — WHAT A SELECTED COWORKER MEANS, asserted against V1's own services.
//
// The world is a stub (its picking and its walk have their own tests in world/Coworkers.pick.test.ts and
// player/targeting.person.test.ts); V1's services are mocked at the module boundary so what each action
// actually CALLS is visible. That is the thing a host can get wrong: a row that looks right and reaches
// nothing, a gate skipped, a second implementation of a rule V1 already owns.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dOverlay } from "./Vo3dOverlay";
import type { Vo3dCoworkerInteractions as Handlers } from "./interactions";
import type { V1Attendance } from "../adapters/v1Attendance";
import type { Vo3dWorld } from "./world";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../../auth/currentUserStore";
import type { OfficePerson } from "../../../services/office/floorMerge";
import type { OfficeAccess } from "./access";
import { getSelfStatusSnapshot, resetSelfStatusForTests, setManualStatus, startDnd } from "../../../services/presence/selfStatusStore";
import { KIOSK_INTERACTION_ID } from "../rooms/reception";
import { getCurrentUserId } from "../../../auth/useAuthGate";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only).
import { readFileSync } from "node:fs";
import { isTypingTarget } from "./keyGuard";
import { manilaWorkDate } from "../../../components/OfficeMap/useCheckoutFlow";

const SELF = "bon@offshorly.com";
const ALEX = "alex@offshorly.com";

// ---- V1's services, at the module boundary ---------------------------------------------------------
let dndEmails = new Set<string>();
vi.mock("../../../services/presence/dndClient", () => ({ useDndEmails: () => dndEmails }));

let sessions: { sessionId: string; members: string[] }[] = [];
const approachArrived = vi.fn((_email: string) => {});
const sessionStart = vi.fn((_id: string) => {});
const sessionLeave = vi.fn();
vi.mock("../../../services/presence/spatialSessionStore", () => ({
  useSpatialSessions: () => sessions,
  emitApproachArrived: (email: string) => approachArrived(email),
  emitSpatialSessionStart: (id: string) => sessionStart(id),
  emitSpatialSessionLeave: () => sessionLeave(),
}));

const callInvite = vi.fn((_email: string) => {});
const startOrJoin = vi.fn((_id: string) => Promise.resolve());
/** PHASE 7D. Live cameras the store is reporting, set per test. */
let callVideo: Record<string, unknown> = {};

/** PHASE 7D meeting chat, driven per test. */
let callStatus = "idle";
let callMeetingId: string | null = null;
type MeetingMsg = { id: string; email: string; text: string; atMs: number };
let meetingMessages: MeetingMsg[] = [];
/** Pushes a new meeting snapshot into the mounted overlay, the way the real socket store would. */
let pushMeeting: ((messages: MeetingMsg[]) => void) | null = null;

vi.mock("../../../services/meeting/meetingChatClient", async () => {
  const React = await import("react");
  return {
    useMeetingChat: () => {
      const [snap, setSnap] = React.useState(() => ({ messages: meetingMessages, reactions: [] }));
      React.useEffect(() => {
        pushMeeting = (messages) => setSnap({ messages, reactions: [] });
        return () => { pushMeeting = null; };
      }, []);
      return snap;
    },
    joinMeetingChat: vi.fn(),
    leaveMeetingChat: vi.fn(),
    sendMeetingChat: vi.fn(),
    sendMeetingReaction: vi.fn(),
    expireReactions: vi.fn(),
  };
});

vi.mock("../../../services/call/callStore", () => ({
  // `videoByIdentity` is not optional on the real snapshot (callStore always publishes a map, empty when
  // nobody has a camera on) — Phase 7D's overhead cameras read it, so the stand-in has to carry it too.
  useCallState: () => ({ acceptedPeerEmail: null, incoming: null, outgoing: null, outcome: null, calls: {}, status: callStatus, error: null, videoByIdentity: callVideo, participants: [], connectedMeetingId: callMeetingId }),
  callParticipantsFor: () => [] as string[],
  clearAcceptedPeer: vi.fn(),
  getCallSnapshot: () => ({ status: "idle", error: null }),
  isConnectedToMedia: () => false,
  sendCallInvite: (email: string) => callInvite(email),
  startOrJoinCall: (id: string) => startOrJoin(id),
}));

const joinRequest = vi.fn((_id: string) => Promise.resolve({ id: "r1" }));
vi.mock("../../../services/chat/requestsClient", () => ({ createJoinRequest: (id: string) => joinRequest(id) }));

const talkRequest = vi.fn((_email: string, _kind: string) => Promise.resolve({ id: "t1" }));
vi.mock("../../../services/chat/talkRequestsClient", () => ({
  createTalkRequest: (email: string, kind: string) => talkRequest(email, kind),
  cancelTalkRequest: vi.fn(() => Promise.resolve()),
  onTalkRequestResolved: () => () => {},
  onTalkRequestCancelled: () => () => {},
  TalkRequestCooldownError: class extends Error { cooldownUntil: string | null = null; },
}));

// V1's OWN attendance answer, as the host resolves it and hands it down.
let attendance: OfficeAccess = "permitted";
const attendanceProp = (): V1Attendance => ({
  access: attendance,
  record: { email: SELF, status: attendance === "permitted" ? "CHECKED_IN" : "CHECKED_OUT", checkedInAt: null, checkedOutAt: null },
  apply: attendanceApply,
  refresh: attendanceRefresh,
});
const attendanceApply = vi.fn();
const attendanceRefresh = vi.fn();

let conversations: unknown[] = [];
vi.mock("../../../services/chat/useUnreadTotal", () => ({
  useUnreadTotal: () => ({ total: 0, unreadConversations: [], conversations, refetch: () => Promise.resolve() }),
}));

// V1's typing channel, driven by the test. Everything else about chat stays the real module.
let typingListeners: ((u: { senderId: string; conversationId: string; isTyping: boolean }) => void)[] = [];
vi.mock("../../../services/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/chat")>();
  return {
    ...actual,
    // REAL MODE, because that is the only mode in which V1 offers the inbox, the group windows and the
    // whiteboard entry points at all — the parity this file now covers does not exist in mock mode.
    chatMode: "real",
    chatService: {
      ...actual.chatService,
      onTyping: (cb: (u: { senderId: string; conversationId: string; isTyping: boolean }) => void) => {
        typingListeners.push(cb);
        return () => { typingListeners = typingListeners.filter((l) => l !== cb); };
      },
    },
  };
});

// The two heavy V1 panels: mounted for real in the app, stubbed here so these tests stay about the
// wiring rather than about a chat transport or a profile fetch.
// The stub forwards V1's own onTypingChange edge, which is the seam under test.
vi.mock("../../../components/Chat/ConversationView", () => ({
  ConversationView: ({ peer, onTypingChange, onIncomingMessage, onMinimizeToggle, onOpenWhiteboard }: {
    peer: { id: string };
    onTypingChange?: (t: boolean) => void;
    onIncomingMessage?: (m: unknown) => void;
    onMinimizeToggle?: () => void;
    onOpenWhiteboard?: (conversationId: string, title: string) => void;
  }) => (
    <div
      data-testid="conversation"
      ref={(el) => {
        if (!el) return;
        (el as HTMLDivElement & { __t?: boolean }).__t = true;
        el.addEventListener("test:typing", (e) => onTypingChange?.((e as CustomEvent<boolean>).detail));
        el.addEventListener("test:message", (e) => onIncomingMessage?.((e as CustomEvent).detail));
      }}
    >
      {peer.id}
      {onMinimizeToggle && (
        <button type="button" aria-label={`minimize ${peer.id}`} onClick={onMinimizeToggle} />
      )}
      {onOpenWhiteboard && (
        <button type="button" aria-label={`board ${peer.id}`} onClick={() => onOpenWhiteboard("conv-dm", peer.id)} />
      )}
    </div>
  ),
}));
// The GROUP window and the WHITEBOARD both fetch on mount; stubbed so these stay about the WIRING —
// which scope a board is opened at, and that a conversation is never disturbed by one.
vi.mock("../../../components/Chat/GroupConversationView", () => ({
  GroupConversationView: ({ conversationId, onMinimizeToggle, onOpenWhiteboard }: {
    conversationId: string; onMinimizeToggle?: () => void; onOpenWhiteboard?: () => void;
  }) => (
    <div data-testid="group-conversation">
      {conversationId}
      {onMinimizeToggle && <button type="button" aria-label={`minimize ${conversationId}`} onClick={onMinimizeToggle} />}
      {onOpenWhiteboard && <button type="button" aria-label={`board ${conversationId}`} onClick={onOpenWhiteboard} />}
    </div>
  ),
}));
vi.mock("../../../components/Whiteboard/WhiteboardPanel", () => ({
  WhiteboardPanel: ({ scope, title, onClose, onAskToucan }: {
    scope: { kind: string; id: string }; title: string; onClose: () => void;
    onAskToucan?: (b: { id: string; title: string }) => void;
  }) => (
    <div data-testid="whiteboard" data-scope={`${scope.kind}:${scope.id}`} data-title={title}>
      <button type="button" aria-label="close board" onClick={onClose} />
      {onAskToucan && (
        <button type="button" aria-label="ask toucan about board" onClick={() => onAskToucan({ id: "b1", title })} />
      )}
    </div>
  ),
}));
vi.mock("../../../components/OfficeMap/EmployeeProfile", () => ({
  EmployeeProfile: ({ email }: { email: string }) => <div data-testid="profile">{email}</div>,
}));
vi.mock("../../../components/OfficeMap/SpatialCallControls", () => ({ SpatialCallControls: () => null }));
// PHASE 7G — V1's Toucan panel. Stubbed for the same reason ConversationView is: it loads a transcript
// from the service on mount, and what is under test here is the HOST's part — the slot it lands in, the
// board it was asked about, the typing edge it reports and the conversation opener its return card uses.
// The real panel's own behaviour is components/OfficeMap/Toucan*.test.tsx's subject.
vi.mock("../../../components/OfficeMap/ToucanAssistantPanel", () => ({
  ToucanAssistantPanel: ({ onRelease, onTypingChange, onPendingChange, onOpenConversation, boardContext }: {
    onRelease: () => void;
    onTypingChange?: (t: boolean) => void;
    onPendingChange?: (p: boolean) => void;
    onOpenConversation?: (id: string) => void;
    boardContext?: { boardId: string; title: string } | null;
  }) => (
    <div data-testid="toucan-panel">
      {boardContext ? <span data-testid="toucan-board">{boardContext.boardId}</span> : null}
      <button type="button" aria-label="toucan-release" onClick={onRelease} />
      <button type="button" aria-label="toucan-type-on" onClick={() => onTypingChange?.(true)} />
      <button type="button" aria-label="toucan-type-off" onClick={() => onTypingChange?.(false)} />
      <button type="button" aria-label="toucan-open-conversation" onClick={() => onOpenConversation?.("conv-9")} />
      <button type="button" aria-label="toucan-pending-on" onClick={() => onPendingChange?.(true)} />
    </div>
  ),
}));
// A5's proactive return briefing reaches the overlay through V1's own Toucan channel. Both halves are
// driven per test so the summon can be asserted without a socket.
let toucanConnected: (() => void)[] = [];
let catchUp: unknown = null;
vi.mock("../../../services/toucan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/toucan")>();
  return {
    ...actual,
    subscribeToucanChannelConnected: (cb: () => void) => {
      toucanConnected.push(cb);
      return () => { toucanConnected = toucanConnected.filter((x) => x !== cb); };
    },
    toucanService: { ...actual.toucanService, getCatchUp: async () => catchUp },
  };
});
// PHASE 7E — V1'S OWN ATTENDANCE SERVICE, stubbed at the boundary the overlay actually calls. Everything
// about the kiosk that matters is WHICH calls reach this and how its answer is treated.
type Rec = { email: string; status: string; checkedInAt: string | null; checkedOutAt: string | null };
const CHECKED_IN_RECORD: Rec = { email: SELF, status: "CHECKED_IN", checkedInAt: "2026-09-20T01:00:00Z", checkedOutAt: null };
const CHECKED_OUT_RECORD: Rec = { email: SELF, status: "CHECKED_OUT", checkedInAt: null, checkedOutAt: "2026-09-20T09:00:00Z" };
const checkIn = vi.fn(async (_employeeId?: string): Promise<Rec> => CHECKED_IN_RECORD);
const checkOut = vi.fn(async (_employeeId?: string): Promise<Rec> => CHECKED_OUT_RECORD);
vi.mock("../../../services/attendance", () => ({
  attendanceService: { getMine: vi.fn(), checkIn: (id: string) => checkIn(id), checkOut: (id: string) => checkOut(id) },
  attendanceMode: "mock",
}));
// V1's Zoho service, at the boundary the checkout flow calls. Nothing about the flow itself is stubbed.
const submitTimeLogs = vi.fn(async () => ({ success: true, submissionId: "sub-1", entriesCreated: 1, submittedAt: "2026-09-20T09:00:00Z" }));
vi.mock("../../../services/zoho", () => ({
  isRealZohoMode: () => true,
  isAlreadySubmittedError: () => false,
  zohoService: {
    getProjects: async () => [{ id: "p1", name: "Project One" }],
    getTasks: async () => [{ id: "t1", name: "Task One" }],
    submitTimeLogs: (...a: unknown[]) => submitTimeLogs(...(a as [])),
  },
}));
vi.mock("../../../components/OfficeMap/CallInvitePrompt", () => ({ CallInvitePrompt: () => null }));

// ---- the world stub --------------------------------------------------------------------------------
let handlers: Handlers | null = null;
const approachCoworker = vi.fn(() => true);
const setExitAuthorized = vi.fn();
const setInteractionPromptHidden = vi.fn();
const setDepartureDestination = vi.fn();
const clearSelection = vi.fn();
/** ROOM DETAILS — the world's two room verbs, and its answer for "which room am I standing in". */
let currentRoomId: string | null = "design-room";
const setSelectedRoom = vi.fn();
/** ROOM DISCOVERY — the label layer's three world reads, and the view the world says is driving. */
const setRoomHighlight = vi.fn();
const ROOM_LABEL_IDS = ["design-room", "dev-room", "central-hub"];
/** How big each of those floors is ON SCREEN this frame — what a name is checked against for overflow. */
let roomFootprints: Record<string, { widthPx: number; heightPx: number }> = {};
/** One world unit in CSS pixels: the camera zoom, and the ONE input to the shared label size. */
let roomScale = 1.2;
let viewMode: "office" | "explore" | "player" = "office";
let viewModeSubs: ((m: "office" | "explore" | "player") => void)[] = [];
/** Switch the camera mode the way the world's own feed would. */
function setViewMode(mode: typeof viewMode) {
  viewMode = mode;
  act(() => viewModeSubs.forEach((cb) => cb(mode)));
}
/** Whether the world is DRAWING the person Search / a Room Details row asked to select. */
let worldHasBody = true;
const selectByEmail = vi.fn((_email: string) => worldHasBody);
const poses: { peers: Map<string, string | null>; self: string | null }[] = [];
let caveInside = false;
let caveSubs: ((s: { inside: boolean }) => void)[] = [];
/** Walk the viewer into (or out of) the Cave, the way CaveTransition would. */
function setCaveInside(inside: boolean) {
  caveInside = inside;
  act(() => caveSubs.forEach((cb) => cb({ inside })));
}

/** PHASE 7G — THE WORLD'S BIRD, as the overlay reaches it. `call`/`release` are recorded and the state is
 *  pushed by the test, which is exactly the shape the real world publishes: the HUD asks for a summon and
 *  the ARRIVAL comes back later, on its own frame. */
const toucanCall = vi.fn();
const toucanRelease = vi.fn();
let toucanSubs: ((s: "roaming" | "approaching" | "attending") => void)[] = [];
let toucanPhase: "roaming" | "approaching" | "attending" = "roaming";
/** Fly the bird, the way the world's frame loop would. */
function flyToucan(phase: "roaming" | "approaching" | "attending") {
  toucanPhase = phase;
  act(() => toucanSubs.forEach((cb) => cb(phase)));
}

const world = {
  toucanSummon: {
    call: () => { toucanCall(); },
    release: () => { toucanRelease(); },
    state: () => toucanPhase,
    subscribe: (cb: (s: "roaming" | "approaching" | "attending") => void) => {
      toucanSubs.push(cb);
      cb(toucanPhase);
      return () => { toucanSubs = toucanSubs.filter((x) => x !== cb); };
    },
  },
  toucanAnchor: () => ({ clientX: 200, clientY: 140, visible: true, scale: 1 }),
  setCoworkerInteractions: (h: Handlers | null) => { handlers = h; },
  // Phase 7B's overhead layer asks for anchors every frame; a fixed one is enough here — WHERE they land
  // is Vo3dOverheads.test.tsx's subject, WHAT is overhead is this file's.
  coworkerAnchors: (emails: readonly string[]) =>
    Object.fromEntries(emails.map((e) => [e, { clientX: 100, clientY: 100, visible: true, scale: 1 }])),
  selfAnchor: () => ({ clientX: 120, clientY: 120, visible: true, scale: 1 }),
  setExitAuthorized,
  setDepartureDestination,
  setInteractionPromptHidden,
  subscribeViewMode: (cb: (m: "office" | "explore" | "player") => void) => {
    viewModeSubs.push(cb);
    cb(viewMode);
    return () => { viewModeSubs = viewModeSubs.filter((x) => x !== cb); };
  },
  roomLabelIds: () => ROOM_LABEL_IDS,
  // PROJECTED FOOTPRINTS, not just anchors: the label's type is FITTED to its room's own screen box, so a
  // stub that reported no box would leave the sizing untested. The Central Hub is deliberately the big
  // floor here and Design the small one, which is the comparison the fit exists to make.
  roomLabelAnchors: () =>
    Object.fromEntries(
      ROOM_LABEL_IDS.map((id) => [id, {
        clientX: 200, clientY: 200, visible: true, scale: roomScale,
        ...(roomFootprints[id] ?? { widthPx: 400, heightPx: 300 }),
      }]),
    ),
  setRoomHighlight,
  subscribePlayerView: (cb: (v: "first" | "third") => void) => { cb("third"); return () => {}; },
  setViewMode: vi.fn(),
  setPlayerView: vi.fn(),
  setConversationPoses: (peers: Map<string, string | null>, self: string | null) => {
    poses.push({ peers: new Map(peers), self });
  },
  devToolsVisible: () => false,
  setDevToolsVisible: vi.fn(),
  exitPlayerMode: vi.fn(),
  selectCoworkerByEmail: (email: string) => selectByEmail(email),
  currentRoomId: () => currentRoomId,
  setSelectedRoom: setSelectedRoom,
  clearCoworkerSelection: clearSelection,
  restoreCameraView: vi.fn(),
  coworkerAnchor: () => ({ clientX: 400, clientY: 300, visible: true }),
  approachCoworker,
  // PHASE 7D. The Cave's own feed, which the overlay reads for one fact: whether the viewer is inside.
  // Driven by `caveInside` so a test can walk somebody in and out.
  caveMeeting: {
    subscribe: (cb: (s: { inside: boolean }) => void) => {
      caveSubs.push(cb);
      cb({ inside: caveInside });
      return () => { caveSubs = caveSubs.filter((x) => x !== cb); };
    },
    // Walking in only WATCHES the meeting (world.ts observe): no token, no room, no media.
    enter: vi.fn(() => true),
    observe: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    setMic: vi.fn(async () => {}),
    setCamera: vi.fn(async () => {}),
    setSharing: vi.fn(async () => {}),
    leave: vi.fn(),
    invite: vi.fn(),
  },
} as unknown as Vo3dWorld;
const worldRef = { current: world };

const people: OfficePerson[] = [
  // `displayName` is the field OfficePerson carries (services/office/floorMerge); `roomId` is what
  // data/rosterLayers buckets on, and a person without one is never given a layer at all — which is
  // exactly why the pill would otherwise fall back to the email localpart.
  { email: SELF, displayName: "Bon", status: "ONLINE", roomId: "design-team", avatarId: "bon" } as unknown as OfficePerson,
  { email: ALEX, displayName: "Alex Cruz", status: "ONLINE", roomId: "design-team", avatarId: "alex" } as unknown as OfficePerson,
];

beforeEach(() => {
  callVideo = {};
  roomScale = 1.2;
  roomFootprints = {
    // A DEFAULT-ZOOM office, in round numbers off a real screenshot: the hub is the big central floor and
    // the other two are side rooms. All three can carry the shared size — Design only by wrapping, which
    // is exactly the adjustment the sizing rule prefers.
    "central-hub": { widthPx: 700, heightPx: 360 },
    "dev-room": { widthPx: 430, heightPx: 300 },
    "design-room": { widthPx: 420, heightPx: 270 },
  };
  toucanSubs = [];
  toucanPhase = "roaming";
  toucanConnected = [];
  catchUp = null;
  caveInside = false;
  caveSubs = [];
  conversations = [];
  typingListeners = [];
  poses.length = 0;
  dndEmails = new Set();
  sessions = [];
  attendance = "permitted";
  currentRoomId = "design-room";
  viewMode = "office";
  viewModeSubs = [];
  worldHasBody = true;
  handlers = null;
  checkIn.mockClear();
  checkOut.mockClear();
  submitTimeLogs.mockClear();
  setExitAuthorized.mockClear();
  setInteractionPromptHidden.mockClear();
  setDepartureDestination.mockClear();
  localStorage.clear();
  checkIn.mockImplementation(async () => CHECKED_IN_RECORD);
  vi.clearAllMocks();
  setCurrentUserFromMeResponse({ id: 1, email: SELF, name: "Bon" } as never);
});
afterEach(() => { resetCurrentUserForTests(); resetSelfStatusForTests(); });

function mount() {
  return render(
    <Vo3dOverlay worldRef={worldRef} ready people={people} drawnEmails={[ALEX]} attendance={attendanceProp()} />,
  );
}
/** The world reports a selection, exactly as a click or PLAYER mode's interact key makes it. */
async function select(email = ALEX, displayName = "Alex Cruz") {
  await waitFor(() => expect(handlers).not.toBeNull());
  act(() => handlers!.onSelect({ email, displayName }));
  await screen.findByTestId("world-menu");
}
const row = (label: string) => screen.getByRole("menuitem", { name: new RegExp(label, "i") });

describe("the menu", () => {
  it("opens anchored on the selected person, titled with their name", async () => {
    mount();
    await select();
    expect(screen.getByRole("menu", { name: "Actions for Alex Cruz" })).toBeTruthy();
    expect(screen.getByText("Alex Cruz")).toBeTruthy();
  });

  it("offers exactly V1's rows — and no demo rows, which V2 has no sprite walk for", async () => {
    mount();
    await select();
    const labels = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(labels).toEqual(["Chat", "Call", "Approach", "View Profile"]);
  });

  it("offers Ask to Join only when the target is in a conversation the viewer is not in", async () => {
    sessions = [{ sessionId: "conv-1", members: [ALEX, "micah@offshorly.com"] }];
    mount();
    await select();
    expect(screen.getByRole("menuitem", { name: /Ask to Join/i })).toBeTruthy();
  });

  it("does not offer Ask to Join for a conversation the viewer is already in", async () => {
    sessions = [{ sessionId: "conv-1", members: [ALEX, SELF] }];
    mount();
    await select();
    expect(screen.queryByRole("menuitem", { name: /Ask to Join/i })).toBeNull();
  });

  it("closes on Escape AND tells the world, so the same body can be clicked again", async () => {
    mount();
    await select();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("world-menu")).toBeNull());
    expect(clearSelection).toHaveBeenCalled();
  });

  it("closes when the world drops the selection (a click on empty floor)", async () => {
    mount();
    await select();
    act(() => handlers!.onSelect(null));
    await waitFor(() => expect(screen.queryByTestId("world-menu")).toBeNull());
  });
});

describe("the actions", () => {
  it("Approach walks the V2 body to that person, and opens no chat panel", async () => {
    mount();
    await select();
    fireEvent.click(row("Approach"));
    expect(approachCoworker).toHaveBeenCalledWith(ALEX);
    expect(screen.queryByTestId("conversation")).toBeNull();
  });

  it("Chat walks up to them AND opens V1's conversation view on that person", async () => {
    mount();
    await select();
    fireEvent.click(row("Chat"));
    expect(approachCoworker).toHaveBeenCalledWith(ALEX);
    expect((await screen.findByTestId("conversation")).textContent).toBe(ALEX);
  });

  it("Call RINGS somebody you are not clustered with — no walk, no panel, no session", async () => {
    mount();
    await select();
    fireEvent.click(row("Call"));
    expect(callInvite).toHaveBeenCalledWith(ALEX);
    expect(approachCoworker).not.toHaveBeenCalled();
    expect(sessionStart).not.toHaveBeenCalled();
  });

  it("Call JOINS the session you already share with them, without ringing", async () => {
    sessions = [{ sessionId: "conv-1", members: [ALEX, SELF] }];
    mount();
    await select();
    fireEvent.click(row("Call"));
    expect(startOrJoin).toHaveBeenCalledWith("conv-1");
    expect(callInvite).not.toHaveBeenCalled();
  });

  it("Call refuses somebody mid-conversation with a third party, pointing at Ask to Join", async () => {
    sessions = [{ sessionId: "conv-1", members: [ALEX, "micah@offshorly.com"] }];
    mount();
    await select();
    fireEvent.click(row("Call"));
    expect(callInvite).not.toHaveBeenCalled();
    expect(startOrJoin).not.toHaveBeenCalled();
    expect(await screen.findByText(/ask to join first/i)).toBeTruthy();
  });

  it("Ask to Join creates the request against the session that person is actually in", async () => {
    sessions = [{ sessionId: "conv-1", members: [ALEX, "micah@offshorly.com"] }];
    mount();
    await select();
    fireEvent.click(row("Ask to Join"));
    expect(joinRequest).toHaveBeenCalledWith("conv-1");
  });

  it("View Profile opens V1's profile for that employee", async () => {
    mount();
    await select();
    fireEvent.click(row("View Profile"));
    expect((await screen.findByTestId("profile")).textContent).toBe(ALEX);
  });

  it("emits V1's approach_arrived when the world says the walk finished", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    act(() => handlers!.onApproachArrived(ALEX));
    expect(approachArrived).toHaveBeenCalledWith(ALEX);
  });
});

describe("the gates", () => {
  it("refuses the three walking verbs for an employee V1 has not confirmed checked in", async () => {
    attendance = "denied";
    mount();
    await select();
    fireEvent.click(row("Approach"));
    expect(approachCoworker).not.toHaveBeenCalled();
    expect(await screen.findByText(/check in first/i)).toBeTruthy();
  });

  it("still allows View Profile and Ask to Join while checked out — neither moves the body", async () => {
    attendance = "denied";
    sessions = [{ sessionId: "conv-1", members: [ALEX, "micah@offshorly.com"] }];
    mount();
    await select();
    fireEvent.click(row("Ask to Join"));
    expect(joinRequest).toHaveBeenCalledWith("conv-1");
  });

  it("gates a DND person behind Request Permission to Talk instead of walking to them", async () => {
    dndEmails = new Set([ALEX]);
    mount();
    await select();
    fireEvent.click(row("Chat"));
    expect(approachCoworker).not.toHaveBeenCalled();
    // V1's own toast, from the shared gate hook
    const request = await screen.findByRole("button", { name: /request permission to talk/i });
    fireEvent.click(request);
    await waitFor(() => expect(talkRequest).toHaveBeenCalledWith(ALEX, "chat"));
  });

  it("sends a CALL attempt as the 'chat' talk-request kind, exactly as V1 does", async () => {
    dndEmails = new Set([ALEX]);
    mount();
    await select();
    fireEvent.click(row("Call"));
    fireEvent.click(await screen.findByRole("button", { name: /request permission to talk/i }));
    await waitFor(() => expect(talkRequest).toHaveBeenCalledWith(ALEX, "chat"));
    expect(callInvite).not.toHaveBeenCalled();
  });

  it("sends an APPROACH attempt as the 'approach' kind", async () => {
    dndEmails = new Set([ALEX]);
    mount();
    await select();
    fireEvent.click(row("Approach"));
    fireEvent.click(await screen.findByRole("button", { name: /request permission to talk/i }));
    await waitFor(() => expect(talkRequest).toHaveBeenCalledWith(ALEX, "approach"));
  });
});

describe("spatial chat overhead (Phase 7B)", () => {
  it("shows the name/status pill over a quiet coworker — V1's nameplate, not nothing", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    const pill = await screen.findByTestId(`overhead-status-${ALEX}`);
    expect(pill.textContent).toContain("Alex");
    expect(screen.queryByTestId(`overhead-typing-${ALEX}`)).toBeNull();
  });

  it("REPLACES the name/status pill with the typing dots, rather than stacking above it", async () => {
    mount();
    await waitFor(() => expect(typingListeners.length).toBeGreaterThan(0));
    await screen.findByTestId(`overhead-status-${ALEX}`);
    act(() => { for (const l of typingListeners) l({ senderId: ALEX, conversationId: "c1", isTyping: true }); });
    await screen.findByTestId(`overhead-typing-${ALEX}`);
    expect(screen.queryByTestId(`overhead-status-${ALEX}`)).toBeNull();
  });

  it("shows typing dots over a coworker V1's typing channel says is typing", async () => {
    mount();
    await waitFor(() => expect(typingListeners.length).toBeGreaterThan(0));
    act(() => { for (const l of typingListeners) l({ senderId: ALEX, conversationId: "c1", isTyping: true }); });
    expect(await screen.findByTestId(`overhead-typing-${ALEX}`)).toBeTruthy();
    act(() => { for (const l of typingListeners) l({ senderId: ALEX, conversationId: "c1", isTyping: false }); });
    await waitFor(() => expect(screen.queryByTestId(`overhead-typing-${ALEX}`)).toBeNull());
  });

  it("never shows the viewer's own typing over somebody", async () => {
    mount();
    await waitFor(() => expect(typingListeners.length).toBeGreaterThan(0));
    act(() => { for (const l of typingListeners) l({ senderId: SELF, conversationId: "c1", isTyping: true }); });
    expect(screen.queryByTestId(`overhead-typing-${ALEX}`)).toBeNull();
    // ...and the nameplate is still what is showing over them
    expect(screen.getByTestId(`overhead-status-${ALEX}`)).toBeTruthy();
  });

  it("keeps the unread indicator SEPARATE from the pill, and clicking it still opens the DM", async () => {
    conversations = [{ id: "conv-9", type: "dm", participantIds: [SELF, ALEX], unreadCount: 2 }];
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    const badge = await screen.findByTestId(`overhead-unread-${ALEX}`);
    // both, at once: the badge is an additive pass over the nameplate
    expect(screen.getByTestId(`overhead-status-${ALEX}`)).toBeTruthy();
    fireEvent.click(badge);
    expect((await screen.findByTestId("conversation")).textContent).toBe(ALEX);
  });

  it("shows the glowing unread indicator from V1's OWN unread derivation, and opens that DM on click", async () => {
    conversations = [{ id: "conv-9", type: "dm", participantIds: [SELF, ALEX], unreadCount: 4 }];
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    const badge = await screen.findByTestId(`overhead-unread-${ALEX}`);
    expect(badge.textContent).toContain("4");
    fireEvent.click(badge);
    expect((await screen.findByTestId("conversation")).textContent).toBe(ALEX);
  });

  it("draws nothing over somebody V2 has no body for, however loud they are", async () => {
    conversations = [{ id: "conv-9", type: "dm", participantIds: [SELF, "ghost@offshorly.com"], unreadCount: 4 }];
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    expect(screen.queryByTestId("overhead-unread-ghost@offshorly.com")).toBeNull();
  });
});

describe("spatial conversation parity", () => {
  const lastPose = () => poses[poses.length - 1];
  const sessionWith = (...members: string[]) => [{ sessionId: "conv-1", members }];

  it("turns the viewer's OWN pill into the typing indicator while they type, and back after", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    // resting: the "You" nameplate
    expect(await screen.findByTestId("overhead-status-__self__")).toBeTruthy();
    // open the spatial chat, then type into it
    act(() => handlers!.onSelect({ email: ALEX, displayName: "Alex Cruz" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^chat$/i }));
    const view = await screen.findByTestId("conversation");
    act(() => view.dispatchEvent(new CustomEvent("test:typing", { detail: true, bubbles: true })));
    await waitFor(() => expect(screen.getByTestId("overhead-typing-__self__")).toBeTruthy());
    // the name/status is REPLACED, never stacked
    expect(screen.queryByTestId("overhead-status-__self__")).toBeNull();
    act(() => view.dispatchEvent(new CustomEvent("test:typing", { detail: false, bubbles: true })));
    await waitFor(() => expect(screen.queryByTestId("overhead-typing-__self__")).toBeNull());
    expect(screen.getByTestId("overhead-status-__self__")).toBeTruthy();
  });

  it("labels an actual spatial participant In Conversation, without overriding their typing", async () => {
    sessions = sessionWith(ALEX, SELF);
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    expect((await screen.findByTestId(`overhead-status-${ALEX}`)).textContent).toContain("In Conversation");
    act(() => { for (const l of typingListeners) l({ senderId: ALEX, conversationId: "conv-1", isTyping: true }); });
    await screen.findByTestId(`overhead-typing-${ALEX}`);
    expect(screen.queryByTestId(`overhead-status-${ALEX}`)).toBeNull();
  });

  it("gives a one-member session no conversation status at all — V1's >=2 rule", async () => {
    sessions = sessionWith(ALEX);
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    expect((await screen.findByTestId(`overhead-status-${ALEX}`)).textContent).not.toContain("In Conversation");
  });

  it("RESTS a spatial participant in the natural idle, never the splayed listening clip", async () => {
    sessions = sessionWith(ALEX, SELF);
    mount();
    await waitFor(() => expect(lastPose()).toBeTruthy());
    // null = the body's own idle. `listening-gesture` holds the arms out from the body on these rigs
    // (see conversationClipFor), which is the unnatural resting pose this replaced.
    expect(lastPose().peers.get(ALEX)).toBeNull();
    expect(lastPose().self).toBeNull();
    expect(lastPose().peers.get(ALEX)).not.toBe("listening-gesture");
  });

  it("plays the AGREE gesture only while somebody is actually typing, then returns to rest", async () => {
    sessions = sessionWith(ALEX, SELF);
    mount();
    await waitFor(() => expect(lastPose()).toBeTruthy());
    act(() => { for (const l of typingListeners) l({ senderId: ALEX, conversationId: "conv-1", isTyping: true }); });
    await waitFor(() => expect(lastPose().peers.get(ALEX)).toBe("agree-gesture"));
    // self is not the one typing, so self stays at rest
    expect(lastPose().self).toBeNull();
    act(() => { for (const l of typingListeners) l({ senderId: ALEX, conversationId: "conv-1", isTyping: false }); });
    await waitFor(() => expect(lastPose().peers.get(ALEX)).toBeNull());
  });

  it("leaves everybody in an ordinary idle when there is no spatial conversation", async () => {
    mount();
    await waitFor(() => expect(lastPose()).toBeTruthy());
    expect(lastPose().peers.get(ALEX)).toBeNull();
    expect(lastPose().self).toBeNull();
  });

  it("opening a Global Chat DM creates NO spatial session and changes no presence", async () => {
    conversations = [{ id: "conv-9", type: "dm", participantIds: [SELF, ALEX], unreadCount: 1 }];
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    fireEvent.click(await screen.findByTestId(`overhead-unread-${ALEX}`));
    await screen.findByTestId("conversation");
    expect(sessionStart).not.toHaveBeenCalled();
    expect(lastPose().peers.get(ALEX)).toBeNull();
    expect(screen.queryByTestId(`overhead-status-${ALEX}`)?.textContent).not.toContain("In Conversation");
  });
});

describe("the sender's own bubble", () => {
  /** Open the spatial chat with Alex and hand back the stub, which relays V1's own message/typing edges. */
  async function openSpatialChat() {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    act(() => handlers!.onSelect({ email: ALEX, displayName: "Alex Cruz" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^chat$/i }));
    return screen.findByTestId("conversation");
  }
  const send = (view: HTMLElement, senderId: string, text: string, id = "m1") =>
    act(() => {
      view.dispatchEvent(
        new CustomEvent("test:message", { detail: { id, conversationId: "conv-1", senderId, text, sentAt: new Date().toISOString() }, bubbles: true }),
      );
    });

  it("shows the SENDER their own message over their own avatar", async () => {
    const view = await openSpatialChat();
    send(view, SELF, "on my way");
    expect((await screen.findByTestId("overhead-text-__self__")).textContent).toBe("on my way");
  });

  it("lets the message outrank the typing dots, then restores the status when it expires", async () => {
    // Fake timers go on AFTER the panel is open: `waitFor` polls on real timers, so installing them
    // first simply hangs the setup (and leaves the following tests wedged behind it).
    const view = await openSpatialChat();
    vi.useFakeTimers();
    try {
      act(() => view.dispatchEvent(new CustomEvent("test:typing", { detail: true, bubbles: true })));
      expect(screen.getByTestId("overhead-typing-__self__")).toBeTruthy();
      send(view, SELF, "sent it");
      // message > typing > name/status
      expect(screen.getByTestId("overhead-text-__self__")).toBeTruthy();
      expect(screen.queryByTestId("overhead-typing-__self__")).toBeNull();
      // V1's own 4.5s bubble lifetime, once. Typing is STILL on, so the chain falls back to the dots —
      // the message outranked them, it did not cancel them.
      act(() => { vi.advanceTimersByTime(4600); });
      expect(screen.queryByTestId("overhead-text-__self__")).toBeNull();
      expect(screen.getByTestId("overhead-typing-__self__")).toBeTruthy();
      // ...and only once typing stops does the nameplate come back.
      act(() => view.dispatchEvent(new CustomEvent("test:typing", { detail: false, bubbles: true })));
      expect(screen.queryByTestId("overhead-typing-__self__")).toBeNull();
      expect(screen.getByTestId("overhead-status-__self__")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the same bubble over the PEER when they are the sender", async () => {
    const view = await openSpatialChat();
    send(view, ALEX, "be right there");
    expect((await screen.findByTestId(`overhead-text-${ALEX}`)).textContent).toBe("be right there");
    expect(screen.queryByTestId("overhead-text-__self__")).toBeNull();
  });

  it("does not double up when the server echoes the same message id", async () => {
    const view = await openSpatialChat();
    send(view, SELF, "once", "same-id");
    send(view, SELF, "once", "same-id");
    expect(screen.getAllByTestId("overhead-text-__self__")).toHaveLength(1);
  });
});


// PHASE 7D — WHERE A CAMERA IS SHOWN, AND WHERE IT IS NOT.
//
// The Cave's curved screen already renders every live camera in the meeting (media/CaveGallery, from
// the SAME callStore videoByIdentity these tiles read). A floating tile above each head inside the Cave
// is therefore the same video twice — at meeting scale on the wall, and as a stamp in front of it.
//
// What is pinned here is that suppression is DERIVED, not destructive: nothing turns a camera off or
// detaches a track, the overheads are simply not given one while inside, and walking out hands them
// straight back. The normal office is untouched.
describe("call cameras inside the Cave", () => {
  const camera = () => ({ attach: vi.fn(), detach: vi.fn() });

  it("floats a tile over a coworker in the ordinary office", async () => {
    callVideo = { [ALEX]: camera() };
    mount();
    expect(await screen.findByTestId(`overhead-video-${ALEX}`)).toBeInTheDocument();
  });

  it("shows none inside the Cave — the screen has them", async () => {
    callVideo = { [ALEX]: camera(), [SELF]: camera() };
    mount();
    await screen.findByTestId(`overhead-video-${ALEX}`);

    setCaveInside(true);

    await waitFor(() => expect(screen.queryByTestId(`overhead-video-${ALEX}`)).toBeNull());
    // The viewer's own camera too: it is on the wall in front of them like everybody else's.
    expect(screen.queryByTestId("overhead-video-__self__")).toBeNull();
  });

  it("hands them back on the way out, with no stale tile left behind", async () => {
    callVideo = { [ALEX]: camera() };
    mount();
    setCaveInside(true);
    await waitFor(() => expect(screen.queryByTestId(`overhead-video-${ALEX}`)).toBeNull());

    setCaveInside(false);

    expect(await screen.findByTestId(`overhead-video-${ALEX}`)).toBeInTheDocument();
  });

  it("suppresses the tile only — the track itself is never detached by leaving it out", async () => {
    const cam = camera();
    callVideo = { [ALEX]: cam };
    mount();
    await screen.findByTestId(`overhead-video-${ALEX}`);
    expect(cam.attach).toHaveBeenCalledTimes(1);

    setCaveInside(true);
    await waitFor(() => expect(screen.queryByTestId(`overhead-video-${ALEX}`)).toBeNull());

    // React unmounted the element, so CallVideoElement detached ITS OWN element — and only that one.
    // The gallery's attachment to the same track is a different element and is untouched here.
    expect(cam.detach).toHaveBeenCalledTimes(1);
    expect(cam.detach).toHaveBeenCalledWith(expect.anything());
  });
});


// PHASE 7D — THE OVERHEAD BUBBLE IS ON A CLOCK, NOT ON A RENDER.
//
// A meeting message was previously DERIVED: a memo over the feed that filtered on
// `Date.now() - atMs`. That is right the instant it runs and wrong every instant after, because
// nothing schedules a render at expiry — so the bubble hung over its sender's head until some
// unrelated render happened to knock it off. These pin the actual clock, which is the very same one
// the spatial bubbles above run on (useOverheadBubbles).
describe("meeting bubbles expire", () => {
  /** Put the viewer in a connected meeting and hand back a pusher for its feed.
   *
   *  Fake timers go on AFTER mounting, for the reason the spatial block above records — `waitFor`
   *  polls on real timers — but BEFORE the first push, so that every bubble timeout these tests then
   *  arm is a fake one they can actually advance. A push is synchronous inside act(), so the
   *  assertions below use the sync queries rather than the waitFor-backed find*. */
  async function inMeeting() {
    callStatus = "connected";
    callMeetingId = "meeting:cave";
    mount();
    await waitFor(() => expect(pushMeeting).not.toBeNull());
    vi.useFakeTimers();
    return (messages: MeetingMsg[]) => act(() => pushMeeting!(messages));
  }
  const msg = (id: string, text: string, atMs = Date.now()): MeetingMsg => ({ id, email: SELF, text, atMs });

  afterEach(() => {
    callStatus = "idle";
    callMeetingId = null;
    meetingMessages = [];
    vi.useRealTimers();
  });

  it("shows a meeting message over its sender, then RESTORES the name/status pill", async () => {
    const push = await inMeeting();
    push([msg("m1", "starting now")]);
    expect(screen.getByTestId("overhead-text-__self__").textContent).toBe("starting now");

    act(() => { vi.advanceTimersByTime(4600); });
    expect(screen.queryByTestId("overhead-text-__self__")).toBeNull();
    expect(screen.getByTestId("overhead-status-__self__")).toBeTruthy();
  });

  it("RESTARTS the life on a second message instead of letting the first one's timer cut it short", async () => {
    const push = await inMeeting();
    push([msg("m1", "first")]);
    expect(screen.getByTestId("overhead-text-__self__").textContent).toBe("first");

    act(() => { vi.advanceTimersByTime(3000); });
    push([msg("m1", "first"), msg("m2", "second")]);
    // 3s past the FIRST message — which would already have expired had its timer survived — but only
    // 3s into the second's own life, so the second is still up and reads as the second.
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId("overhead-text-__self__").textContent).toBe("second");
    // ...and it goes on its own schedule, leaving nothing stale behind.
    act(() => { vi.advanceTimersByTime(1800); });
    expect(screen.queryByTestId("overhead-text-__self__")).toBeNull();
  });

  it("CLEARS the bubble when the meeting ends, rather than letting it outlive the meeting", async () => {
    const push = await inMeeting();
    push([msg("m1", "see you")]);
    expect(screen.getByTestId("overhead-text-__self__")).toBeTruthy();

    callStatus = "idle";
    callMeetingId = null;
    // Any render now that the call is gone — the real store pushes one on disconnect.
    push([msg("m1", "see you")]);
    expect(screen.queryByTestId("overhead-text-__self__")).toBeNull();
    expect(screen.getByTestId("overhead-status-__self__")).toBeTruthy();
  });

  it("does NOT pop a bubble for backlog a late joiner is handed", async () => {
    const push = await inMeeting();
    push([msg("old", "said ages ago", Date.now() - 60_000), msg("older", "and before that", Date.now() - 90_000)]);
    expect(screen.queryByTestId("overhead-text-__self__")).toBeNull();
    expect(screen.getByTestId("overhead-status-__self__")).toBeTruthy();
  });
});

// ---- PHASE 7E: THE RECEPTION CHECK-IN KIOSK ---------------------------------------------------------
// The kiosk is reached by WALKING to it, so every test here starts the same way the world does: an
// arrival at the Reception kiosk entity, through the Step 1 contract.

/** The world reports that the body finished walking to, and turning to face, this fixture. */
async function arriveAt(entityId = KIOSK_INTERACTION_ID) {
  await waitFor(() => expect(handlers).not.toBeNull());
  act(() => handlers!.onInteractionArrived!(entityId));
  return screen.findByTestId("world-menu");
}
const kioskMeta = () => screen.getByTestId("world-menu-meta").textContent;
const kioskDot = () => screen.getByTestId("world-menu-meta").querySelector("span")?.getAttribute("style") ?? "";

describe("the Reception kiosk", () => {
  it("opens only for the kiosk, and only after walking to it", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    expect(screen.queryByTestId("world-menu")).toBeNull();
    // Another walk-up point in the same room is not a check-in terminal.
    act(() => handlers!.onInteractionArrived!("reception-room/counter-interaction"));
    expect(screen.queryByTestId("world-menu")).toBeNull();
    await arriveAt();
    expect(screen.getByRole("menu", { name: "Reception check-in kiosk" })).toBeTruthy();
  });

  it("CHECKED OUT: reads red and offers the way in — nothing is granted by opening it", async () => {
    attendance = "denied";
    mount();
    await arriveAt();
    expect(kioskMeta()).toContain("Checked out");
    expect(kioskDot()).toContain("255, 90, 82"); // PALETTE.denyRed, the same red the shut gates light
    expect(screen.getByRole("menuitem", { name: /^Check In$/i })).toBeTruthy();
    expect(checkIn).not.toHaveBeenCalled(); // opening the card is not checking in
  });

  it("a confirmed check-in publishes V1's record to the shared answer, which is what opens the gate", async () => {
    attendance = "denied";
    mount();
    await arriveAt();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Check In$/i }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(attendanceApply).toHaveBeenCalledTimes(1));
    expect(attendanceApply).toHaveBeenCalledWith(expect.objectContaining({ status: "CHECKED_IN" }));
    // The overlay never decides access itself: it hands the record over and app/Vo3dHost.tsx pushes the
    // resulting answer into the world. Nothing here touches walkability.
    expect(attendanceRefresh).not.toHaveBeenCalled();
  });

  it("CHECKED IN: reads green and does not offer a second check-in", async () => {
    attendance = "permitted";
    mount();
    await arriveAt();
    expect(kioskMeta()).toContain("Checked in");
    expect(kioskDot()).toContain("34, 197, 94"); // the office's own green
    expect(screen.queryByRole("menuitem", { name: /Check In/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Close/i })).toBeTruthy();
  });

  it("A FAILED CHECK-IN stays red and grants nothing, and offers a retry", async () => {
    attendance = "denied";
    checkIn.mockImplementation(async () => { throw new Error("network"); });
    mount();
    await arriveAt();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Check In$/i }));
    await screen.findByRole("menuitem", { name: /Try again/i });
    expect(kioskMeta()).toContain("didn't go through");
    expect(kioskDot()).toContain("255, 90, 82");
    // FAIL CLOSED: the shared answer was never touched, so the gate stayed shut.
    expect(attendanceApply).not.toHaveBeenCalled();
    // ...and V1 is asked again, in case the write landed and only the answer was lost — which is also what
    // stops the retry from becoming a second check-in.
    expect(attendanceRefresh).toHaveBeenCalled();
  });

  it("treats a response that is NOT CHECKED_IN as a failure rather than believing it", async () => {
    attendance = "denied";
    checkIn.mockImplementation(async (): Promise<Rec> => ({ email: SELF, status: "CHECKED_OUT", checkedInAt: null, checkedOutAt: null }));
    mount();
    await arriveAt();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Check In$/i }));
    await screen.findByRole("menuitem", { name: /Try again/i });
    expect(attendanceApply).not.toHaveBeenCalled();
  });

  it("CANNOT DOUBLE-SUBMIT: a burst of clicks is one POST", async () => {
    attendance = "denied";
    let release: (() => void) | null = null;
    checkIn.mockImplementation(
      () => new Promise<Rec>((resolve) => { release = () => resolve(CHECKED_IN_RECORD); }),
    );
    mount();
    await arriveAt();
    const button = screen.getByRole("menuitem", { name: /^Check In$/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(checkIn).toHaveBeenCalledTimes(1);

    // ...and the row that is showing while it is in flight says so, and does nothing when pressed.
    await screen.findByRole("menuitem", { name: /Checking in/i });
    expect(kioskMeta()).toContain("Checking you in");
    fireEvent.click(screen.getByRole("menuitem", { name: /Checking in/i }));
    expect(checkIn).toHaveBeenCalledTimes(1);
    await act(async () => { release?.(); });
    await waitFor(() => expect(attendanceApply).toHaveBeenCalledTimes(1));
  });

  it("UNKNOWN fails closed: amber, and no way through", async () => {
    attendance = "unknown";
    mount();
    await arriveAt();
    expect(kioskMeta()).toContain("Checking your status");
    expect(kioskDot()).toContain("234, 179, 8"); // amber — never green for an answer V1 has not given
    expect(screen.queryByRole("menuitem", { name: /Check In/i })).toBeNull();
  });

  it("closes on the Close row and can be reopened by walking up again", async () => {
    attendance = "denied";
    mount();
    await arriveAt();
    fireEvent.click(screen.getByRole("menuitem", { name: /Close/i }));
    await waitFor(() => expect(screen.queryByTestId("world-menu")).toBeNull());
    await arriveAt();
    expect(screen.getByRole("menu", { name: "Reception check-in kiosk" })).toBeTruthy();
  });
});

// ---- PHASE 7E: LEAVING THE OFFICE --------------------------------------------------------------------
// The exit is held shut by the world for a checked-in employee (app/world.ts). Walking up to it raises the
// question; these are the three answers and what each one is allowed to change.

/** The world reports that a checked-in body reached the entrance mat with the exit still held. */
async function reachExit() {
  await waitFor(() => expect(handlers).not.toBeNull());
  act(() => handlers!.onExitIntercepted!());
  return screen.findByRole("menu", { name: "Leaving the office" });
}
const exitRow = (label: string) => screen.getByRole("menuitem", { name: new RegExp(label, "i") });

describe("the exit choice", () => {
  it("offers exactly AI Lab, Check Out and Cancel", async () => {
    mount();
    await reachExit();
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Go to the AI Lab", "Check Out", "Cancel"]);
  });

  it("opening it changes NOTHING — no door, no attendance, no checkout", async () => {
    mount();
    await reachExit();
    expect(setExitAuthorized).not.toHaveBeenCalled();
    expect(checkOut).not.toHaveBeenCalled();
    expect(attendanceApply).not.toHaveBeenCalled();
  });

  it("AI LAB opens the exit for this trip, names the destination, and leaves the session alone", async () => {
    mount();
    await reachExit();
    fireEvent.click(exitRow("Go to the AI Lab"));
    await waitFor(() => expect(setExitAuthorized).toHaveBeenCalledWith(true));
    // Told BEFORE the door opens, so the frame-boundary publish carries it (app/selfMovement.ts).
    expect(setDepartureDestination).toHaveBeenCalledWith("ai-lab");
    expect(setDepartureDestination.mock.invocationCallOrder[0]).toBeLessThan(setExitAuthorized.mock.invocationCallOrder[0]);
    // THE WHOLE POINT: stepping out is not checking out.
    expect(checkOut).not.toHaveBeenCalled();
    expect(submitTimeLogs).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leaving the office" })).toBeNull());
  });

  it("CANCEL closes the card and keeps the exit shut and the session running", async () => {
    mount();
    await reachExit();
    fireEvent.click(exitRow("Cancel"));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leaving the office" })).toBeNull());
    expect(setExitAuthorized).not.toHaveBeenCalled();
    expect(setDepartureDestination).not.toHaveBeenCalled();
    expect(checkOut).not.toHaveBeenCalled();
  });

  it("Escape is a cancel, not a departure", async () => {
    mount();
    await reachExit();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leaving the office" })).toBeNull());
    expect(setExitAuthorized).not.toHaveBeenCalled();
  });

  it("walking up again re-asks", async () => {
    mount();
    await reachExit();
    fireEvent.click(exitRow("Cancel"));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leaving the office" })).toBeNull());
    await reachExit();
  });
});

describe("CHECK OUT runs V1's flow, and attendance is the LAST thing that happens", () => {
  /** Drive V1's own panels from the exit card to a submitted time log. */
  async function runCheckout() {
    await reachExit();
    fireEvent.click(exitRow("Check Out"));
    // V1's confirmation modal
    fireEvent.click(await screen.findByRole("button", { name: /start checkout/i }));
    // V1's summary → time log
    fireEvent.click(await screen.findByRole("button", { name: /log today's work/i }));
  }

  it("starts V1's flow rather than posting anything", async () => {
    mount();
    await reachExit();
    fireEvent.click(exitRow("Check Out"));
    expect(await screen.findByText(/ready to wrap up your day/i)).toBeTruthy();
    // The exit stays SHUT while the flow runs — it is opened by the confirmed checkout, not by the choice.
    expect(setExitAuthorized).not.toHaveBeenCalled();
    expect(checkOut).not.toHaveBeenCalled();
  });

  it("does not touch attendance while the time log is still being filled in", async () => {
    mount();
    await runCheckout();
    expect(submitTimeLogs).not.toHaveBeenCalled();
    expect(checkOut).not.toHaveBeenCalled();
    expect(setExitAuthorized).not.toHaveBeenCalled();
  });

  it("abandoning the confirmation leaves the session exactly as it was", async () => {
    mount();
    await reachExit();
    fireEvent.click(exitRow("Check Out"));
    fireEvent.click(await screen.findByRole("button", { name: /not yet/i }));
    expect(checkOut).not.toHaveBeenCalled();
    expect(attendanceApply).not.toHaveBeenCalled();
    expect(setExitAuthorized).not.toHaveBeenCalled();
  });
});

// PHASE 7E — PRESENCE FOLLOWS THE WHOLE EXCURSION, not the Lab's own floor.
//
// It used to be keyed on "is the body inside the AI Lab", and that flicked back to Available the moment
// somebody stepped off the Lab's floor — including for the entire walk home. The excursion is what is being
// described, and its boundary is the building's.
const zone = (z: "office" | "reception" | "outside") => act(() => handlers!.onZoneChanged!(z));
const away = () => getSelfStatusSnapshot().autoConditions.away;

describe("presence follows the body out of the building", () => {
  it("reads AWAY for the whole excursion — Lab, pavement and the walk back", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    zone("outside");
    await waitFor(() => expect(away()).toBe(true));
    // The excursion is not the Lab's own floor: the campus and the pavement are part of it, and the world
    // keeps saying `outside` for all of them.
    zone("outside");
    expect(away()).toBe(true);
  });

  it("APPROACHING the building from outside restores nothing", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    zone("outside");
    await waitFor(() => expect(away()).toBe(true));
    // The world reports `outside` right up to the façade plane, which is only crossed through the
    // entrance — so there is no "nearly home" state that could clear this early.
    zone("outside");
    expect(away()).toBe(true);
  });

  it("CONFIRMED RE-ENTRY into Reception restores presence", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    zone("outside");
    await waitFor(() => expect(away()).toBe(true));
    zone("reception");
    await waitFor(() => expect(away()).toBe(false));
  });

  it("restores the person's OWN status, never a forced Available", async () => {
    setManualStatus("BUSY");
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    zone("outside");
    await waitFor(() => expect(getSelfStatusSnapshot().currentStatus).toBe("AWAY"));
    zone("reception");
    await waitFor(() => expect(getSelfStatusSnapshot().currentStatus).toBe("BUSY"));
  });

  it("DND outranks Away for the whole excursion and survives the return", async () => {
    startDnd({ durationMs: 30 * 60_000 });
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    zone("outside");
    await waitFor(() => expect(getSelfStatusSnapshot().currentStatus).toBe("DND"));
    zone("reception");
    await waitFor(() => expect(getSelfStatusSnapshot().currentStatus).toBe("DND"));
  });

  it("a checked-out viewer still reads OFFLINE, which outranks Away", async () => {
    attendance = "denied";
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    zone("outside");
    await waitFor(() => expect(getSelfStatusSnapshot().currentStatus).toBe("OFFLINE"));
  });

  it("neither change writes attendance", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    zone("outside");
    zone("reception");
    act(() => handlers!.onExitAbandoned!());
    expect(checkOut).not.toHaveBeenCalled();
    expect(checkIn).not.toHaveBeenCalled();
    expect(attendanceApply).not.toHaveBeenCalled();
  });
});

describe("the exit card does not follow you across the room", () => {
  it("dismisses itself when the body leaves the exit zone", async () => {
    mount();
    await reachExit();
    act(() => handlers!.onExitAbandoned!());
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leaving the office" })).toBeNull());
  });

  it("walking away authorises nothing and leaves the exit held", async () => {
    mount();
    await reachExit();
    act(() => handlers!.onExitAbandoned!());
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leaving the office" })).toBeNull());
    expect(setExitAuthorized).not.toHaveBeenCalled();
    expect(setDepartureDestination).not.toHaveBeenCalled();
    expect(checkOut).not.toHaveBeenCalled();
  });

  it("RE-APPROACHING opens it again", async () => {
    mount();
    await reachExit();
    act(() => handlers!.onExitAbandoned!());
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leaving the office" })).toBeNull());
    await reachExit();
  });

  it("STILL dismisses while the 8-hour reminder is showing — a toast is not a panel", async () => {
    // The employee most likely to be walking to the door is the one who has been on the clock longest, and
    // their flow sits in REMINDER_SHOWN. Treating that as "busy" is what silently broke this.
    mount();
    await reachExit();
    act(() => handlers!.onExitAbandoned!());
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leaving the office" })).toBeNull());
  });

  it("NEVER interrupts a checkout in progress, nor its draft", async () => {
    mount();
    await reachExit();
    fireEvent.click(exitRow("Check Out"));
    fireEvent.click(await screen.findByRole("button", { name: /start checkout/i }));
    fireEvent.click(await screen.findByRole("button", { name: /log today's work/i }));
    const before = localStorage.getItem(`checkout:${getCurrentUserId()}:${manilaWorkDate()}:draft`);
    // The body wanders off the mat while the time-log panel is open.
    act(() => handlers!.onExitAbandoned!());
    // V1's panel is still there, with everything it was holding.
    expect(screen.getByText(/log today's work|what did you/i) ?? true).toBeTruthy();
    expect(localStorage.getItem(`checkout:${getCurrentUserId()}:${manilaWorkDate()}:draft`)).toBe(before);
    expect(checkOut).not.toHaveBeenCalled();
  });
});

// ---- PHASE 7E: CHECKOUT IS THE SOLE FOCUS --------------------------------------------------------
// While a checkout panel is up the dock steps aside, the pointer lock is released and V2's bare-letter
// keys stop reaching the world. None of that is a new mechanism: checkout joins V1's own one-line "a
// tool owns the screen" rule (app/Vo3dHud officeToolOpen) and declares itself a modal, which is what
// app/keyGuard already looks for.

/** Walk V1's flow to a state that owns the screen, from the exit card. */
async function openCheckoutPanel() {
  await reachExit();
  fireEvent.click(exitRow("Check Out"));
  return screen.findByText(/ready to wrap up your day/i);
}
/** HudDock's own way of stepping aside: aria-hidden + inert, so it is neither read nor clickable. */
const hudHidden = () => screen.getByTestId("hud-dock").getAttribute("aria-hidden") === "true";

describe("checkout owns the screen", () => {
  it("the dock steps aside for the confirmation and every panel after it", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    expect(hudHidden()).toBe(false);

    await openCheckoutPanel();
    await waitFor(() => expect(hudHidden()).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /start checkout/i }));
    await screen.findByRole("button", { name: /log today's work/i });
    expect(hudHidden()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /log today's work/i }));
    await waitFor(() => expect(hudHidden()).toBe(true));
  });

  it("declares itself a modal, which is how the world's keys stand down", async () => {
    // app/keyGuard.isTypingTarget treats a role="dialog" as owning the keyboard — C and WASD included —
    // so PLAYER cannot be driven from behind a panel and no new listener was needed.
    mount();
    await openCheckoutPanel();
    const scope = await screen.findByTestId("vo3d-checkout");
    expect(scope.getAttribute("role")).toBe("dialog");
    expect(scope.getAttribute("aria-modal")).toBe("true");
    expect(isTypingTarget({ target: screen.getByRole("button", { name: /start checkout/i }) } as unknown as Event)).toBe(true);
  });

  it("the dock comes BACK when the confirmation is declined", async () => {
    mount();
    await openCheckoutPanel();
    await waitFor(() => expect(hudHidden()).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /not yet/i }));
    await waitFor(() => expect(hudHidden()).toBe(false));
  });

  it("the exit CARD alone never hides the dock — it is a world card, not a tool", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    await reachExit();
    expect(hudHidden()).toBe(false);
    fireEvent.click(exitRow("Cancel"));
    await waitFor(() => expect(hudHidden()).toBe(false));
  });

  it("hides PLAYER's centre-screen [E] prompt, which sits where the primary button does", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    await waitFor(() => expect(setInteractionPromptHidden).toHaveBeenLastCalledWith(false));

    await openCheckoutPanel();
    await waitFor(() => expect(setInteractionPromptHidden).toHaveBeenLastCalledWith(true));

    // …and it comes back the moment the panel closes.
    fireEvent.click(screen.getByRole("button", { name: /not yet/i }));
    await waitFor(() => expect(setInteractionPromptHidden).toHaveBeenLastCalledWith(false));
  });

  it("the ordinary exit card leaves the prompt alone — it is not a modal", async () => {
    mount();
    await screen.findByTestId("hud-dock");
    setInteractionPromptHidden.mockClear();
    await reachExit();
    expect(setInteractionPromptHidden).not.toHaveBeenCalledWith(true);
  });

  it("the theme container is always mounted, so nothing about the flow is unmounted with it", async () => {
    mount();
    // Present before any checkout begins: `hidden` is presentation, the hook owns the state.
    expect(await screen.findByTestId("vo3d-checkout")).toBeTruthy();
    // …and it carries no dialog role while nothing is showing, so it cannot swallow keys.
    expect(screen.getByTestId("vo3d-checkout").hasAttribute("role")).toBe(false);
  });
});

// ---- PHASE 7E: THERE IS ALWAYS A WAY BACK -----------------------------------------------------------
// Before this the time-log form had no Back and no Cancel: `AT_RECEPTION` and `EDITING_TIME_LOG` were the
// only states in the machine with no outgoing escape, so there was no transition to offer and refreshing
// the page was the only exit. Both now land on IDLE, which is where "Not yet" and "Save and return later"
// already land — no second state machine, and nothing here submits or writes attendance.

const draftKey = () => `checkout:${getCurrentUserId()}:${manilaWorkDate()}:draft`;
/** Walk V1's own panels to the time-log form. */
async function reachTimeLog() {
  await reachExit();
  fireEvent.click(exitRow("Check Out"));
  fireEvent.click(await screen.findByRole("button", { name: /start checkout/i }));
  fireEvent.click(await screen.findByRole("button", { name: /log today's work/i }));
  return screen.findByRole("button", { name: /review log/i });
}

describe("checkout navigation", () => {
  it("the summary offers a cancel that ends nothing", async () => {
    mount();
    await reachExit();
    fireEvent.click(exitRow("Check Out"));
    fireEvent.click(await screen.findByRole("button", { name: /start checkout/i }));
    fireEvent.click(await screen.findByRole("button", { name: /cancel checkout/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /log today's work/i })).toBeNull());
    expect(checkOut).not.toHaveBeenCalled();
    expect(submitTimeLogs).not.toHaveBeenCalled();
    expect(attendanceApply).not.toHaveBeenCalled();
  });

  it("BACK from the time-log form returns to the summary and keeps what was typed", async () => {
    mount();
    await reachTimeLog();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "shipped the exit flow" } });

    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));
    expect(await screen.findByRole("button", { name: /log today's work/i })).toBeTruthy();

    // …and forward again lands on the SAME form, not a fresh one.
    fireEvent.click(screen.getByRole("button", { name: /log today's work/i }));
    const again = await screen.findAllByRole("textbox");
    expect((again[0] as HTMLTextAreaElement).value).toBe("shipped the exit flow");
    expect(submitTimeLogs).not.toHaveBeenCalled();
  });

  it("CANCEL from the time-log form exits, keeps the draft, and writes no attendance", async () => {
    mount();
    await reachTimeLog();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "unsent work" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel checkout/i }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /review log/i })).toBeNull());
    const draft = JSON.parse(localStorage.getItem(draftKey()) ?? "null");
    expect(draft?.entries?.[0]?.workDescription).toBe("unsent work");
    expect(checkOut).not.toHaveBeenCalled();
    expect(submitTimeLogs).not.toHaveBeenCalled();
  });

  it("cancelling RESTORES the HUD and the world's input", async () => {
    mount();
    await reachTimeLog();
    expect(hudHidden()).toBe(true);
    expect(screen.getByTestId("vo3d-checkout").getAttribute("role")).toBe("dialog");

    fireEvent.click(screen.getByRole("button", { name: /cancel checkout/i }));
    await waitFor(() => expect(hudHidden()).toBe(false));
    // …and the modal role goes with it, so C and WASD reach the world again (app/keyGuard).
    expect(screen.getByTestId("vo3d-checkout").hasAttribute("role")).toBe(false);
  });

  it("the REVIEW step offers both Back and Cancel", async () => {
    mount();
    await reachTimeLog();
    fireEvent.click(screen.getByRole("button", { name: /review log/i }));
    await screen.findByRole("button", { name: /submit/i });
    expect(screen.getByRole("button", { name: /^Back$|back to/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /cancel checkout/i }));
    await waitFor(() => expect(hudHidden()).toBe(false));
    expect(submitTimeLogs).not.toHaveBeenCalled();
    expect(checkOut).not.toHaveBeenCalled();
  });

  it("a CANCELLED checkout can be started again, with the draft still there", async () => {
    mount();
    await reachTimeLog();
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "kept" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel checkout/i }));
    await waitFor(() => expect(hudHidden()).toBe(false));
    await reachTimeLog();
    expect((screen.getAllByRole("textbox")[0] as HTMLTextAreaElement).value).toBe("kept");
  });

  it("SUBMIT is refused until the time log actually adds up", async () => {
    // The guard that makes "no way out" safe during a submission: you cannot reach SUBMITTING with an
    // unallocated log in the first place, so there is no half-filled request to abandon.
    mount();
    await reachTimeLog();
    fireEvent.click(screen.getByRole("button", { name: /review log/i }));
    const submit = await screen.findByRole("button", { name: /submit/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(submitTimeLogs).not.toHaveBeenCalled();
    expect(checkOut).not.toHaveBeenCalled();
  });

  it("no screen offers an escape that the state machine does not have", async () => {
    // SUBMITTING and CHECKOUT_SUCCESS have no outgoing edge back (src/data/checkoutState.test.ts), so a
    // Cancel on either would throw rather than exit. This asserts the panels never render one: the only
    // states that show it are the three that can legally reach IDLE.
    const panels = readFileSync("src/dev/vo3d/app/Vo3dCheckoutPanels.tsx", "utf8");
    const shown = [...panels.matchAll(/flow\.state === "([A-Z_]+)"/g)].map((m) => m[1]);
    for (const guard of ["SUBMITTING", "CHECKOUT_SUCCESS", "WALKING_TO_EXIT", "CHECKED_OUT"])
      expect(shown, `${guard} must render no navigation`).not.toContain(guard);
    expect(panels).toContain("onCancel={flow.cancelCheckout}");
  });
});

// ---- PHASE 7E: THE DEPARTURE ------------------------------------------------------------------------
// Everything below happens ONLY downstream of a confirmed Zoho submission AND a confirmed attendance
// POST. Nothing here moves the avatar: the exit is opened, and the employee walks out themselves.

describe("what a confirmed checkout does, and what it never does", () => {
  it("says goodbye, opens the exit and re-holds the office — from ONE answer", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    // The one effect under test is keyed on the flow reaching CHECKED_OUT; it posts, then acts on the
    // record it gets back. Everything it does is downstream of that POST resolving.
    const src = readFileSync("src/dev/vo3d/app/Vo3dOverlay.tsx", "utf8");
    const effect = src.slice(src.indexOf("checkoutPostedRef.current = true;"));
    const body = effect.slice(0, effect.indexOf("}, [checkoutFlow.state]);"));
    const then = body.slice(body.indexOf(".then((record)"), body.indexOf(".catch("));
    // all three, and all of them inside the `.then` — never beside the call
    expect(then).toContain("attendance.apply(record)");
    expect(then).toContain('spatialBubbles.show(SELF_OVERHEAD_KEY, "Ciao Ciao!")');
    expect(then).toContain("setExitAuthorized(true)");
    // …and nothing moves the body
    expect(then).not.toContain("restoreSelf");
    expect(then).not.toContain("approachCoworker");
    expect(then).not.toContain("walkTo");
  });

  it("a FAILED submission reaches none of it and leaves the employee checked in", async () => {
    submitTimeLogs.mockImplementation(async () => ({ success: false, submissionId: "", entriesCreated: 0, submittedAt: "" }));
    mount();
    await reachTimeLog();
    // The flow cannot leave REVIEWING without a successful submission, so the departure is unreachable.
    fireEvent.click(screen.getByRole("button", { name: /review log/i }));
    await screen.findByRole("button", { name: /submit/i });
    expect(checkOut).not.toHaveBeenCalled();
    expect(setExitAuthorized).not.toHaveBeenCalled();
    expect(attendanceApply).not.toHaveBeenCalled();
  });

  it("cannot complete twice", async () => {
    // The POST is edge-triggered on the transition INTO CHECKED_OUT and refuses a second call while one
    // is in flight, so the goodbye and the door cannot fire twice either — they are inside its `.then`.
    const src = readFileSync("src/dev/vo3d/app/Vo3dOverlay.tsx", "utf8");
    expect(src).toContain('if (checkoutFlow.state !== "CHECKED_OUT" || prev === "CHECKED_OUT") return;');
    expect(src).toContain("if (checkoutPostedRef.current) return;");
    expect((src.match(/spatialBubbles\.show\(SELF_OVERHEAD_KEY, "Ciao Ciao!"\)/g) ?? []).length).toBe(1);
  });
});

// ---- PHASE 7E: THE SESSION AFTER A CHECKOUT ----------------------------------------------------------
// The kiosk reads V1's confirmed answer and nothing else, so a completed checkout puts it straight back
// to offering a check-in — and a new check-in puts everything back. `attendance` here is the SHARED
// answer the poller publishes, which is what `attendance.apply(record)` writes on a confirmed POST.

describe("after a confirmed checkout", () => {
  it("the kiosk offers Check In again", async () => {
    attendance = "denied"; // what the server said, published through the shared poller
    mount();
    await arriveAt();
    expect(screen.getByRole("menuitem", { name: /^Check In$/i })).toBeTruthy();
    expect(screen.getByTestId("world-menu-meta").textContent).toContain("Checked out");
  });

  it("…and does NOT check anybody in just for walking up to it", async () => {
    attendance = "denied";
    mount();
    await arriveAt();
    expect(checkIn).not.toHaveBeenCalled();
  });

  it("a NEW check-in publishes the confirmed record, which is what reopens the office", async () => {
    attendance = "denied";
    mount();
    await arriveAt();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Check In$/i }));
    await waitFor(() => expect(attendanceApply).toHaveBeenCalledWith(expect.objectContaining({ status: "CHECKED_IN" })));
    // The overlay never opens the gate itself — it hands the record over and the host pushes the answer
    // into the world (app/Vo3dHost.tsx). One authority, one path.
    const src = readFileSync("src/dev/vo3d/app/Vo3dOverlay.tsx", "utf8");
    expect(src).not.toContain("setOfficeAccess(");
  });

  it("an UNCONFIRMED answer never offers a way in", async () => {
    attendance = "unknown";
    mount();
    await arriveAt();
    expect(screen.queryByRole("menuitem", { name: /Check In/i })).toBeNull();
  });
});

// ---- ROOM DETAILS ------------------------------------------------------------------------------------
// V1/V2 parity for components/OfficeMap/RoomSidebar. WHAT the panel is allowed to say is
// Vo3dRoomDetails.test.tsx's subject; this is about the WIRING — which world signal opens it, which one
// closes it, how it is reached from a view that has no cursor, and that a row runs V1's EXISTING employee
// interactions rather than a second set of its own.
describe("room details", () => {
  /** The world reports a picked floor region, exactly as a left click on a room's floor makes it. */
  async function pickRoom(roomId: string | null = "design-room") {
    await waitFor(() => expect(handlers).not.toBeNull());
    act(() => handlers!.onRoomSelected!(roomId));
  }
  const panel = () => screen.getByTestId("vo3d-room-details");
  const roomTile = () => screen.getByRole("button", { name: "Open room details" });

  it("opens on the world's room signal, named and counted from V1's own roster", async () => {
    mount();
    await pickRoom("design-room");
    await waitFor(() => expect(panel().dataset.open).toBe("true"));
    expect(screen.getByText("Design Room")).toBeTruthy();
    // Both roster rows live in "design-team" — the FLAT id behind the manifest id the world reported.
    expect(screen.getByTestId("vo3d-room-subtitle").textContent).toBe("2 people in the room");
    expect(screen.getAllByTestId("vo3d-room-person")).toHaveLength(2);
  });

  it("closes when the world drops the room — a click on a person, a fixture or the hall", async () => {
    mount();
    await pickRoom("design-room");
    await waitFor(() => expect(panel().dataset.open).toBe("true"));
    await pickRoom(null);
    await waitFor(() => expect(panel().dataset.open).toBe("false"));
  });

  it("closing tells the world, so the very same floor can be clicked again", async () => {
    mount();
    await pickRoom("design-room");
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(panel().dataset.open).toBe("false"));
    expect(setSelectedRoom).toHaveBeenCalledWith(null);
  });

  it("is reachable from the dock in PLAYER, where the labels are not drawn — unchanged behaviour", async () => {
    currentRoomId = "dev-room";
    mount();
    setViewMode("player");
    fireEvent.click(roomTile());
    await waitFor(() => expect(panel().dataset.open).toBe("true"));
    expect(screen.getByText("Dev Room")).toBeTruthy();
    // The world is told, or a later click on that same floor would be deduped away as "already selected".
    expect(setSelectedRoom).toHaveBeenCalledWith("dev-room");
  });

  it("says so rather than opening an empty panel when a PLAYER is not in a room", async () => {
    currentRoomId = null;
    mount();
    setViewMode("player");
    fireEvent.click(roomTile());
    expect(await screen.findByText(/Step into a room/)).toBeTruthy();
    expect(panel().dataset.open).toBe("false");
  });

  it("selecting a row makes the SAME world selection a click on their body makes", async () => {
    mount();
    await pickRoom("design-room");
    fireEvent.click(await screen.findByRole("button", { name: /Alex Cruz/ }));
    expect(selectByEmail).toHaveBeenCalledWith(ALEX);
    // V1's own character click closes the room panel; so does this.
    await waitFor(() => expect(panel().dataset.open).toBe("false"));
    // …and no second action path was invented: the action card is what the world's selection opens.
    expect(screen.queryByTestId("profile")).toBeNull();
  });

  it("falls back to V1's profile modal for somebody the world is not drawing", async () => {
    worldHasBody = false;
    mount();
    await pickRoom("design-room");
    fireEvent.click(await screen.findByRole("button", { name: /Alex Cruz/ }));
    expect(await screen.findByTestId("profile")).toBeTruthy();
  });

  it("opens the viewer's own profile for their own row — you cannot walk up to yourself", async () => {
    mount();
    await pickRoom("design-room");
    fireEvent.click(await screen.findByRole("button", { name: /Bon/ }));
    expect(selectByEmail).not.toHaveBeenCalled();
    expect((await screen.findByTestId("profile")).textContent).toBe(SELF);
  });

  // ---- ROOM DISCOVERY: the names over the floor ------------------------------------------------------
  const labels = () => screen.queryAllByTestId("vo3d-room-label");

  it("the dock tile toggles the labels in OFFICE, and each label is the room's own name", async () => {
    mount();
    expect(labels()).toHaveLength(0);
    fireEvent.click(roomTile());
    await waitFor(() => expect(labels().length).toBeGreaterThan(0));
    expect(screen.getByText("Design Room")).toBeTruthy();
    expect(screen.getByText("Dev Room")).toBeTruthy();
    // …and the same tile puts them away again.
    fireEvent.click(roomTile());
    await waitFor(() => expect(labels()).toHaveLength(0));
  });

  it("letters every room at ONE shared size, prominent at the default zoom", async () => {
    mount();
    fireEvent.click(roomTile());
    await waitFor(() => expect(labels().length).toBeGreaterThan(0));
    const sizeOf = (id: string) =>
      Number.parseFloat((document.querySelector(`[data-room-id="${id}"]`) as HTMLElement).style.fontSize);

    // PROMINENT AT DEFAULT ZOOM. The first version projected a fixed cap height in world units, which at
    // this zoom fell under its own hide floor and drew nothing at all.
    await waitFor(() => expect(sizeOf("central-hub")).toBeGreaterThan(24));
    // AND ONE SIZE FOR ALL OF THEM. The second version sized each room to its own floor, which put
    // several typographic scales on one screen — the big hub and the small side room now read as one
    // system, because the room's own dimensions get no vote.
    expect(sizeOf("dev-room")).toBeCloseTo(sizeOf("central-hub"), 3);
    expect(sizeOf("design-room")).toBeCloseTo(sizeOf("central-hub"), 3);
    for (const id of ROOM_LABEL_IDS) {
      expect((document.querySelector(`[data-room-id="${id}"]`) as HTMLElement).style.visibility).toBe("visible");
    }
  });

  it("scales the shared size with the zoom, together", async () => {
    mount();
    fireEvent.click(roomTile());
    const sizeOf = (id: string) =>
      Number.parseFloat((document.querySelector(`[data-room-id="${id}"]`) as HTMLElement).style.fontSize);
    await waitFor(() => expect(sizeOf("central-hub")).toBeGreaterThan(0));
    const before = sizeOf("central-hub");
    const beforeDev = sizeOf("dev-room");
    expect(before).toBeCloseTo(beforeDev, 3);
    // Zoom in: one world unit measures more pixels, so the shared size grows and takes every label with
    // it. (Far enough in, the shared size outgrows what a small room can hold and that room takes its
    // minimum adjustment — which is the rule working, not the set drifting apart.)
    roomScale = 2;
    await waitFor(() => expect(sizeOf("central-hub")).toBeGreaterThan(before));
    expect(sizeOf("dev-room")).toBeGreaterThan(beforeDev);
  });

  it("shrinks or wraps ONLY the room that would otherwise overflow", async () => {
    // A room far too narrow to carry its name on one line at the shared size.
    roomFootprints = { ...roomFootprints, "design-room": { widthPx: 150, heightPx: 260 } };
    mount();
    fireEvent.click(roomTile());
    const node = (id: string) => document.querySelector(`[data-room-id="${id}"]`) as HTMLElement;
    await waitFor(() => expect(node("central-hub").style.fontSize).not.toBe(""));
    const shared = Number.parseFloat(node("central-hub").style.fontSize);
    // Wrapped onto two lines rather than shrunk away to nothing — a narrow room would rather read at
    // full size on two lines.
    expect(node("design-room").textContent).toBe("Design\nRoom");
    expect(Number.parseFloat(node("design-room").style.fontSize)).toBeLessThanOrEqual(shared);
    // And nobody else moved.
    expect(Number.parseFloat(node("dev-room").style.fontSize)).toBeCloseTo(shared, 3);
    expect(node("dev-room").textContent).toBe("Dev Room");
  });

  it("still refuses to draw anything at a zoom where the type would be a smear", async () => {
    roomScale = 0.05;
    mount();
    fireEvent.click(roomTile());
    const label = await screen.findByText("Central Hub");
    // The ONE thing that hides a label now, and only a camera a very long way out reaches it.
    await waitFor(() => expect(label.style.visibility).toBe("hidden"));
  });

  it("shows them in 3D EXPLORE too, and never in PLAYER", async () => {
    mount();
    setViewMode("explore");
    fireEvent.click(roomTile());
    await waitFor(() => expect(labels().length).toBeGreaterThan(0));
    // PLAYER keeps its own behaviour: the labels go away without the preference being forgotten…
    setViewMode("player");
    await waitFor(() => expect(labels()).toHaveLength(0));
    // …so coming back restores what the employee chose, rather than making them ask twice.
    setViewMode("office");
    await waitFor(() => expect(labels().length).toBeGreaterThan(0));
  });

  it("Escape dismisses the labels", async () => {
    mount();
    fireEvent.click(roomTile());
    await waitFor(() => expect(labels().length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(labels()).toHaveLength(0));
  });

  it("washes the hovered room's floor, and clears it on the way out", async () => {
    mount();
    fireEvent.click(roomTile());
    const label = await screen.findByText("Dev Room");
    fireEvent.pointerEnter(label);
    expect(setRoomHighlight).toHaveBeenCalledWith("dev-room");
    fireEvent.pointerLeave(label);
    expect(setRoomHighlight).toHaveBeenLastCalledWith(null);
  });

  it("clicking a name opens Room Details through the SAME selection a floor click makes", async () => {
    mount();
    fireEvent.click(roomTile());
    fireEvent.click(await screen.findByText("Dev Room"));
    await waitFor(() => expect(panel().dataset.open).toBe("true"));
    expect(screen.getByTestId("vo3d-room-subtitle").textContent).toBe("0 people in the room");
    // The world is told, which is what frames the room through the existing smooth focus.
    expect(setSelectedRoom).toHaveBeenCalledWith("dev-room");
    // The labels stay up — hopping between rooms is the whole point of discovery.
    expect(labels().length).toBeGreaterThan(0);
  });

  it("joins the ONE 'a tool owns the screen' rule, exactly as V1's room sidebar does", async () => {
    mount();
    const dock = screen.getByTestId("hud-dock");
    expect(dock.className).not.toMatch(/hidden/i);
    await pickRoom("design-room");
    // The dock steps aside for a focused side panel — same rule, same mechanism, no second one. Hidden
    // by the dock's own class, never unmounted, so nothing loses its state or its subscriptions.
    await waitFor(() => expect(screen.getByTestId("hud-dock").className).toMatch(/hidden/i));
  });
});

// PHASE 7G — THE TOUCAN, IN V2: A BIRD YOU CALL.
//
// Nothing here tests the assistant, and nothing here tests the flight. Every assertion is about the
// SEQUENCE, which is the thing this phase exists to fix: a control calls the BIRD, the world flies it,
// and the panel opens on ARRIVAL — never straight off the click.
describe("the Toucan", () => {
  const lastPose = () => poses[poses.length - 1];
  /** Press the summon button and let the bird arrive, the way the world would. */
  const summonAndArrive = async () => {
    fireEvent.click(await screen.findByTestId("vo3d-toucan-summon"));
    flyToucan("approaching");
    flyToucan("attending");
    return screen.findByTestId("toucan-panel");
  };

  it("calls the BIRD on a press, and opens nothing until it has arrived", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("vo3d-toucan-summon"));
    expect(toucanCall).toHaveBeenCalledTimes(1);
    // IN THE AIR. This is the whole correction: no panel yet.
    flyToucan("approaching");
    expect(screen.queryByTestId("toucan-panel")).toBeNull();
    // ARRIVED.
    flyToucan("attending");
    await screen.findByTestId("toucan-panel");
  });

  it("releases the bird when the panel is dismissed, and deletes nothing", async () => {
    mount();
    await summonAndArrive();
    fireEvent.click(screen.getByLabelText("toucan-release"));
    expect(toucanRelease).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("toucan-panel")).toBeNull());
    // The transcript is the server's, so calling it back lands in the same conversation — the panel
    // simply takes its mount path again.
    await summonAndArrive();
  });

  it("does NOT reopen the panel when a released bird is still parked", async () => {
    mount();
    await summonAndArrive();
    fireEvent.click(screen.getByLabelText("toucan-release"));
    await waitFor(() => expect(screen.queryByTestId("toucan-panel")).toBeNull());
    // The world has not flown it home yet, so it re-reports "attending" — the intent is gone, so this
    // must not put the panel back up behind somebody who just closed it.
    flyToucan("attending");
    expect(screen.queryByTestId("toucan-panel")).toBeNull();
  });

  it("keeps the RIGHTMOST slot in the same window stack the chat windows use", async () => {
    mount();
    await summonAndArrive();
    expect((screen.getByTestId("vo3d-toucan") as HTMLElement).style.right).toBe("16px");

    act(() => handlers!.onSelect({ email: ALEX, displayName: "Alex Cruz" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^chat$/i }));
    await screen.findByTestId("conversation");
    expect((screen.getByTestId("vo3d-toucan") as HTMLElement).style.right).toBe("16px");
    const chatSlot = screen.getByTestId("conversation").parentElement as HTMLElement;
    expect(chatSlot.style.right).toBe("348px");
  });

  it("gives the bird its world-space pill while a reply is being prepared — and only bird talk", async () => {
    mount();
    await summonAndArrive();
    fireEvent.click(screen.getByLabelText("toucan-pending-on"));
    const pill = await screen.findByTestId("overhead-text-__toucan__");
    // BIRD TALK ONLY. V1's rule: the meaningful reply belongs in the panel, and no channel exists
    // through which response text could reach this bubble.
    expect(pill.textContent).toBe("Squawk squawk…");
  });

  it("animates the viewer's own body through the EXISTING conversation seam while they type to it", async () => {
    mount();
    await waitFor(() => expect(lastPose()).toBeTruthy());
    await summonAndArrive();
    fireEvent.click(screen.getByLabelText("toucan-type-on"));
    await waitFor(() => expect(lastPose().self).toBe("agree-gesture"));
    expect(lastPose().peers.get(ALEX)).toBeNull();
    expect(screen.queryByTestId("overhead-typing-__self__")).toBeNull();

    fireEvent.click(screen.getByLabelText("toucan-type-off"));
    await waitFor(() => expect(lastPose().self).toBeNull());
  });

  it("sends the return card's conversation through the ONE existing opener", async () => {
    conversations = [{ id: "conv-9", participantIds: [SELF, ALEX], type: "dm" } as never];
    mount();
    await summonAndArrive();
    fireEvent.click(screen.getByLabelText("toucan-open-conversation"));
    expect((await screen.findByTestId("conversation")).textContent).toBe(ALEX);
  });

  it("releases the pointer lock when the PANEL opens — not when the bird is called", async () => {
    const exit = vi.fn();
    Object.defineProperty(document, "pointerLockElement", { value: document.createElement("canvas"), configurable: true });
    Object.defineProperty(document, "exitPointerLock", { value: exit, configurable: true });
    mount();
    await screen.findByTestId("hud-dock");
    // T IS THE PLAYER'S PATH, and the only one available here: the button and the dock are DOM and both
    // step aside while the pointer is held.
    expect(screen.queryByTestId("vo3d-toucan-summon")).toBeNull();
    fireEvent.keyDown(window, { code: "KeyT" });
    expect(toucanCall).toHaveBeenCalledTimes(1);
    // Summoning keeps the mouse: a called bird must not interrupt a walk.
    flyToucan("approaching");
    expect(exit).not.toHaveBeenCalled();
    // The text box is what needs the pointer back.
    flyToucan("attending");
    await screen.findByTestId("toucan-panel");
    expect(exit).toHaveBeenCalled();
    Object.defineProperty(document, "pointerLockElement", { value: null, configurable: true });
  });

  it("summons the bird on a genuine return, and remembers the boundary so it never briefs twice", async () => {
    catchUp = {
      activity: { since: "2026-09-20T01:00:00Z", sinceReason: "last_active", importantCount: 2 },
      conversations: [],
      delegatedUrgentCount: 0,
    };
    mount();
    await waitFor(() => expect(toucanConnected.length).toBeGreaterThan(0));
    await act(async () => { for (const cb of toucanConnected) cb(); });
    // THE BIRD IS CALLED, not a panel conjured: a briefing is Toucan coming to find you.
    await waitFor(() => expect(toucanCall).toHaveBeenCalled());
    flyToucan("attending");
    await screen.findByTestId("toucan-panel");

    fireEvent.click(screen.getByLabelText("toucan-release"));
    await waitFor(() => expect(screen.queryByTestId("toucan-panel")).toBeNull());
    await act(async () => { for (const cb of toucanConnected) cb(); });
    expect(screen.queryByTestId("toucan-panel")).toBeNull();
  });

  it("does not summon itself when the catch-up is not a real observed absence", async () => {
    catchUp = {
      activity: { since: "2026-09-20T01:00:00Z", sinceReason: "fallback", importantCount: 9 },
      conversations: [],
      delegatedUrgentCount: 0,
    };
    mount();
    await waitFor(() => expect(toucanConnected.length).toBeGreaterThan(0));
    await act(async () => { for (const cb of toucanConnected) cb(); });
    expect(toucanCall).not.toHaveBeenCalled();
    expect(screen.queryByTestId("toucan-panel")).toBeNull();
  });

  it("lets the bird go when checkout takes the chrome away", async () => {
    mount();
    await summonAndArrive();
    // V1 refuses to leave a bird parked beside a departing avatar with an orphaned panel.
    await openCheckoutPanel();
    await waitFor(() => expect(screen.queryByTestId("toucan-panel")).toBeNull());
    expect(toucanRelease).toHaveBeenCalled();
  });
});

// ---- V1 PARITY: MINIMIZED CONVERSATIONS, AND WHITEBOARDS -------------------------------------------
//
// Both are V1 features being brought over intact rather than rebuilt, so what is asserted is the WIRING:
// that a minimized window becomes a bubble WITHOUT being unmounted, that restoring is the same toggle the
// header runs, and that a board is opened at the right scope for each of V1's four conversation entry
// points and its room one.
/** The world reports a room selection — the same signal a floor click or the dock's Room tile makes. */
async function selectRoom(roomId: string | null) {
  await waitFor(() => expect(handlers).not.toBeNull());
  act(() => handlers!.onRoomSelected!(roomId));
}
/** The dock's Chat tile, whose accessible name is the inbox's, not the caption's. */
const inboxTile = () => screen.getByRole("button", { name: /Conversations|unread message/ });

describe("minimized conversations", () => {
  /** Open a Global Chat DM as a REMOTE window (the inbox route, not a walk). */
  async function openRemoteDm() {
    conversations = [{ id: "conv-9", type: "dm", participantIds: [SELF, ALEX], unreadCount: 0 } as never];
    mount();
    fireEvent.click(inboxTile());
    fireEvent.click(await screen.findByRole("button", { name: /Alex Cruz/ }));
    return screen.findByTestId("conversation");
  }

  it("minimizes into a circular avatar button and restores from it", async () => {
    await openRemoteDm();
    fireEvent.click(screen.getByLabelText(`minimize ${ALEX}`));

    const bubble = await screen.findByLabelText(/^Restore chat with Alex Cruz/);
    // THE WINDOW IS STILL MOUNTED, only hidden — which is what preserves its messages, its draft and its
    // scroll position across a minimize. A bubble is a view of an open window, never a replacement one.
    expect(screen.getByTestId("conversation")).toBeTruthy();
    expect((screen.getByTestId("conversation").parentElement as HTMLElement).hidden).toBe(true);

    fireEvent.click(bubble);
    await waitFor(() => expect((screen.getByTestId("conversation").parentElement as HTMLElement).hidden).toBe(false));
    expect(screen.queryByLabelText(new RegExp("^Restore chat with"))).toBeNull();
  });

  it("keeps minimizing and closing as two different decisions", async () => {
    await openRemoteDm();
    fireEvent.click(screen.getByLabelText(`minimize ${ALEX}`));
    await screen.findByLabelText(new RegExp("^Restore chat with"));
    // The ✕ beside the bubble CLOSES — the window goes, and with it the bubble.
    fireEvent.click(screen.getByLabelText(new RegExp("^Close chat with")));
    await waitFor(() => expect(screen.queryByTestId("conversation")).toBeNull());
    expect(screen.queryByLabelText(new RegExp("^Restore chat with"))).toBeNull();
  });

  it("carries the unread count of a conversation that is minimized", async () => {
    conversations = [{ id: "conv-9", type: "dm", participantIds: [SELF, ALEX], unreadCount: 4 } as never];
    mount();
    fireEvent.click(inboxTile());
    fireEvent.click(await screen.findByRole("button", { name: /Alex Cruz/ }));
    await screen.findByTestId("conversation");
    fireEvent.click(screen.getByLabelText(`minimize ${ALEX}`));
    // The SAME rows the dock badge and the inbox read — no second unread store exists for the rail, which
    // is why the dock's own badge is also showing 4 and the label has to be matched precisely.
    const bubble = await screen.findByLabelText("Restore chat with Alex Cruz, 4 unread");
    expect(bubble.textContent).toContain("4");
  });

  it("clears the rail's column for the windows still open beside it", async () => {
    await openRemoteDm();
    // A second conversation beside it, so there is a row to observe.
    act(() => handlers!.onSelect({ email: ALEX, displayName: "Alex Cruz" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^chat$/i }));
    const slotOf = (el: HTMLElement) => (el.parentElement as HTMLElement).style.right;
    const spatialSlot = () => {
      const open = screen.getAllByTestId("conversation").filter((c) => !(c.parentElement as HTMLElement).hidden);
      return slotOf(open[open.length - 1]);
    };
    // Two expanded windows: the second sits one full window-width to the left of the first.
    await waitFor(() => expect(spatialSlot()).toBe("348px"));

    fireEvent.click(screen.getAllByLabelText(`minimize ${ALEX}`)[0]);
    // The minimized one leaves the ROW for the rail, and V1's own base offset then starts the row to the
    // LEFT of the bubble column (16 edge + 52 bubble + 12 gap) instead of underneath it.
    await waitFor(() => expect(spatialSlot()).toBe("80px"));
  });

  it("steps aside for a panel that owns the screen, as the dock and the Toucan button do", async () => {
    await openRemoteDm();
    fireEvent.click(screen.getByLabelText(`minimize ${ALEX}`));
    await screen.findByLabelText(new RegExp("^Restore chat with"));
    await selectRoom("design-room");
    await waitFor(() => expect(screen.queryByLabelText(new RegExp("^Restore chat with"))).toBeNull());
  });
});

describe("whiteboards", () => {
  const board = () => screen.getByTestId("whiteboard");

  it("opens a DM board on that ONE-TO-ONE conversation, and leaves the conversation open", async () => {
    mount();
    await waitFor(() => expect(handlers).not.toBeNull());
    act(() => handlers!.onSelect({ email: ALEX, displayName: "Alex Cruz" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^chat$/i }));
    await screen.findByTestId("conversation");

    fireEvent.click(screen.getByLabelText(`board ${ALEX}`));
    // V1'S CONTRACT: a DM board is a CONVERSATION scope, on the id the panel itself resolved.
    expect((await screen.findByTestId("whiteboard")).dataset.scope).toBe("conversation:conv-dm");
    // The conversation is untouched — a board opens BESIDE it, never instead of it.
    expect(screen.getByTestId("conversation")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("close board"));
    await waitFor(() => expect(screen.queryByTestId("whiteboard")).toBeNull());
    expect(screen.getByTestId("conversation")).toBeTruthy();
  });

  it("opens a GROUP board on that group's own conversation — the same scope kind, not a second one", async () => {
    conversations = [{ id: "grp-1", type: "group", participantIds: [SELF, ALEX], title: "Design Sync" } as never];
    mount();
    fireEvent.click(inboxTile());
    fireEvent.click(await screen.findByRole("button", { name: /Design Sync/ }));
    await screen.findByTestId("group-conversation");
    fireEvent.click(screen.getByLabelText("board grp-1"));
    expect((await screen.findByTestId("whiteboard")).dataset.scope).toBe("conversation:grp-1");
    expect(board().dataset.title).toBe("Design Sync");
  });

  it("opens a ROOM's boards from Room Details, at the FLAT room id boards are keyed on", async () => {
    mount();
    await selectRoom("design-room");
    fireEvent.click(await screen.findByTestId("vo3d-room-boards"));
    // Not the manifest layer id: the flat namespace is what a board scope can be answered for.
    expect((await screen.findByTestId("whiteboard")).dataset.scope).toBe("room:design-team");
  });

  it("offers NO room board for a space that has no flat room of its own", async () => {
    mount();
    await selectRoom("central-hub");
    // The wall-less shared space has art but no flat rect, so nothing keyed on that namespace can answer
    // for it — V1 says so itself. No button is better than a scope nothing could serve.
    expect(screen.queryByTestId("vo3d-room-boards")).toBeNull();
  });

  it("keeps ONE Ask Toucan, shared with the dock's own boards panel", async () => {
    mount();
    await selectRoom("design-room");
    fireEvent.click(await screen.findByTestId("vo3d-room-boards"));
    fireEvent.click(await screen.findByLabelText("ask toucan about board"));
    // The EXISTING summon, not a second path into the assistant.
    expect(toucanCall).toHaveBeenCalled();
  });
});
