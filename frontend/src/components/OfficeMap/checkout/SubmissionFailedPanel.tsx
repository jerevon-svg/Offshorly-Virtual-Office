import styles from "./checkout.module.css";

type Props = {
  visible: boolean;
  error: string | null;
  onTryAgain: () => void;
  onSaveAndReturnLater: () => void;
};

export function SubmissionFailedPanel({ visible, error, onTryAgain, onSaveAndReturnLater }: Props) {
  if (!visible) return null;
  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.title}>We couldn't submit your work log to Zoho Projects</div>
        <div className={styles.body}>
          Your information has been saved as a draft. You have not been checked out yet.
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <button className={styles.primary} onClick={onTryAgain}>
            Try again
          </button>
          <button className={styles.secondary} onClick={onSaveAndReturnLater}>
            Save and return later
          </button>
        </div>
      </div>
    </div>
  );
}

export default SubmissionFailedPanel;
