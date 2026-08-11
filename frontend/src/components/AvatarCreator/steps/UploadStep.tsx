import { useRef, useState } from "react";
import styles from "../AvatarCreator.module.css";
import { avatarGenerationMode, avatarService } from "../../../services/avatar/index";
import { realAvatarService } from "../../../services/avatar/RealAvatarService";
import type { AvatarGenerationProgress, GeneratedAvatar } from "../../../services/avatar/types";

type Props = {
  photoDataUrl: string | null;
  employeeName: string;
  setEmployeeName: (name: string) => void;
  onPhotoChosen: (dataUrl: string) => void;
  onGenerating: () => void;
  onGenerated: (avatar: GeneratedAvatar) => void;
  onProgress?: (progress: AvatarGenerationProgress) => void;
  // Real mode only (non-blocking flow) — fired the moment a background
  // generation job starts, with just its jobId; the caller advances straight
  // to the nickname step without waiting (see AvatarCreator.tsx). Mock mode
  // never calls this.
  onJobStarted?: (jobId: string) => void;
};

export function UploadStep({
  photoDataUrl,
  employeeName,
  setEmployeeName,
  onPhotoChosen,
  onGenerating,
  onGenerated,
  onProgress,
  onJobStarted,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  // Guards against double-clicking "Generate" spawning a second, equally
  // expensive (~21-call) job while one is already in flight.
  const isSubmittingRef = useRef(false);

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
    if (!photoDataUrl || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setError(null);
    try {
      if (avatarGenerationMode === "real" && onJobStarted) {
        // Non-blocking flow: kick off the background job and hand its jobId
        // straight back — don't await completion here. The caller (real
        // mode only) skips the Analyzing/Review steps entirely.
        const jobId = await realAvatarService.startGenerationJob(
          photoDataUrl,
          employeeName || undefined,
        );
        onJobStarted(jobId);
      } else {
        onGenerating();
        const result = await avatarService.generateAvatar({
          photoDataUrl,
          employeeName: employeeName || undefined,
          onProgress,
        });
        onGenerated(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate avatar");
    } finally {
      isSubmittingRef.current = false;
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
