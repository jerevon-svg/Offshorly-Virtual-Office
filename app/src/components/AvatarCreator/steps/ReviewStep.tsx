import { useState } from "react";
import styles from "../AvatarCreator.module.css";
import { avatarService } from "../../../services/avatar/index";
import type { GeneratedAvatar } from "../../../services/avatar/types";

type Props = {
  avatar: GeneratedAvatar;
  photoDataUrl: string;
  employeeName: string;
  onRegenerating: () => void;
  onRegenerated: (avatar: GeneratedAvatar) => void;
  onConfirm: () => void;
};

export function ReviewStep({
  avatar,
  photoDataUrl,
  employeeName,
  onRegenerating,
  onRegenerated,
  onConfirm,
}: Props) {
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate() {
    setError(null);
    onRegenerating();
    try {
      const result = await avatarService.regenerateAvatar(avatar, {
        photoDataUrl,
        employeeName: employeeName || undefined,
      });
      onRegenerated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate avatar");
    }
  }

  return (
    <>
      <div className={styles.title}>Here's your avatar</div>
      <img src={avatar.previewUrl} alt="Generated avatar preview" className={styles.previewThumb} />
      <div className={styles.confidenceBadge}>{Math.round(avatar.confidence * 100)}% match</div>
      {error && <div className={styles.subtitle}>{error}</div>}
      <div className={styles.row}>
        <button className={styles.secondary} onClick={handleRegenerate}>
          Regenerate
        </button>
        <button className={styles.primary} onClick={onConfirm}>
          Looks good →
        </button>
      </div>
    </>
  );
}

export default ReviewStep;
