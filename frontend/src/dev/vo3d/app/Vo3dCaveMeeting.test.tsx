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
  mic: false, camera: false, sharing: false, cameras: 0, people: 0, live: false, host: "", isHost: false, presenter: "", note: "",
};

let state: Vo3dCaveMeetingState = base;
let listener: ((s: Vo3dCaveMeetingState) => void) | null = null;
const start = vi.fn(async (_email: string) => {});
const setMic = vi.fn(async (_on: boolean) => {});
const setCamera = vi.fn(async (_on: boolean) => {});
const setSharing = vi.fn(async (_on: boolean) => {});
const leave = vi.fn();
const invite = vi.fn((_email: string) => {});
// PHASE 7D: watching the meeting on entry. Media-free by contract — these tests assert it is called,
// and that nothing else is, when somebody merely walks in.
const observe = vi.fn(async (_email: string) => {});

const world = {
  caveMeeting: {
    subscribe: (cb: (s: Vo3dCaveMeetingState) => void) => {
      listener = cb;
      cb(state);
      return () => { listener = null; };
    },
    start, setMic, setCamera, setSharing, leave, invite, observe,
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

const onInvite = vi.fn();
const mount = () => render(<Vo3dCaveMeeting worldRef={worldRef} ready selfId={SELF} />);
/** The panel as the HUD actually mounts it — with somewhere for the picker to open. */
const mountWithInvite = () =>
  render(<Vo3dCaveMeeting worldRef={worldRef} ready selfId={SELF} onInvite={onInvite} />);

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
    push({ people: 2, cameras: 2 });
    expect(screen.getByTestId("vo3d-cave-meeting")).toHaveTextContent("2 cameras on");
  });

  // PHASE 7D. The head-count is LiveKit's own room membership, so it can only be said AFTER joining —
  // which is exactly why it is said there and nowhere earlier.
  it("says plainly when nobody else has joined yet", () => {
    push({ people: 1 });
    expect(screen.getByTestId("cave-meeting-sub")).toHaveTextContent("you're the only one here");
  });

  it("counts the people in the room once they are in it", () => {
    push({ people: 3 });
    expect(screen.getByTestId("cave-meeting-sub")).toHaveTextContent("3 people");
    push({ people: 3, cameras: 1 });
    expect(screen.getByTestId("cave-meeting-sub")).toHaveTextContent("3 people · 1 camera on");
  });

  it("says nothing about the head-count before the room is joined", () => {
    push({ status: "connecting", people: 0 });
    expect(screen.getByTestId("cave-meeting-sub")).toHaveTextContent("Connecting…");
  });
});

// PHASE 7D — INVITING SOMEBODY INTO THE MEETING.
//
// The row exists only when both halves are real: this viewer is IN the meeting (you cannot invite
// anybody into a room you have not joined, and the server refuses it), and something can host the
// picker. The panel itself neither owns the roster nor sends the invitation — see its prop note.
describe("Invite", () => {
  it("is offered once you are in the meeting", () => {
    mountWithInvite();
    push({ inside: true, status: "connected", live: true, host: SELF, isHost: true, people: 1 });
    expect(screen.getByTestId("cave-meeting-invite")).toBeInTheDocument();
  });

  it("is not offered before you have joined — there is no room to invite anybody into yet", () => {
    mountWithInvite();
    push({ inside: true, status: "off", live: false });
    expect(screen.queryByTestId("cave-meeting-invite")).toBeNull();
    push({ inside: true, status: "off", live: true, host: "angelo@offshorly.com" });
    expect(screen.queryByTestId("cave-meeting-invite")).toBeNull();
  });

  it("asks the host to open the picker, and sends nothing itself", () => {
    mountWithInvite();
    push({ inside: true, status: "connected", live: true, host: SELF, isHost: true, people: 1 });
    fireEvent.click(screen.getByTestId("cave-meeting-invite"));
    expect(onInvite).toHaveBeenCalledTimes(1);
    // Not this panel's job: it opens a picker, it does not choose or invite anybody.
    expect(invite).not.toHaveBeenCalled();
  });

  it("shows no Invite at all where nothing can host a picker", () => {
    mount();
    push({ inside: true, status: "connected", live: true, host: SELF, isHost: true, people: 1 });
    expect(screen.queryByTestId("cave-meeting-invite")).toBeNull();
  });

  it("is a guest's row too — any participant may invite, not only the host", () => {
    mountWithInvite();
    push({
      inside: true, status: "connected", live: true,
      host: "angelo@offshorly.com", isHost: false, people: 2,
    });
    expect(screen.getByTestId("cave-meeting-invite")).toBeInTheDocument();
  });
});


// PHASE 7D — START VERSUS JOIN, AND WHO HOSTS.
//
// The distinction being pinned is which SOURCE answers which question. `live`/`host` come from the
// SERVER's meeting_presence broadcast and exist before this client has joined anything, so they decide
// the button. `people` is LiveKit's own membership and only exists once you are in, so it can only ever
// describe a meeting you are already in. A panel that used one for the other would be wrong exactly
// when it matters: on the way in.
describe("Start versus Join", () => {
  beforeEach(() => {
    mount();
  });

  it("offers Start when the Cave is empty", () => {
    push({ inside: true, status: "off", live: false });
    expect(screen.getByTestId("cave-meeting-start")).toHaveTextContent("Start meeting");
    expect(screen.getByTestId("cave-meeting-sub")).toHaveTextContent("No meeting yet");
  });

  it("offers Join, and says who is hosting, when one is already running", () => {
    push({ inside: true, status: "off", live: true, host: "angelo@offshorly.com" });
    expect(screen.getByTestId("cave-meeting-start")).toHaveTextContent("Join meeting");
    expect(screen.getByTestId("cave-meeting-sub")).toHaveTextContent("Angelo is hosting");
  });

  it("says it is YOUR meeting when the server names you as host", () => {
    push({ inside: true, status: "off", live: true, host: SELF });
    expect(screen.getByTestId("cave-meeting-sub")).toHaveTextContent("Your meeting is running");
  });

  it("names the host once connected, and marks it when it is you", () => {
    push({ inside: true, status: "connected", live: true, host: "angelo@offshorly.com", people: 2 });
    expect(screen.getByTestId("cave-meeting-host")).toHaveTextContent("Angelo is hosting");
    push({ inside: true, status: "connected", live: true, host: SELF, isHost: true, people: 2 });
    expect(screen.getByTestId("cave-meeting-host")).toHaveTextContent("You are hosting");
  });

  it("goes back to Start the moment the meeting ends under it", () => {
    push({ inside: true, status: "connected", live: true, host: SELF, isHost: true, people: 1 });
    expect(screen.queryByTestId("cave-meeting-start")).toBeNull();
    // Everybody left: the server stops broadcasting the meeting and this client is no longer connected.
    push({ inside: true, status: "off", live: false, host: "", isHost: false, people: 0 });
    expect(screen.getByTestId("cave-meeting-start")).toHaveTextContent("Start meeting");
  });

  it("still starts nothing on its own — entering the Cave only ever OFFERS a button", () => {
    push({ inside: true, status: "off", live: false });
    expect(start).not.toHaveBeenCalled();
    expect(screen.queryByTestId("cave-meeting-leave")).toBeNull();
  });
});


describe("walking into the Cave", () => {
  it("starts WATCHING the meeting and nothing else — no start, no media", async () => {
    mount();
    push({ inside: true });
    await waitFor(() => expect(observe).toHaveBeenCalledWith(SELF));
    expect(start).not.toHaveBeenCalled();
    expect(setMic).not.toHaveBeenCalled();
    expect(setCamera).not.toHaveBeenCalled();
    expect(setSharing).not.toHaveBeenCalled();
  });

  it("watches nothing while outside the Cave", () => {
    mount();
    push({ inside: false });
    expect(observe).not.toHaveBeenCalled();
  });
});
