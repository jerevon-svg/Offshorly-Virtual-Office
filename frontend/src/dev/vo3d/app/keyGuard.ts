// ONE ANSWER TO "IS THIS KEYSTROKE MINE?", shared by everything in V2 that binds a bare letter.
//
// player/PlayerInput has always had this rule and states it as one of its two: even while enabled,
// TYPING WINS. WASD in a message box is a message, not a walk. Phase 7C adds a second bare-letter
// binding (C, the camera cycle) that is live in every view rather than only in PLAYER, which makes the
// rule something two files have to agree on — so it lives here and both import it, rather than being
// written twice and drifting.
//
// IT IS CHECKED ON THE EVENT TARGET, not on document.activeElement alone: lil-gui's sliders are
// focusable divs, and a dialog can hold focus on a container while the press lands on a child.

/** True when the keystroke belongs to something the user is typing in, driving with the mouse, or to a
 *  modal that has taken the screen — in which case the world must not act on it. */
export function isTypingTarget(event: Event): boolean {
  const target = event.target as HTMLElement | null;
  if (target?.closest) {
    if (
      target.closest(
        "input, textarea, select, option, [contenteditable='true'], .lil-gui, [role='dialog'], [role='textbox']",
      )
    ) {
      return true;
    }
  }
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable) return true;
  // A modal that owns the screen owns the keyboard with it — Settings, Tasks, the Chats panel, the
  // employee picker. Its own Escape still works; a world shortcut fired from inside it would not.
  return active.closest?.("[role='dialog']") != null;
}

/** IS THE POINTER LOCKED? `!== null` is the wrong test and it cost the HUD a whole render: an
 *  environment that does not implement pointer lock (jsdom, and older browsers) leaves
 *  `document.pointerLockElement` UNDEFINED, which is not null — so "locked" came back true with no
 *  canvas in sight and the dock hid itself permanently. A null-ish check is the honest one. */
export function isPointerLocked(): boolean {
  return document.pointerLockElement != null;
}
