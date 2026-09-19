// The person-level DND gate, now shared by V1's office and the V2 world. These pin the LIFECYCLE — the
// part that used to live inline in OfficeMap.tsx and that a second copy would have got subtly wrong:
// one-shot accept, decline + cooldown, "they turned DND off while we waited", and supersede.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTalkPermissionGate } from "./useTalkPermissionGate";
import { TalkRequestToast } from "./TalkRequestToast";

const ALEX = "alex@offshorly.com";

let resolvedListeners: ((r: { id: string; state: string }) => void)[] = [];
let cancelledListeners: ((r: { id: string }) => void)[] = [];
const createTalkRequest = vi.fn((_email: string, _kind: string) => Promise.resolve({ id: "req-1" }));
const cancelTalkRequest = vi.fn((_id: string) => Promise.resolve());

vi.mock("../../services/chat/talkRequestsClient", () => ({
  createTalkRequest: (email: string, kind: string) => createTalkRequest(email, kind),
  cancelTalkRequest: (id: string) => cancelTalkRequest(id),
  onTalkRequestResolved: (cb: (r: { id: string; state: string }) => void) => {
    resolvedListeners.push(cb);
    return () => { resolvedListeners = resolvedListeners.filter((l) => l !== cb); };
  },
  onTalkRequestCancelled: (cb: (r: { id: string }) => void) => {
    cancelledListeners.push(cb);
    return () => { cancelledListeners = cancelledListeners.filter((l) => l !== cb); };
  },
  TalkRequestCooldownError: class TalkRequestCooldownError extends Error {
    cooldownUntil: string | null;
    constructor(until: string | null) {
      super("cooldown");
      this.cooldownUntil = until;
    }
  },
}));

/** The mocked error class, read back out of the mock — declaring it at module scope would be hoisted
 *  above vi.mock and referenced before initialisation. */
const { TalkRequestCooldownError: Cooldown } = await import("../../services/chat/talkRequestsClient");

const resume = vi.fn();
let dnd = new Set<string>([ALEX]);
/** The one control surface a caller has, driven from the test the way a menu row drives it. */
let openGate: (() => void) | null = null;
let supersedeWith: ((email: string) => void) | null = null;

function Harness() {
  const gate = useTalkPermissionGate(dnd);
  openGate = () => gate.open({ targetEmail: ALEX, targetName: "Alex", kind: "chat", resume });
  supersedeWith = (email: string) => gate.supersede(email);
  return <TalkRequestToast {...gate.toastProps} />;
}

beforeEach(() => {
  dnd = new Set([ALEX]);
  resolvedListeners = [];
  cancelledListeners = [];
  createTalkRequest.mockReset().mockResolvedValue({ id: "req-1" });
  cancelTalkRequest.mockClear();
  resume.mockClear();
});
afterEach(() => { openGate = null; supersedeWith = null; });

const ask = () => screen.getByRole("button", { name: /request permission to talk/i });

describe("useTalkPermissionGate", () => {
  it("shows nothing until a gate is opened", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /request permission to talk/i })).toBeNull();
  });

  it("sends the request for the gated target and verb", async () => {
    render(<Harness />);
    act(() => openGate!());
    fireEvent.click(ask());
    await waitFor(() => expect(createTalkRequest).toHaveBeenCalledWith(ALEX, "chat"));
  });

  it("resumes the original action exactly once when the request is accepted, then clears", async () => {
    render(<Harness />);
    act(() => openGate!());
    fireEvent.click(ask());
    await waitFor(() => expect(createTalkRequest).toHaveBeenCalled());
    act(() => { for (const l of resolvedListeners) l({ id: "req-1", state: "accepted" }); });
    expect(resume).toHaveBeenCalledTimes(1);
    // consumed: a second resolution of the same id must not resume again
    act(() => { for (const l of resolvedListeners) l({ id: "req-1", state: "accepted" }); });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("does not resume, and says so, when the request is declined", async () => {
    render(<Harness />);
    act(() => openGate!());
    fireEvent.click(ask());
    await waitFor(() => expect(createTalkRequest).toHaveBeenCalled());
    act(() => { for (const l of resolvedListeners) l({ id: "req-1", state: "declined" }); });
    expect(resume).not.toHaveBeenCalled();
    expect(await screen.findByText(/request declined/i)).toBeTruthy();
  });

  it("surfaces the server's cooldown when a new attempt is refused", async () => {
    createTalkRequest.mockRejectedValueOnce(new Cooldown(new Date(Date.now() + 5 * 60_000).toISOString()));
    render(<Harness />);
    act(() => openGate!());
    fireEvent.click(ask());
    expect(await screen.findByText(/try again in 5 min/i)).toBeTruthy();
    expect(resume).not.toHaveBeenCalled();
  });

  it("resumes on cancellation when the target is no longer DND at all", async () => {
    const view = render(<Harness />);
    act(() => openGate!());
    fireEvent.click(ask());
    await waitFor(() => expect(createTalkRequest).toHaveBeenCalled());
    // The target turned DND off: in the app that is a dndClient push, which re-renders every consumer and
    // is what refreshes the set the hook reads. Reproduced here as the render it really is.
    dnd = new Set();
    view.rerender(<Harness />);
    act(() => { for (const l of cancelledListeners) l({ id: "req-1" }); });
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  });

  it("keeps waiting on cancellation when the target is STILL DND", async () => {
    render(<Harness />);
    act(() => openGate!());
    fireEvent.click(ask());
    await waitFor(() => expect(createTalkRequest).toHaveBeenCalled());
    act(() => { for (const l of cancelledListeners) l({ id: "req-1" }); });
    expect(resume).not.toHaveBeenCalled();
    // back to the resting state: the ask is offered again
    expect(await screen.findByRole("button", { name: /request permission to talk/i })).toBeTruthy();
  });

  it("supersedes a gate aimed at somebody else, cancelling its outstanding request", async () => {
    render(<Harness />);
    act(() => openGate!());
    fireEvent.click(ask());
    await waitFor(() => expect(createTalkRequest).toHaveBeenCalled());
    act(() => supersedeWith!("micah@offshorly.com"));
    expect(cancelTalkRequest).toHaveBeenCalledWith("req-1");
    await waitFor(() => expect(screen.queryByRole("button", { name: /request permission to talk/i })).toBeNull());
  });

  it("leaves a gate aimed at the SAME person alone", async () => {
    render(<Harness />);
    act(() => openGate!());
    fireEvent.click(ask());
    await waitFor(() => expect(createTalkRequest).toHaveBeenCalled());
    act(() => supersedeWith!(ALEX));
    expect(cancelTalkRequest).not.toHaveBeenCalled();
  });
});
