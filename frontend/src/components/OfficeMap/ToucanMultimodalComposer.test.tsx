import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { appendDictatedText } from "./toucanDictation";

// TOUCAN T10 — MULTIMODAL FOUNDATION (UI + architecture preparation only).
//
// Pins down the two new seams and, just as importantly, what they must NOT do
// yet: no picker, no recorder, no permission prompt, no upload, and no change to
// what /toucan/ask is sent.

const h = vi.hoisted(() => {
  type Conversation = { id: string; title: string | null; createdAt: string; updatedAt: string };
  type Memory = { id: string; kind: string; content: string; createdAt: string; updatedAt: string };
  const service = {
    greeting: vi.fn(() => "Squawk! Test greeting."),
    ask: vi.fn(),
    loadLatestConversation: vi.fn(async () => null),
    createConversation: vi.fn(),
    listConversations: vi.fn(async (): Promise<Conversation[]> => []),
    loadConversation: vi.fn(),
    confirmAction: vi.fn(),
    cancelAction: vi.fn(),
    deleteConversation: vi.fn(async (): Promise<void> => {}),
    listMemories: vi.fn(async (): Promise<Memory[]> => []),
    deleteMemory: vi.fn(async (): Promise<void> => {}),
  };
  return { service };
});

vi.mock("../../services/toucan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/toucan")>();
  return { ...actual, toucanService: h.service };
});

import { ToucanAssistantPanel } from "./ToucanAssistantPanel";
import type { ToucanDraftAttachment } from "../../services/toucan";

const composer = () => screen.getByLabelText("Message the toucan") as HTMLTextAreaElement;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

type PanelProps = Parameters<typeof ToucanAssistantPanel>[0];

async function setup(extra: Partial<PanelProps> = {}) {
  render(<ToucanAssistantPanel onRelease={vi.fn()} {...extra} />);
  await flush();
}

describe("appendDictatedText", () => {
  it("fills an empty draft with the trimmed transcript", () => {
    expect(appendDictatedText("", "  who is online  ")).toBe("who is online");
  });

  it("appends to an existing draft with exactly one space", () => {
    expect(appendDictatedText("hello ", "there")).toBe("hello there");
    expect(appendDictatedText("hello", "there")).toBe("hello there");
  });

  it("leaves the draft alone when the transcript is blank", () => {
    expect(appendDictatedText("typed so far", "   ")).toBe("typed so far");
  });
});

describe("Toucan T10 multimodal composer preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.service.greeting.mockReturnValue("Squawk! Test greeting.");
    h.service.loadLatestConversation.mockResolvedValue(null);
  });

  afterEach(cleanup);

  it("renders both actions as inert 'coming soon' buttons when no seam is wired", async () => {
    await setup();
    const attach = screen.getByLabelText("Attach a file (coming soon)") as HTMLButtonElement;
    const dictate = screen.getByLabelText("Dictate a message (coming soon)") as HTMLButtonElement;
    expect(attach.disabled).toBe(true);
    expect(dictate.disabled).toBe(true);
    // Clicking a disabled button is a no-op — nothing opens, nothing records.
    fireEvent.click(attach);
    fireEvent.click(dictate);
    expect(screen.queryByLabelText("Attachments")).toBeNull();
  });

  it("renders no attachment preview area while nothing is staged", async () => {
    await setup({ onRequestAttachment: vi.fn() });
    expect(screen.queryByLabelText("Attachments")).toBeNull();
  });

  it("stages attachment metadata through the seam and lets it be removed", async () => {
    const items: ToucanDraftAttachment[] = [{ id: "a-1", name: "budget.pdf", mimeType: "application/pdf" }];
    await setup({ onRequestAttachment: (add) => add(items) });

    fireEvent.click(screen.getByLabelText("Attach a file"));
    expect(screen.getByLabelText("Attachments")).toBeTruthy();
    expect(screen.getByText("budget.pdf")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Remove budget.pdf"));
    expect(screen.queryByLabelText("Attachments")).toBeNull();
  });

  it("staging an attachment sends nothing and changes no request", async () => {
    const items: ToucanDraftAttachment[] = [{ id: "a-1", name: "budget.pdf" }];
    await setup({ onRequestAttachment: (add) => add(items) });
    fireEvent.click(screen.getByLabelText("Attach a file"));
    expect(h.service.ask).not.toHaveBeenCalled();
  });

  it("inserts a dictated transcript into the existing draft", async () => {
    await setup({ onRequestDictation: (insert) => insert("who is online") });

    fireEvent.change(composer(), { target: { value: "hey" } });
    fireEvent.click(screen.getByLabelText("Dictate a message"));

    expect(composer().value).toBe("hey who is online");
    // Dictated text is ordinary draft text: Send is enabled by it.
    expect((screen.getByLabelText("Send") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Enter-to-send and the existing text-only ask contract intact", async () => {
    h.service.ask.mockResolvedValue({
      text: "Squawk!",
      intent: "ai_response",
      supported: true,
      conversationId: "c-1",
    });
    const items: ToucanDraftAttachment[] = [{ id: "a-1", name: "budget.pdf" }];
    await setup({ onRequestAttachment: (add) => add(items) });

    fireEvent.click(screen.getByLabelText("Attach a file"));
    fireEvent.change(composer(), { target: { value: "who is online?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await flush();

    expect(h.service.ask).toHaveBeenCalledTimes(1);
    const request = h.service.ask.mock.calls[0][0];
    expect(request.question).toBe("who is online?");
    expect(Object.keys(request).sort()).toEqual(["conversationId", "history", "question"]);
    // The staged attachment is cleared with the draft it belonged to.
    expect(screen.queryByLabelText("Attachments")).toBeNull();
  });
});
