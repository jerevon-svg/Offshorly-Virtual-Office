import { useState } from "react";
import styles from "./AvatarCreator.module.css";
import { UploadStep } from "./steps/UploadStep";
import { AnalyzingStep } from "./steps/AnalyzingStep";
import { ReviewStep } from "./steps/ReviewStep";
import { NicknameStep } from "./steps/NicknameStep";
import { OutfitStep } from "./steps/OutfitStep";
import { RoomStep } from "./steps/RoomStep";
import { SavedStep } from "./steps/SavedStep";
import type { GeneratedAvatar, OutfitId, SavedAvatar } from "../../services/avatar/types";

type Step = "upload" | "analyzing" | "review" | "nickname" | "outfit" | "room" | "saved";

type Props = {
  onClose: () => void;
  // Fired the moment a new avatar is persisted (nickname + roomId included)
  // — lets the office map place the resulting character on the map
  // immediately without waiting for the modal to close.
  onAvatarSaved?: (saved: SavedAvatar) => void;
};

// Standalone avatar-creator flow. Mocked end-to-end (see src/services/avatar/).
// Saving now also spawns a static-portrait character layer in the chosen
// team room on the office map (see OfficeMap's onAvatarSaved handling) —
// generating a real per-employee sprite set is a separate, not-yet-scoped
// "Track 1" problem; this reuses the mock preview portrait as a placeholder.
export function AvatarCreator({ onClose, onAvatarSaved }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [avatar, setAvatar] = useState<GeneratedAvatar | null>(null);
  const [nickname, setNickname] = useState("");
  const [outfitId, setOutfitId] = useState<OutfitId | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
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
            onConfirm={() => setStep("nickname")}
          />
        )}
        {step === "nickname" && (
          <NicknameStep
            nickname={nickname}
            setNickname={setNickname}
            onNext={() => setStep("outfit")}
          />
        )}
        {step === "outfit" && avatar && (
          <OutfitStep
            outfitId={outfitId}
            setOutfitId={setOutfitId}
            onNext={() => setStep("room")}
          />
        )}
        {step === "room" && avatar && outfitId && (
          <RoomStep
            avatar={avatar}
            employeeName={employeeName}
            nickname={nickname}
            outfitId={outfitId}
            roomId={roomId}
            setRoomId={setRoomId}
            onSaved={(result) => {
              setSavedAvatar(result);
              onAvatarSaved?.(result);
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
