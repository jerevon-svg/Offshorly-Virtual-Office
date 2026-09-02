import {
  ToucanConversationGoneError,
  type ToucanAnswer,
  type ToucanAskOptions,
  type ToucanAskRequest,
  type ToucanConversation,
  type ToucanConversationDetail,
  type ToucanService,
  type ToucanStoredMessage,
} from "./types";

// Canned-reply Toucan, lifted VERBATIM out of ToucanAssistantPanel.tsx so the
// panel holds no reply logic of its own. Same strings, same 1100ms delay, same
// deterministic keyword-then-rotation selection — mock mode's behaviour is
// unchanged by the move (ToucanAssistantPanel.test.tsx asserts these exact
// strings and that timing).
//
// No Math.random anywhere: the same conversation always produces the same
// replies, so manual and automated checks stay repeatable.
//
// T1 PERSISTENCE, MOCK EDITION: the canned bird now keeps its conversations in a
// module-level map, so releasing and re-summoning the toucan reopens the same
// transcript exactly as real mode does. It is deliberately IN-MEMORY ONLY —
// nothing is written to localStorage or to a server — so a page reload starts
// clean. A mock that faked durable storage would be lying about the one property
// only the real backend can provide. The replies, the greeting and the 1100ms
// delay are untouched.

const GREETING =
  "Squawk! I'm the office toucan — parked right beside you. Ask me anything. (Demo replies for now.)";

const MOCK_KEYWORD_REPLIES: { match: RegExp; reply: string }[] = [
  { match: /\bhello\b|\bhi\b|\bhey\b/i, reply: "Hello! Nice to perch beside you." },
  { match: /who|what are you/i, reply: "I'm the office toucan. Right now I only know how to be a demo." },
  { match: /where/i, reply: "I can't look people up yet — that arrives once I'm wired to the office data." },
  { match: /room|meeting/i, reply: "Room awareness isn't plugged in yet. Ask me again in a later stage." },
  { match: /help/i, reply: "Ask away. Real answers arrive when my brain is connected." },
];

const MOCK_FALLBACK_REPLIES = [
  "Got it. I can't answer that for real yet — I'm still a mock bird.",
  "Noted! A real assistant will pick this up in a later stage.",
  "Squawk. Placeholder reply — the interaction works, the brain doesn't.",
];

export const MOCK_REPLY_DELAY_MS = 1100;

// Mirrors the server's derive_title (repositories/toucan.py): the opening
// question, whitespace-collapsed and cut. Same 60-char budget.
const MOCK_TITLE_CHARS = 60;

function mockTitle(firstQuestion: string): string {
  const collapsed = firstQuestion.split(/\s+/).filter(Boolean).join(" ");
  return collapsed.length <= MOCK_TITLE_CHARS
    ? collapsed
    : `${collapsed.slice(0, MOCK_TITLE_CHARS - 1).trimEnd()}…`;
}

type MockConversation = ToucanConversation & { messages: ToucanStoredMessage[] };

const mockConversations = new Map<string, MockConversation>();
let mockIdCounter = 0;

function nextMockId(prefix: string): string {
  mockIdCounter += 1;
  return `mock-${prefix}-${mockIdCounter}`;
}

/** Test-only reset so one spec's conversations never leak into the next. Not
 *  called by the app — a real page load discards the map anyway. */
export function resetMockToucanConversations(): void {
  mockConversations.clear();
  mockIdCounter = 0;
}

function newMockConversation(): MockConversation {
  const now = new Date().toISOString();
  const conversation: MockConversation = {
    id: nextMockId("conv"),
    title: null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  mockConversations.set(conversation.id, conversation);
  return conversation;
}

function toDetail(conversation: MockConversation): ToucanConversationDetail {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    // Copies, so a caller mutating what it got back cannot corrupt the store.
    messages: conversation.messages.map((m) => ({ ...m })),
  };
}

function mockReplyFor(prompt: string, turnNumber: number): string {
  const hit = MOCK_KEYWORD_REPLIES.find((r) => r.match.test(prompt));
  if (hit) return hit.reply;
  return MOCK_FALLBACK_REPLIES[turnNumber % MOCK_FALLBACK_REPLIES.length];
}

export class MockToucanService implements ToucanService {
  greeting(): string {
    return GREETING;
  }

  async loadLatestConversation(): Promise<ToucanConversationDetail | null> {
    // Most recently talked in, matching the server's ORDER BY updated_at DESC.
    let latest: MockConversation | null = null;
    for (const conversation of mockConversations.values()) {
      if (!latest || conversation.updatedAt >= latest.updatedAt) latest = conversation;
    }
    return latest ? toDetail(latest) : null;
  }

  async createConversation(): Promise<ToucanConversation> {
    const { messages: _messages, ...metadata } = newMockConversation();
    return metadata;
  }

  async listConversations(): Promise<ToucanConversation[]> {
    // Metadata only, most recently used first — same ordering the server's
    // ORDER BY updated_at DESC produces.
    return [...mockConversations.values()]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .map(({ messages: _messages, ...metadata }) => metadata);
  }

  async loadConversation(conversationId: string): Promise<ToucanConversationDetail> {
    const conversation = mockConversations.get(conversationId);
    if (!conversation) throw new ToucanConversationGoneError(conversationId);
    return toDetail(conversation);
  }

  ask(request: ToucanAskRequest, options: ToucanAskOptions = {}): Promise<ToucanAnswer> {
    // The rotation index used to be the panel's running count of user turns.
    // It is now counted from the bounded history the caller sends, which is the
    // same number for any conversation short enough to fit the window.
    const turnNumber = request.history.filter((turn) => turn.role === "user").length;
    const reply = mockReplyFor(request.question, turnNumber);

    // Resolve the conversation BEFORE the delay, so a bad id fails immediately
    // and nothing is ever half-written — same ordering as the real router.
    let conversation: MockConversation;
    if (request.conversationId) {
      const existing = mockConversations.get(request.conversationId);
      if (!existing) return Promise.reject(new ToucanConversationGoneError(request.conversationId));
      conversation = existing;
    } else {
      conversation = newMockConversation();
    }

    return new Promise<ToucanAnswer>((resolve, reject) => {
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", onAbort);
        // Both turns land together, exactly as the server persists them.
        const now = new Date().toISOString();
        conversation.messages.push(
          { id: nextMockId("msg"), role: "user", content: request.question, createdAt: now },
          { id: nextMockId("msg"), role: "assistant", content: reply, createdAt: now },
        );
        if (!conversation.title) conversation.title = mockTitle(request.question);
        conversation.updatedAt = now;
        resolve({ text: reply, intent: "mock", supported: true, conversationId: conversation.id });
      }, MOCK_REPLY_DELAY_MS);

      function onAbort() {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }

      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export const mockToucanService = new MockToucanService();
