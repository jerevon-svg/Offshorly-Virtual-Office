import { useCallback, useEffect, useRef, useState } from "react";
// Messenger-style presentation is reused WHOLESALE from the existing chat
// window's stylesheet — same bubbles, alignment, radii, typography, spacing,
// scrolling column, composer and send button — so the Toucan reads as another
// polished communication surface in the same product. Styles ONLY: no
// ChatService, no ChatMessage/Conversation, no conversation id, no socket
// events, no unread/mention/receipt/reaction plumbing, no persistence. None of
// the chat components themselves were modified.
import chat from "../Chat/ConversationView.module.css";
import styles from "./ToucanAssistantPanel.module.css";
import {
  toucanService,
  ToucanConversationGoneError,
  turnRoleFromStored,
  TOUCAN_HISTORY_TURNS,
  type ToucanConversation,
  type ToucanConversationDetail,
} from "../../services/toucan";

// ---------------------------------------------------------------------------
// Toucan assistant panel.
//
// This component owns PRESENTATION AND CONVERSATION STATE ONLY. Every reply now
// comes from the swappable toucanService (frontend/src/services/toucan/):
//   - mock mode  -> MockToucanService, the same canned strings and 1100ms delay
//                   that used to live in this file, moved verbatim
//   - real mode  -> RealToucanService, POST /toucan/ask on the VO backend
// Nothing about the panel's appearance, the composer, the typing signal or the
// release behaviour changed when the reply logic moved out.
//
// T1 — PERSISTENT CONVERSATIONS. The transcript is still local component state,
// but it is now SEEDED FROM and WRITTEN THROUGH the toucanService:
//
//   MOUNT      -> loadLatestConversation(). A transcript comes back, it is
//                 restored; null comes back (nobody has ever asked anything) and
//                 the greeting is shown instead.
//   ASK        -> the conversation id rides along, and the server persists BOTH
//                 the question and the reply.
//   NEW        -> createConversation(), then the transcript resets to the
//                 greeting. Created eagerly so a refresh straight afterwards
//                 restores the NEW conversation, not the previous one.
//   HISTORY    -> listConversations() on demand, then loadConversation(id) to
//                 reopen one. Both are READS. Opening History creates nothing and
//                 deletes nothing; picking a conversation only changes which id
//                 the next question is appended to.
//   RELEASE    -> closes the panel and nothing else. It DOES NOT delete
//                 anything: re-summoning takes the MOUNT path above and lands
//                 back in the same conversation.
//
// The greeting itself is never persisted — it is a per-mount opening line, shown
// only when there is no transcript to show, so a restored conversation is not
// topped with a fresh "hello" every time the bird is summoned.
//
// DIVISION OF LABOUR (deliberate, unchanged):
//   - THIS PANEL carries the meaningful assistant conversation.
//   - The world-space pill above the bird carries BIRD TALK ONLY
//     ("Squawk squawk…", owned by ToucanFlyer). It must never mirror a real
//     response. That's why `onPendingChange` below reports only a boolean —
//     there is no channel through which response text could reach the bird.
// ---------------------------------------------------------------------------

type Turn = { id: number; role: "user" | "toucan"; text: string; sentAt: string };

// Shown when the request itself fails (network down, backend asleep, aborted
// by something other than release). A plain toucan turn — no new UI surface.
const REQUEST_FAILED_TEXT =
  "Squawk — I couldn't reach the office just now. Try asking me again in a moment.";

// Shown when the conversation the panel was holding has gone (deleted from
// another tab, say). The next question simply starts a new one — no dead end.
const CONVERSATION_GONE_TEXT =
  "Squawk — that conversation isn't there any more. Ask me again and I'll start a fresh one.";

// History popover copy. Deliberately plain strings rather than new UI surfaces.
const HISTORY_EMPTY_TEXT = "No saved conversations yet.";
const HISTORY_FAILED_TEXT = "Couldn't load your conversations.";
// A conversation created by "New conversation" has no title until its first
// question, so the list needs a stand-in label for it.
const UNTITLED_CONVERSATION_LABEL = "New conversation";

// Short, locale-aware day label beside each entry — enough to tell yesterday's
// conversation from last week's without turning the list into a table.
function formatConversationDate(updatedAt: string): string {
  return new Date(updatedAt).toLocaleDateString([], { month: "short", day: "numeric" });
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

function greetingTurn(id: number): Turn {
  return { id, role: "toucan", text: toucanService.greeting(), sentAt: new Date().toISOString() };
}

/** One saved conversation's transcript, as panel turns. Shared by the mount-time
 *  restore and by reopening from History, so both land in exactly the same
 *  state — there is no second way to display a conversation. */
function turnsFromConversation(conversation: ToucanConversationDetail): Turn[] {
  return conversation.messages.map((message, index) => ({
    id: index,
    role: turnRoleFromStored(message.role),
    text: message.content,
    sentAt: message.createdAt,
  }));
}

export function ToucanAssistantPanel({
  onRelease,
  onPendingChange,
  onTypingChange,
}: ToucanAssistantPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([greetingTurn(0)]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  // The conversation every question is appended to. Null until the restore below
  // finishes (or when the viewer has none yet) — a question asked in that window
  // simply creates one server-side, which is the same path the very first
  // question ever asked takes.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // True only while the initial restore is in flight. It suppresses the greeting
  // so a restored transcript never flashes a "hello" above itself first.
  const [restoring, setRestoring] = useState(true);
  // History popover. `historyItems` is null until a fetch has completed, which is
  // what distinguishes "still loading" from "genuinely no conversations".
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ToucanConversation[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const nextIdRef = useRef(1);
  const askAbortRef = useRef<AbortController | null>(null);
  const restoreAbortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Abort an in-flight question on unmount, so a panel dismissed mid-"thinking"
  // never fires setState (or leaves the bird squawking).
  useEffect(() => {
    return () => askAbortRef.current?.abort();
  }, []);

  // RESTORE, on every mount — which is exactly once per summoned session, and
  // again on a page refresh. Release unmounts the panel; re-summon mounts a new
  // one and lands right back here, which is what makes a conversation survive
  // both. A failure is non-fatal: the panel falls back to the greeting and a
  // fresh conversation rather than refusing to open.
  useEffect(() => {
    const controller = new AbortController();
    restoreAbortRef.current = controller;

    void toucanService
      .loadLatestConversation({ signal: controller.signal })
      .then((conversation) => {
        if (controller.signal.aborted || !conversation) return;
        setConversationId(conversation.id);
        if (conversation.messages.length === 0) return;
        setTurns(turnsFromConversation(conversation));
        nextIdRef.current = conversation.messages.length;
      })
      .catch(() => {
        // Offline, or the backend is asleep. Nothing to restore — carry on with
        // the greeting; the next question starts a new conversation.
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false);
      });

    return () => controller.abort();
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

  // Everything that swaps which conversation the panel is showing goes through
  // here: abandon any in-flight question (it belongs to the conversation being
  // left), clear the composer, and close History. It does not itself decide what
  // to show next — the two callers below do.
  const leaveCurrentConversation = useCallback(() => {
    askAbortRef.current?.abort();
    askAbortRef.current = null;
    setPending(false);
    setDraft("");
    setHistoryOpen(false);
  }, []);

  // "New conversation": a real, empty, server-side conversation, then a clean
  // transcript. Eager creation is the point — see the module note above.
  const handleNewConversation = useCallback(() => {
    if (pending) return;
    leaveCurrentConversation();
    nextIdRef.current = 1;
    setTurns([greetingTurn(0)]);
    setConversationId(null);

    void toucanService
      .createConversation()
      .then((conversation) => {
        setConversationId(conversation.id);
        // The new conversation belongs at the top of History next time it opens.
        setHistoryItems(null);
      })
      .catch(() => {
        // Leaving conversationId null is already correct: the next question
        // creates a conversation server-side anyway.
      });
  }, [pending, leaveCurrentConversation]);

  // HISTORY. Opening it is a READ and nothing else — no conversation is created,
  // none is deleted, and the one currently on screen stays selected until the
  // viewer actually picks a different one.
  const handleToggleHistory = useCallback(() => {
    setHistoryOpen((wasOpen) => {
      if (wasOpen) return false;
      setHistoryFailed(false);
      // Refetched on each open rather than cached, so a conversation just
      // continued shows in the right place without any invalidation plumbing.
      void toucanService
        .listConversations()
        .then(setHistoryItems)
        .catch(() => {
          setHistoryItems([]);
          setHistoryFailed(true);
        });
      return true;
    });
  }, []);

  // Reopen a saved conversation. Selecting the one already on screen is a no-op
  // beyond closing the popover — no refetch, and nothing thrown away.
  const handleSelectConversation = useCallback(
    (id: string) => {
      if (pending) return;
      if (id === conversationId) {
        setHistoryOpen(false);
        return;
      }
      leaveCurrentConversation();

      void toucanService
        .loadConversation(id)
        .then((conversation) => {
          setConversationId(conversation.id);
          const restored = turnsFromConversation(conversation);
          // An empty saved conversation shows the greeting, exactly as a freshly
          // created one does.
          setTurns(restored.length > 0 ? restored : [greetingTurn(0)]);
          nextIdRef.current = Math.max(restored.length, 1);
        })
        .catch(() => {
          // Gone, or unreachable. Say so in the transcript rather than silently
          // leaving the panel on a conversation the viewer thinks they left.
          setConversationId(null);
          nextIdRef.current = 1;
          setTurns([
            {
              id: 0,
              role: "toucan",
              text: CONVERSATION_GONE_TEXT,
              sentAt: new Date().toISOString(),
            },
          ]);
        });
    },
    [pending, conversationId, leaveCurrentConversation],
  );

  function handleSend() {
    const text = draft.trim();
    // Same empty-send guard the chat composer uses: the button is never
    // disabled, the handler simply does nothing.
    if (!text || pending) return;
    // Bounded history, oldest-trimmed. The backend re-validates this limit — the
    // client trimming here only avoids a pointless 422.
    const history = turns
      .slice(-TOUCAN_HISTORY_TURNS)
      .map((turn) => ({ role: turn.role, text: turn.text }));
    setTurns((prev) => [
      ...prev,
      { id: nextIdRef.current++, role: "user", text, sentAt: new Date().toISOString() },
    ]);
    setDraft("");
    stopTyping();
    setPending(true);

    const controller = new AbortController();
    askAbortRef.current = controller;
    const appendReply = (replyText: string) => {
      if (controller.signal.aborted) return;
      setTurns((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          role: "toucan",
          text: replyText,
          sentAt: new Date().toISOString(),
        },
      ]);
    };

    void toucanService
      .ask({ question: text, history, conversationId }, { signal: controller.signal })
      .then((answer) => {
        // Tracks the conversation the server actually used — the one that was
        // sent, or the one it created because none was.
        if (!controller.signal.aborted) setConversationId(answer.conversationId);
        appendReply(answer.text);
      })
      .catch((error: unknown) => {
        if (error instanceof ToucanConversationGoneError) {
          // Self-heal: drop the stale id so the next question starts fresh.
          if (!controller.signal.aborted) setConversationId(null);
          appendReply(CONVERSATION_GONE_TEXT);
          return;
        }
        appendReply(REQUEST_FAILED_TEXT);
      })
      .finally(() => {
        if (askAbortRef.current === controller) askAbortRef.current = null;
        // A panel unmounted mid-request has already reported pending=false via
        // the cleanup effect above; skip the setState on an aborted request.
        if (!controller.signal.aborted) setPending(false);
      });
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
          {/* History and "start over", both in the existing header action slot.
              A popover, deliberately not a sidebar: it lists titles and dates so
              a past conversation can be reopened, and does nothing else — no
              search, no rename, no delete. */}
          <button
            type="button"
            className={`${chat.closeButton} ${styles.newConversationButton}`}
            onClick={handleToggleHistory}
            aria-label="Conversation history"
            aria-expanded={historyOpen}
            title="History"
          >
            🕘
          </button>
          <button
            type="button"
            className={`${chat.closeButton} ${styles.newConversationButton}`}
            onClick={handleNewConversation}
            aria-label="Start a new conversation"
            title="New conversation"
          >
            ✎
          </button>
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

      {historyOpen && (
        <div className={styles.historyPopover} role="menu" aria-label="Saved conversations">
          {historyItems === null ? (
            <p className={styles.historyEmpty}>Loading…</p>
          ) : historyFailed ? (
            <p className={styles.historyEmpty}>{HISTORY_FAILED_TEXT}</p>
          ) : historyItems.length === 0 ? (
            <p className={styles.historyEmpty}>{HISTORY_EMPTY_TEXT}</p>
          ) : (
            // Already most-recent-first from the server; the panel does not
            // re-sort, so one ordering rule lives in one place.
            historyItems.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                role="menuitem"
                className={styles.historyItem}
                aria-current={conversation.id === conversationId}
                onClick={() => handleSelectConversation(conversation.id)}
              >
                <span className={styles.historyTitle}>
                  {conversation.title || UNTITLED_CONVERSATION_LABEL}
                </span>
                <span className={styles.historyDate}>
                  {formatConversationDate(conversation.updatedAt)}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <div className={chat.messages} ref={messagesRef}>
        {/* While the restore is in flight the transcript is withheld entirely, so
            a restored conversation never flashes the greeting above itself. */}
        {restoring
          ? null
          : turns.map((turn) => {
              const isOwn = turn.role === "user";
              return (
                <div key={turn.id} className={isOwn ? `${chat.row} ${chat.rowSelf}` : chat.row}>
                  {!isOwn && <div className={`${chat.avatar} ${styles.toucanAvatar}`}>🦜</div>}
                  <div className={chat.bubbleColumn}>
                    <div className={`${chat.message} ${isOwn ? chat.own : chat.peer}`}>
                      {turn.text}
                    </div>
                    <span
                      className={
                        isOwn ? `${chat.timestamp} ${chat.timestampRight}` : chat.timestamp
                      }
                    >
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
