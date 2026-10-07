import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { isTypingTarget } from "./keyGuard";

// THE `/` COMPOSER, ONCE. The meeting's chat (Phase 7D) and the Travel Chat (Go Together Phase 5) are two
// ephemeral contexts behind ONE interaction: `/` releases the pointer and focuses the field, Enter sends and
// asks for the pointer back from that keypress, Esc leaves without sending. Only one context is ever
// `active` (the overlay's routing: meeting, else travel, else neither), so only one `/` listener exists.
//
// NOTHING HERE TOUCHES MOVEMENT. Releasing the pointer does not stop PLAYER or a Guided journey — the body
// keeps walking while the person types — and the field swallows every keystroke so WASD/E/C/Esc typed into
// it never reach the world. Esc in particular is prevented AND stopped here, so the world's own Esc (which
// leaves Go Together or a directed meeting) cannot fire on the press that closes the composer.

export interface SlashComposerOptions {
  /** Whether this context owns `/` right now. */
  active: boolean;
  onSend: (text: string) => void;
  /** Give the pointer back from the caller's own gesture (Enter). */
  onResumePointer?: () => void;
}

export function useSlashComposer({ active, onSend, onResumePointer }: SlashComposerOptions) {
  const [draft, setDraft] = useState("");
  /** True while the field has focus — "the person is in the chat right now". */
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** `/` ANYWHERE WHILE ACTIVE: release the pointer and focus the field, in one gesture.
   *
   *  Guarded by the world's own typing test, so `/` inside any field — including this one — is a
   *  slash, and by `active`, so it is never taken outside its context, in another view, or in a dialog. */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e)) return;
      e.preventDefault();
      // A locked pointer delivers no DOM events at all, so the field could never be clicked into
      // while PLAYER holds the mouse. Releasing is what makes `/` the way in rather than a dead key.
      if (document.pointerLockElement != null) document.exitPointerLock();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // Leaving the context takes the draft with it.
  useEffect(() => {
    if (active) return;
    setDraft("");
  }, [active]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (text) onSend(text);
    setDraft("");
    inputRef.current?.blur();
    // ASK FOR THE POINTER BACK FROM THIS KEYPRESS. Only a user gesture may take a pointer lock, and
    // Enter is one — so the person goes straight back to walking. If the browser refuses, PlayerInput
    // turns on unlocked mouse-look and a world click remains the way to the real thing.
    onResumePointer?.();
  }, [draft, onSend, onResumePointer]);

  const inputProps = {
    ref: inputRef,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onFocus: () => setComposing(true),
    onBlur: () => setComposing(false),
    // Every keystroke stops here. The world binds WASD, Shift, E, V, C, Esc and `/`; a key meant for
    // this field must never also walk the avatar, switch the camera or leave a journey.
    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
        return;
      }
      if (e.key === "Escape") {
        // OUT WITHOUT SENDING, and the draft goes with it. Prevented as well as stopped: the world's Esc
        // skips a defaultPrevented press, so this one closes the composer and nothing else.
        e.preventDefault();
        setDraft("");
        inputRef.current?.blur();
      }
    },
    onKeyUp: (e: ReactKeyboardEvent<HTMLInputElement>) => e.stopPropagation(),
  };

  return { composing, inputProps };
}
