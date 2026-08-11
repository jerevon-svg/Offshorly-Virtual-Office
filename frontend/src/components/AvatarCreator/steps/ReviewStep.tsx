import { useRef, useState } from "react";
import styles from "../AvatarCreator.module.css";
import { avatarGenerationMode, avatarService } from "../../../services/avatar/index";
import type { AvatarGenerationProgress, GeneratedAvatar } from "../../../services/avatar/types";

type Props = {
  avatar: GeneratedAvatar;
  photoDataUrl: string;
  employeeName: string;
  onRegenerating: () => void;
  onRegenerated: (avatar: GeneratedAvatar) => void;
  onConfirm: () => void;
  onProgress?: (progress: AvatarGenerationProgress) => void;
};

export function ReviewStep({
  avatar,
  photoDataUrl,
  employeeName,
  onRegenerating,
  onRegenerated,
  onConfirm,
  onProgress,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  // Real mode's Regenerate is a second full ~21-call run — guard against a
  // double-click spawning two in flight, on top of hiding the button below.
  const isSubmittingRef = useRef(false);

  async function handleRegenerate() {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setError(null);
    onRegenerating();
    try {
      const result = await avatarService.regenerateAvatar(avatar, {
        photoDataUrl,
        employeeName: employeeName || undefined,
        onProgress,
      });
      onRegenerated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate avatar");
    } finally {
      isSubmittingRef.current = false;
    }
  }

  // Real mode: Regenerate is disabled per the user's explicit approval — it
  // would silently trigger a second ~21-call real API run. Review is the
  // one safety checkpoint for the untested raw-photo->anchor step, so the
  // primary "Looks good" / re-upload-from-scratch path stays available.
  const regenerateDisabled = avatarGenerationMode === "real";

  return (
    <>
      <div className={styles.title}>Here's your avatar</div>
      <img src={avatar.previewUrl} alt="Generated avatar preview" className={styles.previewThumb} />
      <div className={styles.confidenceBadge}>{Math.round(avatar.confidence * 100)}% match</div>
      {error && <div className={styles.subtitle}>{error}</div>}
      <div className={styles.row}>
        {!regenerateDisabled && (
          <button className={styles.secondary} onClick={handleRegenerate}>
            Regenerate
          </button>
        )}
        <button className={styles.primary} onClick={onConfirm}>
          Looks good →
        </button>
      </div>
    </>
  );
}

export default ReviewStep;
