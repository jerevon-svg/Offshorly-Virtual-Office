import { formatRoomName } from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import styles from "./CheckinModal.module.css";

type Props = {
  rooms: AssetLayer[];
  onChoose: (layer: AssetLayer) => void;
};

// Centered onboarding popup #2 — "Where do you want to go?" — shares
// CheckinModal's panel styling for visual consistency across the onboarding
// sequence, but lists every room instead of a yes/no choice.
export function RoomPickerModal({ rooms, onChoose }: Props) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>Where do you want to go?</div>
        <div className={styles.roomList}>
          {rooms.map((room) => (
            <button key={room.id} className={styles.roomItem} onClick={() => onChoose(room)}>
              {formatRoomName(room.id)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RoomPickerModal;
