import type { ToucanAnswer, ToucanAskOptions, ToucanAskRequest, ToucanService } from "./types";

// Canned-reply Toucan, lifted VERBATIM out of ToucanAssistantPanel.tsx so the
// panel holds no reply logic of its own. Same strings, same 1100ms delay, same
// deterministic keyword-then-rotation selection — mock mode's behaviour is
// unchanged by the move (ToucanAssistantPanel.test.tsx asserts these exact
// strings and that timing).
//
// No Math.random anywhere: the same conversation always produces the same
// replies, so manual and automated checks stay repeatable.

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

function mockReplyFor(prompt: string, turnNumber: number): string {
  const hit = MOCK_KEYWORD_REPLIES.find((r) => r.match.test(prompt));
  if (hit) return hit.reply;
  return MOCK_FALLBACK_REPLIES[turnNumber % MOCK_FALLBACK_REPLIES.length];
}

export class MockToucanService implements ToucanService {
  greeting(): string {
    return GREETING;
  }

  ask(request: ToucanAskRequest, options: ToucanAskOptions = {}): Promise<ToucanAnswer> {
    // The rotation index used to be the panel's running count of user turns.
    // It is now counted from the bounded history the caller sends, which is the
    // same number for any conversation short enough to fit the window.
    const turnNumber = request.history.filter((turn) => turn.role === "user").length;
    const reply = mockReplyFor(request.question, turnNumber);

    return new Promise<ToucanAnswer>((resolve, reject) => {
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve({ text: reply, intent: "mock", supported: true });
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
