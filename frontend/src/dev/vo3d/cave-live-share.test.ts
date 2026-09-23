import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSnapshot } from "../../services/call/callStore";

// PHASE 7D. THE CAVE PANEL'S STATUS IS THE MEETING'S, NOT THE BRIDGE'S.
//
// The bug this pins, found by driving the real world: connect() set status to "connected" as soon as the
// call store had been IMPORTED, and read() never touched status again. So the panel offered Mic / Camera
// / Share / Leave before anybody had joined anything, and went on offering them after Leave had already
// torn the LiveKit room down — a Leave button for a meeting you were no longer in.
//
// The call store is mocked because this is about the DERIVATION, not about LiveKit: the bridge is handed
// snapshots and must report what they say.

let snapshot: CallSnapshot;
const listeners = new Set<() => void>();
const startOrJoinMeeting = vi.fn(async () => {});
const leaveCall = vi.fn(() => {
  snapshot = snap();
  for (const l of listeners) l();
});

vi.mock("../../services/call/callStore", () => ({
  getCallSnapshot: () => snapshot,
  subscribeToCallState: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setDevIdentity: vi.fn(),
  ensureCallSocket: vi.fn(),
  startOrJoinMeeting: (...a: unknown[]) => startOrJoinMeeting(...(a as [])),
  startOrJoinCall: vi.fn(async () => {}),
  leaveCall: () => leaveCall(),
  setMicEnabled: vi.fn(async () => {}),
  setCameraEnabled: vi.fn(async () => {}),
  setScreenShareEnabled: vi.fn(async () => {}),
}));

function snap(over: Partial<CallSnapshot> = {}): CallSnapshot {
  return {
    status: "idle",
    connectedSessionId: null,
    connectedBoardId: null,
    connectedMeetingId: null,
    boardError: null,
    micEnabled: false,
    cameraEnabled: false,
    cameraError: null,
    error: null,
    calls: [],
    outgoing: null,
    incoming: null,
    inviteOutcome: null,
    audioPlaybackBlocked: false,
    videoByIdentity: {},
    screenShare: null,
    screenShareEnabled: false,
    screenShareError: null,
    acceptedPeerEmail: null,
    participants: [],
    meetings: [],
    incomingMeetingInvite: null,
    outgoingMeetingInvite: null,
    meetingInviteOutcome: null,
    ...over,
  };
}

/** Push a snapshot the way the store would: replace it, then notify. */
function push(over: Partial<CallSnapshot>): void {
  snapshot = snap(over);
  for (const l of listeners) l();
}

async function connected() {
  const { CaveLiveShare } = await import("./media/CaveLiveShare");
  const bridge = new CaveLiveShare({ onShare: () => {}, onCameras: () => {} });
  await bridge.connect("micah@offshorly.com");
  return bridge;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  listeners.clear();
  snapshot = snap();
});

describe("CaveLiveShare status", () => {
  it("is off once connected to the STORE but not to any meeting", async () => {
    const bridge = await connected();
    expect(bridge.state.status).toBe("off");
  });

  it("tracks the meeting through connecting and connected", async () => {
    const bridge = await connected();

    push({ status: "connecting", connectedMeetingId: "cave-all-hands" });
    expect(bridge.state.status).toBe("connecting");

    push({ status: "connected", connectedMeetingId: "cave-all-hands", micEnabled: true, participants: ["micah@offshorly.com"] });
    expect(bridge.state.status).toBe("connected");
    expect(bridge.state.kind).toBe("meeting");
    expect(bridge.state.people).toBe(1);
    expect(bridge.state.mic).toBe(true);
  });

  it("returns to off when the meeting is left — the regression this file exists for", async () => {
    const bridge = await connected();
    push({ status: "connected", connectedMeetingId: "cave-all-hands", participants: ["micah@offshorly.com"] });
    expect(bridge.state.status).toBe("connected");

    bridge.leave();

    expect(leaveCall).toHaveBeenCalled();
    expect(bridge.state.status).toBe("off");
    expect(bridge.state.people).toBe(0);
  });

  it("does not call a SPATIAL call 'in the meeting' — that is somebody else's call", async () => {
    const bridge = await connected();
    push({ status: "connected", connectedSessionId: "conv-1", participants: ["micah@offshorly.com", "angelo@offshorly.com"] });
    expect(bridge.state.status).toBe("off");
    expect(bridge.state.kind).toBe("spatial");
  });

  it("surfaces a failed connect as an error with the store's own words", async () => {
    const bridge = await connected();
    push({ status: "error", error: "Couldn't join the call" });
    expect(bridge.state.status).toBe("error");
    expect(bridge.state.note).toBe("Couldn't join the call");
  });
});

// PHASE 7D — WHAT THE GALLERY IS TOLD. Membership, with cameras attached to the members who have one.
describe("CaveLiveShare members", () => {
  async function bridgeWithCameras() {
    const seen: Array<Array<{ identity: string; track?: unknown }>> = [];
    const { CaveLiveShare } = await import("./media/CaveLiveShare");
    const bridge = new CaveLiveShare({ onShare: () => {}, onCameras: (c) => seen.push(c) });
    await bridge.connect("micah@offshorly.com");
    return { bridge, seen };
  }

  it("reports everybody in the room, camera or not", async () => {
    const { seen } = await bridgeWithCameras();
    push({
      status: "connected",
      connectedMeetingId: "cave-all-hands",
      participants: ["micah@offshorly.com", "angelo@offshorly.com"],
    });
    expect(seen.at(-1)).toEqual([
      { identity: "angelo@offshorly.com" },
      { identity: "micah@offshorly.com" },
    ]);
  });

  it("attaches a camera to the member who has one, and leaves the rest bare", async () => {
    const track = { attach: () => {}, detach: () => {} };
    const { bridge, seen } = await bridgeWithCameras();
    push({
      status: "connected",
      connectedMeetingId: "cave-all-hands",
      participants: ["micah@offshorly.com", "angelo@offshorly.com"],
      videoByIdentity: { "angelo@offshorly.com": track as never },
    });
    const last = seen.at(-1)!;
    expect(last[0]).toEqual({ identity: "angelo@offshorly.com", track });
    expect(last[1]).toEqual({ identity: "micah@offshorly.com" });
    // The panel's own camera count stays what it says: pictures, not people.
    expect(bridge.state.cameras).toBe(1);
    expect(bridge.state.people).toBe(2);
  });

  it("empties the gallery when the last participant leaves", async () => {
    const { seen } = await bridgeWithCameras();
    push({ status: "connected", connectedMeetingId: "cave-all-hands", participants: ["micah@offshorly.com"] });
    expect(seen.at(-1)).toHaveLength(1);

    push({ status: "idle" });

    expect(seen.at(-1)).toEqual([]);
  });

  it("keeps a stable order so tiles do not reshuffle as people come and go", async () => {
    const { seen } = await bridgeWithCameras();
    push({ status: "connected", connectedMeetingId: "cave-all-hands", participants: ["z@x.com", "a@x.com"] });
    expect(seen.at(-1)!.map((m) => m.identity)).toEqual(["a@x.com", "z@x.com"]);
  });
});
