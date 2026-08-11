import { useEffect } from "react";
import styles from "./CharacterActionMenu.module.css";

type Props = {
  anchor: { clientX: number; clientY: number };
  onClose: () => void;
  // Hidden once already checked in — mirrors the old Arisha-menu gate, just
  // reached via reception now instead of her.
  showCheckIn?: boolean;
  // Gated the same way the rest of the checkout UI is (DEV or real Zoho
  // mode) — see OfficeMap.tsx's checkout-UI guard comment. Only rendering
  // this button under the same guard avoids opening a flow with no visible
  // modal in a prod build without real Zoho integration.
  showCheckOut?: boolean;
  onCheckIn: () => void;
  onCheckOut: () => void;
};

// Anchored action menu opened by clicking the reception room itself — the
// sole entry point for both check-in and check-out. Reuses
// CharacterActionMenu's visual pattern/CSS module for consistency.
export function ReceptionActionMenu({
  anchor,
  onClose,
  showCheckIn,
  showCheckOut,
  onCheckIn,
  onCheckOut,
}: Props) {
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
        <div className={styles.title}>Reception</div>
        {showCheckIn && (
          <button className={styles.item} onClick={onCheckIn}>
            Check In
          </button>
        )}
        {showCheckOut && (
          <button className={styles.item} onClick={onCheckOut}>
            Check Out
          </button>
        )}
      </div>
    </div>
  );
}

export default ReceptionActionMenu;
