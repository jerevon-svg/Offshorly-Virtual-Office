import { useEffect } from "react";
import styles from "./CharacterActionMenu.module.css";

type Props = {
  anchor: { clientX: number; clientY: number };
  onConfirm: () => void;
  onClose: () => void;
};

// Anchored action menu opened by clicking an empty seat marker — single
// "Sit here" confirm action. Reuses CharacterActionMenu's visual pattern/CSS
// module for consistency, same as ReceptionActionMenu.
export function SeatActionMenu({ anchor, onConfirm, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left = Math.min(anchor.clientX + 8, window.innerWidth - 200);
  const top = Math.min(anchor.clientY, window.innerHeight - 160);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.menu} style={{ left, top }} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>Empty seat</div>
        <button className={styles.item} onClick={onConfirm}>
          Sit here
        </button>
      </div>
    </div>
  );
}

export default SeatActionMenu;
