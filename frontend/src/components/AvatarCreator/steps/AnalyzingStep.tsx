import styles from "../AvatarCreator.module.css";
import type { AvatarGenerationProgress } from "../../../services/avatar/types";

type Props = {
  // Absent in mock mode (instant fake delay, no real progress to report) —
  // real mode passes live { done, total, slot } updates from RealAvatarService.
  progress?: AvatarGenerationProgress | null;
};

function describeSlot(slot: string): string {
  if (!slot) return "Preparing…";
  if (slot === "anchor") return "Converting your photo into an anchor pose…";
  if (slot === "done") return "Finishing up…";
  return `pose "${slot}"…`;
}

export function AnalyzingStep({ progress }: Props) {
  const hasProgress = Boolean(progress && progress.total > 0);
  const pct = hasProgress ? Math.min(100, Math.round((progress!.done / progress!.total) * 100)) : undefined;

  return (
    <>
      <div className={styles.title}>Analyzing face…</div>
      <div className={styles.subtitle}>
        {hasProgress
          ? `Generating pose ${Math.min(progress!.done + 1, progress!.total)} of ${progress!.total}: ${describeSlot(
              progress!.slot,
            )}`
          : "Stylizing into OffshorlyChibi…"}
      </div>
      {hasProgress ? (
        <div className={styles.progressBarOuter}>
          <div className={styles.progressBarFill} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <div className={styles.spinner} />
      )}
    </>
  );
}

export default AnalyzingStep;
