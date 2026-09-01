import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallSnapshot } from "../../services/call/callStore";
import { CallInvitePrompt } from "./CallInvitePrompt";

// This component is mounted at OfficeMap's top level, NOT inside the Spatial Chat panel — nothing
// here reads chat state, which is what lets an incoming call reach a recipient with chat closed.

const accept = vi.fn();
const decline = vi.fn();
const cancel = vi.fn();
const dismiss = vi.fn();
let snapshot: CallSnapshot;

vi.mock("../../services/call/callStore", async () => {
  const actual = await vi.importActual<typeof import("../../services/call/callStore")>(
    "../../services/call/callStore",
  );
  return {
    ...actual,
    useCallState: () => snapshot,
    acceptCallInvite: (...a: unknown[]) => accept(...a),
    declineCallInvite: (...a: unknown[]) => decline(...a),
    cancelCallInvite: (...a: unknown[]) => cancel(...a),
    dismissInviteOutcome: (...a: unknown[]) => dismiss(...a),
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
    audioPlaybackBlocked: false,
    ...over,
  };
}

const names: Record<string, string> = {
  "bon@example.com": "Bon",
  "angelo@example.com": "Angelo",
};
const resolveDisplayName = (email: string) => names[email] ?? email;

function renderPrompt() {
  return render(<CallInvitePrompt resolveDisplayName={resolveDisplayName} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  snapshot = snap();
});

describe("CallInvitePrompt", () => {
  it("renders nothing when there is no ring", () => {
    const { container } = renderPrompt();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the incoming prompt with the caller's name and both actions", () => {
    snapshot = snap({
      incoming: { inviteId: "i1", fromEmail: "bon@example.com", toEmail: "angelo@example.com" },
    });
    renderPrompt();
    expect(screen.getByText(/is calling/)).toBeInTheDocument();
    expect(screen.getByText("Bon")).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Decline")).toBeInTheDocument();
  });

  it("Accept and Decline dispatch to the store", () => {
    snapshot = snap({
      incoming: { inviteId: "i1", fromEmail: "bon@example.com", toEmail: "angelo@example.com" },
    });
    renderPrompt();
    screen.getByText("Accept").click();
    expect(accept).toHaveBeenCalledTimes(1);
    screen.getByText("Decline").click();
    expect(decline).toHaveBeenCalledTimes(1);
  });

  it("shows the outgoing Calling state with Cancel", () => {
    snapshot = snap({
      outgoing: { inviteId: "i2", fromEmail: "bon@example.com", toEmail: "angelo@example.com" },
    });
    renderPrompt();
    expect(screen.getByText(/Calling/)).toBeInTheDocument();
    expect(screen.getByText("Angelo")).toBeInTheDocument();
    screen.getByText("Cancel").click();
    expect(cancel).toHaveBeenCalledTimes(1);
    // No Accept/Decline on the caller's side.
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
  });

  it("an incoming ring takes precedence over a stale outcome banner", () => {
    snapshot = snap({
      incoming: { inviteId: "i1", fromEmail: "bon@example.com", toEmail: "angelo@example.com" },
      inviteOutcome: { kind: "declined", peerEmail: "angelo@example.com", reason: null },
    });
    renderPrompt();
    expect(screen.getByText(/is calling/)).toBeInTheDocument();
  });

  it.each([
    ["declined", null, /declined the call/],
    ["timeout", null, /didn't answer/],
    ["cancelled", null, /Call cancelled/],
    ["failed", "offline", /is offline/],
    ["failed", "dnd", /Do Not Disturb/],
    ["failed", "busy", /already in a call/],
  ] as const)("reports the %s outcome (%s)", (kind, reason, pattern) => {
    snapshot = snap({
      inviteOutcome: { kind, peerEmail: "angelo@example.com", reason },
    });
    renderPrompt();
    expect(screen.getByText(pattern)).toBeInTheDocument();
    screen.getByText("Dismiss").click();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw email when no display name is known", () => {
    snapshot = snap({
      incoming: { inviteId: "i1", fromEmail: "stranger@example.com", toEmail: "a@example.com" },
    });
    renderPrompt();
    expect(screen.getByText("stranger@example.com")).toBeInTheDocument();
  });

  it("shows no ringing UI while a call is merely active (that is the Join path's job)", () => {
    snapshot = snap({
      calls: [{ sessionId: "conv-1", room: "vo-call-x", participants: ["bon@example.com"] }],
    });
    const { container } = renderPrompt();
    expect(container).toBeEmptyDOMElement();
  });
});
