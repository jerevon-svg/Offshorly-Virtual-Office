import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ToucanAssistantPanel } from "./ToucanAssistantPanel";
import chat from "../Chat/ConversationView.module.css";

// Focused tests for the Toucan assistant panel's Messenger-style presentation
// and its mock reply flow. Says nothing about summon/movement (frozen — see
// toucanSummon.test.ts) and touches no chat state.

const MOCK_DELAY = 1100;

// The bubble div is the element carrying the message text.
function bubbleFor(text: string | RegExp): HTMLElement {
  return screen.getByText(text);
}

describe("ToucanAssistantPanel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const setup = (onPendingChange = vi.fn(), onRelease = vi.fn()) => {
    render(<ToucanAssistantPanel onRelease={onRelease} onPendingChange={onPendingChange} />);
    return { onPendingChange, onRelease };
  };

  // Same fireEvent idioms the existing chat tests use (no user-event dep).
  const composer = () => screen.getByLabelText("Message the toucan");
  const typeText = (text: string) => fireEvent.change(composer(), { target: { value: text } });
  const pressEnter = (shift = false) => fireEvent.keyDown(composer(), { key: "Enter", shiftKey: shift });
  const sendViaEnter = (text: string) => { typeText(text); pressEnter(); };
  const sendViaButton = (text: string) => { typeText(text); fireEvent.click(screen.getByLabelText("Send")); };
  const settleReply = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOCK_DELAY);
    });
  };

  it("opens with the toucan's greeting as a received message", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Toucan Assistant" })).toBeInTheDocument();
    expect(bubbleFor(/I'm the office toucan/)).toHaveClass(chat.peer);
  });

  it("renders the user's own message with own-message styling and the toucan's reply as received", async () => {
    setup();
    sendViaButton("hello toucan");

    // Own message: own styling, and NOT the received styling.
    const own = bubbleFor("hello toucan");
    expect(own).toHaveClass(chat.own);
    expect(own).not.toHaveClass(chat.peer);

    // Typing state appears while the mock reply is pending.
    expect(screen.getByTestId("toucan-typing")).toBeInTheDocument();

    await settleReply();

    const reply = bubbleFor("Hello! Nice to perch beside you.");
    expect(reply).toHaveClass(chat.peer);
    expect(reply).not.toHaveClass(chat.own);
    expect(screen.queryByTestId("toucan-typing")).not.toBeInTheDocument();
  });

  it("puts own and received messages on opposite sides", async () => {
    setup();
    sendViaEnter("hello");
    await settleReply();
    // The self row carries the chat's row-reverse modifier; a received row does not.
    const ownRow = bubbleFor("hello").closest(`.${chat.row}`);
    const peerRow = bubbleFor("Hello! Nice to perch beside you.").closest(`.${chat.row}`);
    expect(ownRow).toHaveClass(chat.rowSelf);
    expect(peerRow).not.toHaveClass(chat.rowSelf);
  });

  it("sends on Enter", async () => {
    setup();
    sendViaEnter("sent with enter");
    expect(bubbleFor("sent with enter")).toHaveClass(chat.own);
  });

  it("does not send an empty or whitespace-only message", async () => {
    const { onPendingChange } = setup();
    pressEnter();
    sendViaEnter("   ");
    typeText("");
    fireEvent.click(screen.getByLabelText("Send"));
    expect(screen.queryByTestId("toucan-typing")).not.toBeInTheDocument();
    expect(onPendingChange).not.toHaveBeenCalledWith(true);
  });

  it("reports pending as a boolean only, so no response text can reach the bird", async () => {
    const { onPendingChange } = setup();
    sendViaEnter("hello");
    expect(onPendingChange).toHaveBeenCalledWith(true);
    await settleReply();
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
    for (const call of onPendingChange.mock.calls) expect(typeof call[0]).toBe("boolean");
  });

  it("clears pending state when released mid-reply", async () => {
    const { onPendingChange, onRelease } = setup();
    sendViaEnter("hello");
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("Let the toucan go"));
    expect(onRelease).toHaveBeenCalled();
    // The caller unmounts the panel on release; that clears pending.
    cleanup();
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it("clears pending state on unmount mid-reply", async () => {
    const onPendingChange = vi.fn();
    const view = render(<ToucanAssistantPanel onRelease={vi.fn()} onPendingChange={onPendingChange} />);
    sendViaEnter("hello");
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps the composer usable after a reply", async () => {
    setup();
    sendViaEnter("hello");
    await settleReply();
    sendViaEnter("second question");
    expect(bubbleFor("second question")).toHaveClass(chat.own);
    expect(screen.getByTestId("toucan-typing")).toBeInTheDocument();
  });

  // The talking/typing animation itself lives in the office's existing
  // character-animation seam (resolveCharacterAnimState via OfficeStage's
  // talkingCharacterIds/spatialTypingCharacterIds); the panel's whole
  // contribution is this boolean, with chat's own idle timeout.
  describe("typing signal (drives the existing character talking animation)", () => {
    it("reports typing on a keystroke and stops after the chat idle timeout", async () => {
      const onTypingChange = vi.fn();
      render(<ToucanAssistantPanel onRelease={vi.fn()} onPendingChange={vi.fn()} onTypingChange={onTypingChange} />);
      fireEvent.change(screen.getByLabelText("Message the toucan"), { target: { value: "hel" } });
      expect(onTypingChange).toHaveBeenLastCalledWith(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2499);
      });
      expect(onTypingChange).toHaveBeenLastCalledWith(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(onTypingChange).toHaveBeenLastCalledWith(false);
    });

    it("stops typing when the draft is cleared", () => {
      const onTypingChange = vi.fn();
      render(<ToucanAssistantPanel onRelease={vi.fn()} onPendingChange={vi.fn()} onTypingChange={onTypingChange} />);
      const input = screen.getByLabelText("Message the toucan");
      fireEvent.change(input, { target: { value: "hi" } });
      fireEvent.change(input, { target: { value: "" } });
      expect(onTypingChange).toHaveBeenLastCalledWith(false);
    });

    it("stops typing on send", () => {
      const onTypingChange = vi.fn();
      render(<ToucanAssistantPanel onRelease={vi.fn()} onPendingChange={vi.fn()} onTypingChange={onTypingChange} />);
      const input = screen.getByLabelText("Message the toucan");
      fireEvent.change(input, { target: { value: "hello" } });
      expect(onTypingChange).toHaveBeenLastCalledWith(true);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onTypingChange).toHaveBeenLastCalledWith(false);
    });

    it("clears typing on unmount, so the character is never stuck talking", () => {
      const onTypingChange = vi.fn();
      const view = render(
        <ToucanAssistantPanel onRelease={vi.fn()} onPendingChange={vi.fn()} onTypingChange={onTypingChange} />,
      );
      fireEvent.change(screen.getByLabelText("Message the toucan"), { target: { value: "typing…" } });
      expect(onTypingChange).toHaveBeenLastCalledWith(true);
      view.unmount();
      expect(onTypingChange).toHaveBeenLastCalledWith(false);
    });
  });

  it("shows the meaningful reply inside the panel", async () => {
    setup();
    sendViaEnter("where is micah");
    await settleReply();
    const panel = screen.getByRole("dialog", { name: "Toucan Assistant" });
    expect(within(panel).getByText(/can't look people up yet/)).toBeInTheDocument();
    // ...and the panel never renders bird talk in place of the answer.
    expect(within(panel).queryByText(/Squawk squawk/)).not.toBeInTheDocument();
  });
});
