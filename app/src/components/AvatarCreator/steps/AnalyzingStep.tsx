import styles from "../AvatarCreator.module.css";

export function AnalyzingStep() {
  return (
    <>
      <div className={styles.title}>Analyzing face…</div>
      <div className={styles.subtitle}>Stylizing into OffshorlyChibi…</div>
      <div className={styles.spinner} />
    </>
  );
}

export default AnalyzingStep;
