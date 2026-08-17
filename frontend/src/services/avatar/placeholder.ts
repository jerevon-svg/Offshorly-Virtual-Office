// Non-blocking real-mode flow (Track 2): a placeholder character stands in
// on the map for any avatar record with no sprite set of its own yet. These
// are Bon's hand-made blank-chibi frames (idle x4 directions, sit x4
// directions, walk-A/walk-B x4 directions each), 191x240 with alpha
// transparency, replacing the earlier AI-generated
// base-chibi-{idle,walk,pat}-norm assets (see git history to roll back — the
// old AI-generated crops are left in place, unused, under
// src/assets/office/characters/ as a rollback safety net; nothing else in
// the app references them anymore). No pat pose was hand-drawn, so
// PLACEHOLDER_SPRITE_SET omits `pat`; characterSprite() falls back to idle
// for it (see AvatarSpriteSet.pat's optionality note in ./types.ts).
import baseChibiIdleFront from "../../assets/office/characters/chibi-base/front-idle.png";
import baseChibiIdleBack from "../../assets/office/characters/chibi-base/back-idle.png";
import baseChibiIdleLeft from "../../assets/office/characters/chibi-base/left-idle.png";
import baseChibiIdleRight from "../../assets/office/characters/chibi-base/right-idle.png";

import baseChibiWalkFront1 from "../../assets/office/characters/chibi-base/front-walk-A.png";
import baseChibiWalkFront2 from "../../assets/office/characters/chibi-base/front-walk-B.png";
import baseChibiWalkBack1 from "../../assets/office/characters/chibi-base/back-walk-A.png";
import baseChibiWalkBack2 from "../../assets/office/characters/chibi-base/back-walk-B.png";
import baseChibiWalkLeft1 from "../../assets/office/characters/chibi-base/left-walk-A.png";
import baseChibiWalkLeft2 from "../../assets/office/characters/chibi-base/left-walk-B.png";
import baseChibiWalkRight1 from "../../assets/office/characters/chibi-base/right-walk-A.png";
import baseChibiWalkRight2 from "../../assets/office/characters/chibi-base/right-walk-B.png";

import baseChibiSitFront from "../../assets/office/characters/chibi-base/front-sit.png";
import baseChibiSitBack from "../../assets/office/characters/chibi-base/back-sit.png";
import baseChibiSitLeft from "../../assets/office/characters/chibi-base/left-sit.png";
import baseChibiSitRight from "../../assets/office/characters/chibi-base/right-sit.png";

import type { AvatarSpriteSet } from "./types";

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
  sitType: {
    front: baseChibiSitFront,
    back: baseChibiSitBack,
    left: baseChibiSitLeft,
    right: baseChibiSitRight,
  },
};

// Preview portrait used for the SavedAvatar record itself (SavedStep/mock
// paths expect a plain previewUrl string) — front is the most recognizable
// single frame.
export const PLACEHOLDER_PREVIEW_URL = baseChibiIdleFront;
