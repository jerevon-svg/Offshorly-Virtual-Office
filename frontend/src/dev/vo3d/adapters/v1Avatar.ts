// vo3d adapter — READ-ONLY view of the production live-3D character registry and clip names.
import { LIVE_3D_CHARACTERS } from "../../../render3d/live3dCharacters";
import { bonLayer } from "../../../data/office-layout";

export const BON_LODS = {
  0: LIVE_3D_CHARACTERS.bon.glbUrl,
  1: LIVE_3D_CHARACTERS.bon.lod1GlbUrl ?? LIVE_3D_CHARACTERS.bon.glbUrl,
  2: LIVE_3D_CHARACTERS.bon.lod2GlbUrl ?? LIVE_3D_CHARACTERS.bon.glbUrl,
} as const;
export type AvatarLod = keyof typeof BON_LODS;
/** production clip names baked into the consolidated GLB (render3d/characterAnimationState.ts) */
export const CLIP_IDLE = "idle-9";
export const CLIP_WALK = "walking";
export const CLIP_SIT = "sit-on-chair-arms";
/** standing height in world units: bon's V1 sprite box is 37.2 tall; 36 keeps desks (24) at hip height */
export const BON_STANDING_HEIGHT = Math.round(bonLayer.height) - 1;
export const DRACO_PATH = `${import.meta.env.BASE_URL}vendor/draco/`;
