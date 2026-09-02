import { useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ToucanAssistantPanel } from "./ToucanAssistantPanel";
import { mockToucanService, resetMockToucanConversations } from "../../services/toucan";

// TOUCAN T1 — HISTORY NAVIGATION.
//
// The backend already stored every past conversation; this is the small frontend
// affordance for reopening one. The properties worth pinning down are all about
// what History does NOT do:
//
//   * opening it creates nothing and deletes nothing — it is two GETs
//   * switching conversations does not start a new one; the next question is
//     appended to the conversation that was picked
//   * "New conversation" still makes a genuinely separate session
//   * release/re-summon and remount still restore the most recent conversation
//
// Driven through the default (mock) service, whose conversations live in a
// module-level map — so "reopen" here exercises the same
// listConversations/loadConversation path real mode takes.

const MOCK_DELAY = 1100;

const composer = () => screen.getByLabelText("Message the toucan") as HTMLTextAreaElement;
const historyButton = () => screen.getByLabelText("Conversation history");
const newConversationButton = () => screen.getByLabelText("Start a new conversation");
const historyMenu = () => screen.getByRole("menu", { name: "Saved conversations" });
const historyEntries = () => within(historyMenu()).queryAllByRole("menuitem");

function SummonHarness() {
  const [summoned, setSummoned] = useState(true);
  return (
    <>
      <button onClick={() => setSummoned(true)}>summon</button>
      {summoned && <ToucanAssistantPanel onRelease={() => setSummoned(false)} />}
    </>
  );
}

describe("Toucan conversation history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockToucanConversations();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // Settles a pending service read (restore, list, or load).
  async function flush() {
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

  async function openHistory() {
    fireEvent.click(historyButton());
    await flush();
  }

  /** Two saved conversations, "older" asked first. Leaves the panel on the newer
   *  one, which is where a fresh mount would also land. */
  async function seedTwoConversations() {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flush();
    await askAndSettle("older question");
    fireEvent.click(newConversationButton());
    await flush();
    await askAndSettle("newer question");
  }

  it("lists the viewer's saved conversations, most recent first", async () => {
    await seedTwoConversations();

    await openHistory();

    expect(historyEntries().map((entry) => entry.textContent)).toEqual([
      expect.stringContaining("newer question"),
      expect.stringContaining("older question"),
    ]);
  });

  it("titles each entry with the conversation's own title", async () => {
    await seedTwoConversations();
    await openHistory();
    // Titles are the viewer's own opening questions, derived server-side.
    expect(within(historyMenu()).getByText("older question")).toBeInTheDocument();
    expect(within(historyMenu()).getByText("newer question")).toBeInTheDocument();
  });

  it("marks the conversation currently on screen as the selected one", async () => {
    await seedTwoConversations();
    await openHistory();

    const [newest, oldest] = historyEntries();
    expect(newest).toHaveAttribute("aria-current", "true");
    expect(oldest).toHaveAttribute("aria-current", "false");
  });

  it("restores an older conversation's transcript when it is selected", async () => {
    await seedTwoConversations();
    expect(screen.queryByText("older question")).not.toBeInTheDocument();

    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("older question"));
    await flush();

    expect(screen.getByText("older question")).toBeInTheDocument();
    // ...and the conversation it replaced is no longer on screen.
    expect(screen.queryByText("newer question")).not.toBeInTheDocument();
  });

  it("closes the popover once a conversation is chosen", async () => {
    await seedTwoConversations();
    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("older question"));
    await flush();

    expect(screen.queryByRole("menu", { name: "Saved conversations" })).not.toBeInTheDocument();
  });

  it("continues the reopened conversation rather than starting a new one", async () => {
    await seedTwoConversations();
    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("older question"));
    await flush();

    await askAndSettle("a follow-up");

    // The follow-up landed in the OLDER conversation — that is the id the panel
    // sent — and the newer one is untouched.
    const saved = await mockToucanService.listConversations();
    const older = await mockToucanService.loadConversation(
      saved.find((c) => c.title === "older question")!.id,
    );
    const newer = await mockToucanService.loadConversation(
      saved.find((c) => c.title === "newer question")!.id,
    );
    expect(older.messages.map((m) => m.content)).toContain("a follow-up");
    expect(newer.messages.map((m) => m.content)).not.toContain("a follow-up");
    // Still exactly two conversations: continuing created nothing.
    expect(saved).toHaveLength(2);
  });

  it("neither creates nor deletes a conversation when switching", async () => {
    await seedTwoConversations();
    const before = await mockToucanService.listConversations();

    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("older question"));
    await flush();
    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("newer question"));
    await flush();

    const after = await mockToucanService.listConversations();
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
  });

  it("does not delete anything merely by being opened", async () => {
    await seedTwoConversations();
    const before = await mockToucanService.listConversations();

    await openHistory();
    fireEvent.click(historyButton()); // close again without choosing

    expect(await mockToucanService.listConversations()).toHaveLength(before.length);
    expect(screen.getByText("newer question")).toBeInTheDocument();
  });

  it("shows an empty state when nothing has ever been asked", async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flush();

    await openHistory();

    expect(within(historyMenu()).getByText("No saved conversations yet.")).toBeInTheDocument();
    expect(historyEntries()).toHaveLength(0);
  });

  it("labels an untitled conversation rather than showing a blank row", async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flush();
    fireEvent.click(newConversationButton());
    await flush();

    await openHistory();

    expect(within(historyMenu()).getByText("New conversation")).toBeInTheDocument();
  });

  it("still creates a separate session from New conversation after browsing history", async () => {
    await seedTwoConversations();
    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("older question"));
    await flush();

    fireEvent.click(newConversationButton());
    await flush();
    await askAndSettle("third conversation");

    const saved = await mockToucanService.listConversations();
    expect(saved).toHaveLength(3);
    expect(saved[0].title).toBe("third conversation");
    const third = await mockToucanService.loadConversation(saved[0].id);
    expect(third.messages.map((m) => m.content)).not.toContain("older question");
  });

  it("reopens the most recent conversation on re-summon, not the one browsed to", async () => {
    render(<SummonHarness />);
    await flush();
    await askAndSettle("older question");
    fireEvent.click(newConversationButton());
    await flush();
    await askAndSettle("newer question");

    // Browse back to the older one, then release and summon again.
    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("older question"));
    await flush();
    fireEvent.click(screen.getByText("Let the toucan go"));
    fireEvent.click(screen.getByText("summon"));
    await flush();

    // Re-summon restores the MOST RECENTLY USED conversation, which is still the
    // newer one — merely reading an old conversation does not make it current.
    expect(screen.getByText("newer question")).toBeInTheDocument();
    expect(screen.queryByText("older question")).not.toBeInTheDocument();
  });

  it("keeps a continued old conversation as the one a remount restores", async () => {
    const first = render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flush();
    await askAndSettle("older question");
    fireEvent.click(newConversationButton());
    await flush();
    await askAndSettle("newer question");

    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("older question"));
    await flush();
    await askAndSettle("a follow-up");
    first.unmount();

    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flush();

    // Talking in the older conversation moved it back to the front.
    expect(screen.getByText("a follow-up")).toBeInTheDocument();
    expect(screen.getByText("older question")).toBeInTheDocument();
  });

  it("clears an unsent draft when switching, so it cannot leak into another conversation", async () => {
    await seedTwoConversations();
    fireEvent.change(composer(), { target: { value: "half-typed" } });

    await openHistory();
    fireEvent.click(within(historyMenu()).getByText("older question"));
    await flush();

    expect(composer().value).toBe("");
  });
});
