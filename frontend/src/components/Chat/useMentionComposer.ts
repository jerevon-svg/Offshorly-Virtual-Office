import { useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import {
  activeMentionEmails,
  filterMentionCandidates,
  findMentionTrigger,
  insertMention,
  type MentionCandidate,
  type MentionTrigger,
} from "../../services/chat/mentions";

// Shared @mention-autocomplete composer state for ConversationView (DM) and
// GroupConversationView (GC) — both wire this the same way: call onDraftChanged from the
// textarea's onChange, handleKeyDown from onKeyDown (before the existing Enter-to-send check),
// render <MentionAutocomplete/> when `filtered.length > 0`, and read mentionsForSend(text) at
// send time.
export function useMentionComposer(candidates: MentionCandidate[]) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pending, setPending] = useState<MentionCandidate[]>([]);

  const filtered = trigger ? filterMentionCandidates(candidates, trigger.query) : [];

  function onDraftChanged(text: string, cursor: number) {
    const next = findMentionTrigger(text, cursor);
    setTrigger(next);
    setHighlightedIndex(0);
  }

  function selectCandidate(candidate: MentionCandidate, draft: string, setDraft: Dispatch<SetStateAction<string>>) {
    if (!trigger) return;
    const cursor = textareaRef.current?.selectionStart ?? draft.length;
    const { text, cursor: newCursor } = insertMention(draft, trigger.start, cursor, candidate.displayName);
    setDraft(text);
    setPending((prev) => (prev.some((c) => c.email === candidate.email) ? prev : [...prev, candidate]));
    setTrigger(null);
    // Re-focus + place the caret after the inserted mention on the next tick — setDraft's
    // re-render will have reset the DOM value by then.
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
    });
  }

  // Returns true if the keystroke was consumed by the autocomplete (Up/Down/Escape) — the caller
  // should return early and NOT also run its normal Enter-to-send handling. Enter itself is
  // intentionally NOT consumed here: the caller checks `trigger && filtered.length > 0` first and
  // calls selectCandidate(filtered[highlightedIndex], ...) for Enter, since only it has `draft`.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!trigger || filtered.length === 0) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % filtered.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setTrigger(null);
      return true;
    }
    return false;
  }

  function mentionsForSend(text: string): string[] {
    return activeMentionEmails(text, pending);
  }

  function resetAfterSend() {
    setPending([]);
    setTrigger(null);
  }

  return {
    textareaRef,
    trigger,
    filtered,
    highlightedIndex,
    setHighlightedIndex,
    onDraftChanged,
    selectCandidate,
    handleKeyDown,
    mentionsForSend,
    resetAfterSend,
  };
}
