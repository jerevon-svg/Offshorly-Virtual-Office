// Shared avatar-generation types. Kept framework-agnostic (no React) so
// both Mock/Real service implementations and the AvatarCreator UI can
// share them, mirroring the app/src/services/zoho/ convention.

export type OutfitId = "business-suit" | "smart-casual" | "polo" | "hoodie" | "barong" | "uniform";

export interface OutfitOption {
  id: OutfitId;
  label: string;
  colorHex: string;
}

export interface GenerateAvatarRequest {
  photoDataUrl: string;
  employeeName?: string;
}

export interface GeneratedAvatar {
  avatarId: string;
  previewUrl: string;
  confidence: number;
  seed: string;
  generatedAt: string;
}

export interface SaveAvatarRequest {
  avatar: GeneratedAvatar;
  outfitId: OutfitId;
  employeeName: string;
}

export interface SavedAvatar extends GeneratedAvatar {
  outfitId: OutfitId;
  employeeName: string;
  savedAt: string;
}

export interface AvatarGenerationService {
  generateAvatar(req: GenerateAvatarRequest): Promise<GeneratedAvatar>;
  regenerateAvatar(previous: GeneratedAvatar, req: GenerateAvatarRequest): Promise<GeneratedAvatar>;
  saveAvatar(req: SaveAvatarRequest): Promise<SavedAvatar>;
}
