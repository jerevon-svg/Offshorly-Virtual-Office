import type { ChatMessage } from "./types";

// Rich Chat Phase 1 — THE TRUSTED STICKER REGISTRY. A sticker message stores only a stable id
// (kind "sticker", meta { stickerId }, text ""); sender and every recipient render it from this
// table, so no markup, asset path or URL ever travels in a message. The backend validates the id's
// SHAPE only (STICKER_ID_PATTERN in backend/app/services/chat_send.py — keep the two in step), so
// adding or replacing artwork is a change here and nowhere else.
//
// TO ADD REAL ARTWORK LATER: give a definition a `src` (a static asset under /public, e.g.
// "/stickers/wave.webp") — StickerView renders the image instead of the glyph. Never rename or
// reuse an id: history stores it forever. Retire a sticker by setting `retired: true` (still renders
// from history, hidden from the picker) or by deleting it (history falls back to "Sticker").
export interface StickerDefinition {
  id: string;
  /** Accessible name and hover text. */
  label: string;
  /** Placeholder face until real artwork exists — an ordinary emoji, no custom branding. */
  glyph: string;
  /** Short caption drawn under the glyph. */
  caption: string;
  /** Future artwork, a trusted static asset path. Absent for every placeholder. */
  src?: string;
  /** Kept renderable for history, but no longer offered in the picker. */
  retired?: boolean;
}

export const STICKER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

// Starter set — functional placeholders only, sized to prove the system.
export const STICKERS: readonly StickerDefinition[] = [
  { id: "wave", label: "Wave hello", glyph: "👋", caption: "Hi!" },
  { id: "thumbs-up", label: "Thumbs up", glyph: "👍", caption: "Nice" },
  { id: "celebrate", label: "Celebrate", glyph: "🎉", caption: "Woohoo" },
  { id: "on-it", label: "On it", glyph: "🚀", caption: "On it" },
  { id: "coffee", label: "Coffee break", glyph: "☕", caption: "Brb" },
  { id: "thanks", label: "Thank you", glyph: "🙏", caption: "Thanks" },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export function getSticker(id: string | null | undefined): StickerDefinition | null {
  return (id && BY_ID.get(id)) || null;
}

/** Stickers the picker offers — every definition that is not retired. */
export function pickableStickers(): StickerDefinition[] {
  return STICKERS.filter((s) => !s.retired);
}

export function isStickerMessage(msg: Pick<ChatMessage, "kind">): boolean {
  return msg.kind === "sticker";
}

/** The sticker id a message carries, or null when it is not a (well-formed) sticker message. */
export function stickerIdOf(msg: Pick<ChatMessage, "kind" | "meta">): string | null {
  if (!isStickerMessage(msg)) return null;
  const id = msg.meta?.stickerId;
  return typeof id === "string" && STICKER_ID_PATTERN.test(id) ? id : null;
}

/** Plain-text stand-in for surfaces that can only show text (an avatar speech bubble). */
export function messageSpeechText(msg: Pick<ChatMessage, "kind" | "meta" | "text">): string {
  if (!isStickerMessage(msg)) return msg.text;
  return getSticker(stickerIdOf(msg))?.glyph ?? "Sticker";
}
