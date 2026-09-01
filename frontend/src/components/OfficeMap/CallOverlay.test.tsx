import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSnapshot, SpatialVideoTrack } from "../../services/call/callStore";
import { CallOverlay } from "./CallOverlay";

// Stage C. The overlay attaches a SECOND element to tracks the spatial tiles are already using,
// so the thing that matters most here is that cleanup detaches ITS OWN element and never calls
// the no-argument detach() — that one would rip the spatial tile off the same track.

const leaveCall = vi.fn();
const setMicEnabled = vi.fn();
const setCameraEnabled = vi.fn();
const startOrJoinCall = vi.fn();

let snapshot: CallSnapshot;

vi.mock("../../services/call/callStore", () => ({
  useCallState: () => snapshot,
  callParticipantsFor: (snap: CallSnapshot, sessionId: string | null) =>
    sessionId ? snap.calls.find((c) => c.sessionId === sessionId)?.participants ?? [] : [],
  leaveCall: (...a: unknown[]) => leaveCall(...a),
  setMicEnabled: (...a: unknown[]) => setMicEnabled(...a),
  setCameraEnabled: (...a: unknown[]) => setCameraEnabled(...a),
  startOrJoinCall: (...a: unknown[]) => startOrJoinCall(...a),
}));

/** Minimal stand-in for a LiveKit video track, mirroring SpatialVideoTile.test.tsx's helper. */
function fakeTrack() {
  const attached: HTMLElement[] = [];
  /** Records the ARGUMENT, so a no-argument detach() shows up as `undefined`. */
  const detachedArgs: (HTMLElement | undefined)[] = [];
  return {
    attached,
    detachedArgs,
    attach(el: HTMLElement) {
      attached.push(el);
      return el;
    },
    detach(el?: HTMLElement) {
      detachedArgs.push(el);
      return el;
    },
  };
}
const asTrack = (t: ReturnType<typeof fakeTrack>) => t as unknown as SpatialVideoTrack;

const SELF = "self@example.com";
const PEER = "peer@example.com";

function makeSnapshot(over: Partial<CallSnapshot> = {}): CallSnapshot {
  return {
    status: "connected",
    connectedSessionId: "sess-1",
    micEnabled: true,
    cameraEnabled: true,
    cameraError: null,
    error: null,
    calls: [{ sessionId: "sess-1", room: "r", participants: [SELF, PEER] }],
    outgoing: null,
    incoming: null,
    inviteOutcome: null,
    acceptedPeerEmail: null,
    audioPlaybackBlocked: false,
    videoByIdentity: {},
    ...over,
  };
}

function renderOverlay(props: Partial<Parameters<typeof CallOverlay>[0]> = {}) {
  return render(
    <CallOverlay
      expanded
      onMinimize={props.onMinimize ?? (() => {})}
      resolveDisplayName={props.resolveDisplayName ?? ((e) => `Name<${e}>`)}
      selfIdentity={props.selfIdentity ?? SELF}
      {...props}
    />,
  );
}

const videos = (c: HTMLElement) => Array.from(c.querySelectorAll("video"));

beforeEach(() => {
  snapshot = makeSnapshot();
  leaveCall.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CallOverlay", () => {
  it("renders nothing when not expanded", () => {
    const { container } = renderOverlay({ expanded: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the call is not connected", () => {
    snapshot = makeSnapshot({ status: "connecting" });
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with no connected session", () => {
    snapshot = makeSnapshot({ connectedSessionId: null });
    const { container } = renderOverlay();
    expect(container).toBeEmptyDOMElement();
  });

  it("attaches each live track to exactly one element", () => {
    const self = fakeTrack();
    const peer = fakeTrack();
    snapshot = makeSnapshot({
      videoByIdentity: { [SELF]: asTrack(self), [PEER]: asTrack(peer) },
    });
    const { container } = renderOverlay();
    expect(videos(container)).toHaveLength(2);
    expect(self.attached).toHaveLength(1);
    expect(peer.attached).toHaveLength(1);
    expect(self.attached[0]).toBeInstanceOf(HTMLVideoElement);
  });

  it("detaches WITH its own element on unmount and never calls the no-arg detach", () => {
    const peer = fakeTrack();
    snapshot = makeSnapshot({ videoByIdentity: { [PEER]: asTrack(peer) } });
    const { unmount } = renderOverlay();
    const el = peer.attached[0];
    unmount();
    expect(peer.detachedArgs).toEqual([el]);
    expect(peer.detachedArgs).not.toContain(undefined);
    expect((el as HTMLVideoElement).srcObject).toBeNull();
  });

  it("detaches the old track before attaching a replacement", () => {
    const first = fakeTrack();
    snapshot = makeSnapshot({ videoByIdentity: { [PEER]: asTrack(first) } });
    const { rerender } = renderOverlay();
    const second = fakeTrack();
    snapshot = makeSnapshot({ videoByIdentity: { [PEER]: asTrack(second) } });
    rerender(
      <CallOverlay
        expanded
        onMinimize={() => {}}
        resolveDisplayName={(e) => `Name<${e}>`}
        selfIdentity={SELF}
      />,
    );
    expect(first.detachedArgs).toEqual([first.attached[0]]);
    expect(second.attached).toHaveLength(1);
  });

  it("renders a named placeholder and NO video for a camera-off participant", () => {
    const self = fakeTrack();
    snapshot = makeSnapshot({ videoByIdentity: { [SELF]: asTrack(self) } });
    const { container } = renderOverlay();
    expect(videos(container)).toHaveLength(1);
    expect(container.querySelectorAll('[data-camera="off"]')).toHaveLength(1);
    expect(screen.getByText(`Name<${PEER}>`)).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("keeps overlay video elements muted and inline", () => {
    snapshot = makeSnapshot({ videoByIdentity: { [PEER]: asTrack(fakeTrack()) } });
    const { container } = renderOverlay();
    const v = videos(container)[0];
    expect(v.muted).toBe(true);
    expect(v.playsInline).toBe(true);
    expect(v.autoplay).toBe(true);
  });

  it("includes self even when the server broadcast has not listed them yet", () => {
    snapshot = makeSnapshot({
      calls: [{ sessionId: "sess-1", room: "r", participants: [PEER] }],
    });
    const { container } = renderOverlay();
    expect(container.querySelectorAll('[data-camera="off"]')).toHaveLength(2);
    expect(screen.getByText("You")).toBeTruthy();
  });

  it("minimize button and Escape both close WITHOUT leaving the call", () => {
    const onMinimize = vi.fn();
    renderOverlay({ onMinimize });
    fireEvent.click(screen.getByLabelText("Minimize call"));
    expect(onMinimize).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onMinimize).toHaveBeenCalledTimes(2);
    expect(leaveCall).not.toHaveBeenCalled();
  });

  it("lays out one tile per participant (1:1 and the 3+ fallback)", () => {
    const grid = () => screen.getByTestId("call-overlay-grid");
    const { unmount } = renderOverlay();
    expect(grid().getAttribute("data-participant-count")).toBe("2");
    expect(grid().children).toHaveLength(2);
    unmount();

    snapshot = makeSnapshot({
      calls: [
        { sessionId: "sess-1", room: "r", participants: [SELF, PEER, "third@example.com"] },
      ],
    });
    renderOverlay();
    expect(grid().getAttribute("data-participant-count")).toBe("3");
    expect(grid().children).toHaveLength(3);
  });

  it("mounts the existing call controls rather than reimplementing them", () => {
    renderOverlay();
    expect(screen.getByLabelText("Mute microphone")).toBeTruthy();
    expect(screen.getByLabelText("Turn camera off")).toBeTruthy();
    expect(screen.getByLabelText("Leave call")).toBeTruthy();
    // The overlay's own footer instance gets no onExpand, so it shows no Expand button.
    expect(screen.queryByLabelText("Expand call")).toBeNull();
  });
});
