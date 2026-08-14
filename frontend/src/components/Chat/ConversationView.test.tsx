import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ConversationView } from "./ConversationView";
import { mockChatService } from "../../services/chat";
import type { AssetLayer } from "../../types/office";

function makePeer(id: string): AssetLayer {
  return {
    id,
    kind: "character",
    path: `characters/${id}.png`,
    transform: null,
    name: id,
    x: 100,
    y: 100,
    width: 40,
    height: 60,
  };
}

const SELF_ID = "bon";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ConversationView", () => {
  it("renders existing seeded history from MockChatService", async () => {
    const peer = makePeer("alex");
    const conv = await mockChatService.openConversationWith(peer.id, SELF_ID);
    await mockChatService.sendMessage({
      conversationId: conv.id,
      senderId: SELF_ID,
      text: "seeded message",
    });

    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("seeded message")).toBeInTheDocument();
    });
  });

  it("clicking Send calls the service and appends the own message", async () => {
    const peer = makePeer("arisha");
    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    const textarea = await screen.findByPlaceholderText("Type a message…");
    fireEvent.change(textarea, { target: { value: "hello there" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(screen.getByText("hello there")).toBeInTheDocument();
    });
  });

  it("shows the echo reply after advancing fake timers, in scrollback order", async () => {
    const peer = makePeer("angelo");
    vi.useFakeTimers();
    const { container } = render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    // Flush the openConversationWith()/getMessages() promise chain (real
    // microtasks — unaffected by fake timers) before interacting.
    await vi.advanceTimersByTimeAsync(0);

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "ping" } });
    fireEvent.click(screen.getByText("Send"));
    await vi.advanceTimersByTimeAsync(0);

    expect(container.textContent).toContain("ping");

    await vi.advanceTimersByTimeAsync(1600);

    const bubbles = container.querySelectorAll('[class*="own"], [class*="peer"]');
    const texts = Array.from(bubbles).map((el) => el.textContent);
    expect(texts[0]).toBe("ping");
    expect(texts).toHaveLength(2);
  });

  it("shows a connecting placeholder while opening the conversation, then the panel once loaded", async () => {
    const peer = makePeer("cold-start");
    let releaseGetMessages: (msgs: import("../../services/chat").ChatMessage[]) => void = () => {};
    const getMessagesSpy = vi
      .spyOn(mockChatService, "getMessages")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseGetMessages = resolve;
          }),
      );

    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Connecting to chat…")).toBeInTheDocument();
    });

    releaseGetMessages([]);

    await waitFor(() => {
      expect(screen.queryByText("Connecting to chat…")).not.toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("Type a message…")).toBeInTheDocument();

    getMessagesSpy.mockRestore();
  });

  it("surfaces a Retry affordance and preserves the draft text when sendMessage rejects", async () => {
    const peer = makePeer("flaky");
    const sendMessageSpy = vi
      .spyOn(mockChatService, "sendMessage")
      .mockRejectedValueOnce(new Error("Timed out waiting for the server to confirm this message was sent."));

    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    const textarea = await screen.findByPlaceholderText("Type a message…");
    fireEvent.change(textarea, { target: { value: "will fail" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => {
      expect(
        screen.getByText("Timed out waiting for the server to confirm this message was sent."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Retry")).toBeInTheDocument();
    // The failed text must not silently vanish — it should still be
    // recoverable from the panel (not require the user to retype it).
    expect(screen.queryByText("will fail")).not.toBeInTheDocument();

    sendMessageSpy.mockRestore();

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByText("will fail")).toBeInTheDocument();
    });
    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  it('renders a distinct error banner (not the "waking up" banner) with Retry when connectionState is "error", and wires Retry to reconnect()', async () => {
    const peer = makePeer("broken-auth");
    const reconnectSpy = vi.fn();
    // mockChatService normally has no onConnectionState/getConnectionState/
    // getConnectionError/reconnect (mock mode has no real socket) — stub
    // them on the singleton for this test only, mirroring what a real
    // ChatService in a terminal "error" state would expose.
    (mockChatService as unknown as { getConnectionState: () => string }).getConnectionState = () => "error";
    (mockChatService as unknown as { getConnectionError: () => string }).getConnectionError = () =>
      "invalid token";
    (mockChatService as unknown as { onConnectionState: (cb: (s: string) => void) => () => void }).onConnectionState =
      () => () => {};
    (mockChatService as unknown as { reconnect: () => void }).reconnect = reconnectSpy;

    render(<ConversationView peer={peer} selfId={SELF_ID} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Couldn't connect to chat: invalid token/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByText(/Waking up the chat server/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Retry"));
    expect(reconnectSpy).toHaveBeenCalledTimes(1);

    // Clean up the stubs so later tests see mock mode's normal shape again.
    delete (mockChatService as unknown as { getConnectionState?: () => string }).getConnectionState;
    delete (mockChatService as unknown as { getConnectionError?: () => string }).getConnectionError;
    delete (mockChatService as unknown as { onConnectionState?: () => void }).onConnectionState;
    delete (mockChatService as unknown as { reconnect?: () => void }).reconnect;
  });
});
