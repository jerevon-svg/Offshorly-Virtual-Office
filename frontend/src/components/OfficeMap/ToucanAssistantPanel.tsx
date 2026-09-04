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
import { ToucanMessageBody } from "./ToucanMessageBody";
import { copyToClipboard } from "./toucanClipboard";
import {
  applyToucanStatus,
  canApplyToucanStatus,
  toucanMode,
  toucanService,
  ToucanActionUnavailableError,
  ToucanConversationGoneError,
  turnRoleFromStored,
  TOUCAN_HISTORY_TURNS,
  type ToucanActionProposal,
  type ToucanConversation,
  type ToucanConversationDetail,
  type ToucanDraftAttachment,
  type ToucanMemory,
  subscribeDelegationEnded,
  subscribeDelegationUrgent,
  type ToucanDelegation,
  type ToucanUrgentFlag,
} from "../../services/toucan";
import { appendDictatedText } from "./toucanDictation";

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
//
// T9 — PRODUCTION POLISH. Presentation and affordances only; every call it
// makes already existed at T1/T4/T8, so T9 adds no endpoint, no schema and no
// migration:
//
//   RENDERING  -> assistant replies go through ToucanMessageBody (safe Markdown
//                 subset -> React elements, never HTML). User messages stay
//                 literal text. See toucanMarkdown.ts for why that is
//                 structurally injection-proof rather than sanitised.
//   COPY       -> per-reply Copy, plus Copy on each fenced code block.
//   RETRY      -> a failed REQUEST (nothing was answered) can be re-sent
//                 without retyping. It re-runs the SAME ask() the composer runs
//                 and cannot execute anything — see the safety note on
//                 submitQuestion.
//   HISTORY    -> per-conversation Delete, via T1's existing DELETE endpoint.
//   MEMORY     -> a second popover listing the viewer's own explicitly saved
//                 memories (T4's GET /toucan/memories) with a Forget control
//                 (T4's DELETE). READ AND DELETE ONLY: there is no create path
//                 here, so a memory still only ever comes from the user's own
//                 explicit "Remember that …".
//
// NOT ADDED, deliberately (both would have to lie about what they do):
//   REGENERATE -> /toucan/ask always PERSISTS the question with the answer, and
//                 routes the deterministic T4 memory commands and T8 action
//                 phrasings before it ever reaches the provider. Re-asking to
//                 get a second opinion would therefore duplicate the user's
//                 question in the stored transcript, and could re-run a
//                 "Remember that …" or re-mint an action proposal. Doing it
//                 safely needs a backend that can replace an answer in place
//                 and skip the command branches — a T9-out-of-scope change to
//                 the persistence and routing layers, not a polish item.
//   CANCEL     -> aborting the fetch stops the panel waiting but does not stop
//                 the backend: the request runs to completion and the exchange
//                 is persisted, so the "cancelled" answer would reappear on the
//                 next refresh. A Stop button here would be theatre.
// ---------------------------------------------------------------------------

type Turn = {
  id: number;
  role: "user" | "toucan";
  text: string;
  sentAt: string;
  /** Set only on a REQUEST-FAILED turn: the question that never got an answer,
   *  so it can be re-sent without the viewer retyping it. Its presence is also
   *  what marks the turn as an error rather than an ordinary reply. */
  retryQuestion?: string;
};

// Shown when the request itself fails (network down, backend asleep, aborted
// by something other than release). A plain toucan turn — no new UI surface.
const REQUEST_FAILED_TEXT =
  "Squawk — I couldn't reach the office just now. Try asking me again in a moment.";

// Shown when the conversation the panel was holding has gone (deleted from
// another tab, say). The next question simply starts a new one — no dead end.
const CONVERSATION_GONE_TEXT =
  "Squawk — that conversation isn't there any more. Ask me again and I'll start a fresh one.";

// T8 — shown when a Confirm/Cancel lands on a proposal that is expired, already
// handled, or otherwise gone (the backend words all of those identically). The
// user just asks again; nothing has executed.
const ACTION_GONE_TEXT =
  "Squawk — that request expired before it was confirmed, so I changed nothing. Ask me again if you still want it.";

// A2.1 — delegation wording helpers. The server states the duration; only the client
// knows the viewer's time zone, so the resolved end is formatted here.
export function formatDelegationDuration(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ${minutes % 60} minutes`;
  }
  return `${minutes} minutes`;
}

function formatLocalTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** A3 — the same derivation the server uses for requesterLabel ("micah.reyes@…" → "Micah Reyes"),
 *  for flags that arrive over the socket without one. */
export function requesterLabelFromEmail(email: string): string {
  const local = (email.split("@", 1)[0] ?? "").replace(/[._]/g, " ").trim();
  if (!local) return "Someone";
  return local
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function delegationScopeLabel(scope: string | null | undefined): string {
  return scope === "dm" ? "DMs only" : "Direct messages + group @mentions";
}

/** The card's detail line. Three windows (A2.1 duration, A2.3 clock time, A2.3 until return);
 *  the clock end is the server-resolved instant shown in the viewer's own zone. */
export function describeDelegationProposal(
  proposal: Pick<ToucanActionProposal, "durationMinutes" | "scope" | "endCondition" | "endsAt">,
  now: Date = new Date(),
): string {
  const scope = delegationScopeLabel(proposal.scope);
  if (proposal.endCondition === "until_return") {
    return `${scope} · until you return · maximum 24 hours`;
  }
  if (proposal.endsAt) {
    const ends = new Date(proposal.endsAt);
    if (!Number.isNaN(ends.getTime())) return `${scope} · until ${formatLocalTime(ends)} today`;
  }
  const minutes = proposal.durationMinutes ?? 0;
  const ends = new Date(now.getTime() + minutes * 60_000);
  return `${scope} · for ${formatDelegationDuration(minutes)} · ends about ${formatLocalTime(ends)} once confirmed`;
}

/** A2.2 — the banner's second line: scope, and when it ends. Existing A2.1 rows carry
 *  scope "dm" and read "DMs only"; new ones read "DMs + group @mentions". A2.3 until-return
 *  rows have no expiry and read "until you return · max 24h". */
export function describeActiveDelegation(delegation: ToucanDelegation): string {
  const scope = delegation.scope === "dm" ? "DMs only" : "DMs + group @mentions";
  if (delegation.endCondition === "until_return" || !delegation.expiresAt) {
    return `${scope} · until you return · max 24h`;
  }
  const ends = new Date(delegation.expiresAt);
  return Number.isNaN(ends.getTime()) ? scope : `${scope} · until ${formatLocalTime(ends)}`;
}

/** A3 — one return-card line: who flagged it and when, in the viewer's zone. No text. */
export function describeUrgentFlag(flag: ToucanUrgentFlag): string {
  const when = new Date(flag.flaggedAt);
  const label = flag.requesterLabel || flag.requesterEmail;
  return Number.isNaN(when.getTime()) ? label : `${label} · ${formatLocalTime(when)}`;
}

export function withDelegationEnd(text: string, expiresAt: string | null | undefined): string {
  if (!expiresAt) return text;
  const ends = new Date(expiresAt);
  return Number.isNaN(ends.getTime()) ? text : `${text} Ends at ${formatLocalTime(ends)}.`;
}

// History popover copy. Deliberately plain strings rather than new UI surfaces.
const HISTORY_EMPTY_TEXT = "No saved conversations yet. Ask me something and it'll show up here.";
const HISTORY_FAILED_TEXT = "Couldn't load your conversations.";
// A conversation created by "New conversation" has no title until its first
// question, so the list needs a stand-in label for it.
const UNTITLED_CONVERSATION_LABEL = "New conversation";

// T9 memory popover copy. The empty state says how a memory is made, because
// the only way to make one is to tell the toucan — this surface deliberately
// has no "add" control (see the module note).
const MEMORY_EMPTY_TEXT =
  "Nothing saved yet. Tell me “Remember that …” and it'll be kept here.";
const MEMORY_FAILED_TEXT = "Couldn't load what I remember.";

// How long a Copy control shows its confirmation before resting again.
const COPIED_FEEDBACK_MS = 1600;

// Auto-grow ceiling for the composer's CONTENT height — the same value as the
// chat stylesheet's `.textarea { max-height: 96px }` (ConversationView.module.css),
// so the CSS cap and the JS cap cannot disagree. ~4 lines at 14px/1.4.
const MAX_COMPOSER_CONTENT_PX = 96;

/** "fact" / "note" as a short human label. Anything unexpected from the server
 *  falls back to Note rather than showing a raw enum value. */
function memoryKindLabel(kind: string): string {
  return kind === "fact" ? "Fact" : "Note";
}

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
  // T10 — MULTIMODAL SEAMS. Both are absent today, and their absence is what
  // renders the two composer buttons inert ("coming soon"): the panel never
  // invents a picker or a recogniser of its own.
  //
  // Attachment: the caller opens whatever picker it owns and calls `add` with
  // the chosen files' metadata. Staging one only fills the preview row above
  // the composer — nothing uploads, nothing is stored, and /toucan/ask still
  // sends text alone.
  onRequestAttachment?: (add: (items: ToucanDraftAttachment[]) => void) => void;
  // Dictation: the caller starts whatever speech-to-text it owns and calls
  // `insert` with each finished transcript, which lands in the draft exactly as
  // if it had been typed. This component starts no recording, requests no
  // microphone permission, and touches no browser speech API.
  onRequestDictation?: (insert: (transcript: string) => void) => void;
  // A3 — the return card's Open button. The caller owns the chat windows; this component only
  // hands over the conversation id it was told about. Absent = the card shows Dismiss only.
  onOpenConversation?: (conversationId: string) => void;
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

// T10 icons — local to the panel on purpose. The chat composer has its own
// near-identical pair, and the module note there is explicit that normal chat
// must not couple to Toucan; sharing eight lines of SVG is not worth reversing
// that.
function AttachIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 11.5l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DictateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ToucanAssistantPanel({
  onRelease,
  onPendingChange,
  onTypingChange,
  onRequestAttachment,
  onRequestDictation,
  onOpenConversation,
}: ToucanAssistantPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([greetingTurn(0)]);
  const [draft, setDraft] = useState("");
  // T10 — attachments STAGED on the composer, client-side only. Always empty
  // until a caller supplies onRequestAttachment, and cleared on send: nothing is
  // uploaded, persisted or attached to a question yet, so keeping them past the
  // draft they belong to would be a lie about what was sent.
  const [attachments, setAttachments] = useState<ToucanDraftAttachment[]>([]);
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
  // T9 — the memory popover, same three-state shape as History (null = still
  // loading, [] = genuinely nothing saved).
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryItems, setMemoryItems] = useState<ToucanMemory[] | null>(null);
  const [memoryFailed, setMemoryFailed] = useState(false);
  // T9 — which reply's Copy button is currently showing its confirmation.
  const [copiedTurnId, setCopiedTurnId] = useState<number | null>(null);
  // T8 — the one pending action proposal, if the latest answer carried one. LOCAL
  // AND EPHEMERAL on purpose: the server holds the authoritative pending entry
  // (short TTL, one-time), so this is only "which card to render". It is NOT
  // restored on refresh — by the time a page reloads the proposal has usually
  // expired, and confirming a stale one safely reads as ACTION_GONE_TEXT anyway.
  const [actionProposal, setActionProposal] = useState<ToucanActionProposal | null>(null);
  // True while a confirm/cancel round trip is in flight — disables both buttons so
  // a double-click cannot race the one-time server-side consume.
  const [actionBusy, setActionBusy] = useState(false);
  // A2.2 — the viewer's own active delegation (null = none). Loaded on mount, set from a
  // confirmed start_delegation result, cleared by Stop and by the server's delegation_ended.
  const [delegation, setDelegation] = useState<ToucanDelegation | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  // A3 — the viewer's UNSEEN urgency flags. Loaded on mount, appended from the owner-only
  // realtime event, refetched when the delegation ends, removed by Open/Dismiss. The list is
  // shown as the return card only while no delegation is active; while one is, the banner
  // carries the count instead.
  const [urgentFlags, setUrgentFlags] = useState<ToucanUrgentFlag[]>([]);
  const [urgentBusyId, setUrgentBusyId] = useState<string | null>(null);
  const nextIdRef = useRef(1);
  const askAbortRef = useRef<AbortController | null>(null);
  const restoreAbortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<number | null>(null);

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

  // A2.2 — is Toucan handling this viewer's messages right now? Owner-scoped server-side; a
  // failure (offline, mock mode) just means no banner.
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve()
      .then(() => toucanService.getDelegation({ signal: controller.signal }))
      .then((active) => {
        if (!controller.signal.aborted) setDelegation(active ?? null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // A3 — the viewer's unseen urgency flags, owner-scoped server-side. A failure (offline, an
  // older service without the call) just means no card.
  const loadUrgentFlags = useCallback((signal?: AbortSignal) => {
    Promise.resolve()
      .then(() => toucanService.listUrgentFlags({ signal }))
      .then((flags) => {
        if (!signal?.aborted) setUrgentFlags(Array.isArray(flags) ? flags : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadUrgentFlags(controller.signal);
    return () => controller.abort();
  }, [loadUrgentFlags]);

  // A2.2 — the server tells the OWNER (only) when their delegation ended: Stop from another
  // tab, replaced by a new one, or found expired. Clear the banner unless the event names a
  // different (older) delegation than the one shown.
  // A3 — the same moment is when the return card becomes relevant, so the flags are refetched.
  useEffect(() => {
    return subscribeDelegationEnded((event) => {
      setDelegation((current) => {
        if (!current) return null;
        if (event.delegationId && event.delegationId !== current.id) return current;
        return null;
      });
      loadUrgentFlags();
    });
  }, [loadUrgentFlags]);

  // A3 — somebody declared a message urgent while Toucan covered for the viewer. Bump the
  // banner's counter (only for the delegation shown) and remember the flag for the return card.
  useEffect(() => {
    return subscribeDelegationUrgent((event) => {
      setDelegation((current) => {
        if (!current || (event.delegationId && event.delegationId !== current.id)) return current;
        const next = typeof event.urgentCount === "number" ? event.urgentCount : (current.urgentCount ?? 0) + 1;
        return { ...current, urgentCount: next };
      });
      if (!event.flagId || !event.conversationId) return;
      const flag: ToucanUrgentFlag = {
        id: event.flagId,
        delegationId: event.delegationId ?? "",
        conversationId: event.conversationId,
        requesterEmail: event.requesterEmail ?? "",
        requesterLabel: requesterLabelFromEmail(event.requesterEmail ?? ""),
        flaggedAt: event.flaggedAt ?? new Date().toISOString(),
        seenAt: null,
      };
      setUrgentFlags((current) => (current.some((f) => f.id === flag.id) ? current : [flag, ...current]));
    });
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

  // T9 — composer auto-grow, Messenger-style. Keyed on `draft` so EVERY path
  // that changes the text resizes the box: typing grows it line by line, and the
  // clear on send / leave-conversation collapses it back to one line. The cap is
  // the chat stylesheet's own 96px max-height (restated here for the JS side);
  // past it the height stops and the textarea's default overflow scrolls
  // internally. Height only — the panel's width is untouched.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Collapse to the CSS minimum first, so deleting lines shrinks the box —
    // scrollHeight never reports smaller than the current height.
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    // The textarea is content-box: scrollHeight includes padding, the height
    // style does not, so measure the padding back out.
    const padding =
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const contentHeight = el.scrollHeight - padding;
    // jsdom (and a hidden panel) measure 0 — leave the CSS min-height in charge.
    if (contentHeight > 0) {
      el.style.height = `${Math.min(contentHeight, MAX_COMPOSER_CONTENT_PX)}px`;
    }
  }, [draft]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending, actionProposal]);

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

  // T10 — the ONE place a dictated transcript enters the draft. It lands through
  // the same setDraft/reportTyping pair a keystroke takes, so auto-grow, the
  // typing signal and the Send button's enabled state all behave identically to
  // typed text. Nothing calls it until a caller supplies onRequestDictation.
  function insertDictatedText(transcript: string) {
    setDraft((current) => {
      const next = appendDictatedText(current, transcript);
      reportTyping(next);
      return next;
    });
    textareaRef.current?.focus();
  }

  // T10 — the ONE place a staged attachment enters the composer. Metadata only;
  // see ToucanDraftAttachment for why there is no URL or payload here.
  function addAttachments(items: ToucanDraftAttachment[]) {
    if (items.length === 0) return;
    setAttachments((current) => [...current, ...items]);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
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
    // Staged attachments belong to the draft that is being discarded.
    setAttachments([]);
    setHistoryOpen(false);
    setMemoryOpen(false);
    // An unresolved proposal belongs to the conversation being left. Dropping the
    // card executes nothing — the server-side pending entry simply expires.
    setActionProposal(null);
    setActionBusy(false);
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
    setMemoryOpen(false);
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

  // T9 — DELETE ONE CONVERSATION. T1's endpoint, exposed. Deleting the one on
  // screen leaves the panel on a clean greeting with no conversation id, which
  // is exactly the state a first-ever summon is in — the next question creates a
  // fresh conversation server-side. Deleting any OTHER conversation does not
  // disturb the transcript being read.
  const handleDeleteConversation = useCallback(
    (id: string) => {
      if (pending) return;
      const wasCurrent = id === conversationId;
      // Optimistic, because the call is idempotent: a failure leaves the row
      // gone from this list and the next open refetches the truth.
      setHistoryItems((prev) => prev?.filter((item) => item.id !== id) ?? prev);
      if (wasCurrent) {
        leaveCurrentConversation();
        setConversationId(null);
        nextIdRef.current = 1;
        setTurns([greetingTurn(0)]);
      }
      void toucanService.deleteConversation(id).catch(() => {
        // Still there after all — the next History open will show it again.
      });
    },
    [pending, conversationId, leaveCurrentConversation],
  );

  // T9 — COPY ONE REPLY. Clipboard only; it neither sends anything nor touches
  // the conversation.
  const handleCopyTurn = useCallback((turn: Turn) => {
    void copyToClipboard(turn.text).then((ok) => {
      if (!ok) return;
      setCopiedTurnId(turn.id);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopiedTurnId(null);
      }, COPIED_FEEDBACK_MS);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  // T9 — MEMORY. Same popover shape as History and the same discipline: opening
  // it is one GET, and the only mutation reachable from it is a per-row Forget
  // (one DELETE). There is deliberately NO create control — a memory can still
  // only come into existence from the user's own explicit "Remember that …", so
  // T4's rule that an ordinary message never becomes a memory stays structural.
  const handleToggleMemory = useCallback(() => {
    setHistoryOpen(false);
    setMemoryOpen((wasOpen) => {
      if (wasOpen) return false;
      setMemoryFailed(false);
      setMemoryItems(null);
      void toucanService
        .listMemories()
        .then(setMemoryItems)
        .catch(() => {
          setMemoryItems([]);
          setMemoryFailed(true);
        });
      return true;
    });
  }, []);

  const handleForgetMemory = useCallback((memoryId: string) => {
    setMemoryItems((prev) => prev?.filter((item) => item.id !== memoryId) ?? prev);
    void toucanService.deleteMemory(memoryId).catch(() => {
      // Idempotent and non-fatal; reopening the popover refetches the truth.
    });
  }, []);

  // T8 — the assistant's own follow-up line for confirm/cancel outcomes. A plain
  // toucan turn, same shape appendReply produces inside submitQuestion.
  const appendToucanTurn = useCallback((text: string) => {
    setTurns((prev) => [
      ...prev,
      { id: nextIdRef.current++, role: "toucan", text, sentAt: new Date().toISOString() },
    ]);
  }, []);

  // CONFIRM — the only gesture that executes anything, and it is a button press
  // carrying the server-minted proposal id, never conversational text. Order of
  // operations: (1) pre-check the effect is applyable at all (DND allowance), so
  // the one-time confirm is never consumed for an effect that cannot happen;
  // (2) consume the pending entry server-side (one-time, owner-bound, TTL'd);
  // (3) apply the SERVER-RETURNED frozen effect through the existing product
  // status path. A failure at any step reports honestly and executes nothing.
  const handleConfirmAction = useCallback(() => {
    if (!actionProposal || actionBusy) return;
    // The status pre-check is a set_status concern only. A send_message proposal
    // is executed entirely server-side (through the normal chat write path), so
    // there is nothing to pre-check and nothing to apply locally.
    if (actionProposal.action === "set_status") {
      const precheck = canApplyToucanStatus({
        status: actionProposal.status ?? "",
        dndMinutes: actionProposal.dndMinutes,
      });
      if (!precheck.ok) {
        setActionProposal(null);
        appendToucanTurn(precheck.reason);
        // Tidy up the unusable pending entry; nothing to do if this fails — it
        // simply expires.
        void toucanService.cancelAction(actionProposal.id).catch(() => {});
        return;
      }
    }
    setActionBusy(true);
    void toucanService
      .confirmAction(actionProposal.id)
      .then((result) => {
        if (result.action === "set_status") {
          // Apply exactly what the server confirmed — the frozen validated args —
          // and only claim success when the local apply actually happened.
          const applied = applyToucanStatus({
            status: result.status ?? "",
            dndMinutes: result.dndMinutes,
          });
          appendToucanTurn(applied.ok ? result.text : applied.reason);
          return;
        }
        if (result.action === "start_delegation") {
          // A2.1: the server wrote the durable delegation; the panel only reports it,
          // adding the resolved end time in the viewer's own zone. Never touches status.
          // A2.2: the banner appears from the returned row, no refresh needed.
          setDelegation(result.delegation ?? null);
          appendToucanTurn(withDelegationEnd(result.text, result.delegation?.expiresAt));
          return;
        }
        // send_message: the server already sent it through the chat seam; the
        // outcome line is the whole effect on this panel. Never touches status.
        appendToucanTurn(result.text);
      })
      .catch((error: unknown) => {
        appendToucanTurn(
          error instanceof ToucanActionUnavailableError ? ACTION_GONE_TEXT : REQUEST_FAILED_TEXT,
        );
      })
      .finally(() => {
        setActionBusy(false);
        setActionProposal(null);
      });
  }, [actionProposal, actionBusy, appendToucanTurn]);

  // A2.2 STOP — ends the viewer's own delegation through the owner-scoped DELETE. The row
  // is kept for audit; the banner goes away as soon as the server confirms. One request at a
  // time: the button is disabled while a stop is pending.
  const handleStopDelegation = useCallback(() => {
    if (!delegation || stopBusy) return;
    setStopBusy(true);
    void toucanService
      .cancelDelegation()
      .then(() => setDelegation(null))
      .catch(() => appendToucanTurn(REQUEST_FAILED_TEXT))
      .finally(() => setStopBusy(false));
  }, [delegation, stopBusy, appendToucanTurn]);

  // A3 — Open / Dismiss a flagged conversation. Both mark the flag seen (owner-scoped POST) and
  // drop it from the card; Open additionally hands the conversation id to the caller. One
  // request at a time per flag; a failed mark keeps the row so nothing is silently lost.
  const resolveUrgentFlag = useCallback(
    (flag: ToucanUrgentFlag, open: boolean) => {
      if (urgentBusyId) return;
      setUrgentBusyId(flag.id);
      if (open) onOpenConversation?.(flag.conversationId);
      void toucanService
        .markUrgentFlagsSeen([flag.id])
        .then(() => {
          setUrgentFlags((current) => current.filter((f) => f.id !== flag.id));
          setDelegation((current) =>
            current && current.id === flag.delegationId && (current.urgentCount ?? 0) > 0
              ? { ...current, urgentCount: (current.urgentCount ?? 0) - 1 }
              : current,
          );
        })
        .catch(() => appendToucanTurn(REQUEST_FAILED_TEXT))
        .finally(() => setUrgentBusyId(null));
    },
    [urgentBusyId, onOpenConversation, appendToucanTurn],
  );

  // CANCEL — burns the pending entry server-side; nothing executes either way.
  const handleCancelAction = useCallback(() => {
    if (!actionProposal || actionBusy) return;
    setActionBusy(true);
    void toucanService
      .cancelAction(actionProposal.id)
      .then((result) => appendToucanTurn(result.text))
      .catch((error: unknown) => {
        // An expired/gone proposal was never going to execute — cancelling it is
        // already true, so word it as the ordinary "changed nothing" outcome.
        appendToucanTurn(
          error instanceof ToucanActionUnavailableError ? ACTION_GONE_TEXT : REQUEST_FAILED_TEXT,
        );
      })
      .finally(() => {
        setActionBusy(false);
        setActionProposal(null);
      });
  }, [actionProposal, actionBusy, appendToucanTurn]);

  // ONE submit path, shared by the composer and by Retry.
  //
  // T8 SAFETY: this is the ordinary ask() call and nothing more. Whether it was
  // reached by pressing Send or by pressing Retry, an answer that carries an
  // action can only ever set `actionProposal` — the confirmation card — and the
  // ONLY thing that executes is the explicit Confirm button POSTing the
  // server-minted id. Retry therefore cannot execute an action for the same
  // structural reason typing "yes" cannot: there is no other door.
  //
  // `history` is captured from the turns list at call time so a retry sends the
  // same bounded window the original send did, minus the failure notice, which
  // is dropped before this runs.
  function submitQuestion(
    text: string,
    options: { echoUserTurn: boolean; historyFrom?: Turn[] },
  ) {
    if (!text || pending) return;
    // Bounded history, oldest-trimmed. The backend re-validates this limit — the
    // client trimming here only avoids a pointless 422.
    const history = (options.historyFrom ?? turns)
      .slice(-TOUCAN_HISTORY_TURNS)
      .map((turn) => ({ role: turn.role, text: turn.text }));
    // A retry re-uses the user turn that is ALREADY in the transcript — echoing
    // it again would show the question twice for one asking of it.
    if (options.echoUserTurn) {
      setTurns((prev) => [
        ...prev,
        { id: nextIdRef.current++, role: "user", text, sentAt: new Date().toISOString() },
      ]);
    }
    setDraft("");
    // Cleared with the draft they were staged on: the question just sent was
    // text-only, so leaving them in the preview row would claim otherwise.
    setAttachments([]);
    stopTyping();
    setPending(true);
    // Asking something new abandons an unconfirmed proposal (it stays unexecuted
    // and expires server-side) — the freshest answer owns the confirmation slot.
    setActionProposal(null);

    const controller = new AbortController();
    askAbortRef.current = controller;
    const appendReply = (replyText: string, retryQuestion?: string) => {
      if (controller.signal.aborted) return;
      setTurns((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          role: "toucan",
          text: replyText,
          sentAt: new Date().toISOString(),
          ...(retryQuestion ? { retryQuestion } : {}),
        },
      ]);
    };

    void toucanService
      .ask({ question: text, history, conversationId }, { signal: controller.signal })
      .then((answer) => {
        // Tracks the conversation the server actually used — the one that was
        // sent, or the one it created because none was.
        if (!controller.signal.aborted) {
          setConversationId(answer.conversationId);
          // T8: an answer may carry a pending action proposal. Nothing has
          // executed — this only decides whether the confirmation card shows.
          setActionProposal(answer.action ?? null);
        }
        appendReply(answer.text);
      })
      .catch((error: unknown) => {
        if (error instanceof ToucanConversationGoneError) {
          // Self-heal: drop the stale id so the next question starts fresh.
          if (!controller.signal.aborted) setConversationId(null);
          appendReply(CONVERSATION_GONE_TEXT);
          return;
        }
        // The request never produced an answer, so re-sending it is exactly the
        // same one ask the user already intended — hence Retry is offered here,
        // and ONLY here.
        appendReply(REQUEST_FAILED_TEXT, text);
      })
      .finally(() => {
        if (askAbortRef.current === controller) askAbortRef.current = null;
        // A panel unmounted mid-request has already reported pending=false via
        // the cleanup effect above; skip the setState on an aborted request.
        if (!controller.signal.aborted) setPending(false);
      });
  }

  function handleSend() {
    // Same empty-send guard the chat composer uses. The Send button is now also
    // disabled while a reply is in flight and while the draft is blank, so a
    // double-click or a held Enter cannot queue a second question — but the
    // guard inside submitQuestion stays the authority.
    submitQuestion(draft.trim(), { echoUserTurn: true });
  }

  // RETRY — only ever offered on a turn that carries `retryQuestion`, i.e. a
  // request that failed before any answer existed. It re-sends that question
  // without echoing the user's message a second time, and drops the failure
  // notice so the transcript reads as one question with one outcome.
  function handleRetry(turn: Turn) {
    if (!turn.retryQuestion || pending) return;
    const remaining = turns.filter((candidate) => candidate.id !== turn.id);
    setTurns(remaining);
    // The failure notice is not part of the conversation, so it must not travel
    // in the retried request's history either.
    submitQuestion(turn.retryQuestion, { echoUserTurn: false, historyFrom: remaining });
  }

  // The composer is inert while a reply is in flight — the single clearest way
  // to say "a request is active" and to make a second submit impossible. NOT
  // disabled during the mount-time restore: that is one microtask, and blocking
  // the field for it would only add a flicker.
  const composerDisabled = pending;

  return (
    <div className={`${chat.panel} ${styles.panel}`} role="dialog" aria-label="Toucan Assistant">
      <div className={chat.header}>
        <div className={`${chat.headerAvatar} ${styles.headerAvatar}`}>🦜</div>
        <div className={chat.headerText}>
          <div className={chat.titleRow}>
            <span className={chat.title}>Toucan Assistant</span>
            {/* T9 — the old unconditional "DEMO" badge is gone. Real mode is now
                the ordinary case and wears no badge at all; the chip appears
                only when the canned bird is actually what's answering, which is
                a claim about this build rather than a development artifact. */}
            {toucanMode === "mock" && <span className={styles.demoBadge}>Demo</span>}
          </div>
          <span className={chat.subtitle}>Perched beside you</span>
        </div>
        <div className={chat.headerActions}>
          {/* History, memory and "start over", all in the existing header action
              slot. Popovers, deliberately not sidebars: each is one list with one
              row-level control, and nothing else — no search, no rename, no
              pagination. */}
          <button
            type="button"
            className={`${chat.closeButton} ${styles.headerActionButton}`}
            onClick={handleToggleHistory}
            aria-label="Conversation history"
            aria-expanded={historyOpen}
            title="History"
          >
            🕘
          </button>
          <button
            type="button"
            className={`${chat.closeButton} ${styles.headerActionButton}`}
            onClick={handleToggleMemory}
            aria-label="What the toucan remembers"
            aria-expanded={memoryOpen}
            title="What I remember"
          >
            🧠
          </button>
          <button
            type="button"
            className={`${chat.closeButton} ${styles.headerActionButton}`}
            onClick={handleNewConversation}
            disabled={pending}
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
        <div className={styles.popover}>
          <p className={styles.popoverHeading}>Your conversations</p>
          <div role="menu" aria-label="Saved conversations">
            {historyItems === null ? (
              <p className={styles.popoverEmpty}>Loading…</p>
            ) : historyFailed ? (
              <p className={styles.popoverEmpty}>{HISTORY_FAILED_TEXT}</p>
            ) : historyItems.length === 0 ? (
              <p className={styles.popoverEmpty}>{HISTORY_EMPTY_TEXT}</p>
            ) : (
              // Already most-recent-first from the server; the panel does not
              // re-sort, so one ordering rule lives in one place.
              historyItems.map((conversation) => {
                const isCurrent = conversation.id === conversationId;
                return (
                  <div key={conversation.id} className={styles.popoverRow}>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.historyItem}
                      aria-current={isCurrent}
                      disabled={pending}
                      onClick={() => handleSelectConversation(conversation.id)}
                    >
                      {/* A visible mark, not just aria-current: the active row
                          has to be identifiable at a glance, not only to a
                          screen reader. */}
                      <span aria-hidden="true" className={styles.historyMarker}>
                        {isCurrent ? "•" : ""}
                      </span>
                      <span className={styles.historyTitle}>
                        {conversation.title || UNTITLED_CONVERSATION_LABEL}
                      </span>
                      <span className={styles.historyDate}>
                        {formatConversationDate(conversation.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={styles.rowDelete}
                      disabled={pending}
                      onClick={() => handleDeleteConversation(conversation.id)}
                      aria-label={`Delete conversation ${
                        conversation.title || UNTITLED_CONVERSATION_LABEL
                      }`}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {memoryOpen && (
        // T9 — MEMORY MANAGEMENT. Content and kind, nothing else: no id, no
        // owner, no resource locator, no timestamps-as-metadata, no retrieval
        // scoring. The row's Forget button is the only mutation reachable from
        // here, and there is no control that could create a memory.
        <div className={styles.popover}>
          <p className={styles.popoverHeading}>What I remember</p>
          <div role="list" aria-label="Saved memories">
            {memoryItems === null ? (
              <p className={styles.popoverEmpty}>Loading…</p>
            ) : memoryFailed ? (
              <p className={styles.popoverEmpty}>{MEMORY_FAILED_TEXT}</p>
            ) : memoryItems.length === 0 ? (
              <p className={styles.popoverEmpty}>{MEMORY_EMPTY_TEXT}</p>
            ) : (
              memoryItems.map((memory) => (
                <div key={memory.id} role="listitem" className={styles.memoryRow}>
                  <span className={styles.memoryKind}>{memoryKindLabel(memory.kind)}</span>
                  <span className={styles.memoryContent}>{memory.content}</span>
                  <button
                    type="button"
                    className={styles.rowDelete}
                    onClick={() => handleForgetMemory(memory.id)}
                    aria-label={`Forget: ${memory.content}`}
                    title="Forget"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {delegation && (
        // A2.2 — the persistent indicator that Toucan is answering on this viewer's behalf.
        // Small, always visible while active, and the one place to stop it from the panel.
        <div className={styles.delegationBanner} data-testid="toucan-delegation-banner" role="status">
          <div className={styles.delegationText}>
            <span className={styles.delegationTitle}>
              Toucan is handling your messages
              {(delegation.urgentCount ?? 0) > 0 && (
                <span className={styles.delegationUrgent} data-testid="toucan-delegation-urgent-count">
                  {delegation.urgentCount === 1 ? "1 urgent" : `${delegation.urgentCount} urgent`}
                </span>
              )}
            </span>
            <span className={styles.delegationMeta}>{describeActiveDelegation(delegation)}</span>
          </div>
          <button
            type="button"
            className={styles.delegationStop}
            onClick={handleStopDelegation}
            disabled={stopBusy}
            aria-label="Stop Toucan handling your messages"
          >
            {stopBusy ? "Stopping…" : "Stop"}
          </button>
        </div>
      )}

      {!delegation && urgentFlags.length > 0 && (
        // A3 — the return card: once Toucan has stopped covering, the conversations somebody
        // flagged as urgent, oldest last. Open hands the id to the caller; both actions mark seen.
        <div className={styles.urgentCard} data-testid="toucan-urgent-card" role="status">
          <span className={styles.urgentTitle}>Urgent while Toucan covered for you</span>
          {urgentFlags.map((flag) => (
            <div key={flag.id} className={styles.urgentRow} data-testid="toucan-urgent-row">
              <span className={styles.urgentMeta}>{describeUrgentFlag(flag)}</span>
              <span className={styles.urgentActions}>
                {onOpenConversation && (
                  <button
                    type="button"
                    className={styles.urgentOpen}
                    onClick={() => resolveUrgentFlag(flag, true)}
                    disabled={urgentBusyId !== null}
                    aria-label={`Open the conversation flagged by ${flag.requesterLabel || flag.requesterEmail}`}
                  >
                    Open
                  </button>
                )}
                <button
                  type="button"
                  className={styles.urgentDismiss}
                  onClick={() => resolveUrgentFlag(flag, false)}
                  disabled={urgentBusyId !== null}
                  aria-label={`Dismiss the flag from ${flag.requesterLabel || flag.requesterEmail}`}
                >
                  Dismiss
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={chat.messages} ref={messagesRef}>
        {/* While the restore is in flight the transcript is withheld entirely, so
            a restored conversation never flashes the greeting above itself. */}
        {restoring
          ? null
          : turns.map((turn) => {
              const isOwn = turn.role === "user";
              const isError = Boolean(turn.retryQuestion);
              return (
                <div key={turn.id} className={isOwn ? `${chat.row} ${chat.rowSelf}` : chat.row}>
                  {!isOwn && <div className={`${chat.avatar} ${styles.toucanAvatar}`}>🦜</div>}
                  <div className={chat.bubbleColumn}>
                    <div
                      className={`${chat.message} ${isOwn ? chat.own : chat.peer}${
                        isError ? ` ${styles.errorBubble}` : ""
                      }`}
                    >
                      {/* The viewer's own message stays literal text — their
                          keystrokes, shown back verbatim. Only the assistant's
                          side goes through the Markdown renderer. */}
                      {isOwn ? turn.text : <ToucanMessageBody text={turn.text} />}
                    </div>
                    <div
                      className={
                        isOwn ? `${styles.turnFooter} ${styles.turnFooterSelf}` : styles.turnFooter
                      }
                    >
                      <span
                        className={
                          isOwn ? `${chat.timestamp} ${chat.timestampRight}` : chat.timestamp
                        }
                      >
                        {formatMessageTime(turn.sentAt)}
                      </span>
                      {/* Retry sits on the failure notice only; Copy sits on
                          every real reply. Neither appears on the viewer's own
                          message — one is meaningless there, and the other is
                          text they still have. */}
                      {!isOwn && isError && (
                        <button
                          type="button"
                          className={styles.turnAction}
                          onClick={() => handleRetry(turn)}
                          disabled={pending}
                        >
                          Try again
                        </button>
                      )}
                      {!isOwn && !isError && (
                        <button
                          type="button"
                          className={styles.turnAction}
                          onClick={() => handleCopyTurn(turn)}
                          aria-label="Copy response"
                        >
                          {copiedTurnId === turn.id ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        {actionProposal && !pending && !restoring && (
          // T8 — the confirmation card: the ONE surface through which a proposed
          // action can execute. It restates the exact server-worded effect and
          // offers two explicit buttons; nothing about typing, Enter, or later
          // messages can stand in for pressing Confirm.
          <div className={chat.row} data-testid="toucan-action-card">
            <div className={`${chat.avatar} ${styles.toucanAvatar}`}>🦜</div>
            <div className={chat.bubbleColumn}>
              <div className={`${chat.message} ${chat.peer} ${styles.actionCard}`}>
                <span className={styles.actionSummary}>{actionProposal.summary}</span>
                {actionProposal.action === "start_delegation" && (
                  // A2.1 — the card must say what is being handed over: the scope (DMs only),
                  // the duration, and roughly when it ends. Nothing is active until Confirm.
                  <div className={styles.actionMessage} data-testid="toucan-action-delegation">
                    {describeDelegationProposal(actionProposal)}
                  </div>
                )}
                {actionProposal.action === "send_message" && actionProposal.message != null && (
                  // A1 — the exact outgoing text, verbatim. The user must see BOTH the
                  // recipient (in the summary above) and the message before Confirm.
                  <blockquote className={styles.actionMessage} data-testid="toucan-action-message">
                    {actionProposal.message}
                  </blockquote>
                )}
                <div className={styles.actionButtons}>
                  <button
                    type="button"
                    className={styles.actionConfirm}
                    onClick={handleConfirmAction}
                    disabled={actionBusy}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className={styles.actionCancel}
                    onClick={handleCancelAction}
                    disabled={actionBusy}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {pending && (
          // "Toucan is typing" — a normal received bubble carrying the
          // office's established animated dots (same 1s stagger as the
          // world-space TalkingBubble), NOT a special assistant card.
          <div
            className={chat.row}
            data-testid="toucan-typing"
            role="status"
            aria-label="The toucan is thinking"
          >
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

      {/* T10 — staged-attachment preview. Renders ONLY when something is staged,
          so the resting panel is byte-for-byte the composer it was before; there
          is no empty tray, no dropzone and no placeholder. */}
      {attachments.length > 0 && (
        <div className={styles.attachmentPreview} aria-label="Attachments">
          {attachments.map((item) => (
            <div key={item.id} className={styles.attachmentChip}>
              <span className={styles.attachmentName} title={item.name}>
                {item.name}
              </span>
              <button
                type="button"
                className={styles.attachmentRemove}
                onClick={() => removeAttachment(item.id)}
                aria-label={`Remove ${item.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`${chat.composer} ${styles.composerGrow}`} aria-busy={pending}>
        {/* T10 — multimodal actions, in the compact icon-button style the chat
            composer already defines. Both are disabled until a caller wires the
            matching seam, and a disabled button cannot fire: no picker opens, no
            recording starts, no permission is requested. */}
        <div className={`${chat.composerActions} ${styles.multimodalActions}`}>
          <button
            type="button"
            className={
              onRequestAttachment
                ? chat.iconButton
                : `${chat.iconButton} ${chat.iconButtonDisabled}`
            }
            disabled={composerDisabled || !onRequestAttachment}
            onClick={() => onRequestAttachment?.(addAttachments)}
            aria-label={onRequestAttachment ? "Attach a file" : "Attach a file (coming soon)"}
            title={onRequestAttachment ? "Attach a file" : "Attach a file (coming soon)"}
          >
            <AttachIcon />
          </button>
          <button
            type="button"
            className={
              onRequestDictation
                ? chat.iconButton
                : `${chat.iconButton} ${chat.iconButtonDisabled}`
            }
            disabled={composerDisabled || !onRequestDictation}
            onClick={() => onRequestDictation?.(insertDictatedText)}
            aria-label={onRequestDictation ? "Dictate a message" : "Dictate a message (coming soon)"}
            title={onRequestDictation ? "Dictate a message" : "Dictate a message (coming soon)"}
          >
            <DictateIcon />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className={`${chat.textarea} ${styles.textarea}`}
          value={draft}
          placeholder={pending ? "Waiting for the toucan…" : "Ask the toucan…"}
          aria-label="Message the toucan"
          rows={1}
          disabled={composerDisabled}
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
        <button
          type="button"
          className={`${chat.sendButton} ${styles.sendButton}`}
          onClick={handleSend}
          // Belt and braces against a double submit: the guard in
          // submitQuestion is the authority, this makes the state visible.
          disabled={pending || !draft.trim()}
          aria-label="Send"
        >
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
