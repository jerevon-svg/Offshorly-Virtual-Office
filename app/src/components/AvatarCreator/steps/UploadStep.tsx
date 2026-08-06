import { useState } from "react";
import styles from "../AvatarCreator.module.css";
import { avatarService } from "../../../services/avatar/index";
import type { GeneratedAvatar } from "../../../services/avatar/types";

type Props = {
  photoDataUrl: string | null;
  employeeName: string;
  setEmployeeName: (name: string) => void;
  onPhotoChosen: (dataUrl: string) => void;
  onGenerating: () => void;
  onGenerated: (avatar: GeneratedAvatar) => void;
};

export function UploadStep({
  photoDataUrl,
  employeeName,
  setEmployeeName,
  onPhotoChosen,
  onGenerating,
  onGenerated,
}: Props) {
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onPhotoChosen(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleGenerate() {
    if (!photoDataUrl) return;
    setError(null);
    onGenerating();
    try {
      const result = await avatarService.generateAvatar({
        photoDataUrl,
        employeeName: employeeName || undefined,
      });
      onGenerated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate avatar");
    }
  }

  return (
    <>
      <div className={styles.title}>Create your avatar</div>
      <div className={styles.subtitle}>Upload a photo to generate your OffshorlyChibi avatar.</div>
      <input
        type="file"
        accept="image/*"
        className={styles.fileInput}
        onChange={handleFileChange}
      />
      {photoDataUrl && (
        <img src={photoDataUrl} alt="Selected photo preview" className={styles.previewThumb} />
      )}
      <input
        type="text"
        placeholder="Your name (optional)"
        className={styles.nameInput}
        value={employeeName}
        onChange={(e) => setEmployeeName(e.target.value)}
      />
      {error && <div className={styles.subtitle}>{error}</div>}
      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled={!photoDataUrl}
          onClick={handleGenerate}
        >
          Generate
        </button>
      </div>
    </>
  );
}

export default UploadStep;
