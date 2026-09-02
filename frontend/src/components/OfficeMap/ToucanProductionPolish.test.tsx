import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// TOUCAN T9 — PRODUCTION POLISH.
//
// Drives the panel against a fully faked service (same pattern as
// ToucanActionConfirmation.test.tsx), because every property worth pinning down
// here is about what the panel does with a given service response:
//
//   * a Markdown reply renders as real elements, and raw HTML in a reply is TEXT
//   * Copy puts the reply on the clipboard and nothing else
//   * a request in flight blocks a second submit
//   * a failed request offers Retry, which re-asks WITHOUT a duplicate question
//   * History exposes per-conversation delete; Memory lists and forgets
//   * NONE of the above can execute a T8 action

const h = vi.hoisted(() => {
  type ApplyResult = { ok: true } | { ok: false; reason: string };
  // The list mocks are annotated rather than inferred: `async () => []` infers
  // `never[]`, which then rejects every mockResolvedValue a spec wants to give
  // it. Structural shapes (not the service's own types) because vi.hoisted runs
  // before the module graph exists.
  type Conversation = { id: string; title: string | null; createdAt: string; updatedAt: string };
  type Memory = {
    id: string;
    kind: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  };
  const service = {
    greeting: vi.fn(() => "Squawk! Test greeting."),
    ask: vi.fn(),
    loadLatestConversation: vi.fn(async () => null),
    createConversation: vi.fn(
      async (): Promise<Conversation> => ({
        id: "c-new",
        title: null,
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      }),
    ),
    listConversations: vi.fn(async (): Promise<Conversation[]> => []),
    loadConversation: vi.fn(),
    confirmAction: vi.fn(),
    cancelAction: vi.fn(),
    deleteConversation: vi.fn(async (): Promise<void> => {}),
    listMemories: vi.fn(async (): Promise<Memory[]> => []),
    deleteMemory: vi.fn(async (): Promise<void> => {}),
  };
  return {
    service,
    applyToucanStatus: vi.fn((): ApplyResult => ({ ok: true })),
    canApplyToucanStatus: vi.fn((): ApplyResult => ({ ok: true })),
  };
});

vi.mock("../../services/toucan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/toucan")>();
  return {
    ...actual,
    toucanService: h.service,
    applyToucanStatus: h.applyToucanStatus,
    canApplyToucanStatus: h.canApplyToucanStatus,
  };
});

import { ToucanAssistantPanel } from "./ToucanAssistantPanel";

const answer = (text: string) => ({
  text,
  intent: "ai_response",
  supported: true,
  conversationId: "c-1",
});

const composer = () => screen.getByLabelText("Message the toucan") as HTMLTextAreaElement;
const sendButton = () => screen.getByLabelText("Send") as HTMLButtonElement;

let writeText: ReturnType<typeof vi.fn>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setup() {
  render(<ToucanAssistantPanel onRelease={vi.fn()} onPendingChange={vi.fn()} />);
  await flush();
}

async function ask(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.keyDown(composer(), { key: "Enter" });
  await flush();
}

describe("Toucan T9 production polish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.service.greeting.mockReturnValue("Squawk! Test greeting.");
    h.service.loadLatestConversation.mockResolvedValue(null);
    h.service.listConversations.mockResolvedValue([]);
    h.service.listMemories.mockResolvedValue([]);
    h.service.deleteConversation.mockResolvedValue(undefined);
    h.service.deleteMemory.mockResolvedValue(undefined);
    h.canApplyToucanStatus.mockReturnValue({ ok: true });
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    cleanup();
  });

  // --- P1: message rendering -------------------------------------------------

  describe("Markdown rendering", () => {
    it("renders a structured reply as real elements", async () => {
      h.service.ask.mockResolvedValue(
        answer("## Who's online\n\n**Micah** is in `Design`.\n\n- Micah\n- Angelo"),
      );
      await setup();
      await ask("who's online?");

      expect(screen.getByRole("heading", { name: "Who's online" })).toBeInTheDocument();
      expect(screen.getByText("Micah", { selector: "strong" })).toBeInTheDocument();
      expect(screen.getByText("Design", { selector: "code" })).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });

    it("renders a fenced code block with its whitespace preserved", async () => {
      h.service.ask.mockResolvedValue(answer("```python\ndef f():\n    return 1\n```"));
      await setup();
      await ask("show me code");

      const pre = document.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toBe("def f():\n    return 1");
      expect(screen.getByLabelText("Copy code")).toBeInTheDocument();
    });

    it("copies a code block's exact contents", async () => {
      h.service.ask.mockResolvedValue(answer("```\nnpm run dev\n```"));
      await setup();
      await ask("how do I start it");

      fireEvent.click(screen.getByLabelText("Copy code"));
      await flush();
      expect(writeText).toHaveBeenCalledWith("npm run dev");
    });

    it("renders raw HTML in a reply as text, creating no elements from it", async () => {
      h.service.ask.mockResolvedValue(
        answer('Careful: <img src=x onerror="alert(1)"> and <b>not bold</b>.'),
      );
      await setup();
      await ask("try html");

      expect(document.querySelector("img")).toBeNull();
      expect(document.querySelector("b")).toBeNull();
      expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
    });

    it("renders a safe link as an anchor and an unsafe one as plain text", async () => {
      h.service.ask.mockResolvedValue(
        answer("[the docs](https://example.com/docs) and [bad](javascript:alert1)"),
      );
      await setup();
      await ask("links?");

      const link = screen.getByRole("link", { name: "the docs" });
      expect(link).toHaveAttribute("href", "https://example.com/docs");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
      expect(screen.getByText(/bad/)).toBeInTheDocument();
    });

    it("leaves the viewer's own message as literal text", async () => {
      h.service.ask.mockResolvedValue(answer("Noted."));
      await setup();
      await ask("**not bold on my side**");

      // No <strong> came from the user's own message; the asterisks are shown.
      expect(screen.getByText("**not bold on my side**")).toBeInTheDocument();
    });
  });

  // --- P2: message actions ---------------------------------------------------

  describe("Copy response", () => {
    it("copies the reply text and confirms", async () => {
      h.service.ask.mockResolvedValue(answer("Micah is in the Design room."));
      await setup();
      await ask("where is micah");

      const copyButtons = screen.getAllByLabelText("Copy response");
      // Greeting + reply both offer Copy; the reply is the last one.
      fireEvent.click(copyButtons[copyButtons.length - 1]);
      await flush();

      expect(writeText).toHaveBeenCalledWith("Micah is in the Design room.");
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });

    it("offers no Copy on the viewer's own message", async () => {
      h.service.ask.mockResolvedValue(answer("Noted."));
      await setup();
      await ask("hello");

      // Greeting + one reply = two Copy controls, and none for the question.
      expect(screen.getAllByLabelText("Copy response")).toHaveLength(2);
    });
  });

  // --- P3: request / loading UX ---------------------------------------------

  describe("request state", () => {
    it("blocks a second submit while a reply is in flight", async () => {
      h.service.ask.mockReturnValue(new Promise(() => {}));
      await setup();
      await ask("first question");

      expect(screen.getByTestId("toucan-typing")).toBeInTheDocument();
      expect(composer()).toBeDisabled();
      expect(sendButton()).toBeDisabled();

      // Every route to a second send is inert.
      fireEvent.keyDown(composer(), { key: "Enter" });
      fireEvent.click(sendButton());
      await flush();
      expect(h.service.ask).toHaveBeenCalledTimes(1);
    });

    it("keeps the send button disabled until there is something to send", async () => {
      await setup();
      expect(sendButton()).toBeDisabled();
      fireEvent.change(composer(), { target: { value: "   " } });
      expect(sendButton()).toBeDisabled();
      fireEvent.change(composer(), { target: { value: "hi" } });
      expect(sendButton()).not.toBeDisabled();
    });

    it("keeps the transcript stable while waiting", async () => {
      h.service.ask.mockReturnValue(new Promise(() => {}));
      await setup();
      await ask("a question");

      expect(screen.getByText("Squawk! Test greeting.")).toBeInTheDocument();
      expect(screen.getByText("a question")).toBeInTheDocument();
    });

    it("offers Retry on a failed request and re-asks without duplicating the question", async () => {
      h.service.ask.mockRejectedValueOnce(new Error("network down"));
      await setup();
      await ask("who's online?");

      expect(screen.getByText(/couldn't reach the office/)).toBeInTheDocument();
      const retry = screen.getByText("Try again");

      h.service.ask.mockResolvedValueOnce(answer("Three people are online."));
      fireEvent.click(retry);
      await flush();

      expect(h.service.ask).toHaveBeenCalledTimes(2);
      expect(h.service.ask.mock.calls[1][0]).toMatchObject({ question: "who's online?" });
      // Exactly one user bubble for one asking, and the failure notice is gone.
      expect(screen.getAllByText("who's online?")).toHaveLength(1);
      expect(screen.queryByText(/couldn't reach the office/)).toBeNull();
      expect(screen.getByText("Three people are online.")).toBeInTheDocument();
    });

    it("does not send the failure notice as conversation history on retry", async () => {
      h.service.ask.mockRejectedValueOnce(new Error("network down"));
      await setup();
      await ask("who's online?");

      h.service.ask.mockResolvedValueOnce(answer("Three people are online."));
      fireEvent.click(screen.getByText("Try again"));
      await flush();

      const history = h.service.ask.mock.calls[1][0].history as { text: string }[];
      expect(history.some((turn) => /couldn't reach the office/.test(turn.text))).toBe(false);
    });

    it("offers no Retry on an ordinary reply", async () => {
      h.service.ask.mockResolvedValue(answer("All good."));
      await setup();
      await ask("hello");
      expect(screen.queryByText("Try again")).toBeNull();
    });
  });

  // --- P4: history UX --------------------------------------------------------

  describe("history", () => {
    const CONVERSATIONS = [
      {
        id: "c-1",
        title: "Where is Micah",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "c-2",
        title: null,
        createdAt: "2026-08-30T10:00:00.000Z",
        updatedAt: "2026-08-30T10:00:00.000Z",
      },
    ];

    async function openHistory() {
      fireEvent.click(screen.getByLabelText("Conversation history"));
      await flush();
    }

    it("deletes one conversation through the existing endpoint", async () => {
      h.service.listConversations.mockResolvedValue(CONVERSATIONS);
      await setup();
      await openHistory();

      fireEvent.click(screen.getByLabelText("Delete conversation Where is Micah"));
      await flush();

      expect(h.service.deleteConversation).toHaveBeenCalledWith("c-1");
      expect(screen.queryByText("Where is Micah")).toBeNull();
      // The other conversation is untouched.
      expect(screen.getByText("New conversation")).toBeInTheDocument();
    });

    it("marks the conversation that is on screen", async () => {
      h.service.ask.mockResolvedValue(answer("Answered."));
      h.service.listConversations.mockResolvedValue(CONVERSATIONS);
      await setup();
      await ask("something");
      await openHistory();

      const entries = within(
        screen.getByRole("menu", { name: "Saved conversations" }),
      ).getAllByRole("menuitem");
      expect(entries[0]).toHaveAttribute("aria-current", "true");
      expect(entries[1]).toHaveAttribute("aria-current", "false");
    });

    it("shows an empty state that says how a conversation gets there", async () => {
      await setup();
      await openHistory();
      expect(screen.getByText(/No saved conversations yet/)).toBeInTheDocument();
    });

    it("closes Memory when History opens, so only one popover is up", async () => {
      await setup();
      fireEvent.click(screen.getByLabelText("What the toucan remembers"));
      await flush();
      expect(screen.getByRole("list", { name: "Saved memories" })).toBeInTheDocument();

      await openHistory();
      expect(screen.queryByRole("list", { name: "Saved memories" })).toBeNull();
      expect(screen.getByRole("menu", { name: "Saved conversations" })).toBeInTheDocument();
    });
  });

  // --- P5: memory controls ---------------------------------------------------

  describe("memory controls", () => {
    const MEMORIES = [
      {
        id: "mem-1",
        kind: "fact",
        content: "My desk is by the window",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "mem-2",
        kind: "note",
        content: "Prefers async standups",
        createdAt: "2026-08-31T10:00:00.000Z",
        updatedAt: "2026-08-31T10:00:00.000Z",
      },
    ];

    async function openMemory() {
      fireEvent.click(screen.getByLabelText("What the toucan remembers"));
      await flush();
    }

    it("lists saved memories with their kind", async () => {
      h.service.listMemories.mockResolvedValue(MEMORIES);
      await setup();
      await openMemory();

      expect(h.service.listMemories).toHaveBeenCalledTimes(1);
      expect(screen.getByText("My desk is by the window")).toBeInTheDocument();
      expect(screen.getByText("Fact")).toBeInTheDocument();
      expect(screen.getByText("Note")).toBeInTheDocument();
    });

    it("shows no ids, owner or raw metadata", async () => {
      h.service.listMemories.mockResolvedValue(MEMORIES);
      await setup();
      await openMemory();

      const panel = screen.getByRole("dialog", { name: "Toucan Assistant" });
      const rendered = panel.textContent ?? "";
      expect(rendered).not.toContain("mem-1");
      expect(rendered).not.toContain("mem-2");
      expect(rendered).not.toContain("@");
      expect(rendered).not.toContain("2026-09-01T10:00:00.000Z");
      // The raw enum value never reaches the screen — only the label does.
      expect(rendered).not.toContain("fact");
    });

    it("forgets one memory", async () => {
      h.service.listMemories.mockResolvedValue(MEMORIES);
      await setup();
      await openMemory();

      fireEvent.click(screen.getByLabelText("Forget: My desk is by the window"));
      await flush();

      expect(h.service.deleteMemory).toHaveBeenCalledWith("mem-1");
      expect(screen.queryByText("My desk is by the window")).toBeNull();
      expect(screen.getByText("Prefers async standups")).toBeInTheDocument();
    });

    it("offers no way to create a memory from this surface", async () => {
      h.service.listMemories.mockResolvedValue(MEMORIES);
      await setup();
      await openMemory();

      const list = screen.getByRole("list", { name: "Saved memories" });
      // Every control in the list is a Forget; there is no add/save affordance.
      for (const button of within(list).getAllByRole("button")) {
        expect(button.getAttribute("aria-label")).toMatch(/^Forget: /);
      }
    });

    it("shows an empty state that points at the explicit remember command", async () => {
      await setup();
      await openMemory();
      expect(screen.getByText(/Remember that/)).toBeInTheDocument();
    });
  });

  // --- P6: development artifacts --------------------------------------------

  describe("development artifacts", () => {
    it("shows no DEMO badge (mock mode is the quiet 'Demo' chip, real mode none)", async () => {
      await setup();
      expect(screen.queryByText("DEMO")).toBeNull();
    });
  });

  // --- T8 SAFETY REGRESSION --------------------------------------------------

  describe("T8 action safety must not regress", () => {
    const PROPOSAL = {
      id: "act-1",
      action: "set_status" as const,
      status: "BUSY",
      dndMinutes: null,
      summary: "Set your status to Busy",
      expiresAt: "2026-09-02T12:02:00.000Z",
    };

    it("still requires explicit confirmation for every allowlisted status", async () => {
      for (const status of ["BUSY", "DND", "BREAK", "LUNCH"]) {
        h.service.ask.mockResolvedValue({
          ...answer("Nothing has changed yet — confirm below."),
          action: { ...PROPOSAL, status, summary: `Set your status to ${status}` },
        });
        await setup();
        await ask(`set me to ${status}`);

        expect(screen.getByTestId("toucan-action-card")).toBeInTheDocument();
        expect(screen.getByText("Confirm")).toBeInTheDocument();
        expect(h.service.confirmAction).not.toHaveBeenCalled();
        expect(h.applyToucanStatus).not.toHaveBeenCalled();
        cleanup();
        vi.clearAllMocks();
        h.service.loadLatestConversation.mockResolvedValue(null);
        h.canApplyToucanStatus.mockReturnValue({ ok: true });
      }
    });

    it("executes nothing when a Markdown reply's link is activated", async () => {
      h.service.ask.mockResolvedValue(answer("Try [this](https://example.com/confirm)."));
      await setup();
      await ask("anything");

      fireEvent.click(screen.getByRole("link", { name: "this" }));
      await flush();
      expect(h.service.confirmAction).not.toHaveBeenCalled();
      expect(h.applyToucanStatus).not.toHaveBeenCalled();
    });

    it("executes nothing when Retry re-asks — a proposal is still only a proposal", async () => {
      h.service.ask.mockRejectedValueOnce(new Error("network down"));
      await setup();
      await ask("set me to busy");

      h.service.ask.mockResolvedValueOnce({
        ...answer("Nothing has changed yet — confirm below."),
        action: PROPOSAL,
      });
      fireEvent.click(screen.getByText("Try again"));
      await flush();

      // The retry produced a CARD, not an execution.
      expect(screen.getByTestId("toucan-action-card")).toBeInTheDocument();
      expect(h.service.confirmAction).not.toHaveBeenCalled();
      expect(h.applyToucanStatus).not.toHaveBeenCalled();
    });

    it("executes nothing when Copy, History or Memory are used", async () => {
      h.service.listConversations.mockResolvedValue([
        {
          id: "c-9",
          title: "Old chat",
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:00:00.000Z",
        },
      ]);
      h.service.listMemories.mockResolvedValue([
        {
          id: "mem-9",
          kind: "note",
          content: "Something remembered",
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:00:00.000Z",
        },
      ]);
      h.service.loadConversation.mockResolvedValue({
        id: "c-9",
        title: "Old chat",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        messages: [],
      });
      await setup();

      fireEvent.click(screen.getAllByLabelText("Copy response")[0]);
      await flush();
      fireEvent.click(screen.getByLabelText("Conversation history"));
      await flush();
      fireEvent.click(screen.getByText("Old chat"));
      await flush();
      fireEvent.click(screen.getByLabelText("What the toucan remembers"));
      await flush();
      fireEvent.click(screen.getByLabelText("Forget: Something remembered"));
      await flush();

      expect(h.service.confirmAction).not.toHaveBeenCalled();
      expect(h.service.cancelAction).not.toHaveBeenCalled();
      expect(h.applyToucanStatus).not.toHaveBeenCalled();
    });

    it("drops an unconfirmed proposal when a conversation is deleted, executing nothing", async () => {
      h.service.ask.mockResolvedValue({
        ...answer("Nothing has changed yet — confirm below."),
        action: PROPOSAL,
      });
      h.service.listConversations.mockResolvedValue([
        {
          id: "c-1",
          title: "Current",
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:00:00.000Z",
        },
      ]);
      await setup();
      await ask("set me to busy");
      expect(screen.getByTestId("toucan-action-card")).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText("Conversation history"));
      await flush();
      fireEvent.click(screen.getByLabelText("Delete conversation Current"));
      await flush();

      expect(screen.queryByTestId("toucan-action-card")).toBeNull();
      expect(h.service.confirmAction).not.toHaveBeenCalled();
      expect(h.applyToucanStatus).not.toHaveBeenCalled();
    });
  });
});
