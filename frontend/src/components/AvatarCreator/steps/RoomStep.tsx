import { useState } from "react";
import styles from "../AvatarCreator.module.css";
import { teamRooms } from "../../../data/office-layout";
import type { SavedAvatar } from "../../../services/avatar/types";

type Props = {
  nickname: string;
  roomId: string | null;
  setRoomId: (id: string) => void;
  // Persistence itself is built by the caller (AvatarCreator.tsx) — mock
  // mode and real mode's non-blocking placeholder flow build very different
  // SaveAvatarRequest shapes, so RoomStep only owns the room-picker UI and
  // the saving/error state around calling whichever closure it's handed.
  onSave: (roomId: string) => Promise<SavedAvatar>;
  onSaved: (saved: SavedAvatar) => void;
};

// Final step — team/room assignment, then persists the avatar (nickname +
// roomId included) via onSave. Placing the resulting character on the office
// map itself happens in OfficeMap, which reads saved avatars back out of
// storage.
export function RoomStep({ nickname, roomId, setRoomId, onSave, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!roomId) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(roomId);
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save avatar");
      setSaving(false);
    }
  }

  return (
    <>
      <div className={styles.title}>Pick your team</div>
      <div className={styles.subtitle}>Where will {nickname} sit in the office?</div>
      <div className={styles.outfitGrid}>
        {teamRooms.map((room) => (
          <button
            key={room.id}
            type="button"
            className={`${styles.outfitTile} ${
              roomId === room.id ? styles.outfitTileSelected : ""
            }`}
            onClick={() => setRoomId(room.id)}
            aria-pressed={roomId === room.id}
          >
            <span className={styles.outfitLabel}>{room.name}</span>
          </button>
        ))}
      </div>
      {error && <div className={styles.subtitle}>{error}</div>}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={!roomId || saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}

export default RoomStep;
