import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { pickableStickers } from "../../services/chat/stickers";
import { ALL_EMOJIS, EMOJI_CATEGORIES, type EmojiEntry } from "./emojiData";
import { StickerView } from "./StickerView";
import styles from "./RichChat.module.css";

// Rich Chat Phase 1 — the composer's ONE popover for expressive content: an Emoji tab (search,
// categories, local-only recents) and a Stickers tab. One toggle, one surface, so the composer gains
// no extra buttons. Presentation only: it reports a pick through onEmoji/onSticker and the composer
// decides what that means (insert at the caret / send a sticker message).
type ComposerPickerProps = {
  onEmoji: (emoji: string) => void;
  /** Omit to hide the Stickers tab. */
  onSticker?: (stickerId: string) => void;
};

const RECENT_KEY = "vo.chat.recentEmoji";
const RECENT_MAX = 16;
// Must match the grid's CSS column count — arrow keys move a row by this many cells.
const GRID_COLUMNS = 8;

// Local-only convenience (per browser, never synced). Every access is guarded: storage can be
// blocked or throw, and the picker must work identically without it.
function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberRecentEmoji(emoji: string): void {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are optional */
  }
}

// Arrow-key roving focus across a grid of buttons marked data-picker-cell.
function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: GRID_COLUMNS, ArrowUp: -GRID_COLUMNS }[e.key];
  if (delta === undefined) return;
  const cells = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-picker-cell]"));
  const index = cells.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  e.preventDefault();
  cells[Math.max(0, Math.min(cells.length - 1, index + delta))]?.focus();
}

export function ComposerPicker({ onEmoji, onSticker }: ComposerPickerProps) {
  const [tab, setTab] = useState<"emoji" | "stickers">("emoji");
  const [query, setQuery] = useState("");
  const [recent] = useState(readRecent);
  const [categoryId, setCategoryId] = useState(recent.length > 0 ? "recent" : EMOJI_CATEGORIES[0].id);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (tab === "emoji") searchRef.current?.focus();
  }, [tab]);

  const visible: readonly EmojiEntry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return ALL_EMOJIS.filter(([emoji, keywords]) => keywords.includes(q) || emoji === q);
    if (categoryId === "recent") return recent.map((emoji) => [emoji, "recent"] as const);
    return EMOJI_CATEGORIES.find((c) => c.id === categoryId)?.emojis ?? [];
  }, [query, categoryId, recent]);

  const categoryLabel =
    categoryId === "recent" ? "Recently used" : EMOJI_CATEGORIES.find((c) => c.id === categoryId)?.label;

  return (
    <div className={styles.picker} role="dialog" aria-label="Emoji and stickers">
      {onSticker && (
        <div className={styles.pickerTabs} role="tablist" aria-label="Picker type">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "emoji"}
            className={tab === "emoji" ? `${styles.pickerTab} ${styles.pickerTabActive}` : styles.pickerTab}
            onClick={() => setTab("emoji")}
          >
            Emoji
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stickers"}
            className={tab === "stickers" ? `${styles.pickerTab} ${styles.pickerTabActive}` : styles.pickerTab}
            onClick={() => setTab("stickers")}
          >
            Stickers
          </button>
        </div>
      )}

      {tab === "emoji" ? (
        <>
          <input
            ref={searchRef}
            className={styles.pickerSearch}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji"
            aria-label="Search emoji"
          />
          {!query && (
            <div className={styles.categoryRow} role="tablist" aria-label="Emoji categories">
              {recent.length > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={categoryId === "recent"}
                  aria-label="Recently used"
                  title="Recently used"
                  className={categoryId === "recent" ? `${styles.categoryTab} ${styles.categoryTabActive}` : styles.categoryTab}
                  onClick={() => setCategoryId("recent")}
                >
                  🕘
                </button>
              )}
              {EMOJI_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={categoryId === c.id}
                  aria-label={c.label}
                  title={c.label}
                  className={categoryId === c.id ? `${styles.categoryTab} ${styles.categoryTabActive}` : styles.categoryTab}
                  onClick={() => setCategoryId(c.id)}
                >
                  {c.icon}
                </button>
              ))}
            </div>
          )}
          <div className={styles.gridLabel}>{query ? "Search results" : categoryLabel}</div>
          <div className={styles.emojiGrid} onKeyDown={onGridKeyDown}>
            {visible.length === 0 ? (
              <div className={styles.pickerEmpty}>No emoji found</div>
            ) : (
              visible.map(([emoji]) => (
                <button
                  key={emoji}
                  type="button"
                  data-picker-cell
                  className={styles.emojiCell}
                  onClick={() => onEmoji(emoji)}
                  aria-label={`Insert ${emoji}`}
                  title={emoji}
                >
                  {emoji}
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        <div className={styles.stickerGrid} onKeyDown={onGridKeyDown}>
          {pickableStickers().map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              data-picker-cell
              className={styles.stickerCell}
              onClick={() => onSticker?.(sticker.id)}
              aria-label={`Send sticker: ${sticker.label}`}
              title={sticker.label}
            >
              <StickerView stickerId={sticker.id} compact />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
