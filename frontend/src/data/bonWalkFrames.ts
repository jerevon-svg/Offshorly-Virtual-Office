// Bon's hand-made sprite set (replaces the earlier AI-generated
// bon-walk-norm/bon-idle-norm/bon-pat-norm/bon-sit-type-norm assets — see git
// history to roll back). Bon drew idle/sit/walk-A/walk-B for all 4
// directions but no pat pose, so there is no BON_PAT_FRAMES anymore;
// characterSprite() falls back to idle when "pat" is requested for a sprite
// set with no pat frames.
import walkLeft1 from "../assets/office/characters/chibi-bon/left-walk-A.png";
import walkLeft2 from "../assets/office/characters/chibi-bon/left-walk-B.png";
import walkRight1 from "../assets/office/characters/chibi-bon/right-walk-A.png";
import walkRight2 from "../assets/office/characters/chibi-bon/right-walk-B.png";
import walkFront1 from "../assets/office/characters/chibi-bon/front-walk-A.png";
import walkFront2 from "../assets/office/characters/chibi-bon/front-walk-B.png";
import walkBack1 from "../assets/office/characters/chibi-bon/back-walk-A.png";
import walkBack2 from "../assets/office/characters/chibi-bon/back-walk-B.png";

import idleLeft from "../assets/office/characters/chibi-bon/left-idle.png";
import idleRight from "../assets/office/characters/chibi-bon/right-idle.png";
import idleFront from "../assets/office/characters/chibi-bon/front-idle.png";
import idleBack from "../assets/office/characters/chibi-bon/back-idle.png";

import alexWalkLeft1 from "../assets/office/characters/alex-walk-norm/left-1.png";
import alexWalkLeft2 from "../assets/office/characters/alex-walk-norm/left-2.png";
import alexWalkRight1 from "../assets/office/characters/alex-walk-norm/right-1.png";
import alexWalkRight2 from "../assets/office/characters/alex-walk-norm/right-2.png";
import alexWalkFront1 from "../assets/office/characters/alex-walk-norm/front-1.png";
import alexWalkFront2 from "../assets/office/characters/alex-walk-norm/front-2.png";
import alexWalkBack1 from "../assets/office/characters/alex-walk-norm/back-1.png";
import alexWalkBack2 from "../assets/office/characters/alex-walk-norm/back-2.png";

import alexIdleLeft from "../assets/office/characters/alex-idle-norm/left.png";
import alexIdleRight from "../assets/office/characters/alex-idle-norm/right.png";
import alexIdleFront from "../assets/office/characters/alex-idle-norm/front.png";
import alexIdleBack from "../assets/office/characters/alex-idle-norm/back.png";

import alexPatLeft1 from "../assets/office/characters/alex-pat-norm/left-1.png";
import alexPatLeft2 from "../assets/office/characters/alex-pat-norm/left-2.png";
import alexPatRight1 from "../assets/office/characters/alex-pat-norm/right-1.png";
import alexPatRight2 from "../assets/office/characters/alex-pat-norm/right-2.png";
import alexPatFront1 from "../assets/office/characters/alex-pat-norm/front-1.png";
import alexPatFront2 from "../assets/office/characters/alex-pat-norm/front-2.png";
import alexPatBack1 from "../assets/office/characters/alex-pat-norm/back-1.png";
import alexPatBack2 from "../assets/office/characters/alex-pat-norm/back-2.png";

import micahWalkLeft1 from "../assets/office/characters/micah-walk-norm/left-1.png";
import micahWalkLeft2 from "../assets/office/characters/micah-walk-norm/left-2.png";
import micahWalkRight1 from "../assets/office/characters/micah-walk-norm/right-1.png";
import micahWalkRight2 from "../assets/office/characters/micah-walk-norm/right-2.png";
import micahWalkFront1 from "../assets/office/characters/micah-walk-norm/front-1.png";
import micahWalkFront2 from "../assets/office/characters/micah-walk-norm/front-2.png";
import micahWalkBack1 from "../assets/office/characters/micah-walk-norm/back-1.png";
import micahWalkBack2 from "../assets/office/characters/micah-walk-norm/back-2.png";

import micahIdleLeft from "../assets/office/characters/micah-idle-norm/left.png";
import micahIdleRight from "../assets/office/characters/micah-idle-norm/right.png";
import micahIdleFront from "../assets/office/characters/micah-idle-norm/front.png";
import micahIdleBack from "../assets/office/characters/micah-idle-norm/back.png";

import micahPatLeft1 from "../assets/office/characters/micah-pat-norm/left-1.png";
import micahPatLeft2 from "../assets/office/characters/micah-pat-norm/left-2.png";
import micahPatRight1 from "../assets/office/characters/micah-pat-norm/right-1.png";
import micahPatRight2 from "../assets/office/characters/micah-pat-norm/right-2.png";
import micahPatFront1 from "../assets/office/characters/micah-pat-norm/front-1.png";
import micahPatFront2 from "../assets/office/characters/micah-pat-norm/front-2.png";
import micahPatBack1 from "../assets/office/characters/micah-pat-norm/back-1.png";
import micahPatBack2 from "../assets/office/characters/micah-pat-norm/back-2.png";

import luiWalkLeft1 from "../assets/office/characters/lui-walk-norm/left-1.png";
import luiWalkLeft2 from "../assets/office/characters/lui-walk-norm/left-2.png";
import luiWalkRight1 from "../assets/office/characters/lui-walk-norm/right-1.png";
import luiWalkRight2 from "../assets/office/characters/lui-walk-norm/right-2.png";
import luiWalkFront1 from "../assets/office/characters/lui-walk-norm/front-1.png";
import luiWalkFront2 from "../assets/office/characters/lui-walk-norm/front-2.png";
import luiWalkBack1 from "../assets/office/characters/lui-walk-norm/back-1.png";
import luiWalkBack2 from "../assets/office/characters/lui-walk-norm/back-2.png";

import luiIdleLeft from "../assets/office/characters/lui-idle-norm/left.png";
import luiIdleRight from "../assets/office/characters/lui-idle-norm/right.png";
import luiIdleFront from "../assets/office/characters/lui-idle-norm/front.png";
import luiIdleBack from "../assets/office/characters/lui-idle-norm/back.png";

import luiPatLeft1 from "../assets/office/characters/lui-pat-norm/left-1.png";
import luiPatLeft2 from "../assets/office/characters/lui-pat-norm/left-2.png";
import luiPatRight1 from "../assets/office/characters/lui-pat-norm/right-1.png";
import luiPatRight2 from "../assets/office/characters/lui-pat-norm/right-2.png";
import luiPatFront1 from "../assets/office/characters/lui-pat-norm/front-1.png";
import luiPatFront2 from "../assets/office/characters/lui-pat-norm/front-2.png";
import luiPatBack1 from "../assets/office/characters/lui-pat-norm/back-1.png";
import luiPatBack2 from "../assets/office/characters/lui-pat-norm/back-2.png";

import sitTypeFront from "../assets/office/characters/chibi-bon/front-sit.png";
import sitTypeBack from "../assets/office/characters/chibi-bon/back-sit.png";
import sitTypeLeft from "../assets/office/characters/chibi-bon/left-sit.png";
import sitTypeRight from "../assets/office/characters/chibi-bon/right-sit.png";

import alexSitTypeFront from "../assets/office/characters/alex-sit-type-norm/front.png";
import alexSitTypeBack from "../assets/office/characters/alex-sit-type-norm/back.png";
import alexSitTypeLeft from "../assets/office/characters/alex-sit-type-norm/left.png";
import alexSitTypeRight from "../assets/office/characters/alex-sit-type-norm/right.png";

import micahSitTypeFront from "../assets/office/characters/micah-sit-type-norm/front.png";
import micahSitTypeBack from "../assets/office/characters/micah-sit-type-norm/back.png";
import micahSitTypeLeft from "../assets/office/characters/micah-sit-type-norm/left.png";
import micahSitTypeRight from "../assets/office/characters/micah-sit-type-norm/right.png";

import luiSitTypeFront from "../assets/office/characters/lui-sit-type-norm/front.png";
import luiSitTypeBack from "../assets/office/characters/lui-sit-type-norm/back.png";
import luiSitTypeLeft from "../assets/office/characters/lui-sit-type-norm/left.png";
import luiSitTypeRight from "../assets/office/characters/lui-sit-type-norm/right.png";

import type { AvatarSpriteSet } from "../services/avatar/types";

export type WalkDirection = "left" | "right" | "front" | "back";

// index 0 = stride frame 1, index 1 = stride frame 2
export const BON_WALK_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [walkLeft1, walkLeft2],
  right: [walkRight1, walkRight2],
  front: [walkFront1, walkFront2],
  back: [walkBack1, walkBack2],
};

export const BON_IDLE_FRAMES: Record<WalkDirection, string> = {
  left: idleLeft,
  right: idleRight,
  front: idleFront,
  back: idleBack,
};

// Pose #13 "Sitting — Typing / Keyboard" (see POSE_LIBRARY.md) — one frame
// per direction, same shape as BON_IDLE_FRAMES (no stride/gesture pair).
export const BON_SIT_TYPE_FRAMES: Record<WalkDirection, string> = {
  left: sitTypeLeft,
  right: sitTypeRight,
  front: sitTypeFront,
  back: sitTypeBack,
};

// Bon's frames repackaged into the generic AvatarSpriteSet shape (see
// services/avatar/types.ts) so he can be run through the same
// characterSprite() selector as any future per-employee sprite set. No `pat`
// — Bon's hand-made set has no pat pose; `pat` is optional on
// AvatarSpriteSet and characterSprite() falls back to idle for him.
export const BON_SPRITE_SET: AvatarSpriteSet = {
  walk: BON_WALK_FRAMES,
  idle: BON_IDLE_FRAMES,
  sitType: BON_SIT_TYPE_FRAMES,
};

// Alex and Micah — same normalized production-v2 pipeline output, packaged
// identically to Bon's sprite set so they can run through the same
// characterSprite() selector / useCharacterWalk hook.
export const ALEX_WALK_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [alexWalkLeft1, alexWalkLeft2],
  right: [alexWalkRight1, alexWalkRight2],
  front: [alexWalkFront1, alexWalkFront2],
  back: [alexWalkBack1, alexWalkBack2],
};

export const ALEX_IDLE_FRAMES: Record<WalkDirection, string> = {
  left: alexIdleLeft,
  right: alexIdleRight,
  front: alexIdleFront,
  back: alexIdleBack,
};

export const ALEX_PAT_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [alexPatLeft1, alexPatLeft2],
  right: [alexPatRight1, alexPatRight2],
  front: [alexPatFront1, alexPatFront2],
  back: [alexPatBack1, alexPatBack2],
};

export const ALEX_SIT_TYPE_FRAMES: Record<WalkDirection, string> = {
  left: alexSitTypeLeft,
  right: alexSitTypeRight,
  front: alexSitTypeFront,
  back: alexSitTypeBack,
};

export const ALEX_SPRITE_SET: AvatarSpriteSet = {
  walk: ALEX_WALK_FRAMES,
  idle: ALEX_IDLE_FRAMES,
  pat: ALEX_PAT_FRAMES,
  sitType: ALEX_SIT_TYPE_FRAMES,
};

export const MICAH_WALK_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [micahWalkLeft1, micahWalkLeft2],
  right: [micahWalkRight1, micahWalkRight2],
  front: [micahWalkFront1, micahWalkFront2],
  back: [micahWalkBack1, micahWalkBack2],
};

export const MICAH_IDLE_FRAMES: Record<WalkDirection, string> = {
  left: micahIdleLeft,
  right: micahIdleRight,
  front: micahIdleFront,
  back: micahIdleBack,
};

export const MICAH_PAT_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [micahPatLeft1, micahPatLeft2],
  right: [micahPatRight1, micahPatRight2],
  front: [micahPatFront1, micahPatFront2],
  back: [micahPatBack1, micahPatBack2],
};

export const MICAH_SIT_TYPE_FRAMES: Record<WalkDirection, string> = {
  left: micahSitTypeLeft,
  right: micahSitTypeRight,
  front: micahSitTypeFront,
  back: micahSitTypeBack,
};

export const MICAH_SPRITE_SET: AvatarSpriteSet = {
  walk: MICAH_WALK_FRAMES,
  idle: MICAH_IDLE_FRAMES,
  pat: MICAH_PAT_FRAMES,
  sitType: MICAH_SIT_TYPE_FRAMES,
};

// Lui — same normalized production-v3 pipeline output, packaged
// identically to Bon/Alex/Micah's sprite sets so he can run through the
// same characterSprite() selector / useCharacterWalk hook.
export const LUI_WALK_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [luiWalkLeft1, luiWalkLeft2],
  right: [luiWalkRight1, luiWalkRight2],
  front: [luiWalkFront1, luiWalkFront2],
  back: [luiWalkBack1, luiWalkBack2],
};

export const LUI_IDLE_FRAMES: Record<WalkDirection, string> = {
  left: luiIdleLeft,
  right: luiIdleRight,
  front: luiIdleFront,
  back: luiIdleBack,
};

export const LUI_PAT_FRAMES: Record<WalkDirection, readonly [string, string]> = {
  left: [luiPatLeft1, luiPatLeft2],
  right: [luiPatRight1, luiPatRight2],
  front: [luiPatFront1, luiPatFront2],
  back: [luiPatBack1, luiPatBack2],
};

export const LUI_SIT_TYPE_FRAMES: Record<WalkDirection, string> = {
  left: luiSitTypeLeft,
  right: luiSitTypeRight,
  front: luiSitTypeFront,
  back: luiSitTypeBack,
};

export const LUI_SPRITE_SET: AvatarSpriteSet = {
  walk: LUI_WALK_FRAMES,
  idle: LUI_IDLE_FRAMES,
  pat: LUI_PAT_FRAMES,
  sitType: LUI_SIT_TYPE_FRAMES,
};

// Lookup by avatar id — lets a caller that only has "which sprite id is the
// viewer" (e.g. from avatarIdentity.ts's join) resolve straight to the
// AvatarSpriteSet, instead of hardcoding which BON_SPRITE_SET-shaped
// constant to use. Keys must stay in sync with the avatar ids that
// EMAIL_TO_AVATAR_ID / the localpart convention can actually produce for a
// real person; anything not listed here has no animated sprite set yet and
// callers should fall back to "bon".
export const SPRITE_SET_BY_AVATAR_ID: Record<string, AvatarSpriteSet> = {
  bon: BON_SPRITE_SET,
  alex: ALEX_SPRITE_SET,
  micah: MICAH_SPRITE_SET,
  lui: LUI_SPRITE_SET,
};

// Generic sprite selector: picks the frame for a given sprite set's
// state/direction/frame. idle and sitType have only one frame per
// direction, so frameIndex is ignored for both (matches the original
// bonSprite behavior for idle). sitType falls back to idle's frame for that
// direction if the sprite set predates pose #13 and has no sitType entry;
// pat falls back to idle's frame if the sprite set has no pat pose at all
// (e.g. Bon's hand-made set) (see AvatarSpriteSet.pat/sitType optionality
// notes in services/avatar/types.ts).
export function characterSprite(
  set: AvatarSpriteSet,
  state: "idle" | "walk" | "pat" | "sitType",
  direction: WalkDirection,
  frameIndex: 0 | 1 = 0,
): string {
  if (state === "walk") return set.walk[direction][frameIndex];
  if (state === "pat") return set.pat?.[direction]?.[frameIndex] ?? set.idle[direction];
  if (state === "sitType") return set.sitType?.[direction] ?? set.idle[direction];
  return set.idle[direction];
}

// Backward-compatible wrapper — selects bon's current sprite for the given
// state/direction/frame. Kept so existing callers don't need to change.
export function bonSprite(
  state: "idle" | "walk" | "pat" | "sitType",
  direction: WalkDirection,
  frameIndex: 0 | 1 = 0,
): string {
  return characterSprite(BON_SPRITE_SET, state, direction, frameIndex);
}
