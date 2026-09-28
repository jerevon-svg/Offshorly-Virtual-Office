// vo3d app — GO TOGETHER PHASE 5: TALKING ON THE WAY.
//
// WHAT IT IS. A compact, temporary strip for the people walking to a meeting together: the last few lines
// said on this journey and the same `/` composer the meeting's chat uses (useSlashComposer). Speech bubbles
// over the walkers carry the conversation in the world; this is what keeps it readable when a bubble is
// not — mid-ride in the lift, behind a wall, off-screen.
//
// WHAT IT IS NOT. Not a chat window and not history: the lines live in travelPartyStore's small rolling
// window, arrive only from the server's relay to the party's current travellers, and are gone when the
// journey is. Nothing here creates a conversation, an unread, a notification or a quest credit.
//
// WALKING NEVER STOPS. Opening the composer releases the pointer (so the field can take the keyboard) but
// never the Guided journey: the body keeps walking while the person types, and Enter asks for the pointer
// back from its own keypress. Esc closes the composer only — see useSlashComposer.
import { useMemo } from "react";
import type { TravelChatLine } from "../../../services/party/travelPartyStore";
import { useSlashComposer } from "./useSlashComposer";
import styles from "./Vo3dTravelChat.module.css";

export interface Vo3dTravelChatProps {
  /** True only while this tab is one of the party's current travellers (app/travelChat inTravelChat) AND
   *  no meeting has taken over `/`. */
  active: boolean;
  selfId: string;
  lines: TravelChatLine[];
  resolveDisplayName: (email: string) => string;
  onSend: (text: string) => void;
  onResumePointer?: () => void;
}

/** A glance, not a scroll-back: the newest few lines. */
const VISIBLE_LINES = 4;

export function Vo3dTravelChat({ active, selfId, lines, resolveDisplayName, onSend, onResumePointer }: Vo3dTravelChatProps) {
  const { composing, inputProps } = useSlashComposer({ active, onSend, onResumePointer });
  const rows = useMemo(() => {
    const recent = lines.slice(-VISIBLE_LINES);
    return recent.map((m, i) => ({ ...m, age: recent.length - 1 - i }));
  }, [lines]);

  if (!active) return null;

  return (
    <div
      className={[styles.root, composing ? styles.active : ""].filter(Boolean).join(" ")}
      data-testid="vo3d-travel-chat"
      data-composing={composing ? "true" : "false"}
    >
      {rows.length > 0 && (
        <div className={styles.feed} data-testid="travel-chat-feed">
          {rows.map((m) => (
            <div
              key={m.id}
              className={[styles.line, m.email === selfId ? styles.own : "", m.age > 0 ? styles[`age${Math.min(m.age, 3)}`] : ""]
                .filter(Boolean)
                .join(" ")}
              data-testid="travel-chat-line"
            >
              <span className={styles.who}>{m.email === selfId ? "You" : resolveDisplayName(m.email)}</span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.composer}>
        <span className={styles.badge} aria-hidden="true">On the way</span>
        <input
          {...inputProps}
          className={styles.input}
          maxLength={400}
          placeholder="Press / to talk to your group"
          aria-label="Talk to your group"
          data-testid="travel-chat-input"
        />
      </div>
    </div>
  );
}

export default Vo3dTravelChat;
