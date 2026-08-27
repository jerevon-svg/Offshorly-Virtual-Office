import type { ReactNode } from "react";
import styles from "./ConversationView.module.css";

// Renders message text with a subtle highlight over each validated mention (mentionedEmails —
// server-checked participant emails, see backend's insert_message) — locates WHERE to draw the
// highlight by matching "@currentDisplayName" for each mentioned email, but WHO was mentioned is
// never decided here (that's mentionedEmails itself). The current viewer's own mention gets a
// slightly more noticeable treatment; everyone else's stays subtle.
export function renderMessageText(
  text: string,
  mentionedEmails: string[],
  resolveDisplayName: (email: string) => string,
  selfEmail: string,
): ReactNode {
  if (!mentionedEmails || mentionedEmails.length === 0) return text;

  type Span = { start: number; end: number; isSelf: boolean };
  const spans: Span[] = [];
  const selfLower = selfEmail.toLowerCase();

  for (const email of mentionedEmails) {
    const token = `@${resolveDisplayName(email)}`;
    if (!token || token === "@") continue;
    let idx = text.indexOf(token);
    while (idx !== -1) {
      spans.push({ start: idx, end: idx + token.length, isSelf: email.toLowerCase() === selfLower });
      idx = text.indexOf(token, idx + token.length);
    }
  }

  if (spans.length === 0) return text;
  spans.sort((a, b) => a.start - b.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // defensive: skip an overlapping span
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start));
    nodes.push(
      <span
        key={span.start}
        className={span.isSelf ? `${styles.mention} ${styles.mentionSelf}` : styles.mention}
      >
        {text.slice(span.start, span.end)}
      </span>,
    );
    cursor = span.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
