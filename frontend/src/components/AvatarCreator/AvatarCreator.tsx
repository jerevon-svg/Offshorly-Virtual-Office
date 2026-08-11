import { useState } from "react";
import styles from "./AvatarCreator.module.css";
import { UploadStep } from "./steps/UploadStep";
import { AnalyzingStep } from "./steps/AnalyzingStep";
import { ReviewStep } from "./steps/ReviewStep";
import { NicknameStep } from "./steps/NicknameStep";
import { OutfitStep } from "./steps/OutfitStep";
import { RoomStep } from "./steps/RoomStep";
import { SavedStep } from "./steps/SavedStep";
import { avatarGenerationMode, avatarService } from "../../services/avatar/index";
import { updateSavedAvatar } from "../../services/avatar/avatarStorage";
import { PLACEHOLDER_PREVIEW_URL, PLACEHOLDER_SPRITE_SET } from "../../services/avatar/placeholder";
import type {
  AvatarGenerationProgress,
  GeneratedAvatar,
  OutfitId,
  SavedAvatar,
} from "../../services/avatar/types";

type Step = "upload" | "analyzing" | "review" | "nickname" | "outfit" | "room" | "saved";

type Props = {
  onClose: () => void;
  // Fired the moment a new avatar is persisted (nickname + roomId included)
  // — lets the office map place the resulting character on the map
  // immediately without waiting for the modal to close.
  onAvatarSaved?: (saved: SavedAvatar) => void;
};

// Standalone avatar-creator flow. Mock mode is mocked end-to-end (see
// src/services/avatar/). Real mode (avatarGenerationMode === "real") uses a
// non-blocking flow instead: the background generation job starts on upload
// and keeps running while the user picks nickname/outfit/room, then a
// placeholder character (see services/avatar/placeholder.ts) is saved and
// placed on the map immediately — the Analyzing/Review steps are skipped
// entirely, and OfficeMap swaps the placeholder for the real result once the
// background job finishes (see OfficeMap.tsx's poll-on-mount/on-save logic).
export function AvatarCreator({ onClose, onAvatarSaved }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [avatar, setAvatar] = useState<GeneratedAvatar | null>(null);
  // Real mode only — the background job's id, captured the moment it starts
  // (before nickname/outfit/room are even picked) so the placeholder record
  // saved at the end can carry a stable avatarId across the later swap.
  const [jobId, setJobId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [outfitId, setOutfitId] = useState<OutfitId | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [savedAvatar, setSavedAvatar] = useState<SavedAvatar | null>(null);
  // Live progress from RealAvatarService's anchor + 20-slot pipeline —
  // MockAvatarService never calls this, so it just stays null in mock mode.
  const [progress, setProgress] = useState<AvatarGenerationProgress | null>(null);

  const isRealMode = avatarGenerationMode === "real";

  async function saveMockAvatar(pickedRoomId: string): Promise<SavedAvatar> {
    if (!avatar || !outfitId) throw new Error("Missing generated avatar or outfit");
    return avatarService.saveAvatar({
      avatar,
      outfitId,
      employeeName: employeeName || "Unnamed",
      nickname,
      roomId: pickedRoomId,
    });
  }

  async function savePlaceholderAvatar(pickedRoomId: string): Promise<SavedAvatar> {
    if (!jobId || !outfitId) throw new Error("Missing generation job or outfit");
    const placeholderAvatar: GeneratedAvatar = {
      // Stable id across the later real-result swap (see OfficeMap.tsx).
      avatarId: jobId,
      previewUrl: PLACEHOLDER_PREVIEW_URL,
      spriteSet: PLACEHOLDER_SPRITE_SET,
      confidence: 0,
      seed: jobId,
      generatedAt: new Date().toISOString(),
    };
    const saved = await avatarService.saveAvatar({
      avatar: placeholderAvatar,
      outfitId,
      employeeName: employeeName || "Unnamed",
      nickname,
      roomId: pickedRoomId,
    });
    // saveAvatar's return type doesn't carry generationStatus/jobId — patch
    // them onto the just-persisted record in one localStorage write.
    return (
      updateSavedAvatar(saved.avatarId, { generationStatus: "pending", jobId }) ?? {
        ...saved,
        generationStatus: "pending",
        jobId,
      }
    );
  }

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
            onGenerating={() => {
              setProgress(null);
              setStep("analyzing");
            }}
            onGenerated={(result) => {
              setAvatar(result);
              setStep("review");
            }}
            onProgress={setProgress}
            onJobStarted={(startedJobId) => {
              setJobId(startedJobId);
              // Real mode: skip Analyzing/Review entirely — the job keeps
              // running in the background while the user continues.
              setStep("nickname");
            }}
          />
        )}
        {step === "analyzing" && <AnalyzingStep progress={progress} />}
        {step === "review" && avatar && photoDataUrl && (
          <ReviewStep
            avatar={avatar}
            photoDataUrl={photoDataUrl}
            employeeName={employeeName}
            onRegenerating={() => {
              setProgress(null);
              setStep("analyzing");
            }}
            onRegenerated={(result) => {
              setAvatar(result);
              setStep("review");
            }}
            onConfirm={() => setStep("nickname")}
            onProgress={setProgress}
          />
        )}
        {step === "nickname" && (
          <NicknameStep
            nickname={nickname}
            setNickname={setNickname}
            onNext={() => setStep("outfit")}
          />
        )}
        {step === "outfit" && (
          <OutfitStep
            outfitId={outfitId}
            setOutfitId={setOutfitId}
            onNext={() => setStep("room")}
          />
        )}
        {step === "room" && outfitId && (
          <RoomStep
            nickname={nickname}
            roomId={roomId}
            setRoomId={setRoomId}
            onSave={isRealMode ? savePlaceholderAvatar : saveMockAvatar}
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
