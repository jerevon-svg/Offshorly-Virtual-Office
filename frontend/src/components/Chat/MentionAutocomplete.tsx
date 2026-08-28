import type { MentionCandidate } from "../../services/chat/mentions";
import styles from "./MentionAutocomplete.module.css";

type Props = {
  candidates: MentionCandidate[];
  highlightedIndex: number;
  onHover: (index: number) => void;
  onSelect: (candidate: MentionCandidate) => void;
};

// Small "@" participant-autocomplete popover, anchored above the composer via CSS
// (position: absolute on a `position: relative` composer wrapper — see ConversationView's/
// GroupConversationView's composer markup). DM callers pass a single-candidate list (the other
// participant only); GC callers pass the conversation's other participants — never the whole
// company roster (see useMentionComposer's candidates prop, built by each caller).
export function MentionAutocomplete({ candidates, highlightedIndex, onHover, onSelect }: Props) {
  if (candidates.length === 0) return null;
  return (
    <div className={styles.list} role="listbox">
      {candidates.map((c, i) => (
        <button
          key={c.email}
          type="button"
          role="option"
          aria-selected={i === highlightedIndex}
          className={i === highlightedIndex ? `${styles.item} ${styles.itemActive}` : styles.item}
          onMouseEnter={() => onHover(i)}
          // onMouseDown (not onClick) so this fires before the textarea's onBlur would otherwise
          // steal focus and dismiss the trigger first.
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(c);
          }}
        >
          {c.displayName}
        </button>
      ))}
    </div>
  );
}

export default MentionAutocomplete;
