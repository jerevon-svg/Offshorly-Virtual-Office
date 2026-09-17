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
/** Sprint locomotion, consolidated into Bon's GLB on 2026-09-13 from the rig's own free bundle — no
 *  generation, no re-rig, same 24-joint skeleton. In-place (zero root translation) and seamless, so the
 *  player controller keeps owning movement exactly as it does for the walk. */
export const CLIP_RUN = "running";
export const CLIP_SIT = "sit-on-chair-arms";
/** standing height in world units: bon's V1 sprite box is 37.2 tall; 36 keeps desks (24) at hip height */
export const BON_STANDING_HEIGHT = Math.round(bonLayer.height) - 1;
export const DRACO_PATH = `${import.meta.env.BASE_URL}vendor/draco/`;

/** THE WHOLE SHIPPED CAST, read-only, for the stress harness. Every id here has an approved consolidated
 *  GLB in the production registry — five distinct meshes/skeletons/texture sets, which is what makes a
 *  crowd built from them cost what a real roomful of employees costs rather than one model repeated. */
export const CAST_IDS: readonly string[] = Object.keys(LIVE_3D_CHARACTERS);
export type CastId = string;
/** Does this avatar id have an approved 3D character at all?
 *
 *  NOT every avatar id does. data/avatarRegistry.ts maps a person to the character that renders them in
 *  V1, where a 2D SPRITE SET is enough — "lui" is exactly that: a real employee with a real V1 avatar and
 *  no consolidated GLB. V2 draws nothing but GLBs, so its answer for that person has to be "no character
 *  yet", the same explicit absence app/world.ts already shows for an unmapped employee. Asking castLods
 *  directly would instead throw on the missing registry row and take the whole world down with it. */
export function hasCastLods(id: CastId): boolean {
  return Object.prototype.hasOwnProperty.call(LIVE_3D_CHARACTERS, id);
}

/** the three LOD urls a cast member ships, with the registry's own LOD1→LOD0 / LOD2→LOD1 fallbacks */
export function castLods(id: CastId): Record<AvatarLod, string> {
  const c = LIVE_3D_CHARACTERS[id];
  return { 0: c.glbUrl, 1: c.lod1GlbUrl ?? c.glbUrl, 2: c.lod2GlbUrl ?? c.lod1GlbUrl ?? c.glbUrl };
}
