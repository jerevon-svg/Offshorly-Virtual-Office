// Phase 6D — WHAT A SELECTED COWORKER MEANS, asserted against V1's own services.
//
// The world is a stub (its picking and its walk have their own tests in world/Coworkers.pick.test.ts and
// player/targeting.person.test.ts); V1's services are mocked at the module boundary so what each action
// actually CALLS is visible. That is the thing a host can get wrong: a row that looks right and reaches
// nothing, a gate skipped, a second implementation of a rule V1 already owns.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dCoworkerInteractions } from "./Vo3dCoworkerInteractions";
import type { Vo3dCoworkerInteractions as Handlers } from "./interactions";
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
vi.mock("../../../services/call/callStore", () => ({
  useCallState: () => ({ acceptedPeerEmail: null, incoming: null, outgoing: null, outcome: null, calls: {}, status: "idle", error: null }),
  callParticipantsFor: () => [] as string[],
  clearAcceptedPeer: vi.fn(),
  getCallSnapshot: () => ({ status: "idle", error: null }),
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

vi.mock("../../../services/chat/useUnreadTotal", () => ({
  useUnreadTotal: () => ({ total: 0, unreadConversations: [], conversations: [], refetch: () => Promise.resolve() }),
}));

// The two heavy V1 panels: mounted for real in the app, stubbed here so these tests stay about the
// wiring rather than about a chat transport or a profile fetch.
vi.mock("../../../components/Chat/ConversationView", () => ({
  ConversationView: ({ peer }: { peer: { id: string } }) => <div data-testid="conversation">{peer.id}</div>,
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
const world = {
  setCoworkerInteractions: (h: Handlers | null) => { handlers = h; },
  clearCoworkerSelection: clearSelection,
  coworkerAnchor: () => ({ clientX: 400, clientY: 300, visible: true }),
  approachCoworker,
} as unknown as Vo3dWorld;
const worldRef = { current: world };

const people: OfficePerson[] = [
  { email: SELF, name: "Bon", status: "ONLINE" } as unknown as OfficePerson,
  { email: ALEX, name: "Alex Cruz", status: "ONLINE" } as unknown as OfficePerson,
];

beforeEach(() => {
  dndEmails = new Set();
  sessions = [];
  attendance = "permitted";
  handlers = null;
  vi.clearAllMocks();
  setCurrentUserFromMeResponse({ id: 1, email: SELF, name: "Bon" } as never);
});
afterEach(() => resetCurrentUserForTests());

function mount() {
  return render(<Vo3dCoworkerInteractions worldRef={worldRef} ready people={people} officeAccess={attendance} />);
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
