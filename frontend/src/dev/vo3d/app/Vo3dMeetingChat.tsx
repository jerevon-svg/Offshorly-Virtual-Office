// vo3d app — PHASE 7D: THE MEETING'S OWN CHAT, AS A LIVESTREAM OVERLAY.
//
// WHAT IT IS NOT. It is not the DM system wearing a different skin: nothing here creates a conversation,
// raises an unread badge, touches the inbox or credits a quest — see services/meeting/meetingChatClient
// for why reusing `messages` would be the wrong answer rather than merely a heavier one. What is said in
// a meeting ends with the meeting. NONE of that changed in this pass: the client, the socket transport,
// the membership gate, the history and the lifecycle are all exactly as they were. Only the surface and
// the way you reach it are new.
//
// WHY THE PANEL WENT. A bordered dark box with a header and a close button, in a room whose entire point
// is a 270° curved screen, reads as an application window parked over the show — and chatting meant
// leaving the mouse, clicking a pill, clicking a field, then clicking back into the world. A livestream
// does none of that: lines float at the edge, old ones fade, and the input is a thin always-there strip.
//
// AND THE KEY IS `/`. Press it anywhere in the Cave during a meeting: the pointer is released and the
// field takes focus in one gesture. Enter sends and asks for the pointer back FROM THAT KEYPRESS, which
// is the only moment a browser will grant it. Esc leaves without sending. That is the whole interaction.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  sendMeetingChat,
  sendMeetingReaction,
  useMeetingChat,
} from "../../../services/meeting/meetingChatClient";
import { isTypingTarget } from "./keyGuard";
import styles from "./Vo3dMeetingChat.module.css";

export interface Vo3dMeetingChatProps {
  /** True only while this client is genuinely IN the meeting. Everything here is gated on it, so the
   *  surface cannot exist for somebody merely standing in the Cave — and `/` cannot be hijacked
   *  anywhere else in the world. */
  active: boolean;
  selfId: string;
  resolveDisplayName: (email: string) => string;
  /** True while anybody is sharing: the overlay gets quieter, never absent. */
  presenting?: boolean;
  /** Give the pointer back from the caller's own gesture (Enter). Supplied by the overlay, which owns
   *  the world handle; omitted where there is no pointer to take, in which case sending simply sends. */
  onResumePointer?: () => void;
}

/** THE CURATED SET, now inline rather than behind a tray. Small on purpose: a picker with search and a
 *  thousand glyphs is a chat app's furniture, and this is an overlay on a presentation. */
const REACTIONS = ["👍", "👏", "🔥", "🎉"] as const;
const STICKERS = ["🚀 ship it", "🙋 question"] as const;

/** HOW MANY LINES THE FEED CARRIES.
 *
 *  The column is tall now, so these are upper bounds on what is RENDERED, not on what is visible: the
 *  feed clips at its own height, which is what keeps the layout honest on a short viewport. Reading and
 *  replying wants more history in front of you, so focusing the composer raises the bound; idle keeps
 *  it lower so an untouched overlay is not quietly drawing thirty nodes over the presentation. */
const VISIBLE_LINES = 12;
const VISIBLE_LINES_ACTIVE = 30;

export function Vo3dMeetingChat({
  active,
  selfId,
  resolveDisplayName,
  presenting,
  onResumePointer,
}: Vo3dMeetingChatProps) {
  const chat = useMeetingChat();
  const [draft, setDraft] = useState("");
  /** True while the composer has focus — "the person is in the chat right now". Drives how much
   *  history is kept and how gently the older lines fade; nothing else. */
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** `/` ANYWHERE IN THE MEETING: release the pointer and focus the field, in one gesture.
   *
   *  Guarded by the world's own typing test, so `/` inside any field — including this one — is a
   *  slash, and by `active`, so it is never taken outside a meeting, in another view, or in a dialog. */
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

  // Leaving the meeting takes the draft with it.
  useEffect(() => {
    if (active) return;
    setDraft("");
  }, [active]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (text) sendMeetingChat(text);
    setDraft("");
    inputRef.current?.blur();
    // ASK FOR THE POINTER BACK FROM THIS KEYPRESS. Only a user gesture may take a pointer lock, and
    // Enter is one — so the person goes straight back to walking. If the browser refuses, PlayerInput
    // turns on unlocked mouse-look and a world click remains the way to the real thing.
    onResumePointer?.();
  }, [draft, onResumePointer]);

  /** The newest lines, oldest first, with an age index the stylesheet fades by. */
  const rows = useMemo(() => {
    const recent = chat.messages.slice(-(composing ? VISIBLE_LINES_ACTIVE : VISIBLE_LINES));
    return recent.map((m, i) => ({ ...m, age: recent.length - 1 - i }));
  }, [chat.messages, composing]);

  if (!active) return null;

  return (
    <div
      className={[styles.root, presenting ? styles.presenting : "", composing ? styles.active : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid="vo3d-meeting-chat"
      data-presenting={presenting ? "true" : "false"}
      data-composing={composing ? "true" : "false"}
    >
      <div className={styles.feed} data-testid="meeting-chat-feed">
        {rows.map((m) => (
          <div
            key={m.id}
            className={[
              styles.line,
              m.email === selfId ? styles.own : "",
              m.age > 0 ? styles[`age${Math.min(m.age, 12)}`] : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid="meeting-chat-line"
          >
            <span className={styles.who}>
              {m.email === selfId ? "You" : resolveDisplayName(m.email)}
            </span>
            <span>{m.text}</span>
          </div>
        ))}
      </div>

      <div className={styles.composer}>
        <input
          ref={inputRef}
          className={styles.input}
          value={draft}
          maxLength={400}
          placeholder="Press / to chat..."
          data-testid="meeting-chat-input"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setComposing(true)}
          onBlur={() => setComposing(false)}
          // Every keystroke stops here. The world binds WASD, Shift, E, V, C and `/`; a key meant for
          // this field must never also walk the avatar or switch the camera.
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
              return;
            }
            if (e.key === "Escape") {
              // OUT WITHOUT SENDING, and the draft goes with it.
              e.preventDefault();
              setDraft("");
              inputRef.current?.blur();
            }
          }}
          onKeyUp={(e) => e.stopPropagation()}
        />
        {REACTIONS.map((token) => (
          <button
            key={token}
            type="button"
            className={styles.react}
            onClick={() => sendMeetingReaction(token)}
            aria-label={`React ${token}`}
            data-testid={`meeting-reaction-${token}`}
          >
            {token}
          </button>
        ))}
        {STICKERS.map((token) => (
          <button
            key={token}
            type="button"
            className={`${styles.react} ${styles.sticker}`}
            onClick={() => sendMeetingReaction(token)}
            aria-label={`Send ${token}`}
            data-testid={`meeting-sticker-${token}`}
          >
            {token}
          </button>
        ))}
      </div>
    </div>
  );
}

export default Vo3dMeetingChat;
