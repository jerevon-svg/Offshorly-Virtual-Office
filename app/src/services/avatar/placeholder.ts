// Non-blocking real-mode flow (Track 2): a real background job takes
// minutes, so a placeholder character stands in on the map immediately while
// the real sprite set generates. These four crops came from a real blank
// OffshorlyChibi reference sheet (no face/hair/clothes), normalized with the
// same background-key/trim/letterbox approach gen-server.mjs uses for real
// generated frames (191x240, transparent background) — so it swaps in/out of
// the map seamlessly in scale/framing once the real result is ready.
import baseChibiFront from "../../assets/office/characters/base-chibi-front.png";
import baseChibiBack from "../../assets/office/characters/base-chibi-back.png";
import baseChibiLeft from "../../assets/office/characters/base-chibi-left.png";
import baseChibiRight from "../../assets/office/characters/base-chibi-right.png";
import type { AvatarSpriteSet } from "./types";

// No walk-cycle frames exist for the placeholder (it's a static blank
// figure, not a generated animation) — reuse the same static image for both
// stride frames per direction. characterSprite() only ever asks for one
// frame at a time (walk/pat frameIndex, or the single idle frame), so this
// renders as a motionless figure in whichever direction bon/the NPC selector
// picks, which is fine for a short-lived placeholder.
export const PLACEHOLDER_SPRITE_SET: AvatarSpriteSet = {
  walk: {
    front: [baseChibiFront, baseChibiFront],
    back: [baseChibiBack, baseChibiBack],
    left: [baseChibiLeft, baseChibiLeft],
    right: [baseChibiRight, baseChibiRight],
  },
  idle: {
    front: baseChibiFront,
    back: baseChibiBack,
    left: baseChibiLeft,
    right: baseChibiRight,
  },
  pat: {
    front: [baseChibiFront, baseChibiFront],
    back: [baseChibiBack, baseChibiBack],
    left: [baseChibiLeft, baseChibiLeft],
    right: [baseChibiRight, baseChibiRight],
  },
};

// Preview portrait used for the SavedAvatar record itself (SavedStep/mock
// paths expect a plain previewUrl string) — front is the most recognizable
// single frame.
export const PLACEHOLDER_PREVIEW_URL = baseChibiFront;
