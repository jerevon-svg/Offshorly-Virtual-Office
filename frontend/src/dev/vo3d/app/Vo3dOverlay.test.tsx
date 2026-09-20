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
});

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
  ConversationView: ({ peer, onTypingChange, onIncomingMessage }: { peer: { id: string }; onTypingChange?: (t: boolean) => void; onIncomingMessage?: (m: unknown) => void }) => (
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
    </div>
  ),
}));
vi.mock("../../../components/OfficeMap/EmployeeProfile", () => ({
  EmployeeProfile: ({ email }: { email: string }) => <div data-testid="profile">{email}</div>,
}));
vi.mock("../../../components/OfficeMap/SpatialCallControls", () => ({ SpatialCallControls: () => null }));
vi.mock("../../../components/OfficeMap/CallInvitePrompt", () => ({ CallInvitePrompt: () => null }));

// ---- the world stub --------------------------------------------------------------------------------
let handlers: Handlers | null = null;
const approachCoworker = vi.fn(() => true);
const clearSelection = vi.fn();
const poses: { peers: Map<string, string | null>; self: string | null }[] = [];
let caveInside = false;
let caveSubs: ((s: { inside: boolean }) => void)[] = [];
/** Walk the viewer into (or out of) the Cave, the way CaveTransition would. */
function setCaveInside(inside: boolean) {
  caveInside = inside;
  act(() => caveSubs.forEach((cb) => cb({ inside })));
}

const world = {
  setCoworkerInteractions: (h: Handlers | null) => { handlers = h; },
  // Phase 7B's overhead layer asks for anchors every frame; a fixed one is enough here — WHERE they land
  // is Vo3dOverheads.test.tsx's subject, WHAT is overhead is this file's.
  coworkerAnchors: (emails: readonly string[]) =>
    Object.fromEntries(emails.map((e) => [e, { clientX: 100, clientY: 100, visible: true, scale: 1 }])),
  selfAnchor: () => ({ clientX: 120, clientY: 120, visible: true, scale: 1 }),
  subscribeViewMode: (cb: (m: "office" | "explore" | "player") => void) => { cb("office"); return () => {}; },
  subscribePlayerView: (cb: (v: "first" | "third") => void) => { cb("third"); return () => {}; },
  setViewMode: vi.fn(),
  setPlayerView: vi.fn(),
  setConversationPoses: (peers: Map<string, string | null>, self: string | null) => {
    poses.push({ peers: new Map(peers), self });
  },
  devToolsVisible: () => false,
  setDevToolsVisible: vi.fn(),
  exitPlayerMode: vi.fn(),
  selectCoworkerByEmail: vi.fn(() => true),
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
  caveInside = false;
  caveSubs = [];
  conversations = [];
  typingListeners = [];
  poses.length = 0;
  dndEmails = new Set();
  sessions = [];
  attendance = "permitted";
  handlers = null;
  vi.clearAllMocks();
  setCurrentUserFromMeResponse({ id: 1, email: SELF, name: "Bon" } as never);
});
afterEach(() => resetCurrentUserForTests());

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
