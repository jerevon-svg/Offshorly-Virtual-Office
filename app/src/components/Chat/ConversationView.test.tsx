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
});
