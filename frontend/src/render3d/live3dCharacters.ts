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
  // LOD0 — full-detail GLB, used for T2 (strong desktop) viewers.
  glbUrl: string;
  // LOD1 — reduced-detail GLB, used for T1 (including microbench-rescued
  // weak-static devices, see deviceTier.ts's MICROBENCH_T1_RESCUE_MS)
  // viewers. Falls back to glbUrl (LOD0) when a character has no dedicated
  // LOD1 asset yet, so adding a new character without LOD1/LOD2 art doesn't
  // break rendering — it just means every tier gets the same (LOD0) detail
  // until the cheaper LODs are produced.
  lod1GlbUrl?: string;
  // LOD2 — cheapest GLB, used for the confirmed-too-weak-but-has-WebGL
  // static-frame case (software renderer, or a weak-static device that
  // failed/never ran its microbench rescue — see OfficeStage.tsx). Falls
  // back to lod1GlbUrl, then glbUrl, when absent.
  lod2GlbUrl?: string;
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
    lod1GlbUrl: `${BASE}avatars/jerevon/jerevon-lod1.glb`,
    lod2GlbUrl: `${BASE}avatars/jerevon/jerevon-lod2.glb`,
    renderWidth: 210,
    renderHeight: 298,
  },
};

export function isLive3dEligible(avatarId: string | null | undefined): boolean {
  return !!avatarId && avatarId in LIVE_3D_CHARACTERS;
}

/**
 * Picks the right per-LOD GLB url for a given asset set + resolved device
 * tier + "static frame" bucket (see deviceTier.ts's isMobileLike/
 * hasWorkingWebGl/isSoftwareRendererSignal doc comments and OfficeStage.tsx
 * for how the static-frame bucket is determined) — T2 -> LOD0, T1
 * (including microbench-rescued) -> LOD1, static-frame -> LOD2. Each LOD
 * falls back to the next-higher-detail asset when a character hasn't had
 * that LOD produced yet, so a character can ship with only glbUrl and still
 * render (at LOD0 detail) at every tier.
 */
export function resolveLive3dGlbUrl(
  entry: Live3dAssetSet,
  tier: "T0" | "T1" | "T2",
  isStaticFrame: boolean,
): string {
  if (isStaticFrame) return entry.lod2GlbUrl ?? entry.lod1GlbUrl ?? entry.glbUrl;
  if (tier === "T1") return entry.lod1GlbUrl ?? entry.glbUrl;
  return entry.glbUrl;
}
