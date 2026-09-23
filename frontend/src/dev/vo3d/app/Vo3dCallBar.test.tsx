import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSnapshot } from "../../../services/call/callStore";
import { Vo3dCallBar } from "./Vo3dCallBar";

// PHASE 7D. The bar's whole job is REACHABILITY: a call you are in must be mutable and leavable from
// anywhere in the V2 world. These tests pin the four decisions it actually makes — is there a call worth
// showing, whose call is it, are the controls already on screen somewhere else, and can the viewer even
// click right now — and nothing about the controls themselves, which are V1's own component with its own
// tests beside it.

const resumeAudioPlayback = vi.fn();
let snapshot: CallSnapshot;

vi.mock("../../../services/call/callStore", async () => {
  const actual = await vi.importActual<typeof import("../../../services/call/callStore")>(
    "../../../services/call/callStore",
  );
  return {
    ...actual,
    useCallState: () => snapshot,
    resumeAudioPlayback: (...a: unknown[]) => resumeAudioPlayback(...a),
    setMicEnabled: vi.fn(),
    setCameraEnabled: vi.fn(),
    setScreenShareEnabled: vi.fn(),
    leaveCall: vi.fn(),
    startOrJoinCall: vi.fn(),
  };
});

const SELF = "bon@offshorly.com";
const PEER = "alex@offshorly.com";

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

function setLocked(locked: boolean): void {
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    get: () => (locked ? document.body : null),
  });
}

function renderBar(over: { controlsShownElsewhere?: boolean } = {}) {
  return render(
    <Vo3dCallBar
      selfId={SELF}
      resolveDisplayName={(email) => (email === PEER ? "Alex" : email)}
      onExpand={() => {}}
      controlsShownElsewhere={over.controlsShownElsewhere ?? false}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setLocked(false);
  snapshot = snap();
});

describe("Vo3dCallBar", () => {
  it("shows nothing when there is no call", () => {
    renderBar();
    expect(screen.queryByTestId("vo3d-call-bar")).toBeNull();
  });

  it("shows nothing for a meeting or board-voice connection — those have their own controls", () => {
    snapshot = snap({ status: "connected", connectedMeetingId: "cave-all-hands" });
    renderBar();
    expect(screen.queryByTestId("vo3d-call-bar")).toBeNull();

    snapshot = snap({ status: "connected", connectedBoardId: "board-1" });
    renderBar();
    expect(screen.queryByTestId("vo3d-call-bar")).toBeNull();
  });

  it("names the other person from LIVE room membership, self excluded", () => {
    snapshot = snap({
      status: "connected",
      connectedSessionId: "sess-1",
      participants: [PEER, SELF],
    });
    renderBar();
    expect(screen.getByTestId("vo3d-call-bar")).toHaveAttribute("data-status", "connected");
    expect(screen.getByTestId("vo3d-call-bar-who")).toHaveTextContent("Alex");
  });

  it("falls back to the server broadcast while the handshake is still running", () => {
    snapshot = snap({
      status: "connecting",
      connectedSessionId: "sess-1",
      calls: [{ sessionId: "sess-1", room: "r", participants: [PEER] }],
    });
    renderBar();
    expect(screen.getByTestId("vo3d-call-bar-who")).toHaveTextContent("Alex");
  });

  it("offers the mic/leave controls, and stands down when the chat header already has them", () => {
    snapshot = snap({ status: "connected", connectedSessionId: "sess-1", participants: [SELF, PEER] });
    const { unmount } = renderBar();
    expect(screen.getByLabelText("Leave call")).toBeInTheDocument();
    unmount();

    renderBar({ controlsShownElsewhere: true });
    // Still on screen — it is the call's status readout — but not a second copy of the buttons.
    expect(screen.getByTestId("vo3d-call-bar")).toBeInTheDocument();
    expect(screen.queryByLabelText("Leave call")).toBeNull();
  });

  it("offers V1's own audio unblock when the browser refused autoplay", () => {
    snapshot = snap({
      status: "connected",
      connectedSessionId: "sess-1",
      participants: [SELF, PEER],
      audioPlaybackBlocked: true,
    });
    renderBar();
    screen.getByTestId("vo3d-call-bar-unblock").click();
    expect(resumeAudioPlayback).toHaveBeenCalled();
  });

  it("tells a pointer-locked player which key gets the mouse back", () => {
    setLocked(true);
    snapshot = snap({ status: "connected", connectedSessionId: "sess-1", participants: [SELF, PEER] });
    renderBar();
    expect(screen.getByText("Press Esc for controls")).toBeInTheDocument();
  });
});
