import { useEffect, useRef, useState } from "react";
// Messenger-style presentation is reused WHOLESALE from the existing chat
// window's stylesheet — same bubbles, alignment, radii, typography, spacing,
// scrolling column, composer and send button — so the Toucan reads as another
// polished communication surface in the same product. Styles ONLY: no
// ChatService, no ChatMessage/Conversation, no conversation id, no socket
// events, no unread/mention/receipt/reaction plumbing, no persistence. None of
// the chat components themselves were modified.
import chat from "../Chat/ConversationView.module.css";
import styles from "./ToucanAssistantPanel.module.css";

// ---------------------------------------------------------------------------
// Stage 1 Toucan assistant panel — MOCK ONLY.
//
// Every reply below is a local canned string returned after a short
// setTimeout. The panel exists to perfect the assistant UX before any
// provider, backend route or API key is involved; the mock block is the one
// thing that gets replaced when a real model lands.
//
// The transcript is local component state and dies with the component.
//
// DIVISION OF LABOUR (deliberate, see the task spec):
//   - THIS PANEL carries the meaningful assistant conversation.
//   - The world-space pill above the bird carries BIRD TALK ONLY
//     ("Squawk squawk…", owned by ToucanFlyer). It must never mirror a real
//     response. That's why `onPendingChange` below reports only a boolean —
//     there is no channel through which response text could reach the bird.
// ---------------------------------------------------------------------------

type Turn = { id: number; role: "user" | "toucan"; text: string; sentAt: string };

const GREETING =
  "Squawk! I'm the office toucan — parked right beside you. Ask me anything. (Demo replies for now.)";

// MOCK reply selection: keyword table first, then a deterministic rotation by
// turn number, so the same conversation always produces the same replies (no
// Math.random — repeatable for manual and automated checks alike).
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

const MOCK_REPLY_DELAY_MS = 1100;

function mockReplyFor(prompt: string, turnNumber: number): string {
  const hit = MOCK_KEYWORD_REPLIES.find((r) => r.match.test(prompt));
  if (hit) return hit.reply;
  return MOCK_FALLBACK_REPLIES[turnNumber % MOCK_FALLBACK_REPLIES.length];
}

// Same formatting the chat windows use for a message's time (see
// ConversationView's own formatMessageTime).
function formatMessageTime(sentAt: string): string {
  return new Date(sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type ToucanAssistantPanelProps = {
  // Dismiss/release — closes the panel AND sends the bird back to roaming
  // (the caller owns both, see OfficeMap's releaseToucan).
  onRelease: () => void;
  // Reports ONLY whether a reply is being prepared. The bird's bubble is
  // driven from this boolean, never from response text.
  onPendingChange?: (pending: boolean) => void;
  // Real keystroke activity, with the same idle timeout the chat composer
  // uses (see ConversationView's TYPING_IDLE_MS). The caller feeds this into
  // the office's EXISTING character talking/typing animation seam — this
  // component neither knows nor cares which animation that is.
  onTypingChange?: (isTyping: boolean) => void;
};

// Matches ConversationView's own TYPING_IDLE_MS, so the character stops
// "talking" after exactly as long a pause as it does in normal chat.
const TYPING_IDLE_MS = 2500;

export function ToucanAssistantPanel({
  onRelease,
  onPendingChange,
  onTypingChange,
}: ToucanAssistantPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([
    { id: 0, role: "toucan", text: GREETING, sentAt: new Date().toISOString() },
  ]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const nextIdRef = useRef(1);
  const replyTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Clear the pending mock-reply timer on unmount, so a panel dismissed
  // mid-"thinking" never fires setState (or leaves the bird squawking).
  useEffect(() => {
    return () => {
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    };
  }, []);

  const onPendingChangeRef = useRef(onPendingChange);
  onPendingChangeRef.current = onPendingChange;
  useEffect(() => {
    onPendingChangeRef.current?.(pending);
  }, [pending]);
  // The bird's bubble is owned outside this component — make sure it is
  // cleared when the panel goes away for any reason (release, checkout,
  // unmount).
  useEffect(() => {
    return () => onPendingChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const onTypingChangeRef = useRef(onTypingChange);
  onTypingChangeRef.current = onTypingChange;

  // Same shape as ConversationView.handleDraftChange: an empty draft stops
  // immediately, any keystroke starts and re-arms the idle timer.
  function reportTyping(nextDraft: string) {
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (!nextDraft.trim()) {
      onTypingChangeRef.current?.(false);
      return;
    }
    onTypingChangeRef.current?.(true);
    typingTimerRef.current = window.setTimeout(() => {
      typingTimerRef.current = null;
      onTypingChangeRef.current?.(false);
    }, TYPING_IDLE_MS);
  }

  function stopTyping() {
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    onTypingChangeRef.current?.(false);
  }

  // The character must never be left stuck in the talking animation — clear
  // it (and the timer) whenever the panel goes away, for any reason.
  useEffect(() => {
    return () => {
      if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
      onTypingChangeRef.current?.(false);
    };
  }, []);

  function handleSend() {
    const text = draft.trim();
    // Same empty-send guard the chat composer uses: the button is never
    // disabled, the handler simply does nothing.
    if (!text || pending) return;
    const turnNumber = turns.filter((t) => t.role === "user").length;
    setTurns((prev) => [
      ...prev,
      { id: nextIdRef.current++, role: "user", text, sentAt: new Date().toISOString() },
    ]);
    setDraft("");
    stopTyping();
    setPending(true);
    // MOCK: local delay, no network.
    replyTimerRef.current = window.setTimeout(() => {
      replyTimerRef.current = null;
      setTurns((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          role: "toucan",
          text: mockReplyFor(text, turnNumber),
          sentAt: new Date().toISOString(),
        },
      ]);
      setPending(false);
    }, MOCK_REPLY_DELAY_MS);
  }

  return (
    <div className={`${chat.panel} ${styles.panel}`} role="dialog" aria-label="Toucan Assistant">
      <div className={chat.header}>
        <div className={`${chat.headerAvatar} ${styles.headerAvatar}`}>🦜</div>
        <div className={chat.headerText}>
          <div className={chat.titleRow}>
            <span className={chat.title}>Toucan Assistant</span>
            <span className={styles.demoBadge}>DEMO</span>
          </div>
          <span className={chat.subtitle}>Perched beside you</span>
        </div>
        <div className={chat.headerActions}>
          <button
            type="button"
            className={chat.closeButton}
            onClick={onRelease}
            aria-label="Dismiss the toucan"
          >
            ×
          </button>
        </div>
      </div>

      <div className={chat.messages} ref={messagesRef}>
        {turns.map((turn) => {
          const isOwn = turn.role === "user";
          return (
            <div key={turn.id} className={isOwn ? `${chat.row} ${chat.rowSelf}` : chat.row}>
              {!isOwn && <div className={`${chat.avatar} ${styles.toucanAvatar}`}>🦜</div>}
              <div className={chat.bubbleColumn}>
                <div className={`${chat.message} ${isOwn ? chat.own : chat.peer}`}>{turn.text}</div>
                <span className={isOwn ? `${chat.timestamp} ${chat.timestampRight}` : chat.timestamp}>
                  {formatMessageTime(turn.sentAt)}
                </span>
              </div>
            </div>
          );
        })}
        {pending && (
          // "Toucan is typing" — a normal received bubble carrying the
          // office's established animated dots (same 1s stagger as the
          // world-space TalkingBubble), NOT a special assistant card.
          <div className={chat.row} data-testid="toucan-typing">
            <div className={`${chat.avatar} ${styles.toucanAvatar}`}>🦜</div>
            <div className={chat.bubbleColumn}>
              <div className={`${chat.message} ${chat.peer} ${styles.typingBubble}`}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={chat.composer}>
        <textarea
          ref={textareaRef}
          className={chat.textarea}
          value={draft}
          placeholder="Ask the toucan…"
          aria-label="Message the toucan"
          rows={1}
          onChange={(e) => {
            setDraft(e.target.value);
            reportTyping(e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter newlines — same as the chat composer.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button type="button" className={chat.sendButton} onClick={handleSend} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M3 11.5L21 3l-7.5 18-2.5-7.5L3 11.5z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>

      {/* Release control, styled like the chat window's own pinned helper line
          rather than as a message. The header × does the same thing. */}
      <button type="button" className={styles.release} onClick={onRelease}>
        Let the toucan go
      </button>
    </div>
  );
}

export default ToucanAssistantPanel;
