// vo3d render — THE GRAPHICS PORT, implemented against the real V2 systems.
//
// services/render/graphicsController owns WHEN settings change; this file owns WHAT each one does to
// this renderer, and it is the whole of the surface graphics settings can reach. Everything it touches
// is a switch one of these systems already had — the renderer's DPR/AO/shadow resolution, SwaySystem's
// own `enabled`, the Environment's particle budget, and the avatar loader's existing LOD argument.
//
// WHAT IT CANNOT REACH, structurally: the world, the nav grid, walkability, doors, seats, interactions,
// the camera, the editor, audio, or any authored light/grade value. Switching graphics mode therefore
// cannot move a person, open a door, change where anyone may walk, or alter the approved lighting —
// not because it has been careful, but because it holds no reference that would let it.

import type { EffectsDetail, AvatarDetail } from "../../../services/render/graphicsQuality";
import { AVATAR_LOD_FOR_DETAIL, EFFECTS_DENSITY } from "../../../services/render/graphicsQuality";
import type { GraphicsEngine } from "../../../services/render/graphicsController";

/** Only the bits of Renderer this port drives — so the mapping is testable without a GL context. */
export interface GraphicsRendererPort {
  ssaoEnabled: boolean;
  setRenderScale(scale: number): void;
  setAoResolutionScale(scale: number): void;
  setShadows(on: boolean): void;
  setShadowMapSize(size: number): void;
  invalidateShadows(): void;
}

export interface GraphicsWorldPort {
  /** the SwaySystem's own enabled flag — the plants stay, only the motion stops */
  sway: { enabled: boolean };
  /** the Environment's particle budget, 0..1 */
  env: { particleBudget: number };
  /** Swap the hero avatar's LOD. Optional: a rig without a loaded avatar simply has no LOD to set.
   *  Only ever called from a USER action in Custom — the adaptive ladder holds avatarDetail constant
   *  (see SMOOTH_LADDER) because an asset reload is not a render switch. */
  setAvatarLod?: (lod: 0 | 1 | 2) => void;
}

/** Wire the V2 renderer/world up as a GraphicsEngine. */
export function createGraphicsEngine(renderer: GraphicsRendererPort, world: GraphicsWorldPort): GraphicsEngine {
  /** weatherEffects (a switch) and effectsDetail (a grade) both land on the one particle budget, so the
   *  two controls can never disagree about whether it is raining. */
  let weather = true;
  let detail: EffectsDetail = "full";
  const applyParticles = (): void => {
    world.env.particleBudget = weather ? EFFECTS_DENSITY[detail] : 0;
  };
  return {
    setRenderScale(scale) {
      renderer.setRenderScale(scale);
    },
    setAmbientOcclusion(on) {
      renderer.ssaoEnabled = on;
    },
    setAoResolutionScale(scale) {
      renderer.setAoResolutionScale(scale);
    },
    setShadows(on) {
      renderer.setShadows(on);
      // setShadows already marks both halves dirty; this is the belt-and-braces call for the case where
      // shadows come back ON and nothing else in the frame happens to have moved.
      renderer.invalidateShadows();
    },
    setShadowMapSize(size) {
      renderer.setShadowMapSize(size);
    },
    setWeatherEffects(on) {
      weather = on;
      applyParticles();
    },
    setEffectsDetail(next) {
      detail = next;
      applyParticles();
    },
    setFoliageSway(on) {
      world.sway.enabled = on;
    },
    setAvatarDetail(next: AvatarDetail) {
      world.setAvatarLod?.(AVATAR_LOD_FOR_DETAIL[next]);
    },
  };
}
