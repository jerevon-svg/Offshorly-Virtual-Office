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
  // Employee-chosen display name shown around the Virtual Office app.
  // Distinct from `employeeName` (an optional label used only during mock
  // generation) — nickname is required identity, collected in its own step.
  nickname: string;
  // One of the 6 real team-home room ids from data/office-layout.ts `rooms`
  // (ai-room, executive-team, dev-team, cms-team, qa-room, design-team).
  roomId: string;
}

export interface SavedAvatar extends GeneratedAvatar {
  outfitId: OutfitId;
  employeeName: string;
  nickname: string;
  roomId: string;
  savedAt: string;
}

export interface AvatarGenerationService {
  generateAvatar(req: GenerateAvatarRequest): Promise<GeneratedAvatar>;
  regenerateAvatar(previous: GeneratedAvatar, req: GenerateAvatarRequest): Promise<GeneratedAvatar>;
  saveAvatar(req: SaveAvatarRequest): Promise<SavedAvatar>;
}
