import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { REACTION_EMOJIS } from "./MessageReactions";
import type { useMentionComposer } from "./useMentionComposer";
import styles from "./ConversationView.module.css";

// ONE shared Messenger-style composer, rendered by both ConversationView (DM /
// Global Chat / Spatial — same component, three surfaces) and
// GroupConversationView. It owns only presentation concerns: the auto-growing
// textarea, the @mention autocomplete popup, the future-media action bar, and
// the Send button. Everything stateful about a conversation (drafts, typing
// signals, send/retry, mention bookkeeping) stays in the caller — this
// component reports raw input through onDraftInput/onSend and nothing else.
type MentionController = ReturnType<typeof useMentionComposer>;

// Auto-grow ceiling for the textarea's CONTENT height — must equal the
// stylesheet's `.textarea { max-height: 96px }` so the CSS cap and the JS cap
// cannot disagree. ~4 lines at 14px/1.4; past it the textarea scrolls
// internally (overflow-y: auto) instead of growing.
const MAX_COMPOSER_CONTENT_PX = 96;

type ChatComposerProps = {
  draft: string;
  // The raw draft state setter — needed only by mention.selectCandidate, which
  // rewrites the draft to splice a mention in.
  setDraft: Dispatch<SetStateAction<string>>;
  // Every content change (keystroke OR emoji insert) funnels through here with
  // the caret position — callers chain their typing-indicator logic and
  // mention.onDraftChanged off it, exactly as their inline onChange did.
  onDraftInput: (text: string, caret: number) => void;
  onSend: () => void;
  mention: MentionController;
  // Overrides the shared "Message" default — used for transient states like
  // "Connecting…"; every surface's resting placeholder is defined here.
  placeholder?: string;
};

// Future media actions — UI preparation only (no recording, uploads, or GIF
// search exist yet). Each entry renders as a visibly disabled icon button; when
// the real attachment/object-storage work lands, give the action an onClick
// and drop `disabled` — the composer layout doesn't change.
const FUTURE_MEDIA_ACTIONS = [
  { key: "voice", label: "Voice message (coming soon)", icon: <MicIcon /> },
  { key: "image", label: "Attach image or file (coming soon)", icon: <ImageIcon /> },
  { key: "gif", label: "Send a GIF (coming soon)", icon: <GifIcon /> },
] as const;

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.7" fill="currentColor" />
      <path d="M5 19l5.5-5.5 3 3L17 13l4 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GifIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 26 24" fill="none" aria-hidden="true">
      <rect x="1.5" y="4" width="23" height="16" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <text x="13" y="16" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="inherit">
        GIF
      </text>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EmojiIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.3" fill="currentColor" />
      <circle cx="15" cy="10" r="1.3" fill="currentColor" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ChatComposer({ draft, setDraft, onDraftInput, onSend, mention, placeholder = "Message" }: ChatComposerProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiPopoverRef = useRef<HTMLDivElement | null>(null);
  // Messenger-style collapse: while the draft has text, the three media
  // buttons fold into ONE "+" button (which reveals them in a popover), giving
  // the textarea the freed horizontal room. Empty draft expands them again.
  const hasText = draft.length > 0;
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);
  const mediaMenuRef = useRef<HTMLDivElement | null>(null);

  // The "+" (and its menu) only exist while typing — clearing/sending the
  // draft expands the cluster back, so drop any open menu with it.
  useEffect(() => {
    if (!hasText) setMediaMenuOpen(false);
  }, [hasText]);

  // Auto-grow, Messenger-style — same technique as the Toucan panel's T9
  // composer, restated here so normal chat doesn't couple to Toucan. Keyed on
  // `draft` so EVERY path that changes the text resizes the box: typing grows
  // it line by line, a mention/emoji insert re-measures, and the clear on send
  // collapses it back to a single line. Height only — never width.
  useEffect(() => {
    const el = mention.textareaRef.current;
    if (!el) return;
    // Empty draft = true one-line pill, deterministically: drop the inline
    // height entirely and let the stylesheet's fixed one-line height rule —
    // never a measured (and possibly over-measured) scrollHeight. Multi-line
    // height is never reserved in the empty state.
    if (draft.length === 0) {
      el.style.height = "";
      el.style.overflowY = "";
      return;
    }
    // Collapse to the CSS minimum first, so deleting lines shrinks the box —
    // scrollHeight never reports smaller than the current height.
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    // The textarea is content-box: scrollHeight includes padding, the height
    // style does not, so measure the padding back out.
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const contentHeight = el.scrollHeight - padding;
    // jsdom (and a hidden panel) measure 0 — leave the CSS min-height in charge.
    if (contentHeight > 0) {
      el.style.height = `${Math.min(contentHeight, MAX_COMPOSER_CONTENT_PX)}px`;
      // Scrollbar only once the grow cap is actually hit — below it the box
      // fits its content exactly, so a scrollbar would just be rounding noise
      // (the stylesheet keeps it hidden by default for the same reason).
      el.style.overflowY = contentHeight > MAX_COMPOSER_CONTENT_PX ? "auto" : "hidden";
    }
  }, [draft, mention.textareaRef]);

  // Close the emoji popover / media menu on any pointer press outside them —
  // matches how a Messenger picker dismisses, without trapping focus.
  useEffect(() => {
    if (!emojiOpen && !mediaMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!emojiPopoverRef.current?.contains(e.target as Node)) setEmojiOpen(false);
      if (!mediaMenuRef.current?.contains(e.target as Node)) setMediaMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [emojiOpen, mediaMenuOpen]);

  // Splices an emoji into the draft at the caret and reports it through the
  // same onDraftInput path a keystroke takes, so typing indicators and mention
  // re-parsing behave exactly as if it had been typed.
  function insertEmoji(emoji: string) {
    const el = mention.textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const text = draft.slice(0, start) + emoji + draft.slice(end);
    const caret = start + emoji.length;
    setDraft(text);
    onDraftInput(text, caret);
    setEmojiOpen(false);
    // Re-focus + place the caret after the emoji on the next tick — the
    // re-render will have reset the DOM value by then (same pattern as
    // useMentionComposer.selectCandidate).
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className={styles.composer}>
      {mention.trigger && mention.filtered.length > 0 && (
        <MentionAutocomplete
          candidates={mention.filtered}
          highlightedIndex={mention.highlightedIndex}
          onHover={mention.setHighlightedIndex}
          onSelect={(c) => mention.selectCandidate(c, draft, setDraft)}
        />
      )}
      <div
        className={
          hasText
            ? `${styles.composerActions} ${styles.mediaCluster} ${styles.mediaClusterCollapsed}`
            : `${styles.composerActions} ${styles.mediaCluster}`
        }
      >
        {hasText ? (
          // Typing state: the whole media cluster folds into one "+" that
          // reveals the same (still disabled) future actions in a popover.
          <div className={styles.popoverGroup} ref={mediaMenuRef}>
            <button
              type="button"
              className={mediaMenuOpen ? `${styles.iconButton} ${styles.iconButtonActive}` : styles.iconButton}
              onClick={() => setMediaMenuOpen((open) => !open)}
              aria-label="More actions"
              aria-expanded={mediaMenuOpen}
              title="More actions"
            >
              <PlusIcon />
            </button>
            {mediaMenuOpen && (
              <div className={styles.mediaMenu} role="menu" aria-label="Media actions">
                {FUTURE_MEDIA_ACTIONS.map((action) => (
                  <button key={action.key} type="button" className={styles.mediaMenuItem} disabled>
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          FUTURE_MEDIA_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              className={`${styles.iconButton} ${styles.iconButtonDisabled}`}
              disabled
              aria-label={action.label}
              title={action.label}
            >
              {action.icon}
            </button>
          ))
        )}
      </div>
      <div className={styles.inputPill}>
      <textarea
        ref={mention.textareaRef}
        className={`${styles.textarea} ${styles.pillTextarea}`}
        rows={1}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => onDraftInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={(e) => {
          if (mention.trigger && mention.filtered.length > 0 && e.key === "Enter") {
            e.preventDefault();
            mention.selectCandidate(mention.filtered[mention.highlightedIndex], draft, setDraft);
            return;
          }
          if (mention.handleKeyDown(e)) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className={styles.popoverGroup} ref={emojiPopoverRef}>
        <button
          type="button"
          className={
            emojiOpen
              ? `${styles.iconButton} ${styles.emojiToggle} ${styles.iconButtonActive}`
              : `${styles.iconButton} ${styles.emojiToggle}`
          }
          onClick={() => setEmojiOpen((open) => !open)}
          aria-label="Insert emoji"
          aria-expanded={emojiOpen}
          title="Insert emoji"
        >
          <EmojiIcon />
        </button>
        {emojiOpen && (
          <div className={styles.emojiPopover} role="menu" aria-label="Emoji">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={styles.emojiOption}
                onClick={() => insertEmoji(emoji)}
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
      <div className={styles.composerActions}>
        <button type="button" className={styles.sendButton} onClick={onSend} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
    </div>
  );
}
