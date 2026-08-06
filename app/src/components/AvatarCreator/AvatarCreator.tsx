import { useState } from "react";
import styles from "./AvatarCreator.module.css";
import { UploadStep } from "./steps/UploadStep";
import { AnalyzingStep } from "./steps/AnalyzingStep";
import { ReviewStep } from "./steps/ReviewStep";
import { OutfitStep } from "./steps/OutfitStep";
import { SavedStep } from "./steps/SavedStep";
import type { GeneratedAvatar, OutfitId, SavedAvatar } from "../../services/avatar/types";

type Step = "upload" | "analyzing" | "review" | "outfit" | "saved";

type Props = {
  onClose: () => void;
};

// Standalone avatar-creator flow. Mocked end-to-end (see
// src/services/avatar/) — this modal does not spawn a live character in the
// office map; that requires a separate solve for the static asset-import
// system and is deferred.
export function AvatarCreator({ onClose }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [avatar, setAvatar] = useState<GeneratedAvatar | null>(null);
  const [outfitId, setOutfitId] = useState<OutfitId | null>(null);
  const [savedAvatar, setSavedAvatar] = useState<SavedAvatar | null>(null);

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          ✕
        </button>
        {step === "upload" && (
          <UploadStep
            photoDataUrl={photoDataUrl}
            employeeName={employeeName}
            setEmployeeName={setEmployeeName}
            onPhotoChosen={setPhotoDataUrl}
            onGenerating={() => setStep("analyzing")}
            onGenerated={(result) => {
              setAvatar(result);
              setStep("review");
            }}
          />
        )}
        {step === "analyzing" && <AnalyzingStep />}
        {step === "review" && avatar && photoDataUrl && (
          <ReviewStep
            avatar={avatar}
            photoDataUrl={photoDataUrl}
            employeeName={employeeName}
            onRegenerating={() => setStep("analyzing")}
            onRegenerated={(result) => {
              setAvatar(result);
              setStep("review");
            }}
            onConfirm={() => setStep("outfit")}
          />
        )}
        {step === "outfit" && avatar && (
          <OutfitStep
            avatar={avatar}
            employeeName={employeeName}
            outfitId={outfitId}
            setOutfitId={setOutfitId}
            onSaved={(result) => {
              setSavedAvatar(result);
              setStep("saved");
            }}
          />
        )}
        {step === "saved" && savedAvatar && <SavedStep savedAvatar={savedAvatar} onDone={onClose} />}
      </div>
    </div>
  );
}

export default AvatarCreator;
