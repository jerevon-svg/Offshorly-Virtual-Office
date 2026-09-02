import { useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToucanAssistantPanel } from "./ToucanAssistantPanel";
import { mockToucanService, resetMockToucanConversations } from "../../services/toucan";

// TOUCAN T1 — the conversation must outlive the panel.
//
// Three lifetimes are at stake, and they are deliberately different:
//   * THE PANEL dies on release. It is a view.
//   * THE CONVERSATION does not. Re-summoning reopens it.
//   * A NEW CONVERSATION is a real, separate, server-side conversation — not a
//     cleared transcript that keeps appending to the old one.
//
// Everything here drives the panel through the default (mock) service, whose
// conversations live in a module-level map — so "remount" here exercises exactly
// the code path a release/re-summon and a page refresh take in real mode: mount
// -> loadLatestConversation -> restore. What the mock deliberately does NOT fake
// is durability across a page reload; that is the backend's property and is
// covered in backend/tests/test_toucan_persistence.py.

const MOCK_DELAY = 1100;

const composer = () => screen.getByLabelText("Message the toucan") as HTMLTextAreaElement;
const newConversationButton = () => screen.getByLabelText("Start a new conversation");

/** Mirrors OfficeMap: the panel is mounted for the summoned session and unmounted
 *  on release. `summoned` is the only thing release changes. */
function SummonHarness() {
  const [summoned, setSummoned] = useState(true);
  return (
    <>
      <button onClick={() => setSummoned(true)}>summon</button>
      {summoned && <ToucanAssistantPanel onRelease={() => setSummoned(false)} />}
    </>
  );
}

describe("Toucan conversations persist across the panel's lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockToucanConversations();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  async function flushRestore() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function askAndSettle(text: string) {
    fireEvent.change(composer(), { target: { value: text } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOCK_DELAY);
    });
  }

  const release = () => fireEvent.click(screen.getByText("Let the toucan go"));
  const summon = () => fireEvent.click(screen.getByText("summon"));

  it("reopens the same conversation after release and re-summon", async () => {
    render(<SummonHarness />);
    await flushRestore();
    await askAndSettle("hello toucan");

    release();
    expect(screen.queryByLabelText("Message the toucan")).not.toBeInTheDocument();

    summon();
    await flushRestore();

    expect(screen.getByText("hello toucan")).toBeInTheDocument();
    expect(screen.getByText("Hello! Nice to perch beside you.")).toBeInTheDocument();
  });

  it("does not delete the conversation on release", async () => {
    render(<SummonHarness />);
    await flushRestore();
    await askAndSettle("hello toucan");

    release();

    // The service still holds it — release closed a view, it did not destroy data.
    const latest = await mockToucanService.loadLatestConversation();
    expect(latest?.messages.map((m) => m.content)).toEqual([
      "hello toucan",
      "Hello! Nice to perch beside you.",
    ]);
  });

  it("restores the conversation on a fresh remount (the page-refresh path)", async () => {
    const first = render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();
    await askAndSettle("hello toucan");
    first.unmount();

    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();

    expect(screen.getByText("hello toucan")).toBeInTheDocument();
    expect(screen.getByText("Hello! Nice to perch beside you.")).toBeInTheDocument();
  });

  it("restores the LATEST conversation, not an older one", async () => {
    const first = render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();
    await askAndSettle("first conversation");

    fireEvent.click(newConversationButton());
    await flushRestore();
    await askAndSettle("second conversation");
    first.unmount();

    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();

    expect(screen.getByText("second conversation")).toBeInTheDocument();
    expect(screen.queryByText("first conversation")).not.toBeInTheDocument();
  });

  it("does not repeat the greeting above a restored transcript", async () => {
    render(<SummonHarness />);
    await flushRestore();
    await askAndSettle("hello toucan");

    release();
    summon();
    await flushRestore();

    expect(screen.queryAllByText(/I'm the office toucan/)).toHaveLength(0);
  });

  it("still greets a viewer who has never asked anything", async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();
    expect(screen.getByText(/I'm the office toucan/)).toBeInTheDocument();
  });
});

describe('Toucan "New conversation"', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockToucanConversations();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  async function flushRestore() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function askAndSettle(text: string) {
    fireEvent.change(composer(), { target: { value: text } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOCK_DELAY);
    });
  }

  it("clears the transcript back to the greeting", async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();
    await askAndSettle("hello toucan");
    expect(screen.getByText("hello toucan")).toBeInTheDocument();

    fireEvent.click(newConversationButton());
    await flushRestore();

    expect(screen.queryByText("hello toucan")).not.toBeInTheDocument();
    expect(screen.getByText(/I'm the office toucan/)).toBeInTheDocument();
  });

  it("starts a genuinely separate conversation rather than appending to the old one", async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();
    await askAndSettle("first conversation");

    fireEvent.click(newConversationButton());
    await flushRestore();
    await askAndSettle("second conversation");

    const latest = await mockToucanService.loadLatestConversation();
    expect(latest?.messages.map((m) => m.content)).toEqual([
      "second conversation",
      // The mock's fallback reply for the first user turn of a conversation.
      expect.any(String),
    ]);
    expect(latest?.messages.map((m) => m.content)).not.toContain("first conversation");
  });

  it("is the conversation a refresh restores, even before anything is asked in it", async () => {
    const first = render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();
    await askAndSettle("first conversation");

    fireEvent.click(newConversationButton());
    await flushRestore();
    first.unmount();

    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();

    // The NEW (still empty) conversation is latest — the old transcript must not
    // come back just because the viewer had not typed into the new one yet.
    expect(screen.queryByText("first conversation")).not.toBeInTheDocument();
    expect(screen.getByText(/I'm the office toucan/)).toBeInTheDocument();
  });

  it("clears an unsent draft so it cannot leak into the new conversation", async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flushRestore();
    fireEvent.change(composer(), { target: { value: "half-typed question" } });

    fireEvent.click(newConversationButton());
    await flushRestore();

    expect(composer().value).toBe("");
  });
});
