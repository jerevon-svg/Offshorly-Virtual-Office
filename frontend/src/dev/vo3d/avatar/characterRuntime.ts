// CHARACTER RUNTIME (DEV-ONLY until validated, 2026-10-13) — what Character Studio adds to the office AT RUNTIME, without
// rewriting a repository file or needing a redeploy:
//   · RUNTIME AVATARS — approved HumanBase heads that are NOT promoted into the repo (HumanBase Studio's /api/runtime/avatars
//     lists only heads that pass the exact checks promotion would make, with every visual sign-off recorded). A static
//     (frozen or promoted) avatar always wins: a runtime entry can never replace an employee's production character.
//   · SAVED OUTFITS — each employee's own wardrobe (VO backend /avatar/wardrobes), keyed by cast id, worn over their approved
//     appearance. Every item is checked against the HumanBase catalogue; anything it does not carry is ignored, so a stale or
//     odd row can only fall back to the default uniform, never break a body or dress somebody else.
// This module is plain data: services/humanbase/characterRuntimeLoader fills it before the world builds its bodies, and
// avatar/humanBody reads it. Empty (the production case) it changes nothing.
import type { EmployeeAvatar } from "../human/humanBaseContract";
import { CATALOGUE_BY_ID } from "../human/humanCatalogue";
import type { ValidatedHead } from "./humanBodyRoster";

export type OutfitSlot = "top" | "bottom" | "shoes";
export const OUTFIT_SLOTS: readonly OutfitSlot[] = ["top", "bottom", "shoes"];
export type OutfitItem = { assetId: string; colorway: string };
export type Outfit = Partial<Record<OutfitSlot, OutfitItem>>;
/** an approved, unpromoted head: the same record a promotion would write, plus where the file is served */
export type RuntimeAvatar = { castId: string; email: string | null; url: string; head: ValidatedHead };

declare global {
  interface WindowEventMap {
    /** a saved outfit — the world re-dresses its own body at once (garments only, never the head) */
    "vo:character-outfit": CustomEvent<{ castId: string; outfit: Outfit }>;
  }
}

const AVATARS = new Map<string, RuntimeAvatar>();
const CAST_BY_EMAIL = new Map<string, string>();
const OUTFITS = new Map<string, Outfit>();
let version = 0;
const listeners = new Set<() => void>();
const changed = () => { version++; for (const l of listeners) l(); };

/** register runtime avatars; `isStatic` names the cast ids the bundle already draws (those are never overridden) */
export function registerRuntimeAvatars(list: readonly RuntimeAvatar[], isStatic: (castId: string) => boolean): void {
  AVATARS.clear(); CAST_BY_EMAIL.clear();
  const byEmail = new Map<string, string[]>();
  for (const a of list) {
    if (!/^[a-z0-9-]{1,40}$/.test(a.castId) || isStatic(a.castId) || AVATARS.has(a.castId)) continue;
    AVATARS.set(a.castId, a);
    const e = a.email?.trim().toLowerCase(); if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), a.castId]);
  }
  // one email → one character: an email the registry ties to two ids is ambiguous, and an ambiguous person gets neither
  for (const [e, ids] of byEmail) if (ids.length === 1) CAST_BY_EMAIL.set(e, ids[0]); else for (const id of ids) AVATARS.delete(id);
  changed();
}
export const runtimeAvatar = (castId: string | null | undefined): RuntimeAvatar | null => (castId ? AVATARS.get(castId) ?? null : null);
export const runtimeAvatars = (): readonly RuntimeAvatar[] => [...AVATARS.values()];
export const runtimeCastIdForEmail = (email: string | null | undefined): string | null => (email ? CAST_BY_EMAIL.get(email.trim().toLowerCase()) ?? null : null);

/** is this a garment + colourway the catalogue carries for this slot? */
export function validOutfitItem(slot: OutfitSlot, item: unknown): item is OutfitItem {
  const it = item as Partial<OutfitItem> | null;
  if (!it || typeof it.assetId !== "string" || typeof it.colorway !== "string") return false;
  const asset = CATALOGUE_BY_ID.get(it.assetId);
  return !!asset && asset.slot === slot && !!asset.colorways?.[it.colorway];
}
/** only the valid part of an outfit */
export function cleanOutfit(outfit: unknown): Outfit {
  const out: Outfit = {};
  if (!outfit || typeof outfit !== "object") return out;
  for (const slot of OUTFIT_SLOTS) { const it = (outfit as Record<string, unknown>)[slot]; if (validOutfitItem(slot, it)) out[slot] = { assetId: it.assetId, colorway: it.colorway }; }
  return out;
}
/** an appearance wearing an outfit: valid slots replace the appearance's own, everything else (head, hair, accessories) is untouched */
export function wearOutfit(cfg: EmployeeAvatar, outfit: Outfit | null | undefined): EmployeeAvatar {
  const o = cleanOutfit(outfit); if (!Object.keys(o).length) return cfg;
  return { ...cfg, ...o };
}

/** saved outfits by cast id (replaces the set) */
export function setOutfits(byCast: ReadonlyMap<string, Outfit>): void { OUTFITS.clear(); for (const [id, o] of byCast) { const c = cleanOutfit(o); if (Object.keys(c).length) OUTFITS.set(id, c); } changed(); }
/** one employee's outfit, after they saved it */
export function setOutfit(castId: string, outfit: Outfit): void { const c = cleanOutfit(outfit); if (Object.keys(c).length) OUTFITS.set(castId, c); else OUTFITS.delete(castId); changed(); }
export const outfitFor = (castId: string | null | undefined): Outfit | null => (castId ? OUTFITS.get(castId) ?? null : null);

export const characterRuntimeVersion = (): number => version;
export function subscribeCharacterRuntime(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb); }
export function resetCharacterRuntimeForTests(): void { AVATARS.clear(); CAST_BY_EMAIL.clear(); OUTFITS.clear(); changed(); }
