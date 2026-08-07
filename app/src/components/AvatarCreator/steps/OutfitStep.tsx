import styles from "../AvatarCreator.module.css";
import { OUTFIT_OPTIONS } from "../outfitOptions";
import type { OutfitId } from "../../../services/avatar/types";

type Props = {
  outfitId: OutfitId | null;
  setOutfitId: (id: OutfitId) => void;
  onNext: () => void;
};

export function OutfitStep({ outfitId, setOutfitId, onNext }: Props) {
  return (
    <>
      <div className={styles.title}>Pick an outfit</div>
      <div className={styles.outfitGrid}>
        {OUTFIT_OPTIONS.map((outfit) => (
          <button
            key={outfit.id}
            type="button"
            className={`${styles.outfitTile} ${
              outfitId === outfit.id ? styles.outfitTileSelected : ""
            }`}
            onClick={() => setOutfitId(outfit.id)}
            aria-pressed={outfitId === outfit.id}
          >
            <span className={styles.outfitSwatch} style={{ background: outfit.colorHex }} />
            <span className={styles.outfitLabel}>{outfit.label}</span>
          </button>
        ))}
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={!outfitId} onClick={onNext}>
          Continue
        </button>
      </div>
    </>
  );
}

export default OutfitStep;
