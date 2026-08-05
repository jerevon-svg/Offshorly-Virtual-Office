import styles from "./checkout.module.css";

type Props = {
  visible: boolean;
  onLater: () => void;
  onStartCheckout: () => void;
};

// Non-blocking corner toast shown when state === "REMINDER_SHOWN".
export function CheckoutReminderToast({ visible, onLater, onStartCheckout }: Props) {
  if (!visible) return null;
  return (
    <div className={styles.toast}>
      <div className={styles.toastText}>You've completed 8 hours today 🎉 Ready to wrap up?</div>
      <div className={styles.actionsRow}>
        <button className={styles.secondary} onClick={onLater}>
          Later
        </button>
        <button className={styles.primary} onClick={onStartCheckout}>
          Start checkout
        </button>
      </div>
    </div>
  );
}

export default CheckoutReminderToast;
