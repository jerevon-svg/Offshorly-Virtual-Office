// Non-blocking real-mode flow (Track 2): a real background job takes
// minutes, so a placeholder character stands in on the map immediately while
// the real sprite set generates. These are the real per-frame animated
// blank-chibi frames (idle x4 directions, walk x2 frames x4 directions,
// pat x2 frames x4 directions), generated + normalized (191x240, transparent
// background, chroma-keyed off the magenta) via the same pipeline used for
// real employees (see scripts/avatar-pipeline/generate-blank-chibi-full.mjs
// + normalize-base-chibi.mjs) — packaged into AvatarSpriteSet the same way
// bonWalkFrames.ts packages BON_SPRITE_SET/ALEX_SPRITE_SET/etc.
import baseChibiIdleFront from "../../assets/office/characters/base-chibi-idle-norm/front.png";
import baseChibiIdleBack from "../../assets/office/characters/base-chibi-idle-norm/back.png";
import baseChibiIdleLeft from "../../assets/office/characters/base-chibi-idle-norm/left.png";
import baseChibiIdleRight from "../../assets/office/characters/base-chibi-idle-norm/right.png";

import baseChibiWalkFront1 from "../../assets/office/characters/base-chibi-walk-norm/front-1.png";
import baseChibiWalkFront2 from "../../assets/office/characters/base-chibi-walk-norm/front-2.png";
import baseChibiWalkBack1 from "../../assets/office/characters/base-chibi-walk-norm/back-1.png";
import baseChibiWalkBack2 from "../../assets/office/characters/base-chibi-walk-norm/back-2.png";
import baseChibiWalkLeft1 from "../../assets/office/characters/base-chibi-walk-norm/left-1.png";
import baseChibiWalkLeft2 from "../../assets/office/characters/base-chibi-walk-norm/left-2.png";
import baseChibiWalkRight1 from "../../assets/office/characters/base-chibi-walk-norm/right-1.png";
import baseChibiWalkRight2 from "../../assets/office/characters/base-chibi-walk-norm/right-2.png";

import baseChibiPatFront1 from "../../assets/office/characters/base-chibi-pat-norm/front-1.png";
import baseChibiPatFront2 from "../../assets/office/characters/base-chibi-pat-norm/front-2.png";
import baseChibiPatBack1 from "../../assets/office/characters/base-chibi-pat-norm/back-1.png";
import baseChibiPatBack2 from "../../assets/office/characters/base-chibi-pat-norm/back-2.png";
import baseChibiPatLeft1 from "../../assets/office/characters/base-chibi-pat-norm/left-1.png";
import baseChibiPatLeft2 from "../../assets/office/characters/base-chibi-pat-norm/left-2.png";
import baseChibiPatRight1 from "../../assets/office/characters/base-chibi-pat-norm/right-1.png";
import baseChibiPatRight2 from "../../assets/office/characters/base-chibi-pat-norm/right-2.png";

import type { AvatarSpriteSet } from "./types";

// Real per-frame animated placeholder sprite set (replaces the earlier
// 4-static-crop stand-in — see git history for the old
// base-chibi-{front,back,left,right}.png-reused-per-frame version). The old
// 4 static crops are left in place, unused, under
// src/assets/office/characters/ as a rollback safety net; nothing else in
// the app references them anymore.
export const PLACEHOLDER_SPRITE_SET: AvatarSpriteSet = {
  walk: {
    front: [baseChibiWalkFront1, baseChibiWalkFront2],
    back: [baseChibiWalkBack1, baseChibiWalkBack2],
    left: [baseChibiWalkLeft1, baseChibiWalkLeft2],
    right: [baseChibiWalkRight1, baseChibiWalkRight2],
  },
  idle: {
    front: baseChibiIdleFront,
    back: baseChibiIdleBack,
    left: baseChibiIdleLeft,
    right: baseChibiIdleRight,
  },
  pat: {
    front: [baseChibiPatFront1, baseChibiPatFront2],
    back: [baseChibiPatBack1, baseChibiPatBack2],
    left: [baseChibiPatLeft1, baseChibiPatLeft2],
    right: [baseChibiPatRight1, baseChibiPatRight2],
  },
};

// Preview portrait used for the SavedAvatar record itself (SavedStep/mock
// paths expect a plain previewUrl string) — front is the most recognizable
// single frame.
export const PLACEHOLDER_PREVIEW_URL = baseChibiIdleFront;
