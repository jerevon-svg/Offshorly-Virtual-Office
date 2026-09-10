import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSnapshot } from "../../services/call/callStore";
import { SpatialCallControls } from "./SpatialCallControls";

// STARTING a call lives in the character action menu ("Call" -> OfficeMap's handleChoose), so no
// Start button appears here. JOINING an already-running call does live here: it is the UI consumer
// of the spatial_calls state that previously had none, which is why a second participant could not
// discover a call in progress. With no call and no connection, this renders nothing, keeping the
// compact chat header at its original layout.

const leaveCall = vi.fn();
const setMicEnabled = vi.fn();
const setCameraEnabled = vi.fn();
const startOrJoinCall = vi.fn();
let snapshot: CallSnapshot;

vi.mock("../../services/call/callStore", async () => {
  const actual = await vi.importActual<typeof import("../../services/call/callStore")>(
    "../../services/call/callStore",
  );
  return {
    ...actual,
    useCallState: () => snapshot,
    leaveCall: (...a: unknown[]) => leaveCall(...a),
    setMicEnabled: (...a: unknown[]) => setMicEnabled(...a),
    setCameraEnabled: (...a: unknown[]) => setCameraEnabled(...a),
    startOrJoinCall: (...a: unknown[]) => startOrJoinCall(...a),
  };
});

function snap(over: Partial<CallSnapshot> = {}): CallSnapshot {
  return {
    status: "idle",
    connectedSessionId: null,
    micEnabled: false,
    cameraEnabled: false,
    cameraError: null,
    videoByIdentity: {},
    error: null,
    calls: [],
    outgoing: null,
    incoming: null,
    inviteOutcome: null,
    acceptedPeerEmail: null,
    connectedBoardId: null,
    boardError: null,
    audioPlaybackBlocked: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  snapshot = snap();
});

describe("SpatialCallControls", () => {
  it("offers exactly Phone + Video in a spatial conversation with no call yet", () => {
    render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.getByLabelText("Start voice call")).toBeInTheDocument();
    expect(screen.getByLabelText("Start video call")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    // No in-call transport controls until a call is actually running.
    expect(screen.queryByLabelText("Leave call")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mute microphone")).not.toBeInTheDocument();
  });

  it("gives Phone and Video the same plain button treatment — no accent tile by default", async () => {
    const styles = (await import("./SpatialCallControls.module.css")).default;
    render(<SpatialCallControls sessionId="conv-1" />);
    const phone = screen.getByLabelText("Start voice call");
    const video = screen.getByLabelText("Start video call");

    // Same base class, same size; the phone carries no filled/accent state of its own.
    for (const button of [phone, video]) {
      expect(button.className).toContain(styles.iconButton);
      expect(button.className).not.toContain(styles.muted);
      expect(button.className).not.toContain(styles.cameraOn);
    }
    // No "Join" pill text either — both read as icon-only header actions.
    expect(phone.textContent?.trim()).toBe("");
    expect(video.textContent?.trim()).toBe("");
  });

  it("fills the camera button ONLY while the camera is genuinely on", async () => {
    const styles = (await import("./SpatialCallControls.module.css")).default;
    snapshot = snap({ status: "connected", connectedSessionId: "conv-1", micEnabled: true });
    const { unmount } = render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.getByLabelText("Turn camera on").className).not.toContain(styles.cameraOn);
    unmount();

    snapshot = snap({
      status: "connected",
      connectedSessionId: "conv-1",
      micEnabled: true,
      cameraEnabled: true,
    });
    render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.getByLabelText("Turn camera off").className).toContain(styles.cameraOn);
  });

  it("routes Phone and Video through the EXISTING spatial call lifecycle", () => {
    render(<SpatialCallControls sessionId="conv-1" />);
    screen.getByLabelText("Start voice call").click();
    expect(startOrJoinCall).toHaveBeenCalledWith("conv-1");
    screen.getByLabelText("Start video call").click();
    expect(startOrJoinCall).toHaveBeenCalledTimes(2);
    expect(startOrJoinCall).toHaveBeenLastCalledWith("conv-1");
  });

  it("never renders a Start call button — starting stays in the character menu", () => {
    snapshot = snap();
    render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.queryByLabelText("Start call")).not.toBeInTheDocument();
  });

  it("offers Join call when a call is live in THIS session and the viewer is not connected", () => {
    snapshot = snap({
      calls: [{ sessionId: "conv-1", room: "vo-call-x", participants: ["b@example.com"] }],
    });
    render(<SpatialCallControls sessionId="conv-1" />);

    expect(screen.getByLabelText("Join call")).toBeInTheDocument();
    // Join (phone) plus the video entry — and nothing from the in-call set.
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByLabelText("Leave call")).not.toBeInTheDocument();
  });

  it("clicking Join invokes startOrJoinCall with this session id", () => {
    snapshot = snap({
      calls: [{ sessionId: "conv-1", room: "vo-call-x", participants: ["b@example.com"] }],
    });
    render(<SpatialCallControls sessionId="conv-1" />);

    screen.getByLabelText("Join call").click();

    expect(startOrJoinCall).toHaveBeenCalledWith("conv-1");
    expect(startOrJoinCall).toHaveBeenCalledTimes(1);
  });

  it("does not offer Join for a call running in a DIFFERENT session", () => {
    snapshot = snap({
      calls: [{ sessionId: "conv-other", room: "vo-call-y", participants: ["z@example.com"] }],
    });
    render(<SpatialCallControls sessionId="conv-1" />);
    // Someone else's call is not joinable from here: this session's phone still reads as Start.
    expect(screen.queryByLabelText("Join call")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Start voice call")).toBeInTheDocument();
  });

  it("renders nothing until the spatial conversation id has resolved", () => {
    snapshot = snap({ status: "connected", connectedSessionId: "conv-1", micEnabled: true });
    const { container } = render(<SpatialCallControls sessionId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Phone and Video while the viewer is connected to a DIFFERENT session", () => {
    snapshot = snap({ status: "connected", connectedSessionId: "conv-other", micEnabled: true });
    render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.getByLabelText("Start voice call")).toBeDisabled();
    expect(screen.getByLabelText("Start video call")).toBeDisabled();
  });

  it("clears the mocks between renders so click assertions stay isolated", () => {
    expect(startOrJoinCall).not.toHaveBeenCalled();
  });

  it("shows exactly three compact controls while connected: mute, camera and leave", () => {
    // Was two in Stage A; Stage B adds the camera between them. Still icon-only, so the compact
    // chat header keeps its width.
    snapshot = snap({ status: "connected", connectedSessionId: "conv-1", micEnabled: true });
    render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.getByLabelText("Mute microphone")).toBeInTheDocument();
    expect(screen.getByLabelText("Turn camera on")).toBeInTheDocument();
    expect(screen.getByLabelText("Leave call")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    // No duplicate affordance once connected.
    expect(screen.queryByLabelText("Join call")).not.toBeInTheDocument();
  });

  it("shows Unmute when the microphone is muted", () => {
    snapshot = snap({ status: "connected", connectedSessionId: "conv-1", micEnabled: false });
    render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.getByLabelText("Unmute microphone")).toBeInTheDocument();
  });

  it("shows a Connecting indicator during this session's handshake", () => {
    snapshot = snap({ status: "connecting", connectedSessionId: "conv-1" });
    render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("keeps the call entries offered after an error (the failure is surfaced as a toast)", () => {
    snapshot = snap({ status: "error", error: "Spatial conversation needs at least 2 people" });
    render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.getByLabelText("Start voice call")).toBeEnabled();
    expect(screen.queryByText(/at least 2 people/)).not.toBeInTheDocument();
  });

  it("wires mute and leave to the store", () => {
    snapshot = snap({ status: "connected", connectedSessionId: "conv-1", micEnabled: true });
    render(<SpatialCallControls sessionId="conv-1" />);

    screen.getByLabelText("Mute microphone").click();
    expect(setMicEnabled).toHaveBeenCalledWith(false);

    screen.getByLabelText("Leave call").click();
    expect(leaveCall).toHaveBeenCalled();
  });
});

// --- Stage B camera control -------------------------------------------------------------------

describe("SpatialCallControls camera", () => {
  const connected = () =>
    snap({ status: "connected", connectedSessionId: "conv-1", micEnabled: true });

  it("offers the camera only while connected, never in the Join state", () => {
    snapshot = snap({
      calls: [{ sessionId: "conv-1", room: "vo-call-x", participants: ["b@example.com"] }],
    });
    render(<SpatialCallControls sessionId="conv-1" />);

    expect(screen.queryByLabelText("Turn camera on")).not.toBeInTheDocument();
  });

  it("offers the camera only while connected, never in the Connecting state", () => {
    snapshot = snap({ status: "connecting", connectedSessionId: "conv-1" });
    render(<SpatialCallControls sessionId="conv-1" />);

    expect(screen.queryByLabelText("Turn camera on")).not.toBeInTheDocument();
  });

  it("shows mic, camera and leave in that order once connected", () => {
    snapshot = connected();
    render(<SpatialCallControls sessionId="conv-1" />);

    expect(
      screen.getAllByRole("button").map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Mute microphone", "Turn camera on", "Leave call"]);
  });

  it("defaults to camera off — the call never turns it on by itself", () => {
    snapshot = connected();
    render(<SpatialCallControls sessionId="conv-1" />);

    expect(screen.getByLabelText("Turn camera on")).toBeInTheDocument();
    expect(screen.queryByLabelText("Turn camera off")).not.toBeInTheDocument();
  });

  it("turns the camera on, then off, on click", () => {
    snapshot = connected();
    const { rerender } = render(<SpatialCallControls sessionId="conv-1" />);

    screen.getByLabelText("Turn camera on").click();
    expect(setCameraEnabled).toHaveBeenCalledWith(true);

    snapshot = snap({ ...connected(), cameraEnabled: true });
    rerender(<SpatialCallControls sessionId="conv-1" />);
    screen.getByLabelText("Turn camera off").click();
    expect(setCameraEnabled).toHaveBeenLastCalledWith(false);
  });

  it("surfaces a camera failure without disturbing the other controls", () => {
    snapshot = snap({ ...connected(), cameraError: "Permission denied" });
    render(<SpatialCallControls sessionId="conv-1" />);

    expect(screen.getByLabelText("Turn camera on")).toHaveAttribute("title", "Permission denied");
    // Mute and Leave are untouched by a camera problem.
    expect(screen.getByLabelText("Mute microphone")).toBeInTheDocument();
    expect(screen.getByLabelText("Leave call")).toBeInTheDocument();
  });

  it("shows the Stage C Expand button ONLY when an onExpand handler is given", () => {
    snapshot = connected();
    const { unmount } = render(<SpatialCallControls sessionId="conv-1" />);
    expect(screen.queryByLabelText("Expand call")).toBeNull();
    unmount();

    const onExpand = vi.fn();
    render(<SpatialCallControls sessionId="conv-1" onExpand={onExpand} />);
    screen.getByLabelText("Expand call").click();
    expect(onExpand).toHaveBeenCalledTimes(1);
    // Expanding is UI only — it must never touch the call.
    expect(leaveCall).not.toHaveBeenCalled();
    expect(setMicEnabled).not.toHaveBeenCalled();
    expect(setCameraEnabled).not.toHaveBeenCalled();
    expect(startOrJoinCall).not.toHaveBeenCalled();
  });

  it("leaves mic and leave behaviour exactly as Stage A", () => {
    snapshot = connected();
    render(<SpatialCallControls sessionId="conv-1" />);

    screen.getByLabelText("Mute microphone").click();
    expect(setMicEnabled).toHaveBeenCalledWith(false);
    screen.getByLabelText("Leave call").click();
    expect(leaveCall).toHaveBeenCalledTimes(1);
  });
});
