import styles from "./checkout.module.css";

type Props = {
  visible: boolean;
  onNotYet: () => void;
  onStartCheckout: () => void;
};

// Centered confirmation popup shown when state === "CHECKOUT_CONFIRMATION".
export function CheckoutConfirmModal({ visible, onNotYet, onStartCheckout }: Props) {
  if (!visible) return null;
  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>Ready to wrap up your day?</div>
        <div className={styles.body}>
          Your character will leave the room and head to Reception to complete today's work log.
        </div>
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onStartCheckout}>
            Start checkout
          </button>
          <button className={styles.secondary} onClick={onNotYet}>
            Not yet
          </button>
        </div>
      </div>
    </div>
  );
}

export default CheckoutConfirmModal;
