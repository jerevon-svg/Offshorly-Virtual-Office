// Shared avatar-generation types. Kept framework-agnostic (no React) so
// both Mock/Real service implementations and the AvatarCreator UI can
// share them, mirroring the app/src/services/zoho/ convention.

// Canonical facing-direction type lives in data/bonWalkFrames.ts (it owns the
// actual sprite imports); re-exported here so avatar types can reference it
// without services/ importing from data/ directly in more than one place.
export type { WalkDirection } from "../../data/bonWalkFrames";
import type { WalkDirection } from "../../data/bonWalkFrames";

export type OutfitId = "business-suit" | "smart-casual" | "polo" | "hoodie" | "barong" | "uniform";

// A full per-employee sprite set matching Bon's real asset shape exactly:
// 8 walk frames (2 per direction x4), 4 idle frames (1 per direction x4),
// 8 pat frames (2 per direction x4) = 20 slots total. Optional on
// GeneratedAvatar/SavedAvatar — Slice 1 has no generator producing these yet,
// so every avatar today (and every record already in localStorage) simply
// omits it and keeps rendering as a static portrait.
export interface AvatarSpriteSet {
  walk: Record<WalkDirection, readonly [string, string]>;
  idle: Record<WalkDirection, string>;
  pat: Record<WalkDirection, readonly [string, string]>;
}

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
  // Optional per-employee animated sprite set (Slice 1 groundwork — no
  // generator populates this yet). Absent on every avatar produced today and
  // on any SavedAvatar already sitting in a user's localStorage; consumers
  // must treat it as "static portrait" whenever it's undefined.
  spriteSet?: AvatarSpriteSet;
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
