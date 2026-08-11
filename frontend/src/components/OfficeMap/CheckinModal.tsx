import styles from "./CheckinModal.module.css";

type Props = {
  onYes: () => void;
  onNotNow: () => void;
};

// Centered onboarding popup #1 — "Want to check in?" — not anchored to a
// click point (unlike CharacterActionMenu/RoomSidebar), so no `anchor` prop.
export function CheckinModal({ onYes, onNotNow }: Props) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>Want to check in?</div>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onYes}>
            Yes, check me in
          </button>
          <button className={styles.secondary} onClick={onNotNow}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export default CheckinModal;
