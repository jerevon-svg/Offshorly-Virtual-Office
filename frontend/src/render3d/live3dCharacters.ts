// Live-3D character registry: which avatar ids have an APPROVED, shipped
// consolidated GLB (single mesh/skeleton + all 6 named animation clips,
// see build-character-lods.mjs) eligible to replace the 2D sprite in
// production, subject to the viewer's device tier / crowd budget (see
// OfficeStage.tsx's gating logic and services/render/tierBudgets.ts).
//
// Presence of an entry here means "this character CAN be shown live-3D if
// the viewer's device permits it" — it is the eligibility half of the
// gating decision, not the permission half. This is deliberately separate
// from OfficeStage's dev-only `?live3d=` override map, which exists purely
// to preview NOT-yet-eligible characters (e.g. Alex) without shipping them.
//
// All GLB paths are BASE_URL-relative and live under `public/avatars/` —
// Vite only copies `public/` into a production build (unlike the rest of
// the project root, which `vite dev` happens to also serve, silently
// masking this requirement in dev). Every path here MUST resolve under
// `public/` or it will 404 in a real `vite build`.
//
// Adding employee #2 (once they've gone through the same Meshy pipeline and
// been approved) is a single new entry here — no other code changes.
//
// Phase A: each character now ships exactly ONE consolidated GLB (built by
// build-character-lods.mjs's animation-retargeting pass) containing every
// one of CharacterCanvas's 6 animation-state clips (see
// characterAnimationState.ts's CHARACTER_ANIM_STATES) baked onto a single
// shared skeleton — CharacterCanvas loads it once and drives a single
// AnimationMixer, crossfading between clips as the resolved state changes.
// This replaces the earlier per-pose-GLB shape (walkingGlbUrl/idleGlbUrl/
// shrugGlbUrl/thinkingGlbUrl), which required hard-swapping between up to 4
// independently-loaded models.
export type Live3dAssetSet = {
  glbUrl: string;
  // Fixed offscreen render resolution, matched to this character's
  // office-assets-manifest aspect ratio for a crisp result regardless of
  // the wrapper div's current on-screen (percentage/zoom-scaled) size.
  renderWidth: number;
  renderHeight: number;
};

const BASE = import.meta.env.BASE_URL;

// One entry per avatar id with an approved, shipped live-3D asset set.
// Bon/Jerevon is the only real employee through the pipeline so far.
export const LIVE_3D_CHARACTERS: Record<string, Live3dAssetSet> = {
  // Manifest aspect ratio: width 26.23 / height 37.2.
  bon: {
    glbUrl: `${BASE}avatars/jerevon/jerevon-lod0.glb`,
    renderWidth: 210,
    renderHeight: 298,
  },
};

export function isLive3dEligible(avatarId: string | null | undefined): boolean {
  return !!avatarId && avatarId in LIVE_3D_CHARACTERS;
}
