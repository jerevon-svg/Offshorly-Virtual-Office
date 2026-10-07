import { getSticker } from "../../services/chat/stickers";
import styles from "./RichChat.module.css";

// Renders one sticker from the trusted registry by id — the only way a sticker reaches the screen,
// for the sender, every recipient and history alike. An id the registry doesn't know (removed, or
// from a newer client) degrades to a quiet placeholder instead of failing.
export function StickerView({ stickerId, compact = false }: { stickerId: string | null; compact?: boolean }) {
  const sticker = getSticker(stickerId);
  if (!sticker) {
    return (
      <span className={styles.stickerMissing} data-testid="sticker-missing" role="img" aria-label="Sticker unavailable">
        Sticker unavailable
      </span>
    );
  }
  return (
    <span
      className={compact ? `${styles.sticker} ${styles.stickerCompact}` : styles.sticker}
      data-testid="sticker"
      data-sticker-id={sticker.id}
      role="img"
      aria-label={sticker.label}
      title={compact ? undefined : sticker.label}
    >
      {sticker.src ? (
        <img className={styles.stickerImage} src={sticker.src} alt="" draggable={false} />
      ) : (
        <span className={styles.stickerGlyph} aria-hidden="true">
          {sticker.glyph}
        </span>
      )}
      <span className={styles.stickerCaption} aria-hidden="true">
        {sticker.caption}
      </span>
    </span>
  );
}
