// A1.4 — the ONE reserved non-human chat author. Mirrors backend/app/services/chat_send.py's
// TOUCAN_CHAT_SENDER: Toucan's messages inside DMs and groups carry this senderId. It is never a
// participant, never in the roster, and never something a person can sign in as — so every
// rendering surface must recognise it explicitly instead of treating "not me" as "the peer".
export const TOUCAN_CHAT_SENDER = "toucan@virtual-office.local";
export const TOUCAN_DISPLAY_NAME = "Toucan";
/** Same glyph the standalone assistant panel uses for its avatar. */
export const TOUCAN_AVATAR_GLYPH = "\u{1F99C}";

export function isToucanSender(senderId: string | null | undefined): boolean {
  return (senderId ?? "").trim().toLowerCase() === TOUCAN_CHAT_SENDER;
}
