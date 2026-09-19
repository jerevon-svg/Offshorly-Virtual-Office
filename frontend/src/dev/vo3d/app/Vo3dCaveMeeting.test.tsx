// PHASE 7C — the Cave meeting entry point.
//
// What is asserted is the WIRING and the HONESTY: every button reaches the world's caveMeeting bridge
// (which is CaveLiveShare, which is V1's call store), the controls exist only once a meeting is actually
// connected, and nothing is on screen that is not backed by one of those calls.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dCaveMeeting } from "./Vo3dCaveMeeting";
import type { Vo3dCaveMeetingState, Vo3dWorld } from "./world";

const SELF = "bon@offshorly.com";

const base: Vo3dCaveMeetingState = {
  inside: false, status: "off", session: "", kind: "—",
  mic: false, camera: false, sharing: false, cameras: 0, presenter: "", note: "",
};

let state: Vo3dCaveMeetingState = base;
let listener: ((s: Vo3dCaveMeetingState) => void) | null = null;
const start = vi.fn(async (_email: string) => {});
const setMic = vi.fn(async (_on: boolean) => {});
const setCamera = vi.fn(async (_on: boolean) => {});
const setSharing = vi.fn(async (_on: boolean) => {});
const leave = vi.fn();

const world = {
  caveMeeting: {
    subscribe: (cb: (s: Vo3dCaveMeetingState) => void) => {
      listener = cb;
      cb(state);
      return () => { listener = null; };
    },
    start, setMic, setCamera, setSharing, leave,
  },
} as unknown as Vo3dWorld;
const worldRef = { current: world };

function push(next: Partial<Vo3dCaveMeetingState>) {
  state = { ...state, ...next };
  act(() => listener?.(state));
}

beforeEach(() => {
  state = base;
  listener = null;
  vi.clearAllMocks();
});

const mount = () => render(<Vo3dCaveMeeting worldRef={worldRef} ready selfId={SELF} />);

describe("where it appears", () => {
  it("offers nothing anywhere but inside the Cave", () => {
    mount();
    expect(screen.queryByTestId("vo3d-cave-meeting")).toBeNull();
  });

  it("appears on the way in and goes on its own on the way out", () => {
    mount();
    push({ inside: true });
    expect(screen.getByTestId("vo3d-cave-meeting")).toBeInTheDocument();
    push({ inside: false });
    expect(screen.queryByTestId("vo3d-cave-meeting")).toBeNull();
  });
});

describe("before a meeting is connected", () => {
  it("offers ONE entry point, and no media controls at all", () => {
    mount();
    push({ inside: true });
    expect(screen.getByTestId("cave-meeting-start")).toBeInTheDocument();
    // A mic button before there is a room to speak into would be a button that does nothing.
    for (const id of ["cave-meeting-mic", "cave-meeting-camera", "cave-meeting-share", "cave-meeting-leave"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it("joins as the signed-in employee, through the world's own bridge", async () => {
    mount();
    push({ inside: true });
    fireEvent.click(screen.getByTestId("cave-meeting-start"));
    await waitFor(() => expect(start).toHaveBeenCalledWith(SELF));
  });

  it("says it is connecting rather than looking idle", () => {
    mount();
    push({ inside: true, status: "connecting" });
    expect(screen.getByTestId("cave-meeting-start")).toBeDisabled();
    expect(screen.getByTestId("vo3d-cave-meeting")).toHaveTextContent(/connecting/i);
  });
});

describe("once the meeting is connected", () => {
  beforeEach(() => {
    mount();
    push({ inside: true, status: "connected", session: "cave-all-hands", kind: "meeting" });
  });

  it("replaces the entry point with the real controls", () => {
    expect(screen.queryByTestId("cave-meeting-start")).toBeNull();
    for (const id of ["cave-meeting-mic", "cave-meeting-camera", "cave-meeting-share", "cave-meeting-leave"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("drives mic, camera, screen share and leave through the call store's own calls", async () => {
    fireEvent.click(screen.getByTestId("cave-meeting-mic"));
    await waitFor(() => expect(setMic).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByTestId("cave-meeting-camera"));
    await waitFor(() => expect(setCamera).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByTestId("cave-meeting-share"));
    await waitFor(() => expect(setSharing).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByTestId("cave-meeting-leave"));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
  });

  it("reflects the store's real publication state rather than its own optimism", () => {
    push({ mic: true });
    expect(screen.getByTestId("cave-meeting-mic")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("cave-meeting-mic")).toHaveTextContent(/Mic on/);
    // A refusal the store reported (no device, permission denied) is shown, not swallowed.
    push({ camera: false, note: "Camera permission denied" });
    expect(screen.getByTestId("cave-meeting-note")).toHaveTextContent("Camera permission denied");
    expect(screen.getByTestId("cave-meeting-camera")).toHaveAttribute("aria-pressed", "false");
  });

  it("names who is sharing, and says so differently when it is you", () => {
    push({ presenter: "alex@offshorly.com" });
    expect(screen.getByTestId("cave-meeting-presenter")).toHaveTextContent("alex@offshorly.com is sharing");
    push({ sharing: true, presenter: SELF });
    expect(screen.getByTestId("cave-meeting-presenter")).toHaveTextContent("You are sharing");
  });

  it("counts cameras only when there are real ones", () => {
    expect(screen.getByTestId("vo3d-cave-meeting")).toHaveTextContent("In the meeting");
    push({ cameras: 2 });
    expect(screen.getByTestId("vo3d-cave-meeting")).toHaveTextContent("2 cameras on");
  });
});

describe("what is deliberately not here", () => {
  it("offers no Invite — there is no meeting-invite service to back one", () => {
    mount();
    push({ inside: true, status: "connected" });
    expect(screen.queryByRole("button", { name: /invite/i })).toBeNull();
  });
});
