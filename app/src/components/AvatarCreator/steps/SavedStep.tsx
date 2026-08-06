import styles from "../AvatarCreator.module.css";
import { OUTFIT_OPTIONS } from "../outfitOptions";
import type { SavedAvatar } from "../../../services/avatar/types";

type Props = {
  savedAvatar: SavedAvatar;
  onDone: () => void;
};

export function SavedStep({ savedAvatar, onDone }: Props) {
  const outfitLabel =
    OUTFIT_OPTIONS.find((o) => o.id === savedAvatar.outfitId)?.label ?? savedAvatar.outfitId;

  return (
    <div className={styles.savedCard}>
      <div className={styles.title}>Avatar saved!</div>
      <img src={savedAvatar.previewUrl} alt="Saved avatar preview" className={styles.previewThumb} />
      <div className={styles.subtitle}>{savedAvatar.employeeName}</div>
      <div className={styles.subtitle}>Outfit: {outfitLabel}</div>
      <div className={styles.actions}>
        <button className={styles.primary} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export default SavedStep;
