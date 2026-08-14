// Shared localStorage persistence for saved avatars — used by both
// MockAvatarService and RealAvatarService so the office map's
// loadSavedAvatars() read path keeps working regardless of which generation
// mode produced the avatar.

import type { SaveAvatarRequest, SavedAvatar } from "./types";

export const AVATAR_STORAGE_KEY = "offshorly.avatars";

// Shared read helper — the office map reads the same localStorage-backed list
// to place saved avatars as character layers in their chosen room.
export function loadSavedAvatars(): SavedAvatar[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return [];
  const raw = window.localStorage.getItem(AVATAR_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SavedAvatar[];
  } catch {
    return [];
  }
}

// Appends one saved avatar to the persisted list, building the SavedAvatar
// record from a GeneratedAvatar + SaveAvatarRequest metadata. Shared by both
// services so persistence logic lives in exactly one place.
export function persistSavedAvatar(req: SaveAvatarRequest): SavedAvatar {
  const saved: SavedAvatar = {
    ...req.avatar,
    outfitId: req.outfitId,
    employeeName: req.employeeName,
    nickname: req.nickname,
    roomId: req.roomId,
    savedAt: new Date().toISOString(),
    ownerEmail: req.ownerEmail,
  };

  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    const existing = loadSavedAvatars();
    existing.push(saved);
    window.localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(existing));
  }

  return saved;
}

// Finds a previously saved avatar belonging to `email`, matched by
// ownerEmail (case-/whitespace-insensitive, matching the convention every
// other email-keyed lookup in this app uses — see avatarIdentity.ts /
// roomIdentity.ts). Used to decide whether a signed-in user already has a
// generated character before routing them into the creation flow again.
// Returns null for a legacy record with no ownerEmail (saved before this
// field existed) — such a record simply can't be claimed by email lookup.
export function findSavedAvatarByOwnerEmail(email: string | null | undefined): SavedAvatar | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const existing = loadSavedAvatars();
  return existing.find((a) => a.ownerEmail?.trim().toLowerCase() === normalized) ?? null;
}

// Patches an existing stored record in place, matched by avatarId — used by
// the placeholder-swap flow (OfficeMap) once a background generation job
// finishes and the placeholder needs replacing with the real
// previewUrl/spriteSet, and to flip generationStatus to "ready"/"error".
// No-op (returns null) if the avatarId isn't found — e.g. the user cleared
// localStorage mid-generation.
export function updateSavedAvatar(avatarId: string, patch: Partial<SavedAvatar>): SavedAvatar | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
  const existing = loadSavedAvatars();
  const index = existing.findIndex((a) => a.avatarId === avatarId);
  if (index === -1) return null;
  const updated: SavedAvatar = { ...existing[index], ...patch };
  existing[index] = updated;
  window.localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(existing));
  return updated;
}
