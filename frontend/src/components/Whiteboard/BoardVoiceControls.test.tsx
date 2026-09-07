import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// W5-B controls over a stubbed call store: explicit join, disabled while another media room is
// connected (one Room at a time), mute/leave wiring, and the board-scoped error.

const store = vi.hoisted(() => ({
  snap: {
    status: "idle" as string,
    connectedSessionId: null as string | null,
    connectedBoardId: null as string | null,
    boardError: null as { boardId: string; message: string } | null,
    micEnabled: false,
    audioPlaybackBlocked: false,
  },
  startOrJoinBoardVoice: vi.fn(),
  leaveCall: vi.fn(),
  setMicEnabled: vi.fn(),
  resumeAudioPlayback: vi.fn(),
  clearBoardError: vi.fn(),
}));
vi.mock("../../services/call/callStore", () => ({
  useCallState: () => store.snap,
  startOrJoinBoardVoice: (id: string) => store.startOrJoinBoardVoice(id),
  leaveCall: () => store.leaveCall(),
  setMicEnabled: (on: boolean) => store.setMicEnabled(on),
  resumeAudioPlayback: () => store.resumeAudioPlayback(),
  clearBoardError: () => store.clearBoardError(),
}));

import { BoardVoiceControls } from "./BoardVoiceControls";

beforeEach(() => {
  store.snap = { status: "idle", connectedSessionId: null, connectedBoardId: null, boardError: null, micEnabled: false, audioPlaybackBlocked: false };
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("BoardVoiceControls", () => {
  it("offers an explicit Join Voice that calls the store for this board only", () => {
    render(<BoardVoiceControls boardId="b1" live voiceCount={0} />);
    expect(store.startOrJoinBoardVoice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Join voice" }));
    expect(store.startOrJoinBoardVoice).toHaveBeenCalledWith("b1");
  });

  it("disables Join while connected or connecting to any other media room, and before the board is live", () => {
    store.snap = { ...store.snap, status: "connected", connectedSessionId: "conv-1" };
    const { rerender } = render(<BoardVoiceControls boardId="b1" live voiceCount={0} />);
    expect(screen.getByRole("button", { name: "Join voice" })).toBeDisabled();
    store.snap = { ...store.snap, status: "connecting", connectedSessionId: null, connectedBoardId: "b2" };
    rerender(<BoardVoiceControls boardId="b1" live voiceCount={0} />);
    expect(screen.getByRole("button", { name: "Join voice" })).toBeDisabled();
    store.snap = { ...store.snap, status: "idle", connectedBoardId: null };
    rerender(<BoardVoiceControls boardId="b1" live={false} voiceCount={0} />);
    expect(screen.getByRole("button", { name: "Join voice" })).toBeDisabled();
    rerender(<BoardVoiceControls boardId="b1" live voiceCount={2} />);
    expect(screen.getByRole("button", { name: "Join voice" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Join voice" })).toHaveTextContent("Join Voice · 2");
  });

  it("shows Connecting, then Mute/Unmute + Leave wired to the store, plus Enable audio when autoplay is blocked", () => {
    store.snap = { ...store.snap, status: "connecting", connectedBoardId: "b1" };
    const { rerender } = render(<BoardVoiceControls boardId="b1" live voiceCount={1} />);
    expect(screen.getByText("Connecting voice…")).toBeInTheDocument();

    store.snap = { ...store.snap, status: "connected", micEnabled: true, audioPlaybackBlocked: true };
    rerender(<BoardVoiceControls boardId="b1" live voiceCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(store.setMicEnabled).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByText("🔈 Enable audio"));
    expect(store.resumeAudioPlayback).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Leave voice" }));
    expect(store.leaveCall).toHaveBeenCalled();

    store.snap = { ...store.snap, micEnabled: false };
    rerender(<BoardVoiceControls boardId="b1" live voiceCount={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Unmute microphone" }));
    expect(store.setMicEnabled).toHaveBeenCalledWith(true);
  });

  it("shows only THIS board's failure and lets it be dismissed", () => {
    store.snap = { ...store.snap, boardError: { boardId: "b1", message: "Voice calling is not configured" } };
    const { rerender } = render(<BoardVoiceControls boardId="b1" live voiceCount={0} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Voice calling is not configured");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss voice error" }));
    expect(store.clearBoardError).toHaveBeenCalled();
    store.snap = { ...store.snap, boardError: { boardId: "other", message: "nope" } };
    rerender(<BoardVoiceControls boardId="b1" live voiceCount={0} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
