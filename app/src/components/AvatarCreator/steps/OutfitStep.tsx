import { useState } from "react";
import styles from "../AvatarCreator.module.css";
import { OUTFIT_OPTIONS } from "../outfitOptions";
import { avatarService } from "../../../services/avatar/index";
import type { GeneratedAvatar, OutfitId, SavedAvatar } from "../../../services/avatar/types";

type Props = {
  avatar: GeneratedAvatar;
  employeeName: string;
  outfitId: OutfitId | null;
  setOutfitId: (id: OutfitId) => void;
  onSaved: (saved: SavedAvatar) => void;
};

export function OutfitStep({ avatar, employeeName, outfitId, setOutfitId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!outfitId) return;
    setSaving(true);
    setError(null);
    try {
      const result = await avatarService.saveAvatar({
        avatar,
        outfitId,
        employeeName: employeeName || "Unnamed",
      });
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save avatar");
      setSaving(false);
    }
  }

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
      {error && <div className={styles.subtitle}>{error}</div>}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={!outfitId || saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}

export default OutfitStep;
