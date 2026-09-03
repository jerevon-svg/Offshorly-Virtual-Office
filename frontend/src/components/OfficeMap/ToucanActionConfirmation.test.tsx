import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// T8 — the confirmation card: the ONE surface through which a proposed action can
// execute. These tests drive the panel against a fully faked service, proving:
//   * an answer carrying a proposal renders the card and EXECUTES NOTHING
//   * Confirm is the only executing gesture — it consumes the id and applies the
//     SERVER-RETURNED frozen effect through the (mocked) product status path
//   * Cancel burns the proposal and applies nothing
//   * an expired id words itself safely, and an ordinary answer shows no card
//   * typing a new question drops the card (the proposal just expires unserved)

const h = vi.hoisted(() => {
  const service = {
    greeting: vi.fn(() => "Squawk! Test greeting."),
    ask: vi.fn(),
    loadLatestConversation: vi.fn(async () => null),
    createConversation: vi.fn(),
    listConversations: vi.fn(async () => []),
    loadConversation: vi.fn(),
    confirmAction: vi.fn(),
    cancelAction: vi.fn(),
  };
  return {
    service,
    applyToucanStatus: vi.fn((): ToucanApplyResult => ({ ok: true })),
    canApplyToucanStatus: vi.fn((): ToucanApplyResult => ({ ok: true })),
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

import { ToucanActionUnavailableError, type ToucanApplyResult } from "../../services/toucan";
import { ToucanAssistantPanel } from "./ToucanAssistantPanel";

const PROPOSAL = {
  id: "act-1",
  action: "set_status" as const,
  status: "BUSY",
  dndMinutes: null,
  summary: "Set your status to Busy",
  expiresAt: "2026-09-02T12:02:00.000Z",
};

const PROPOSAL_ANSWER = {
  text: "I can set your status to Busy. Nothing has changed yet — confirm below and I'll do it.",
  intent: "action_proposal",
  supported: true,
  conversationId: "c-1",
  action: PROPOSAL,
};

const EXECUTED_RESULT = {
  id: "act-1",
  outcome: "executed" as const,
  action: "set_status" as const,
  status: "BUSY",
  dndMinutes: null,
  summary: "Set your status to Busy",
  text: "Done — your status is now Busy.",
};

describe("ToucanAssistantPanel — T8 action confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.service.loadLatestConversation.mockResolvedValue(null);
    h.service.listConversations.mockResolvedValue([]);
    h.canApplyToucanStatus.mockReturnValue({ ok: true });
    h.applyToucanStatus.mockReturnValue({ ok: true });
  });
  afterEach(cleanup);

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  const setup = async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flush();
  };

  const sendQuestion = async (text: string) => {
    fireEvent.change(screen.getByLabelText("Message the toucan"), { target: { value: text } });
    fireEvent.keyDown(screen.getByLabelText("Message the toucan"), { key: "Enter" });
    await flush();
  };

  it("renders the confirmation card for a proposal answer, and executes nothing by itself", async () => {
    h.service.ask.mockResolvedValue(PROPOSAL_ANSWER);
    await setup();
    await sendQuestion("Set me to busy.");

    const card = screen.getByTestId("toucan-action-card");
    expect(card.textContent).toContain("Set your status to Busy");
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
    // Receiving the proposal changed nothing.
    expect(h.service.confirmAction).not.toHaveBeenCalled();
    expect(h.applyToucanStatus).not.toHaveBeenCalled();
  });

  it("Confirm consumes the id and applies the server-returned frozen effect", async () => {
    h.service.ask.mockResolvedValue(PROPOSAL_ANSWER);
    h.service.confirmAction.mockResolvedValue(EXECUTED_RESULT);
    await setup();
    await sendQuestion("Set me to busy.");

    fireEvent.click(screen.getByText("Confirm"));
    await flush();

    expect(h.service.confirmAction).toHaveBeenCalledWith("act-1");
    // Applied from the RESULT's fields — the server-frozen args.
    expect(h.applyToucanStatus).toHaveBeenCalledWith({ status: "BUSY", dndMinutes: null });
    expect(screen.getByText("Done — your status is now Busy.")).toBeTruthy();
    expect(screen.queryByTestId("toucan-action-card")).toBeNull();
  });

  it("Cancel burns the proposal and applies nothing", async () => {
    h.service.ask.mockResolvedValue(PROPOSAL_ANSWER);
    h.service.cancelAction.mockResolvedValue({
      ...EXECUTED_RESULT,
      outcome: "cancelled" as const,
      text: "Okay, cancelled — I haven't changed your status.",
    });
    await setup();
    await sendQuestion("Set me to busy.");

    fireEvent.click(screen.getByText("Cancel"));
    await flush();

    expect(h.service.cancelAction).toHaveBeenCalledWith("act-1");
    expect(h.applyToucanStatus).not.toHaveBeenCalled();
    expect(screen.getByText("Okay, cancelled — I haven't changed your status.")).toBeTruthy();
    expect(screen.queryByTestId("toucan-action-card")).toBeNull();
  });

  it("words an expired/consumed proposal safely instead of claiming success", async () => {
    h.service.ask.mockResolvedValue(PROPOSAL_ANSWER);
    h.service.confirmAction.mockRejectedValue(new ToucanActionUnavailableError("act-1"));
    await setup();
    await sendQuestion("Set me to busy.");

    fireEvent.click(screen.getByText("Confirm"));
    await flush();

    expect(h.applyToucanStatus).not.toHaveBeenCalled();
    expect(screen.getByText(/expired before it was confirmed/)).toBeTruthy();
    expect(screen.queryByTestId("toucan-action-card")).toBeNull();
  });

  it("refuses the confirm locally when the effect cannot apply (DND allowance), consuming nothing", async () => {
    h.service.ask.mockResolvedValue(PROPOSAL_ANSWER);
    h.canApplyToucanStatus.mockReturnValue({ ok: false, reason: "Squawk — allowance used up." });
    h.service.cancelAction.mockResolvedValue({ ...EXECUTED_RESULT, outcome: "cancelled" as const });
    await setup();
    await sendQuestion("Set me to busy.");

    fireEvent.click(screen.getByText("Confirm"));
    await flush();

    expect(h.service.confirmAction).not.toHaveBeenCalled();
    expect(h.applyToucanStatus).not.toHaveBeenCalled();
    expect(screen.getByText("Squawk — allowance used up.")).toBeTruthy();
  });

  it("shows no card for an ordinary answer", async () => {
    h.service.ask.mockResolvedValue({
      text: "Just an answer.",
      intent: "ai_response",
      supported: true,
      conversationId: "c-1",
    });
    await setup();
    await sendQuestion("who is online");
    expect(screen.queryByTestId("toucan-action-card")).toBeNull();
  });

  it("drops the card when a new question is asked — the proposal expires unserved", async () => {
    h.service.ask
      .mockResolvedValueOnce(PROPOSAL_ANSWER)
      .mockResolvedValueOnce({
        text: "Another answer.",
        intent: "ai_response",
        supported: true,
        conversationId: "c-1",
      });
    await setup();
    await sendQuestion("Set me to busy.");
    expect(screen.getByTestId("toucan-action-card")).toBeTruthy();

    await sendQuestion("actually, who is online?");
    expect(screen.queryByTestId("toucan-action-card")).toBeNull();
    expect(h.service.confirmAction).not.toHaveBeenCalled();
  });
});

// A1 — send_message rides the same card and the same two buttons, but its
// execution is entirely server-side: the panel must show recipient + exact text
// before Confirm, and must never route a send outcome through the status path.
const SEND_PROPOSAL = {
  id: "act-2",
  action: "send_message" as const,
  recipientEmail: "micah@example.com",
  recipientLabel: "Micah Reyes",
  message: "I'll be back at 3.",
  summary: "Send message to Micah Reyes",
  expiresAt: "2026-09-02T12:02:00.000Z",
};

const SEND_ANSWER = {
  text: "I can send this to Micah Reyes: “I'll be back at 3.” Nothing has been sent yet — confirm below and I'll send it.",
  intent: "action_proposal",
  supported: true,
  conversationId: "c-1",
  action: SEND_PROPOSAL,
};

const SENT_RESULT = {
  id: "act-2",
  outcome: "executed" as const,
  action: "send_message" as const,
  recipientEmail: "micah@example.com",
  recipientLabel: "Micah Reyes",
  message: "I'll be back at 3.",
  conversationId: "conv-1",
  messageId: "m-1",
  summary: "Send message to Micah Reyes",
  text: "Done — I sent your message to Micah Reyes.",
};

describe("ToucanAssistantPanel — A1 send_message confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.service.loadLatestConversation.mockResolvedValue(null);
    h.service.listConversations.mockResolvedValue([]);
    h.canApplyToucanStatus.mockReturnValue({ ok: true });
    h.applyToucanStatus.mockReturnValue({ ok: true });
  });
  afterEach(cleanup);

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  const setup = async () => {
    render(<ToucanAssistantPanel onRelease={vi.fn()} />);
    await flush();
  };

  const sendQuestion = async (text: string) => {
    fireEvent.change(screen.getByLabelText("Message the toucan"), { target: { value: text } });
    fireEvent.keyDown(screen.getByLabelText("Message the toucan"), { key: "Enter" });
    await flush();
  };

  it("shows the recipient AND the exact message on the card, and sends nothing by itself", async () => {
    h.service.ask.mockResolvedValue(SEND_ANSWER);
    await setup();
    await sendQuestion("Message Micah that I'll be back at 3.");

    const card = screen.getByTestId("toucan-action-card");
    expect(card.textContent).toContain("Send message to Micah Reyes");
    expect(screen.getByTestId("toucan-action-message").textContent).toBe("I'll be back at 3.");
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(h.service.confirmAction).not.toHaveBeenCalled();
    expect(h.applyToucanStatus).not.toHaveBeenCalled();
  });

  it("Confirm consumes the id, reports the send, and never touches the status path", async () => {
    h.service.ask.mockResolvedValue(SEND_ANSWER);
    h.service.confirmAction.mockResolvedValue(SENT_RESULT);
    await setup();
    await sendQuestion("Message Micah that I'll be back at 3.");

    fireEvent.click(screen.getByText("Confirm"));
    await flush();

    expect(h.service.confirmAction).toHaveBeenCalledWith("act-2");
    expect(h.canApplyToucanStatus).not.toHaveBeenCalled();
    expect(h.applyToucanStatus).not.toHaveBeenCalled();
    expect(screen.getByText("Done — I sent your message to Micah Reyes.")).toBeTruthy();
    expect(screen.queryByTestId("toucan-action-card")).toBeNull();
  });

  it("Cancel sends nothing", async () => {
    h.service.ask.mockResolvedValue(SEND_ANSWER);
    h.service.cancelAction.mockResolvedValue({
      ...SENT_RESULT,
      outcome: "cancelled" as const,
      conversationId: null,
      messageId: null,
      text: "Okay, cancelled — I haven't sent anything.",
    });
    await setup();
    await sendQuestion("Message Micah that I'll be back at 3.");

    fireEvent.click(screen.getByText("Cancel"));
    await flush();

    expect(h.service.cancelAction).toHaveBeenCalledWith("act-2");
    expect(h.service.confirmAction).not.toHaveBeenCalled();
    expect(h.applyToucanStatus).not.toHaveBeenCalled();
    expect(screen.getByText("Okay, cancelled — I haven't sent anything.")).toBeTruthy();
  });

  it("an expired send proposal is worded safely and sends nothing", async () => {
    h.service.ask.mockResolvedValue(SEND_ANSWER);
    h.service.confirmAction.mockRejectedValue(new ToucanActionUnavailableError("act-2"));
    await setup();
    await sendQuestion("Message Micah that I'll be back at 3.");

    fireEvent.click(screen.getByText("Confirm"));
    await flush();

    expect(h.applyToucanStatus).not.toHaveBeenCalled();
    expect(screen.queryByText("Done — I sent your message to Micah Reyes.")).toBeNull();
    expect(screen.queryByTestId("toucan-action-card")).toBeNull();
  });
});
